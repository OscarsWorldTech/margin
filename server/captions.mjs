export function number(value, min=0, max=Infinity) {
  const n=Number(value); if(!Number.isFinite(n)||n<min||n>max) throw Object.assign(new Error('Invalid number'),{status:400}); return n;
}
export function parseTime(value) {
  const p=String(value).trim().replace(',', '.').split(':').map(Number);
  if(p.length<2||p.length>3||p.some(n=>!Number.isFinite(n)||n<0)) throw Object.assign(new Error('Invalid caption timestamp'),{status:400});
  return p.reduce((a,b)=>a*60+b,0);
}
export function parseCaptions(text) {
  const cues=[];
  for(const block of text.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/)) {
    const lines=block.trim().split('\n');
    if(/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const i=lines.findIndex(l=>l.includes('-->')); if(i<0) continue;
    const [a,b]=lines[i].split('-->'); const start=parseTime(a), end=parseTime(b.trim().split(/\s/)[0]);
    const content=lines.slice(i+1).join(' ').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
    if(end>start&&content) cues.push({start,end,text:content});
  }
  if(!cues.length) throw Object.assign(new Error('No timed captions found. Use an SRT or VTT file.'),{status:400});
  return cues.sort((a,b)=>a.start-b.start);
}
export function whisperCues(result) {
  if(Array.isArray(result.segments)) return result.segments.map(s=>({start:number(s.start),end:number(s.end),text:String(s.text||'').trim()})).filter(s=>s.end>s.start&&s.text);
  if(Array.isArray(result.transcription)) return result.transcription.map(s=>({start:s.offsets?number(s.offsets.from)/1000:parseTime(s.timestamps.from),end:s.offsets?number(s.offsets.to)/1000:parseTime(s.timestamps.to),text:String(s.text||'').trim()})).filter(s=>s.end>s.start&&s.text);
  throw new Error('Transcription engine returned no timestamps. Use whisper.cpp verbose_json output.');
}
// Build selectable sentences. Splits inside an ASR segment use proportional timing;
// they are estimates, not forced-aligned word timestamps.
export function sentences(cues) {
  const output=[]; let pending=null;
  for(const cue of cues) {
    const pieces=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(cue.text)];
    for(const {segment,index} of pieces) {
      const start=cue.start+(cue.end-cue.start)*index/cue.text.length;
      const end=cue.start+(cue.end-cue.start)*(index+segment.length)/cue.text.length;
      if(pending && start-pending.end>2) {output.push(pending);pending=null;}
      pending=pending?{...pending,end,text:pending.text+' '+segment.trim()}:{start,end,text:segment.trim()};
      if(/[.!?]["'”’)]*$/.test(segment.trim())||pending.text.length>600){output.push(pending);pending=null;}
    }
  }
  if(pending) output.push(pending);
  return output;
}
export function clock(seconds) { const n=Math.max(0,Math.floor(seconds));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(v=>String(v).padStart(2,'0')).join(':'); }
export function markdown(title,notes) {return '# '+String(title).replace(/[\r\n]/g,' ')+'\n\n'+notes.map(n=>'## '+clock(n.start)+'\n\n> '+n.quote.replace(/\n/g,'\n> ')+'\n\n'+n.note+'\n').join('\n');}
export function byteRange(header,size) {
  if(!header) return {start:0,end:size-1,partial:false};
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);if(!m||(!m[1]&&!m[2]))throw new Error('Invalid range');
  const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  const end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
  if(start>=size||end<start)throw new Error('Unsatisfiable range');return {start,end,partial:true};
}
