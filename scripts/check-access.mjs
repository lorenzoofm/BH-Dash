import assert from 'node:assert/strict';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {accessUser} from '../lib/cloudflare-access.ts';
import {normalizeEmail,policyEmails,setPolicyEmails} from '../lib/access-policy.ts';
const env={ACCESS_TEAM_DOMAIN:'https://20mg-check.cloudflareaccess.com',ACCESS_AUD:'dashboard-audience',ACCESS_ACCOUNT_ID:'test-account',ACCESS_APP_ID:'test-app',ACCESS_POLICY_ID:'test-policy',ACCESS_API_TOKEN:'test-token'};
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'check',alg:'RS256',use:'sig'};
const originalFetch=globalThis.fetch;
let keyReads=0,policyReads=0;
let policy={id:'test-policy',name:'BH managers',decision:'allow',include:[{email:{email:'massi@20mg.co'}}]};
globalThis.fetch=async (url,init={})=>{
 if(String(url)===env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs'){keyReads++;return Response.json({keys:[jwk]});}
 assert.equal(String(url),'https://api.cloudflare.com/client/v4/accounts/test-account/access/apps/test-app/policies/test-policy');
 assert.equal(init.headers.Authorization,'Bearer test-token');
 if(init.method==='PUT'){policy={...policy,...JSON.parse(init.body)};return Response.json({success:true,result:policy});}
 policyReads++;return Response.json({success:true,result:policy});
};
const sign=(claims={},key=privateKey)=>new SignJWT({email:'massi@20mg.co',...claims}).setProtectedHeader({alg:'RS256',kid:'check'}).setIssuer(claims.iss||env.ACCESS_TEAM_DOMAIN).setAudience(claims.aud||env.ACCESS_AUD).setSubject('owner').setIssuedAt().setExpirationTime(claims.exp||'5m').sign(key);
const read=(token,settings=env)=>accessUser(new Headers({'cf-access-jwt-assertion':token,'oai-authenticated-user-email':'massi@20mg.co'}),settings);
try {
 assert.equal(normalizeEmail(' Owner@Example.com '),'owner@example.com');
 assert.throws(()=>normalizeEmail('not-an-email'));
 assert.deepEqual(policyEmails(policy),['massi@20mg.co']);
 assert.throws(()=>policyEmails({...policy,include:[{everyone:{}}]}));
 assert.equal(await accessUser(new Headers({'oai-authenticated-user-email':'massi@20mg.co'}),env),null);
 const valid=await sign();assert.equal((await read(valid))?.email,'massi@20mg.co');
 assert.equal(await read(valid,{...env,ACCESS_AUD:undefined}),null);
 assert.equal(await read(valid,{...env,ACCESS_TEAM_DOMAIN:'https://untrusted.example'}),null);
 for(const claims of [{iss:'https://other.cloudflareaccess.com'},{aud:'other-app'},{exp:1},{email:'other@example.com'},{email:123}]) assert.equal(await read(await sign(claims)),null);
 assert.equal(await read('invalid.token.signature'),null);
 const other=await generateKeyPair('RS256');assert.equal(await read(await sign({},other.privateKey)),null);
 assert.equal(keyReads,1);assert.equal(policyReads,1);
 assert.deepEqual(await setPolicyEmails(env,['massi@20mg.co','MANAGER@example.com']),['massi@20mg.co','manager@example.com']);
 assert.equal((await read(await sign({email:'manager@example.com'})))?.email,'manager@example.com');
 assert.equal(await read(await sign({email:'notinvited@example.com'})),null);
 console.log('Access checks passed: signed JWT, exact policy email rules, update and revocation.');
} finally {globalThis.fetch=originalFetch;}
