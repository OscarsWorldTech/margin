const words=text=>String(text).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];

// Match a sentence inside a small transcript window. Prefix/suffix words are free;
// substitutions, missing and extra words cost one. Start indices travel with costs.
function windowMatch(query,transcript,left,right){
  const count=right-left;let costs=new Uint16Array(count+1),starts=Uint32Array.from({length:count+1},(_,i)=>left+i);
  for(let i=1;i<=query.length;i++){
    const next=new Uint16Array(count+1),nextStarts=new Uint32Array(count+1);next[0]=i;nextStarts[0]=left;
    for(let j=1;j<=count;j++){
      let value=costs[j-1]+(query[i-1]===transcript[left+j-1].word?0:1),start=starts[j-1];
      if(costs[j]+1<value){value=costs[j]+1;start=starts[j];}
      if(next[j-1]+1<value){value=next[j-1]+1;start=nextStarts[j-1];}
      next[j]=value;nextStarts[j]=start;
    }
    costs=next;starts=nextStarts;
  }
  let best=null;
  for(let j=1;j<=count;j++){
    const score=1-costs[j]/query.length;
    if(!best||score>best.score)best={score,start:starts[j],end:left+j};
  }
  return best;
}

export function alignText(ebook,captions,duration,progress=()=>{}){
  if(!Array.isArray(captions)||captions.length>100000||!Number.isFinite(duration)||duration<=0)throw Error('Caption data is not suitable for alignment.');
  const transcript=[];let previous=0;
  for(const cue of captions){
    if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.end<=cue.start||cue.start<previous||cue.end>duration+.05)continue;
    const tokens=words(cue.text);previous=cue.end;
    for(let i=0;i<tokens.length;i++)transcript.push({word:tokens[i],start:cue.start+(cue.end-cue.start)*i/tokens.length,end:Math.min(duration,cue.start+(cue.end-cue.start)*(i+1)/tokens.length)});
    if(transcript.length>400000)throw Error('Transcript exceeds the 400,000-word alignment limit.');
  }
  if(!transcript.length)throw Error('No usable caption timings were found.');
  const index=new Map();
  for(let i=0;i<transcript.length-2;i++){
    const key=transcript.slice(i,i+3).map(t=>t.word).join(' '),hits=index.get(key)||[];
    // Highly repeated phrases are not reliable global anchors.
    if(hits.length<25)hits.push(i);index.set(key,hits);
  }
  let cursor=0,endTime=0;const cues=[],missed=[];
  for(let n=0;n<ebook.sentences.length;n++){
    const sentence=ebook.sentences[n],query=words(sentence.text);let best=null;
    if(query.length>=2&&query.length<=120){
      const votes=new Map();
      for(let j=0;j<=query.length-3;j++){
        const hits=index.get(query.slice(j,j+3).join(' '));if(!hits||hits.length>=25)continue;
        for(const hit of hits){const candidate=hit-j;if(candidate>=cursor-8)votes.set(candidate,(votes.get(candidate)||0)+1);}
      }
      const candidates=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,12).map(([i])=>i);
      // Local search also recovers short sentences and sparse transcription mistakes.
      candidates.unshift(cursor);
      for(const candidate of candidates){
        const left=Math.max(cursor,candidate-8),right=Math.min(transcript.length,candidate+query.length+12);
        if(right<=left)continue;
        const match=windowMatch(query,transcript,left,right);
        const threshold=query.length<6?1:.85;
        if(match&&match.score>=threshold&&match.end>match.start&&(!best||match.score>best.score||match.score===best.score&&match.start<best.start))best=match;
      }
    }
    if(best){
      const start=Math.max(endTime,transcript[best.start].start),end=transcript[best.end-1].end;
      if(end>start){cues.push({start,end,text:sentence.text,anchor:sentence.anchor});cursor=best.end;endTime=end;}
      else missed.push(sentence.text);
    }else missed.push(sentence.text);
    if(n%100===0)progress(n/ebook.sentences.length);
  }
  if(!cues.length)throw Error('No reliable matches found. Check that the ebook and audiobook use the same edition and language.');
  return {title:ebook.title,cues,summary:{total:ebook.sentences.length,matched:cues.length,missed:missed.length,coverage:Math.round(cues.length/ebook.sentences.length*100),unmatchedExamples:missed.slice(0,5),timing:'Approximate timings derived from existing caption segments.'}};
}
