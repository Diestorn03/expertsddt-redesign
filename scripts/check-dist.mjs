// Static audit of the built site (dist/). No dependencies: `npm run build && npm run test:dist`.
// Fails (exit 1) on broken internal links/assets and missing SEO basics; prints warnings for softer issues.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, posix } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SITE = process.env.SITE_URL || 'https://expertsddt.com';
const errors = [], warns = [];
const err = (p, m) => errors.push(`${p}: ${m}`);
const warn = (p, m) => warns.push(`${p}: ${m}`);

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(DIST);
const pages = files.filter((f) => f.endsWith('.html'));
const route = (f) => '/' + relative(DIST, f).replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\.html$/, '');

// does a site-absolute path exist in dist? (dir -> index.html, or exact file)
const exists = (p) => {
  const clean = decodeURIComponent(p.split('#')[0].split('?')[0]);
  const fs = join(DIST, clean);
  if (existsSync(fs) && statSync(fs).isFile()) return true;
  return existsSync(join(fs, 'index.html'));
};
// files that live on the server, not in dist (managed from the content panel)
const serverManaged = [/^\/downloads\/libraries\//];

const titles = new Map();
for (const f of pages) {
  const r = route(f);
  const h = readFileSync(f, 'utf8');
  const is404 = r === '/404';
  const get = (re) => (h.match(re) || [])[1];
  const title = get(/<title>([^<]*)<\/title>/);
  const desc = get(/<meta name="description" content="([^"]*)"/);
  if (!title) err(r, 'missing <title>'); else if (title.length > 70) warn(r, `title ${title.length} chars (>70)`);
  if (!desc) err(r, 'missing meta description'); else if (desc.length > 170) warn(r, `description ${desc.length} chars (>170)`);
  if (!is404) {
    if (!process.env.ALLOW_NOINDEX) { // staging builds are noindex on purpose and carry no canonical/hreflang
      if (!get(/<link rel="canonical" href="([^"]+)"/)) err(r, 'missing canonical');
      if (/name="robots" content="noindex/.test(h)) err(r, 'indexable page marked noindex');
      if (!/<link rel="alternate" hreflang="es"/.test(h) || !/<link rel="alternate" hreflang="en"/.test(h)) err(r, 'missing hreflang');
    }
    if (titles.has(title)) warn(r, `duplicate title with ${titles.get(title)}`); else titles.set(title, r);
  }
  const h1s = (h.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) err(r, `${h1s} <h1> (expected 1)`);
  if (!/<html lang="(en|es)"/.test(h)) err(r, 'missing html lang');
  if (!/<script type="application\/ld\+json"/.test(h)) warn(r, 'no JSON-LD');
  // images need alt (alt="" is allowed for decoration)
  for (const m of h.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) err(r, `img without alt: ${m[0].slice(0, 80)}`);
  // internal links and assets
  const refs = [...h.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)].map((m) => m[1]);
  for (const u of refs) {
    if (/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(u)) continue;
    const abs = u.startsWith('/') ? u : posix.join(r, u);
    if (serverManaged.some((re) => re.test(abs))) continue;
    if (!exists(abs)) err(r, `broken link/asset ${u}`);
  }
  // external links opened in a new tab need rel=noopener
  for (const m of h.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) if (!/rel="[^"]*noopener/.test(m[0])) err(r, `target=_blank without noopener: ${m[0].slice(0, 90)}`);
  // links that still point at the old WordPress site (they would loop after cutover)
  for (const m of h.matchAll(/href="(https?:\/\/(?:www\.)?expertsddt\.com\/[^"]*)"/g)) {
    if (!m[1].startsWith(SITE + '/') || /\/wp-/.test(m[1])) err(r, `link to old site: ${m[1]}`);
  }
}

// sitemap must list real pages and every indexable page must be in it
const sm = existsSync(join(DIST, 'sitemap-0.xml')) ? readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8') : '';
const smUrls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, ''));
for (const u of smUrls) if (!exists(u)) err('sitemap', `lists missing page ${u}`);
for (const f of pages) { const r = route(f); if (r !== '/404' && !smUrls.includes(r)) warn('sitemap', `${r} not listed`); }
if (!existsSync(join(DIST, 'robots.txt'))) err('robots', 'robots.txt missing');
for (const need of ['.htaccess', '404.html', 'sitemap-index.xml']) if (!existsSync(join(DIST, need))) err('dist', `${need} missing`);

console.log(`${pages.length} pages checked, ${files.length} files in dist`);
warns.forEach((w) => console.log('WARN ', w));
errors.forEach((e) => console.error('ERROR', e));
console.log(errors.length ? `\n${errors.length} error(s)` : '\nAll checks passed');
process.exit(errors.length ? 1 : 0);
