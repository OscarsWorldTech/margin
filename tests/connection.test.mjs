import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeServerUrl,apiUrl,resolveServerPath,authHeaders,isNativeClient} from '../lib/server-connection.ts';

test('the browser keeps building the exact same-origin URLs it always did',()=>{
  // A regression guard: adding the seam must not change one byte of browser behaviour.
  for(const path of ['/status','/login','/libraries','/books?library=lib1&page=0','/books/book1/notes'])
    assert.equal(apiUrl('',path),'/api'+path);
  assert.equal(resolveServerPath('','/api/books/book1/audio/1'),'/api/books/book1/audio/1');
  assert.deepEqual(authHeaders(null),{},'a browser sends its cookie and must never carry a token');
  assert.equal(isNativeClient(),false,'plain Node, like a browser, is not a native client');
});

test('a packaged client resolves API, media, cover and export paths against its server',()=>{
  const base='http://192.168.1.5:8787';
  assert.equal(apiUrl(base,'/status'),'http://192.168.1.5:8787/api/status');
  // The server hands back root-relative addresses; they must not hit the bundle origin.
  assert.equal(resolveServerPath(base,'/api/books/book1/audio/1'),'http://192.168.1.5:8787/api/books/book1/audio/1');
  assert.equal(resolveServerPath(base,'/api/books/book1/cover'),'http://192.168.1.5:8787/api/books/book1/cover');
  assert.equal(resolveServerPath(base,'/api/books/book1/export?format=json'),'http://192.168.1.5:8787/api/books/book1/export?format=json');
  assert.equal(resolveServerPath(base,'https://elsewhere.invalid/x'),'https://elsewhere.invalid/x','an absolute address is left alone');
  assert.deepEqual(authHeaders('a'.repeat(64)),{Authorization:'Bearer '+'a'.repeat(64)});
});

test('server addresses are normalized the way someone would actually type them',()=>{
  assert.equal(normalizeServerUrl('margin.example.com'),'https://margin.example.com','a bare host defaults to https');
  assert.equal(normalizeServerUrl('  margin.example.com  '),'https://margin.example.com');
  assert.equal(normalizeServerUrl('margin.example.com:8787'),'https://margin.example.com:8787');
  assert.equal(normalizeServerUrl('https://margin.example.com/'),'https://margin.example.com','a trailing slash is dropped');
  assert.equal(normalizeServerUrl('http://192.168.1.5:8787'),'http://192.168.1.5:8787','an explicit http address is kept for debug builds');
  assert.equal(normalizeServerUrl('HTTP://192.168.1.5:8787/'),'http://192.168.1.5:8787');
});

test('addresses that would silently misroute requests are refused',()=>{
  for(const [input,expected] of [
    ['','Enter your Margin server address.'],
    ['   ','Enter your Margin server address.'],
    ['ftp://margin.example.com','Use an http:// or https:// address.'],
    ['file:///etc/passwd','Use an http:// or https:// address.'],
    // No "//", so this is treated as a bare host and fails to parse. Refused either way.
    ['javascript:alert(1)','That is not a valid server address.'],
    ['https://margin.example.com/margin','Enter only the server address. Margin does not run under a subpath.'],
    ['https://margin.example.com/?a=1','Enter only the server address, without a query or fragment.'],
    ['https://margin.example.com/#x','Enter only the server address, without a query or fragment.'],
    ['https://user:pass@margin.example.com','Remove the username and password from the address. Margin asks for the password separately.'],
  ]) assert.throws(()=>normalizeServerUrl(input),{message:expected},'input: '+JSON.stringify(input));
});
