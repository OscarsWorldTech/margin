import {parentPort,workerData} from 'node:worker_threads';
import {readEpubText} from './epub-text.mjs';
import {alignText} from './align-text.mjs';

try{
  const ebook=await readEpubText(workerData.file);
  const result=workerData.cues
    ?alignText(ebook,workerData.cues,workerData.duration,progress=>parentPort.postMessage({progress}))
    :{title:ebook.title,author:ebook.author,sentences:ebook.sentences.length,sample:ebook.sentences.slice(0,3).map(s=>s.text)};
  parentPort.postMessage({result});
}catch(error){
  // Do not return OS errors with host paths, or arbitrary XML-parser diagnostics.
  parentPort.postMessage({error:error.code?'The EPUB could not be read. Check its mount and permissions.':String(error.message).slice(0,500)});
}
