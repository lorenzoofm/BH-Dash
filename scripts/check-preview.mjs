import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=process.argv[2];
assert.ok(base && new URL(base).hostname === '127.0.0.1', 'Pass the local development URL.');
for(const path of ['/app/globals.css','/@id/__x00__virtual:vite-rsc/entry-browser']) {
 const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,200,path+' must reach Vite');
 assert.match(response.headers.get('content-type'),/javascript|css/,path+' must not return an HTML error');
}
const built=JSON.parse(readFileSync(new URL('../dist/server/wrangler.json',import.meta.url),'utf8'));
assert.equal(built.assets.run_worker_first,true,'Production assets must remain protected by Access.');
console.log('PASS: preview scripts and styles load; production assets remain behind authentication.');
