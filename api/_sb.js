// RAQBO — Supabase helpers for the server functions.
// asUser()    runs a call as the signed-in member (their own token, normal rules).
// asService() runs a call with the service-role key — only used to confirm a
//             payment after Safepay itself has been asked. The service-role key
//             is read from Vercel environment variables and is never sent to a
//             browser. Do not add it to api/_config.js.
const { SB_URL, SB_KEY } = require('./_config');

const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasService = () => !!SERVICE();

async function rpc(fn, args, { token, service } = {}) {
  const key = service ? SERVICE() : SB_KEY;
  if (service && !key) throw new Error('SUPABASE_SERVICE_ROLE is not set in Vercel environment variables.');
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + (token || key), 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {})
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) { const e = new Error((json && (json.message || json.hint)) || text.slice(0, 300) || ('Supabase ' + r.status)); e.status = r.status; e.body = json; throw e; }
  return json;
}

const asUser = (fn, args, token) => rpc(fn, args, { token });
const asService = (fn, args) => rpc(fn, args, { service: true });

// Reads the member's access token from the Authorization header
function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  return m ? m[1].trim() : '';
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve({ json: req.body, raw: JSON.stringify(req.body) });
  if (typeof req.body === 'string') { let j = null; try { j = JSON.parse(req.body); } catch { /* not json */ } return Promise.resolve({ json: j, raw: req.body }); }
  return new Promise((resolve) => {
    let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { let j = null; try { j = JSON.parse(raw); } catch { /* not json */ } resolve({ json: j, raw }); });
    req.on('error', () => resolve({ json: null, raw: '' }));
  });
}

const json = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };

module.exports = { rpc, asUser, asService, bearer, readBody, json, hasService };
