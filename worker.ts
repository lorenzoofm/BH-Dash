import handler from 'vinext/server/fetch-handler';
import { clerkUser, frontendApi, type ClerkEnv } from './lib/clerk-auth';
import { notApprovedPage, safeReturn, signInPage, signOutPage } from './lib/clerk-pages';
import {isManager, pagesFor, type Page} from './lib/page-access';

const routePage = (path:string):Page|null => {
  const segment=path.split('/').filter(Boolean);
  if(!segment.length)return 'overview';
  if(segment[0]==='detailed')return routePage('/'+(segment[1]==='overview'?'pnl':segment[1]));
  return (['conversions','staff','pay-hours','expenses','pnl','revenue'] as string[]).includes(segment[0]) ? segment[0] as Page : null;
};
// Files the sign-in page itself needs; none contain account data.
const isPublicAsset = (path:string) => path.startsWith('/_next/static/') || path.startsWith('/fonts/') || path==='/20mg.png' || path==='/favicon.svg';
const noStore = {'Cache-Control':'private, no-store'};
const html = (body:string,status=200) => new Response(body,{status,headers:{...noStore,'Content-Type':'text/html; charset=utf-8','X-Frame-Options':'DENY'}});
// The app trusts these headers as the verified user, so a client can never supply them.
const USER_HEADERS = ['x-bh-user-email','x-bh-user-id'];

export default {
  async fetch(request: Request, env: ClerkEnv & { ASSETS: Fetcher; ADMIN_EMAILS?: string }, ctx: ExecutionContext) {
    const url = new URL(request.url), path = url.pathname;
    if (isPublicAsset(path)) return env.ASSETS.fetch(request);
    if (import.meta.env.DEV) return handler.fetch(request, env, ctx);

    const host = frontendApi(env), key = env.CLERK_PUBLISHABLE_KEY ?? '';
    if (!host) return Response.json({error:'Sign-in is not configured.'},{status:503,headers:noStore});
    if (path === '/sign-in') return html(signInPage(host, key, safeReturn(url.searchParams.get('redirect_url'))));
    if (path === '/sign-out') return html(signOutPage(host, key));

    const user = await clerkUser(request, env);
    if (!user) {
      // Pages go to sign-in (which also silently refreshes an expired session); data calls get a 401 the client retries.
      const wantsPage = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
      if (wantsPage) return Response.redirect(new URL('/sign-in?redirect_url=' + encodeURIComponent(path + url.search), url).toString(), 302);
      return Response.json({error:'Your session expired. Sign in again.'},{status:401,headers:noStore});
    }
    const isAdmin=(env.ADMIN_EMAILS || 'massi@20mg.co').split(',').some(email=>email.trim().toLowerCase()===user.email);
    if (!(await isManager(user.email, isAdmin))) return html(notApprovedPage(host, key, user.email), 403);
    const page=routePage(path);
    if(page && !(await pagesFor(user.email,isAdmin)).includes(page))return Response.json({error:'This page is not enabled for your account.'},{status:403,headers:noStore});

    const headers = new Headers(request.headers);
    for (const name of USER_HEADERS) headers.delete(name);
    headers.set('x-bh-user-email', user.email);
    headers.set('x-bh-user-id', user.userId);
    const response = await handler.fetch(new Request(request, {headers}), env, ctx);
    const secured = new Response(response.body, response);
    secured.headers.set('Cache-Control', 'private, no-store');
    return secured;
  },
};
