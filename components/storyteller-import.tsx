import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';

export type Readalong={title:string;cues:{start:number;end:number;text:string;anchor:string}[]};
type Parsed={title:string;cues:{start:number;end:number;text:string;anchor:string;source:string}[];sources:{id:string;end:number}[];skipped:number};
type Props={title:string;duration:number;tracks:{startOffset:number;duration:number}[];chapters:{title:string;start:number;end:number}[];disabled:boolean;existing:boolean;onSave:(value:Readalong)=>Promise<void>;onSeek:(time:number)=>void};
const stamp=(n:number)=>`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(Math.floor(n)%60).padStart(2,'0')}`;

export function StorytellerImport({title,duration,tracks,chapters,disabled,existing,onSave,onSeek}:Props){
  const [open,setOpen]=useState(false),[parsed,setParsed]=useState<Parsed|null>(null),[offsets,setOffsets]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
  async function select(file:File){
    setBusy(true);setError('');setParsed(null);setConfirmed(false);
    try{
      const {readStoryteller}=await import('@/lib/storyteller.mjs');
      const result=await readStoryteller(file);setParsed(result);
      // Suggestions only: track count/duration cannot establish edition identity.
      setOffsets(Object.fromEntries(result.sources.map((s:{id:string},i:number)=>[s.id,result.sources.length===tracks.length?String(tracks[i].startOffset):result.sources.length===chapters.length?String(chapters[i].start):result.sources.length===1?'0':''])));
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function save(){
    if(!parsed)return;setBusy(true);setError('');
    try{const {mapStoryteller}=await import('@/lib/storyteller.mjs');await onSave(mapStoryteller(parsed,offsets,duration));setOpen(false);setParsed(null);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><Button variant="outline" disabled={disabled} onClick={()=>{setError('');setOpen(true);}}>Import Storyteller EPUB</Button>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="readalong-dialog">
      <DialogTitle>Import a readaloud book</DialogTitle>
      <DialogDescription>Use an aligned EPUB exported by Storyteller with the same audio edition as {title}. Margin keeps playing the Audiobookshelf recording.</DialogDescription>
      <label className="readalong-file">Aligned EPUB<Input aria-label="Aligned EPUB" type="file" accept=".epub,application/epub+zip" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void select(file);e.target.value='';}}/></label>
      {busy&&<p role="status">{parsed?'Saving passages…':'Reading text and timing files…'}</p>}
      {error&&<p role="alert" className="readalong-error">{error}</p>}
      {parsed&&<>
        <p><strong>{parsed.title}</strong> · {parsed.cues.length.toLocaleString()} passages · {parsed.sources.length} audio files</p>
        {parsed.skipped>0&&<p>{parsed.skipped} ebook sections have no audio timings and will not appear.</p>}
        <p>Set where each EPUB audio file begins on the full audiobook timeline, in seconds. Suggested times are not verified. Different chapter splits need manual mapping; do not add up the last passage times, which may omit silence.</p>
        <details><summary>Audiobookshelf track and chapter starting times</summary><ol>{tracks.map((t,i)=><li key={i}>Track {i+1}: {t.startOffset} seconds ({stamp(t.startOffset)}) · {t.duration.toFixed(1)} seconds long</li>)}</ol>{chapters.length>0&&<ol>{chapters.map((c,i)=><li key={i}>{c.title}: {c.start} seconds ({stamp(c.start)})</li>)}</ol>}</details>
        <div className="readalong-mapping">{parsed.sources.map((source,i)=>{
          const first=parsed.cues.find(c=>c.source===source.id)!;
          const offset=offsets[source.id];const target=Number(offset)+first.start;
          return <section key={source.id}><strong>{i+1}. {source.id.split('/').pop()}</strong><small>Last timed passage ends at {stamp(source.end)} in this file</small><label>Starts in audiobook (seconds)<Input type="number" min="0" max={duration} step="0.001" value={offset??''} disabled={busy} onChange={e=>{setOffsets({...offsets,[source.id]:e.target.value});setConfirmed(false);}}/></label><blockquote>{first.text}</blockquote><Button variant="outline" disabled={busy||!offset?.trim()||!Number.isFinite(target)||target<0||target>=duration} onClick={()=>onSeek(target)}>Listen to first passage</Button></section>;
        })}</div>
        <label className="readalong-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> I checked that this is the same recording and the passage timings match.</label>
        <p>{existing?'This replaces the previously imported book text. ':''}Saved notes and generated captions are kept. Only timed passages are imported; ebook layout and images are not included.</p>
        <Button disabled={busy||!confirmed} onClick={()=>void save()}>Save book text</Button>
      </>}
    </DialogContent></Dialog>
  </>;
}
