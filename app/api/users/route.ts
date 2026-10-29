import { session, adminEmails } from '@/lib/data-server';
import {pagesFor,setPages,pagePermissionsReady,listManagers,addManager,removeManager} from '@/lib/page-access';

export const dynamic = 'force-dynamic';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) throw new Error('400:Enter a valid email address.');
  return email;
}
const failure = (error:unknown) => {
  const message = error instanceof Error ? error.message : '';
  const match = /^(\d{3}):(.*)$/.exec(message);
  return Response.json({error:match?.[2] || 'User management is unavailable.'},{status:match?Number(match[1]):503});
};
async function admin() { const s=await session(); if(!s.isAdmin) throw new Error('403:Administrator access required.'); return s; }
function sameOrigin(request:Request) { if (request.headers.get('origin') !== new URL(request.url).origin) throw new Error('403:Invalid request origin.'); }
async function everyone() { const admins=adminEmails(); return [...new Set([...admins,...await listManagers()])]; }

export async function GET() {
  try { await admin(); const emails=await everyone(); const admins=adminEmails(); const permissions=Object.fromEntries(await Promise.all(emails.map(async email=>[email,await pagesFor(email,admins.includes(email))]))); return Response.json({emails,admins,permissions,editable:pagePermissionsReady()},{headers:{'Cache-Control':'no-store'}}); }
  catch(error) { return failure(error); }
}
export async function POST(request:Request) {
  try {
    const s=await admin(); sameOrigin(request);
    const {email}=await request.json() as {email?:unknown};
    if(typeof email!=='string') throw new Error('400:Enter an email address.');
    const target=normalizeEmail(email);
    if((await everyone()).includes(target)) throw new Error('409:This person already has access.');
    await addManager(target,s.user!.email);
    return Response.json({emails:await everyone(),invited:target,by:s.user?.email});
  } catch(error) { return failure(error); }
}
export async function PATCH(request:Request) {
  try {
    await admin();sameOrigin(request);
    const {email,pages}=await request.json() as {email?:unknown;pages?:unknown};
    if(typeof email!=='string')throw new Error('400:Enter an email address.');
    const target=normalizeEmail(email);
    if(adminEmails().includes(target))throw new Error('403:Administrator pages are configured outside the dashboard.');
    if(!(await listManagers()).includes(target))throw new Error('404:This person does not have access.');
    return Response.json({email:target,pages:await setPages(target,pages)});
  }catch(error){return failure(error);}
}
export async function DELETE(request:Request) {
  try {
    const s=await admin(); sameOrigin(request);
    const {email}=await request.json() as {email?:unknown};
    if(typeof email!=='string') throw new Error('400:Enter an email address.');
    const target=normalizeEmail(email);
    if(target===s.user?.email) throw new Error('400:You cannot remove your own access.');
    if(adminEmails().includes(target)) throw new Error('403:Administrator access is configured outside the dashboard.');
    if(!(await listManagers()).includes(target)) throw new Error('404:This person does not have access.');
    await removeManager(target);return Response.json({emails:await everyone()});
  } catch(error) { return failure(error); }
}
