// RAQBO — Safepay adapter (Express / Hosted Checkout, v3)
// Everything Safepay-specific lives in this one file. To move to another
// gateway later, only this file and the two files in api/pay/ change.
//
// Flow:
//   1. createCheckout()  → asks Safepay for a tracker, then a 1-hour token,
//                          and builds the hosted checkout link.
//   2. The customer pays on Safepay's page and comes back to /pay/return.
//   3. lookup()          → asks Safepay what really happened. This is the ONLY
//                          thing RAQBO trusts. A redirect or a webhook is just
//                          a nudge to call lookup(); neither can mark a payment
//                          paid on its own.
//
// Keys live in Vercel → Settings → Environment Variables. Never in the website
// and never in the database (platform_settings is public).
const crypto = require('crypto');

const CFG = () => {
  const mode = (process.env.SAFEPAY_MODE || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  return {
    mode,
    // API host for server calls
    api: mode === 'production' ? 'https://api.getsafepay.com' : 'https://sandbox.api.getsafepay.com',
    // Host that serves the hosted checkout page
    checkout: process.env.SAFEPAY_CHECKOUT_BASE || (mode === 'production' ? 'https://getsafepay.com' : 'https://sandbox.api.getsafepay.com'),
    apiKey: process.env.SAFEPAY_API_KEY || '',
    secret: process.env.SAFEPAY_SECRET_KEY || '',
    webhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET || '',
    // Safepay takes the amount in the lowest denomination. For PKR that is
    // paisa (1 rupee = 100 paisa). Confirm with one sandbox payment before
    // going live; set SAFEPAY_MINOR_UNITS=false if your account uses rupees.
    minorUnits: String(process.env.SAFEPAY_MINOR_UNITS || 'true') !== 'false',
    intent: process.env.SAFEPAY_INTENT || 'CYBERSOURCE'
  };
};

const configured = () => { const c = CFG(); return !!(c.apiKey && c.secret); };

async function call(path, { method = 'POST', body, secret } = {}) {
  const c = CFG();
  const r = await fetch(c.api + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-SFPY-MERCHANT-SECRET': secret || c.secret },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(`Safepay ${r.status}: ${(json && (json.message || json.error)) || text.slice(0, 300)}`); e.status = r.status; throw e; }
  return json;
}

// Amount in whole rupees → what Safepay expects
const toGateway = (rupees) => (CFG().minorUnits ? Math.round(Number(rupees) * 100) : Math.round(Number(rupees)));
const fromGateway = (amt) => (CFG().minorUnits ? Number(amt) / 100 : Number(amt));

// 1. Create the hosted checkout for one payment
async function createCheckout({ amount, orderId, description, redirectUrl, cancelUrl, customer }) {
  const c = CFG();
  const tr = await call('/order/payments/v3/', {
    body: {
      merchant_api_key: c.apiKey,
      intent: c.intent,
      mode: 'payment',
      entry_mode: 'raw',
      currency: 'PKR',
      amount: toGateway(amount),
      metadata: { order_id: orderId, source: 'raqbo', description: String(description || '').slice(0, 120) }
    }
  });
  const tracker = (tr && tr.data && ((tr.data.tracker && tr.data.tracker.token) || tr.data.token)) || null;
  if (!tracker) throw new Error('Safepay did not return a payment reference.');

  const pass = await call('/client/passport/v1/token', {});
  const tbt = (pass && (pass.data && (pass.data.token || pass.data))) || null;
  if (!tbt) throw new Error('Safepay did not return a checkout token.');

  const q = new URLSearchParams({
    environment: c.mode, tracker, tbt: String(tbt), source: 'hosted',
    order_id: orderId, redirect_url: redirectUrl, cancel_url: cancelUrl
  });
  if (customer) q.set('user_id', customer);
  return { tracker, url: `${c.checkout.replace(/\/$/, '')}/embedded/?${q.toString()}` };
}

// 2. Ask Safepay what really happened. Nothing else decides this.
async function lookup(tracker) {
  const r = await call(`/reporter/api/v1/payments/${encodeURIComponent(tracker)}`, { method: 'GET' });
  const d = (r && r.data) || {};
  const t = d.tracker || d;
  const state = String(t.state || d.state || '').toUpperCase();
  const paid = state === 'TRACKER_ENDED' || state === 'COMPLETED' || state === 'PAID';
  const failed = /FAIL|CANCEL|REJECT|EXPIRE|ERROR/.test(state);
  const act = d.action || {};
  const method = [act.payment_method || act.type || '', act.card_type || act.network || '', act.last_four ? '****' + act.last_four : ''].filter(Boolean).join(' ').trim();
  const amount = t.amount != null ? fromGateway(t.amount) : (d.purchase_totals && d.purchase_totals.amount != null ? fromGateway(d.purchase_totals.amount) : null);
  const orderId = (t.metadata && t.metadata.order_id) || (d.metadata && d.metadata.order_id) || '';
  return { paid, failed, state, method, amount, orderId, raw: d };
}

// 3. Webhook signature, when a webhook secret is set. The webhook only makes
//    RAQBO re-check with lookup(), so a signature that cannot be verified
//    never results in a wrong payment — it is an extra guard, not the gate.
function verifyWebhook(rawBody, signature) {
  const c = CFG();
  if (!c.webhookSecret) return { checked: false, valid: false };
  if (!signature) return { checked: true, valid: false };
  const sig = String(signature).trim().toLowerCase().replace(/^sha(256|512)=/, '');
  for (const alg of ['sha512', 'sha256']) {
    const mine = crypto.createHmac(alg, c.webhookSecret).update(rawBody).digest('hex');
    const b64 = crypto.createHmac(alg, c.webhookSecret).update(rawBody).digest('base64');
    if (safeEqual(sig, mine) || safeEqual(String(signature).trim(), b64)) return { checked: true, valid: true };
  }
  return { checked: true, valid: false };
}

// HMAC-SHA256 of the tracker, used on the redirect back in some Safepay versions
function verifyRedirect(tracker, signature) {
  const c = CFG();
  if (!c.secret || !signature) return { checked: false, valid: false };
  const mine = crypto.createHmac('sha256', c.secret).update(String(tracker)).digest('hex');
  return { checked: true, valid: safeEqual(String(signature).trim().toLowerCase(), mine) };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch { return false; }
}

// Pull the tracker out of a webhook body, whatever shape it arrives in
function trackerFromWebhook(body) {
  const b = body || {};
  const d = b.data || b;
  return d.tracker || (d.tracker && d.tracker.token) || (d.token && String(d.token).startsWith('track_') ? d.token : null)
    || (b.tracker && b.tracker.token) || (d.payment && d.payment.tracker) || null;
}

module.exports = { CFG, configured, createCheckout, lookup, verifyWebhook, verifyRedirect, trackerFromWebhook, toGateway, fromGateway };
