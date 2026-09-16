import {BlobReader, ZipReader} from '@zip.js/zip.js';

const XML_LIMIT=4*1024*1024, TOTAL_LIMIT=32*1024*1024;
const elements=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
const attr=(node,name)=>node?.getAttribute(name)||'';
const fail=message=>{throw new Error(message);};

export function clockTime(value){
  const s=String(value).replace(/^npt=/,'');
  let n=NaN;
  if(/^\d+(?:\.\d+)?(?:h|min|ms|s)?$/.test(s)){
    n=parseFloat(s)*(s.endsWith('ms')?.001:s.endsWith('min')?60:s.endsWith('h')?3600:1);
  }else if(/^(?:\d+:)?[0-5]?\d:[0-5]\d(?:\.\d+)?$/.test(s)){
    n=s.split(':').reduce((t,v)=>t*60+Number(v),0);
  }
  if(!Number.isFinite(n)||n<0||n>604800)fail('Invalid or unsupported EPUB audio timestamp.');
  return n;
}

function reference(base,href){
  if(!href||/^[a-z][a-z\d+.-]*:|^\/|\\/i.test(href))fail('EPUB references must point to files inside the book.');
  const url=new URL(href,'https://epub.invalid/'+base);
  if(url.origin!=='https://epub.invalid'||url.search)fail('Unsupported EPUB reference.');
  const path=decodeURIComponent(url.pathname.slice(1));
  if(path.split('/').some(p=>p==='..'||p==='.')||path.includes('\\'))fail('Invalid EPUB path.');
  return {path,fragment:decodeURIComponent(url.hash.slice(1))};
}

function plainText(node){
  const pieces=[];
  const visit=n=>{
    if(n.nodeType===3||n.nodeType===4){pieces.push(n.nodeValue);return;}
    if(['script','style','iframe','object'].includes(n.localName))return;
    if(n.localName==='br')pieces.push(' ');
    for(let child=n.firstChild;child;child=child.nextSibling)visit(child);
    if(['p','div','li','h1','h2','h3'].includes(n.localName))pieces.push(' ');
  };
  visit(node);return pieces.join('').replace(/\s+/g,' ').trim();
}

