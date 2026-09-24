import handler from 'vinext/server/fetch-handler';
import { accessUser, type AccessEnv } from './lib/cloudflare-access';

export default {
  async fetch(request: Request, env: AccessEnv & { ASSETS: Fetcher }, ctx: ExecutionContext) {
    // Static build assets contain no account data and must load before the app runs.
    const isStaticAsset = new URL(request.url).pathname.startsWith('/_next/static/');
    if (isStaticAsset) return env.ASSETS.fetch(request);
    if (!import.meta.env.DEV && !isStaticAsset && !(await accessUser(request.headers, env))) {
      return Response.json({ error: 'Sign in with an authorised manager account.' }, {
        status: 403, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    const response = await handler.fetch(request, env, ctx);
    const secured = new Response(response.body, response);
    secured.headers.set('Cache-Control', 'private, no-store');
    return secured;
  },
};
