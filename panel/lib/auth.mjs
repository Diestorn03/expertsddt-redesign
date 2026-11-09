// Authentication primitives with Node built-ins only: scrypt passwords, TOTP (RFC 6238), signed cookies, login throttle.
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const scryptAsync = (pw, salt) => new Promise((res, rej) => scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('password must be at least 12 characters');
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scryptAsync(password, salt)).toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, saltB64, keyB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64 || typeof password !== 'string') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---- TOTP (SHA-1, 6 digits, 30 s: what Google Authenticator / Authy expect) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newTotpSecret = () => base32(randomBytes(20));
export function base32(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function unbase32(s) {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v < 0) throw new Error('bad base32'); bits += v.toString(2).padStart(5, '0'); }
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
export function totp(secret, time = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const h = createHmac('sha1', unbase32(secret)).update(counter).digest();
  const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
export function verifyTotp(secret, code, time = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return false;
  let ok = false;
  for (const drift of [-1, 0, 1]) { // tolerate one step of clock drift; no early exit keeps timing flat
    const expected = Buffer.from(totp(secret, time + drift * 30000)), given = Buffer.from(String(code));
    if (timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}
export const totpUri = (email, secret, issuer = 'ExpertsDDT Panel') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

// ---- stateless signed tokens (session cookie, CSRF seed) ----
const b64u = (b) => Buffer.from(b).toString('base64url');
export function sign(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verify(token, secret, now = Date.now()) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > now ? p : null; } catch { return null; }
}
export const csrfFor = (session, secret) => createHmac('sha256', secret).update('csrf:' + session.sid).digest('base64url');

// ---- login throttle: `max` failures lock the key for 15 minutes; failures older than that are forgotten ----
export function createThrottle({ max = 5, lockMs = 15 * 60_000, now = () => Date.now(), cap = 10_000 } = {}) {
  const m = new Map();
  const stale = (e, t) => e.until <= t && t - e.last > lockMs;
  const sweep = () => { // bounded memory under a spray of unique keys
    const t = now(); for (const [k, e] of m) if (stale(e, t)) m.delete(k);
    while (m.size >= cap) m.delete(m.keys().next().value); // ponytail: evicts the oldest key first; per-key LRU if this ever matters
  };
  return {
    blocked: (k) => (m.get(k)?.until ?? 0) > now(),
    until: (k) => m.get(k)?.until ?? 0,
    fail(k) {
      if (!m.has(k) && m.size >= 1000) sweep();
      const t = now(), old = m.get(k), e = old && !stale(old, t) ? old : { n: 0, until: 0 };
      e.n += 1; e.last = t; if (e.n >= max) { e.until = t + lockMs; e.n = 0; }
      m.set(k, e);
    },
    ok: (k) => m.delete(k),
  };
}
