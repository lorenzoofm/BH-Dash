import { getUser } from '@/app/auth';
export {projection,validateFields} from './data-rules';
import rawConfig from './data-config.json';
export const config:any=rawConfig;
const cache=new Map<string,{until:number,value:Promise<any>}>();
let nextRequest=0;
const pause=(ms:number)=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
export function adminEmails(){return (process.env.ADMIN_EMAILS||'massi@20mg.co').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);}
export async function session(){const user=await getUser();return {user,canEdit:!!user,isAdmin:!!user&&adminEmails().includes(user.email.toLowerCase())};}
export async function guard(write=false){const s=await session();if((write||config.kind==='bh')&&!s.canEdit)throw new Error('403:Sign in with an authorised manager account.');return s;}
let generation=0;
export const dataGeneration=()=>generation;
export function clearCache(){cache.clear();generation++;}
export async function airtable(path:string,init:RequestInit={},cached=true):Promise<any>{
 if(!process.env.AIRTABLE_TOKEN)throw new Error('503:The Airtable connection has not been configured.');
 const method=init.method||'GET',key=path;
 if(method==='GET'&&cached){const old=cache.get(key);if(old&&old.until>Date.now())return old.value;}
 const run=async()=>{
  for(let attempt=0;attempt<4;attempt++){
   const slot=Math.max(Date.now(),nextRequest);nextRequest=slot+275;await pause(slot-Date.now());
   const r=await fetch('https://api.airtable.com/v0/'+config.baseId+'/'+path,{...init,headers:{Authorization:'Bearer '+process.env.AIRTABLE_TOKEN,'Content-Type':'application/json'},signal:AbortSignal.timeout(45000)});
   if(r.status===429&&attempt<3){await pause(30000);continue;}
   if(!r.ok)throw new Error((r.status===403?'503:':'502:')+'Airtable request failed ('+r.status+'). Your changes have not been confirmed.');
   return r.json();
  }
 };
 const result=run();
 if(method==='GET'&&cached){cache.set(key,{until:Date.now()+60000,value:result});result.catch(()=>cache.delete(key));if(cache.size>250)cache.delete(cache.keys().next().value!);}
 return result;
}
export function source(key:string){const s=Object.hasOwn(config.sources,key)?config.sources[key]:null;if(!s)throw new Error('404:Unknown data source.');return s;}
export async function allRows(s:any,fresh=false){const result=[];let offset='';do{const p=await airtable(s.tableId+'?pageSize=100'+(offset?'&offset='+encodeURIComponent(offset):''),{},!fresh);result.push(...p.records);offset=p.offset||'';}while(offset);return result;}
export async function formatRecord(s:any,row:any,select:Record<string,string>){
 const fields:Record<string,any>={};
 for(const [alias,name] of Object.entries(select)){
  let value=row.fields[name]??null;const field=s.fields.find((f:any)=>f.name===name);
  if(value!==null&&field.type==='PERCENT')value=Number(value)*100;
  if(value&&field.type==='LINKED_RECORD'){
   const target=Object.values(config.sources).find((t:any)=>t.table===field.options.linkedTableId) as any;
   const referenced=target&&['Staff','Models','Instagram Accounts'].includes(target.table)?await allRows(target):[];
   value=value.map((id:string)=>({id,label:referenced.find((r:any)=>r.id===id)?.fields[target?.primaryField]??id}));
  }
  fields[alias]=value;
 }
 return {id:row.id,fields};
}
export function failure(e:any){const message=String(e?.message||'The request failed. Try again.');const match=message.match(/^(\d{3}):(.*)$/);return Response.json({error:match?match[2]:'The connection failed. Your changes have not been confirmed.'},{status:match?Number(match[1]):502});}
