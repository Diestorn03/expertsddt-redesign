// Legacy plain-HTML server on top of lib/panel.mjs (no client-side JS). Kept until the Astro UI replaces it (DESIGN §9.1).
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createPanel, configFromEnv } from './lib/panel.mjs';
import { loginPage, dashboard, historyPage } from './lib/ui.mjs';

export async function createApp(cfg) {
  const panel = await createPanel(cfg);
  const { siteUrl } = panel.config;
  // ui.mjs uses an inline <style>, so this page keeps its old policy: still no scripts at all (default-src 'none')
  const headers = { ...panel.securityHeaders(), 'Content-Security-Policy': `default-src 'none'; img-src 'self' ${siteUrl} data:; media-src ${siteUrl}; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` };

  const page = (r, g) => {
    const d = r.data ?? {};
    if (r.view === 'login') return loginPage(d.flash ?? g.flash, d.email);
    if (r.view === 'dashboard') return dashboard({ user: d.user.email, csrf: d.csrf, flash: g.flash, siteUrl, items: d.slots, libs: { latest: d.libraries.latest, versions: d.libraries.versions } });
    if (r.view === 'history') return historyPage({ user: d.user.email, csrf: d.csrf, rows: d.groups.flatMap((x) => x.items.map((i) => ({ ts: i.ts, user: i.who ?? '', action: i.text, detail: i.detail }))) });
    return { 403: 'Forbidden', 404: 'No encontrado' }[r.status] ?? '';
  };

  function send(res, r, g = {}) {
    const cookies = [...(g.setCookies ?? []), ...(r.setCookies ?? [])];
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    if (r.location) res.writeHead(r.status, { Location: r.location }).end();
    else if (r.json) res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(r.json));
    else if (r.view) res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(r, g));
    else res.writeHead(r.status).end();
  }

  async function handle(req, res) {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); }); // the client went away mid-request
    try {
      const url = new URL(req.url, 'http://panel');
      const g = await panel.guard({ method: req.method, path: url.pathname, headers: req.headers });
      if (g.response) return send(res, g.response);
      const io = { session: g.session, headers: req.headers, body: req, signal: ac.signal, ip: panel.clientIp(req.headers, req.socket.remoteAddress) };
      const route = `${req.method} ${url.pathname}`;
      let r;
      if (route === 'GET /login') r = { status: 200, view: 'login', data: {} };
      else if (route === 'POST /login') r = await panel.login(io);
      else if (route === 'GET /') r = { status: 200, view: 'dashboard', data: await panel.dashboard(g.session) };
      else if (route === 'GET /history') r = { status: 200, view: 'history', data: await panel.history(g.session, url.searchParams.get('tipo')) };
      else {
        const op = { 'POST /upload/slot': panel.uploadSlot, 'POST /upload/libraries': panel.uploadLibrary, 'POST /libraries/activate': panel.activate, 'POST /restore': panel.restore, 'POST /logout': panel.logout }[route];
        r = op ? await op(io) : { status: 404, view: '404' };
      }
      send(res, r, g);
    } catch (e) {
      console.error('panel error:', e?.message);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end('Error interno');
    }
  }
  return { handle, audit: panel.audit, panel };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp(configFromEnv(process.env));
  http.createServer(app.handle).listen(Number(process.env.PORT) || 3000, () => console.log('panel listening'));
}
