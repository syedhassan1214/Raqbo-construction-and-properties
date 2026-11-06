// Helpers shared by the RAQBO server functions
const { SB_URL, SB_KEY } = require('./_config');
const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trim = (x) => String(Math.round(x * 100) / 100);
const fmtPrice = (n) => { n = Number(n) || 0; if (n >= 1e7) return 'PKR ' + trim(n / 1e7) + ' Crore'; if (n >= 1e5) return 'PKR ' + trim(n / 1e5) + ' Lakh'; return 'PKR ' + n.toLocaleString('en-US'); };
const origin = (req) => (req.headers['x-forwarded-proto'] || 'https') + '://' + (req.headers['x-forwarded-host'] || req.headers.host);
async function rest(path) { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H }); if (!r.ok) throw new Error('Supabase ' + r.status); return r.json(); }
async function signPhoto(path, seconds = 7 * 24 * 3600) {
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/listing-media/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds }) });
  if (!r.ok) return null; const d = await r.json(); return d.signedURL ? `${SB_URL}/storage/v1${d.signedURL}` : null;
}
module.exports = { esc, fmtPrice, origin, rest, signPhoto };
