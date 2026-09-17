import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EbookLibrary,processEbook} from '../server/ebooks.mjs';
import {readEpubText} from '../server/epub-text.mjs';
import {alignText} from '../server/align-text.mjs';
import {storytellerFixture} from './storyteller-fixture.mjs';
import {DatabaseSync} from 'node:sqlite';
import {AlignmentJobs} from '../server/alignment-jobs.mjs';

async function folder(t){const dir=await mkdtemp(path.join(tmpdir(),'margin-ebooks-'));t.after(async()=>{if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'margin-ebooks-'))throw Error('Unexpected test path');await rm(dir,{recursive:true,force:true});});return dir;}
async function fixture(file,changes={}){await writeFile(file,Buffer.from(await(await storytellerFixture({'EPUB/package.opf':'<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A synthetic readaloud</dc:title><dc:creator>Test author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="one" href="text/ch1.xhtml"/><item id="two" href="text/ch2.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',...changes})).arrayBuffer()));}

test('folder scan is explicit, recursive, read-only and resolves opaque IDs',async t=>{
  const dir=await folder(t);await mkdir(path.join(dir,'nested'));await fixture(path.join(dir,'nested','book.EPUB'));await writeFile(path.join(dir,'ignore.txt'),'ignored');
  const library=new EbookLibrary(dir);assert.equal(library.list().scanned,false);
  const result=await library.scan();assert.deepEqual(result.books.map(b=>b.name),['nested/book.EPUB']);assert.match(result.books[0].id,/^[a-f0-9]{64}$/);
  assert.equal((await library.resolve(result.books[0].id)).file,await import('node:fs/promises').then(fs=>fs.realpath(path.join(dir,'nested','book.EPUB'))));
  await assert.rejects(()=>library.resolve('../ignore.txt'),{status:404});
  await assert.rejects(()=>new EbookLibrary('').scan(),{status:409});
});

test('EPUB parser preserves inline wording, sentence order and metadata without executing markup',async t=>{
  const dir=await folder(t),file=path.join(dir,'book.epub');await fixture(file);
  const ebook=await readEpubText(file);assert.equal(ebook.title,'A synthetic readaloud');
  assert.deepEqual(ebook.sentences.map(s=>s.text),['A sentence & a thought.','Keep the next idea.','Another chapter begins.']);
  const preview=await processEbook(file);assert.equal(preview.sentences,3);assert.equal(preview.sample[0],'A sentence & a thought.');
  await fixture(file,{'EPUB/text/ch1.xhtml':'<!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]><html><body>&x;</body></html>'});
  await assert.rejects(()=>readEpubText(file),/DTDs/);
});

