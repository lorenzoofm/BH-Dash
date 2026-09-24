'use client';
import {useEffect,useState} from 'react';

export default function UsersPage(){
 const [emails,setEmails]=useState<string[]>([]),[email,setEmail]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[invited,setInvited]=useState('');
 const load=async()=>{const response=await fetch('/api/users',{cache:'no-store'});const data=await response.json() as {error?:string;emails:string[]};if(!response.ok)throw new Error(data.error);setEmails(data.emails);setReady(true);};
 useEffect(()=>{load().catch(e=>{setError(e.message);setReady(true);});},[]);
 const change=async(method:'POST'|'DELETE',target:string)=>{
  setBusy(true);setError('');
  try{const response=await fetch('/api/users',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({email:target})});const data=await response.json() as {error?:string;emails:string[]};if(!response.ok)throw new Error(data.error);setEmails(data.emails);if(method==='POST')setInvited(target);setEmail('');}
  catch(e){setError(e instanceof Error?e.message:'Could not update access.');}
  finally{setBusy(false);}
 };
 const link=typeof window==='undefined'?'':window.location.origin;
 return <div className="mx-auto max-w-2xl space-y-6"><div><h1 className="text-3xl font-semibold">Dashboard users</h1><p className="mt-2 text-sm text-muted-foreground">Invite a manager by email. Cloudflare Access verifies their identity when they open this dashboard.</p></div>
  <form onSubmit={e=>{e.preventDefault();void change('POST',email);}} className="flex gap-2"><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="manager@example.com" className="min-w-0 flex-1 rounded-md border px-3 py-2"/><button disabled={busy} className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Add manager</button></form>
  {invited&&<p className="rounded-md border border-green-300 p-3 text-green-800">{invited} can now sign in. <a className="underline" href={`mailto:${invited}?subject=${encodeURIComponent('Your 20MG BH dashboard access')}&body=${encodeURIComponent(`Open ${link} and sign in with this email address.`)}`}>Send invitation email</a></p>}
  {error&&<p role="alert" className="rounded-md border border-red-300 p-3 text-red-700">{error}</p>}
  <div className="rounded-lg border"><div className="border-b px-4 py-3 text-sm font-semibold">People with access</div>{!ready?<p className="p-4">Loading…</p>:emails.length?emails.map(value=><div key={value} className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-0"><span className="break-all">{value}</span><button disabled={busy} onClick={()=>{if(confirm(`Remove dashboard access for ${value}?`))void change('DELETE',value);}} className="text-sm text-red-700 disabled:opacity-50">Deactivate</button></div>):<p className="p-4">No managers configured.</p>}</div>
  <div className="space-y-2 text-sm"><p>After adding a manager, share the dashboard URL. Cloudflare sends their sign-in code; they do not need a Cloudflare account.</p><div className="flex gap-2"><input readOnly value={link} aria-label="Dashboard URL" className="min-w-0 flex-1 rounded-md border px-3 py-2"/><button onClick={()=>void navigator.clipboard.writeText(link)} className="rounded-md border px-4 py-2">Copy link</button></div><p>Deactivation removes the email from the Access policy. An existing session may remain valid for about 15 seconds while the Worker cache expires.</p></div>
 </div>;
}
