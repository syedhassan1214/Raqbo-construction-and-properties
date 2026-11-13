  /* =====================================================================
     RAQBO — the auction completion file  (#deal/<auction id>)
     Winning a bid used to be where RAQBO stopped. This is the screen that
     carries the deal the rest of the way: five steps from documents to
     transfer, the money worked out to the rupee, the papers RAQBO still
     needs, and a room where the winner and the owner talk — with RAQBO
     holding the pen. Nothing is marked done by a member: RAQBO ticks each
     step, and the sale cannot be confirmed until all five are ticked.
     ===================================================================== */
  const AC = { id: null, d: null, a: null, busy: false, form: null };
  const acIc = (d, s = 16) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const AC_IC = {
    tick: acIc('<path d="M5 12.5l4.5 4.5L19 7"></path>', 13),
    doc: acIc('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path>', 16),
    cash: acIc('<rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.6"></circle>', 16),
    pen: acIc('<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>', 16),
    key: acIc('<circle cx="8" cy="15" r="4"></circle><path d="M10.8 12.2L20 3l1 3-2 1 .5 2.5L17 11l-2-.5-1.2 1.2"></path>', 16),
    star: acIc('<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z"></path>', 16),
    chat: acIc('<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"></path>', 15),
    lock: acIc('<rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>', 14),
    warn: acIc('<path d="M12 4l9 16H3z"></path><path d="M12 10v4M12 17h.01"></path>', 15)
  };

  const AC_STEPS = [
    ['documents', 'Documents', 'RAQBO collects and checks the property papers', 'doc'],
    ['payment', 'Payment', 'The winning amount and the buyer’s premium are received', 'cash'],
    ['agreement', 'Agreement', 'The sale agreement is signed by both sides', 'pen'],
    ['transfer', 'Transfer', 'Registry, sale deed or society transfer is completed', 'key']
  ];
  const AC_PAY_ST = { submitted: 'Being checked by RAQBO', received: 'Received', rejected: 'Not matched' };
  const acSetup = 'The completion file is being set up. (Admin: run update_36_auction_completion.sql in Supabase.)';
  const acMoney = (n) => { try { return rs(Math.round(Number(n) || 0)); } catch { return 'PKR ' + Math.round(Number(n) || 0).toLocaleString('en-US'); } };
  const acfWhen = (t) => { try { return new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };

  /* ---------- the money, worked out ---------- */
  function acInvoice(a) {
    const bid = Math.round(Number(a.high_amount) || 0);
    const premium = Math.round(bid * (Number(a.buyer_premium_pct) || 0) / 100);
    const commission = Math.round(bid * (Number(a.seller_commission_pct) || 0) / 100);
    const deposit = Math.round(Number(a.deposit) || 0);
    return { bid, premium, commission, deposit, buyerTotal: bid + premium, buyerDue: Math.max(0, bid + premium - deposit), sellerGets: bid - commission };
  }

  /* ---------- demo-mode store ---------- */
  const acLocal = {
    get(id) { const d = store.get('auc.close', {})[id]; return { docs: {}, steps: {}, payments: [], ...(d || {}) }; },
    put(id, rec) { const all = store.get('auc.close', {}); all[id] = rec; store.set('auc.close', all); },
    step(id, key, done, note) {
      if (!db.isAdmin) throw new Error('Only RAQBO can tick a step.');
      const rec = this.get(id);
      rec.steps[key] = done ? { done: true, at: new Date().toISOString(), note: note || '' } : null;
      this.put(id, rec);
    },
    docs(id, docs) { const rec = this.get(id); rec.docs = docs; this.put(id, rec); },
    pay(id, amount, ref, who) {
      const rec = this.get(id);
      rec.payments.push({ id: 'p' + Date.now().toString(36), amount, ref: String(ref || '').trim(), by: who, status: 'submitted', at: new Date().toISOString(), note: '' });
      this.put(id, rec);
      try { lvLocal.notifyAdmins('system', 'Auction payment sent', acMoney(amount) + ' · ' + ref, '#deal/' + id); } catch { /* ignore */ }
    },
    payDecide(id, pid, status, note) {
      if (!db.isAdmin) throw new Error('Only RAQBO can confirm a payment.');
      const rec = this.get(id); const p = rec.payments.find((x) => x.id === pid);
      if (!p) throw new Error('Payment not found.');
      p.status = status; p.note = note || ''; this.put(id, rec);
      try { if (p.by) lvLocal.notify(p.by, 'system', status === 'received' ? 'Payment received' : 'Payment not matched', acMoney(p.amount) + (note ? ' · ' + note : ''), '#deal/' + id); } catch { /* ignore */ }
    }
  };

  const acRpc = async (fn, args) => {
    const { data, error } = await SB.rpc(fn, args || {});
    if (error) throw new Error(/does not exist|schema cache|could not find the function|relation/i.test(error.message || '') ? acSetup : (error.message || 'Something went wrong.'));
    return data;
  };
  const acApi = {
    get: (id) => (SB ? acRpc('auction_completion', { p_auction: id }) : acLocal.get(id)),
    step: (id, k, done, note) => (SB ? acRpc('auction_completion_step', { p_auction: id, p_step: k, p_done: done, p_note: note || '' }) : acLocal.step(id, k, done, note)),
    docs: (id, docs) => (SB ? acRpc('auction_completion_docs', { p_auction: id, p_docs: docs }) : acLocal.docs(id, docs)),
    pay: (id, amount, ref) => (SB ? acRpc('auction_completion_payment', { p_auction: id, p_amount: amount, p_ref: ref }) : acLocal.pay(id, amount, ref, db.session && db.session.userId)),
    payDecide: (id, pid, st, note) => (SB ? acRpc('auction_completion_payment_decide', { p_payment: pid, p_status: st, p_note: note || '' }) : acLocal.payDecide(id, pid, st, note))
  };

  /* ---------- who is looking ---------- */
  // Someone can be both: in demo mode every signed-in member has the admin
  // panel, and a RAQBO member may be selling a property too. So the party to
  // the deal keeps their own view, and the RAQBO panel is added on top.
  const acRole = (a) => (a.is_seller ? 'seller' : (a.me && a.me.leading) ? 'winner' : db.isAdmin ? 'admin' : 'none');
  const acIsStaff = () => !!db.isAdmin;
  const acStepDone = (d, k) => !!(d.steps && d.steps[k] && d.steps[k].done);
  const acStage = (a, d) => {
    if (a.phase === 'sold') return 4;
    let n = 0;
    for (const [k] of AC_STEPS) { if (acStepDone(d, k)) n++; else break; }
    return n;
  };

  /* ---------- the screen ---------- */
  async function acOpen(id) {
    closeNavMenus();
    try { if (pf.my.open) closeMy(); } catch { /* ignore */ }
    try { if (admin.el && !admin.el.hidden) closeAdmin(); } catch { /* ignore */ }
    const card = openModal('<div class="ac-page"><div class="my-loading">Loading the completion file…</div></div>', { wide: true, label: 'Auction completion', onClose: () => { AC.id = null; AC.form = null; } });
    card.classList.add('gw-card', 'ac-modal');
    AC.id = id; AC.form = null;
    await acRefresh();
  }

  // redraw from what we already hold — used when an inline form opens or closes
  function acfPaint() {
    const host = $('.ac-page');
    if (!host || !AC.a) return;
    host.innerHTML = acHTML(AC.a, AC.d);
    hydrate(host);
    const t = $('.ac-form textarea, .ac-form input', host);
    if (t) t.focus({ preventScroll: true });
  }

  async function acRefresh() {
    const id = AC.id; const host = $('.ac-page'); if (!id || !host) return;
    try {
      const [a, d] = await Promise.all([AU.state(id), acApi.get(id)]);
      if (!a) { host.innerHTML = '<div class="admin-empty">This auction is no longer available.</div>'; return; }
      AC.a = a; AC.d = d || { docs: {}, steps: {}, payments: [] };
      host.innerHTML = acHTML(AC.a, AC.d);
      hydrate(host);
    } catch (err) {
      host.innerHTML = `<div class="admin-empty">${esc(err.message)}</div>`;
    }
  }

  function acHTML(a, d) {
    const role = acRole(a);
    if (role === 'none') return '<div class="admin-empty">This completion file is open to the owner, the winning bidder and RAQBO only.</div>';
    if (!['provisional', 'sold', 'failed'].includes(a.phase)) {
      return `<div class="ac-head"><div class="eyebrow"><span></span> AUCTION COMPLETION</div><h2>${esc(a.title || 'Property')}</h2></div>
        <div class="admin-empty">This auction has not finished yet. The completion file opens once a bid wins.${['live', 'closing', 'upcoming'].includes(a.phase) ? ' <button type="button" class="link-button" data-ax-open="' + esc(a.id) + '">Open the auction room</button>' : ''}</div>`;
    }
    const inv = acInvoice(a);
    const at = acStage(a, d);
    const sold = a.phase === 'sold';
    const failed = a.phase === 'failed';

    return `<div class="ac-head">
        <div class="eyebrow"><span></span> AUCTION COMPLETION · ${esc(a.ref || '')}</div>
        <h2>${esc(a.title || 'Property')}</h2>
        <p class="ac-sub">${esc([a.area, a.city].filter(Boolean).join(', '))}${a.listing_ref ? ' · ' + esc(a.listing_ref) : ''} · winning bid <b>${esc(acMoney(inv.bid))}</b>${a.leader_no ? ' by Bidder ' + esc(a.leader_no) : ''}</p>
        <div class="ac-role">${role === 'seller' ? 'You are the owner' : role === 'winner' ? 'You are the winning bidder' : 'You are looking as RAQBO'}${role !== 'admin' && acIsStaff() ? ' · RAQBO controls below' : ''}</div>
      </div>

      ${failed ? `<div class="ac-banner bad">${AC_IC.warn}<div><b>This sale was not completed</b><p>${esc(a.result_note || 'The winning bidder did not complete.')}</p></div></div>`
        : sold ? `<div class="ac-banner good">${AC_IC.star}<div><b>Sale completed</b><p>${esc(a.result_note || 'RAQBO has confirmed this sale.')}</p></div></div>`
        : `<div class="ac-banner">${AC_IC.lock}<div><b>Provisional — not yet a transfer of ownership</b><p>The highest bid won, but ownership passes only after the papers, the payment, the signed agreement and the legal transfer are all done. RAQBO ticks each step below.</p></div></div>`}

      ${acTrackHTML(a, d, at, sold, failed)}
      ${acMoneyHTML(a, d, inv, role)}
      ${acDocsHTML(a, d, role)}
      ${acTalkHTML(a, role)}
      ${acIsStaff() ? acAdminHTML(a, d, at) : ''}
      <p class="ac-legal">${AC_IC.lock}<span>RAQBO is a property platform, not a government body, and does not guarantee title. Every step on this file is recorded with the time and, for RAQBO's own actions, the reason. Keep phone numbers, CNICs and links out of the deal room — the deal stays on RAQBO until it is done.</span></p>`;
  }

  /* ---------- the five steps ---------- */
  function acTrackHTML(a, d, at, sold, failed) {
    const dots = [...AC_STEPS.map(([k, t, hint, ic]) => ({ k, t, hint, ic })), { k: 'done', t: 'Complete', hint: 'RAQBO confirms the sale and the file closes', ic: 'star' }];
    return `<section class="ac-sec"><h3>Where this deal stands</h3>
      <ol class="ac-track${failed ? ' bad' : ''}">${dots.map((s, n) => {
      const done = sold ? true : n < at;
      const now = !sold && !failed && n === at;
      const rec = d.steps && d.steps[s.k];
      return `<li class="${done ? 'done' : now ? 'now' : ''}">
          <span class="ac-dot">${done ? AC_IC.tick : AC_IC[s.ic] || n + 1}</span>
          <div><b>${esc(s.t)}</b><small>${esc(s.hint)}</small>
          ${done && rec && rec.at ? `<em>Done ${esc(acfWhen(rec.at))}${rec.note ? ' · ' + esc(rec.note) : ''}</em>` : now ? '<em class="ac-wait">Happening now</em>' : ''}</div>
        </li>`;
    }).join('')}</ol>
      ${!sold && !failed ? `<p class="ac-nextline"><span>Next</span>${esc(acNext(a, at))}</p>` : ''}</section>`;
  }
  const acNext = (a, at) => [
    'RAQBO is collecting the property papers from the owner. Nothing to do yet.',
    'The winning bidder pays the balance and the buyer’s premium to RAQBO’s account, then records the bank reference below.',
    'RAQBO prepares the sale agreement for both sides to sign.',
    'The registry, sale deed or society transfer is carried out. RAQBO will tell you where and when.',
    'RAQBO is confirming the last details.'
  ][Math.min(at, 4)];

  /* ---------- the money ---------- */
  function acMoneyHTML(a, d, inv, role) {
    const pays = (d.payments || []);
    const got = pays.filter((p) => p.status === 'received').reduce((s, p) => s + Number(p.amount || 0), 0);
    const left = Math.max(0, inv.buyerDue - got);
    const rows = role === 'seller'
      ? [['Winning bid', inv.bid, ''], [`RAQBO commission (${a.seller_commission_pct || 0}%)`, -inv.commission, ''], ['You receive', inv.sellerGets, 'tot']]
      : role === 'winner'
        ? [['Winning bid', inv.bid, ''], [`Buyer’s premium (${a.buyer_premium_pct || 0}%)`, inv.premium, ''], ['Total', inv.buyerTotal, 'sub'], ['Deposit already paid', -inv.deposit, ''], ['Balance to RAQBO', inv.buyerDue, 'tot']]
        : [['Winning bid', inv.bid, ''], [`Buyer’s premium (${a.buyer_premium_pct || 0}%)`, inv.premium, ''], ['Buyer pays in total', inv.buyerTotal, 'sub'], ['Deposit already held', -inv.deposit, ''], ['Balance due from the buyer', inv.buyerDue, 'tot'], [`Owner’s commission (${a.seller_commission_pct || 0}%)`, -inv.commission, ''], ['Owner receives', inv.sellerGets, 'tot']];
    return `<section class="ac-sec"><h3>The money</h3>
      <div class="ac-inv">${rows.map(([t, n, k]) => `<div class="ac-inv-row ${k}"><span>${esc(t)}</span><b>${n < 0 ? '− ' : ''}${esc(acMoney(Math.abs(n)))}</b></div>`).join('')}
        <div class="ac-inv-row ${left ? 'open' : 'paid'}"><span>${role === 'winner' ? (left ? 'Still to pay' : 'Fully paid') : left ? 'Buyer still to pay' : 'Buyer has paid in full'}</span><b>${esc(acMoney(left))}</b></div>
      </div>
      ${role === 'winner' ? '<p class="ac-mini">RAQBO never asks for a payment through chat, a link or a personal account. Pay only into the RAQBO account shown on your invoice, and record the bank reference here.</p>' : ''}
      ${pays.length ? `<div class="ac-pays">${pays.map((p) => `<div class="ac-pay ${p.status}">
        <div><b>${esc(acMoney(p.amount))}</b><small>ref ${esc(p.ref || '—')} · ${esc(acfWhen(p.at))}</small>${p.note ? `<small>${esc(p.note)}</small>` : ''}</div>
        <span class="gw-st ${p.status === 'received' ? 'gw-st-approved' : p.status === 'rejected' ? 'gw-st-rejected' : 'gw-st-pending'}">${esc(AC_PAY_ST[p.status] || p.status)}</span>
        ${acIsStaff() && p.status === 'submitted' ? `<div class="ac-pay-act"><button type="button" class="button button-primary" data-acp="received" data-p="${esc(p.id)}">Mark received</button><button type="button" class="button button-outline" data-acp="rejected" data-p="${esc(p.id)}">Not matched…</button></div>${acFormHTML('pay', p.id)}` : ''}
      </div>`).join('')}</div>` : ''}
      ${acPayFormHTML(left)}
      ${role === 'winner' && a.phase === 'provisional' && left && !(AC.form && AC.form.kind === 'payment') ? `<div class="button-row"><button type="button" class="button button-primary" data-acx="pay">${AC_IC.cash} I have paid — record the reference</button></div>` : ''}</section>`;
  }

  /* ---------- the papers ---------- */
  function acDocsHTML(a, d, role) {
    const docs = d.docs || {};
    const have = RQ_DOCS.filter(([k]) => docs[k]);
    const missing = RQ_DOCS.filter(([k]) => !docs[k]);
    const pct = Math.round((have.length / RQ_DOCS.length) * 100);
    const canEdit = role === 'seller' || acIsStaff();
    return `<section class="ac-sec"><h3>The papers</h3>
      <div class="ac-bar"><i style="width:${pct}%"></i></div>
      <p class="ac-mini">${have.length} of ${RQ_DOCS.length} collected${role === 'winner' && !acIsStaff() ? ' · RAQBO checks every paper before the agreement is drawn up' : canEdit ? ' · tick what you have; RAQBO will ask for the rest' : ''}</p>
      <div class="ac-docs">${RQ_DOCS.map(([k, t, hint]) => `<label class="ac-doc ${docs[k] ? 'on' : ''}">
        <input type="checkbox" data-acdoc="${esc(k)}" ${docs[k] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
        <span class="ac-doc-box">${AC_IC.tick}</span>
        <span class="ac-doc-t"><b>${esc(t)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`).join('')}</div>
      ${missing.length && role !== 'winner' ? `<p class="ac-mini warn">${AC_IC.warn} Still needed: ${esc(missing.map((m) => m[1]).join(', '))}</p>` : ''}</section>`;
  }

  /* ---------- the room ---------- */
  function acTalkHTML(a, role) {
    const who = role === 'seller' ? 'the winning bidder' : role === 'winner' ? 'the owner' : 'either side';
    return `<section class="ac-sec"><h3>Talk it through</h3>
      <p class="ac-mini">Everything about this deal happens in a RAQBO room, so there is a record if anything is disputed. ${role === 'seller' ? 'The bidder stays a number until RAQBO makes the introduction at transfer.' : role === 'winner' ? 'You stay Bidder ' + esc(a.me && a.me.bidder_no ? a.me.bidder_no : '') + ' until RAQBO makes the introduction at transfer.' : 'Open the room with either side.'}</p>
      <div class="button-row">
        ${role === 'seller' || role === 'winner' ? `<button type="button" class="button button-primary" data-acx="room">${AC_IC.chat} Message ${esc(who)}</button>` : ''}
        <button type="button" class="button button-outline" data-chat="support">${AC_IC.chat} Message RAQBO</button>
        <button type="button" class="button button-outline" data-ax-open="${esc(a.id)}">Auction record &amp; bids</button>
      </div></section>`;
  }

  /* ---------- RAQBO's own panel ---------- */
  function acAdminHTML(a, d, at) {
    const all = AC_STEPS.every(([k]) => acStepDone(d, k));
    return `<section class="ac-sec ac-adm"><h3>${AC_IC.lock} RAQBO controls</h3>
      <p class="ac-mini">Tick a step only once it has actually happened. The sale cannot be confirmed until all four are ticked, and every tick is stored with the time.</p>
      <div class="ac-adm-steps">${AC_STEPS.map(([k, t, hint]) => {
      const done = acStepDone(d, k);
      const blocked = !done && AC_STEPS.findIndex(([x]) => x === k) > at;
      return `<div class="ac-adm-step ${done ? 'on' : ''}">
          <div><b>${esc(t)}</b><small>${esc(hint)}</small>${done && d.steps[k].at ? `<em>${esc(acfWhen(d.steps[k].at))}${d.steps[k].note ? ' · ' + esc(d.steps[k].note) : ''}</em>` : ''}</div>
          ${done ? `<button type="button" class="button button-outline" data-acs="off" data-k="${esc(k)}">Undo</button>`
        : AC.form && AC.form.kind === 'step' && AC.form.key === k ? ''
          : `<button type="button" class="button button-primary" data-acs="on" data-k="${esc(k)}" ${blocked ? 'disabled title="Tick the earlier steps first"' : ''}>Mark done…</button>`}
          ${acFormHTML('step', k)}
        </div>`;
    }).join('')}</div>
      ${a.phase === 'provisional' ? `<div class="button-row ac-adm-end">
        <button type="button" class="button button-primary" data-acr="sold" ${all ? '' : 'disabled title="All four steps must be ticked first"'}>Confirm sale completed</button>
        <button type="button" class="button button-outline ac-danger" data-acr="failed">Winner did not complete…</button>
      </div>${acFormHTML('sold', 'sold')}${acFormHTML('failed', 'failed')}${all ? '' : '<p class="ac-mini warn">' + AC_IC.warn + ' Confirming the sale unlocks once documents, payment, agreement and transfer are all ticked.</p>'}` : ''}</section>`;
  }

  /* ---------- the inline forms, so nothing covers the file ---------- */
  const AC_FORM = {
    step: ['What happened? This stays on the file and both sides can see it.', 'Mark this step done'],
    pay: ['Why does this payment not match? The payer will see this.', 'Save'],
    sold: ['A short note for the file — both sides will see it.', 'Confirm the sale is completed'],
    failed: ['What happened? Under the published terms the deposit may be forfeited.', 'Close the auction']
  };
  function acFormHTML(kind, key) {
    if (!AC.form || AC.form.kind !== kind || String(AC.form.key) !== String(key)) return '';
    const [label, submit] = AC_FORM[kind] || AC_FORM.step;
    return `<form class="ac-form" data-ac-note="${esc(kind)}" data-k="${esc(String(key))}" novalidate>
      <label>${esc(label)}<textarea name="note" rows="3" maxlength="600"></textarea></label>
      <div class="button-row"><button type="submit" class="button button-primary">${esc(submit)}</button>
      <button type="button" class="button button-outline" data-acx="cancel">Cancel</button></div></form>`;
  }
  function acPayFormHTML(left) {
    if (!AC.form || AC.form.kind !== 'payment') return '';
    return `<form class="ac-form" data-ac-pay novalidate>
      <label>Amount paid (PKR)<input name="amount" inputmode="numeric" autocomplete="off" value="${esc(String(left || ''))}"></label>
      <label>Bank transaction ID or reference<input name="ref" autocomplete="off" placeholder="As it appears on your receipt"></label>
      <p class="form-hint">${AC_IC.lock} Pay only into the RAQBO account on your invoice. RAQBO never asks for payment through a chat message, a link or a personal account.</p>
      <div class="button-row"><button type="submit" class="button button-primary">Send for checking</button>
      <button type="button" class="button button-outline" data-acx="cancel">Cancel</button></div></form>`;
  }

  /* ---------- actions ---------- */
  async function acSave(fn, okMsg, btn) {
    if (AC.busy) return;
    AC.busy = true;
    const done = btn ? busy(btn, '…') : () => {};
    try { await fn(); done(); if (okMsg) toast(okMsg); await acRefresh(); }
    catch (err) { done(); toast(err.message); }
    finally { AC.busy = false; }
  }

  document.addEventListener('click', (e) => {
    const d = e.target.closest('[data-acd]');
    if (d) { e.preventDefault(); acOpen(d.dataset.acd); return; }

    const x = e.target.closest('[data-acx]');
    if (x) {
      e.preventDefault();
      const k = x.dataset.acx;
      if (k === 'room') acRoom(x);
      else if (k === 'pay') { AC.form = { kind: 'payment', key: 'payment' }; acfPaint(); }
      else if (k === 'cancel') { AC.form = null; acfPaint(); }
      return;
    }

    const s2 = e.target.closest('[data-acs]');
    if (s2) {
      e.preventDefault();
      if (s2.dataset.acs === 'off') acSave(() => acApi.step(AC.id, s2.dataset.k, false, ''), 'Step reopened.', s2);
      else { AC.form = { kind: 'step', key: s2.dataset.k }; acfPaint(); }
      return;
    }

    const p = e.target.closest('[data-acp]');
    if (p) {
      e.preventDefault();
      if (p.dataset.acp === 'received') acSave(() => acApi.payDecide(AC.id, p.dataset.p, 'received', ''), 'Marked received — the payer has been told.', p);
      else { AC.form = { kind: 'pay', key: p.dataset.p }; acfPaint(); }
      return;
    }

    const r = e.target.closest('[data-acr]');
    if (r) { e.preventDefault(); AC.form = { kind: r.dataset.acr, key: r.dataset.acr }; acfPaint(); }
  });

  // one submit handler for every note the file asks for
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('.ac-form[data-ac-note]');
    if (!f) return;
    e.preventDefault();
    const note = String(f.note.value || '').trim();
    if (note.length < 3) { toast('Please write a short note — it stays on the file.'); f.note.focus(); return; }
    const kind = f.dataset.acNote; const key = f.dataset.k;
    const btn = $('[type=submit]', f);
    const done = busy(btn, 'Saving…');
    try {
      if (kind === 'step') await acApi.step(AC.id, key, true, note);
      else if (kind === 'pay') await acApi.payDecide(AC.id, key, 'rejected', note);
      else await AU.result(AC.id, kind, note);
      AC.form = null;
      toast(kind === 'failed' ? 'Saved — the auction is closed and both sides have been told.' : 'Saved — both sides have been told.');
      if (kind === 'sold' || kind === 'failed') { try { ax.admin = null; ax.mine = null; ax.loadedAt = 0; } catch { /* ignore */ } }
      await acRefresh();
    } catch (err) { done(); toast(err.message); }
  });

  // the buyer records a payment they have made
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('.ac-form[data-ac-pay]');
    if (!f) return;
    e.preventDefault();
    const amount = Math.round(Number(String(f.amount.value).replace(/[^\d]/g, '')));
    const ref = String(f.ref.value || '').trim();
    if (!amount || amount < 1000) { toast('Enter the amount in rupees.'); f.amount.focus(); return; }
    if (ref.length < 4) { toast('Enter the bank transaction ID from your receipt.'); f.ref.focus(); return; }
    const btn = $('[type=submit]', f);
    const done = busy(btn, 'Sending…');
    try {
      await acApi.pay(AC.id, amount, ref);
      AC.form = null;
      toast('Sent — RAQBO is checking it against the bank statement.');
      await acRefresh();
    } catch (err) { done(); toast(err.message); }
  });

  // the papers
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-acdoc]');
    if (!c || !AC.id) return;
    const docs = { ...((AC.d && AC.d.docs) || {}) };
    docs[c.dataset.acdoc] = c.checked;
    if (!c.checked) delete docs[c.dataset.acdoc];
    c.closest('.ac-doc').classList.toggle('on', c.checked);
    acSave(() => acApi.docs(AC.id, docs), '');
  });

  // the room between the two sides
  function acRoom(btn) {
    const id = AC.id;
    rqRoomGo(btn, 'start_auction_chat', { p_auction: id }, () => {
      const a = AC.a || {};
      const l = byId(a.listing_id);
      if (!l) throw new Error('That property is no longer listed.');
      const me = db.session.userId;
      const label = 'Bidder ' + (a.leader_no || (a.me && a.me.bidder_no) || 1);
      if (a.is_seller) {
        const bd = store.get('auc.bidders', []);
        const au = store.get('auc.list', {})[id] || {};
        const wb = bd.find((b) => b.id === au.high_bidder);
        if (!wb) throw new Error('There is no winning bidder on this auction yet.');
        return rqRoomLocal({ listing: l.id, other: wb.user_id, subject: `Auction ${a.ref} · ${l.title}`, otherName: 'Bidder ' + wb.bidder_no, myName: l.ownerName || 'Owner', notifyTitle: 'A message about the auction you won' });
      }
      return rqRoomLocal({ listing: l.id, other: l.ownerId, subject: `Auction ${a.ref} · ${l.title}`, otherName: l.ownerName || 'Owner', myName: label, notifyTitle: 'A message from the winning bidder' });
    }, acSetup);
  }

  /* ---------- getting here ---------- */
  function acRoute(h) {
    const m = h.match(/^#deal\/(.+)$/);
    if (m) { acOpen(decodeURIComponent(m[1])); return true; }
    return false;
  }
  addEventListener('hashchange', () => { if (acRoute(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } } });
  if (/^#deal\//.test(location.hash)) setTimeout(() => acRoute(location.hash), 800);

  // the winner's own box in the auction room gets a way in
  try {
    const base = auRefreshOpen;
    auRefreshOpen = async function () {
      const r = await base.apply(this, arguments);
      try {
        const win = $('.ax-win');
        if (win && ax.open && !$('[data-acd]', win)) {
          const row = document.createElement('div');
          row.className = 'button-row';
          row.innerHTML = `<button type="button" class="button button-primary" data-acd="${esc(String(ax.open || ''))}">${AC_IC.doc} Open the completion file</button>`;
          win.appendChild(row);
        }
      } catch { /* the button is optional */ }
      return r;
    };
  } catch { /* ignore */ }

  // RAQBO's auction panel gets one too
  try {
    const base = auAdminHTML;
    auAdminHTML = function () {
      let h = base.apply(this, arguments);
      try {
        h = h.replace(/<button type="button" class="button button-outline" data-ax-open="([^"]+)">Open auction room<\/button>/g,
          (m, id) => `<button type="button" class="button button-primary" data-acd="${id}">Completion file</button>${m}`);
      } catch { /* ignore */ }
      return h;
    };
  } catch { /* ignore */ }

  // and so do My auctions / My bids
  const acMyTail = (list, who) => {
    const open = (list || []).filter((a) => ['provisional', 'sold', 'failed'].includes(a.phase));
    if (!open.length) return '';
    return `<section class="gw-sec"><h3>${AC_IC.doc} Completion files</h3>
      <p class="gw-mini">${who === 'seller' ? 'Auctions of yours that found a winner. Follow the papers, the payment and the transfer here.' : 'Auctions you won. Follow what RAQBO still needs from you here.'}</p>
      ${open.map((a) => `<div class="ac-tile ${a.phase}">
        <div><b>${esc(a.title || 'Property')}</b><small>${esc(a.ref || '')} · ${esc(acMoney(a.high_amount))} · ${esc(AU_PHASE[a.phase] || a.phase)}</small></div>
        <button type="button" class="button button-primary" data-acd="${esc(a.id)}">Open</button>
      </div>`).join('')}</section>`;
  };
  try {
    const baseA = MY_RENDER.auctions;
    MY_RENDER.auctions = async () => (await baseA()) + acMyTail((ax.mine || {}).selling, 'seller');
    const baseB = MY_RENDER.bids;
    MY_RENDER.bids = async () => (await baseB()) + acMyTail(((ax.mine || {}).bidding || []).filter((a) => a.leading), 'winner');
  } catch { /* ignore */ }
