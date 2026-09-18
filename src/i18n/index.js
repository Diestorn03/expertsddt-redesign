import en from './en.js';
import es from './es.js';

export const dictionaries = { en, es };
export const locales = Object.keys(dictionaries);
// '' on a root deploy, '/expertsddt-redesign' on GitHub Pages project sites
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Resolve dictionary + link helpers for the current request. Usage: const { t, lang, href, asset, alt } = useI18n(Astro) */
export function useI18n(Astro) {
  const lang = Astro.currentLocale && dictionaries[Astro.currentLocale] ? Astro.currentLocale : 'en';
  const t = dictionaries[lang];
  const external = (p) => /^(https?:|mailto:|tel:|#)/.test(p);
  const href = (p) => (external(p) ? p : `${base}${lang === 'es' ? '/es' : ''}${p}`);
  const asset = (p) => `${base}${p}`;
  const pathname = Astro.url.pathname;
  const rel = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const path = rel.replace(/^\/es(?=\/|$)/, '') || '/'; // same page, language-neutral
  const alt = { lang: lang === 'en' ? 'es' : 'en', href: lang === 'en' ? `${base}/es${path}` : `${base}${path}` };
  return { t, lang, href, asset, alt, path, base };
}
