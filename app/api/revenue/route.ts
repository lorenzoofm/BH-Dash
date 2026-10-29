import {after} from 'next/server';
import {guard,failure} from '@/lib/data-server';
import {revenueURL} from '@/lib/revenue-request';
import {pagesFor} from '@/lib/page-access';
export const dynamic='force-dynamic';
// Creatorstaq takes seconds per call, so identical upstream requests share one result per isolate
// (single-tenant: every manager sees the same agency numbers). A result is fresh for 5 min; up to
// 15 min old it is served at once and refreshed in the background. Failures are never cached.
// The Workers Cache API does nothing on *.workers.dev, so this cache is in-isolate only.
const FRESH=5*60000,STALE=15*60000;
type Entry={at:number;data:Promise<any>;refreshing?:boolean};
const cache=new Map<string,Entry>();
function load(url:URL){
 return fetch(url.href,{headers:{Authorization:process.env.CREATORSTAQ_AUTH!},redirect:'manual',signal:AbortSignal.timeout(45000)}).then(async response=>{
  if(response.status>=300&&response.status<400)throw new Error('502:Creatorstaq redirected the revenue request.');
  if(!response.ok)throw new Error('502:Creatorstaq could not complete the revenue request ('+response.status+').');
  const body:any=await response.json();const accountRange=/^\/v1\/computed\/[a-zA-Z0-9_-]{1,64}\/revenue\/ranged$/.test(url.pathname);
  if(url.pathname==='/v1/me'){if(!Array.isArray(body.accounts))throw new Error('502:Creatorstaq returned an incomplete account list.');}
  else if(accountRange){if(!body.kpis||body.kpis.total_net===undefined||body.kpis.total_net===null)throw new Error('502:Creatorstaq returned an incomplete account revenue response.');}
  else {const rows=url.pathname.endsWith('/ranged')?body.by_creator:body.monthly_by_account;if(!Array.isArray(rows))throw new Error('502:Creatorstaq returned an incomplete revenue response.');}
  return body;
 });
}
function store(key:string,entry:Entry){cache.set(key,entry);if(cache.size>200)cache.delete(cache.keys().next().value!);}
export async function GET(req:Request){try{
 const actor=await guard();const pages=await pagesFor(actor.user!.email,actor.isAdmin);if(!pages.includes('revenue')&&!pages.includes('pnl'))throw new Error('403:Revenue access is not enabled for your account.');const url=revenueURL(new URL(req.url).searchParams.get('url'));
 if(!process.env.CREATORSTAQ_AUTH)throw new Error('503:Creatorstaq is not connected yet.');
 const key=url.href;let entry=cache.get(key),state='HIT';const age=entry?Date.now()-entry.at:Infinity;
 if(!entry||age>=STALE){
  // Concurrent requests share this one upstream call; a failed call is forgotten so the next request retries.
  const fresh:Entry={at:Date.now(),data:load(url)};store(key,fresh);entry=fresh;state='MISS';
  fresh.data.catch(()=>{if(cache.get(key)===fresh)cache.delete(key);});
 }else if(age>=FRESH&&(state='STALE')&&!entry.refreshing){
  // Serve the stale result now; replace it only if the refresh succeeds, so a failed refresh never becomes a 0.
  const stale=entry;stale.refreshing=true;
  after(load(url).then(body=>{if(cache.get(key)===stale)store(key,{at:Date.now(),data:Promise.resolve(body)});},()=>{stale.refreshing=false;}));
 }
 const result=await entry.data;
 return Response.json(url.pathname==='/v1/me'?{accounts:result.accounts}:result,{headers:{'Cache-Control':'private, no-store','X-Revenue-Cache':state}});
 }catch(e){return failure(e);}}
