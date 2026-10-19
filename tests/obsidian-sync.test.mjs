import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import {initializeOutbox, queueNote, noteContext, drainOutbox, openAICompatibleSummarizer} from '../server/obsidian-sync.mjs';

async function fixture(t) {
  await mkdir(path.resolve('work'),{recursive:true});
  const temp=await mkdtemp(path.join(path.resolve('work'),'margin-obsidian-test-'));
  const database=new DatabaseSync(path.join(temp,'margin.sqlite'));
  database.exec(`CREATE TABLE notes(id TEXT PRIMARY KEY,book TEXT NOT NULL,start REAL NOT NULL,end REAL NOT NULL,quote TEXT NOT NULL,note TEXT NOT NULL,color TEXT NOT NULL,created TEXT NOT NULL);
     CREATE TABLE captions(book TEXT PRIMARY KEY,cues TEXT NOT NULL);
     CREATE TABLE readalongs(book TEXT PRIMARY KEY,content TEXT NOT NULL);`);
  initializeOutbox(database);
  const vault=path.join(temp,'Obsidian Vault');
  await mkdir(vault);
  const book={title:'A Test Book',author:'A Reader',chapters:[{start:0,end:60,title:'First chapter'},{start:60,end:200,title:'Second chapter'}]};
  const resolveBook=async()=>book;
  const note={id:'abc123',book:'book1',start:70,end:74,quote:'A habit becomes easier with repetition.',note:'This seems useful.',color:'gold',created:'2026-10-18T12:00:00.000Z'};
  const save=()=>database.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(note));
  const enqueue=()=>queueNote(database,{id:note.id,book:note.book});
  const filename=path.join(vault,'Margin Imports','book1','abc123.md');
  t.after(async()=>{database.close();await rm(temp,{recursive:true,force:true});});
  return {database,temp,vault,book,resolveBook,note,save,enqueue,filename};
}

test('saving Margin annotation exports Markdown and preserved quote without AI',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.equal(r[0].action,'exported');
  const md=await readFile(f.filename,'utf8');
  assert.match(md,/A habit becomes easier with repetition/);assert.match(md,/This seems useful/);
  assert.match(md,/00:01:10/);assert.match(md,/First chapter|Second chapter/);
  assert.match(md,/margin_id: "abc123"/);
  assert.equal(f.database.prepare('SELECT status FROM obsidian_jobs WHERE id=?').get('abc123').status,'done');
  assert.equal(f.database.prepare('SELECT note FROM notes WHERE id=?').get('abc123').note,'This seems useful.');
});

test('updates sync to the same file without deleting custom Obsidian additions',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  await writeFile(f.filename,(await readFile(f.filename,'utf8'))+'\n## My Obsidian commentary\nNever overwrite this.\n');
  f.database.prepare('UPDATE notes SET note=? WHERE id=?').run('Edited in Margin','abc123');f.enqueue();
  const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.equal(r[0].action,'exported');
  const md=await readFile(f.filename,'utf8');
  assert.match(md,/Edited in Margin/);assert.doesNotMatch(md,/This seems useful\./);
  assert.match(md,/Never overwrite this/);
  assert.equal((md.match(/margin:managed:begin/g)||[]).length,1);
});

test('delete marks existing Obsidian export archived but does not delete text',async t=>{
  const f=await fixture(t);f.save();f.enqueue();await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  f.database.prepare('DELETE FROM notes WHERE id=?').run('abc123');f.enqueue();
  const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.equal(r[0].action,'archived');
  const md=await readFile(f.filename,'utf8');
  assert.match(md,/Removed \(archived copy retained\)/);assert.match(md,/A habit becomes easier/);
  assert.match(md,/margin_status: archived/);
});

test('delete before export creates no orphaned file and drains job safely',async t=>{
  const f=await fixture(t);f.enqueue();const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.equal(r[0].action,'deleted-before-export');
  assert.equal(f.database.prepare('SELECT status FROM obsidian_jobs').get().status,'done');
});

test('summarizes with actual EPUB context rather than inventing an entire chapter',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  f.database.prepare('INSERT INTO readalongs VALUES(?,?)').run('book1',JSON.stringify({cues:[
    {start:20,end:24,text:'Outside previous chapter.'},
    {start:64,end:68,text:'Habits are small actions.'},
    {start:71,end:74,text:'Repetition reinforces identity.'},
    {start:120,end:130,text:'Later content.'}
  ]}));
  let received=null;
  const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,summarize:async args=>{
    received=args;return 'An AI-style *mock* summary. The passage discusses habits and repetition.';
  }});
  assert.equal(r[0].action,'exported-and-summarized');
  assert.equal(received.context.source,'aligned EPUB');
  assert.equal(received.context.chapter,'Second chapter');
  assert.match(received.context.passage,/Repetition reinforces identity/);
  assert.doesNotMatch(received.context.passage,/Outside previous chapter/);
  assert.match(await readFile(f.filename,'utf8'),/AI-style \*mock\* summary/);
});

