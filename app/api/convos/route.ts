import {guard,failure} from '@/lib/data-server';
import {pagesFor} from '@/lib/page-access';
import {CUPID_APPS,cupidMetrics,monthRange} from '@/lib/convos';
export const dynamic='force-dynamic';
// One upstream source per request, so each call stays well inside the Worker subrequest limit:
//   ?kind=cupid&month=2026-10&app=x[&creator=ID]   Cupid funnel for a month (all creators when omitted)
//   ?kind=subs&month=2026-10&account=slug           Creatorstaq new subs for one OF account, split by first-touch source
// Months are UTC calendar months on both sides so the two line up. Results are cached per isolate for 10 min.
const TTL=10*60000,cache=new Map<string,{at:number;data:Promise<any>}>();
const ID=/^[A-Za-z0-9_-]{1,64}$/;
// ponytail: stops after 50 pages (5,000 subs in or after the month); raise it if an account outgrows that.
const MAX_PAGES=50;

async function cupid(month:string,app:string,creator:string|null){
 const token=process.env.CUPID_TOKEN;if(!token)throw new Error('503:Cupid is not connected yet. Add the CUPID_TOKEN secret.');
 const {start,last}=monthRange(month);
 const url=new URL('https://x.cupidbotofm.ai/api/getAnalytics');
 for(const [k,v] of Object.entries({accessToken:token,viewingApps:app,startDate:start,endDate:last,timezone:'UTC'}))url.searchParams.set(k,v);
 if(creator)url.searchParams.set('viewingCreatorID',creator);
 let res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(110000)});
 // Cupid answers a bare 301 when it expects the API tier flag.
 if(res.status===301){url.searchParams.set('isAPI','true');res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(110000)});}
 if(res.status===401)throw new Error('502:Cupid rejected the token or this platform is not on your plan.');
 if(!res.ok)throw new Error('502:Cupid could not load analytics ('+res.status+').');
 const body:any=await res.json();if(!Array.isArray(body.rows))throw new Error('502:Cupid returned an incomplete analytics response.');
 return cupidMetrics(body.rows);
}

async function creatorstaq(path:string){
 const res=await fetch('https://api.creatorstaq.com/v1'+path,{headers:{Authorization:process.env.CREATORSTAQ_AUTH!},redirect:'manual',signal:AbortSignal.timeout(45000)});
 if(!res.ok)throw new Error('502:Creatorstaq could not load subscribers ('+res.status+').');
 return res.json() as Promise<any>;
}

async function subs(month:string,account:string){
 if(!process.env.CREATORSTAQ_AUTH)throw new Error('503:Creatorstaq is not connected yet.');
 const {start,next}=monthRange(month),a=encodeURIComponent(account);
 const overview=await creatorstaq(`/computed/${a}/overview/ranged?start=${start}&end=${next}`);
 const raw=overview?.kpis?.new_subs,newSubs=raw==null?null:Number(typeof raw==='object'?raw.value:raw);
 // Newest first, so the walk stops at the first fan who subscribed before the month.
 const bySource:Record<string,number>={};let counted=0,capped=true;
 for(let page=1;page<=MAX_PAGES;page++){
  const body=await creatorstaq(`/computed/${a}/subscribers?sort=subscribe_at&order=desc&pageSize=100&page=${page}`);
  const rows:any[]=body?.data??body?.items??body?.rows??[];
  for(const r of rows){
   const day=String(r.subscribe_at??'').slice(0,10);if(!day||day>=next)continue;
   if(day<start){capped=false;break;}
   const src=String(r.source??'untracked').toLowerCase();bySource[src]=(bySource[src]??0)+1;counted++;
  }
  if(!capped||rows.length<100){capped=false;break;}
 }
 return {newSubs:Number.isFinite(newSubs)?newSubs:null,counted,bySource,capped};
}

export async function GET(req:Request){try{
 const actor=await guard();const pages=await pagesFor(actor.user!.email,actor.isAdmin);
 if(!pages.includes('convos'))throw new Error('403:Convo Tracker access is not enabled for your account.');
 const p=new URL(req.url).searchParams,kind=p.get('kind'),month=p.get('month')||'';
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('400:Choose a month.');
 let key:string,load:()=>Promise<any>;
 if(kind==='cupid'){
  const app=p.get('app')||'',creator=p.get('creator');
  if(!(CUPID_APPS as readonly string[]).includes(app))throw new Error('400:Unknown Cupid platform.');
  if(creator!=null&&!ID.test(creator))throw new Error('400:Invalid Cupid creator ID.');
  key=`cupid|${month}|${app}|${creator??''}`;load=()=>cupid(month,app,creator);
 }else if(kind==='subs'){
  const account=p.get('account')||'';if(!ID.test(account))throw new Error('400:Invalid account.');
  key=`subs|${month}|${account}`;load=()=>subs(month,account);
 }else throw new Error('400:Unknown request.');
 let hit=cache.get(key);
 if(!hit||Date.now()-hit.at>TTL){
  const entry={at:Date.now(),data:load()};cache.set(key,entry);hit=entry;
  entry.data.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
  if(cache.size>500)cache.delete(cache.keys().next().value!);
 }
 return Response.json(await hit.data,{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return failure(e);}}
