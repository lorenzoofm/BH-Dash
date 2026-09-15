import assert from 'node:assert/strict';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {accessUser} from '../lib/cloudflare-access.ts';
const env={ACCESS_TEAM_DOMAIN:'https://20mg-check.cloudflareaccess.com',ACCESS_AUD:'dashboard-audience',MANAGER_EMAILS:'massi@20mg.co'};
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'check',alg:'RS256',use:'sig'};
const originalFetch=globalThis.fetch;
let keyReads=0;
globalThis.fetch=async url=>{assert.equal(String(url),env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs');keyReads++;return Response.json({keys:[jwk]});};
const sign=(claims={},key=privateKey)=>new SignJWT({email:'massi@20mg.co',...claims}).setProtectedHeader({alg:'RS256',kid:'check'}).setIssuer(claims.iss||env.ACCESS_TEAM_DOMAIN).setAudience(claims.aud||env.ACCESS_AUD).setSubject('owner').setIssuedAt().setExpirationTime(claims.exp||'5m').sign(key);
const read=(token,settings=env)=>accessUser(new Headers({'cf-access-jwt-assertion':token,'oai-authenticated-user-email':'massi@20mg.co'}),settings);
try {
 assert.equal(await accessUser(new Headers({'oai-authenticated-user-email':'massi@20mg.co','oai-authenticated-user-id':'forged'}),env),null);
 const valid=await sign(); assert.equal((await read(valid))?.email,'massi@20mg.co');
 assert.equal(await read(valid,{...env,ACCESS_AUD:undefined}),null);
 assert.equal(await read(valid,{...env,MANAGER_EMAILS:''}),null);
 assert.equal(await read(valid,{...env,ACCESS_TEAM_DOMAIN:'https://untrusted.example'}),null);
 for(const claims of [{iss:'https://other.cloudflareaccess.com'},{aud:'other-app'},{exp:1},{email:'other@example.com'},{email:123}]) assert.equal(await read(await sign(claims)),null);
 assert.equal(await read('invalid.token.signature'),null);
 const other=await generateKeyPair('RS256');assert.equal(await read(await sign({},other.privateKey)),null);
 assert.equal(keyReads,1,'signing keys should be reused');
 console.log('Access checks passed: signed owner only, audience/issuer/expiry/signature/identity enforced, no header impersonation.');
} finally {globalThis.fetch=originalFetch;}
