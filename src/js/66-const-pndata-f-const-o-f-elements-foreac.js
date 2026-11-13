  // =====================================================================
  const pnData = (f) => { const o = {}; [...f.elements].forEach((el) => { if (!el.name) return;
    if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value; }); return o; };
  const pnPick = (f, prefix) => [...f.elements].filter((el) => el.name && el.name.startsWith(prefix) && el.checked).map((el) => el.value || el.name.slice(prefix.length));
  const pnFail = (f, msg) => { const e = $('.form-error', f); if (e) { e.hidden = false; e.textContent = msg; } else toast(msg); };

  document.addEventListener('submit', async (e) => {
    const f = e.target; let m;

    if (f.dataset && f.dataset.pnForm === 'apply') {
      e.preventDefault(); const err = $('.form-error', f); if (err) err.hidden = true;
      const d = pnData(f);
      if (!d.declared) { pnFail(f, 'Please confirm the declaration at the end of the form.'); return; }
      d.services = pnPick(f, 'svc_'); d.categories_handled = pnPick(f, 'cat_');
      d.has_office = !!d.has_office;
      const done = busy($('button[type=submit]', f), 'Sending…');
      try {
        const photoInput = $('input[name=photo]', f); const docsInput = $('input[name=docs]', f);
        const photoFile = photoInput && photoInput.files && photoInput.files[0];
        if (photoFile) {
          if (photoFile.size > 5 * 1024 * 1024) throw new Error('The photograph must be smaller than 5 MB.');
          d.photo_path = await pnUpload(photoFile, 'partner-photos');
        }
        const ref = await PN.apply(d);
        // Supporting documents go up after the application exists, so each
        // one is attached to it.
        const files = (docsInput && docsInput.files) ? [...docsInput.files] : [];
        let failed = 0;
        for (const file of files) {
          try {
            if (file.size > 10 * 1024 * 1024) { failed++; continue; }
            const path = await pnUpload(file, 'partner-docs');
            if (path) await PN.addDoc({ path, title: file.name.slice(0, 160) });
          } catch { failed++; }
        }
        done();
        if (failed) toast(failed + ' file' + (failed === 1 ? '' : 's') + ' could not be attached. You can send them to RAQBO separately.');
        toast('Application ' + ref + ' sent. RAQBO will be in touch.');
        pn.mine = null; closeModal(); setTimeout(() => openPartnerApply(), 300);
      } catch (err2) { done(); pnFail(f, err2.message); }
      return;
    }
    if (f.dataset && f.dataset.pnForm === 'dir') { e.preventDefault(); pn.dirQ = pnData(f); pnLoadDirectory(f.closest('.gw-card') || document); return; }
    if (f.dataset && f.dataset.pnForm === 'check') { e.preventDefault(); const code = (f.code.value || '').trim();
      if (!code) return; await pnCheck(code); return; }
    if (f.dataset && f.dataset.pnForm === 'photo') {
      e.preventDefault();
      const file = f.photo && f.photo.files && f.photo.files[0];
      if (!file) { toast('Choose a photograph first.'); return; }
      if (file.size > 5 * 1024 * 1024) { toast('The photograph must be smaller than 5 MB.'); return; }
      const done = busy($('button[type=submit]', f), 'Uploading…');
      try { const path = await pnUpload(file, 'partner-photos'); await PN.setPhoto(null, path); done();
        toast('Photograph saved.'); pn.dash = null; renderMy && renderMy(); }
      catch (err2) { done(); toast(err2.message); }
      return;
    }
    if (f.dataset && f.dataset.pnForm === 'profile') { e.preventDefault(); const done = busy($('button[type=submit]', f), 'Saving…');
      try { await PN.saveProfile(pnData(f)); done(); toast('Saved.'); pn.dash = null; renderMy && renderMy(); }
      catch (err2) { done(); toast(err2.message); } return; }
    if (f.dataset && f.dataset.pnForm === 'statement') { e.preventDefault();
      const d = pnData(f); const done = busy($('button[type=submit]', f), 'Preparing…');
      try { const st = await PN.statement(d.from, d.to); done(); pnStatementOpen(st); } catch (err2) { done(); toast(err2.message); } return; }

    // ---- admin forms ----
    if ((m = f.closest('[data-pna-review]'))) { e.preventDefault(); const d = pnData(m); d.id = m.dataset.pnaReview;
      const done = busy($('button[type=submit]', m), 'Saving…');
      try { await PN.appReview(d); done(); pn.admin = null; pnAdminLoad('pn-applications'); toast('Assessment saved.'); } catch (err2) { done(); toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-stage]'))) { e.preventDefault(); const d = pnData(m);
      try { await PN.appStage(m.dataset.pnaStage, d.stage, d.note); pn.admin = null; pnAdminLoad('pn-applications'); toast('Stage updated.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-approve]'))) { e.preventDefault(); const d = pnData(m);
      const done = busy($('button[type=submit]', m), 'Appointing…');
      try { const pid = await PN.appApprove(m.dataset.pnaApprove, d.category, d.designation); done(); pn.admin = null; pnAdminLoad('pn-applications');
        toast('Appointed as ' + pid + '. The account opens once the agreement is executed and training is done.'); } catch (err2) { done(); toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-feedback]'))) { e.preventDefault(); const d = pnData(m);
      const done = busy($('button[type=submit]', m), 'Saving…');
      try { await PN.addFeedback({ partner_id: m.dataset.pnaFeedback, rating: +d.rating, customer: d.customer, comment: d.comment });
        done(); pn.admin = null; pnAdminLoad('pn-partners'); toast('Feedback recorded.'); }
      catch (err2) { done(); toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-takedown]'))) { e.preventDefault(); const d = pnData(m);
      const done = busy($('button[type=submit]', m), 'Removing…');
      try { await PN.takedown(m.dataset.pnaTakedown, d.reason); done(); pn.admin = null; pnAdminLoad('pn-partners');
        toast('The listing has been taken down and the partner told why.'); }
      catch (err2) { done(); toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-status]'))) { e.preventDefault(); const d = pnData(m);
      try { await PN.setStatus(m.dataset.pnaStatus, d.status, d.note); pn.admin = null; pnAdminLoad('pn-partners'); toast('Saved.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-powers]'))) { e.preventDefault(); const d = pnData(m); d.services = pnPick(m, 'svc_');
      try { await PN.setPowers(m.dataset.pnaPowers, d); pn.admin = null; pnAdminLoad('pn-partners'); toast('Saved.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-agreement]'))) { e.preventDefault(); const d = pnData(m); d.partner_id = m.dataset.pnaAgreement;
      const done = busy($('button[type=submit]', m), 'Saving…');
      try { const ref = await PN.saveAgreement(d); done(); pn.admin = null; pnAdminLoad('pn-partners'); toast('Agreement ' + ref + ' saved.'); } catch (err2) { done(); toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-territory]'))) { e.preventDefault(); const d = pnData(m);
      const done = busy($('button[type=submit]', m), 'Saving…');
      try { await PN.saveTerritory(d); done(); m.reset(); pn.admin = null; pnAdminLoad('pn-territories'); toast('Area saved.'); } catch (err2) { done(); toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-assign]'))) { e.preventDefault(); const d = pnData(m); if (!d.partner_id) { toast('Choose a partner first.'); return; }
      try { await PN.assign(d.partner_id, m.dataset.pnaAssign, d.exclusive); pn.admin = null; pnAdminLoad('pn-territories'); toast('Allocated.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-lead]'))) { e.preventDefault(); const d = pnData(m); if (!d.partner_id) { toast('Choose a partner first.'); return; }
      try { await PN.assignLead(m.dataset.pnaLead, d.partner_id); pn.admin = null; pnAdminLoad('pn-leads'); toast('Sent to the partner.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-rate]'))) { e.preventDefault(); const d = pnData(m); d.id = m.dataset.pnaRate;
      try { await PN.saveRate(d); pn.admin = null; pnAdminLoad('pn-money'); toast('Rate saved.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-newrate]'))) { e.preventDefault(); const d = pnData(m);
      try { await PN.saveRate(d); m.reset(); pn.admin = null; pnAdminLoad('pn-money'); toast('Rate added.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-tx]'))) { e.preventDefault(); const d = pnData(m);
      const done = busy($('button[type=submit]', m), 'Saving…');
      try { const ref = await PN.saveTx(d); done(); m.reset(); pn.admin = null; pnAdminLoad('pn-money'); toast('Transaction ' + ref + ' saved.'); } catch (err2) { done(); toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-cm]'))) { e.preventDefault(); const d = pnData(m);
      try { await PN.cmStatus(m.dataset.pnaCm, d.status, d.note); pn.admin = null; pnAdminLoad('pn-money'); toast('Saved.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-payout]'))) { e.preventDefault(); const d = pnData(m);
      try { const ref = await PN.buildPayout(d.partner_id, d.from, d.to); pn.admin = null; pnAdminLoad('pn-money'); toast('Payment ' + ref + ' prepared. It needs a full admin to approve it.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-po]'))) { e.preventDefault(); const d = pnData(m);
      try { await PN.payoutStatus(m.dataset.pnaPo, d.status, 'bank', d.reference); pn.admin = null; pnAdminLoad('pn-money'); toast('Saved.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pna-settings]'))) { e.preventDefault(); const d = pnData(m);
      try { await PN.saveSettings(d); pn.pub = null; pn.admin = null; pnAdminLoad('pn-money'); toast('Settings saved.'); } catch (err2) { toast(err2.message); } return; }
    if ((m = f.closest('[data-pn-qs]'))) { e.preventDefault(); const d = pnData(m);
      const done = busy($('button[type=submit]', m), 'Sending…');
      try { const ref = await PN.quicksell(d); done(); closeModal(); toast('Opportunity ' + ref + ' sent to RAQBO.'); pn.dash = null; }
      catch (err2) { done(); toast(err2.message); } return; }
  });

  document.addEventListener('change', async (e) => {
    const s = e.target.closest('[data-pn-stage]'); if (!s || !s.value) return;
    const ref = s.dataset.pnStage; const to = s.value; s.value = '';
    let note = '';
    if (to === 'lost') { note = prompt('Why did it not go ahead?') || ''; if (!note) return; }
    try { await PN.stage(ref, to, note); pn.dash = null; toast('Updated.'); renderMy && renderMy(); } catch (err) { toast(err.message); }
  });

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-pn]'); const a = e.target.closest('[data-pna]'); const tb = e.target.closest('[data-pn-tab]');
    if (tb) { pn.tab = tb.dataset.pnTab; renderMy && renderMy(); return; }
    if (a) {
      const k = a.dataset.k;
      if (a.dataset.pna === 'reload') { pn.admin = null; pn.adminAt = 0; pnAdminLoad(admin.tab); return; }
      if (a.dataset.pna === 'unassign') { try { await PN.unassign(k, a.dataset.t); pn.admin = null; pnAdminLoad('pn-territories'); } catch (err) { toast(err.message); } return; }
      if (a.dataset.pna === 'take') { try { await PN.takeLead(k); pn.admin = null; pnAdminLoad('pn-leads'); toast('RAQBO is handling it.'); } catch (err) { toast(err.message); } return; }
      if (a.dataset.pna === 'sweep') { try { const r = await PN.run(); pn.admin = null; pnAdminLoad('pn-leads'); toast((r.leads_returned || 0) + ' lead(s) returned, ' + (r.documents_reminded || 0) + ' reminder(s) sent.'); } catch (err) { toast(err.message); } return; }
      if (a.dataset.pna === 'newlead') { pnNewLeadForm(); return; }
      return;
    }
    if (!t) return;
    const k = t.dataset.k;
    e.preventDefault();
    if (t.dataset.pn === 'home') { openPartners(); return; }
    if (t.dataset.pn === 'apply') { openPartnerApply(k); return; }
    if (t.dataset.pn === 'opportunities') { openPartnerCats(); return; }
    if (t.dataset.pn === 'cat') { openPartnerCats(k); return; }
    if (t.dataset.pn === 'how') { openPartnerHow(); return; }
    if (t.dataset.pn === 'find') { openFindPartner(); return; }
    if (t.dataset.pn === 'photo-clear') {
      try { await PN.setPhoto(null, ''); toast('Photograph removed.'); pn.dash = null; renderMy && renderMy(); }
      catch (err) { toast(err.message); }
      return;
    }
    if (t.dataset.pn === 'dir-clear') { pn.dirQ = { province: '', city: '', area: '', service: '', q: '' }; pnLoadDirectory(t.closest('.gw-card') || document); return; }
    if (t.dataset.pn === 'qr') { await pnCheck(k); return; }
    if (t.dataset.pn === 'qr-print') { const d = pn.dash && pn.dash.partner; if (d) pnQrCard(d); else toast('Open your partner profile first.'); return; }
    if (t.dataset.pn === 'appt') { pnMeetingRequest(k); return; }
    if (t.dataset.pn === 'accept') {
      try { await PN.accept(k); pn.dash = null; toast('Accepted. The customer is yours — contact them now.'); renderMy && renderMy(); }
      catch (err) { toast(err.message); } return; }
    if (t.dataset.pn === 'decline') {
      const why = prompt('Why are you declining? RAQBO will give this customer to someone else.') || '';
      try { await PN.decline(k, why); pn.dash = null; toast('Declined. It has gone back to RAQBO.'); renderMy && renderMy(); }
      catch (err) { toast(err.message); } return; }
    if (t.dataset.pn === 'train') { try { await PN.train(k); pn.dash = null; toast('Noted.'); renderMy && renderMy(); } catch (err) { toast(err.message); } return; }
    if (t.dataset.pn === 'dispute') { const why = prompt('What is wrong with this commission?'); if (!why) return;
      try { await PN.dispute(k, why); pn.dash = null; toast('RAQBO will review it and come back to you.'); renderMy && renderMy(); } catch (err) { toast(err.message); } return; }
    if (t.dataset.pn === 'quicksell') { pnQuickSellForm(); return; }
    if (t.dataset.pn === 'newlisting') { closeModal(); if (pf.my.open) closeMy();
      openListingForm(null, { kicker: 'PARTNER SUBMISSION', heading: 'Submit a property for a customer' }); return; }
  });

  function pnQuickSellForm() {
    const card = openModal(`<div class="pn-page"><div class="pn-head"><span class="rail-kicker">${DI(DIC.alert, 14)} QUICKSELL</span>
      <h2>Send an QuickSell opportunity</h2><p class="admin-sub">RAQBO reviews it privately. Pricing and investor information stays with RAQBO and is never shown to other partners.</p></div>
      <form class="pn-form" data-pn-qs>
        <div class="pn-grid">
          <label>Owner&rsquo;s name<input name="owner_name" maxlength="120"></label>
          <label>Phone<input name="phone" maxlength="20"></label>
          <label>Province<input name="province" maxlength="60"></label>
          <label>City<input name="city" maxlength="60"></label>
          <label>Area<input name="area" maxlength="120"></label>
        </div>
        <label>What the owner needs<textarea name="detail" rows="3" maxlength="1000" placeholder="Why it is urgent, what the property is, and any timeframe."></textarea></label>
        <div class="pn-cta"><button type="submit" class="button button-primary">Send to RAQBO</button></div>
        <p class="pn-note">Your entitlement on an QuickSell is agreed for that transaction. Never take money from the owner on RAQBO&rsquo;s behalf.</p>
      </form></div>`, { label: 'Urgent-sale opportunity' });
    card.classList.add('gw-card', 'ax-modal'); applyBrandIcons(card);
  }

  function pnMeetingRequest(partnerId) {
    const msg = 'Hi RAQBO, I would like to arrange a meeting with your partner ' + partnerId + '.';
    const card = openModal(`<div class="pn-page"><div class="pn-head"><h2>Request a meeting</h2>
      <p class="admin-sub">RAQBO arranges the introduction so that there is a record of it, and so you are dealing with someone RAQBO has actually appointed.</p></div>
      <div class="pn-box"><div class="pn-kv"><span>Partner</span><b>${esc(partnerId)}</b></div></div>
      <div class="pn-cta"><a class="button button-whatsapp" href="${esc(waLink(msg))}" target="_blank" rel="noopener">${DI(DIC.chat, 16)} Ask RAQBO on WhatsApp</a>
        <button type="button" class="button button-light" data-pn="find">Back to the directory</button></div></div>`, { label: 'Request a meeting' });
    card.classList.add('gw-card', 'ax-modal'); applyBrandIcons(card);
  }

  function pnNewLeadForm() {
    const card = openModal(`<div class="pn-page"><div class="pn-head"><h2>Record a lead</h2>
      <p class="admin-sub">For a customer who came in by phone or in person. RAQBO works out the area automatically.</p></div>
      <form class="pn-form" data-pna-newlead>
        <div class="pn-grid">
          <label>Customer name<input name="customer_name" maxlength="120"></label>
          <label>Phone<input name="customer_phone" maxlength="20"></label>
          <label>Kind<select name="kind">${['buyer', 'seller', 'landlord', 'tenant', 'service', 'commercial', 'quicksell', 'auction', 'other'].map((k) => `<option value="${k}">${k}</option>`).join('')}</select></label>
          <label>Service<input name="service" maxlength="60"></label>
          <label>Province<input name="province" maxlength="60"></label>
          <label>City<input name="city" maxlength="60"></label>
          <label>Area<input name="area" maxlength="120"></label>
        </div>
        <label>What the customer wants<textarea name="customer_note" rows="3" maxlength="1000"></textarea></label>
        <div class="pn-cta"><button type="submit" class="button button-primary">Save lead</button></div>
      </form></div>`, { label: 'Record a lead' });
    card.classList.add('gw-card', 'ax-modal'); applyBrandIcons(card);
  }
  document.addEventListener('submit', async (e) => {
    const m = e.target.closest('[data-pna-newlead]'); if (!m) return; e.preventDefault();
    const d = pnData(m); const done = busy($('button[type=submit]', m), 'Saving…');
    try { const ref = await PN.newLead(d); done(); closeModal(); pn.admin = null; pnAdminLoad('pn-leads'); toast('Lead ' + ref + ' recorded.'); }
    catch (err) { done(); toast(err.message); }
  });

  function pnStatementOpen(st) {
    const rows = st.lines || [];
    const html = `<div class="pn-page"><div class="pn-head"><span class="rail-kicker">COMMISSION STATEMENT</span>
      <h2>${esc((st.partner || {}).name || '')}</h2>
      <p class="admin-sub">${esc((st.partner || {}).partner_id || '')} · ${esc(pnDate(st.from))} to ${esc(pnDate(st.to))} · issued ${esc(pnDate(st.issued_at))}</p></div>
      ${rows.length ? `<table class="gw-table"><thead><tr><th>Date</th><th>Transaction</th><th>Fee received</th><th>Deductions</th><th>Distributable</th><th>Share</th><th>Amount</th><th>Status</th></tr></thead><tbody>
        ${rows.map((l) => `<tr><td>${esc(pnDate(l.date))}</td><td>${esc(l.ref)}<br><small>${esc(l.description || l.service || '')}</small></td>
          <td>${esc(pnMoney(l.fee_received))}</td><td>${esc(pnMoney(l.deductions))}${l.deduction_note ? '<br><small>' + esc(l.deduction_note) + '</small>' : ''}</td>
          <td>${esc(pnMoney(l.distributable))}</td><td>${esc(l.rate_pct)}%</td><td><b>${esc(pnMoney(l.amount))}</b></td><td>${esc(l.status)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6"><b>Total</b></td><td><b>${esc(pnMoney(st.total))}</b></td><td></td></tr></tfoot></table>`
        : '<div class="admin-empty">Nothing in that period.</div>'}
      <p class="pn-note">${esc(st.note || PN_NOTE_MONEY)}</p>
      <div class="pn-cta"><button type="button" class="button button-primary" onclick="window.print()">${DI(DIC.download, 16)} Print or save as PDF</button></div></div>`;
    const card = openModal(html, { wide: true, label: 'Commission statement' });
    card.classList.add('gw-card', 'ax-modal'); applyBrandIcons(card);
  }

  // ---------- Services catalogue ----------
  { const g = (k) => V3S_GROUPS.find((x) => x.key === k);
    const tx = g('tx') || V3S_GROUPS[0];
    if (tx) tx.items.push(['partner_network', 'Become a RAQBO Partner',
      'Work with RAQBO in your own city or locality — property sales, rentals, leasing, verification, auctions and property management, under a transparent sharing arrangement.',
      'No fee to apply', false, null, 'data-pn="apply"'],
      ['find_partner', 'Find a RAQBO Partner',
        'Search RAQBO’s appointed partners by province, city, area or service, and check anyone’s current status before you deal with them.',
        'Free', false, null, 'data-pn="find"']);
    ['partner_network', 'find_partner'].forEach((k) => { if (typeof V3S_ALL === 'object') V3S_ALL[k] = { k, t: k, d: '', fee: '', link: `data-pn="${k}"`, group: '' }; }); }

  function pnMenu() {
    const q = $('.mega-quick'); if (q && !$('[data-pn="apply"]', q)) q.insertAdjacentHTML('beforeend',
      '<button type="button" data-pn="apply">Become a RAQBO Partner</button><button type="button" data-pn="find">Find a RAQBO Partner</button>');
  }
  setTimeout(pnMenu, 800); document.addEventListener('click', () => setTimeout(pnMenu, 0), true);

  // ---------- Routes ----------
  function pnRoute() {
    const h = location.hash;
    if (h.startsWith('#partner-check')) { openFindPartner(); const tok = h.split('=')[1]; if (tok) setTimeout(() => pnCheck(tok), 400); return true; }
    if (h === '#partners' || h === '#become-a-partner') { openPartners(); return true; }
    if (h === '#partner-opportunities') { openPartnerCats(); return true; }
    if (h === '#partner-how') { openPartnerHow(); return true; }
    if (h === '#partner-apply') { openPartnerApply(); return true; }
    if (h === '#find-partner' || h === '#partner-directory') { openFindPartner(); return true; }
    return false;
  }
  addEventListener('hashchange', pnRoute);
  if (/^#(partners|become-a-partner|partner-opportunities|partner-how|partner-apply|find-partner|partner-directory|partner-check)/.test(location.hash)) setTimeout(pnRoute, 950);

  // ---------- A band on the homepage ----------
  RAILS.push(() => ({ id: 'rail-partner', always: true, kicker: 'RAQBO PARTNER NETWORK', title: 'Become a RAQBO Partner',
    sub: 'Your Local Expertise. Our Digital Platform. Shared Growth. Work with RAQBO in your own city or locality under a transparent business-sharing arrangement.',
    list: [], html: `<div class="pn-rail">
      <div class="pn-rail-in">
        ${Object.entries(PN_CAT).map(([k, c]) => `<button type="button" class="pn-rail-cat" data-pn="cat" data-k="${k}">
          <span class="pn-cat-ic">${DI(DIC[c.icon], 20)}</span><b>${esc(c.name)}</b><small>${esc(c.short)}</small></button>`).join('')}
      </div>
      <div class="pn-cta">
        <button type="button" class="button button-primary" data-pn="apply">Apply to Become a Partner</button>
        <button type="button" class="button button-light" data-pn="opportunities">Explore opportunities</button>
        <button type="button" class="button button-ghost" data-pn="how">How partnership works</button>
        <button type="button" class="button button-ghost" data-pn="find">Find a RAQBO Partner</button>
      </div></div>` }));

  // Keep the housekeeping ticking over while people use the site
  setTimeout(() => { if (SB && db.isAdmin) PN.run().catch(() => { }); }, 12000);
