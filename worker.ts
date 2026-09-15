import handler from 'vinext/server/fetch-handler';
import { accessUser, type AccessEnv } from './lib/cloudflare-access';

export default {
  async fetch(request: Request, env: AccessEnv, ctx: ExecutionContext) {
    // Validate every production request, including direct Worker and asset requests.
    if (!import.meta.env.DEV && !(await accessUser(request.headers, env))) {
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
