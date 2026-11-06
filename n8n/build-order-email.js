// RAQBO — turns a new email_outbox row (Supabase database webhook) into a branded order-status email.
// Change SECRET to the same value you put in the Supabase webhook header "x-raqbo-secret".
const SECRET = 'CHANGE-ME-raqbo-secret';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pkr = (n) => (n === null || n === undefined || n === '') ? 'To be confirmed' : 'PKR ' + Number(n).toLocaleString('en-US');
const METHODS = { bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', sadapay: 'SadaPay', nayapay: 'NayaPay' };
const STEPS = ['Order placed', 'Payment sent', 'Held in escrow', 'Dispatched', 'Delivered', 'Confirmed', 'Vendor paid'];
const STEP_OF = { order_placed: 0, quote_accepted: 0, payment_rejected: 0, payment_review: 1, paid_escrow: 2, dispatched: 3, delivered: 4, completed: 5, released: 6 };

// [subject, heading, message, button label, colour]  — {ref} {vendor} {buyer} {note} are filled in below
const T = {
  buyer: {
    order_placed:     ['Order {ref} placed — pay into RAQBO escrow', 'Your order is placed', 'Thank you! Your order with {vendor} is placed. Pay the total into the RAQBO escrow account and upload your payment screenshot on the order page. Your money is held safely until you confirm delivery.', 'Pay & upload screenshot', 'gold'],
    quote_requested:  ['Quote request {ref} sent to {vendor}', 'Your quote request was sent', '{vendor} will reply with prices. We will email you as soon as the quote arrives.', 'View request', 'info'],
    quoted:           ['Quote received for {ref}', 'Your quote is ready', '{vendor} has sent prices for your request. Review the quote and accept it to continue to escrow payment.', 'Review quote', 'gold'],
    quote_accepted:   ['Quote accepted — pay for {ref}', 'Quote accepted', 'You accepted the quote from {vendor}. Pay the total into the RAQBO escrow account and upload your payment screenshot.', 'Pay & upload screenshot', 'gold'],
    payment_review:   ['Payment received for {ref} — being verified', 'We are checking your payment', 'Thanks — we received your payment screenshot. The RAQBO team is verifying it, usually within a few hours. We will email you when it is confirmed.', 'View order', 'info'],
    payment_rejected: ['Action needed: payment for {ref} could not be verified', 'We could not verify your payment', 'The RAQBO team could not verify the payment for this order. Please check the reason below and upload a clear screenshot again.', 'Upload again', 'bad'],
    paid_escrow:      ['Payment confirmed for {ref} — held in escrow', 'Payment confirmed', 'Your payment is verified and held safely in RAQBO escrow. {vendor} has been told to dispatch your order.', 'Track order', 'ok'],
    dispatched:       ['Order {ref} is on the way', 'Your order is on the way', '{vendor} has dispatched your order. Inspect the materials when they arrive, then confirm delivery on the order page.', 'Track order', 'info'],
    delivered:        ['Order {ref} delivered — please confirm', 'Your order was delivered', '{vendor} marked your order as delivered. Please inspect it and confirm delivery — or open a dispute if something is wrong. The vendor is paid only after you confirm.', 'Confirm delivery', 'gold'],
    completed:        ['Thank you — order {ref} completed', 'Order completed', 'Thanks for confirming delivery. We will now release the payment to {vendor}. You can leave a review for the shop on the order page.', 'Leave a review', 'ok'],
    released:         ['Order {ref} closed — vendor paid', 'All done', 'The payment for this order was released to {vendor}. Thank you for ordering with RAQBO.', 'View order', 'ok'],
    disputed:         ['Dispute opened for {ref}', 'Your dispute is open', 'We received your dispute. Your money stays in escrow while the RAQBO team reviews it. We will contact you shortly.', 'View dispute', 'bad'],
    refunded:         ['Refund for order {ref}', 'Your refund is on the way', 'The dispute was resolved in your favour and your payment is being refunded.', 'View order', 'muted'],
    cancelled:        ['Order {ref} cancelled', 'Order cancelled', 'This order has been cancelled.', 'View order', 'muted'],
    declined:         ['{vendor} declined order {ref}', 'Your order was declined', '{vendor} could not take this order. No payment is due. You can order the same materials from another vendor.', 'Browse vendors', 'muted']
  },
  vendor: {
    order_placed:     ['New order {ref} from {buyer}', 'You have a new order', '{buyer} placed an order. RAQBO will email you once the buyer’s payment is verified in escrow — do not dispatch before that.', 'Open order', 'gold'],
    quote_requested:  ['New quote request {ref} from {buyer}', 'New quote request', '{buyer} is asking for your prices. Send a quote from your shop dashboard.', 'Send quote', 'gold'],
    quote_accepted:   ['Quote accepted for {ref}', 'Your quote was accepted', '{buyer} accepted your quote and is now paying into RAQBO escrow. Wait for the payment-verified email before dispatching.', 'Open order', 'info'],
    paid_escrow:      ['Payment secured — dispatch order {ref}', 'Payment is in escrow — dispatch now', 'The buyer’s payment is verified and held in RAQBO escrow. Please dispatch the order and add the vehicle and ETA.', 'Dispatch order', 'ok'],
    completed:        ['Order {ref} confirmed by buyer — payout pending', 'Delivery confirmed', '{buyer} confirmed delivery. RAQBO will release your payout shortly.', 'Open order', 'ok'],
    released:         ['Payout released for {ref}', 'Your payout was released', 'RAQBO has released the payment for this order to you.', 'Open order', 'ok'],
    disputed:         ['Dispute opened on order {ref}', 'The buyer opened a dispute', 'The payment stays in escrow while the RAQBO team reviews the dispute. We may contact you for details.', 'Open order', 'bad'],
    refunded:         ['Order {ref} refunded to buyer', 'Dispute resolved — buyer refunded', 'After review, the payment for this order was refunded to the buyer.', 'Open order', 'muted'],
    cancelled:        ['Order {ref} cancelled by buyer', 'Order cancelled', '{buyer} cancelled this order. No action is needed.', 'Open order', 'muted']
  },
  admin: {
    payment_review:   ['Verify payment screenshot — {ref}', 'Payment screenshot to verify', '{buyer} uploaded a payment screenshot for an order with {vendor}. Check it against the escrow account, then approve or reject it.', 'Verify payment', 'gold'],
    disputed:         ['Dispute opened — {ref}', 'A buyer opened a dispute', 'Review the dispute between {buyer} and {vendor} and resolve it (release or refund).', 'Open disputes', 'bad'],
    completed:        ['Release payout — {ref}', 'Payout to release', '{buyer} confirmed delivery from {vendor}. Pay the vendor and mark the payout as released.', 'Open payments', 'ok']
  }
};
const COLOUR = { gold: '#e6ac42', ok: '#2e9e6a', info: '#4a7bd0', bad: '#d0503f', muted: '#8a857a' };

function steps(r) {
  const at = STEP_OF[r.event]; if (at === undefined || r.mode === 'quote' && r.event === 'quote_requested') return '';
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0 4px"><tr>${STEPS.map((s, i) => {
    const done = i <= at; return `<td style="text-align:center;font-size:10px;color:${done ? '#16140f' : '#a39d90'};padding:0 2px;vertical-align:top"><div style="height:6px;border-radius:3px;background:${done ? '#e6ac42' : '#ece6da'};margin-bottom:5px"></div>${esc(s)}</td>`;
  }).join('')}</tr></table>`;
}
function rows(pairs) {
  return pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#7b7568;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#16140f">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('');
}

const out = [];
for (const item of $input.all()) {
  const headers = item.json.headers || {};
  if (headers['x-raqbo-secret'] !== SECRET) continue;               // ignore calls without the right secret
  const { type, table, record: r = {} } = item.json.body || {};
  if (table !== 'email_outbox' || type !== 'INSERT' || !r.to_email) continue;
  const t = (T[r.audience] || {})[r.event]; if (!t) continue;
  const fill = (s) => s.replace(/\{ref\}/g, r.order_ref).replace(/\{vendor\}/g, r.vendor_name || 'the vendor').replace(/\{buyer\}/g, r.buyer_name || 'The buyer');
  const [subject, heading, message, button, colour] = [fill(t[0]), fill(t[1]), fill(t[2]), t[3], COLOUR[t[4]] || COLOUR.gold];
  const d = r.dispatch_info || {};
  const pairs = [['Order', r.order_ref], ['Shop', r.vendor_name], ['Buyer', r.audience === 'buyer' ? '' : r.buyer_name], ['Items', r.items_summary], ['Total', r.mode === 'quote' && (r.total === null || r.total === undefined) ? 'Awaiting quote' : pkr(r.total)],
    ['Paid with', METHODS[r.payment_method] || ''], ['Vehicle', r.event === 'dispatched' ? d.vehicle : ''], ['Driver', r.event === 'dispatched' ? [d.driver, d.phone].filter(Boolean).join(' · ') : ''], ['ETA', r.event === 'dispatched' ? d.eta : ''],
    ['Update', r.note]];
  const greet = r.audience === 'admin' ? 'Hello RAQBO team,' : `Hello ${esc((r.to_name || '').split(/\s+/)[0] || 'there')},`;
  const html = `<div style="background:#f5f2ec;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:580px;margin:0 auto">
    <div style="background:#0b0b0c;padding:16px 22px;border-radius:12px 12px 0 0"><span style="color:#f6d27c;font-weight:700;letter-spacing:.18em;font-size:15px">RAQBO</span><span style="color:#8d8676;font-size:12px;letter-spacing:.08em"> &nbsp;·&nbsp; ${r.audience === 'admin' ? 'ADMIN ALERT' : r.audience === 'vendor' ? 'SELL WITH US' : 'ORDER UPDATE'}</span></div>
    <div style="background:#fff;border:1px solid #ece6da;border-top:4px solid ${colour};padding:24px 22px;border-radius:0 0 12px 12px">
      <p style="margin:0 0 6px;color:#7b7568;font-size:14px">${greet}</p>
      <h1 style="margin:0 0 10px;color:#121212;font-size:21px">${esc(heading)}</h1>
      <p style="margin:0 0 6px;color:#3d382f;font-size:15px;line-height:1.55">${esc(message)}</p>
      ${r.audience === 'admin' ? '' : steps(r)}
      <table style="border-collapse:collapse;font-size:14px;margin-top:14px;width:100%">${rows(pairs)}</table>
      <p style="margin:22px 0 4px"><a href="${esc(r.audience === 'admin' ? String(r.order_url).replace(/#marketplace\/order\/.*$/, '#admin') : r.order_url)}" style="display:inline-block;background:${colour === COLOUR.muted ? '#16140f' : '#e6ac42'};color:${colour === COLOUR.muted ? '#f6d27c' : '#16120a'};padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">${esc(button)}</a></p>
      <p style="margin:18px 0 0;color:#8a857a;font-size:12px;line-height:1.5">${r.audience === 'buyer' ? 'Your money is protected by RAQBO escrow — the vendor is paid only after you confirm delivery. ' : ''}Questions? Reply to this email or message us on WhatsApp.</p>
    </div>
    <p style="text-align:center;color:#a39d90;font-size:11px;margin:14px 0 0">RAQBO · 3rd Floor, Alwahab Trade Centre, Wapda Town Chowk, PIA Road, Lahore</p>
  </div></div>`;
  const text = `${heading}\n\n${message}\n\nOrder: ${r.order_ref}\n${r.note ? 'Update: ' + r.note + '\n' : ''}\n${button}: ${r.order_url}`;
  out.push({ json: { to: r.to_email, subject, html, text, audience: r.audience, event: r.event, outbox_id: r.id } });
}
return out;
