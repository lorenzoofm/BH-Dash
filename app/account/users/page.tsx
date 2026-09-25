'use client';
import {useEffect,useState} from 'react';
import {PAGES,DEFAULT_MANAGER_PAGES,type Page} from '@/lib/page-access-constants';

const names:Record<Page,string>={overview:'Overview',conversions:'Conversions',staff:'Staff', 'pay-hours':'Pay & Hours', expenses:'Expenses',pnl:'Profit & Loss',revenue:'Revenue'};
type Users={emails:string[];admins:string[];permissions:Record<string,Page[]>;editable:boolean};

export default function UsersPage(){
 const [users,setUsers]=useState<Users>({emails:[],admins:[],permissions:{},editable:false});
 const [email,setEmail]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(''),[ready,setReady]=useState(false),[invited,setInvited]=useState('');
 const load=async()=>{const response=await fetch('/api/users',{cache:'no-store'});const data=await response.json() as Users&{error?:string};if(!response.ok)throw new Error(data.error);setUsers(data);setReady(true);};
 useEffect(()=>{load().catch(e=>{setError(e.message);setReady(true);});},[]);
 const change=async(method:'POST'|'DELETE',target:string)=>{
  setBusy(target);setError('');
  try{const response=await fetch('/api/users',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({email:target})});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error);await load();if(method==='POST')setInvited(target);setEmail('');}
  catch(e){setError(e instanceof Error?e.message:'Could not update access.');}finally{setBusy('');}
 };
 const toggle=async(target:string,page:Page)=>{
  const current=users.permissions[target]??DEFAULT_MANAGER_PAGES;
  const pages=current.includes(page)?current.filter(p=>p!==page):[...current,page];
  setBusy(target);setError('');
  try{const response=await fetch('/api/users',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:target,pages})});const data=await response.json() as {error?:string;pages?:Page[]};if(!response.ok)throw new Error(data.error);setUsers(u=>({...u,permissions:{...u.permissions,[target]:data.pages!}}));}
  catch(e){setError(e instanceof Error?e.message:'Could not save page access.');}finally{setBusy('');}
 };
 const link=typeof window==='undefined'?'':window.location.origin;
 return <div className="mx-auto max-w-3xl space-y-6">
  <div><h1 className="text-3xl font-semibold">Dashboard users</h1><p className="mt-2 text-sm text-muted-foreground">Invite people through Cloudflare Access, then choose exactly which dashboard pages each manager may open.</p></div>
  <form onSubmit={e=>{e.preventDefault();void change('POST',email);}} className="flex gap-2"><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="manager@example.com" className="min-w-0 flex-1 rounded-md border px-3 py-2"/><button disabled={!!busy} className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Add manager</button></form>
  {invited&&<p className="rounded-md border border-green-300 p-3 text-green-800">{invited} can now sign in. <a className="underline" href={`mailto:${invited}?subject=${encodeURIComponent('Your 20MG BH dashboard access')}&body=${encodeURIComponent(`Open ${link} and sign in with this email address.`)}`}>Send invitation email</a></p>}
  {error&&<p role="alert" className="rounded-md border border-red-300 p-3 text-red-700">{error}</p>}
  {ready&&!users.editable&&<p role="status" className="rounded-md border border-amber-300 p-3 text-sm">Page controls are pending the Cloudflare permissions database. Current manager defaults remain active.</p>}
  <div className="space-y-3">{!ready?<p>Loading…</p>:users.emails.length?users.emails.map(value=>{
   const admin=users.admins.includes(value.toLowerCase());const selected=users.permissions[value]??DEFAULT_MANAGER_PAGES;
   return <section key={value} className="rounded-lg border p-4"><div className="flex items-center justify-between gap-3"><div><span className="break-all font-medium">{value}</span><span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">{admin?'Administrator':'Manager'}</span></div><button disabled={!!busy} onClick={()=>{if(confirm(`Remove dashboard access for ${value}?`))void change('DELETE',value);}} className="text-sm text-red-700 disabled:opacity-50">Deactivate</button></div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{PAGES.map(page=><label key={page} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={admin||selected.includes(page)} disabled={admin||!!busy||!users.editable} onChange={()=>void toggle(value,page)}/>{names[page]}</label>)}</div>
    {admin&&<p className="mt-2 text-xs text-muted-foreground">Administrators always have all pages.</p>}
   </section>;
  }):<p>No users configured.</p>}</div>
  <div className="space-y-2 text-sm"><p>Changes to page access take effect on the next request. The same Airtable records continue to power both dashboards.</p><div className="flex gap-2"><input readOnly value={link} aria-label="Dashboard URL" className="min-w-0 flex-1 rounded-md border px-3 py-2"/><button onClick={()=>void navigator.clipboard.writeText(link)} className="rounded-md border px-4 py-2">Copy link</button></div></div>
 </div>;
}