test('captions are used when no aligned EPUB exists',async t=>{
  const f=await fixture(t);f.save();
  f.database.prepare('INSERT INTO captions VALUES(?,?)').run('book1',JSON.stringify([{start:70,end:80,text:'Whisper transcription here.'}]));
  const c=noteContext(f.database,f.note,f.book.chapters);
  assert.equal(c.source,'audio captions');assert.match(c.passage,/Whisper transcription/);
});

test('AI outage preserves original export and retries without deleting user additions',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  const fail=async()=>{throw new Error('Simulated AI downtime')};
  let r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,summarize:fail});
  assert.equal(r[0].action,'retry');
  assert.match(await readFile(f.filename,'utf8'),/This seems useful/);
  assert.match(await readFile(f.filename,'utf8'),/Pending \/ retrying AI analysis/);
  assert.equal(f.database.prepare('SELECT status,attempts FROM obsidian_jobs').get().attempts,1);
  await writeFile(f.filename,(await readFile(f.filename,'utf8'))+'\nCustom insight.');
  f.database.prepare('UPDATE obsidian_jobs SET next_attempt=0 WHERE id=?').run('abc123');
  r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,summarize:async()=> 'Successful mock summary.'});
  assert.equal(r[0].action,'exported-and-summarized',r[0].error);
  assert.match(await readFile(f.filename,'utf8'),/Successful mock summary/);
  assert.match(await readFile(f.filename,'utf8'),/Custom insight/);
  assert.equal(f.database.prepare('SELECT status FROM obsidian_jobs').get().status,'done');
});

test('the export is idempotent: completed outbox work does not repeat',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.deepEqual(await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook}),[]);
});

test('invalid IDs rejected without constructing filesystem paths',async t=>{
  const f=await fixture(t);
  assert.throws(()=>queueNote(f.database,{id:'../../outside',book:'book1'}),/Invalid/);
  assert.throws(()=>queueNote(f.database,{id:'abc123',book:'../outside'}),/Invalid/);
});

test('an unmanaged note filename cannot be overwritten',async t=>{
  const f=await fixture(t);f.save();f.enqueue();await mkdir(path.dirname(f.filename),{recursive:true});
  await writeFile(f.filename,'My own file.');
  const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.equal(r[0].action,'retry');
  assert.equal(await readFile(f.filename,'utf8'),'My own file.');
});

test('existing symlink is never followed or overwritten',async t=>{
  const f=await fixture(t);f.save();f.enqueue();await mkdir(path.dirname(f.filename),{recursive:true});
  const victim=path.join(f.temp,'victim.txt');await writeFile(victim,'Leave this alone');
  await symlink(victim,f.filename);
  const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.equal(r[0].action,'retry');assert.equal(await readFile(victim,'utf8'),'Leave this alone');
});

test('OpenAI-compatible local model request includes quote and context, not source secrets',async()=>{
  let call=null;
  const summary=openAICompatibleSummarizer({endpoint:'http://127.0.0.1:11434/v1/chat/completions',model:'local-test',fetchImpl:async(url,options)=>{
    call={url:String(url),body:JSON.parse(options.body),headers:options.headers};
    return {ok:true,json:async()=>({choices:[{message:{content:'A mocked concise summary.'}}]})};
  }});
  const result=await summary({note:{quote:'Personal observation',note:'Thought'},book:{title:'A Book',author:'Author'},context:{chapter:'Chapter',passage:'Nearby source text.',isFullChapter:false}});
  assert.equal(result,'A mocked concise summary.');
  assert.equal(call.body.model,'local-test');
  assert.match(call.body.messages[1].content,/Nearby source text/);
  assert.match(call.body.messages[1].content,/short surrounding excerpt/);
  assert.equal(call.headers.Authorization,undefined);
});

test('plaintext nonlocal AI endpoint is refused',()=>{
  assert.throws(()=>openAICompatibleSummarizer({endpoint:'http://192.168.2.1:11434/v1/chat/completions',model:'m'}),/HTTPS/);
  assert.throws(()=>openAICompatibleSummarizer({endpoint:'https://secret@example.com/v1/chat/completions',model:'m'}),/credentials/);
});

