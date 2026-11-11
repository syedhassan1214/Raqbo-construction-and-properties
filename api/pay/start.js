// RAQBO — start an online payment.  POST /api/pay/start
// Body: { purpose, subject }  — never an amount. The database works out what
// is owed from the thing being paid for, so a visitor cannot change the price.
const { asUser, asService, bearer, readBody, json } = require('../_sb');
const { origin } = require('../_shared');
const sfpy = require('../_safepay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  const token = bearer(req);
  if (!token) return json(res, 401, { error: 'Please sign in first.' });

  const { json: body } = await readBody(req);
  const purpose = String((body && body.purpose) || '').slice(0, 40);
  const subject = String((body && body.subject) || '').slice(0, 120);
  if (!purpose) return json(res, 400, { error: 'Nothing to pay for.' });

  let p;
  try {
    // Runs as the member: their own sign-in, their own permissions.
    p = await asUser('pay_start', { p_purpose: purpose, p_subject: subject }, token);
  } catch (err) {
    return json(res, err.status === 401 ? 401 : 400, { error: err.message || 'This payment could not be started.' });
  }
  if (!p || !p.ref) return json(res, 400, { error: 'This payment could not be started.' });

  if (!sfpy.configured()) {
    return json(res, 503, { error: 'Online payment is not connected yet. Please pay by bank transfer.', ref: p.ref, amount: p.amount, setup: true });
  }

  const site = origin(req);
  try {
    const { tracker, url } = await sfpy.createCheckout({
      amount: p.amount,
      orderId: p.ref,
      description: p.description,
      redirectUrl: `${site}/api/pay/return?ref=${encodeURIComponent(p.ref)}`,
      cancelUrl: `${site}/api/pay/return?ref=${encodeURIComponent(p.ref)}&cancelled=1`
    });
    await asService('pay_set_tracker', { p_ref: p.ref, p_tracker: tracker });
    return json(res, 200, { ref: p.ref, amount: p.amount, description: p.description, url, mode: sfpy.CFG().mode });
  } catch (err) {
    return json(res, 502, { error: 'The payment page could not be opened. Please try again, or pay by bank transfer.', detail: String(err.message || '').slice(0, 200), ref: p.ref });
  }
};
