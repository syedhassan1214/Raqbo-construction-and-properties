// RAQBO — WhatsApp order updates (WhatsApp Business Cloud API by Meta).
// Fill these in after setting up WhatsApp in Meta Business (see the setup guide). Leave WA_TOKEN empty to switch WhatsApp off.
const SECRET = 'CHANGE-ME-raqbo-secret';          // same secret as the Supabase webhook header
const WA_PHONE_ID = '';                            // Meta → WhatsApp → API Setup → "Phone number ID"
const WA_TOKEN = '';                               // permanent access token (System User token)
const WA_TEMPLATE = 'raqbo_order_update';          // approved template name (4 variables, see guide)
const WA_LANG = 'en';

const HEAD = {
  buyer: { order_placed: 'Order placed - please pay into RAQBO escrow and upload your screenshot', quote_requested: 'Quote request sent', quoted: 'Your quote is ready', quote_accepted: 'Quote accepted - please pay into RAQBO escrow',
    payment_review: 'Payment received - RAQBO is verifying it', payment_rejected: 'Payment could not be verified - please upload again', paid_escrow: 'Payment confirmed and held in RAQBO escrow',
    dispatched: 'Your order is on the way', delivered: 'Delivered - please confirm receipt', completed: 'Order completed - thank you', released: 'Order closed - vendor paid', disputed: 'Dispute opened - payment stays in escrow',
    refunded: 'Refund issued', cancelled: 'Order cancelled', declined: 'The vendor declined your order' },
  vendor: { order_placed: 'New order received', quote_requested: 'New quote request', quote_accepted: 'Your quote was accepted', paid_escrow: 'Payment secured - please dispatch now', completed: 'Buyer confirmed delivery - payout pending',
    released: 'Payout released', disputed: 'Buyer opened a dispute', refunded: 'Order refunded to buyer', cancelled: 'Buyer cancelled the order' }
};
const out = [];
if (WA_TOKEN && WA_PHONE_ID) for (const item of $input.all()) {
  const headers = item.json.headers || {}; if (headers['x-raqbo-secret'] !== SECRET) continue;
  const { type, table, record: r = {} } = item.json.body || {};
  if (table !== 'email_outbox' || type !== 'INSERT' || !/^92\d{10}$/.test(r.to_phone || '')) continue;
  const head = (HEAD[r.audience] || {})[r.event]; if (!head) continue;
  const name = String(r.to_name || 'there').split(/\s+/)[0].slice(0, 30);
  out.push({ json: { url: `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, token: WA_TOKEN, to: r.to_phone, event: r.event,
    body: { messaging_product: 'whatsapp', to: r.to_phone, type: 'template', template: { name: WA_TEMPLATE, language: { code: WA_LANG },
      components: [{ type: 'body', parameters: [name, r.order_ref, head, r.order_url].map((t) => ({ type: 'text', text: String(t || '').slice(0, 200) })) }] } } } });
}
return out;
