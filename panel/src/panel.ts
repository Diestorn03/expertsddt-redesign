// The one panel instance (lib/panel.mjs) and the glue the endpoints share. In production the server in server.mjs
// (copied to dist/server/entry.mjs at build time) creates it before listening and hands it over on globalThis, so a bad
// environment stops the app at start-up; `astro dev` has no such server, so the instance is created here on first use.
// slots.json is imported for that fallback: bundling breaks the core's own lookup through import.meta.url.
import type { APIContext } from 'astro';
import { createPanel, configFromEnv, toResponse } from '../lib/panel.mjs';
import slots from '../slots.json';

export const panel = (globalThis as any).__expertsddtPanel ?? await createPanel({ ...configFromEnv(process.env), slots });

type Ctx = Pick<APIContext, 'request' | 'clientAddress'>;
/** The client IP (see clientIp in lib/panel.mjs). The socket address comes from server.mjs, which overwrites X-Panel-Peer on
 *  every request: Astro's own clientAddress takes the FIRST X-Forwarded-For entry, which the client controls. */
export function clientIp(ctx: Ctx) {
  let remote = ctx.request.headers.get('x-panel-peer') ?? '';
  if (!(globalThis as any).__expertsddtPanel) try { remote = ctx.clientAddress; } catch { /* not available */ }
  return panel.clientIp(ctx.request.headers, remote);
}

/** The io argument of every POST operation. Bodies are streamed, never read with formData(). */
export const io = (ctx: APIContext) => ({
  session: ctx.locals.session, headers: ctx.request.headers, body: ctx.request.body, signal: ctx.request.signal, ip: clientIp(ctx),
});

/** Sends a POST result: the branded 403 page, or a redirect / JSON / empty status (499 = upload aborted).
 *  The body is already read, so the rewrite gets a fresh GET (Astro refuses to copy a consumed body). It runs the middleware again,
 *  so the notice cookie is left out: that GET must not consume a notice the user has not seen yet. */
export function send(ctx: APIContext, r: { view?: string }) {
  if (r.view !== '403') return toResponse(r);
  const headers = new Headers(ctx.request.headers);
  headers.set('cookie', (headers.get('cookie') ?? '').split(/;\s*/).filter((c) => !c.startsWith('edp_flash=')).join('; '));
  return ctx.rewrite(new Request(new URL('/403', ctx.url), { headers }));
}
