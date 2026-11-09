// Post-deploy smoke test against the live URL: SITE_URL=https://expertsddt.com node scripts/smoke.mjs
// EXPECT_NOINDEX=1 for staging (robots must disallow everything). Retries a few times while the hosting catches up.
const site = (process.env.SITE_URL || '').replace(/\/$/, '');
if (!site) { console.error('SITE_URL is required'); process.exit(1); }
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ExpertsDDT-smoke)' };
const get = (p, opt = {}) => fetch(site + p, { headers: UA, redirect: 'manual', ...opt });

const checks = [
  ...['/', '/es/', '/services/', '/es/services/', '/store/', '/exocad-libraries/', '/ddt-xchange/', '/es/ddt-xchange/', '/contact/', '/terms-and-conditions/', '/refund-policy/', '/privacy-policy/'].map((p) => ({
    name: `200 ${p}`, run: async () => { const r = await get(p); const t = await r.text(); return r.status === 200 && t.includes('<title>') || `status ${r.status}`; } })),
  { name: 'robots.txt', run: async () => { const r = await get('/robots.txt'); const t = await r.text(); const blocked = /Disallow:\s*\/\s*$/m.test(t); return (r.status === 200 && blocked === !!process.env.EXPECT_NOINDEX) || `status ${r.status}, disallow-all=${blocked}`; } },
  { name: 'sitemap', run: async () => { const r = process.env.EXPECT_NOINDEX ? { status: 200 } : await get('/sitemap-index.xml'); return r.status === 200 || `status ${r.status}`; } },
  { name: 'unknown URL gives 404', run: async () => { const r = await get('/this-page-does-not-exist/'); return r.status === 404 || `status ${r.status}`; } },
  { name: '301 /libraries/ -> /exocad-libraries/', run: async () => { const r = await get('/libraries/'); return (r.status === 301 && (r.headers.get('location') || '').endsWith('/exocad-libraries/')) || `status ${r.status} ${r.headers.get('location')}`; } },
  { name: '301 old service post -> /services/#design', run: async () => { const r = await get('/2025/11/27/design/'); return (r.status === 301 && (r.headers.get('location') || '').endsWith('/services/#design')) || `status ${r.status} ${r.headers.get('location')}`; } },
  { name: '410 /wp-admin/', run: async () => { const r = await get('/wp-admin/'); return r.status === 410 || `status ${r.status}`; } },
  { name: 'security headers', run: async () => { const r = await get('/'); const h = (n) => r.headers.get(n); const miss = ['x-content-type-options', 'content-security-policy', 'x-frame-options', 'referrer-policy', ...(site.startsWith('https') ? ['strict-transport-security'] : [])].filter((n) => !h(n)); return miss.length === 0 || `missing ${miss.join(', ')}`; } },
  { name: 'HTTP -> HTTPS', run: async () => { if (!site.startsWith('https')) return true; const r = await fetch(site.replace('https:', 'http:') + '/', { headers: UA, redirect: 'manual' }); return ([301, 302, 308].includes(r.status) && (r.headers.get('location') || '').startsWith('https://')) || `status ${r.status}`; } },
];

let failed = 0;
for (const c of checks) {
  let res;
  for (let i = 0; i < 3; i++) { try { res = await c.run(); } catch (e) { res = String(e.message || e); } if (res === true) break; await new Promise((r) => setTimeout(r, 4000)); }
  if (res === true) console.log(`ok    ${c.name}`); else { failed++; console.error(`FAIL  ${c.name}: ${res}`); }
}
console.log(failed ? `\n${failed} smoke check(s) failed` : '\nSmoke test passed');
process.exit(failed ? 1 : 0);