test('symlink files and directories are excluded, including a replacement after scanning',async t=>{
  const dir=await folder(t),outside=await folder(t);await fixture(path.join(outside,'outside.epub'));
  try{await symlink(outside,path.join(dir,'linked'),process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('Symlink permission unavailable');return;}throw e;}
  const lib=new EbookLibrary(dir);assert.equal((await lib.scan()).books.length,0);
  await mkdir(path.join(dir,'real'));await fixture(path.join(dir,'real','outside.epub'));const selected=(await lib.scan()).books[0];
  await rm(path.join(dir,'real'),{recursive:true});await symlink(outside,path.join(dir,'real'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>lib.resolve(selected.id),/Linked/);
});

test('EPUB 2 external doctypes and named characters work without enabling custom entities',async t=>{
  const dir=await folder(t),file=path.join(dir,'book.epub');
  const body='<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Caf&eacute;&nbsp;&mdash; &ldquo;Hello&rdquo; &amp; goodbye.</p><p><![CDATA[Literal &nbsp; stays.]]></p></body></html>';
  for(const doctype of ['<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">',"<!DOCTYPE html SYSTEM 'https://example.invalid/never-fetch.dtd'>"]){
    await fixture(file,{'EPUB/text/ch1.xhtml':doctype+body});
    const ebook=await readEpubText(file);
    assert.equal(ebook.sentences[0].text,'Café — “Hello” & goodbye.');
    assert.equal(ebook.sentences[1].text,'Literal &nbsp; stays.');
  }
  for(const declaration of ['<!DOCTYPE html SYSTEM "https://example.invalid/never-fetch.dtd" [<!ENTITY x "unsafe">]>','<!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]>','<!ENTITY x SYSTEM "https://example.invalid/secret">']){
    await fixture(file,{'EPUB/text/ch1.xhtml':declaration+body});
    await assert.rejects(()=>readEpubText(file),/DTDs/);
  }
  await fixture(file,{'EPUB/text/ch1.xhtml':'<html><body><p>&unknownMarginEntity;</p></body></html>'});
  await assert.rejects(()=>readEpubText(file),/invalid XML/);
});

test('EPUB permits ignored obfuscated fonts but rejects encrypted text and unsafe documents',async t=>{
  const dir=await folder(t),file=path.join(dir,'book.epub');
  const packageXml='<package><manifest><item id="chapter" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="font" href="fonts/book.ttf" media-type="font/ttf"/></manifest><spine><itemref idref="chapter"/></spine></package>';
  const encryption=(algorithm,target)=>`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="${target}"/></CipherData></EncryptedData></encryption>`;
  await fixture(file,{'EPUB/package.opf':packageXml,'META-INF/encryption.xml':encryption('http://www.idpf.org/2008/embedding','EPUB/fonts/book.ttf'),'EPUB/fonts/book.ttf':'Ignored font bytes'});
  assert.equal((await readEpubText(file)).sentences.length,2);
  for(const [algorithm,target] of [['http://www.idpf.org/2008/embedding','EPUB/text/ch1.xhtml'],['http://www.w3.org/2001/04/xmlenc#aes128-cbc','EPUB/fonts/book.ttf']]){
    await fixture(file,{'EPUB/package.opf':packageXml,'META-INF/encryption.xml':encryption(algorithm,target)});
    await assert.rejects(()=>readEpubText(file),/Encrypted EPUB text/);
  }
  await fixture(file,{'EPUB/package.opf':packageXml.replace('text/ch1.xhtml','https://example.invalid/chapter.xhtml')});
  await assert.rejects(()=>readEpubText(file),/external or unsupported/);
  await fixture(file,{'EPUB/text/ch1.xhtml':'<html><body><p>Broken</body></html>'});
  await assert.rejects(()=>readEpubText(file),/invalid XML/);
  await fixture(file,{'EPUB/text/ch1.xhtml':'<html><body>'+ 'x'.repeat(4*1024*1024)+'</body></html>'});
  await assert.rejects(()=>readEpubText(file),/exceeds 4 MiB/);
});

test('alignment skips narrator introductions, tolerates a missing word and retains original spelling',()=>{
  const ebook={title:'Book',sentences:[
    {text:'The quiet river flows beneath the ancient bridge.',anchor:'a'},
    {text:'An omitted foreword about something completely different.',anchor:'b'},
    {text:'Tomorrow we will return to the garden together.',anchor:'c'},
  ]};
  const result=alignText(ebook,[
    {start:0,end:3,text:'Presented by a narrator and a publisher.'},
    {start:3,end:11,text:'The river flows beneath the ancient bridge.'},
    {start:15,end:23,text:'Tomorrow we will return to the garden together.'},
  ],30);
  assert.equal(result.cues.length,2);assert.equal(result.cues[0].start,3);assert.equal(result.cues[0].text,ebook.sentences[0].text);
  assert.equal(result.cues[1].start,15);assert.equal(result.summary.missed,1);
  assert.throws(()=>alignText({title:'Wrong',sentences:[{text:'Completely unrelated words and ideas.',anchor:'x'}]},[{start:0,end:5,text:'Another edition has no matching words.'}],30),/No reliable matches/);
});

test('repeated sentences retain occurrence order and multi-track global timing gaps',()=>{
  const text='We will meet beneath the old oak tree.';
  const result=alignText({title:'Book',sentences:[{text,anchor:'a'},{text,anchor:'b'}]},[{start:2,end:8,text},{start:100,end:110,text}],120);
  assert.deepEqual(result.cues.map(c=>[c.start,c.end]),[[2,8],[100,110]]);
});

test('alignment chooses a stronger match over an earlier similar passage',()=>{
  const text='The quiet river flows beneath the ancient stone bridge while distant birds sing softly beside the green meadow every morning.';
  const similar=text.replace('quiet','wide').replace('ancient','narrow').replace('distant','happy');
  const result=alignText({title:'Book',sentences:[{text,anchor:'a'}]},[
    {start:0,end:20,text:similar},
    {start:20,end:60,text:'unrelated '.repeat(40)},
    {start:100,end:120,text},
  ],130);
  assert.equal(result.cues[0].start,100);
  assert.equal(result.cues[0].end,120);
});

test('alignment jobs start/resume transcription, survive restart and require activation',async t=>{
  const dir=await folder(t),text='The quiet river flows beneath the ancient bridge.';
  await fixture(path.join(dir,'book.epub'),{'EPUB/text/ch1.xhtml':`<html><body><p>${text}</p></body></html>`});
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('CREATE TABLE readalongs(book TEXT PRIMARY KEY,content TEXT NOT NULL)');
  const old={title:'Existing',cues:[{start:1,end:2,text:'Keep this text.',anchor:'old'}]};db.prepare('INSERT INTO readalongs VALUES (?,?)').run('book',JSON.stringify(old));
  let captions=[],transcription=null,queued=0;
  const config={directory:dir,bookDetails:async()=>({duration:30}),readCues:()=>captions,transcription:()=>transcription,queueTranscription:()=>{queued++;transcription={status:'queued',progress:0};}};
  let jobs=new AlignmentJobs(db,config);const ebook=(await jobs.library.scan()).books[0].id;
  await jobs.start('book',ebook);assert.equal(queued,1);assert.equal(jobs.status('book').status,'waiting');
  await assert.rejects(()=>jobs.start('book',ebook),{status:409});
  transcription={status:'failed',progress:.5};jobs.transcriptionFinished('book');assert.equal(jobs.status('book').status,'paused');
  await jobs.start('book',ebook);assert.equal(queued,2);
  jobs=new AlignmentJobs(db,config);assert.equal(jobs.status('book').status,'paused','waiting jobs pause on restart');
  await jobs.start('book',ebook);assert.equal(queued,3);
  captions=[{start:4,end:12,text}];transcription={status:'done',progress:1};jobs.transcriptionFinished('book');
  for(let i=0;i<100&&jobs.status('book').status!=='review';i++){if(jobs.status('book').status==='failed')throw Error(jobs.status('book').message);await new Promise(r=>setTimeout(r,20));}
  assert.equal(jobs.status('book').status,'review');assert.equal(jobs.result('book').summary.matched,1);
  assert.deepEqual(JSON.parse(db.prepare('SELECT content FROM readalongs').get().content),old);
  await jobs.accept('book');assert.equal(jobs.status('book').status,'done');
  assert.equal(JSON.parse(db.prepare('SELECT content FROM readalongs').get().content).cues[0].text,text);
});
