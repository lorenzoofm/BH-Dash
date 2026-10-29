import {readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('wrangler.json','utf8'));
if(config.workers_dev && !/^pk_(test|live)_/.test(config.vars?.CLERK_PUBLISHABLE_KEY||'')) throw new Error('Set CLERK_PUBLISHABLE_KEY in wrangler.json before enabling the dashboard URL.');
// The Vite plugin creates this local-only credential file; never retain it in a deployment bundle.
rmSync('dist/server/.dev.vars',{force:true});
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','dist/server/wrangler.json'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(result.error)throw result.error;
process.exit(result.status??1);
