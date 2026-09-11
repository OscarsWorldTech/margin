import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { number, parseCaptions, whisperCues, sentences, markdown, byteRange } from './captions.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const data=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
await mkdir(path.join(data,'cache'),{recursive:true});
const db=new DatabaseSync(path.join(data,'margin.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS captions(book TEXT PRIMARY KEY,cues TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,book TEXT NOT NULL,start REAL NOT NULL,end REAL NOT NULL,quote TEXT NOT NULL,note TEXT NOT NULL,color TEXT NOT NULL,created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notes_book_start ON notes(book,start);
CREATE TABLE IF NOT EXISTS jobs(book TEXT PRIMARY KEY,status TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',chunks TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS positions(book TEXT PRIMARY KEY,time REAL NOT NULL);
PRAGMA optimize;`);
db.prepare("UPDATE jobs SET status='paused',message='Server restarted. Resume to continue from the last completed chunk.' WHERE status IN ('running','queued')").run();
const demo=process.env.DEMO_MODE==='true';
const absBase=(process.env.ABS_URL||'').replace(/\/$/,'');
const absToken=process.env.ABS_TOKEN||'';
const whisperBase=(process.env.WHISPER_URL||'http://whisper:8080').replace(/\/$/,'');
const password=process.env.MARGIN_PASSWORD||'';
if(!demo&&!password) throw new Error('Set MARGIN_PASSWORD before starting Margin. Use DEMO_MODE=true only for the local sample.');
const sessions=new Map(), queue=[], cancel=new Set(); let working=false;
function failure(message,status=400){const e=new Error(message);e.status=status;return e;}
function id(value){if(!/^[a-zA-Z0-9_-]{1,150}$/.test(value||''))throw failure('Invalid book identifier');return value;}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function safeEqual(a,b){return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());}
async function body(req,max=8*1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw failure('Request is too large',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw failure('Invalid JSON');}}
function absUrl(relative){
  if(!absBase||!absToken) throw failure('Set ABS_URL and ABS_TOKEN in your .env file, then restart Margin.',503);
  const base=new URL(absBase+'/');
  let url;
  if(/^https?:\/\//.test(relative)) url=new URL(relative);
  else if(base.pathname!=='/'&&relative.startsWith(base.pathname)) url=new URL(relative,base.origin);
  else url=new URL(relative.replace(/^\//,''),base);
  if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw failure('Audiobookshelf returned an unexpected media address.',502);
  url.searchParams.delete('token');return url;
}
async function upstream(relative,options={},accepted=[]){
  const response=await fetch(absUrl(relative),{...options,redirect:'error',headers:{Authorization:'Bearer '+absToken,...options.headers},signal:options.signal||AbortSignal.timeout(30000)});
  if(!response.ok&&!accepted.includes(response.status))throw failure(response.status===401||response.status===403?'Audiobookshelf rejected the token or item access.':`Audiobookshelf returned HTTP ${response.status}.`,502);
  return response;
}
async function abs(relative,options){return (await upstream(relative,options)).json();}
function noteList(book){return db.prepare('SELECT * FROM notes WHERE book=? ORDER BY start,created').all(book);}
function job(book){return db.prepare('SELECT book,status,progress,message FROM jobs WHERE book=?').get(book)||null;}
function readCues(book){const r=db.prepare('SELECT cues FROM captions WHERE book=?').get(book);return r?JSON.parse(r.cues):[];}
function storeCues(book,cues){db.prepare('INSERT INTO captions VALUES (?,?) ON CONFLICT(book) DO UPDATE SET cues=excluded.cues').run(book,JSON.stringify(cues));}
async function demoBook(){return JSON.parse(await readFile(path.join(root,'public/demo.json'),'utf8'));}
async function readPosition(book,duration){
  if(demo)return db.prepare('SELECT time FROM positions WHERE book=?').get(book)?.time||0;
  const response=await upstream(`/api/me/progress/${book}`,{},[404]);
  if(response.status===404){await response.body?.cancel();return 0;}
  const progress=await response.json();
  return number(progress.currentTime??0,0,duration);
}
async function bookDetails(book){
  if(demo){if(book!=='demo')throw failure('Sample book not found',404);return demoBook();}
  const item=await abs(`/api/items/${id(book)}?expanded=1&include=progress`);
  if(item.mediaType!=='book')throw failure('Select an audiobook.',400);
  const media=item.media;
  const tracks=(media.tracks||[]).map((t,i)=>({...t,index:i,startOffset:number(t.startOffset||0),duration:number(t.duration)}));
  if(!tracks.length)throw failure('This book has no playable audio tracks.',400);
  return {id:book,title:media.metadata?.title||'Untitled',author:media.metadata?.authorName||(media.metadata?.authors||[]).map(a=>a.name).join(', '),duration:media.duration||tracks.reduce((n,t)=>n+t.duration,0),tracks,chapters:media.chapters||[],position:item.userMediaProgress?.currentTime||0,cover:`/api/books/${book}/cover`};
}
function publicBook(b){return {...b,tracks:b.tracks.map((t,i)=>({index:i,startOffset:t.startOffset,duration:t.duration,mimeType:t.mimeType,url:`/api/books/${b.id}/audio/${i}`}))};}
function setJob(book,status,progress,message){db.prepare('UPDATE jobs SET status=?,progress=?,message=? WHERE book=?').run(status,progress,message,book);}
async function command(args){return new Promise((resolve,reject)=>{const p=spawn(process.env.FFMPEG_PATH||'ffmpeg',args,{windowsHide:true});let err='';p.stderr.on('data',d=>{err=(err+d.toString()).slice(-2000)});p.on('error',()=>reject(new Error('FFmpeg could not start. Use the supplied Docker image.')));p.on('close',code=>code===0?resolve():reject(new Error('Audio conversion failed. Check the audio file and FFmpeg installation.')));});}
async function transcribe(book){
  const b=await bookDetails(book);const chunks=JSON.parse(db.prepare('SELECT chunks FROM jobs WHERE book=?').get(book).chunks);
  const chunkSeconds=180; let done=0;
  const total=b.tracks.reduce((n,t)=>n+Math.ceil(t.duration/chunkSeconds),0);
  for(let ti=0;ti<b.tracks.length;ti++){
    const t=b.tracks[ti],source=path.join(data,'cache',`${book}-${ti}.audio`);
    const needed=Array.from({length:Math.ceil(t.duration/chunkSeconds)},(_,i)=>`${ti}:${i}`).some(k=>!chunks[k]);
    if(needed){
      if(cancel.has(book))throw failure('paused');
      setJob(book,'running',done/total,'Downloading audio track '+(ti+1)+' of '+b.tracks.length);
      if(!existsSync(source)){
        const temp=source+'.part';
        try {const r=await upstream(t.contentUrl,{signal:AbortSignal.timeout(3600000)});await pipeline(Readable.fromWeb(r.body),createWriteStream(temp));const {rename}=await import('node:fs/promises');await rename(temp,source);}catch(e){await unlink(temp).catch(()=>{});throw e;}
      }
    }
    for(let ci=0;ci<Math.ceil(t.duration/chunkSeconds);ci++){
      const key=`${ti}:${ci}`;
      if(cancel.has(book))throw failure('paused');
      if(!chunks[key]){
        const nominal=ci*chunkSeconds,start=Math.max(0,nominal-1),end=Math.min(t.duration,nominal+chunkSeconds+1);
        const wav=path.join(data,'cache',`${book}-chunk.wav`);
        setJob(book,'running',done/total,`Transcribing section ${done+1} of ${total}`);
        try {
          await command(['-hide_banner','-loglevel','error','-y','-ss',String(start),'-i',source,'-t',String(end-start),'-ar','16000','-ac','1','-c:a','pcm_s16le',wav]);
          const form=new FormData();form.set('file',new Blob([await readFile(wav)],{type:'audio/wav'}),'chunk.wav');form.set('response_format','verbose_json');form.set('temperature','0');form.set('language',process.env.WHISPER_LANGUAGE||'en');
          const r=await fetch(whisperBase+'/inference',{method:'POST',body:form,signal:AbortSignal.timeout(1800000)});
          if(!r.ok)throw new Error(`Transcription engine returned HTTP ${r.status}.`);
          const local=whisperCues(await r.json());
          chunks[key]=local.map(c=>({...c,start:c.start+start,end:c.end+start})).filter(c=>{const middle=(c.start+c.end)/2;return middle>=nominal&&middle<Math.min(t.duration,nominal+chunkSeconds);}).map(c=>({...c,start:c.start+t.startOffset,end:Math.min(c.end,t.duration)+t.startOffset}));
          db.prepare('UPDATE jobs SET chunks=? WHERE book=?').run(JSON.stringify(chunks),book);
          storeCues(book,sentences(Object.values(chunks).flat().sort((a,b)=>a.start-b.start)));
        } finally {await unlink(wav).catch(()=>{});}
      }
      done++;setJob(book,'running',done/total,`Completed ${done} of ${total} sections`);
    }
    await unlink(source).catch(()=>{});
  }
  setJob(book,'done',1,'Captions ready');
}
async function pump(){if(working)return;working=true;while(queue.length){const book=queue.shift();cancel.delete(book);try{await transcribe(book);}catch(e){if(e.message!=='paused')console.error('Transcription job failed:',book,e.message);const previous=job(book);setJob(book,e.message==='paused'?'paused':'failed',previous?.progress||0,e.message==='paused'?'Paused. Completed sections are saved.':(e.status?e.message:'Transcription failed. Check the engine, network, disk space, and model. Resume to retry.'));}}working=false;}
async function streamFile(req,res,file,type){
  const s=await stat(file);let range;try{range=byteRange(req.headers.range,s.size);}catch{res.writeHead(416,{'Content-Range':`bytes */${s.size}`});return res.end();}
  const headers={'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':range.end-range.start+1,'Cache-Control':type.startsWith('text/html')?'no-store':'private, max-age=3600'};
  if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${s.size}`;
  res.writeHead(range.partial?206:200,headers);if(req.method==='HEAD')return res.end();await pipeline(createReadStream(file,{start:range.start,end:range.end}),res);
}
const attempts=new Map();
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  const url=new URL(req.url,'http://local');const p=url.pathname;
  try {
    if(p==='/api/health')return json(res,200,{ok:true});
    if(!['GET','HEAD'].includes(req.method)){
      const origin=req.headers.origin;const allowed=new Set([`http://${req.headers.host}`,`https://${req.headers.host}`,...(process.env.ALLOWED_ORIGINS||'').split(',')]);
      if(req.headers['sec-fetch-site']==='cross-site'||(origin&&!allowed.has(origin)))throw failure('Request origin is not allowed.',403);
    }
    if(p==='/api/login'&&req.method==='POST'){
      const remote=req.socket.remoteAddress;const a=attempts.get(remote)||{n:0,until:Date.now()+60000};
      if(a.until<Date.now()){a.n=0;a.until=Date.now()+60000;}a.n++;attempts.set(remote,a);if(a.n>10)throw failure('Too many attempts. Try again in a minute.',429);
      const input=await body(req,4096);if(!demo&&!safeEqual(String(input.password||''),password))throw failure('Incorrect password.',401);
      const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+7*86400000);
      // Native clients keep the token themselves. Browsers only ever receive the cookie.
      if(input.client==='native')return json(res,200,{ok:true,token});
      res.setHeader('Set-Cookie',`margin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);
      return json(res,200,{ok:true});
    }
    // A packaged app runs on its own origin, so the SameSite=Strict cookie is never sent and
    // background players cannot read it at all. Both present the same session token as a bearer
    // header instead. Native HTTP clients send no Origin or Sec-Fetch-Site, so the cross-site
    // guard above still applies unchanged to every browser request.
    const token=[/(?:^|; )margin_session=([a-f0-9]{64})/.exec(req.headers.cookie||'')?.[1],/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1]].find(t=>t&&(sessions.get(t)||0)>Date.now());
    const authenticated=demo||Boolean(token);
    if(p==='/api/status')return json(res,200,{authenticated,demo,configured:demo||Boolean(absBase&&absToken),version});
    if(p.startsWith('/api/')&&!authenticated)throw failure('Sign in to continue.',401);
    if(p==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie','margin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
    if(p==='/api/libraries'){return json(res,200,demo?[{id:'sample',name:'Sample library'}]:(await abs('/api/libraries')).libraries.filter(l=>l.mediaType==='book'));}
    if(p==='/api/books'){
      if(demo){const b=await demoBook();return json(res,200,{books:[{...publicBook(b),status:'done'}],total:1});}
      const library=id(url.searchParams.get('library'));const page=number(url.searchParams.get('page')||0,0,100000);
      const result=await abs(`/api/libraries/${library}/items?limit=100&page=${page}&minified=1`);
      const books=result.results.filter(b=>b.mediaType==='book'&&b.media?.numAudioFiles!==0).map(b=>({id:b.id,title:b.media.metadata.title,author:b.media.metadata.authorName||'',duration:b.media.duration||0,cover:`/api/books/${b.id}/cover`,status:job(b.id)?.status||(readCues(b.id).length?'done':null)}));
      return json(res,200,{books,total:result.total});
    }
    if(p==='/api/engine'){
      if(demo)return json(res,200,{ok:false,message:'Sample mode — no transcription engine connected.'});
      try{const r=await fetch(whisperBase+'/health',{signal:AbortSignal.timeout(5000)});return json(res,200,{ok:r.ok,message:r.ok?'Transcription engine is reachable. Check its logs to confirm Intel GPU use.':'Engine is not ready.'});}catch{return json(res,200,{ok:false,message:'Transcription engine is unreachable. Check WHISPER_URL and the worker container.'});}
    }
    const match=/^\/api\/books\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/.exec(p);
    if(match){
      const book=id(match[1]),action=match[2]||'';
      if(action===''){
        const b=await bookDetails(book);const cues=demo?(await demoBook()).cues:readCues(book);
        const position=await readPosition(book,b.duration);
        return json(res,200,{...publicBook(b),position,cues,notes:noteList(book),job:job(book)});
      }
      if(action==='captions'&&req.method==='GET')return json(res,200,{cues:demo?(await demoBook()).cues:readCues(book),job:job(book)});
      if(action==='captions'&&req.method==='POST'){
        if(demo)throw failure('Import captions after connecting your own library.');
        await bookDetails(book);if(['running','queued'].includes(job(book)?.status))throw failure('Pause transcription before importing captions.',409);
        const input=await body(req);const cues=sentences(parseCaptions(String(input.text||'')));storeCues(book,cues);
        db.prepare("DELETE FROM jobs WHERE book=?").run(book);return json(res,200,{cues});
      }
      if(action==='transcribe'&&req.method==='POST'){
        if(demo)throw failure('The sample uses prepared captions. Connect your library to transcribe.');
        await bookDetails(book);const previous=job(book);if(previous?.status==='done')return json(res,200,previous);
        if(previous&&['running','queued'].includes(previous.status))return json(res,200,previous);
        db.prepare("INSERT INTO jobs(book,status) VALUES (?,'queued') ON CONFLICT(book) DO UPDATE SET status='queued',message='Waiting for the transcription engine'").run(book);
        queue.push(book);void pump();return json(res,202,job(book));
      }
      if(action==='pause'&&req.method==='POST'){
        const i=queue.indexOf(book);if(i>=0){queue.splice(i,1);setJob(book,'paused',job(book)?.progress||0,'Paused');}else cancel.add(book);
        return json(res,200,{ok:true,message:'Will pause after the current section finishes.'});
      }
      if(action==='position'&&req.method==='GET'){
        const b=await bookDetails(book);return json(res,200,{time:await readPosition(book,b.duration)});
      }
      if(action==='position'&&req.method==='POST'){
        const input=await body(req,4096);const b=await bookDetails(book);const time=number(input.time,0,b.duration);
        if(!demo)await upstream(`/api/me/progress/${book}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentTime:time,duration:b.duration,progress:b.duration?time/b.duration:0})});
        db.prepare('INSERT INTO positions VALUES (?,?) ON CONFLICT(book) DO UPDATE SET time=excluded.time').run(book,time);return json(res,200,{ok:true});
      }
      if(action==='notes'&&req.method==='POST'){
        const b=await bookDetails(book);const n=await body(req,25000);const start=number(n.start,0,b.duration),end=number(n.end,start,b.duration+1);
        const quote=String(n.quote||'').trim(),note=String(n.note||'').trim();if(!quote||quote.length>10000||note.length>10000)throw failure('Select a passage and keep notes under 10,000 characters.');
        const color=['gold','green','blue'].includes(n.color)?n.color:'gold';const key=randomBytes(12).toString('hex');
        db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?)').run(key,book,start,end,quote,note,color,new Date().toISOString());return json(res,201,noteList(book));
      }
      if(action.startsWith('notes/')&&['PATCH','DELETE'].includes(req.method)){
        const key=id(action.slice(6));if(req.method==='DELETE')db.prepare('DELETE FROM notes WHERE id=? AND book=?').run(key,book);
        else{const input=await body(req,25000);const note=String(input.note||'');if(note.length>10000)throw failure('Note is too long');db.prepare('UPDATE notes SET note=? WHERE id=? AND book=?').run(note,key,book);}
        return json(res,200,noteList(book));
      }
      if(action==='export'){
        const b=await bookDetails(book);const format=url.searchParams.get('format');const content=format==='json'?JSON.stringify({title:b.title,notes:noteList(book)},null,2):markdown(b.title,noteList(book));
        res.writeHead(200,{'Content-Type':format==='json'?'application/json':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="margin-notes.${format==='json'?'json':'md'}"`});return res.end(content);
      }
      if(action==='cover'||/^audio\/\d+$/.test(action)){
        const b=await bookDetails(book);
        if(demo){if(action==='cover')throw failure('No sample cover',404);return await streamFile(req,res,path.join(root,'public/demo.wav'),'audio/wav');}
        const track=action==='cover'?null:b.tracks[Number(action.split('/')[1])];if(action!=='cover'&&!track)throw failure('Audio track not found',404);
        const r=await upstream(action==='cover'?`/api/items/${book}/cover`:track.contentUrl,{headers:req.headers.range?{Range:req.headers.range}:{},signal:AbortSignal.timeout(3600000)});
        const headers={};for(const k of ['content-type','content-length','content-range','accept-ranges'])if(r.headers.has(k))headers[k]=r.headers.get(k);
        res.writeHead(r.status,headers);if(req.method==='HEAD'){await r.body.cancel();return res.end();}await pipeline(Readable.fromWeb(r.body),res);return;
      }
    }
    if(p.startsWith('/api/'))throw failure('Not found',404);
    const target=path.resolve(root,'dist','.'+decodeURIComponent(p));const dist=path.join(root,'dist');
    if(!target.startsWith(dist+path.sep)&&target!==dist)throw failure('Not found',404);
    const file=existsSync(target)&&(await stat(target)).isFile()?target:path.join(dist,'index.html');
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.wav':'audio/wav','.json':'application/json','.ico':'image/x-icon'};
    return await streamFile(req,res,file,types[path.extname(file)]||'application/octet-stream');
  }catch(e){if(res.headersSent){res.destroy();return;}json(res,e.status||500,{error:e.status?e.message:'The request failed. Check the server configuration and try again.'});}
});
server.listen(Number(process.env.PORT||8787),process.env.HOST||'127.0.0.1',()=>console.log(`Margin ${demo?'sample':'server'} ready at http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||8787}`));
export { server,db };
