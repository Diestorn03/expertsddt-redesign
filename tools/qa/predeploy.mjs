// Motion QA before a deploy: every gating check in one unattended run (about 3 h 15 min on this PC with nothing else running).
// Builds the QA dist from the working tree once, then: detector self-test, all pages (EN + ES), the edge cases on the home,
// the inner-page scenarios and the root-cause probes. Exit 0 = no FAIL, 1 = some FAIL (read the summaries), 2 = a step crashed.
// usage (from tools/qa): node predeploy.mjs [run-name]
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] || `predeploy-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
const PAGES = '/,/services/,/courses/,/store/,/exocad-libraries/,/contact/,/terms-and-conditions/,/refund-policy/,/privacy-policy/,/404/,/es/,/es/services/,/es/courses/,/es/store/,/es/exocad-libraries/,/es/contact/,/es/terms-and-conditions/,/es/refund-policy/,/es/privacy-policy/';
const BOTH = ['--motion', 'no-preference,reduce'];
const steps = [
  ['selftest', ['qa.mjs', '--selftest']],
  ['pages', ['qa.mjs', '--pages', PAGES, '--viewports', 'desktop,laptop,phone', ...BOTH, '--scenarios', 'loader,sweep,pins,keys', '--out', `${name}-pages`]], // builds
  ['home', ['qa.mjs', '--no-build', '--pages', '/,/es/', '--viewports', 'tablet,tablet-land,phone-small,touch:1194x834', ...BOTH, '--scenarios', 'loader,sweep,pins', '--out', `${name}-home`]],
  ['edge', ['qa.mjs', '--no-build', '--viewports', 'desktop,laptop,tablet,phone', ...BOTH, '--scenarios', 'edge', '--out', `${name}-edge`]],
  ['inner', ['scenarios/inner/inner.mjs', '--out', `${name}-inner`, '--viewports', 'desktop,tablet,phone', ...BOTH, '--lang', 'en,es']],
  ['probes', ['scenarios/inner/probes.mjs', '--out', `${name}-probes`]],
];
const res = steps.map(([label, args]) => {
  console.log(`\n== ${label}: node ${args.join(' ')}`);
  const r = spawnSync(process.execPath, args, { cwd: HERE, stdio: 'inherit' });
  return [label, r.status ?? 2];
});
console.log(`\n${res.map(([l, s]) => `${l}: ${['ok', 'FAIL', 'crashed'][s] ?? `exit ${s}`}`).join(' · ')}\nsummaries: out/${name}-*/summary.md, out/${name}-inner, out/${name}-probes/probes.json`);
process.exit(Math.max(...res.map(([, s]) => (s > 1 ? 2 : s))));
