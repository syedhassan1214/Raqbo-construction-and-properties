// RAQBO — sitemap of all published properties: /sitemap-properties.xml
const { origin, rest } = require('./_shared');
module.exports = async (req, res) => {
  const site = origin(req); let rows = [];
  try { rows = await rest('listings?select=ref,published_at,city,area&status=eq.published&order=published_at.desc&limit=5000'); } catch { /* empty sitemap */ }
  const urls = [`<url><loc>${site}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`]
    .concat((() => { const slug = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); const set = new Set(); rows.forEach((r) => { if (r.city) { set.add(slug(r.city)); if (r.area) set.add(slug(r.city) + '/' + slug(r.area)); } }); return [...set].map((u) => `<url><loc>${site}/property/${u}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`); })())
    .concat(rows.map((r) => `<url><loc>${site}/p/${encodeURIComponent(r.ref)}</loc>${r.published_at ? `<lastmod>${String(r.published_at).slice(0, 10)}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.8</priority></url>`));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
};
