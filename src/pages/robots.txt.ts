import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  // staging builds (PUBLIC_NOINDEX=1) must never be crawled
  if (import.meta.env.PUBLIC_NOINDEX) return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${site?.origin ?? ''}${base}/sitemap-index.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
};
