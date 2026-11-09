// The production server. astro.config.mjs copies this file to dist/server/entry.mjs at build time (Astro's own bundle is
// dist/server/app.mjs), so the relative paths below are relative to dist/server/. It exists for what the adapter's
// standalone server cannot do (DESIGN §9.10, plan B):
//   - the configuration is checked, and the temporary files of cut uploads swept, BEFORE listening: a bad environment
//     exits with a clear message (hPanel shows the app as failed) instead of answering 500 to every request;
//   - Node's 300 s requestTimeout is off, so a 300 MB zip over a slow uplink is not cut with a 408 (headers still have
//     60 s, and a socket that sends nothing for 2 minutes is closed);
//   - methods the app does not use (TRACE...) get a 405 with the hardened headers, not the adapter's bare 500;
//   - the socket address is passed on in X-Panel-Peer (overwritten on every request), for the throttle and the log.
// HOST defaults to 127.0.0.1 and PORT to 8080 (Hostinger sets PORT).
import http from 'node:http';
import { createPanel, configFromEnv } from '../../lib/panel.mjs';

let panel;
try {
  panel = await createPanel({ ...configFromEnv(process.env), slotsPath: new URL('../../slots.json', import.meta.url) });
} catch (e) {
  console.error(`panel: cannot start: ${e.message}`);
  process.exit(1);
}
globalThis.__expertsddtPanel = panel;
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('./app.mjs');

const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT) || 8080;
const hardened = { ...panel.securityHeaders(), 'Content-Type': 'text/plain; charset=utf-8' };
const server = http.createServer({ requestTimeout: 0, headersTimeout: 60_000, keepAliveTimeout: 65_000 }, (req, res) => {
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) { res.writeHead(405, { ...hardened, Allow: 'GET, HEAD, POST' }); res.end('Method Not Allowed'); return; }
  req.headers['x-panel-peer'] = req.socket.remoteAddress ?? '';
  handler(req, res);
});
server.timeout = 120_000; // inactivity, not total time
server.on('error', (e) => { console.error(`panel: ${e.message}`); process.exit(1); });
server.listen(port, host, () => console.log(`Server listening on http://${host.includes(':') ? `[${host}]` : host}:${port}`));
