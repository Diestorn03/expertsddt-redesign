// one-off: where does the GA consent markup (rendered by <Analytics /> inside <head> when PUBLIC_GA_ID is set) end up once parsed?
import { readFileSync } from 'node:fs';
import { launch } from '../lib.mjs';
let html = readFileSync('C:/Users/Diestorn/Desktop/expertsddt-sitefix/tools/qa/out/.dist-default/index.html', 'utf8');
const marker = html.match(/<script type="module" src="\/_astro\/ClientRouter[^"]*"><\/script>/)[0];
const ga = `<div class="consent" id="consent" hidden role="dialog" aria-live="polite" aria-label="Cookies"><p>We use cookies</p><div class="consent__btns"><button class="btn btn--outline" type="button" data-consent="denied">Decline</button><button class="btn btn--primary" type="button" data-consent="granted">Accept</button></div></div><script>(function(){ var id = "G-TEST"; document.addEventListener('astro:page-load', function(){}); })();</script>`;
html = html.replace(marker, marker + ga);
const b = await launch();
const p = await (await b.newContext()).newPage();
const r = await p.evaluate((h) => {
  const d = new DOMParser().parseFromString(h, 'text/html');
  const where = (sel) => { const e = d.querySelector(sel); return e ? (e.closest('head') ? 'head' : 'body') : 'missing'; };
  return { consent: where('#consent'), heroImagePreload: where('link[rel=preload][href="/img/design-services.webp"]'), headChildrenAfterParse: d.head.children.length, bodyFirst: [...d.body.children].slice(0, 4).map((e) => e.tagName + (e.id ? '#' + e.id : e.className ? '.' + e.className.split(' ')[0] : '')) };
}, html);
console.log(JSON.stringify(r));
await b.close();
