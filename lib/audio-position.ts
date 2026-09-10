type Track = {startOffset:number;duration:number};

// The book endpoint and seeking must agree at boundaries, including a finished book.
export function trackAtPosition(tracks:Track[],time:number){
  const found=tracks.findIndex(t=>time>=t.startOffset&&time<t.startOffset+t.duration);
  if(found>=0)return found;
  return time<(tracks[0]?.startOffset??0)?0:Math.max(0,tracks.length-1);
}
