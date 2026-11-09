// ADVERSARIAL · a malformed or oversized request body answers 500 instead of a 4xx.
// Run: npm run build && node --test test/adversarial/
//
// Two throwers are never caught by the operation that calls them:
//   - receive() -> Busboy({headers}) throws synchronously for a content type it cannot parse ("Unsupported content type",
//     "Multipart: Boundary not found"). uploadSlot/uploadLibrary only map an abort to 499; anything else is rethrown.
//   - readForm() throws 'form too large' past 8 KB, and login/logout/activate/restore do not catch it.
// The middleware's catch turns both into the branded 500 page. The body leaks nothing, but the request is a client
// error answered as a server error, and every attempt writes a full stack trace to the server log. POST /login needs
// no session, so an anonymous caller can do it in a loop.
//
// Each test asserts the SAFE behaviour, so a FAILING test is the open issue.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeZip, multipart, notice } from '../helpers.mjs';
import { startPanel } from './harness.mjs';

let p;
before(async () => { p = await startPanel(); });
after(async () => { await p?.stop(); });

const statusOf = async (path, opt) => { const r = await p.call(path, opt); await r.text(); return r.status; };

test('an anonymous oversized login body is a client error, not a 500', async () => {
  const status = await statusOf('/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=' + 'a'.repeat(9000),
  });
  assert.ok(status >= 400 && status < 500, `expected a 4xx for a 9 KB login body, got ${status}`);
});

test('a body whose content type cannot be parsed is a client error, not a 500', async () => {
  await p.login();
  const csrf = await p.csrf();
  for (const [why, headers, body] of [
    ['text/plain', { 'Content-Type': 'text/plain' }, 'x'],
    ['multipart without a boundary', { 'Content-Type': 'multipart/form-data' }, 'x'],
    ['urlencoded instead of multipart', { 'Content-Type': 'application/x-www-form-urlencoded' }, `_csrf=${csrf}&slot=team`],
  ]) {
    for (const path of ['/upload/slot', '/upload/libraries']) {
      const status = await statusOf(path, { method: 'POST', headers, body });
      assert.ok(status >= 400 && status < 500, `${path} with ${why}: expected a 4xx, got ${status}`);
    }
  }
});

test('an oversized body on the small urlencoded endpoints is a client error, not a 500', async () => {
  await p.login();
  const csrf = await p.csrf();
  for (const path of ['/logout', '/restore', '/libraries/activate']) {
    const status = await statusOf(path, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `_csrf=${encodeURIComponent(csrf)}&slot=team&file=` + 'a'.repeat(9000),
    });
    assert.ok(status >= 400 && status < 500, `${path}: expected a 4xx for a 9 KB body, got ${status}`);
  }
});

// isDay() in lib/panel.mjs:
//   /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d)
// The shape check passes for an impossible month or day, `new Date(...)` is then an Invalid Date, and `.toISOString()`
// throws RangeError. uploadLibrary only maps an abort to 499, so the notice «Revisa el número de versión … y la fecha»
// is never shown and the publish ends in the branded 500 page. (2026-02-30 is fine: JS rolls it over to March 2, so
// startsWith() simply returns false.) A browser's <input type="date"> cannot send these, a crafted post can.
test('an impossible calendar date in dataDate is answered with the lib_meta notice, not a 500', async () => {
  await p.login();
  const csrf = await p.csrf();
  const zip = makeZip([{ name: 'lib/a.stl', data: Buffer.from('solid x') }]);
  for (const dataDate of ['2026-13-45', '2026-11-32', '0000-00-00', '9999-99-99']) {
    const body = multipart('bad-date', [['_csrf', csrf], ['version', '5'], ['dataDate', dataDate], ['file', zip, 'l.zip']]);
    const r = await p.call('/upload/libraries', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=bad-date' }, body });
    await r.text();
    assert.notEqual(r.status, 500, `dataDate ${dataDate}: an unparseable date must not crash the publish`);
    assert.equal(notice(r.headers.getSetCookie())?.key, 'lib_meta', `dataDate ${dataDate}: expected the lib_meta notice`);
  }
});

test('no malformed body ever puts a stack trace in the response body', async () => {
  const r = await p.call('/upload/slot', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  const html = await r.text();
  assert.doesNotMatch(html, /\bat [\w$.]+ \(|node_modules|entry\.mjs|busboy/i, 'the error page must not name files or frames');
});
