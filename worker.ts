import handler from 'vinext/server/fetch-handler';
import { accessUser, type AccessEnv } from './lib/cloudflare-access';
import {pagesFor, type Page} from './lib/page-access';

const routePage = (path:string):Page|null => {
  const segment=path.split('/').filter(Boolean);
  if(!segment.length)return 'overview';
  if(segment[0]==='detailed')return routePage('/'+(segment[1]==='overview'?'pnl':segment[1]));
  return (['conversions','staff','pay-hours','expenses','pnl','revenue'] as string[]).includes(segment[0]) ? segment[0] as Page : null;
};

export default {
  async fetch(request: Request, env: AccessEnv & { ASSETS: Fetcher; ADMIN_EMAILS?: string }, ctx: ExecutionContext) {
    // Static build assets contain no account data and must load before the app runs.
    const isStaticAsset = new URL(request.url).pathname.startsWith('/_next/static/');
    if (isStaticAsset) return env.ASSETS.fetch(request);
    const user = import.meta.env.DEV ? null : await accessUser(request.headers, env);
    if (!import.meta.env.DEV && !user) {
      return Response.json({ error: 'Sign in with an authorised manager account.' }, {
        status: 403, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    const path=new URL(request.url).pathname;
    const page=routePage(path);
    if(!import.meta.env.DEV && user && page) {
      const isAdmin=(env.ADMIN_EMAILS || 'massi@20mg.co').split(',').some(email=>email.trim().toLowerCase()===user.email);
      if(!(await pagesFor(user.email,isAdmin)).includes(page))return Response.json({error:'This page is not enabled for your account.'},{status:403,headers:{'Cache-Control':'private, no-store'}});
    }
    const response = await handler.fetch(request, env, ctx);
    const secured = new Response(response.body, response);
    secured.headers.set('Cache-Control', 'private, no-store');
    return secured;
  },
};
