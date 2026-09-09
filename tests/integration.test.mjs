import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
async function unusedPort(){const s=http.createServer();await listen(s);const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('Audiobookshelf integration: authentication, streaming, notes, exports, persistence and resumable transcription',{timeout:45000},async t=>{
 const folder=await mkdtemp(path.join(tmpdir(),'margin-test-'));const wav=await readFile(path.join(root,'public/demo.wav'));
 const received=[];let inference=0,failSecond=true,processHandle,cookie='',remoteTime=13,progressStatus=200;
 const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
 const abs=http.createServer(async(req,res)=>{
   assert.equal(req.headers.authorization,'Bearer private-test-token');received.push(req.url);
   const url=new URL(req.url,'http://test');
   if(url.pathname==='/abs/api/libraries')return send(res,200,{libraries:[{id:'lib1',name:'Books',mediaType:'book'}]});
   if(url.pathname==='/abs/api/libraries/lib1/items')return send(res,200,{total:1,results:[{id:'book1',mediaType:'book',media:{numAudioFiles:2,duration:22,metadata:{title:'Test book',authorName:'An author'}}}]});
   if(url.pathname==='/abs/api/items/book1')return send(res,200,{id:'book1',mediaType:'book',userMediaProgress:{currentTime:13},media:{duration:22,metadata:{title:'Test book',authorName:'An author'},chapters:[{id:0,start:0,end:22,title:'Chapter one'}],tracks:[0,1].map(i=>({index:i+1,startOffset:i*11,duration:11,contentUrl:'/s/book1/'+i,mimeType:'audio/wav'}))}});
   if(url.pathname.startsWith('/abs/s/book1/')){const range=req.headers.range;res.writeHead(range?206:200,{'Content-Type':'audio/wav',...(range?{'Content-Range':`bytes 0-99/${wav.length}`}:{})});res.end(range?wav.subarray(0,100):wav);return;}
   if(url.pathname==='/abs/api/me/progress/book1'){
     if(progressStatus!==200)return send(res,progressStatus,{error:'Simulated progress failure'});
     if(req.method==='GET')return send(res,200,{currentTime:remoteTime});
     assert.equal(req.method,'PATCH');let body='';for await(const c of req)body+=c;
     const update=JSON.parse(body);assert.equal(update.duration,22);assert.equal(update.progress,update.currentTime/22);
     remoteTime=update.currentTime;res.writeHead(200,{'Content-Type':'text/plain'});return res.end('OK');
   }
   return send(res,404,{error:'No mock route'});
 });
 const absUrl=await listen(abs);
 const worker=http.createServer(async(req,res)=>{
   if(req.url==='/health')return send(res,200,{status:'ok'});
   assert.equal(req.url,'/inference');let size=0,body='';for await(const c of req){size+=c.length;body+=c.toString('latin1');}
   assert.ok(size>30000,'real FFmpeg produces a WAV payload');assert.match(body,/verbose_json/);
   inference++;if(inference===2&&failSecond){failSecond=false;return send(res,500,{error:'Simulated interruption'});}
   return send(res,200,{segments:[{start:0,end:5,text:'A sentence worth keeping.'},{start:5,end:10,text:'Another thought.'}]});
 });
 const workerUrl=await listen(worker);const port=await unusedPort();const base='http://127.0.0.1:'+port;
 async function start(){processHandle=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:folder,ABS_URL:absUrl+'/abs',ABS_TOKEN:'private-test-token',MARGIN_PASSWORD:'test-password',WHISPER_URL:workerUrl,DEMO_MODE:'false'},stdio:['ignore','pipe','pipe'],windowsHide:true});
   let output='';processHandle.stdout.on('data',d=>output+=d);processHandle.stderr.on('data',d=>output+=d);
   for(let i=0;i<100;i++){if(processHandle.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/health')).ok)return;}catch{}await sleep(50);}throw new Error('Server did not start: '+output);
 }
 async function stop(){if(processHandle&&processHandle.exitCode===null){processHandle.kill();await once(processHandle,'exit');}}
 t.after(async()=>{await stop();await Promise.all([new Promise(r=>abs.close(r)),new Promise(r=>worker.close(r))]);if(!path.resolve(folder).startsWith(path.resolve(tmpdir())+path.sep+'margin-test-'))throw new Error('Unexpected temporary directory');await rm(folder,{recursive:true,force:true});});
 async function request(p,body,method){return fetch(base+'/api'+p,{method:method||(body===undefined?'GET':'POST'),headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
 async function login(){const r=await request('/login',{password:'test-password'});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];}
 await start();assert.equal((await request('/books?library=lib1')).status,401);assert.equal((await request('/login',{password:'bad'})).status,401);await login();
 const expectedVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
 assert.equal((await(await request('/status')).json()).version,expectedVersion);
 for(const route of ['/', '/index.html', '/reader']){
   const shell=await fetch(base+route);assert.equal(shell.status,200);assert.equal(shell.headers.get('cache-control'),'no-store','HTML must not keep old frontend bundles after an upgrade');await shell.body.cancel();
 }
 assert.equal((await (await request('/libraries')).json())[0].id,'lib1');
 const list=await(await request('/books?library=lib1')).json();assert.equal(list.books[0].title,'Test book');assert.ok(!JSON.stringify(list).includes('private-test-token'));
 const b=await(await request('/books/book1')).json();assert.equal(b.position,13);assert.equal(b.tracks[1].startOffset,11);assert.equal(b.tracks[1].url,'/api/books/book1/audio/1');assert.equal(b.tracks[0].contentUrl,undefined);
 const audio=await fetch(base+b.tracks[1].url,{headers:{Cookie:cookie,Range:'bytes=0-99'}});assert.equal(audio.status,206);assert.equal((await audio.arrayBuffer()).byteLength,100);
 const denied=await fetch(base+'/api/books/book1/notes',{method:'POST',headers:{Cookie:cookie,Origin:'https://elsewhere.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
 assert.equal((await request('/books/book1/notes',{start:-1,end:2,quote:'Invalid',note:''})).status,400);
 const saved=await(await request('/books/book1/notes',{start:2,end:5,quote:'Saved original passage.',note:'My own idea',color:'green'})).json();assert.equal(saved.length,1);const note=saved[0];
 assert.equal((await request('/books/book1/position',{time:9})).status,200);
 assert.equal(remoteTime,9,'Margin writes the Audiobookshelf account progress');
 assert.equal((await(await request('/books/book1/position')).json()).time,9);
 remoteTime=4;
 assert.equal((await(await request('/books/book1/position')).json()).time,4,'another device can rewind');
 assert.equal((await(await request('/books/book1')).json()).position,4,'reopening uses progress endpoint, not stale item metadata');
 progressStatus=404;assert.equal((await(await request('/books/book1/position')).json()).time,0,'unstarted books have no progress record');
 progressStatus=403;assert.equal((await request('/books/book1/position')).status,502,'permission errors must not become a zero position');
 progressStatus=503;assert.equal((await request('/books/book1/position',{time:12})).status,502,'upstream save failures are visible');
 progressStatus=200;
 assert.equal((await request('/books/book1/position',{time:23})).status,400);
 const edited=await(await request('/books/book1/notes/'+note.id,{note:'Edited idea'},'PATCH')).json();assert.equal(edited[0].note,'Edited idea');
 const exp=await(await request('/books/book1/export')).text();assert.match(exp,/00:00:02/);assert.match(exp,/Saved original passage/);assert.match(exp,/Edited idea/);
 await stop();await start();await login();const restored=await(await request('/books/book1')).json();assert.equal(restored.notes[0].id,note.id);
 assert.equal((await request('/books/book1/captions',{text:'1\n00:00:00,000 --> 00:00:02,000\nAn imported sentence.'})).status,200);
 assert.equal((await(await request('/books/book1')).json()).notes[0].quote,'Saved original passage.');
 if(process.env.FFMPEG_PATH){
   assert.equal((await request('/books/book1/transcribe',{})).status,202);
   async function waitFor(status){for(let i=0;i<150;i++){const r=await(await request('/books/book1/captions')).json();if(r.job?.status===status)return r;if(r.job?.status==='failed'&&status!=='failed')throw new Error(r.job.message);await sleep(100);}throw Error('Job timeout: '+status);}
   const partial=await waitFor('failed');assert.equal(partial.job.progress,.5);assert.equal(partial.cues[0].start,0);assert.equal(inference,2);
   await request('/books/book1/transcribe',{});const completed=await waitFor('done');assert.equal(inference,3,'resume skips completed first track');assert.equal(completed.cues[2].start,11,'second track uses global book timestamps');assert.equal(completed.job.progress,1);
 }else t.diagnostic('FFMPEG_PATH not set: live FFmpeg + mocked inference queue portion not run.');
 const removed=await(await request('/books/book1/notes/'+note.id,{},'DELETE')).json();assert.equal(removed.length,0);
 assert.ok(received.includes('/abs/s/book1/1'),'media URL retains ABS subpath');
});
