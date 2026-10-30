import {guard,source,projection,store,formatRecord,formatRecords,allRows,validateFields,clearCache,failure,config} from '@/lib/data-server';
import {uniqueFields,sameValue} from '@/lib/data-rules';
import {pagesFor,type Page} from '@/lib/page-access';
export const dynamic='force-dynamic';
const response=(body:any)=>Response.json(body,{headers:{'Cache-Control':'private, no-store'}});
const tablePages:Record<string,Page[]>={staff:['overview','staff','conversions','pay-hours','pnl'],models:['overview','staff','pnl','revenue'],conversions:['overview','conversions','staff','pnl'],expectations:['overview','staff','conversions'],paylog:['overview','staff','pay-hours','pnl'],expenses:['expenses','pnl'],map:['pnl','revenue'],paidSubs:['conversions'],payPeriods:['overview','pay-hours','pnl'],payStaff:['overview','pay-hours','pnl'],payAdjustments:['overview','pay-hours','pnl'],expenseViews:['expenses']};
// Writes need the page that edits the table, not just one that reads it.
const writePages:Record<string,Page[]>={staff:['staff'],expectations:['staff'],conversions:['conversions'],paidSubs:['conversions'],paylog:['pay-hours'],expenses:['expenses'],models:['pnl','revenue'],map:['pnl','revenue'],payPeriods:['pay-hours'],payStaff:['pay-hours'],payAdjustments:['pay-hours'],expenseViews:['expenses']};
// Fields hidden unless the user has one of the listed pages.
const privateFields:Record<string,{fields:Set<string>;pages:Page[]}>={
 models:{fields:new Set(["Deal Type","Model's Cut %","Our Cut %","Payout Basis"]),pages:['pnl']},
 staff:{fields:new Set(["Current Hourly Rate"]),pages:['staff','pay-hours','pnl']},
 paylog:{fields:new Set(["Hourly Rate Snapshot","Bonus","Deductions","Total Pay"]),pages:['staff','pay-hours','pnl']},
 payStaff:{fields:new Set(["Rate Snapshot"]),pages:['pay-hours','pnl']},
 payAdjustments:{fields:new Set(["Value"]),pages:['pay-hours','pnl']},
};
const hidden=(key:string,pages:Page[],field:string)=>{const p=privateFields[key];return !!p&&p.fields.has(field)&&!p.pages.some(page=>pages.includes(page));};
async function access(actor:Awaited<ReturnType<typeof guard>>,key:string,write=false){const pages=await pagesFor(actor.user!.email,actor.isAdmin);if(!(write?writePages:tablePages)[key]?.some(page=>pages.includes(page)))throw new Error('403:This data is not enabled for your account.');return pages;}
export async function GET(req:Request,{params}:any){try{
 const actor=await guard();const {key}=await params,s=source(key),url=new URL(req.url);
 const pages=await access(actor,key);
 if(url.searchParams.has('options')){
  const name=url.searchParams.get('options'),f=s.fields.find((f:any)=>f.name===name);if(!f)throw new Error('400:Unknown field.');
  if(hidden(key,pages,name!))throw new Error('403:This field is not enabled for your account.');
  let options=f.options?.choices??[];
  if(s.table==='Expense Log'&&name==='Category'){const values=(await allRows(s)).map(r=>r.fields.Category).filter(Boolean);options=[...new Set([...options.map((o:any)=>o.label),...values])].sort().map(label=>({label,value:label}));}
  return response({options});
 }
 let raw:any;try{raw=JSON.parse(url.searchParams.get('select')||'{}');}catch{throw new Error('400:Invalid field selection.');}
 const select=projection(s,raw),query=new URLSearchParams({pageSize:'100'});
 for(const [alias,field] of Object.entries(select))if(hidden(key,pages,field as string))delete select[alias];
 [...new Set(Object.values(select))].forEach(f=>query.append('fields[]',f));
 const offset=url.searchParams.get('offset');if(offset){if(offset.length>1024)throw new Error('400:Invalid page.');query.set('offset',offset);}
 const sort=url.searchParams.get('sort');if(sort){if(!select[sort])throw new Error('400:Unknown sort field.');query.set('sort[0][field]',select[sort]);query.set('sort[0][direction]',url.searchParams.get('direction')==='desc'?'desc':'asc');}
 if(key==='expenseViews'){const me=actor.user!.email.toLowerCase();const records=(await allRows(s,true)).filter(r=>String(r.fields['User Email']??'').toLowerCase()===me);return response({items:await formatRecords(s,records,select),nextCursor:null});}
 const result=url.searchParams.get('all')==='1'&&!offset?{records:await allRows(s,false,query),offset:null}:await store(s.tableId+'?'+query);
 return response({items:await formatRecords(s,result.records,select),nextCursor:result.offset??null});
 }catch(e){return failure(e);}}
