import assert from 'node:assert/strict';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {clerkUser, frontendApi} from '../lib/clerk-auth.ts';
import {safeReturn} from '../lib/clerk-pages.ts';
const host='clerk.bh-check.example';
const env={CLERK_PUBLISHABLE_KEY:'pk_test_'+btoa(host+'$')};
const origin='https://bh.example';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'check',alg:'RS256',use:'sig'};
const originalFetch=globalThis.fetch;let keyReads=0;
globalThis.fetch=async url=>{assert.equal(String(url),`https://${host}/.well-known/jwks.json`);keyReads++;return Response.json({keys:[jwk]});};
const sign=(claims={},key=privateKey)=>new SignJWT({email:'Massi@20mg.co',azp:origin,...claims}).setProtectedHeader({alg:'RS256',kid:'check'}).setIssuer(claims.iss||'https://'+host).setSubject('user_1').setIssuedAt().setExpirationTime(claims.exp||'1m').sign(key);
const req=(headers={})=>new Request(origin+'/',{headers});
const cookie=token=>req({cookie:'theme=x; __session='+token});
try {
 assert.equal(frontendApi(env),host);
 assert.equal(frontendApi({CLERK_PUBLISHABLE_KEY:'REPLACE_WITH_CLERK_PUBLISHABLE_KEY'}),null);
 const valid=await sign();
 assert.deepEqual(await clerkUser(cookie(valid),env),{userId:'user_1',email:'massi@20mg.co'});
 assert.equal((await clerkUser(req({authorization:'Bearer '+valid}),env))?.email,'massi@20mg.co');
 assert.equal(await clerkUser(req(),env),null);
 assert.equal(await clerkUser(cookie(valid),{}),null);
 for(const claims of [{iss:'https://evil.example'},{azp:'https://evil.example'},{exp:1},{email:undefined},{email:''}]) assert.equal(await clerkUser(cookie(await sign(claims)),env),null);
 assert.equal(await clerkUser(cookie('invalid.token.signature'),env),null);
 const other=await generateKeyPair('RS256');assert.equal(await clerkUser(cookie(await sign({},other.privateKey)),env),null);
 assert.equal(keyReads,1);
 for(const [input,want] of [['/staff?x=1','/staff?x=1'],[null,'/'],['https://evil.example','/'],['//evil.example','/'],['/sign-in','/']]) assert.equal(safeReturn(input),want);
 console.log('Clerk checks passed: signed session, issuer, origin, expiry, email claim, safe redirects.');
} finally {globalThis.fetch=originalFetch;}