// Read only XML/text entries. Embedded audio, HTML, images and scripts are never
// mounted, played, uploaded or inserted into the page. BlobReader supports large
// seekable archives without buffering the audiobook in memory.
export async function readStoryteller(file,Parser=globalThis.DOMParser){
  if(file.size>4*1024**3)fail('This EPUB exceeds the 4 GiB import limit.');
  const reader=new ZipReader(new BlobReader(file),{useWebWorkers:false});
  try{
    const entries=new Map();let total=0;
    for await(const entry of reader.getEntriesGenerator()){
      if(entries.size>=20000)fail('This EPUB has too many files.');
      if(entries.has(entry.filename))fail('EPUB contains duplicate file names.');
      entries.set(entry.filename,entry);
    }
    async function xml(name){
      const entry=entries.get(name);
      if(!entry||entry.directory||entry.encrypted)fail('Missing or encrypted EPUB document: '+name);
      if(entry.uncompressedSize>XML_LIMIT)fail('An EPUB document exceeds the 4 MiB text limit.');
      const parts=[];let size=0;
      await entry.getData(new WritableStream({write(chunk){
        size+=chunk.length;total+=chunk.length;
        if(size>XML_LIMIT||total>TOTAL_LIMIT)fail('EPUB text exceeds the import limits.');
        parts.push(chunk);
      }}),{checkSignature:true});
      let text=await new Blob(parts).text();
      // Permit the standard HTML doctype, but never DTD/entity declarations.
      text=text.replace(/<!DOCTYPE\s+html\s*>/i,'');
      if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('EPUB documents with DTDs or custom entities are unsupported.');
      const doc=new Parser().parseFromString(text,'application/xml');
      if(elements(doc,'parsererror').length||!doc.documentElement)fail('Invalid EPUB XML: '+name);
      if(elements(doc,'*').some(e=>e.hasAttribute('xml:base')))fail('EPUB xml:base references are unsupported.');
      return doc;
    }
    const container=await xml('META-INF/container.xml');
    const packagePath=attr(elements(container,'rootfile')[0],'full-path');
    const opf=await xml(packagePath);
    const manifest=new Map();
    for(const item of elements(opf,'item')){
      const key=attr(item,'id');if(manifest.has(key))fail('Duplicate EPUB manifest identifier.');
      manifest.set(key,item);
    }
    const cues=[],sources=new Map(),seenOverlays=new Set();let skipped=0;
    for(const itemref of elements(opf,'itemref')){
      const item=manifest.get(attr(itemref,'idref'));
      if(!item)fail('EPUB spine references a missing document.');
      const overlayId=attr(item,'media-overlay');
      if(!overlayId){skipped++;continue;}
      if(seenOverlays.has(overlayId))continue;
      seenOverlays.add(overlayId);
      const overlay=manifest.get(overlayId);
      if(!overlay)fail('EPUB media overlay is missing.');
      const smilPath=reference(packagePath,attr(overlay,'href')).path;
      const smil=await xml(smilPath);
      let cachedPath='',ids=new Map();
      for(const par of elements(smil,'par')){
        const texts=elements(par,'text'),audios=elements(par,'audio');
        if(texts.length!==1||audios.length!==1)fail('Each EPUB passage must have one text reference and one audio clip.');
        const target=reference(smilPath,attr(texts[0],'src'));
        if(!target.fragment)fail('EPUB passages must reference a text element.');
        if(target.path!==cachedPath){
          const doc=await xml(target.path);ids=new Map();cachedPath=target.path;
          for(const el of elements(doc,'*')){
            const key=attr(el,'id')||attr(el,'xml:id');
            if(key){if(ids.has(key))fail('Duplicate EPUB text identifier.');ids.set(key,el);}
          }
        }
        const el=ids.get(target.fragment);
        if(!el)fail('EPUB passage text could not be found.');
        const text=plainText(el);
        if(!text||text.length>10000)fail('An EPUB passage is empty or too long.');
        const source=reference(smilPath,attr(audios[0],'src')).path;
        const entry=entries.get(source);
        if(!entry||entry.directory||entry.encrypted)fail('EPUB audio is missing or encrypted.');
        const start=clockTime(attr(audios[0],'clipBegin')||'0');
        const end=clockTime(attr(audios[0],'clipEnd'));
        if(end<=start)fail('EPUB contains an invalid audio clip.');
        if(!sources.has(source))sources.set(source,{id:source,end:0});
        sources.get(source).end=Math.max(sources.get(source).end,end);
        cues.push({start,end,text,source,anchor:target.path+'#'+target.fragment});
        if(cues.length>50000||sources.size>2000)fail('This EPUB has too many passages or audio files.');
      }
    }
    if(!cues.length)fail('No aligned passages found. Export an aligned readaloud EPUB from Storyteller; a plain ebook has no audio timings.');
    return {title:(elements(opf,'title')[0]?.textContent||'Imported book').trim().slice(0,300),cues,sources:[...sources.values()],skipped};
  }finally{await reader.close();}
}

export function mapStoryteller(parsed,offsets,duration){
  const cues=parsed.cues.map(c=>{
    const value=offsets[c.source];
    if(value===undefined||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0)fail('Enter a starting time for every EPUB audio file.');
    return {start:c.start+Number(value),end:c.end+Number(value),text:c.text,anchor:c.anchor};
  }).sort((a,b)=>a.start-b.start);
  let end=0;
  for(const c of cues){
    if(c.end>duration+.05)fail('Mapped passages extend beyond this audiobook. Check the edition and starting times.');
    if(c.start<end-.02)fail('Mapped passages overlap. Check the audio starting times.');
    // Normalize rounding overlaps before the server's strict timeline validation.
    c.start=Math.max(c.start,end);c.end=Math.min(c.end,duration);end=c.end;
    if(c.end<=c.start)fail('Mapped passage has no playable duration.');
  }
  return {title:parsed.title,cues};
}
