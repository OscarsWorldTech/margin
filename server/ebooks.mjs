import path from 'node:path';
import {createHash} from 'node:crypto';
import {opendir,lstat,realpath} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';

export function ebookError(message,status=400){const e=new Error(message);e.status=status;return e;}
export class EbookLibrary {
  constructor(directory){this.root=directory?path.resolve(directory):null;this.entries=new Map();this.scanning=null;this.scanned=false;}
  list(){return {configured:Boolean(this.root),scanned:this.scanned,books:[...this.entries.values()].map(({id,name})=>({id,name}))};}
  async scan(){
    if(!this.root)throw ebookError('Mount an ebook folder and set EBOOK_DIR on the Margin server first.',409);
    if(this.scanning)return this.scanning;
    this.scanning=this.scanFiles();
    try{return await this.scanning;}finally{this.scanning=null;}
  }
  async scanFiles(){
    const found=new Map();let visited=0;let canonicalRoot;
    const walk=async(dir,depth)=>{
      if(depth>12)throw ebookError('Ebook folder nesting exceeds 12 levels. Mount a smaller folder.');
      if(depth&&(await lstat(dir)).isSymbolicLink())return;
      const relative=path.relative(canonicalRoot,await realpath(dir));
      if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw ebookError('Ebook folder changed during scanning. Scan again.');
      const directory=await opendir(dir);
      for await(const entry of directory){
        if(++visited>20000)throw ebookError('Ebook scan exceeds 20,000 entries. Mount a smaller folder.');
        if(entry.isSymbolicLink())continue;
        const file=path.join(dir,entry.name);
        if(entry.isDirectory())await walk(file,depth+1);
        else if(entry.isFile()&&/\.epub$/i.test(entry.name)){
          if(found.size>=5000)throw ebookError('Ebook scan exceeds 5,000 EPUBs. Mount a smaller folder.');
          const name=path.relative(this.root,file).split(path.sep).join('/');
          const id=createHash('sha256').update(this.root+'\0'+name).digest('hex');
          found.set(id,{id,name});
        }
      }
    };
    try{canonicalRoot=await realpath(this.root);await walk(this.root,0);}catch(e){if(e.status)throw e;throw ebookError('Ebook folder could not be read. Check the read-only mount and file permissions.',503);}
    this.entries=found;this.scanned=true;return this.list();
  }
  async resolve(id){
    if(!this.scanned)await this.scan();
    const entry=this.entries.get(id);if(!entry)throw ebookError('Ebook not found. Scan the folder again and select the file.',404);
    try{
      // Recheck each component at use time; never follow a link swapped in after scanning.
      const root=await realpath(this.root);let file=this.root;
      for(const part of entry.name.split('/')){file=path.join(file,part);if((await lstat(file)).isSymbolicLink())throw ebookError('Linked ebook files and folders are not supported.');}
      const resolved=await realpath(file),relative=path.relative(root,resolved);
      if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw ebookError('Ebook is outside the configured folder.');
      const info=await lstat(resolved);
      if(!info.isFile()||info.size>512*1024*1024)throw ebookError('Select an EPUB file smaller than 512 MiB.');
      return {...entry,file:resolved};
    }catch(e){if(e.status)throw e;throw ebookError('Ebook is unavailable. Scan again and check file permissions.',404);}
  }
}

let active=0;
export async function processEbook(file,cues,duration,onProgress=()=>{}){
  if(active>=2)throw ebookError('The ebook reader is busy. Try again shortly.',409);
  active++;
  try{return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./ebook-worker.mjs',import.meta.url),{workerData:{file,cues,duration},resourceLimits:{maxOldGenerationSizeMb:256}});
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(ebookError('Ebook processing timed out. Try a smaller book.')),300000);
    worker.on('message',message=>{if(message.progress!==undefined)onProgress(message.progress);else if(message.error)finish(ebookError(message.error));else finish(null,message.result);});
    worker.on('error',()=>finish(ebookError('The ebook reader failed. Check the EPUB and server memory.')));
    worker.on('exit',()=>{if(!settled)finish(ebookError('The ebook reader stopped before finishing.'));});
  });}finally{active--;}
}
