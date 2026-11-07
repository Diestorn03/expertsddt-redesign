// Simulates the RewriteRule lines of public/.htaccess against the old WordPress URLs.
// Runs without Apache: `npm run test:redirects`. Rules with %{...} conditions (https/www) are skipped.
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../public/.htaccess', import.meta.url), 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('RewriteRule'))
  .map((l) => { const [, pattern, sub, flags = ''] = l.match(/^RewriteRule\s+(\S+)\s+(\S+)(?:\s+\[([^\]]*)\])?/); return { pattern, sub, flags: flags.split(',') }; })
  .filter((r) => !r.sub.includes('%{'));

function resolve(path) { // path without the leading slash, like Apache in a per-directory context
  for (const r of rules) {
    if (!new RegExp(r.pattern, r.flags.includes('NC') ? 'i' : '').test(path)) continue;
    if (r.flags.includes('G')) return '410';
    if (r.flags.includes('F')) return '403';
    if (r.sub === '-') { if (r.flags.includes('L')) return 'pass'; continue; }
    return `301 ${r.sub}`;
  }
  return 'pass';
}

const portal = 'https://portal.expertsddt.com';
const shop = 'https://shop.expertsddt.com';
const cases = {
  'libraries/': '301 /exocad-libraries/',
  'carrito/': `301 ${shop}/cart`, 'finalizar-compra/': `301 ${shop}/cart`, 'shop/': `301 ${shop}/`,
  'categoria-producto/cursos/': `301 ${shop}/collections/courses`, 'categoria-producto/plantillas/': `301 ${shop}/collections/templates`, 'categoria-producto/productos-fisicos/': `301 ${shop}/collections/all`,
  'producto/templates-package/': `301 ${shop}/products/teeth-in-occlusion-virtual-gingiva-libraries`,
  'producto/vision-x-extraoral-photogrammetry-system/': `301 ${shop}/products/vision-x-extraoral-photogrammetry`,
  'producto/5-0-facial-scanning-technology-by-fernando-polanco/': `301 ${shop}/products/facial-scanning-5-0-fernando-polanco`,
  'producto/titanium-fp1-healing-abutment-for-surgery-patent-pending/': `301 ${shop}/products/fp1-healing-abutment`,
  'producto/titanium-fp3-healing-abutment-for-surgery-patent-pending/': `301 ${shop}/products/fp3-healing-abutment`,
  'producto/3d-aesthetic-guidelines-smile-creator-8mm-dr-fernando-polanco/': `301 ${shop}/products/3d-aesthetic-guidelines-smile-creator-8mm`,
  'producto/masterclass-master-the-virtual-teeth-in-occlusion-libraries/': `301 ${shop}/products/exocad-training-teeth-virtual-gingiva-libraries`,
  'producto/some-future-product/': `301 ${shop}/collections/all`, 'pricing-2/': '301 /courses/',
  'register/': `301 ${portal}/signup`, 'login/': `301 ${portal}/login`, 'mi-cuenta/': `301 ${portal}/login`, 'account/': `301 ${portal}/login`,
  'pagina-ejemplo/': '301 /', 'category/sin-categoria/': '301 /',
  '2025/11/27/design/': '301 /services/#design', '2025/11/18/hola-mundo/': '301 /services/#manufacturing',
  '2025/11/27/final-product-manufacturing/': '301 /services/#manufacturing', '2025/11/27/cutting-edge-technology/': '301 /services/#scanning',
  '2025/11/27/training/': '301 /services/#training', '2025/11/27/support/': '301 /services/#support', '2025/11/27/implementation/': '301 /services/#support',
  '2025/11/27/components/': '301 /services/', '2025/11/27/customized-workflows/': '301 /services/',
  'wp-content/uploads/2026/09/services-and-fees-experts-ddt.pdf': '301 /downloads/services-and-fees-experts-ddt.pdf',
  'wp-content/uploads/2026/11/exocad-implant-libraries-v9.zip': '301 /exocad-libraries/',
  'page-sitemap.xml': '301 /sitemap-index.xml', 'sitemap_index.xml': '301 /sitemap-index.xml', 'product_cat-sitemap.xml': '301 /sitemap-index.xml',
  'wp-admin/': '410', 'wp-login.php': '410', 'xmlrpc.php': '410', 'wp-json/wp/v2/pages': '410', 'wp-content/uploads/2025/11/LOGO.jpg': '410', 'feed/': '410',
  '.git/config': '403', '.htaccess': '403',
  // must stay untouched
  '': 'pass', 'services/': 'pass', 'es/services/': 'pass', 'store/': 'pass', 'exocad-libraries/': 'pass', 'downloads/services-and-fees-experts-ddt.pdf': 'pass',
  '_astro/index.abc123.css': 'pass', '.well-known/security.txt': 'pass', 'sitemap-index.xml': 'pass', 'privacy-policy/': 'pass', 'es/terms-and-conditions/': 'pass',
};
let bad = 0;
for (const [path, want] of Object.entries(cases)) {
  const got = resolve(path);
  if (got !== want) { bad++; console.error(`FAIL /${path}\n  want: ${want}\n  got:  ${got}`); }
}
console.log(`${Object.keys(cases).length - bad}/${Object.keys(cases).length} redirect cases OK (${rules.length} rules)`);
process.exit(bad ? 1 : 0);