test('AI bearer token is sent only to the configured endpoint without redirects',async()=>{
  let options;
  const summarize=openAICompatibleSummarizer({endpoint:'https://model.example/v1/chat/completions',model:'m',apiKey:'test-key',fetchImpl:async(_url,value)=>{
    options=value;return {ok:true,json:async()=>({choices:[{message:{content:'Summary'}}]})};
  }});
  await summarize({note:{quote:'quote',note:'note'},book:{title:'book'},context:{passage:'text'}});
  assert.equal(options.headers.Authorization,'Bearer test-key');
  assert.equal(options.redirect,'error');
});

test('database outbox persists after restart',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  const reopened=new DatabaseSync(path.join(f.temp,'margin.sqlite'));
  try {assert.equal(reopened.prepare('SELECT status FROM obsidian_jobs WHERE id=?').get('abc123').status,'pending');}
  finally {reopened.close();}
});

test('export refuses a symlinked book folder, preventing redirected writes',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  const root=path.join(f.vault,'Margin Imports');await mkdir(root);
  const outside=path.join(f.temp,'unrelated-directory');await mkdir(outside);
  await symlink(outside,path.join(root,'book1'),'dir');
  const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.equal(r[0].action,'retry');
  const {readdir}=await import('node:fs/promises');
  assert.deepEqual(await readdir(outside),[]);
});

test('local HTTP model adapter performs real loopback HTTP and writes result',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  const http=await import('node:http');
  const {once}=await import('node:events');
  let captured;
  const aiServer=http.createServer(async (req,res)=>{
    assert.equal(req.url,'/v1/chat/completions');
    let body='';for await(const c of req) body+=c.toString();
    captured=JSON.parse(body);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:'Model mock: habits become easier with practice.'}}]}));
  });
  aiServer.listen(0,'127.0.0.1');await once(aiServer,'listening');
  t.after(()=>new Promise(resolve=>aiServer.close(resolve)));
  const summarize=openAICompatibleSummarizer({endpoint:`http://127.0.0.1:${aiServer.address().port}/v1/chat/completions`,model:'fake-test-model'});
  const r=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,summarize});
  assert.equal(r[0].action,'exported-and-summarized',r[0].error);
  assert.equal(captured.model,'fake-test-model');
  assert.match(captured.messages[1].content,/A habit becomes easier/);
  assert.match(await readFile(f.filename,'utf8'),/Model mock: habits become easier/);
});

test('dry run previews pending work without creating folders or draining jobs',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  const result=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,dryRun:true});
  assert.equal(result[0].action,'would-export');
  await assert.rejects(readFile(f.filename,'utf8'),{code:'ENOENT'});
  assert.equal(f.database.prepare('SELECT status FROM obsidian_jobs').get().status,'pending');
});

test('failed work waits with bounded backoff before retrying',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  const failed=await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,summarize:async()=>{throw Error('offline')},clock:()=>1000});
  assert.equal(failed[0].action,'retry');
  assert.equal(f.database.prepare('SELECT next_attempt FROM obsidian_jobs').get().next_attempt,2000);
  assert.deepEqual(await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,clock:()=>1999}),[]);
  assert.equal((await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,clock:()=>2000}))[0].action,'exported');
});

test('an edit during AI inference remains queued for the latest version',async t=>{
  const f=await fixture(t);f.save();f.enqueue();
  await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook,summarize:async()=>{
    f.database.prepare('UPDATE notes SET note=? WHERE id=?').run('New thought',f.note.id);f.enqueue();return 'Stale summary';
  }});
  assert.equal(f.database.prepare('SELECT status FROM obsidian_jobs').get().status,'pending');
  assert.doesNotMatch(await readFile(f.filename,'utf8'),/Stale summary/);
  await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook});
  assert.match(await readFile(f.filename,'utf8'),/New thought/);
});

test('marker text inside a note cannot break later managed updates',async t=>{
  const f=await fixture(t);f.note.note='Literal <!-- margin:managed:end --> text';f.save();f.enqueue();
  assert.equal((await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook}))[0].action,'exported');
  f.database.prepare('UPDATE notes SET note=? WHERE id=?').run('Changed',f.note.id);f.enqueue();
  assert.equal((await drainOutbox({db:f.database,vaultDir:f.vault,resolveBook:f.resolveBook}))[0].action,'exported');
  assert.match(await readFile(f.filename,'utf8'),/Changed/);
});
