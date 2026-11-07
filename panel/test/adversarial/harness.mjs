// Adversarial checks (not part of `npm test`): `node --test test/adversarial/` after `npm run build`.
// Starts the built server (dist/server/entry.mjs) with a temporary SITE_ROOT/DATA_DIR and one user, and gives a tiny
// cookie-jar client. Every test here asserts the SAFE behaviour, so a failing test is an open security issue.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, newTotpSecret, totp } from '../../lib/auth.mjs';
import { SECRET, until } from '../helpers.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const PASS = 'a-long-test-password';
export const EMAIL = 'adela@example.com';
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

/** env: extra server variables (e.g. { TRUST_PROXY: '0' }). Only PATH/SYSTEMROOT/TEMP are inherited, so the shell cannot leak settings in. */
export async function startPanel(env = {}) {
  const dirs = { site: await mkdtemp(join(tmpdir(), 'adv-site-')), data: await mkdtemp(join(tmpdir(), 'adv-data-')) };
  const totpSecret = newTotpSecret();
  await writeFile(join(dirs.data, 'users.json'), JSON.stringify([{ email: EMAIL, name: 'Adela', hash: await hashPassword(PASS), totp: totpSecret, tokenVersion: 0 }]));
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const keep = Object.fromEntries(['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...keep, HOST: '127.0.0.1', PORT: String(port), PANEL_SECRET: SECRET, SITE_ROOT: dirs.site, DATA_DIR: dirs.data, SITE_URL: 'https://expertsddt.com', COOKIE_SECURE: '0', ...env },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((r) => child.once('exit', r));
  await until(async () => { try { return (await fetch(`${base}/login`)).status === 200; } catch { return false; } }, 30_000)
    .catch((e) => { child.kill(); throw new Error(`server did not start: ${e.message}\n${log}`); });

  const jar = {};
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  /** fetch with the jar (redirects not followed); `opt.headers.Cookie` overrides the jar. */
  const call = async (path, opt = {}) => {
    const r = await fetch(base + path, { redirect: 'manual', ...opt, headers: { Cookie: cookie(), ...(opt.headers || {}) } });
    for (const c of r.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split('; '); const i = kv.indexOf('=');
      if (/Max-Age=0/i.test(attrs.join(';'))) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return r;
  };
  const form = (fields, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) });
  const login = (over = {}, headers = {}) => call('/login', form({ email: EMAIL, password: PASS, code: totp(totpSecret), ...over }, headers));
  const csrf = async () => (await (await call('/')).text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const stop = async () => {
    if (child.exitCode === null) { child.kill(); await exited; }
    await rm(dirs.site, { recursive: true, force: true, maxRetries: 5 }); await rm(dirs.data, { recursive: true, force: true, maxRetries: 5 });
  };
  return { base, port, dirs, totpSecret, jar, call, form, login, csrf, stop, log: () => log };
}
