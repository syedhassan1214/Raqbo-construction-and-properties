  /* =====================================================================
     RAQBO — countering, declining and revising an offer
     The offer flow itself lives in the QuickSell module: the backend, the
     box on each listing, the dashboard and the offer chat are all there.
     What was left was the asking: a counter-offer, a decline and a revised
     offer each went through the browser's own prompt() box, which has no
     label, no currency, no warning about contact details and looks nothing
     like RAQBO. This replaces those three with a proper form and leaves
     everything else exactly as it is.
     ===================================================================== */
  const OFR_LOCK = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>`;
  const ofrMoney = (n) => { try { return rs(Math.round(Number(n) || 0)); } catch { return 'PKR ' + Math.round(Number(n) || 0).toLocaleString('en-US'); } };

  const OFR_FORMS = {
    counter: ['Counter-offer', 'ASK FOR MORE', 'Your counter-offer (PKR)', 'Message to the buyer (optional)', 'Send counter-offer'],
    reject: ['Decline this offer', 'LET THE BUYER KNOW', '', 'Reason (optional, shown to the buyer)', 'Decline the offer'],
    revise: ['Revise your offer', 'PUT MORE ON THE TABLE', 'Your revised offer (PKR)', '', 'Send revised offer']
  };

  // Runs in the capture phase, so it answers before the prompt-based handler
  // in the QuickSell module ever sees the click.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dl]');
    if (!b || !OFR_FORMS[b.dataset.dl]) return;
    e.preventDefault();
    e.stopPropagation();
    const a = b.dataset.dl;
    const [title, eyebrow, amountLabel, noteLabel, submit] = OFR_FORMS[a];
    const card = openModal(`<div class="eyebrow"><span></span> ${esc(eyebrow)}</div>
      <h2>${esc(title)}</h2>
      ${amountLabel ? `<p class="modal-lead">${a === 'counter' ? 'A counter-offer has to be higher than the buyer’s offer of' : 'Your last offer was'} <b>${esc(ofrMoney(b.dataset.amount))}</b>.</p>` : ''}
      <form class="modal-form" data-ofr-resp="${esc(a)}" data-id="${esc(b.dataset.id)}" novalidate>
        ${amountLabel ? `<label>${esc(amountLabel)}<input name="amount" inputmode="numeric" autocomplete="off" value="${esc(b.dataset.amount || '')}"></label>` : ''}
        ${noteLabel ? `<label>${esc(noteLabel)}<textarea name="note" rows="3" maxlength="600"></textarea></label>` : ''}
        <p class="form-hint">${OFR_LOCK} Keep phone numbers, CNICs and links out — RAQBO keeps the deal on the platform.</p>
        <button type="submit" class="button button-primary modal-submit">${esc(submit)}</button>
      </form>`, { label: title });
    hydrate(card);
  }, true);

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-ofr-resp]');
    if (!f) return;
    e.preventDefault();
    const a = f.dataset.ofrResp;
    const amount = f.amount ? Math.round(Number(String(f.amount.value).replace(/[^\d]/g, ''))) : null;
    if (f.amount && !amount) { toast('Enter the amount in rupees.'); f.amount.focus(); return; }
    const note = f.note ? String(f.note.value || '').trim() : '';
    const btn = $('.modal-submit', f);
    const done = busy(btn, 'Saving…');
    try {
      if (a === 'revise') await DL.buyerAction(f.dataset.id, 'revise', amount);
      else await DL.respond(f.dataset.id, a, amount, note);
      closeModal();
      toast(a === 'reject' ? 'Declined — the buyer has been told.' : 'Sent — the other side has been told.');
      renderMy();
    } catch (err) { done(); toast(err.message); }
  });
