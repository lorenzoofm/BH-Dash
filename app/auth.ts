import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { accessUser } from '@/lib/cloudflare-access';

export type DashboardUser = { userId: string; displayName: string; email: string; fullName: string | null };
export async function getUser(): Promise<DashboardUser | null> {
  const requestHeaders = await headers();
  // The loopback-only development middleware strips and supplies these headers.
  // This branch is removed from production builds; production always verifies Access.
  if (process.env.NODE_ENV === 'development') {
    const email = requestHeaders.get('oai-authenticated-user-email');
    const userId = requestHeaders.get('oai-authenticated-user-id');
    return email && userId ? { email, userId, displayName: email, fullName: null } : null;
  }
  return accessUser(requestHeaders, { ACCESS_TEAM_DOMAIN: process.env.ACCESS_TEAM_DOMAIN, ACCESS_AUD: process.env.ACCESS_AUD, ACCESS_ACCOUNT_ID: process.env.ACCESS_ACCOUNT_ID, ACCESS_APP_ID: process.env.ACCESS_APP_ID, ACCESS_POLICY_ID: process.env.ACCESS_POLICY_ID, ACCESS_API_TOKEN: process.env.ACCESS_API_TOKEN });
}
export async function requireUser(): Promise<DashboardUser> {
  const user = await getUser();
  if (user) return user;
  redirect('/cdn-cgi/access/logout');
}
