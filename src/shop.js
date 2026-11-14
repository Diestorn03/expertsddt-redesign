// Shopify store links (shop.expertsddt.com). Handles mirror the store catalogue defined in
// ExpertsDDT-Shopify/prototype/src/data/products.ts; scripts/check-shop.mjs verifies them before every production deploy.
// the store is Shopify (our /store/ page is gone, 2026-11-14); PUBLIC_SHOP_URL only overrides the address
const base = (import.meta.env.PUBLIC_SHOP_URL || 'https://shop.expertsddt.com').replace(/\/$/, '');

export const shop = base || null;
export const shopProduct = (handle) => (base ? `${base}/products/${handle}` : null);
export const shopCollection = (handle) => (base ? `${base}/collections/${handle}` : null);
export const handles = {
  course: 'exocad-training-teeth-virtual-gingiva-libraries',
  occlusion: 'teeth-in-occlusion-virtual-gingiva-libraries',
  smileCreator: '3d-aesthetic-guidelines-smile-creator-8mm',
};
