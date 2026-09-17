import {openAsBlob} from 'node:fs';
import {BlobReader,ZipReader} from '@zip.js/zip.js';
import {DOMParser} from '@xmldom/xmldom';

const nodes=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
const attribute=(node,key)=>node?.getAttribute(key)||'';
const fail=message=>{throw Error(message);};
function relativeFile(base,href){
  if(!href||/^[a-z][a-z\d+.-]*:|^\/|\\/i.test(href))fail('EPUB contains an external or unsupported document reference.');
  const url=new URL(href,'https://epub.invalid/'+base);
  if(url.origin!=='https://epub.invalid'||url.search)fail('Unsupported EPUB reference.');
  return decodeURIComponent(url.pathname.slice(1));
}

// The worker reads archive entries into bounded memory, never onto the filesystem.
export async function readEpubText(file){
  const blob=await openAsBlob(file);
  if(blob.size>512*1024*1024)fail('EPUB exceeds the 512 MiB limit.');
  const reader=new ZipReader(new BlobReader(blob),{useWebWorkers:false});
  let total=0;
  try{
    const entries=new Map();
    for await(const entry of reader.getEntriesGenerator()){
      if(entries.size>=20000||entries.has(entry.filename))fail('EPUB has too many files or duplicate paths.');
      entries.set(entry.filename,entry);
    }
    async function xml(name){
      const entry=entries.get(name);
      if(!entry||entry.directory||entry.encrypted)fail('EPUB has a missing or encrypted document.');
      if(entry.uncompressedSize>4*1024*1024)fail('An EPUB document exceeds 4 MiB.');
      const chunks=[];let size=0;
      await entry.getData(new WritableStream({write(chunk){
        size+=chunk.length;total+=chunk.length;
        if(size>4*1024*1024||total>32*1024*1024)fail('EPUB expanded text exceeds the import limits.');
        chunks.push(chunk);
      }}),{checkSignature:true});
      const text=(await new Blob(chunks).text()).replace(/<!DOCTYPE\s+html\s*>/i,'');
      if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('EPUB custom DTDs and entities are not supported.');
      let doc;
      try{doc=new DOMParser({onError:()=>{throw Error('Invalid XML');}}).parseFromString(text,'application/xml');}catch{fail('EPUB contains invalid XML.');}
      if(nodes(doc,'*').some(node=>node.hasAttribute('xml:base')))fail('EPUB xml:base references are unsupported.');
      return doc;
    }
    const container=await xml('META-INF/container.xml');
    const packageFile=attribute(nodes(container,'rootfile')[0],'full-path');
    const opf=await xml(packageFile),manifest=new Map();
    for(const item of nodes(opf,'item')){const id=attribute(item,'id');if(manifest.has(id))fail('Duplicate EPUB identifier.');manifest.set(id,item);}
    if(entries.has('META-INF/encryption.xml')){
      const encryption=await xml('META-INF/encryption.xml');
      for(const encrypted of nodes(encryption,'EncryptedData')){
        const method=attribute(nodes(encrypted,'EncryptionMethod')[0],'Algorithm');
        const target=relativeFile('',attribute(nodes(encrypted,'CipherReference')[0],'URI'));
        const item=[...manifest.values()].find(value=>relativeFile(packageFile,attribute(value,'href'))===target);
        // Standard font obfuscation is not DRM; fonts are never read or rendered.
        if(method!=='http://www.idpf.org/2008/embedding'||!item||!(/^(font\/|application\/(vnd\.ms-opentype|font-))/).test(attribute(item,'media-type')))
          fail('Encrypted EPUB text is not supported. Use an unencrypted edition.');
      }
    }
    const title=(nodes(opf,'title')[0]?.textContent||'Untitled ebook').trim().slice(0,300);
    const author=(nodes(opf,'creator')[0]?.textContent||'').trim().slice(0,300);
    const language=(nodes(opf,'language')[0]?.textContent||'en').trim();
    let splitter;try{splitter=new Intl.Segmenter(language,{granularity:'sentence'});}catch{splitter=new Intl.Segmenter('en',{granularity:'sentence'});}
    const sentences=[];let chars=0;
    for(const ref of nodes(opf,'itemref')){
      if(attribute(ref,'linear')==='no')continue;
      const item=manifest.get(attribute(ref,'idref'));
      if(!item)fail('Missing EPUB spine document.');
      if(attribute(item,'properties').split(/\s+/).includes('nav'))continue;
      const name=relativeFile(packageFile,attribute(item,'href'));
      const doc=await xml(name),body=nodes(doc,'body')[0];if(!body)continue;
      // Block boundaries separate sentences, while inline markup keeps its spacing.
      const parts=[];const stack=[{node:body,depth:0,after:false}];
      const blocks=new Set(['p','div','li','blockquote','h1','h2','h3','h4','br','section']);
      while(stack.length){
        const {node,depth,after}=stack.pop();if(depth>100)fail('EPUB markup is nested too deeply.');
        if(node.nodeType===3||node.nodeType===4){parts.push(node.nodeValue);continue;}
        if(['script','style','nav','iframe','object','svg'].includes(node.localName)||node.hasAttribute?.('hidden'))continue;
        if(blocks.has(node.localName))parts.push('\n');
        if(after)continue;
        stack.push({node,depth,after:true});
        for(let child=node.lastChild;child;child=child.previousSibling)stack.push({node:child,depth:depth+1,after:false});
      }
      let index=0;
      for(const paragraph of parts.join('').split(/\n+/)){
        const normalized=paragraph.replace(/\s+/g,' ').trim();if(!normalized)continue;
        for(const {segment} of splitter.segment(normalized)){
          const text=segment.trim();if(!text)continue;
          chars+=text.length;
          if(text.length>10000||chars>5*1024*1024||sentences.length>=50000)fail('EPUB contains too much text or an oversized passage.');
          sentences.push({text,anchor:name+'#margin-'+index++});
        }
      }
    }
    if(!sentences.length)fail('No readable ebook text was found.');
    return {title,author,sentences};
  }finally{await reader.close();}
}
