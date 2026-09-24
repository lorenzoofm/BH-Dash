export type Policy = { id: string; name: string; decision: string; include: Array<{email?: {email?: string}}>; exclude?: unknown[]; require?: unknown[] };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cache = new Map<string,{until:number; emails:string[]}>();
export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) throw new Error('400:Enter a valid email address.');
  return email;
}
export function policyEmails(policy: Policy) {
  if (policy.decision !== 'allow' || !Array.isArray(policy.include) || !policy.include.length || policy.exclude?.length || policy.require?.length) throw new Error('503:Access policy must be an Allow policy with only exact email rules.');
  return policy.include.map(rule => {
    if (Object.keys(rule).length !== 1 || !rule.email?.email) throw new Error('503:Access policy has a rule this dashboard cannot manage.');
    return normalizeEmail(rule.email.email);
  });
}
export async function getPolicy(env: { ACCESS_ACCOUNT_ID?:string; ACCESS_APP_ID?:string; ACCESS_POLICY_ID?:string; ACCESS_API_TOKEN?:string }): Promise<Policy> {
  if (!env.ACCESS_ACCOUNT_ID || !env.ACCESS_APP_ID || !env.ACCESS_POLICY_ID || !env.ACCESS_API_TOKEN) throw new Error('503:Access user management is not configured.');
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.ACCESS_ACCOUNT_ID)}/access/apps/${encodeURIComponent(env.ACCESS_APP_ID)}/policies/${encodeURIComponent(env.ACCESS_POLICY_ID)}`;
  const response = await fetch(url, { headers:{Authorization:`Bearer ${env.ACCESS_API_TOKEN}`}, signal:AbortSignal.timeout(10000), cache:'no-store' });
  const data = await response.json() as {success?:boolean;result?:Policy};
  if (!response.ok || !data.success || !data.result || data.result.id !== env.ACCESS_POLICY_ID) throw new Error('503:Cloudflare Access policy is unavailable.');
  policyEmails(data.result);
  return data.result;
}
export async function allowedEmails(env: Parameters<typeof getPolicy>[0]) {
  const key = `${env.ACCESS_ACCOUNT_ID}:${env.ACCESS_APP_ID}:${env.ACCESS_POLICY_ID}`;
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.emails;
  const emails = policyEmails(await getPolicy(env));
  cache.set(key,{emails,until:Date.now()+15000});
  return emails;
}
export async function setPolicyEmails(env: Parameters<typeof getPolicy>[0], emailList:string[]) {
  const policy = await getPolicy(env);
  const emails = [...new Set(emailList.map(normalizeEmail))];
  if (!emails.length) throw new Error('400:At least one manager must remain.');
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.ACCESS_ACCOUNT_ID!)}/access/apps/${encodeURIComponent(env.ACCESS_APP_ID!)}/policies/${encodeURIComponent(env.ACCESS_POLICY_ID!)}`;
  const response = await fetch(url,{method:'PUT',headers:{Authorization:`Bearer ${env.ACCESS_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({name:policy.name,decision:'allow',include:emails.map(email=>({email:{email}}))}),signal:AbortSignal.timeout(10000)});
  const data = await response.json() as {success?:boolean;result?:Policy};
  if (!response.ok || !data.success || !data.result) throw new Error('502:Cloudflare did not save the Access policy.');
  const saved = policyEmails(data.result);
  if (emails.some(email=>!saved.includes(email)) || saved.length !== emails.length) throw new Error('502:Cloudflare returned a different Access policy.');
  cache.clear();
  return saved;
}
