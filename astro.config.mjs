import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// GitHub Pages project site: SITE_URL=https://<user>.github.io  PAGES_BASE=/<repo>
// Custom domain / Hostinger: leave both unset (site defaults to expertsddt.com, base to "/").
const site = process.env.SITE_URL || 'https://expertsddt.com';
const base = process.env.PAGES_BASE || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always', // matches the WordPress URLs (/services/, /courses/, /exocad-libraries/ …)
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [sitemap({ i18n: { defaultLocale: 'en', locales: { en: 'en-US', es: 'es' } } })],
  build: { inlineStylesheets: 'auto' },
});
