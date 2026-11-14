// Production gate: every product,
// collection and cart URL the site links or redirects to must exist. Network check, run before deploying.
// Usage: PUBLIC_SHOP_URL=https://shop.expertsddt.com node scripts/check-shop.mjs
import { readFileSync } from 'node:fs';

const shop = (process.env.PUBLIC_SHOP_URL || '').replace(/\/$/, '');
if (!shop) { console.error('PUBLIC_SHOP_URL is not set'); process.exit(1); }
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const paths = new Set(['/']);
const redirectHost = 'https://shop.expertsddt.com';
for (const m of read('../public/.htaccess').matchAll(/https:\/\/shop\.expertsddt\.com(\/\S*)/g)) paths.add(m[1]);
for (const m of read('../src/shop.js').matchAll(/^\s+\w+:\s*'([a-z0-9-]+)',?$/gm)) paths.add(`/products/${m[1]}`);
if (shop !== redirectHost) console.warn(`WARN .htaccess redirects to ${redirectHost} but PUBLIC_SHOP_URL is ${shop}`);

async function resolve(url, hops = 4) {
  for (let i = 0; i < hops; i++) {
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ExpertsDDT-check)' } });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).href; if (new URL(url).pathname.startsWith('/password')) return { status: r.status, url, password: true }; continue; }
    return { status: r.status, url };
  }
  return { status: 0, url };
}

// a store still behind its password is linked anyway (decided 2026-11-14): a warning, not a failed deploy; a missing
// product page on an open store still fails it
let bad = 0, closed = 0;
for (const p of [...paths].sort()) {
  const r = await resolve(shop + p);
  const ok = r.status === 200 && !r.password;
  if (r.password) closed++;
  else if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : r.password ? 'WARN' : 'FAIL'} ${p} -> ${r.password ? 'password page (store is not public yet)' : `${r.status} ${r.url}`}`);
}
if (closed) console.log(`::warning::The Shopify store still shows its password page (${closed} URLs): visitors cannot buy until it is opened.`);
console.log(bad ? `\n${bad} shop URL(s) missing: check the product handles before deploying.` : '\nShop links OK');
process.exit(bad ? 1 : 0);
