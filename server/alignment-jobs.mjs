import {EbookLibrary,processEbook,ebookError} from './ebooks.mjs';
import {validateReadalong} from './readalong.mjs';

export class AlignmentJobs {
  constructor(db,{directory,bookDetails,readCues,transcription,queueTranscription}){
    this.db=db;this.library=new EbookLibrary(directory);this.bookDetails=bookDetails;this.readCues=readCues;this.transcription=transcription;this.queueTranscription=queueTranscription;this.queue=[];this.running=false;this.starting=new Set();
    db.exec("CREATE TABLE IF NOT EXISTS alignments(book TEXT PRIMARY KEY,ebook TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',result TEXT)");
    db.prepare("UPDATE alignments SET status='paused',message='Server restarted. Resume alignment to continue.' WHERE status IN ('waiting','queued','running')").run();
  }
  status(book){const row=this.db.prepare('SELECT book,ebook,name,status,progress,message FROM alignments WHERE book=?').get(book)||null;
    if(row?.status==='waiting'){const job=this.transcription(book);return {...row,progress:job?.progress||0,message:job?.message||row.message};}return row;}
  update(book,status,progress,message){this.db.prepare('UPDATE alignments SET status=?,progress=?,message=? WHERE book=?').run(status,progress,message,book);}
  async start(book,ebook){
    if(this.starting.has(book)||['waiting','queued','running'].includes(this.status(book)?.status))throw ebookError('This book already has an alignment in progress.',409);
    if(this.db.prepare("SELECT count(*) AS count FROM alignments WHERE status IN ('waiting','queued','running')").get().count+this.starting.size>=20)throw ebookError('The alignment queue is full. Wait for a book to finish.',409);
    this.starting.add(book);
    try{
      const selected=await this.library.resolve(ebook);await this.bookDetails(book);
      this.db.prepare("INSERT INTO alignments(book,ebook,name,status) VALUES (?,?,?,'waiting') ON CONFLICT(book) DO UPDATE SET ebook=excluded.ebook,name=excluded.name,status='waiting',progress=0,message='',result=NULL").run(book,ebook,selected.name);
      const captions=this.readCues(book),job=this.transcription(book);
      if(captions.length&&(!job||job.status==='done'))this.enqueue(book);
      else{this.update(book,'waiting',0,'Preparing captions before matching ebook text.');this.queueTranscription(book);}
      return this.status(book);
    }catch(error){
      if(this.status(book)?.status==='waiting')this.update(book,'failed',0,'Could not start caption processing. Try again.');
      throw error;
    }finally{this.starting.delete(book);}
  }
  transcriptionFinished(book){
    if(this.status(book)?.status!=='waiting')return;
    const job=this.transcription(book);
    if(job?.status==='done')this.enqueue(book);
    else if(['paused','failed'].includes(job?.status))this.update(book,'paused',job.progress,'Caption processing stopped. Resume alignment to continue from saved sections.');
  }
  enqueue(book){this.update(book,'queued',0,'Waiting to match ebook text.');this.queue.push(book);void this.pump();}
  async pump(){
    if(this.running)return;this.running=true;
    try{while(this.queue.length){
      const book=this.queue.shift();
      try{
        this.update(book,'running',0,'Matching the ebook to the recording.');
        const selected=await this.library.resolve(this.status(book).ebook),details=await this.bookDetails(book);
        const result=await processEbook(selected.file,this.readCues(book),details.duration,progress=>this.update(book,'running',progress,'Matching ebook sentences.'));
        validateReadalong(result,details.duration);
        this.db.prepare("UPDATE alignments SET status='review',progress=1,message=?,result=? WHERE book=?").run(`${result.summary.matched} of ${result.summary.total} passages matched. Review before using.`,JSON.stringify(result),book);
      }catch(error){this.update(book,'failed',0,error.status?error.message:'Alignment failed. Check the ebook, recording and server configuration.');}
    }}finally{this.running=false;}
  }
  result(book){const row=this.db.prepare('SELECT status,result FROM alignments WHERE book=?').get(book);if(!row?.result||!['review','done'].includes(row.status))throw ebookError('No completed alignment is ready for review.',409);return JSON.parse(row.result);}
  async accept(book){
    const result=this.result(book),details=await this.bookDetails(book);
    // Recheck after upstream I/O so a newly started job cannot activate an old result.
    if(this.db.prepare('SELECT result FROM alignments WHERE book=?').get(book)?.result!==JSON.stringify(result))throw ebookError('Alignment changed. Review the latest result.',409);
    const validated=validateReadalong(result,details.duration);
    this.db.prepare('INSERT INTO readalongs VALUES (?,?) ON CONFLICT(book) DO UPDATE SET content=excluded.content').run(book,JSON.stringify(validated));
    this.update(book,'done',1,'Book text is ready. Existing notes and captions were kept.');return validated;
  }
}
