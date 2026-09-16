import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {clockTime,readStoryteller,mapStoryteller} from '../lib/storyteller.mjs';
import {validateReadalong} from '../server/readalong.mjs';
import {storytellerFixture} from './storyteller-fixture.mjs';

test('aligned EPUB preserves wording and maps independent audio files to the book timeline',async()=>{
  const parsed=await readStoryteller(await storytellerFixture(),DOMParser);
  assert.equal(parsed.title,'A synthetic readaloud');assert.equal(parsed.cues.length,3);
  assert.equal(parsed.cues[0].text,'A sentence & a thought.');
  assert.deepEqual(parsed.sources.map(s=>s.end),[5,4]);
  const mapped=mapStoryteller(parsed,{'EPUB/audio/one.mp3':'0','EPUB/audio/two.mp3':'11'},22);
  assert.equal(mapped.cues[2].start,12);assert.equal(mapped.cues[2].end,15);
  assert.equal(mapped.cues[2].anchor,'EPUB/text/ch2.xhtml#s3');
  assert.deepEqual(validateReadalong(mapped,22),mapped);
  assert.throws(()=>mapStoryteller(parsed,{'EPUB/audio/one.mp3':'0'},22),/every/);
  assert.throws(()=>mapStoryteller(parsed,{'EPUB/audio/one.mp3':'0','EPUB/audio/two.mp3':'0'},22),/overlap/);
  assert.throws(()=>mapStoryteller(parsed,{'EPUB/audio/one.mp3':'0','EPUB/audio/two.mp3':'20'},22),/beyond/);
});

test('SMIL clocks support seconds, timecounts and full or partial clocks',()=>{
  for(const [s,n] of [['2.25s',2.25],['250ms',.25],['1.5min',90],['2h',7200],['npt=01:02:03.5',3723.5],['02:03',123]])assert.equal(clockTime(s),n);
  for(const s of ['', '-1','Infinity','1e3','00:70:00','indefinite'])assert.throws(()=>clockTime(s));
});

test('plain EPUBs, missing text and foreign references fail clearly',async()=>{
  await assert.rejects(()=>storytellerFixture({'EPUB/package.opf':'<package><manifest><item id="ch1" href="text/ch1.xhtml"/></manifest><spine><itemref idref="ch1"/></spine></package>'}).then(f=>readStoryteller(f,DOMParser)),/No aligned passages/);
  await assert.rejects(()=>storytellerFixture({'EPUB/text/ch1.xhtml':'<html><p id="wrong">Missing passage.</p></html>'}).then(f=>readStoryteller(f,DOMParser)),/could not be found/);
  await assert.rejects(()=>storytellerFixture({'EPUB/overlays/one.smil':'<smil><par><text src="https://example.com/evil#s1"/><audio src="../audio/one.mp3" clipEnd="2"/></par></smil>'}).then(f=>readStoryteller(f,DOMParser)),/inside the book/);
});

test('untrusted ebook markup stays inert, and XML declarations and oversized text are rejected',async()=>{
  const parsed=await readStoryteller(await storytellerFixture({'EPUB/text/ch1.xhtml':'<html><span id="s1" onclick="alert(1)">Safe <script>alert(1)</script><img src="https://example.com/track"/>words.</span><span id="s2">&lt;img onerror=evil&gt;</span></html>'}),DOMParser);
  assert.equal(parsed.cues[0].text,'Safe words.');assert.equal(parsed.cues[1].text,'<img onerror=evil>');
  await assert.rejects(()=>storytellerFixture({'EPUB/text/ch1.xhtml':'<!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]><html>&x;</html>'}).then(f=>readStoryteller(f,DOMParser)),/DTDs/);
  await assert.rejects(()=>storytellerFixture({'EPUB/text/ch1.xhtml':'x'.repeat(4*1024*1024+1)}).then(f=>readStoryteller(f,DOMParser)),/4 MiB/);
});

test('server rejects forged, out-of-range, overlapping or oversized readalongs',()=>{
  const cue={start:0,end:2,text:'A thought.',anchor:'ch#s'};
  for(const input of [null,{}, {title:'Book',cues:[]},{title:'Book',cues:[{...cue,end:23}]},{title:'Book',cues:[{...cue,start:'0'}]},{title:'Book',cues:[{...cue,end:Infinity}]},{title:'Book',cues:[cue,cue]},{title:'Book',cues:[{...cue,text:'x'.repeat(10001)}]}])assert.throws(()=>validateReadalong(input,22),{status:400});
});
