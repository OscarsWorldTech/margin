import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {supervise} from '../docker/all-in-one.mjs';

test('all-in-one stops its other service when either service exits',async()=>{
  const code=await supervise([
    {name:'test worker',command:process.execPath,args:['-e','setTimeout(()=>process.exit(7),100)']},
    {name:'test app',command:process.execPath,args:['-e','setInterval(()=>{},1000)']},
  ],{graceMs:500});
  assert.equal(code,7);
});

test('all-in-one treats a failed launch as a container failure',async()=>{
  assert.equal(await supervise([
    {name:'missing worker',command:'margin-test-nonexistent-command'},
    {name:'test app',command:process.execPath,args:['-e','setInterval(()=>{},1000)']},
  ],{graceMs:500}),1);
});

test('all-in-one handles Docker stop and terminates an uncooperative child',{skip:process.platform==='win32'?'POSIX signals are checked on Linux CI':false,timeout:5000},async t=>{
  const moduleUrl=new URL('../docker/all-in-one.mjs',import.meta.url).href;
  const script=`import {supervise} from ${JSON.stringify(moduleUrl)};
    const result=supervise([{name:'stubborn child',command:process.execPath,args:['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"]}],{graceMs:100});
    process.exitCode=await result;`;
  const supervisor=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});
  t.after(()=>supervisor.kill('SIGKILL'));
  await once(supervisor.stdout,'data');
  const exited=once(supervisor,'exit');
  supervisor.kill('SIGTERM');
  assert.deepEqual(await exited,[0,null]);
});
