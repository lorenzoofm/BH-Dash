import handler from 'vinext/server/fetch-handler';
import { accessUser, type AccessEnv } from './lib/cloudflare-access';

const financePaths = ['/pnl', '/revenue', '/detailed/revenue', '/detailed/overview', '/api/revenue', '/api/data/map'];
const isFinancePath = (path: string) => financePaths.some(route => path === route || path.startsWith(route + '/'));

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
    if (!import.meta.env.DEV && isFinancePath(new URL(request.url).pathname) && !(env.ADMIN_EMAILS || 'massi@20mg.co').split(',').some(email => email.trim().toLowerCase() === user?.email)) {
      return Response.json({error: 'Administrator access required for finance.'}, {status: 403, headers: {'Cache-Control': 'private, no-store'}});
    }
    const response = await handler.fetch(request, env, ctx);
    const secured = new Response(response.body, response);
    secured.headers.set('Cache-Control', 'private, no-store');
    return secured;
  },
};
