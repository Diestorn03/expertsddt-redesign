// ADVERSARIAL · responses the Astro node adapter writes itself carry none of the hardened headers,
// and the session cookie has no __Host- prefix. Run: npm run build && node --test test/adversarial/
//
// 1. createRequestFromNodeRequest (astro/dist/core/app/node.js) builds `new Request(url, {method})`, and undici
//    rejects TRACE / TRACK / CONNECT outright. serve-app.js catches that, logs it and answers
//    `res.statusCode = 500; res.end("Internal Server Error")` without ever entering the middleware, so the reply has
//    no CSP, no X-Frame-Options, no Cache-Control and not even a Content-Type. The e2e suite's assertHardened() only
//    ever sees responses that did reach the middleware, so this gap is invisible to it.
// 2. edp_sid is set as `edp_sid=...; HttpOnly; SameSite=Strict; Path=/; Secure`. Without the __Host- prefix any
//    sibling host under expertsddt.com (or anything that can write a Domain=.expertsddt.com cookie) can shadow it.
//    The signature means a planted value cannot authenticate, so the reachable effect is a forced logout the victim
//    cannot clear, not a session takeover; __Host- removes the class.
//
// Each test asserts the SAFE behaviour, so a FAILING test is the open issue.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startPanel } from './harness.mjs';

let p;
before(async () => { p = await startPanel(); });
after(async () => { await p?.stop(); });

/** One raw request/response: fetch() refuses to send these methods, so the socket is driven by hand. */
const raw = (request, waitMs = 2000) => new Promise((resolve) => {
  const s = net.connect(p.port, '127.0.0.1', () => s.write(request));
  let out = '';
  s.on('data', (d) => { out += d; });
  s.on('close', () => resolve(out));
  s.on('error', () => resolve(out));
  setTimeout(() => s.destroy(), waitMs);
});
const headersOf = (response) => Object.fromEntries(response.split('\r\n\r\n')[0].split('\r\n').slice(1)
  .map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).toLowerCase().trim(), l.slice(i + 1).trim()]; }));

// TRACE is the reachable case: Node's parser accepts it, so it travels all the way to the adapter, which then fails
// to build a Request and answers on its own. (TRACK is rejected as an unknown method by Node's own parser with a bare
// 400, and CONNECT is closed without a reply by http.Server itself; neither reaches any application code.)
test('a TRACE request is refused with the hardened headers and no 500', async () => {
  const response = await raw('TRACE / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
  assert.ok(response, 'the server answered nothing at all');
  const status = Number(response.split(' ')[1]);
  const h = headersOf(response);
  assert.notEqual(status, 500, `TRACE is a client problem, not a server failure (got ${status})`);
  assert.ok(h['content-security-policy'], `no CSP header on the ${status}`);
  assert.equal(h['x-frame-options'], 'DENY', `no X-Frame-Options on the ${status}`);
  assert.equal(h['cache-control'], 'no-store', `no Cache-Control on the ${status}`);
  assert.equal(h['x-content-type-options'], 'nosniff', `no nosniff on the ${status}`);
});

// The harness runs with COOKIE_SECURE=0 (plain http), where the prefix cannot be used: browsers drop a __Host- cookie that
// lacks Secure. The production setting (Secure on, the default) is what this checks.
test('the session cookie uses the __Host- prefix so no sibling host can shadow it', { timeout: 60_000 }, async () => {
  const secure = await startPanel({ COOKIE_SECURE: '1' });
  let r;
  try { r = await secure.login(); } finally { await secure.stop(); }
  const cookie = r.headers.getSetCookie().find((c) => /^(__Host-)?edp_sid=/.test(c));
  assert.ok(cookie, 'no session cookie was set');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\//); // sanity
  assert.match(cookie, /^__Host-edp_sid=/, `the cookie name must carry the __Host- prefix, got: ${cookie.split('=')[0]}`);
});
