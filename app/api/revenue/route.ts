import {guard,failure} from '@/lib/data-server';
import {revenueURL} from '@/lib/revenue-request';
export const dynamic='force-dynamic';
const cache=new Map<string,{until:number;data:Promise<any>}>();
export async function GET(req:Request){try{
 await guard();const url=revenueURL(new URL(req.url).searchParams.get('url'));
 if(!process.env.CREATORSTAQ_AUTH)throw new Error('503:Creatorstaq is not connected yet.');
 const key=url.href;let entry=cache.get(key);
 if(!entry||entry.until<Date.now()){
  const data=fetch(url.href,{headers:{Authorization:process.env.CREATORSTAQ_AUTH},redirect:'manual',signal:AbortSignal.timeout(45000)}).then(async response=>{
   if(response.status>=300&&response.status<400)throw new Error('502:Creatorstaq redirected the revenue request.');
   if(!response.ok)throw new Error('502:Creatorstaq could not complete the revenue request ('+response.status+').');
   const body:any=await response.json();const rows=url.pathname.endsWith('/ranged')?body.by_creator:body.monthly_by_account;
   if(!Array.isArray(rows))throw new Error('502:Creatorstaq returned an incomplete revenue response.');return body;
  });entry={data,until:Date.now()+60000};cache.set(key,entry);data.catch(()=>cache.delete(key));if(cache.size>100)cache.delete(cache.keys().next().value!);
 }
 return Response.json(await entry.data,{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return failure(e);}}
