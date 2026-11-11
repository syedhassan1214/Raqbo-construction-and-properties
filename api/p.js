// RAQBO — public property page: /p/<ref>
// Gives WhatsApp / Facebook a rich link preview (photo, price, location) and gives Google a real page to index.
// Full photos, contact and reviews open on the main site (new visitors are asked to register there first).
const { esc, fmtPrice, origin, rest, signPhoto } = require('./_shared');
const { WA_NUMBER } = require('./_config');
const COLS = 'id,ref,title,description,purpose,property_type,city,area,size,size_unit,price,bedrooms,bathrooms,advertiser_role,published_at,listing_media(kind,path,external_url,sort_order)';

module.exports = async (req, res) => {
  const key = String((req.query && req.query.ref) || '').trim().slice(0, 80);
  const site = origin(req);
  let l = null;
  try {
    const f = /^[0-9a-f-]{36}$/i.test(key) ? `id=eq.${key}` : `ref=eq.${encodeURIComponent(key)}`;
    if (key) [l] = await rest(`listings?select=${COLS}&status=eq.published&${f}&limit=1`);
  } catch { /* falls through to "not found" */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!l) {
    res.statusCode = 404; res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.end(page({ site, title: 'Property not available | RAQBO', desc: 'This property is no longer listed on RAQBO.', image: `${site}/assets/og-default.jpg`, url: `${site}/`, noindex: true,
      body: `<div class="card"><h1>This property is no longer available</h1><p>It may have been sold, rented or removed by the advertiser.</p><a class="btn" href="/">Browse properties on RAQBO</a></div>` }));
  }
  const photos = (l.listing_media || []).filter((m) => m.kind === 'photo').sort((a, b) => a.sort_order - b.sort_order);
  const cover = photos[0];
  let image = `${site}/assets/og-default.jpg`;
  if (cover && cover.external_url) image = cover.external_url;
  else if (cover && cover.path) image = (await signPhoto(cover.path + '.thumb.jpg')) || (await signPhoto(cover.path)) || image;
  const rent = l.purpose === 'rent'; const price = fmtPrice(l.price) + (rent ? ' / month' : '');
  const size = `${Number(l.size).toLocaleString('en-US')} ${l.size_unit}`;
  const specs = [l.bedrooms > 0 ? `${l.bedrooms} bed` : '', l.bathrooms > 0 ? `${l.bathrooms} bath` : '', size, l.property_type].filter(Boolean);
  const title = `${l.title} — ${price} · ${l.area}, ${l.city}`;
  const desc = `${rent ? 'For rent' : 'For sale'} · ${specs.join(' · ')} · ${l.area}, ${l.city}. ${String(l.description || '').replace(/\s+/g, ' ').slice(0, 180)}`;
  const url = `${site}/p/${encodeURIComponent(l.ref)}`; const open = `${site}/#property/${encodeURIComponent(l.id)}`;
  const ld = { '@context': 'https://schema.org', '@type': 'RealEstateListing', name: l.title, description: String(l.description || '').slice(0, 500), url, image, datePosted: l.published_at,
    offers: { '@type': 'Offer', price: Number(l.price), priceCurrency: 'PKR', businessFunction: rent ? 'http://purl.org/goodrelations/v1#LeaseOut' : 'http://purl.org/goodrelations/v1#Sell' },
    address: { '@type': 'PostalAddress', addressLocality: l.city, streetAddress: l.area, addressCountry: 'PK' } };
  res.statusCode = 200; res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.end(page({ site, title: `${title} | RAQBO`, desc, image, url, ld,
    body: `<article class="card">
      <div class="photo" style="background-image:url('${esc(image)}')"><span class="tag">${rent ? 'FOR RENT' : 'FOR SALE'}</span>${l.advertiser_role === 'Owner' ? '<span class="tag owner">DIRECT OWNER</span>' : ''}</div>
      <div class="info"><p class="ref">${esc(l.ref)}</p><h1>${esc(l.title)}</h1><p class="price">${esc(price)}</p><p class="loc">📍 ${esc(l.area)}, ${esc(l.city)}</p>
        <ul class="specs">${specs.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        <p class="desc">${esc(String(l.description || '').slice(0, 420))}${String(l.description || '').length > 420 ? '…' : ''}</p>
        <a class="btn" href="${esc(open)}">View all photos &amp; contact the advertiser</a>
        <a class="btn ghost" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Hi RAQBO, I'm interested in ${l.title} (${l.ref}) — ${url}`)}">Ask RAQBO on WhatsApp</a></div></article>` }));
};

const WA = String(require('./_config').WA_NUMBER || '923001223344').replace(/\D/g, '');
function page({ site, title, desc, image, url, ld, body, noindex }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`}
<meta property="og:type" content="website"><meta property="og:site_name" content="RAQBO"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${site}/assets/favicon.png"><meta name="theme-color" content="#0b0b0c">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
<style>*{box-sizing:border-box}body{margin:0;background:#0b0b0c;color:#f1ece1;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #222}header img{height:34px}header b{color:#f6d27c;letter-spacing:.18em}
main{max-width:980px;margin:0 auto;padding:24px 16px 48px}.card{display:grid;grid-template-columns:1.1fr 1fr;gap:0;overflow:hidden;border:1px solid #2a2620;border-radius:20px;background:#121214}
.photo{position:relative;min-height:340px;background:#1b1b1e center/cover no-repeat}.tag{position:absolute;top:14px;left:14px;padding:5px 10px;border-radius:999px;background:#e6ac42;color:#16120a;font-size:11px;font-weight:800;letter-spacing:.08em}.tag.owner{left:auto;right:14px;background:#111;color:#f6d27c;border:1px solid #e6ac42}
.info{padding:26px}.ref{margin:0;color:#8d8676;font-size:12px;letter-spacing:.12em}h1{margin:6px 0 8px;font-size:clamp(22px,3vw,30px);line-height:1.2;color:#fff}.price{margin:0;color:#f6d27c;font-size:26px;font-weight:800}.loc{margin:6px 0 14px;color:#bdb6a8}
.specs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px;padding:0;list-style:none}.specs li{padding:6px 10px;border:1px solid #2a2620;border-radius:10px;color:#e8e2d5;font-size:14px}.desc{color:#bdb6a8;font-size:15px}
.btn{display:block;margin-top:12px;padding:14px 18px;border-radius:12px;background:linear-gradient(135deg,#f6d27c,#e6ac42);color:#16120a;font-weight:800;text-align:center;text-decoration:none}.btn.ghost{background:transparent;border:1px solid #e6ac42;color:#f6d27c}
@media(max-width:760px){.card{grid-template-columns:1fr}.photo{min-height:240px}}</style></head>
<body><header><a href="/"><img src="${site}/assets/logo-emblem.webp" alt="RAQBO"></a><b>RAQBO</b><a href="https://wa.me/${WA}" rel="noopener" style="margin-left:auto;color:#f6d27c;text-decoration:none;font-weight:700">WhatsApp 0300 1223344</a></header><main>${body}</main><footer style="max-width:980px;margin:0 auto;padding:0 16px 32px;color:#8d8676;font-size:14px">RAQBO · <a href="https://wa.me/${WA}" style="color:#f6d27c">WhatsApp / UAN 0300 1223344</a> · <a href="mailto:raqbo.official@gmail.com" style="color:#f6d27c">raqbo.official@gmail.com</a> · <a href="/" style="color:#f6d27c">raqbo.pk</a></footer></body></html>`;
}
module.exports.page = page;
