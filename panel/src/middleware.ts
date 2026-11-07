// Every non-static request (§9.3): origin check on POST, session, flash notice, then the hardened headers and the CSP as a header.
// Astro's own checkOrigin is off (astro.config.mjs): this check accepts an absent Origin and refuses 'null' or a foreign one.
import { defineMiddleware } from 'astro:middleware';
import { toResponse } from '../lib/panel.mjs';
import { panel } from './panel';

const headers = panel.securityHeaders({ csp: import.meta.env.PROD }); // Vite injects inline scripts in astro dev only

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { request, url } = ctx;
  let res: Response, set: string[] = [];
  try {
    const g = await panel.guard({ method: request.method, path: url.pathname, headers: request.headers });
    if (g.response?.view === '403') res = await next('/403'); // the branded page, without running the route
    else if (g.response) res = toResponse(g.response);
    else {
      ctx.locals.session = g.session; ctx.locals.csrf = g.csrf; ctx.locals.flash = g.flash;
      set = g.setCookies;
      res = await next();
    }
  } catch (e) {
    console.error('panel error:', e);
    ctx.locals.session = null; ctx.locals.flash = null;
    res = await next(new Request(new URL('/500', url))); // a fresh GET: the failed request's body may already be consumed
  }
  const out = new Response(res.body, { status: res.status, headers: res.headers }); // a returned Response can have immutable headers
  for (const c of set) out.headers.append('Set-Cookie', c);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v as string);
  return out;
});
