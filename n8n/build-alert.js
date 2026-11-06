// RAQBO — turns a Supabase database webhook into an admin alert.
// Change SECRET to the same value you put in the Supabase webhook header "x-raqbo-secret".
const SECRET = 'CHANGE-ME-raqbo-secret';
const ADMIN_URL = 'https://raqbo.pk/#admin';

const SERVICES = { verification: 'Property verification request', legal: 'Legal services enquiry', documents: 'Document preparation & drafting', registry: 'Registry assistance', general: 'General enquiry' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pkr = (n) => { n = Number(n) || 0; if (n >= 1e7) return 'PKR ' + (Math.round(n / 1e5) / 100) + ' Cr'; if (n >= 1e5) return 'PKR ' + (Math.round(n / 1e3) / 100) + ' Lakh'; return 'PKR ' + n.toLocaleString('en-US'); };
const rows = (pairs) => pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#7b7568;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#16140f">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('');
const wrap = (title, intro, pairs) => `<div style="font-family:Arial,sans-serif;max-width:560px">
  <div style="background:#0b0b0c;color:#f6d27c;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700;letter-spacing:.12em">RAQBO · ADMIN ALERT</div>
  <div style="border:1px solid #ece6da;border-top:0;padding:18px;border-radius:0 0 10px 10px">
    <h2 style="margin:0 0 6px;color:#121212;font-size:19px">${esc(title)}</h2><p style="margin:0 0 12px;color:#5a544a">${esc(intro)}</p>
    <table style="border-collapse:collapse;font-size:14px">${rows(pairs)}</table>
    <p style="margin:18px 0 0"><a href="${ADMIN_URL}" style="background:#e6ac42;color:#16120a;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open admin panel</a></p>
  </div></div>`;

const out = [];
for (const item of $input.all()) {
  const headers = item.json.headers || {};
  if ((headers['x-raqbo-secret'] || '') !== SECRET) continue;          // ignore calls without the right secret
  const { type, table, record: r = {}, old_record: o = null } = item.json.body || {};
  let subject = null; let html = null; let text = null;

  if (table === 'listings' && type === 'INSERT' && r.status === 'pending') {
    subject = `New listing to review: ${r.title}`;
    const pairs = [['Reference', r.ref], ['Title', r.title], ['Location', `${r.area}, ${r.city}`], ['Price', pkr(r.price) + (r.purpose === 'rent' ? ' / month' : '')], ['Purpose', r.purpose === 'rent' ? 'For rent' : 'For sale'], ['Type', r.property_type], ['Advertiser', `${r.advertiser_name || ''} (${r.advertiser_role})`], ['Size', `${r.size} ${r.size_unit}`]];
    html = wrap('New listing awaiting review', 'A new property was submitted and is waiting for approval. It is not public yet.', pairs);
    text = `New RAQBO listing to review: ${r.title} — ${r.area}, ${r.city} — ${pkr(r.price)}. Ref ${r.ref}. ${ADMIN_URL}`;
  } else if (table === 'listings' && type === 'UPDATE' && o && r.status === 'pending' && o.status !== 'pending' && r.reviewed_at === o.reviewed_at) {
    subject = `Edited listing to re-review: ${r.title}`;
    html = wrap('Listing edited — needs review again', 'The advertiser changed this listing. It is hidden until you approve it again.', [['Reference', r.ref], ['Title', r.title], ['Location', `${r.area}, ${r.city}`], ['Price', pkr(r.price)], ['Previously', o.status]]);
    text = `RAQBO listing edited and back in review: ${r.title} (Ref ${r.ref}). ${ADMIN_URL}`;
  } else if (table === 'enquiries' && type === 'INSERT') {
    const svc = SERVICES[r.service] || r.service;
    subject = `New service request: ${svc} — ${r.name}`;
    html = wrap('New service request', 'A customer sent a service request (they were also taken to WhatsApp to send it).', [['Reference', r.ref], ['Service', svc], ['Name', r.name], ['Phone', r.phone], ['Email', r.email], ['City', r.city], ['Property', r.property_ref], ['Preferred contact', r.preferred_contact], ['Message', r.message]]);
    text = `New RAQBO request (${svc}) from ${r.name}, ${r.phone}. Ref ${r.ref}.`;
  } else if (table === 'reports' && type === 'INSERT') {
    subject = `Listing reported: ${r.reason}`;
    html = wrap('A listing was reported', 'Please review the reported listing in the admin panel (Property reports).', [['Reference', r.ref], ['Reason', r.reason], ['Details', r.details], ['Listing ID', r.listing_id], ['Reported by', [r.reporter_name, r.reporter_phone].filter(Boolean).join(' · ') || 'Signed-in user']]);
    text = `RAQBO listing reported (${r.reason}). Ref ${r.ref}. ${ADMIN_URL}`;
  }
  if (subject) out.push({ json: { subject, html, text, table, type } });
}
return out;
