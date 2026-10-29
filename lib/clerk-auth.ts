import { createRemoteJWKSet, jwtVerify } from 'jose';

// Clerk sign-in, verified locally: the session cookie is a short-lived JWT signed by Clerk,
// checked against Clerk's published keys (fetched once per isolate, then cached by jose).
export type ClerkEnv = { CLERK_PUBLISHABLE_KEY?: string };
export type SessionUser = { userId: string; email: string };
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

// The publishable key encodes the instance's Frontend API host: pk_(test|live)_base64("host$").
export function frontendApi(env: ClerkEnv) {
  const key = env.CLERK_PUBLISHABLE_KEY ?? '';
  const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(key);
  if (!match) return null;
  try {
    const host = atob(match[2].replace(/-/g, '+').replace(/_/g, '/')).replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch { return null; }
}

function sessionToken(headers: Headers) {
  const bearer = /^Bearer (.+)$/.exec(headers.get('authorization') ?? '')?.[1];
  if (bearer) return bearer;
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === '__session') return value.join('=');
  }
  return null;
}

export async function clerkUser(request: Request, env: ClerkEnv): Promise<SessionUser | null> {
  const host = frontendApi(env), token = sessionToken(request.headers);
  if (!host || !token) return null;
  try {
    const issuer = 'https://' + host;
    let keys = keySets.get(issuer);
    if (!keys) { keys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json')); keySets.set(issuer, keys); }
    const { payload } = await jwtVerify(token, keys, { issuer, algorithms: ['RS256'], requiredClaims: ['exp', 'sub'], clockTolerance: 5 });
    // azp is the origin the token was issued to; reject tokens minted for another site.
    if (payload.azp && payload.azp !== new URL(request.url).origin) return null;
    // Needs the custom session claim {"email": "{{user.primary_email_address}}"} in Clerk.
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || !payload.email) return null;
    return { userId: payload.sub, email: payload.email.trim().toLowerCase() };
  } catch { return null; }
}
