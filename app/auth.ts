import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type DashboardUser = { userId: string; displayName: string; email: string; fullName: string | null };
export async function getUser(): Promise<DashboardUser | null> {
  const requestHeaders = await headers();
  // The loopback-only development middleware strips and supplies these headers.
  // This branch is removed from production builds.
  if (import.meta.env.DEV) {
    const email = requestHeaders.get('oai-authenticated-user-email');
    const userId = requestHeaders.get('oai-authenticated-user-id');
    return email && userId ? { email, userId, displayName: email, fullName: null } : null;
  }
  // worker.ts verifies the Clerk session and manager list, strips any client-sent copies, then sets these.
  const email = requestHeaders.get('x-bh-user-email');
  const userId = requestHeaders.get('x-bh-user-id');
  return email && userId ? { email, userId, displayName: email, fullName: null } : null;
}
export async function requireUser(): Promise<DashboardUser> {
  const user = await getUser();
  if (user) return user;
  redirect('/sign-in');
}
