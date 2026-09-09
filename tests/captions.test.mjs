import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCaptions,whisperCues,sentences,byteRange,markdown} from '../server/captions.mjs';
test('SRT and WebVTT parse CRLF, settings, HTML, and multi-track offsets',()=>{
 const input='WEBVTT\r\n\r\n1\r\n01:02:03.250 --> 01:02:05.000 align:start\r\nHello <b>there.</b>\r\n\r\n2\r\n01:02:06,000 --> 01:02:07,000\r\nNext track.';
 assert.deepEqual(parseCaptions(input),[{start:3723.25,end:3725,text:'Hello there.'},{start:3726,end:3727,text:'Next track.'}]);
 assert.throws(()=>parseCaptions('plain text without timings'));
});
test('both whisper.cpp verbose response shapes retain seconds',()=>{
 assert.deepEqual(whisperCues({segments:[{start:1.2,end:3,text:' Hi. '}]}),[{start:1.2,end:3,text:'Hi.'}]);
 assert.deepEqual(whisperCues({transcription:[{offsets:{from:1200,to:3000},text:' Hi. '}]}),[{start:1.2,end:3,text:'Hi.'}]);
 assert.throws(()=>whisperCues({text:'No timings'}));
});
test('sentence aggregation preserves long silence and split sentences',()=>{
 assert.deepEqual(sentences([{start:0,end:1,text:'A sentence'},{start:1,end:2,text:'ends here.'},{start:10,end:11,text:'Next.'}]),[{start:0,end:2,text:'A sentence ends here.'},{start:10,end:11,text:'Next.'}]);
 const split=sentences([{start:0,end:10,text:'One. Two.'}]);assert.equal(split.length,2);assert.equal(split[0].end,split[1].start);assert.equal(split[1].end,10);
});
test('audio range handling allows seeking and suffix requests',()=>{
 assert.deepEqual(byteRange('bytes=100-199',1000),{start:100,end:199,partial:true});
 assert.deepEqual(byteRange('bytes=-100',1000),{start:900,end:999,partial:true});
 assert.deepEqual(byteRange('bytes=900-',1000),{start:900,end:999,partial:true});
 assert.throws(()=>byteRange('bytes=1000-',1000));assert.throws(()=>byteRange('bytes=0-1,4-5',1000));
});
test('exports preserve quotes, notes and timestamps',()=>{
 assert.match(markdown('A book',[{start:3661,quote:'First\nSecond',note:'My thought'}]),/01:01:01\n\n> First\n> Second\n\nMy thought/);
});
