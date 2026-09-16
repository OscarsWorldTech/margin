// Independent validation: the client-side EPUB preview is not a trust boundary.
export function validateReadalong(input,duration){
  const bad=()=>{const e=new Error('Invalid read-along. Passages must be ordered, non-overlapping and within this audiobook.');e.status=400;throw e;};
  if(!Number.isFinite(duration)||duration<=0||!input||typeof input.title!=='string'||input.title.length>300||!Array.isArray(input.cues)||!input.cues.length||input.cues.length>50000)bad();
  let end=0,total=0;
  const cues=input.cues.map(c=>{
    if(!c||typeof c.start!=='number'||typeof c.end!=='number'||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<end||c.end<=c.start||c.end>duration||typeof c.text!=='string'||!c.text.trim()||c.text.length>10000||typeof c.anchor!=='string'||c.anchor.length>2000)bad();
    total+=c.text.length+c.anchor.length;if(total>6*1024*1024)bad();end=c.end;
    return {start:c.start,end:c.end,text:c.text,anchor:c.anchor};
  });
  return {title:input.title,cues};
}