// ponytail: serialises this worker's writes so the conflict and uniqueness checks below see a stable table.
let writeQueue:Promise<unknown>=Promise.resolve();
async function mutate(req:Request,context:any){
 try{await guard(true);if(req.headers.get('origin')!==new URL(req.url).origin)throw new Error('403:Invalid request origin.');}catch(e){return failure(e);}
 const run=writeQueue.then(()=>save(req,context));writeQueue=run.catch(()=>{});return run;
}
async function save(req:Request,{params}:any){try{
 const actor=await guard(true);
 if(Number(req.headers.get('content-length'))>200000)throw new Error('413:Record is too large.');
 const {key}=await params,s=source(key);await access(actor,key,true);if((key==='models'||key==='map')&&!actor.isAdmin)throw new Error('403:Administrator access required for model finance settings.');if(!s.actions[req.method])throw new Error('403:This action is unavailable.');
 const text=await req.text();if(text.length>200000)throw new Error('413:Record is too large.');let body:any;try{body=JSON.parse(text);}catch{throw new Error('400:Invalid record.');}
 const id=body.recordId;if(req.method!=='POST'&&(typeof id!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(id)))throw new Error('400:Invalid record.');
 const select=projection(s,body.select||{}),fields=req.method==='DELETE'?{}:validateFields(s,req.method,select,body.fields);
 if(fields.Currency!=null&&fields.Currency!=='USD')throw new Error('400:All amounts must be in USD.');
 let existing:any;
 // Deleting a row that is already gone (double click, two tabs) is a success, not an error.
 if(id){try{existing=await store(s.tableId+'/'+id,{},false);}catch(e:any){if(req.method==='DELETE'&&String(e?.message).startsWith('404:'))return response({id,deleted:true});throw e;}}
 if(key==='expenseViews'){if(existing&&String(existing.fields['User Email']??'').toLowerCase()!==actor.user!.email.toLowerCase())throw new Error('404:That view no longer exists.');if(req.method==='POST')fields['User Email']=actor.user!.email.toLowerCase();}
 if(existing){
  if(!body.expected||typeof body.expected!=='object'||Array.isArray(body.expected)||Object.keys(body.expected).length===0||Object.keys(body.expected).length>50)throw new Error('409:Refresh this record before saving.');
  for(const [name,value] of Object.entries(body.expected)){
   if(!s.fields.some((f:any)=>f.name===name))throw new Error('400:Unknown expected field.');
   const current=(await formatRecord(s,existing,{value:name})).fields.value;
   if(!sameValue(current,value))throw new Error('409:This record changed since it was loaded. Refresh and review it before saving.');
  }
 }
 // Staff with history can't be deleted (it would orphan their pay and conversions); set them Inactive instead.
 if(req.method==='DELETE'&&key==='staff'){
  for(const k of ['paylog','conversions','payStaff','payAdjustments','expectations']){
   const t=source(k),f=t.fields.find((f:any)=>f.name==='Staff');
   if((await allRows(t,true)).some((r:any)=>(r.fields[f.name]??[]).includes(id)))throw new Error('409:This person has pay or conversion records. Set them to Inactive instead.');
  }
 }
 if(req.method!=='DELETE'){
  for(const [name,value] of Object.entries(fields)){
   const f=s.fields.find((f:any)=>f.name===name);if(f.type!=='LINKED_RECORD'||!Array.isArray(value))continue;
   const target=Object.values(config.sources).find((t:any)=>t.tableId===f.rawOptions?.linkedTableId||t.table===f.options?.linkedTableId) as any;
   if(!target)throw new Error('400:Unknown linked table.');
   for(const linkedId of value)await store(target.tableId+'/'+linkedId);
  }
  const merged={...existing?.fields,...fields},keys=uniqueFields[s.table];
  if(keys&&keys.every(k=>merged[k]!=null&&merged[k]!=='')){
   const rows=await allRows(s,true);
   if(rows.some(r=>r.id!==id&&keys.every(k=>sameValue(r.fields[k],merged[k]))))throw new Error('409:An entry already exists. Refresh and edit the existing record.');
  }
  if(req.method==='POST'){
   if(s.table==='Pay Log')fields['Submitted By']=actor.user!.email;
   if(s.table==='Expense Log')fields['Created By']=actor.user!.email;
  }else{delete fields['Submitted By'];delete fields['Created By'];}
 }
 const result=await store(s.tableId+(id?'/'+id:''),{method:req.method,...(req.method!=='DELETE'?{body:JSON.stringify({fields})}:{})},false);clearCache();
 return response(req.method==='DELETE'?result:await formatRecord(s,result,select));
 }catch(e){return failure(e);}}
export const POST=mutate;export const PATCH=mutate;export const DELETE=mutate;
