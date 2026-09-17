import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {Readalong} from '@/components/storyteller-import';

export type Alignment={ebook:string;name:string;status:string;progress:number;message:string}|null;
type Library={configured:boolean;scanned:boolean;books:{id:string;name:string}[]};
type Preview={id:string;name:string;title:string;author:string;sentences:number;sample:string[]};
type Result=Readalong&{summary:{total:number;matched:number;missed:number;coverage:number;unmatchedExamples:string[];timing:string}};
type Props={bookId:string;title:string;demo:boolean;initial:Alignment;api:<T=any>(path:string,body?:unknown,method?:string)=>Promise<T>;onActivated:(readalong:Readalong)=>void;onSeek:(time:number)=>void;onRefresh:()=>Promise<void>};
const working=(job:Alignment)=>Boolean(job&&['waiting','queued','running'].includes(job.status));
const normalized=(text:string)=>text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export function EbookAlignment({bookId,title,demo,initial,api,onActivated,onSeek,onRefresh}:Props){
  const [open,setOpen]=useState(false),[job,setJob]=useState<Alignment>(initial),[library,setLibrary]=useState<Library|null>(null),[query,setQuery]=useState(title),[shown,setShown]=useState(100),[preview,setPreview]=useState<Preview|null>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const active=working(job),base='/books/'+bookId+'/alignment';
  async function act(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
  useEffect(()=>{
    if(!active)return;
    let cancelled=false,inFlight=false;
    const timer=setInterval(async()=>{
      if(inFlight)return;inFlight=true;
      try{const next=await api<Alignment>(base);if(!cancelled){setJob(next);if(!working(next))await onRefresh();}}
      catch(e){if(!cancelled)setError((e as Error).message);}finally{inFlight=false;}
    },3000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[active,base,api,onRefresh]);
  async function pair(){setOpen(true);setResult(null);setConfirmed(false);await act(async()=>setLibrary(await api<Library>('/ebooks')));}
  async function start(ebook:string){await act(async()=>{const next=await api<Alignment>(base,{ebook});if(!alive.current)return;setJob(next);setOpen(false);setPreview(null);await onRefresh();});}
  async function review(){setConfirmed(false);setPreview(null);setOpen(true);await act(async()=>setResult(await api<Result>(base+'/result')));}
  const terms=normalized(query).split(' ').filter(Boolean);
  const matches=(library?.books||[]).map(book=>({...book,score:terms.filter(term=>normalized(book.name).includes(term)).length})).filter(book=>!terms.length||book.score>0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  const samples=result?[...new Set([0,1,Math.floor(result.cues.length/2),result.cues.length-1])].filter(i=>i<result.cues.length).map(i=>result.cues[i]):[];
  return <div className="ebook-alignment">
    <Button variant="outline" disabled={demo||busy||active} onClick={()=>void pair()}>Pair ebook from folder</Button>
    {active&&<span role="status">{job?.status==='waiting'?'Preparing audio': 'Aligning book'} · {Math.round((job?.progress||0)*100)}% · {job?.message}</span>}
    {job?.status==='review'&&<Button variant="secondary" disabled={busy} onClick={()=>void review()}>Review aligned text</Button>}
    {job&&['paused','failed'].includes(job.status)&&<><span>{job.message}</span><Button variant="outline" disabled={busy} onClick={()=>void start(job.ebook)}>Resume ebook alignment</Button></>}
    {error&&!open&&<span role="alert">{error}</span>}
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="readalong-dialog">
      <DialogTitle>{result?'Review aligned book text':'Pair an ebook with this audiobook'}</DialogTitle>
      <DialogDescription>{title} · {result?'Check the wording and playback before using these passages.':'Choose the same edition from your mounted ebook folder. Storyteller is not required.'}</DialogDescription>
      {error&&<p role="alert" className="readalong-error">{error}</p>}
      {busy&&<p role="status">Working…</p>}
      {result?<>
        <p><strong>{result.summary.matched.toLocaleString()} of {result.summary.total.toLocaleString()} passages matched ({result.summary.coverage}%).</strong> {result.summary.missed} passages could not be matched reliably and will be omitted.</p>
        <p>Timings are approximate, based on caption segments. Matching text does not prove this is the same edition. Low coverage or drifting timing can mean a different recording, omitted chapters, or transcription errors.</p>
        <div className="readalong-mapping">{samples.map((cue,i)=><section key={i}><blockquote>{cue.text}</blockquote><Button variant="outline" disabled={busy} onClick={()=>onSeek(cue.start)}>Listen at {Math.floor(cue.start/60)}:{String(Math.floor(cue.start)%60).padStart(2,'0')}</Button></section>)}</div>
        {!!result.summary.unmatchedExamples.length&&<details><summary>Examples of unmatched text</summary>{result.summary.unmatchedExamples.map((text,i)=><p key={i}>{text}</p>)}</details>}
        <label className="readalong-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I checked the passages against the recording and want to use this alignment.</label>
        <p>This replaces any previously activated book text. Your saved notes and audio captions stay intact.</p>
        <Button disabled={busy||!confirmed} onClick={()=>void act(async()=>{const readalong=await api<Readalong>(base+'/accept',{});if(!alive.current)return;onActivated(readalong);setJob(job?{...job,status:'done'}:null);setOpen(false);})}>Use aligned book text</Button>
      </>:<>
        {library&&!library.configured?<p>Mount your EPUB folder read-only into the Margin container and set EBOOK_DIR to that mount, then restart Margin. The “Ebook folder and alignment” guide in the repository has the setup steps.</p>:<>
          <Button variant="outline" disabled={busy} onClick={()=>void act(async()=>{setPreview(null);setConfirmed(false);setLibrary(await api<Library>('/ebooks/scan',{}));})}>Scan ebook folder</Button>
          <label>Find an EPUB<Input placeholder="Title, author or filename" value={query} onChange={e=>{setQuery(e.target.value);setShown(100);}}/></label>
          <small>Suggestions use filenames. Check the ebook's title and sample text before pairing.</small>
          <div className="ebook-files">{matches.slice(0,shown).map(book=><Button variant="outline" key={book.id} disabled={busy} onClick={()=>void act(async()=>{setPreview(null);setConfirmed(false);setPreview(await api<Preview>('/ebooks/'+book.id));})}>{book.name}</Button>)}</div>
          {matches.length>shown&&<Button variant="ghost" onClick={()=>setShown(shown+100)}>Show more files</Button>}
          {library?.scanned&&!matches.length&&<p>No matching EPUBs. Clear the search or check the mounted folder, then scan again.</p>}
          {!library?.scanned&&<p>Scan to find EPUBs. Margin does not modify files in the ebook folder.</p>}
          {preview&&<><h3>{preview.title}</h3><p>{preview.author} · {preview.sentences.toLocaleString()} passages</p><blockquote className="ebook-sample">{preview.sample.join(' ')}</blockquote><p>Margin will reuse completed captions, or generate/resume them with your configured Whisper engine before matching this ebook. Progress is saved on the server; you can leave the page.</p><label className="readalong-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> This ebook matches the audiobook edition.</label><Button disabled={busy||!confirmed||active} onClick={()=>void start(preview.id)}>Align this ebook</Button></>}
        </>}
      </>}
    </DialogContent></Dialog>
  </div>;
}
