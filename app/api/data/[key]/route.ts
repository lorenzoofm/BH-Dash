import {guard,source,projection,airtable,formatRecord,allRows,validateFields,clearCache,failure,config} from '@/lib/data-server';
import {uniqueFields,sameValue} from '@/lib/data-rules';
export const dynamic='force-dynamic';
const response=(body:any)=>Response.json(body,{headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:Request,{params}:any){try{
 await guard();const {key}=await params,s=source(key),url=new URL(req.url);
 if(url.searchParams.has('options')){
  const name=url.searchParams.get('options'),f=s.fields.find((f:any)=>f.name===name);if(!f)throw new Error('400:Unknown field.');
  let options=f.options?.choices??[];
  if(s.table==='Expense Log'&&name==='Category'){const values=(await allRows(s)).map(r=>r.fields.Category).filter(Boolean);options=[...new Set([...options.map((o:any)=>o.label),...values])].sort().map(label=>({label,value:label}));}
  return response({options});
 }
 let raw:any;try{raw=JSON.parse(url.searchParams.get('select')||'{}');}catch{throw new Error('400:Invalid field selection.');}
 const select=projection(s,raw),query=new URLSearchParams({pageSize:'100'});
 [...new Set(Object.values(select))].forEach(f=>query.append('fields[]',f));
 const offset=url.searchParams.get('offset');if(offset){if(offset.length>1024)throw new Error('400:Invalid page.');query.set('offset',offset);}
 const sort=url.searchParams.get('sort');if(sort){if(!select[sort])throw new Error('400:Unknown sort field.');query.set('sort[0][field]',select[sort]);query.set('sort[0][direction]',url.searchParams.get('direction')==='desc'?'desc':'asc');}
 const result=await airtable(s.tableId+'?'+query);
 return response({items:await Promise.all(result.records.map((r:any)=>formatRecord(s,r,select))),nextCursor:result.offset??null});
 }catch(e){return failure(e);}}
// ponytail: serialises this worker's writes; Airtable has no cross-client conditional-write transaction.
// Softr/external writers can still race. Keep a pre-write conflict check and retain backups during overlap.
let writeQueue:Promise<unknown>=Promise.resolve();
async function mutate(req:Request,context:any){
 try{await guard(true);if(req.headers.get('origin')!==new URL(req.url).origin)throw new Error('403:Invalid request origin.');}catch(e){return failure(e);}
 const run=writeQueue.then(()=>save(req,context));writeQueue=run.catch(()=>{});return run;
}
async function save(req:Request,{params}:any){try{
 const actor=await guard(true);
 if(Number(req.headers.get('content-length'))>200000)throw new Error('413:Record is too large.');
 const {key}=await params,s=source(key);if(!s.actions[req.method])throw new Error('403:This action is unavailable.');
 const text=await req.text();if(text.length>200000)throw new Error('413:Record is too large.');let body:any;try{body=JSON.parse(text);}catch{throw new Error('400:Invalid record.');}
 const id=body.recordId;if(req.method!=='POST'&&(typeof id!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(id)))throw new Error('400:Invalid record.');
 const select=projection(s,body.select||{}),fields=req.method==='DELETE'?{}:validateFields(s,req.method,select,body.fields);
 const existing=id?await airtable(s.tableId+'/'+id,{},false):undefined;
 if(existing){
  if(!body.expected||typeof body.expected!=='object'||Array.isArray(body.expected)||Object.keys(body.expected).length===0||Object.keys(body.expected).length>50)throw new Error('409:Refresh this record before saving.');
  for(const [name,value] of Object.entries(body.expected)){
   if(!s.fields.some((f:any)=>f.name===name))throw new Error('400:Unknown expected field.');
   const current=(await formatRecord(s,existing,{value:name})).fields.value;
   if(!sameValue(current,value))throw new Error('409:This record changed since it was loaded. Refresh and review it before saving.');
  }
 }
 if(req.method!=='DELETE'){
  for(const [name,value] of Object.entries(fields)){
   const f=s.fields.find((f:any)=>f.name===name);if(f.type!=='LINKED_RECORD'||!Array.isArray(value))continue;
   const target=Object.values(config.sources).find((t:any)=>t.tableId===f.rawOptions?.linkedTableId||t.table===f.options?.linkedTableId) as any;
   if(!target)throw new Error('400:Unknown linked table.');
   for(const linkedId of value)await airtable(target.tableId+'/'+linkedId);
  }
  const merged={...existing?.fields,...fields},keys=uniqueFields[s.table];
  if(keys&&keys.every(k=>merged[k]!=null&&merged[k]!=='')){
   const rows=await allRows(s,true);
   if(rows.some(r=>r.id!==id&&keys.every(k=>sameValue(r.fields[k],merged[k]))))throw new Error('409:An entry already exists. Refresh and edit the existing record.');
  }
  if(req.method==='POST'){
   if(s.table==='Pay Log')fields['Submitted By']=actor.user!.email;
   if(s.table==='Expense Log')fields['Created By']=actor.user!.email;
  }
 }
 const result=await airtable(s.tableId+(id?'/'+id:''),{method:req.method,...(req.method!=='DELETE'?{body:JSON.stringify({fields,...(s.table==='Expense Log'&&fields.Category?{typecast:true}:{})})}:{})},false);clearCache();
 return response(req.method==='DELETE'?result:await formatRecord(s,result,select));
 }catch(e){return failure(e);}}
export const POST=mutate;export const PATCH=mutate;export const DELETE=mutate;
