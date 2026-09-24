import { createRemoteJWKSet, jwtVerify } from 'jose';
import { allowedEmails } from './access-policy.ts';
export type AccessEnv = { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; ACCESS_ACCOUNT_ID?:string; ACCESS_APP_ID?:string; ACCESS_POLICY_ID?:string; ACCESS_API_TOKEN?:string };
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function accessUser(headers: Headers, env: AccessEnv) {
  const issuer = env.ACCESS_TEAM_DOMAIN, audience = env.ACCESS_AUD;
  const token = headers.get('cf-access-jwt-assertion');
  if (!token || !audience || !issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(issuer)) return null;
  try {
    let keys = keySets.get(issuer);
    if (!keys) { keys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs')); keySets.set(issuer, keys); }
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string') return null;
    const email = payload.email.trim().toLowerCase();
    if (!(await allowedEmails(env)).includes(email)) return null;
    return { userId: payload.sub, email, displayName: email, fullName: null };
  } catch { return null; }
}
