// ADVERSARIAL · X-Forwarded-For is trusted by default, with no proxy check and no validation.
// Run: npm run build && node --test test/adversarial/
//
//   const clientIp = (headers, remote = '') =>
//     (cfg.trustProxy ? String(plain(headers)['x-forwarded-for'] || '').split(',')[0].trim() : '') || remote || '';
//
// configFromEnv sets `trustProxy: env.TRUST_PROXY !== '0'`, so trusting the header is the default and a header the
// client sends wins over the real socket address. Two consequences:
//   1. the per-IP half of the login throttle (20 failures) keys on a value the caller picks, so an attacker spraying
//      many accounts changes one header per request and only ever meets the per-email limit;
//   2. whatever the caller sends is written verbatim into DATA_DIR/audit.jsonl and shown on «Accesos», with no check
//      that it is an IP and no length cap, so the «Intento de acceso fallido» lines can be filled with chosen text.
// Astro's own clientAddress is stricter: core/app/node.js only reads X-Forwarded-For once the Host has matched
// `allowedDomains`. The panel's own helper applies no such condition.
//
// Each test asserts the SAFE behaviour, so a FAILING test is the open issue.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPanel, configFromEnv } from '../../lib/panel.mjs';
import { SECRET } from '../helpers.mjs';
import { startPanel } from './harness.mjs';

test('the client IP is not taken from a header a client can set', async () => {
  const dirs = { site: await mkdtemp(join(tmpdir(), 'adv-ip-site-')), data: await mkdtemp(join(tmpdir(), 'adv-ip-data-')) };
  try {
    // built exactly as src/panel.ts builds it: createPanel({ ...configFromEnv(process.env), slots })
    const panel = await createPanel({ ...configFromEnv({}), secret: SECRET, siteRoot: dirs.site, dataDir: dirs.data, cookieSecure: false });
    const spoofed = panel.clientIp({ 'x-forwarded-for': '9.9.9.9' }, '203.0.113.7');
    assert.equal(spoofed, '203.0.113.7',
      'with no verified proxy in front, the socket address must win over X-Forwarded-For');
    assert.notEqual(panel.clientIp({ 'x-forwarded-for': 'A'.repeat(300) }, '203.0.113.7'), 'A'.repeat(300),
      'an arbitrary string must never become the client IP');
  } finally {
    await rm(dirs.site, { recursive: true, force: true, maxRetries: 5 });
    await rm(dirs.data, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('trusting the proxy is opt-in, not the default', () => {
  assert.equal(configFromEnv({}).trustProxy, false,
    'TRUST_PROXY must default to off: the panel cannot know a stripping proxy is in front of it');
  assert.equal(configFromEnv({ TRUST_PROXY: '1' }).trustProxy, true);
});

test('the audit log does not store caller-chosen text in its ip field', { timeout: 60_000 }, async () => {
  const p = await startPanel();
  try {
    const forged = 'forged-' + 'Z'.repeat(400);
    await p.call('/login', p.form(
      { email: 'victim@example.com', password: 'a-wrong-password', code: '000000' },
      { 'X-Forwarded-For': forged },
    ));
    const line = JSON.parse((await readFile(join(p.dirs.data, 'audit.jsonl'), 'utf8')).trim().split('\n').at(-1));
    assert.equal(line.action, 'login_failed'); // sanity: the attempt was recorded
    assert.notEqual(line.ip, forged, 'a caller must not be able to write chosen text into the audit log');
    assert.ok(String(line.ip).length <= 45, `an ip field must fit an IPv6 address, got ${String(line.ip).length} chars`);
  } finally { await p.stop(); }
});

// sameOrigin() in lib/panel.mjs resolves the expected host from the request itself:
//   return o === h.host || (!!cfg.trustProxy && o === String(h['x-forwarded-host'] || '').split(',')[0].trim());
// so a caller who sets both Origin and X-Forwarded-Host to the same foreign name satisfies the check. It is not
// reachable from a victim's browser (X-Forwarded-Host is not CORS-safelisted, and the panel answers no preflight), and
// a valid session cookie plus the CSRF token are still required, so this erodes the second layer rather than opening a
// CSRF path. The expected host should come from configuration, not from a header the caller controls.
test('a foreign Origin stays refused even when X-Forwarded-Host agrees with it', { timeout: 60_000 }, async () => {
  const p = await startPanel();
  try {
    await p.login();
    const csrf = await p.csrf();
    const r = await p.call('/libraries/activate', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, file: 'nothing.zip' }),
    });
    await r.text();
    assert.equal(r.status, 403, `a foreign Origin must be refused whatever the forwarding headers claim (got ${r.status})`);
  } finally { await p.stop(); }
});

test('whatever reaches the history page is escaped (defence in depth for the line above)', { timeout: 60_000 }, async () => {
  const p = await startPanel();
  try {
    await p.call('/login', p.form(
      { email: 'victim@example.com', password: 'a-wrong-password', code: '000000' },
      { 'X-Forwarded-For': '"><script>alert(1)</script>' },
    ));
    await p.login();
    const html = await (await p.call('/history?tipo=accesos')).text();
    assert.doesNotMatch(html, /<script>alert/, 'the audit log must never reach the page as markup');
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, 'no inline script may appear on the history page');
  } finally { await p.stop(); }
});
