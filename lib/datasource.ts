"use client";
import {useCallback} from 'react';
import {useInfiniteQuery,useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
export const datasource={define:<T,>(s:T):T=>s};
export const q={select:<T,>(s:T):T=>s,asc:(field:string)=>({field,direction:'asc'}),desc:(field:string)=>({field,direction:'desc'})};
async function json(url:string,init?:RequestInit):Promise<any>{const r=await fetch(url,init);const d:any=await r.json();if(!r.ok)throw new Error(d.error||'Request failed.');return d;}
export function useSession(){return useQuery({queryKey:['session'],queryFn:()=>json('/api/session'),staleTime:60000,retry:false});}
type RecordPage={items:{id:string;fields:Record<string,any>}[];nextCursor:string|null;total?:number};
type MutationOptions={from:string;fields?:Record<string,string>;onSuccess?:(result:any)=>unknown;onError?:(error:Error)=>unknown};
export function useRecords(o:any){
 const result=useInfiniteQuery({queryKey:['records',o.from,o.select,o.orderBy],initialPageParam:null as string|null,enabled:o.enabled!==false,staleTime:30000,retry:false,
 queryFn:({pageParam}):Promise<RecordPage>=>{const p=new URLSearchParams({select:JSON.stringify(o.select)});if(pageParam)p.set('offset',pageParam);if(o.orderBy){p.set('sort',o.orderBy.field);p.set('direction',o.orderBy.direction);}return json('/api/data/'+encodeURIComponent(o.from)+'?'+p);},getNextPageParam:(last)=>last.nextCursor||undefined});
 return result;
}
export function useFieldOptions(o:any):any{const r=useQuery({queryKey:['options',o.from,o.select[o.field]],queryFn:()=>json('/api/data/'+encodeURIComponent(o.from)+'?options='+encodeURIComponent(o.select[o.field])),staleTime:60000,retry:false});return {...r,options:r.data?.options??[]};}
function useRecordMutation(o:MutationOptions,method:string){
 const client=useQueryClient(),auth=useSession();
 const mutation=useMutation({mutationFn:async(value:any)=>{const recordId=method==='DELETE'?value:method==='PATCH'?value.recordId:undefined;const fields=method==='POST'?value:value.fields;
 const expected:Record<string,any>={};
 if(method!=='POST')for(const [key,data] of client.getQueriesData<any>({queryKey:['records',o.from]})){
  const row=data?.pages?.flatMap((p:any)=>p.items).find((r:any)=>r.id===recordId);const selected=key[2] as Record<string,string>|undefined;
  if(row&&selected)for(const [alias,name] of Object.entries(selected))if(Object.hasOwn(row.fields,alias))expected[name]=row.fields[alias];
 }
 return json('/api/data/'+encodeURIComponent(o.from),{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId,fields,select:o.fields??{},expected:value?.expected??expected})});},retry:false,
 onSuccess:async(result:any)=>{await client.invalidateQueries({queryKey:['records',o.from]});await client.invalidateQueries({queryKey:['library']});await o.onSuccess?.(result);},onError:(e:Error)=>o.onError?.(e)});
 return {...mutation,enabled:auth.data?.canEdit===true};
}
export const useRecordCreate=(o:MutationOptions)=>useRecordMutation(o,'POST');
export const useRecordUpdate=(o:MutationOptions)=>useRecordMutation(o,'PATCH');
export const useRecordDelete=(o:MutationOptions)=>useRecordMutation(o,'DELETE');
export function useProxyFetch(_source:any){return useCallback((url:string)=>fetch('/api/revenue?url='+encodeURIComponent(url)),[]);}
