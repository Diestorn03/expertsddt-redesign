import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${site?.origin ?? ''}${base}/sitemap-index.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
};
