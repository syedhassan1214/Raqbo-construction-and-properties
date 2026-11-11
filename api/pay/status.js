// RAQBO — re-check one payment with Safepay.  GET /api/pay/status?ref=RQ-PAY-…
// Used by the website when a member comes back and by admin "Check again".
// Reads the payment as the signed-in member, then asks Safepay.
const { asUser, asService, bearer, json } = require('../_sb');
const { SB_URL, SB_KEY } = require('../_config');
const sfpy = require('../_safepay');

module.exports = async (req, res) => {
  const token = bearer(req);
  if (!token) return json(res, 401, { error: 'Please sign in first.' });
  const ref = String((req.query || {}).ref || '').slice(0, 60);
  if (!/^RQ-PAY-[A-Z0-9]+$/.test(ref)) return json(res, 400, { error: 'Unknown payment reference.' });

  // The member can only read their own payment (row-level security decides).
  let row = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/payments?select=ref,status,amount,description,tracker,applied_note,paid_at,fail_reason&ref=eq.${encodeURIComponent(ref)}`,
      { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token } });
    const rows = await r.json(); row = Array.isArray(rows) ? rows[0] : null;
  } catch { row = null; }
  if (!row) return json(res, 404, { error: 'Payment not found.' });

  if (row.status === 'paid' || row.status === 'refunded' || !row.tracker || !sfpy.configured()) return json(res, 200, row);

  try {
    const r = await sfpy.lookup(row.tracker);
    if (r.paid || r.failed) {
      const out = await asService('pay_settle', {
        p_ref: row.ref, p_tracker: row.tracker, p_paid: !!r.paid, p_state: r.state, p_method: r.method,
        p_data: { state: r.state, amount: r.amount, via: 'status' }, p_reason: r.paid ? '' : 'The payment was not completed.'
      });
      return json(res, 200, { ...row, status: (out && out.status) || row.status, applied_note: (out && out.note) || row.applied_note, checked: true });
    }
    return json(res, 200, { ...row, gateway_state: r.state, checked: true });
  } catch (err) {
    return json(res, 200, { ...row, checked: false, detail: String(err.message || '').slice(0, 160) });
  }
};
