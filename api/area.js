// RAQBO — location pages for search engines: /property/<city> and /property/<city>/<area>
// Lists approved properties with links to /p/<ref>, plus structured data (breadcrumbs and an item list).
const { esc, fmtPrice, origin, rest } = require('./_shared');
const { page } = require('./p');
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const title = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const COLS = 'ref,title,purpose,property_type,city,area,size,size_unit,price,published_at';

module.exports = async (req, res) => {
  const site = origin(req); const q = req.query || {};
  const cs = slug(q.city).slice(0, 60); const as = slug(q.area).slice(0, 80); const purpose = q.purpose === 'rent' ? 'rent' : q.purpose === 'sale' ? 'sale' : '';
  let rows = [];
  try { if (cs) rows = await rest(`listings?select=${COLS}&status=eq.published&is_sample=eq.false&city=ilike.${encodeURIComponent(title(cs))}&order=published_at.desc&limit=400`); } catch { rows = []; }
  if (as) rows = rows.filter((r) => slug(r.area) === as || slug(r.area).startsWith(as));
  if (purpose) rows = rows.filter((r) => r.purpose === purpose);
  const cityName = rows[0] ? rows[0].city : title(cs); const areaName = as ? (rows[0] ? rows[0].area : title(as)) : '';
  const place = areaName ? `${areaName}, ${cityName}` : cityName; const what = purpose === 'rent' ? 'for rent' : purpose === 'sale' ? 'for sale' : 'for sale and rent';
  const url = `${site}/property/${cs}${as ? '/' + as : ''}${purpose ? '?purpose=' + purpose : ''}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!cs || !rows.length) {
    res.statusCode = cs ? 200 : 404; res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.end(page({ site, title: `Property ${what} in ${place || 'Pakistan'} | RAQBO`, desc: `No approved properties in ${place || 'this area'} yet. Post a Property Wanted request and owners will contact you.`, image: `${site}/assets/og-default.jpg`, url, noindex: true,
      body: `<div class="info"><h1>Property ${esc(what)} in ${esc(place || 'Pakistan')}</h1><p class="loc">No approved properties here yet.</p><a class="btn" href="/#wanted">Post a Property Wanted request</a><a class="btn ghost" href="/">Search all properties</a></div>` }));
  }
  const areas = {}; if (!as) rows.forEach((r) => { areas[r.area] = (areas[r.area] || 0) + 1; });
  const ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'RAQBO', item: site + '/' }, { '@type': 'ListItem', position: 2, name: cityName, item: `${site}/property/${cs}` }].concat(as ? [{ '@type': 'ListItem', position: 3, name: areaName, item: `${site}/property/${cs}/${as}` }] : []) },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: `Property ${what} in ${place}`, numberOfItems: rows.length, itemListElement: rows.slice(0, 50).map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}/p/${encodeURIComponent(r.ref)}`, name: r.title })) }];
  const list = rows.slice(0, 120).map((r) => `<li><a href="/p/${encodeURIComponent(r.ref)}"><b>${esc(r.title)}</b><span>${esc(fmtPrice(r.price))}${r.purpose === 'rent' ? ' / month' : ''} · ${esc(r.size)} ${esc(r.size_unit)} · ${esc(r.property_type)}</span><small>${esc(r.area)}, ${esc(r.city)}</small></a></li>`).join('');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
  res.end(page({ site, title: `Property ${what} in ${place} — ${rows.length} listings | RAQBO`, desc: `${rows.length} approved properties ${what} in ${place}, reviewed by RAQBO. Houses, plots, apartments and commercial property with clear prices.`, image: `${site}/assets/og-default.jpg`, url, ld,
    body: `<div class="info"><p class="ref">RAQBO · ${esc(cityName.toUpperCase())}</p><h1>Property ${esc(what)} in ${esc(place)}</h1><p class="loc">${rows.length} approved propert${rows.length === 1 ? 'y' : 'ies'} · every listing reviewed by RAQBO</p>
      <p>${['sale', 'rent'].map((p) => `<a href="/property/${cs}${as ? '/' + as : ''}?purpose=${p}" style="color:#f6d27c;margin-right:14px">${p === 'sale' ? 'For sale' : 'For rent'}</a>`).join('')}</p>
      ${Object.keys(areas).length > 1 ? `<p class="desc">Areas: ${Object.entries(areas).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([a, n]) => `<a href="/property/${cs}/${slug(a)}" style="color:#f6d27c">${esc(a)}</a> (${n})`).join(' · ')}</p>` : ''}
      <ul class="specs" style="display:grid;gap:10px">${list}</ul><a class="btn" href="/">Search and filter on RAQBO</a></div>
      <style>.specs a{display:grid;gap:2px;color:#f1ece1;text-decoration:none}.specs span{color:#f6d27c}.specs small{color:#8d8676}</style>` }));
};
