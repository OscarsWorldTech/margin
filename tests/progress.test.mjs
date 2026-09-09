import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProgressSync} from '../lib/progress-sync.ts';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('paused progress follows remote rewinds without writing the old local position',async()=>{
 const writes=[];
 const sync=new ProgressSync(90,{read:async()=>({time:30}),write:async t=>writes.push(t),status:()=>{}});
 assert.equal(await sync.refresh(()=>true),30);
 await sync.flush();assert.deepEqual(writes,[]);
});
test('a delayed remote read cannot undo a local seek or interrupt playback',async()=>{
 const remote=deferred(),begun=deferred();let paused=true;
 const sync=new ProgressSync(10,{read:()=>{begun.resolve();return remote.promise;},write:async()=>{},status:()=>{}});
 const pull=sync.refresh(()=>paused);await begun.promise;
 sync.change(25);remote.resolve({time:5});assert.equal(await pull,null);assert.equal(sync.time,25);
 const next=deferred(),nextBegun=deferred();sync.transport.read=()=>{nextBegun.resolve();return next.promise;};
 const second=sync.refresh(()=>paused);await nextBegun.promise;paused=false;next.resolve({time:2});assert.equal(await second,null);
});
test('writes stay ordered and include changes made during an in-flight save',async()=>{
 const gate=deferred(),writes=[];
 const sync=new ProgressSync(0,{read:async()=>({time:0}),write:async t=>{writes.push(t);if(writes.length===1)await gate.promise;},status:()=>{}});
 sync.change(10);const first=sync.flush();sync.change(20);const second=sync.flush();
 assert.equal(first,second);assert.deepEqual(writes,[10]);gate.resolve();assert.equal(await first,true);assert.deepEqual(writes,[10,20]);
 await sync.flush();assert.deepEqual(writes,[10,20]);
});
test('a failed save remains pending and is retried before accepting remote progress',async()=>{
 let fail=true,reads=0;const writes=[],statuses=[];
 const sync=new ProgressSync(10,{read:async()=>{reads++;return {time:15};},write:async t=>{if(fail)throw Error('offline');writes.push(t);},status:m=>statuses.push(m)});
 sync.change(15);assert.equal(await sync.refresh(()=>true),null);assert.equal(reads,0);
 assert.match(statuses.at(-1),/unavailable/);fail=false;
 assert.equal(await sync.refresh(()=>true),15);assert.deepEqual(writes,[15]);assert.equal(reads,1);
});
test('a response from a previous book cannot change the active book',async()=>{
 const gate=deferred(),begun=deferred();let current=true;
 const sync=new ProgressSync(10,{read:()=>{begun.resolve();return gate.promise;},write:async()=>{},status:()=>{}});
 const pull=sync.refresh(()=>current);await begun.promise;current=false;gate.resolve({time:40});assert.equal(await pull,null);
});
