import {guard,failure} from '@/lib/data-server';
import {pagesFor} from '@/lib/page-access';
import {CUPID_APPS,cupidMetrics,monthDays,monthRange,shiftMonth} from '@/lib/convos';
export const dynamic='force-dynamic';
// One upstream source per request, so each call stays well inside the Worker subrequest limit:
//   ?kind=cupid&month=2026-10&app=x[&creator=ID]   Cupid funnel for a month (all creators when omitted)
//   ?kind=cupid-daily&month=2026-10&app=x[&creator=ID]   the same funnel day by day (Cupid only totals a range, so one call per day, at most 31)
//   ?kind=cupid-months&month=2026-10&app=x[&creator=ID][&n=6]   one funnel per month for the n months ending at month (n <= 12)
//   ?kind=subs&month=2026-10&account=slug           Creatorstaq new subs for one OF account, split by first-touch source and day
//   ?kind=subs-months&month=2026-10&account=slug[&n=6]   Creatorstaq's new-sub total per month for the n months ending at month
// Months are UTC calendar months on both sides so the two line up. Each upstream call is cached per isolate:
// 10 min, or 6 h once its range ended 3+ days ago (conversions settle a day or two late).
const TTL=10*60000,CLOSED=6*3600000,cache=new Map<string,{at:number;ttl:number;data:Promise<any>}>();
function cached<T>(key:string,last:string,load:()=>Promise<T>):Promise<T>{
 const ttl=last<new Date(Date.now()-3*864e5).toISOString().slice(0,10)?CLOSED:TTL;
 let hit=cache.get(key);
 if(!hit||Date.now()-hit.at>hit.ttl){
  const entry={at:Date.now(),ttl,data:load()};cache.set(key,entry);hit=entry;
  entry.data.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
  if(cache.size>3000)cache.delete(cache.keys().next().value!);
 }
 return hit.data;
}
const ID=/^[A-Za-z0-9_-]{1,64}$/;
// ponytail: stops after 50 pages (5,000 subs in or after the month); raise it if an account outgrows that.
const MAX_PAGES=50;

const cupid=(start:string,last:string,app:string,creator:string|null)=>cached(`c|${start}|${last}|${app}|${creator??''}`,last,()=>cupidLoad(start,last,app,creator));
async function cupidLoad(start:string,last:string,app:string,creator:string|null){
 const token=process.env.CUPID_TOKEN;if(!token)throw new Error('503:Cupid is not connected yet. Add the CUPID_TOKEN secret.');
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

async function newSubsIn(month:string,account:string){
 if(!process.env.CREATORSTAQ_AUTH)throw new Error('503:Creatorstaq is not connected yet.');
 const {start,next}=monthRange(month);
 const overview=await creatorstaq(`/computed/${encodeURIComponent(account)}/overview/ranged?start=${start}&end=${next}`);
 const raw=overview?.kpis?.new_subs,n=raw==null?null:Number(typeof raw==='object'?raw.value:raw);
 return Number.isFinite(n)?n:null;
}

async function subs(month:string,account:string){
 const {start,next}=monthRange(month),a=encodeURIComponent(account),newSubs=await newSubsIn(month,account);
 // Newest first, so the walk stops at the first fan who subscribed before the month.
 const bySource:Record<string,number>={},byDay:Record<string,Record<string,number>>={};let counted=0,capped=true;
 for(let page=1;page<=MAX_PAGES;page++){
  const body=await creatorstaq(`/computed/${a}/subscribers?sort=subscribe_at&order=desc&pageSize=100&page=${page}`);
  const rows:any[]=body?.data??body?.items??body?.rows??[];
  for(const r of rows){
   const day=String(r.subscribe_at??'').slice(0,10);if(!day||day>=next)continue;
   if(day<start){capped=false;break;}
   const src=String(r.source??'untracked').toLowerCase();bySource[src]=(bySource[src]??0)+1;counted++;
   const d=byDay[day]??={};d[src]=(d[src]??0)+1;
  }
  if(!capped||rows.length<100){capped=false;break;}
 }
 return {newSubs,counted,bySource,byDay,capped};
}

export async function GET(req:Request){try{
 const actor=await guard();const pages=await pagesFor(actor.user!.email,actor.isAdmin);
 if(!pages.includes('convos'))throw new Error('403:Convo Tracker access is not enabled for your account.');
 const p=new URL(req.url).searchParams,kind=p.get('kind'),month=p.get('month')||'';
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('400:Choose a month.');
 const n=Number(p.get('n')??6);if(!Number.isInteger(n)||n<1||n>12)throw new Error('400:Ask for 1 to 12 months.');
 const months=Array.from({length:n},(_,i)=>shiftMonth(month,i-n+1));
 let data:Promise<any>;
 if(kind==='cupid'||kind==='cupid-daily'||kind==='cupid-months'){
  const app=p.get('app')||'',creator=p.get('creator');
  if(!(CUPID_APPS as readonly string[]).includes(app))throw new Error('400:Unknown Cupid platform.');
  if(creator!=null&&!ID.test(creator))throw new Error('400:Invalid Cupid creator ID.');
  if(kind==='cupid'){const {start,last}=monthRange(month);data=cupid(start,last,app,creator);}
  else if(kind==='cupid-months')data=Promise.all(months.map(async m=>{const {start,last}=monthRange(m);return {month:m,...await cupid(start,last,app,creator)};})).then(months=>({months}));
  else data=(async()=>{
   // Six days at a time keeps Cupid and the Worker's subrequest budget comfortable (a month is at most 31 calls).
   const days=monthDays(month,new Date().toISOString().slice(0,10)),out:any[]=[];
   for(let i=0;i<days.length;i+=6)out.push(...await Promise.all(days.slice(i,i+6).map(async date=>({date,...await cupid(date,date,app,creator)}))));
   return {days:out};
  })();
 }else if(kind==='subs'||kind==='subs-months'){
  const account=p.get('account')||'';if(!ID.test(account))throw new Error('400:Invalid account.');
  data=kind==='subs'?cached(`s|${month}|${account}`,monthRange(month).last,()=>subs(month,account))
   :Promise.all(months.map(async m=>({month:m,newSubs:await cached(`n|${m}|${account}`,monthRange(m).last,()=>newSubsIn(m,account))}))).then(months=>({months}));
 }else throw new Error('400:Unknown request.');
 return Response.json(await data,{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return failure(e);}}
