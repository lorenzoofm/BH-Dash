import { session, adminEmails } from '@/lib/data-server';
import { getPolicy, normalizeEmail, policyEmails, setPolicyEmails } from '@/lib/access-policy';

export const dynamic = 'force-dynamic';
const env = () => ({ACCESS_ACCOUNT_ID:process.env.ACCESS_ACCOUNT_ID,ACCESS_APP_ID:process.env.ACCESS_APP_ID,ACCESS_POLICY_ID:process.env.ACCESS_POLICY_ID,ACCESS_API_TOKEN:process.env.ACCESS_API_TOKEN});
const failure = (error:unknown) => {
  const message = error instanceof Error ? error.message : '';
  const match = /^(\d{3}):(.*)$/.exec(message);
  return Response.json({error:match?.[2] || 'Cloudflare Access is unavailable.'},{status:match?Number(match[1]):503});
};
async function admin() { const s=await session(); if(!s.isAdmin) throw new Error('403:Administrator access required.'); return s; }
function sameOrigin(request:Request) { if (request.headers.get('origin') !== new URL(request.url).origin) throw new Error('403:Invalid request origin.'); }

export async function GET() {
  try { await admin(); const emails=policyEmails(await getPolicy(env())); return Response.json({emails,admins:adminEmails()},{headers:{'Cache-Control':'no-store'}}); }
  catch(error) { return failure(error); }
}
export async function POST(request:Request) {
  try {
    const s=await admin(); sameOrigin(request);
    const {email}=await request.json() as {email?:unknown};
    if(typeof email!=='string') throw new Error('400:Enter an email address.');
    const target=normalizeEmail(email);
    const current=policyEmails(await getPolicy(env()));
    if(current.includes(target)) throw new Error('409:This person already has access.');
    return Response.json({emails:await setPolicyEmails(env(),[...current,target]),invited:target,by:s.user?.email});
  } catch(error) { return failure(error); }
}
export async function DELETE(request:Request) {
  try {
    const s=await admin(); sameOrigin(request);
    const {email}=await request.json() as {email?:unknown};
    if(typeof email!=='string') throw new Error('400:Enter an email address.');
    const target=normalizeEmail(email);
    if(target===s.user?.email) throw new Error('400:You cannot remove your own access.');
    const current=policyEmails(await getPolicy(env()));
    if(!current.includes(target)) throw new Error('404:This person does not have access.');
    return Response.json({emails:await setPolicyEmails(env(),current.filter(value=>value!==target))});
  } catch(error) { return failure(error); }
}
