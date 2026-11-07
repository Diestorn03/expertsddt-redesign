// EN and ES dictionaries must have the same shape: `npm run test:i18n`.
import en from '../src/i18n/en.js';
import es from '../src/i18n/es.js';

const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  Array.isArray(v) ? [`${p}${k}[${v.length}]`, ...v.flatMap((x, i) => (x && typeof x === 'object' && !Array.isArray(x) ? keys(x, `${p}${k}[${i}].`) : []))]
  : v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]);
const a = new Set(keys(en)), b = new Set(keys(es));
const onlyEn = [...a].filter((k) => !b.has(k)), onlyEs = [...b].filter((k) => !a.has(k));
// strings left identical in both languages (possible untranslated copy); brand/tech terms are fine
const same = [];
const walk = (x, y, p = '') => { for (const k of Object.keys(x)) { const v = x[k], w = y?.[k]; if (typeof v === 'string' && typeof w === 'string' && v === w && v.length > 25 && /[a-z]{4}/i.test(v)) same.push(`${p}${k}: ${v.slice(0, 70)}`); else if (v && typeof v === 'object') walk(v, w, `${p}${k}${Array.isArray(v) ? '' : '.'}`); } };
walk(en, es);
onlyEn.forEach((k) => console.error('missing in ES:', k));
onlyEs.forEach((k) => console.error('missing in EN:', k));
same.forEach((s) => console.log('WARN identical text:', s));
console.log(onlyEn.length + onlyEs.length ? `\n${onlyEn.length + onlyEs.length} key mismatch(es)` : `i18n keys match (${a.size} keys)`);
process.exit(onlyEn.length + onlyEs.length ? 1 : 0);
