// RAQBO — Safepay webhook.  POST /api/pay/webhook
// Safepay tells us something happened. We do not believe the message: we take
// only the tracker from it and ask Safepay directly. So even a faked webhook
// cannot mark a payment paid.
const { asService, readBody, json } = require('../_sb');
const sfpy = require('../_safepay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  const { json: body, raw } = await readBody(req);
  const sig = req.headers['x-sfpy-signature'] || req.headers['X-SFPY-SIGNATURE'] || req.headers['x-safepay-signature'] || '';
  const check = sfpy.verifyWebhook(raw || '', sig);
  // A webhook secret is optional. When one is set and the signature is wrong,
  // we stop here. When none is set we carry on, because the tracker is checked
  // with Safepay anyway before anything is marked paid.
  if (check.checked && !check.valid) return json(res, 400, { error: 'Signature did not match.' });

  const tracker = sfpy.trackerFromWebhook(body);
  if (!tracker) return json(res, 200, { ok: true, ignored: 'no tracker in this event' });

  try {
    const r = await sfpy.lookup(tracker);
    if (!r.paid && !r.failed) return json(res, 200, { ok: true, waiting: r.state });
    const out = await asService('pay_settle', {
      p_ref: r.orderId || '', p_tracker: tracker, p_paid: !!r.paid, p_state: r.state, p_method: r.method,
      p_data: { state: r.state, amount: r.amount, order_id: r.orderId, via: 'webhook' },
      p_reason: r.paid ? '' : 'The payment was not completed.'
    });
    return json(res, 200, { ok: true, ref: out && out.ref, status: out && out.status });
  } catch (err) {
    // Tell Safepay it failed so the webhook is retried later.
    return json(res, 500, { error: String(err.message || 'Could not confirm this payment.').slice(0, 200) });
  }
};
