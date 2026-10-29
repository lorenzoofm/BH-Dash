import { getUser } from '@/app/auth';
import { d1Request } from './d1-store';
export {projection,validateFields} from './data-rules';
import rawConfig from './data-config.json';
export const config:any=rawConfig;
const cache=new Map<string,{until:number,value:Promise<any>}>();
export function adminEmails(){return (process.env.ADMIN_EMAILS||'massi@20mg.co').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);}
export async function session(){const user=await getUser();return {user,canEdit:!!user,isAdmin:!!user&&adminEmails().includes(user.email.toLowerCase())};}
export async function guard(write=false){const s=await session();if((write||config.kind==='bh')&&!s.canEdit)throw new Error('403:Sign in with an authorised manager account.');return s;}
let generation=0;
export const dataGeneration=()=>generation;
export function clearCache(){cache.clear();generation++;}
// Caches a GET for 60s per isolate; a failed run is forgotten unless a newer run already replaced it.
function remember(key:string,run:()=>Promise<any>){
 const old=cache.get(key);if(old&&old.until>Date.now())return old.value;
 const value=run();cache.set(key,{until:Date.now()+60000,value});
 value.catch(()=>{if(cache.get(key)?.value===value)cache.delete(key);});
 if(cache.size>250)cache.delete(cache.keys().next().value!);
 return value;
}
// All BH data lives in the BH_DATA D1 database (see lib/d1-store.ts and data-migrations/).
export async function store(path:string,init:RequestInit={},cached=true):Promise<any>{
 const method=init.method||'GET';
 const run=async()=>d1Request(config.sources,path,init,method==='GET'?null:(await getUser())?.email??null);
 return method==='GET'&&cached?remember(path,run):run();
}
export function source(key:string){const s=Object.hasOwn(config.sources,key)?config.sources[key]:null;if(!s)throw new Error('404:Unknown data source.');return s;}
// Pages are fetched fresh and cached as one list, so a table is never stitched from pages of different ages.
export function allRows(s:any,fresh=false,query=new URLSearchParams()):Promise<any[]> {
 const run=async()=>{
  const result=[];let offset='';
  do {
   const params=new URLSearchParams(query);params.set('pageSize','100');if(offset)params.set('offset',offset);
   const p=await store(s.tableId+'?'+params,{},false);result.push(...p.records);offset=p.offset||'';
  }while(offset);
  return result;
 };
 return fresh?run():remember('all:'+s.tableId+'?'+query,run);
}
export async function formatRecords(s:any,rows:any[],select:Record<string,string>) {
 const labels=new Map<string,Map<string,string>>();
 await Promise.all([...new Set(Object.values(select))].map(async name=>{
  const field=s.fields.find((f:any)=>f.name===name);
  if(field?.type!=='LINKED_RECORD'||!rows.some(row=>row.fields[name]?.length))return;
  const target=Object.values(config.sources).find((t:any)=>t.table===field.options.linkedTableId) as any;
  if(!target||!['Staff','Models','Instagram Accounts'].includes(target.table))return;
  const referenced=await allRows(target,false,new URLSearchParams({'fields[]':target.primaryField}));
  labels.set(name,new Map(referenced.map((r:any)=>[r.id,r.fields[target.primaryField]??r.id])));
 }));
 return rows.map(row=>{
  const fields:Record<string,any>={};
  for(const [alias,name] of Object.entries(select)){
   let value=row.fields[name]??null;const field=s.fields.find((f:any)=>f.name===name);
   if(value!==null&&field.type==='PERCENT')value=Math.round(Number(value)*1e8)/1e6;
   if(value&&field.type==='LINKED_RECORD')value=value.map((id:string)=>({id,label:labels.get(name)?.get(id)??id}));
   fields[alias]=value;
  }
  return {id:row.id,fields};
 });
}
export async function formatRecord(s:any,row:any,select:Record<string,string>){return (await formatRecords(s,[row],select))[0];}
export function failure(e:any){const message=String(e?.message||'The request failed. Try again.');const match=message.match(/^(\d{3}):(.*)$/);return Response.json({error:match?match[2]:'The connection failed. Your changes have not been confirmed.'},{status:match?Number(match[1]):502});}
