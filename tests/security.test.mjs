import {test} from 'node:test';
import assert from 'node:assert/strict';
import {securityConfig,requestSecurity,validatePassword,LoginLimiter} from '../server/security.mjs';

const req=(remoteAddress,headers={},encrypted=false)=>({socket:{remoteAddress,encrypted},headers:{host:'margin.example',...headers}});
test('HTTP exceptions require both local endpoints; spoofed forwarding is not TLS',()=>{
  const c=securityConfig({});
  assert.equal(requestSecurity(req('198.51.100.2',{host:'localhost'}),c).allowed,false);
  assert.equal(requestSecurity(req('::ffff:127.0.0.1',{host:'localhost:8787'}),c).allowed,true);
  assert.equal(requestSecurity(req('::1',{host:'[::1]:8787'}),c).allowed,true);
  assert.equal(requestSecurity(req('127.0.0.1'),c).allowed,false);
  assert.equal(requestSecurity(req('127.0.0.1',{host:'localhost','x-forwarded-host':'margin.example'}),c).allowed,false);
  const spoof=requestSecurity(req('198.51.100.2',{'x-forwarded-proto':'https','x-forwarded-for':'127.0.0.1'}),c);
  assert.equal(spoof.allowed,false);assert.equal(spoof.client,'198.51.100.2');
  assert.equal(requestSecurity(req('198.51.100.2',{},true),c).secureCookie,true);
  assert.equal(requestSecurity(req('198.51.100.2'),securityConfig({ALLOW_INSECURE_HTTP:'true'})).allowed,true);
});
test('forwarded protocol and source are accepted only from an explicit, single trusted proxy',()=>{
  const c=securityConfig({TRUSTED_PROXIES:'10.0.0.2, ::1',COOKIE_SECURE:'false'});
  const tls=requestSecurity(req('10.0.0.2',{'x-forwarded-proto':'https','x-forwarded-for':'198.51.100.5'}),c);
  assert.equal(tls.allowed,true);assert.equal(tls.secureCookie,true);assert.equal(tls.client,'198.51.100.5');
  const chain=requestSecurity(req('10.0.0.2',{'x-forwarded-proto':'https,http','x-forwarded-for':'198.51.100.5, 10.0.0.3'}),c);
  assert.equal(chain.allowed,false);assert.equal(chain.client,'10.0.0.2');
  assert.throws(()=>securityConfig({TRUSTED_PROXIES:'0.0.0.0/0'}),/exact proxy IP/);
  assert.throws(()=>securityConfig({TRUSTED_PROXIES:'proxy.example'}),/exact proxy IP/);
});
test('password configuration rejects weak or placeholder values',()=>{
  for(const p of ['', 'test-password', ' '.repeat(20), 'x'.repeat(20), 'replace-with-a-long-unique-password','CHOOSE-A-LONG-UNIQUE-PASSWORD'])assert.throws(()=>validatePassword(p),/at least 16/);
  assert.doesNotThrow(()=>validatePassword('river lantern orbit melody'));
});
test('login throttle bounds sources, retains blocked entries, and expires idle records',()=>{
  const l=new LoginLimiter({maxSources:2,perSource:2,globalLimit:100,windowMs:10000});
  assert.equal(l.take('a',0),0);assert.equal(l.take('a',1),0);assert.ok(l.take('a',2)>0);
  assert.equal(l.take('b',3),0);assert.ok(l.take('c',4)>0);
  assert.equal(l.sources.size,2);assert.ok(l.take('a',5)>0,'saturation must not evict blocked sources');
  assert.equal(l.take('c',10004),0);assert.equal(l.sources.size,1);
});
test('global throttle caps distributed attempts and success does not reset request budgets',()=>{
  const l=new LoginLimiter({globalLimit:3,windowMs:10000});
  for(let i=0;i<3;i++){assert.equal(l.take('ip'+i,i),0);l.succeeded('ip'+i);}
  assert.ok(l.take('another',4)>0);assert.equal(l.take('another',10000),0);
});
test('repeated failures cause backoff without delaying other sources',()=>{
  const l=new LoginLimiter();
  for(let i=0;i<3;i++){assert.equal(l.take('a',i),0);l.failed('a',i);}
  assert.equal(l.take('a',3),1);assert.equal(l.take('b',3),0);
  assert.equal(l.take('a',1002),0);l.succeeded('a');assert.equal(l.sources.get('a').failures,0);
  assert.equal(l.take('a',1003),0);
});
