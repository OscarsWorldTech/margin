import { useEffect, useRef, useState } from 'react';
import { trackAtPosition } from '@/lib/audio-position';
import { ProgressSync } from '@/lib/progress-sync';
import type { Player } from '@/lib/player';
import { configureNativePlayer, createNativePlayer } from '@/lib/player-native';
import { apiUrl, authHeaders, clearStoredToken, isNativeClient, normalizeServerUrl, resolveServerPath, saveConnection, savedConnection } from '@/lib/server-connection';
import { PlaybackSpeed } from '@/components/playback-speed';
import { PlaybackVolume } from '@/components/playback-volume';
import { applyPlaybackSpeed, normalizeSpeed, savedSpeed, saveSpeedPreference, SPEED_KEY } from '@/lib/playback-speed';
import { version as appVersion } from '../package.json';
import { Headphones, BookOpen, Highlighter, Search, Settings2, LogOut, Play, Pause, RotateCcw, RotateCw, Download, Plus, Check, ArrowLeft, RefreshCw, MessageSquare, X, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Select,SelectTrigger,SelectValue,SelectContent,SelectItem } from '@/components/ui/select';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { Tabs,TabsList,TabsTrigger,TabsContent } from '@/components/ui/tabs';

type Cue={start:number;end:number;text:string};
type Note={id:string;start:number;end:number;quote:string;note:string;color:string;created:string};
type Job={status:string;progress:number;message:string}|null;
type Book={id:string;title:string;author:string;duration:number;cover?:string;status?:string;tracks:{index:number;startOffset:number;duration:number;url:string}[];chapters:{id:number;title:string;start:number;end:number}[];position:number;cues:Cue[];notes:Note[];job:Job};
type Status={authenticated:boolean;demo:boolean;configured:boolean;version?:string};
// A packaged app is served from its own origin, so it addresses the Margin server
// absolutely and authenticates with a bearer token. In the browser the base is an
// empty string and there is no token, so every request is unchanged.
let connection:{base:string;token:string|null}={base:'',token:null};
async function api<T=any>(url:string,body?:unknown,method?:string):Promise<T>{
 const r=await fetch(apiUrl(connection.base,url),{method:method||(body===undefined?'GET':'POST'),headers:{...authHeaders(connection.token),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const result:any=await r.json();if(!r.ok)throw new Error(result.error||'Request failed');return result as T;
}
function time(n:number){n=Math.max(0,Math.floor(n||0));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function activeCue(cues:Cue[],t:number){let lo=0,hi=cues.length-1,found=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(cues[mid].start<=t){found=mid;lo=mid+1;}else hi=mid-1;}return found>=0&&t<cues[found].end?found:-1;}
export default function Home(){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[password,setPassword]=useState('');
 // Only a packaged app asks for a server address; the browser is already served by one.
 const [needsServer,setNeedsServer]=useState(false),[serverInput,setServerInput]=useState('');
 const [libraries,setLibraries]=useState<{id:string;name:string}[]>([]),[library,setLibrary]=useState(''),[books,setBooks]=useState<Book[]>([]),[page,setPage]=useState(0),[total,setTotal]=useState(0),[query,setQuery]=useState('');
 const [view,setView]=useState<'library'|'reader'>('library'),[syncStatus,setSyncStatus]=useState('Progress synced');
 const [book,setBook]=useState<Book|null>(null),[settings,setSettings]=useState(false),[engine,setEngine]=useState(''),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[track,setTrack]=useState(0),[speed,setSpeed]=useState(savedSpeed);
 const [follow,setFollow]=useState(true),[selected,setSelected]=useState<number[]>([]),[draft,setDraft]=useState(''),[color,setColor]=useState('gold'),[captionQuery,setCaptionQuery]=useState(''),[readPage,setReadPage]=useState(0),[offset,setOffset]=useState(0),[editing,setEditing]=useState<Note|null>(null),[editText,setEditText]=useState('');
 const progress=useRef<ProgressSync|null>(null),refreshCurrent=useRef<()=>Promise<void>>(async()=>{}),starting=useRef(false);
 const native=isNativeClient();
 const player=useRef<Player|null>(null);
 // applyVolume writes volume then muted; both forward to the service without seeking.
 const nativeVolume=useRef({_v:1,_m:false,
   get volume(){return this._v;},set volume(v:number){this._v=v;void player.current?.setVolume(v,this._m);},
   get muted(){return this._m;},set muted(m:boolean){this._m=m;void player.current?.setVolume(this._v,m);}});
 const playIntent=useRef(false); const audio=useRef<HTMLAudioElement>(null),seekTo=useRef<number|null>(null),currentBook=useRef<Book|null>(null),currentPosition=useRef(0),loadEpoch=useRef(0);
 currentBook.current=book;currentPosition.current=position;
 const active=activeCue(book?.cues||[],position-offset);
 const chosen=selected.slice().sort((a,b)=>a-b).map(i=>book?.cues[i]).filter(Boolean) as Cue[];
 const quote=chosen.map(c=>c.text).join(' ');
 const filteredCues=(book?.cues||[]).map((c,i)=>({c,i})).filter(({c})=>c.text.toLowerCase().includes(captionQuery.toLowerCase()));
 const visibleCues=filteredCues.slice(readPage*80,(readPage+1)*80);
 const running=book?.job&&['running','queued'].includes(book.job.status);
 async function act(fn:()=>Promise<void>){setError('');setBusy(true);try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{
   if(isNativeClient()){
     const saved=savedConnection();connection={base:saved.base,token:saved.token};
     // Without a server there is nothing to ask for status; show the connection form instead.
     if(!saved.base){setNeedsServer(true);setServerInput('');return;}
   }
   api<Status>('/status').then(setStatus).catch(e=>setError(e.message));
 },[]);
 async function connectTo(address:string){
   const base=normalizeServerUrl(address);
   connection={base,token:connection.base===base?connection.token:null};
   const reached=await api<Status>('/status');
   saveConnection(base,connection.token);setNeedsServer(false);setStatus(reached);
 }
 useEffect(()=>{
   if(!native)return;
   const p=player.current??(player.current=createNativePlayer(path=>resolveServerPath(connection.base,path),connection.token,connection.base));
   // The service is the source of truth: headset, lock screen and call interruptions
   // all change playback without the reader knowing.
   let wasPlaying=false;
   return p.subscribe(s=>{
     if(s.error)setError(s.error);
     currentPosition.current=s.position;setPosition(s.position);setPlaying(s.playing);playIntent.current=s.playing;
     if(s.playing)progress.current?.change(s.position);
     // Record and flush on a real stop, matching the browser's pause handler. Buffering
     // snapshots are not pauses and must not trigger a write each time.
     else if(wasPlaying){progress.current?.change(s.position);void progress.current?.flush();}
     wasPlaying=s.playing;
   });
 },[native]);
 useEffect(()=>{if(status?.authenticated&&status.configured)api('/libraries').then(ls=>{setLibraries(ls);setLibrary(ls[0]?.id||'');}).catch(e=>setError(e.message));},[status]);
 useEffect(()=>{if(!library)return;setBooks([]);setPage(0);const c=new AbortController();api('/books?library='+encodeURIComponent(library)+'&page=0').then(r=>{if(!c.signal.aborted){setBooks(r.books);setTotal(r.total);}}).catch(e=>setError(e.message));return()=>c.abort();},[library]);
 useEffect(()=>{if(!book||!running)return;const bookId=book.id;const timer=setInterval(()=>api('/books/'+bookId+'/captions').then(r=>setBook(b=>b?.id===bookId?{...b,cues:r.cues,job:r.job}:b)).catch(e=>setError(e.message)),3000);return()=>clearInterval(timer);},[book?.id,running]);
 useEffect(()=>{if(follow&&active>=0&&!captionQuery)setReadPage(Math.floor(active/80));},[active,follow,captionQuery]);
 useEffect(()=>{if(view==='reader'&&follow&&active>=0)document.getElementById('cue-'+active)?.scrollIntoView({block:'nearest',behavior:'smooth'});},[active,follow,readPage,view]);
 useEffect(()=>{
   const tick=()=>{if(!currentBook.current)return;if(playIntent.current)void progress.current?.flush();else if(document.visibilityState==='visible')void refreshCurrent.current();};
   const visibility=()=>{if(document.visibilityState==='hidden')void progress.current?.flush();else tick();};
   const leave=()=>{void progress.current?.flush();};
   const timer=setInterval(tick,15000);
   window.addEventListener('focus',tick);window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',visibility);
   return()=>{clearInterval(timer);window.removeEventListener('focus',tick);window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>{if(audio.current)applySpeed(audio.current);},[speed,track,book?.id]);
 function applyNativeSpeed(rate:number){void player.current?.setSpeed(rate);}
 function applySpeed(el:HTMLAudioElement){try{applyPlaybackSpeed(el,speed);}catch{applyPlaybackSpeed(el,1);setSpeed(1);saveSpeedPreference(SPEED_KEY,1);setError('This browser could not use that playback speed. Restored 1×.');}}
 function changeSpeed(value:number){const rate=normalizeSpeed(value);try{if(native)applyNativeSpeed(rate);else if(audio.current)applyPlaybackSpeed(audio.current,rate);setSpeed(rate);saveSpeedPreference(SPEED_KEY,rate);}catch{if(audio.current)applyPlaybackSpeed(audio.current,speed);setError('This browser does not support that playback speed. Choose a lower speed.');}}
 useEffect(()=>{const handle=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.closest('input,textarea,button,a,select,[role=dialog],[role=combobox],[role=slider],[role=checkbox],[role=tab]')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'&&book){e.preventDefault();toggle();}if(e.key.toLowerCase()==='h'&&active>=0){e.preventDefault();setView('reader');setSelected([active]);setNotice('Current sentence selected. Add a note or save the highlight.');}};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);},[book,active,playing,position]);
 useEffect(()=>{const context=(document as any).modelContext;if(!context?.registerTool)return;const life=new AbortController();Promise.resolve(context.registerTool({name:'read_current_audiobook',description:'Read the current audiobook title, playback position, and saved annotations.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:(input:any)=>{if(!input||Object.keys(input).length)throw new Error('Expected an empty object');const b=currentBook.current;return b?{title:b.title,position:currentPosition.current,notes:b.notes}:{book:null};}},{signal:life.signal})).catch(()=>{});return()=>life.abort();},[]);
 async function openBook(id:string){
   if(currentBook.current?.id===id){setView('reader');return;}
   await act(async()=>{
     const epoch=++loadEpoch.current;playIntent.current=false;audio.current?.pause();
     if(progress.current&&!await progress.current.flush())throw Error('Progress has not synced. Retry before switching books.');
     const b=await api<Book>('/books/'+id);if(epoch!==loadEpoch.current)return;
     const coordinator=new ProgressSync(b.position,{
       read:()=>api('/books/'+id+'/position'),
       write:async t=>{const r=await fetch(apiUrl(connection.base,'/books/'+id+'/position'),{method:'POST',headers:{...authHeaders(connection.token),'Content-Type':'application/json'},body:JSON.stringify({time:t}),keepalive:true});if(!r.ok)throw Error('Progress sync failed');},
       status:message=>{if(progress.current===coordinator)setSyncStatus(message);}
     });
     progress.current=coordinator;setSyncStatus('Progress synced');currentBook.current=b;currentPosition.current=b.position;
     if(native)await player.current?.load({id:b.id,title:b.title,author:b.author,duration:b.duration,tracks:b.tracks.map(t=>({url:t.url,startOffset:t.startOffset,duration:t.duration}))},b.position);
     setBook(b);setPosition(b.position);setTrack(trackAtPosition(b.tracks,b.position));
     seekTo.current=b.position;setPlaying(false);setView('reader');setSelected([]);setDraft('');setOffset(0);setCaptionQuery('');setReadPage(0);
   });
 }
 function seek(t:number,local=true){
   if(!book)return;
   const target=Math.max(0,Math.min(t,book.duration));
   const ti=trackAtPosition(book.tracks,target);
   currentPosition.current=target;setPosition(target);seekTo.current=target;
   if(local)progress.current?.change(target);
   if(native){seekTo.current=null;void player.current?.seek(target);}
   else if(ti===track&&audio.current&&audio.current.readyState>=1){audio.current.currentTime=target-book.tracks[ti].startOffset;seekTo.current=null;}else setTrack(ti);
   if(local&&!playIntent.current)void progress.current?.flush();
 }
 refreshCurrent.current=async()=>{
   const coordinator=progress.current;if(!coordinator||playIntent.current||starting.current)return;
   const t=await coordinator.refresh(()=>progress.current===coordinator&&!playIntent.current&&!starting.current);
   if(t!==null&&progress.current===coordinator&&!playIntent.current&&Math.abs(t-currentPosition.current)>.05)seek(t,false);
 };
 async function toggle(){
   if(native){
     if(starting.current||!player.current)return;
     if(playing){playIntent.current=false;await player.current.pause();return;}
     playIntent.current=true;await player.current.play();return;
   }
   const el=audio.current;if(!el||starting.current)return;
   if(!el.paused){playIntent.current=false;el.pause();return;}
   starting.current=true;const epoch=loadEpoch.current;
   const coordinator=progress.current;
   try{
     await coordinator?.reading;
     const t=await coordinator?.refresh(()=>progress.current===coordinator&&epoch===loadEpoch.current&&!playIntent.current);
     if(progress.current!==coordinator||epoch!==loadEpoch.current)return;
     if(t!==null&&t!==undefined)seek(t,false);
     if((t??currentPosition.current)>=book!.duration)seek(0);
     playIntent.current=true;
     if(seekTo.current===null)await el.play();
   }catch{playIntent.current=false;setError('Audio could not play. Check the connection and browser support for this audio format.');}
   finally{starting.current=false;}
 }
 function replay(cue:Cue){playIntent.current=true;seek(cue.start+offset);if(seekTo.current===null)void audio.current?.play().catch(()=>{playIntent.current=false;setError('Audio could not play.');});}
 async function saveNote(){if(!book||!chosen.length)return;await act(async()=>{const notes=await api<Note[]>('/books/'+book.id+'/notes',{start:Math.max(0,chosen[0].start+offset),end:Math.min(book.duration,chosen[chosen.length-1].end+offset),quote,note:draft,color});setBook({...book,notes});setSelected([]);setDraft('');setNotice('Highlight saved.');});}
 function selectCue(i:number){setSelected(s=>s.includes(i)?s.filter(v=>v!==i):[...s,i]);}
 function captureSelection(){const s=window.getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;const range=s.getRangeAt(0);const indexes=[...document.querySelectorAll('[data-cue]')].filter(el=>range.intersectsNode(el)).map(el=>Number(el.getAttribute('data-cue')));if(indexes.length){setSelected(indexes);setFollow(false);}}
 async function transcribe(){if(!book)return;await act(async()=>{const j=await api<Job>('/books/'+book.id+'/transcribe',{});setBook({...book,job:j});});}
 const libraryView=<section className="library-view"><div className="section-heading"><div><div className="eyebrow">YOUR LISTENING SHELF</div><h1>Open a book. Keep a thought.</h1></div><Button variant="outline" disabled={busy} onClick={()=>act(async()=>{const r=await api('/books?library='+library+'&page=0');setBooks(r.books);setTotal(r.total);setPage(0);})}><RefreshCw/> Refresh</Button></div><div className="library-controls"><label className="search-box"><Search/><Input aria-label="Search loaded books" placeholder="Search loaded books by title or author" value={query} onChange={e=>setQuery(e.target.value)}/></label><Select value={library} onValueChange={v=>setLibrary(v||'')}><SelectTrigger aria-label="Audiobookshelf library"><SelectValue>{libraries.find(l=>l.id===library)?.name||'Choose a library'}</SelectValue></SelectTrigger><SelectContent>{libraries.map(l=><SelectItem value={l.id} key={l.id}>{l.name}</SelectItem>)}</SelectContent></Select></div><div className="book-grid">{books.filter(b=>(b.title+' '+b.author).toLowerCase().includes(query.toLowerCase())).map(b=><button className="book-card" key={b.id} disabled={busy} onClick={()=>openBook(b.id)}><div className="book-cover">{b.cover&&b.id!=='demo'?<img src={resolveServerPath(connection.base,b.cover)} alt="" onError={e=>{e.currentTarget.style.display='none';}}/>:<BookOpen/>}<span>{b.id==='demo'?'SAMPLE RECORDING':'AUDIOBOOK'}</span></div><div className="book-info"><h2>{b.title}</h2><p>{b.author}</p><div className="book-meta"><span>{time(b.duration)}</span><span>{b.status==='done'?'Captions ready':b.status||'Generate captions'}</span></div></div><span className="open-book">Open book <Play/></span></button>)}</div>{!books.length&&<div className="empty"><BookOpen/><h2>No audiobooks loaded</h2><p>Choose a library or refresh after adding books in Audiobookshelf.</p></div>}{books.length<total&&<Button variant="outline" onClick={()=>act(async()=>{const r=await api('/books?library='+library+'&page='+(page+1));setBooks([...books,...r.books]);setPage(page+1);})}>Load more books</Button>}</section>;
 return <main className="shell"><header className="topbar"><a className="brand" href="/" onClick={e=>{e.preventDefault();setView('library');}}><Headphones/> margin<span>Audio, worth keeping.</span></a><div className="top-actions"><span className="badge" title="Margin version">v{appVersion}</span>{status?.demo&&<span className="badge">Sample mode</span>}{status?.authenticated&&<><Button variant="ghost" aria-label="Connection settings" onClick={()=>setSettings(true)}><Settings2/></Button>{!status.demo&&<Button variant="ghost" aria-label="Sign out" onClick={()=>act(async()=>{playIntent.current=false;audio.current?.pause();if(progress.current&&!await progress.current.flush())throw Error('Progress has not synced. Retry before signing out.');await api('/logout',{});connection={...connection,token:null};clearStoredToken();void configureNativePlayer(null,connection.base);progress.current=null;setBook(null);setView('library');setStatus(await api('/status'));})}><LogOut/></Button>}</>}</div></header>
 {error&&<div role="alert" className="banner error">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X/></button></div>}
 {notice&&<div role="status" className="banner notice">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice('')}><X/></button></div>}
 {needsServer?<section className="welcome"><div className="eyebrow">AUDIOBOOKSHELF COMPANION</div><h1>Connect to<br/>your Margin server.</h1><p>Your library, notes and captions stay on that server. This app only reads them.</p><form className="connect-card" onSubmit={e=>{e.preventDefault();void act(async()=>{await connectTo(serverInput);});}}><Link2/><h2>Where is Margin running?</h2><label htmlFor="server">Server address</label><Input id="server" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="margin.example.com" required value={serverInput} onChange={e=>setServerInput(e.target.value)}/><small>An address without a scheme is treated as https. A plain http:// server is reachable only from a debug build.</small><Button type="submit" disabled={busy}>{busy?'Connecting…':'Connect'}</Button></form></section>:!status?<section className="welcome"><h1>Opening your listening space…</h1></section>:!status.authenticated?<section className="welcome"><div className="eyebrow">AUDIOBOOKSHELF COMPANION</div><h1>Listen closely.<br/>Keep what stays with you.</h1><p>Read along with your audiobooks. Mark a sentence, add a thought, and return to the moment.</p><form className="connect-card" onSubmit={e=>{e.preventDefault();void act(async()=>{const signIn=await api<{token?:string}>('/login',isNativeClient()?{password,client:'native'}:{password});if(signIn.token){connection={...connection,token:signIn.token};saveConnection(connection.base,signIn.token);void configureNativePlayer(signIn.token,connection.base);}setPassword('');setStatus(await api('/status'));});}}><Link2/><h2>Your private listening space</h2><label htmlFor="password">Margin password</label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/><Button type="submit" disabled={busy}>{busy?'Signing in…':'Open my library'}</Button></form></section>:!status.configured?<section className="welcome"><div className="connect-card"><Link2/><h1>Connect Audiobookshelf</h1><p>Set your server address and API token in Margin’s configuration, then restart the app. The setup guide included with the app walks through this step.</p><Button onClick={()=>act(async()=>setStatus(await api('/status')))}>Check connection</Button></div></section>:!book||view==='library'?libraryView:<>
 <div className="reader-heading"><Button variant="ghost" onClick={()=>setView('library')}><ArrowLeft/> Library</Button><div><h1>{book.title}</h1><span>{book.author}</span></div><span className="reader-tag">{status.demo?'Prepared sample captions':'Machine-generated captions'}</span></div>
 <div className="reading-layout"><section className="transcript-panel"><Tabs defaultValue="transcript"><div className="reading-toolbar"><TabsList variant="line"><TabsTrigger value="transcript">Read along</TabsTrigger><TabsTrigger value="chapters">Chapters</TabsTrigger></TabsList><Button variant={follow?'secondary':'ghost'} onClick={()=>{if(!follow)setCaptionQuery('');setFollow(!follow);}}>{follow&&<Check/>} Follow audio</Button></div><TabsContent value="transcript"><div className="caption-tools"><label className="search-box"><Search/><Input aria-label="Search captions" placeholder="Find a passage…" value={captionQuery} onChange={e=>{setCaptionQuery(e.target.value);setReadPage(0);setFollow(false);}}/></label><Button variant="outline" disabled={busy||status.demo||Boolean(running)} onClick={transcribe}>{book.job?.status==='paused'||book.job?.status==='failed'?'Resume captions':book.cues.length?'Captions ready':'Generate captions'}</Button><label className="file-button">Import SRT / VTT<input type="file" accept=".srt,.vtt" disabled={status.demo||Boolean(running)} onChange={e=>{const f=e.target.files?.[0];if(f)void act(async()=>{const r=await api('/books/'+book.id+'/captions',{text:await f.text()});setBook({...book,cues:r.cues,job:null});});e.target.value='';}}/></label></div>
 {book.job&&book.job.status!=='done'&&<div className="job"><div><span>{book.job.message||'Waiting for transcription'}</span><strong>{Math.round(book.job.progress*100)}%</strong></div><progress max="1" value={book.job.progress}/>{running&&<Button variant="ghost" onClick={()=>act(async()=>{const r=await api('/books/'+book.id+'/pause',{});setNotice(r.message);})}>Pause after this section</Button>}</div>}
 <div className="passage-pages"><Button variant="ghost" disabled={readPage===0} onClick={()=>{setReadPage(readPage-1);setFollow(false);}}>Earlier passages</Button><span>{filteredCues.length ? (readPage*80+1)+"–"+Math.min((readPage+1)*80,filteredCues.length)+" of "+filteredCues.length : "No matching passages"}</span><Button variant="ghost" disabled={(readPage+1)*80>=filteredCues.length} onClick={()=>{setReadPage(readPage+1);setFollow(false);}}>Later passages</Button></div><div className="transcript" onMouseUp={captureSelection}>{book.cues.length?visibleCues.map(({c,i})=>{const saved=book.notes.some(n=>n.quote.includes(c.text)&&c.start>=n.start-offset-.1&&c.end<=n.end-offset+.1);return <div key={i} id={'cue-'+i} className={'cue '+(active===i?'active ':'')+(selected.includes(i)?'selected ':'')+(saved?'saved':'')}><button className="cue-time" aria-label={'Play from '+time(c.start+offset)} onClick={()=>replay(c)}>{active===i?<Play/>:time(c.start+offset)}</button><p data-cue={i}>{c.text}</p><Checkbox aria-label={'Select sentence at '+time(c.start)} checked={selected.includes(i)} onCheckedChange={()=>selectCue(i)}/></div>;}):<div className="empty"><Headphones/><h2>Your book has a voice.<br/>Give it a margin.</h2><p>Generate captions from the recording to read along and save passages. You can keep listening while it processes.</p><Button disabled={busy||Boolean(running)||status.demo} onClick={transcribe}>Generate captions</Button></div>}</div></TabsContent>
 <TabsContent value="chapters"><div className="chapter-list">{book.chapters.length?book.chapters.map((c,i)=><button key={c.id??i} onClick={()=>seek(c.start)}><span>{String(i+1).padStart(2,'0')}</span><strong>{c.title}</strong><span>{time(c.start)}</span></button>):<p>No chapter markers are available for this book.</p>}</div></TabsContent></Tabs></section>
 <aside className="notes-panel"><div className="notes-title"><h2><Highlighter/> My margin <span>{book.notes.length}</span></h2><a href={resolveServerPath(connection.base,'/api/books/'+book.id+'/export')} download title="Export notes as Markdown"><Download/></a></div>{chosen.length>0?<div className="composer"><div className="eyebrow">{chosen.length} SENTENCE{chosen.length>1?'S':''} SELECTED</div><blockquote>{quote}</blockquote><Textarea aria-label="Your note" placeholder="What do you want to remember?" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={10000}/><div className="composer-actions"><Select value={color} onValueChange={v=>setColor(v||'gold')}><SelectTrigger aria-label="Highlight color"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="green">Green</SelectItem><SelectItem value="blue">Blue</SelectItem></SelectContent></Select><Button disabled={busy} onClick={saveNote}><Plus/> Save highlight</Button><Button variant="ghost" aria-label="Clear selection" onClick={()=>setSelected([])}><X/></Button></div></div>:<div className="note-hint"><MessageSquare/><p>Select sentences using the checkboxes, or press <kbd>H</kbd> to capture the one playing.</p></div>}
 <div className="notes-list">{book.notes.map(n=><article className={'note '+n.color} key={n.id}><button className="note-time" onClick={()=>{seek(n.start);}}>{time(n.start)} ↗</button><blockquote>{n.quote}</blockquote>{n.note&&<p>{n.note}</p>}<div className="note-actions"><Button variant="ghost" onClick={()=>{setEditing(n);setEditText(n.note);}}>Edit note</Button><Button variant="ghost" onClick={()=>act(async()=>{const previous=book.notes;const notes=await api<Note[]>('/books/'+book.id+'/notes/'+n.id,{},'DELETE');setBook({...book,notes});setNotice('Highlight removed.');void previous;})}>Remove</Button></div></article>)}</div>{book.notes.length>0&&<a className="json-export" href={resolveServerPath(connection.base,'/api/books/'+book.id+'/export?format=json')} download>Export as JSON</a>}</aside></div>
 </>}
 {status?.authenticated&&book&&<footer className="player">{!native&&<audio ref={audio} src={book.tracks[track]?resolveServerPath(connection.base,book.tracks[track].url):undefined} preload="metadata" onLoadedMetadata={()=>{const a=audio.current!;applySpeed(a);if(seekTo.current!==null){a.currentTime=Math.max(0,seekTo.current-book.tracks[track].startOffset);seekTo.current=null;}if(playIntent.current)void a.play().catch(()=>{playIntent.current=false;setPlaying(false);setError('Press play to start the audio.');});}} onTimeUpdate={()=>{const a=audio.current;if(a&&seekTo.current===null){const t=book.tracks[track].startOffset+a.currentTime;currentPosition.current=t;setPosition(t);if(!a.paused)progress.current?.change(t);}}} onPlay={()=>{playIntent.current=true;setPlaying(true);}} onPause={()=>{if(seekTo.current!==null||audio.current?.ended)return;playIntent.current=false;setPlaying(false);if(audio.current){const t=book.tracks[track].startOffset+audio.current.currentTime;currentPosition.current=t;setPosition(t);progress.current?.change(t);}void progress.current?.flush();}} onError={()=>setError('Unable to load this audio track. Check Audiobookshelf access and the audio format.')} onEnded={()=>{if(track+1<book.tracks.length){seekTo.current=book.tracks[track+1].startOffset;setTrack(track+1);playIntent.current=true;setPlaying(true);}else{playIntent.current=false;setPlaying(false);currentPosition.current=book.duration;setPosition(book.duration);progress.current?.change(book.duration);void progress.current?.flush();}}}/>}
 <div className="now-playing"><button onClick={()=>setView('reader')} title="Return to read along"><strong>{book.title}</strong><span>Read along ↗</span></button><small role="status">{status.demo?'Sample progress':syncStatus}</small></div><div className="transport"><Button variant="ghost" aria-label="Rewind 15 seconds" onClick={()=>seek(position-15)}><RotateCcw/><small>15</small></Button><Button className="play-button" aria-label={playing?'Pause':'Play'} onClick={toggle}>{playing?<Pause/>:<Play/>}</Button><Button variant="ghost" aria-label="Forward 30 seconds" onClick={()=>seek(position+30)}><RotateCw/><small>30</small></Button></div><div className="scrubber"><div><span>{time(position)}</span><span>{time(book.duration)}</span></div><Slider aria-label="Playback position" min={0} max={book.duration||1} step={.1} value={[position]} onValueChange={v=>seek(Array.isArray(v)?v[0]:v)}/></div><PlaybackSpeed speed={speed} onChange={changeSpeed}/><PlaybackVolume audio={native?nativeVolume:audio}/><Button variant="outline" disabled={active<0} onClick={()=>{setView('reader');setSelected([active]);}}><Highlighter/> Save sentence</Button></footer>}
 <Dialog open={settings} onOpenChange={setSettings}><DialogContent className="settings-dialog"><DialogTitle>Connections & timing</DialogTitle><p>Margin v{appVersion} · Server {status?.version?'v'+status.version:'version unavailable'}</p><DialogDescription>Audio and listening progress connect to Audiobookshelf. Your annotations are saved in Margin.</DialogDescription><p>{status?.demo?'Sample mode uses a public-domain speech excerpt and prepared captions. No Audiobookshelf server or GPU is connected.':'Audiobookshelf credentials are held on the server. Update the .env configuration to change them.'}</p><Button variant="outline" onClick={()=>act(async()=>{const r=await api('/engine');setEngine(r.message);})}>Check transcription engine</Button>{engine&&<p role="status">{engine}</p>}{isNativeClient()&&<Button variant="outline" onClick={()=>{setSettings(false);setServerInput(connection.base);setNeedsServer(true);}}>Change server</Button>}{book&&!status?.demo&&<div className="sync-settings"><p>Progress follows the Audiobookshelf account that owns your configured API token. Updates are sent while listening and when you pause. Paused playback checks for changes from other devices.</p><p role="status">{syncStatus}</p><Button variant="outline" onClick={()=>act(async()=>{if(playIntent.current)await progress.current?.flush();else await refreshCurrent.current();})}>Sync progress now</Button></div>}{book&&<label>Caption delay (seconds)<Input type="number" step=".1" min="-120" max="120" value={offset} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))setOffset(Math.max(-120,Math.min(120,n)));}}/><small>Positive values show captions later. Applies to this listening session. Sentence timing is approximate.</small></label>}</DialogContent></Dialog>
 <Dialog open={Boolean(editing)} onOpenChange={o=>{if(!o)setEditing(null);}}><DialogContent><DialogTitle>Edit your note</DialogTitle><DialogDescription>The saved passage and timestamp stay attached.</DialogDescription><Textarea aria-label="Edit note" maxLength={10000} value={editText} onChange={e=>setEditText(e.target.value)}/><Button disabled={busy} onClick={()=>act(async()=>{if(!book||!editing)return;const notes=await api<Note[]>('/books/'+book.id+'/notes/'+editing.id,{note:editText},'PATCH');setBook({...book,notes});setEditing(null);})}>Save changes</Button></DialogContent></Dialog>
 </main>;
}
