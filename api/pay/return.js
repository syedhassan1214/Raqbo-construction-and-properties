// RAQBO — the customer comes back from Safepay.  GET/POST /api/pay/return
// The browser is never believed. RAQBO asks Safepay directly what happened,
// then sends the customer back to the website with the result.
const { asService, readBody } = require('../_sb');
const { origin, esc } = require('../_shared');
const sfpy = require('../_safepay');

const back = (res, site, ref, state) => { res.statusCode = 302; res.setHeader('Cache-Control', 'no-store'); res.setHeader('Location', `${site}/#payment/${encodeURIComponent(ref || '')}/${state}`); res.end(''); };

module.exports = async (req, res) => {
  const site = origin(req); const q = req.query || {};
  let body = {}; if (req.method === 'POST') { const b = await readBody(req); body = b.json || {}; if (!b.json && b.raw) { try { body = Object.fromEntries(new URLSearchParams(b.raw)); } catch { body = {}; } } }
  const ref = String(q.ref || body.order_id || body.orderId || '').slice(0, 60);
  const tracker = String(q.tracker || body.tracker || body.Tracker || '').slice(0, 120);
  const cancelled = String(q.cancelled || '') === '1';

  if (cancelled && !tracker) return back(res, site, ref, 'cancelled');
  if (!tracker && !ref) return back(res, site, '', 'unknown');

  try {
    if (!tracker) return back(res, site, ref, 'pending');
    const r = await sfpy.lookup(tracker);
    const out = await asService('pay_settle', {
      p_ref: ref || (r.orderId || ''), p_tracker: tracker, p_paid: !!r.paid,
      p_state: r.state, p_method: r.method, p_data: { state: r.state, amount: r.amount, order_id: r.orderId },
      p_reason: r.paid ? '' : (cancelled ? 'The payment was cancelled.' : 'The payment was not completed.')
    });
    const status = (out && out.status) || (r.paid ? 'paid' : 'failed');
    return back(res, site, ref || r.orderId, status === 'paid' ? 'paid' : cancelled ? 'cancelled' : 'failed');
  } catch (err) {
    // Safepay could not be reached: never guess. Leave the payment alone and
    // tell the member it is being checked.
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    return res.end(`<!doctype html><meta charset="utf-8"><title>Checking your payment — RAQBO</title><meta http-equiv="refresh" content="6;url=${esc(site)}/#payment/${encodeURIComponent(ref)}/pending">
      <body style="font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#111">
      <h1 style="font-size:22px">We are checking your payment</h1>
      <p>Your payment reference is <b>${esc(ref || tracker)}</b>. RAQBO could not reach the payment service just now, so nothing has been changed.</p>
      <p>Open <b>My RAQBO → Payments</b> in a few minutes to see the result, or contact RAQBO on WhatsApp with this reference. No money is taken twice.</p>
      <p><a href="${esc(site)}/#my/payments" style="color:#b67d1c;font-weight:700">Go to My RAQBO → Payments</a></p></body>`);
  }
};
