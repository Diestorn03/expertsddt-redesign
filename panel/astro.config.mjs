// Panel de contenido (admin.expertsddt.com): Astro SSR on Node, standalone. DESIGN.md §9.2.
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { copyFile } from 'node:fs/promises';

// dist/server/entry.mjs is our own server (server.mjs); Astro's bundle becomes dist/server/app.mjs
let serverDir;
const ownServer = {
  name: 'panel-server',
  hooks: {
    'astro:config:done': ({ config }) => { serverDir = config.build.server; },
    'astro:build:done': () => copyFile(new URL('./server.mjs', import.meta.url), new URL('entry.mjs', serverDir)),
  },
};

export default defineConfig({
  output: 'server',
  // no body cap at build time: lib/panel.mjs counts the bytes and reads LIB_MAX_MB at run time
  adapter: node({ mode: 'standalone', bodySizeLimit: 0 }),
  integrations: [ownServer],
  server: { port: 8080 },
  build: { inlineStylesheets: 'never', serverEntry: 'app.mjs' }, // never a <style> in the HTML: the CSP has no 'unsafe-inline'
  vite: {
    build: { assetsInlineLimit: 0 }, // otherwise small scripts are inlined into the HTML and the CSP blocks them
    server: { fs: { allow: ['..'] } }, // ../src/styles/global.css and ../public/* in astro dev
  },
  security: {
    checkOrigin: false, // the middleware does the origin check (absent Origin accepted, 'null' or foreign refused), covered by the tests
    allowedDomains: [{ protocol: 'https', hostname: 'admin.expertsddt.com' }],
  },
  devToolbar: { enabled: false },
});
