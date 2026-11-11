// RAQBO — Official Auctions pages for search engines
//   /official-auctions                 → hub of topic pages + latest notices
//   /official-auctions/<topic>          → e.g. bank-property-auctions-lahore, nab-property-auction-notices
//   /official-auction/<ref>             → one notice (source, publication date, status, disclaimer)
// Pages show only genuine published notices. A topic with no current notice is served "noindex".
const { esc, fmtPrice, origin, rest } = require('./_shared');
const { page } = require('./p');
const COLS = 'ref,title,institution_name,institution_category,conducted_by,conducting_authority,bank_sale_type,property_category,address,city,district,province,area_value,area_unit,reserve_price,auction_type,auction_at,last_date,venue,status,last_verified_at,source_name,source_url,notice_ref,published_on,published_at,auth_label,review_state';
const PCAT = { residential_plot: 'Residential plot', house: 'House', commercial_plot: 'Commercial plot', shop_building: 'Shop / commercial building', office: 'Office', apartment: 'Apartment', agricultural: 'Agricultural land', industrial_plot: 'Industrial plot', factory_warehouse: 'Factory / warehouse', mixed_use: 'Mixed-use property', other: 'Other property' };
const TYPE = { open: 'Open public auction', sealed: 'Sealed-bid auction / tender', online: 'Official online auction', hybrid: 'Hybrid auction' };
const ST = { upcoming: 'Upcoming', open: 'Open for applications', closing: 'Closing soon', postponed: 'Postponed', suspended: 'Suspended', cancelled: 'Cancelled / withdrawn', completed: 'Completed', result_awaited: 'Result awaited', unconfirmed: 'Status unconfirmed' };
const AUTH = { source_verified: 'Source verified', institution_submitted: 'Institution submitted', pending: 'Source confirmation pending' };
const COMMERCIAL = ['commercial_plot', 'shop_building', 'office', 'mixed_use'];
const isBank = (o) => o.institution_category === 'bank' || o.conducted_by === 'banking_court' || !!o.bank_sale_type;
const TOPICS = {
  'bank-property-auctions-lahore': ['Bank Property Auctions in Lahore', (o) => isBank(o) && /lahore/i.test(o.city + ' ' + o.district)],
  'banking-court-auction-notices-punjab': ['Banking Court Auction Notices in Punjab', (o) => o.conducted_by === 'banking_court' && o.province === 'Punjab'],
  'government-property-auctions-pakistan': ['Government Property Auctions in Pakistan', (o) => ['government', 'development', 'public'].includes(o.institution_category)],
  'commercial-property-auctions-lahore': ['Commercial Property Auctions in Lahore', (o) => COMMERCIAL.includes(o.property_category) && /lahore/i.test(o.city + ' ' + o.district)],
  'upcoming-institutional-property-auctions': ['Upcoming Institutional Property Auctions', () => true],
  'nab-property-auction-notices': ['NAB Property Auction Notices', (o) => o.institution_category === 'accountability']
};
const DISCLAIMER = 'RAQBO is an independent digital property information and advertising platform. Official and institutional auctions are conducted by their respective issuing authorities unless otherwise expressly stated under an authorised arrangement. Information displayed by RAQBO is provided for public convenience and may be subject to amendment, postponement or cancellation. Interested participants should verify all details from the original official notice and the concerned authority before submitting bids, deposits or payments.';
const pkt = (t, time = true) => { if (!t) return '—'; try { return new Date(t).toLocaleString('en-GB', Object.assign({ timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric' }, time ? { hour: '2-digit', minute: '2-digit' } : {})); } catch { return String(t); } };
function status(o) {
  const now = Date.now(); const at = o.auction_at ? Date.parse(o.auction_at) : null; const ld = o.last_date ? Date.parse(o.last_date) : null; const ver = o.last_verified_at ? Date.parse(o.last_verified_at) : null;
  if (['upcoming', 'open', 'closing'].includes(o.status) && at && at < now) return 'result_awaited';
  if (['upcoming', 'open', 'closing'].includes(o.status) && ld && ld < now && (!ver || ver < ld)) return 'unconfirmed';
  if (['upcoming', 'open'].includes(o.status) && ld && ld >= now && ld < now + 3 * 864e5) return 'closing';
  return o.status;
}
const active = (o) => o.review_state === 'published' && ['upcoming', 'open', 'closing', 'postponed'].includes(status(o));
const css = '<style>.oa li{list-style:none;border:1px solid #2a2620;border-radius:14px;padding:14px;margin:0 0 10px}.oa a{color:#f6d27c}.oa small{display:block;color:#8d8676}.pill{display:inline-block;padding:2px 8px;border-radius:7px;background:#1e2a22;color:#9fe0b5;font-size:12px;font-weight:700;margin-right:6px}.legal{margin-top:20px;padding:14px;border-left:3px solid #e6ac42;background:#151515;color:#bdb6a8;font-size:14px}table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:7px 0;border-bottom:1px solid #222;text-align:left;vertical-align:top}th{color:#8d8676;width:40%;font-weight:600}</style>';
const item = (o) => `<li><span class="pill">${esc(ST[status(o)])}</span><span class="pill">${esc(TYPE[o.auction_type])}</span><br><a href="/official-auction/${encodeURIComponent(o.ref)}"><b>${esc(o.title)}</b></a><small>${esc(o.institution_name)} · ${esc([o.city, o.district !== o.city ? o.district : '', o.province].filter(Boolean).join(', '))}</small><small>Auction ${esc(pkt(o.auction_at))}${o.reserve_price ? ' · reserve ' + esc(fmtPrice(o.reserve_price)) : ''}</small><small>Source: ${esc(o.source_name || 'issuing institution')}${o.notice_ref ? ' · notice ' + esc(o.notice_ref) : ''}${o.published_on ? ' · published ' + esc(pkt(o.published_on, false)) : ''}</small></li>`;

module.exports = async (req, res) => {
  const site = origin(req); const q = req.query || {}; res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let rows = []; try { rows = await rest(`official_auctions?select=${COLS}&review_state=in.(published,archived)&order=auction_at.asc&limit=1000`); } catch { rows = []; }
  const img = `${site}/assets/og-default.jpg`;
  // One notice
  if (q.ref) {
    const o = rows.find((r) => r.ref === String(q.ref)); const url = `${site}/official-auction/${encodeURIComponent(q.ref)}`;
    if (!o) { res.statusCode = 404; res.setHeader('Cache-Control', 'public, s-maxage=300'); return res.end(page({ site, title: 'Auction notice not found | RAQBO Official Auctions', desc: 'This official auction notice is not available. It may have been withdrawn or archived.', image: img, url, noindex: true, body: `<div class="info"><h1>Auction notice not available</h1><p class="loc">It may have been withdrawn or archived.</p><a class="btn" href="/#official-auctions">All official auctions</a></div>` })); }
    const s = status(o); const where = [o.address, o.city, o.district !== o.city ? o.district : '', o.province].filter(Boolean).join(', ');
    const ld = { '@context': 'https://schema.org', '@type': 'Event', name: o.title, startDate: o.auction_at, eventStatus: s === 'cancelled' ? 'https://schema.org/EventCancelled' : s === 'postponed' ? 'https://schema.org/EventPostponed' : 'https://schema.org/EventScheduled', eventAttendanceMode: o.auction_type === 'online' ? 'https://schema.org/OnlineEventAttendanceMode' : o.auction_type === 'hybrid' ? 'https://schema.org/MixedEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode', location: { '@type': 'Place', name: o.venue || where, address: where }, organizer: { '@type': 'Organization', name: o.institution_name }, description: `${TYPE[o.auction_type]} by ${o.institution_name}. Source: ${o.source_name || 'issuing institution'}.` };
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.end(page({ site, title: `${o.title} — ${o.institution_name} auction | RAQBO`, desc: `${TYPE[o.auction_type]} on ${pkt(o.auction_at)} by ${o.institution_name}${o.city ? ' in ' + o.city : ''}. Status: ${ST[s]}. Source: ${o.source_name || 'issuing institution'}. Check the original notice.`, image: img, url, ld, noindex: o.review_state === 'archived',
      body: `${css}<div class="info"><p class="ref">RAQBO OFFICIAL AUCTIONS · ${esc(o.ref)}</p><h1>${esc(o.title)}</h1><p class="loc"><span class="pill">${esc(ST[s])}</span><span class="pill">${esc(AUTH[o.auth_label])}</span><span class="pill">${esc(TYPE[o.auction_type])}</span></p>
        <table><tr><th>Issuing authority</th><td>${esc(o.institution_name)}</td></tr>${o.conducted_by && o.conducted_by !== 'institution' ? `<tr><th>Auction conducted by</th><td>${esc(o.conducting_authority || o.conducted_by.replace('_', ' '))}</td></tr>` : ''}<tr><th>Property</th><td>${esc(PCAT[o.property_category])}${o.area_value ? ` · ${esc(Number(o.area_value))} ${esc(o.area_unit)}` : ''}</td></tr><tr><th>Location</th><td>${esc(where || 'As in the notice')}</td></tr><tr><th>Reserve price</th><td>${o.reserve_price ? esc(fmtPrice(o.reserve_price)) : 'Not disclosed'}</td></tr><tr><th>Auction date</th><td>${esc(pkt(o.auction_at))} (Pakistan time)</td></tr>${o.last_date ? `<tr><th>Last date to participate</th><td>${esc(pkt(o.last_date))}</td></tr>` : ''}<tr><th>Venue</th><td>${esc(o.venue || '—')}</td></tr>
        <tr><th>Original source</th><td>${esc(o.source_name || 'Submitted by the institution')}${o.source_url ? ` · <a href="${esc(o.source_url)}" rel="nofollow noopener" style="color:#f6d27c">official link</a>` : ''}</td></tr><tr><th>Notice reference</th><td>${esc(o.notice_ref || '—')}</td></tr><tr><th>Publication date</th><td>${esc(o.published_on ? pkt(o.published_on, false) : '—')}</td></tr><tr><th>Last verified by RAQBO</th><td>${esc(pkt(o.last_verified_at))}</td></tr></table>
        <a class="btn" href="/#official-auction/${encodeURIComponent(o.ref)}">Full notice, documents, reminders and contact</a><a class="btn ghost" href="/#official-auctions">All official auctions</a>
        <p class="legal">${esc(DISCLAIMER)}</p></div>` }));
  }
  // Topic page or hub
  const slug = String(q.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
  const live = rows.filter(active);
  if (slug) {
    let t = TOPICS[slug]; let m;
    if (!t && (m = slug.match(/^property-auctions-([a-z-]+)$/))) { const city = m[1].replace(/-/g, ' '); t = [`Official Property Auctions in ${city.replace(/\b\w/g, (c) => c.toUpperCase())}`, (o) => new RegExp('\\b' + city + '\\b', 'i').test(`${o.city} ${o.district}`)]; }
    const url = `${site}/official-auctions/${slug}`;
    if (!t) { res.statusCode = 404; return res.end(page({ site, title: 'Page not found | RAQBO', desc: 'Not found', image: img, url, noindex: true, body: '<div class="info"><h1>Page not found</h1><a class="btn" href="/official-auctions">Official auctions</a></div>' })); }
    const list = live.filter(t[1]); const latest = list.map((o) => o.published_at).filter(Boolean).sort().pop();
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    return res.end(page({ site, title: `${t[0]}${list.length ? ` — ${list.length} current notice${list.length === 1 ? '' : 's'}` : ''} | RAQBO`, desc: list.length ? `${list.length} current ${t[0].toLowerCase()} with the issuing authority, date, reserve price and original source. Last updated ${pkt(latest, false)}.` : `No current ${t[0].toLowerCase()} on RAQBO right now. Get alerts when one is announced.`, image: img, url, noindex: !list.length,
      ld: list.length ? { '@context': 'https://schema.org', '@type': 'ItemList', name: t[0], numberOfItems: list.length, itemListElement: list.slice(0, 50).map((o, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}/official-auction/${encodeURIComponent(o.ref)}`, name: o.title })) } : null,
      body: `${css}<div class="info"><p class="ref">RAQBO OFFICIAL AUCTIONS</p><h1>${esc(t[0])}</h1><p class="loc">${list.length ? `${list.length} current notice${list.length === 1 ? '' : 's'} · latest published ${esc(pkt(latest, false))} · every notice shows its original source` : 'No current notice matches this page. RAQBO does not show auctions without a genuine, current official notice.'}</p>
        <ul class="oa" style="padding:0">${list.slice(0, 200).map(item).join('')}</ul><a class="btn" href="/#official-auctions/alerts">Get auction alerts</a><a class="btn ghost" href="/official-auctions">All topics</a><p class="legal">${esc(DISCLAIMER)}</p></div>` }));
  }
  const url = `${site}/official-auctions`; const latest = live.map((o) => o.published_at).filter(Boolean).sort().pop();
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
  return res.end(page({ site, title: 'Government, Court, Bank & Institutional Property Auctions in Pakistan | RAQBO', desc: `Discover official property auctions across Pakistan — banks, Banking Courts, NAB, development authorities and government departments. ${live.length} current notices with original sources.`, image: img, url, noindex: !live.length,
    body: `${css}<div class="info"><p class="ref">RAQBO OFFICIAL AUCTIONS</p><h1>Government, Court, Bank &amp; Institutional Property Auctions</h1><p class="loc">Discover Official Property Auctions Across Pakistan — All in One Place.${latest ? ` Latest notice published ${esc(pkt(latest, false))}.` : ''}</p>
      <p>${Object.entries(TOPICS).map(([s, t]) => { const n = live.filter(t[1]).length; return `<a href="/official-auctions/${s}" style="color:#f6d27c;margin-right:14px">${esc(t[0])}${n ? ` (${n})` : ''}</a>`; }).join('')}</p>
      <ul class="oa" style="padding:0">${live.slice(0, 60).map(item).join('') || '<li>No current official auction notices yet.</li>'}</ul><a class="btn" href="/#official-auctions">Search and filter on RAQBO</a><p class="legal">${esc(DISCLAIMER)}</p></div>` }));
};
