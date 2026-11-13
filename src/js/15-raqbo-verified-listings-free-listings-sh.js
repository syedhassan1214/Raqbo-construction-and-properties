  /* =====================================================================
     RAQBO Verified listings: free listings show "Unverified"; owners who
     pay the verification fee and pass the document check get the badge.
     Supabase: update_12_verification.sql · Demo mode: this browser only
     ===================================================================== */
  var vf = { mine: {}, admin: null, adminLoading: false, only: false };
  const VF_BUCKET = 'verification-docs';
  const vfSetupMsg = 'RAQBO verification is being set up. (Admin: run update_12_verification.sql in Supabase.)';
  const VF_CHECKS = ['Owner\'s CNIC matches the ownership documents', 'Registry / Fard / allotment or transfer letter is in the owner\'s name', 'Society or scheme approval status (for example LDA in Lahore)', 'Area, size and property type match the listing', 'No dues or obvious disputes shown on the documents'];
  const VF_DOC_TYPES = ['Registry (sale deed)', 'Fard / record of rights', 'Intiqal (mutation)', 'Allotment or transfer letter', 'Owner CNIC (front and back)', 'Latest utility or property tax bill', 'Authority letter (if not the owner)', 'Other'];
  const vfSafeName = (n) => String(n || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
  const vfSupabase = (sb) => {
    const q = async (p, msg) => { const { data, error } = await p; if (error) throw new Error(/does not exist|schema cache|relation|could not find the function|bucket not found/i.test(error.message || '') ? vfSetupMsg : (error.message || msg)); return data; };
    return {
      async mine() { const me = db.session && db.session.userId; if (!me) return []; return (await q(sb.from('listing_verifications').select('listing_id, status, fee, admin_note, submitted_at, decided_at').eq('owner_id', me), '')) || []; },
      async upload(listingId, file) {
        const me = db.session.userId; const path = `${me}/${listingId}/${Date.now().toString(36)}-${vfSafeName(file.name)}`;
        const { error } = await sb.storage.from(VF_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (error) throw new Error(/bucket not found/i.test(error.message || '') ? vfSetupMsg : /size|large/i.test(error.message || '') ? `${file.name} is too large (10 MB maximum).` : /mime|type/i.test(error.message || '') ? `${file.name}: please upload a photo (JPG, PNG) or a PDF.` : 'Upload failed: ' + error.message);
        return path;
      },
      async request(a) {
        const { error } = await sb.rpc('request_listing_verification2', { p_listing: a.listingId, p_level: a.level || 'documents', p_method: a.method || '', p_txn: a.txn || '', p_proof: a.proof || '', p_docs: a.docs, p_note: a.note || '' });
        if (error && /could not find the function|does not exist/i.test(error.message || '')) return q(sb.rpc('request_listing_verification', { p_listing: a.listingId, p_method: a.method || '', p_txn: a.txn || '', p_proof: a.proof || '', p_docs: a.docs, p_note: a.note || '' }), 'Could not send the request.');
        if (error) throw new Error(error.message || 'Could not send the request.');
      },
      async adminList() { const r = await q(sb.rpc('admin_verifications'), 'Could not load.'); return Array.isArray(r) ? { listings: r, identity: [] } : r; },
      async decide(id, ok, note, checks, reason) {
        const { error } = await sb.rpc('admin_decide_verification2', { p_listing: id, p_approve: ok, p_note: note || '', p_checks: checks || [], p_reason: reason || '' });
        if (error && /could not find the function/i.test(error.message || '')) return q(sb.rpc('admin_decide_verification', { p_listing: id, p_approve: ok, p_note: note || '' }), 'Could not save.');
        if (error) throw new Error(error.message || 'Could not save.');
      },
      async fileUrl(path) { const { data, error } = await sb.storage.from(VF_BUCKET).createSignedUrl(path, 3600); if (error) throw new Error('Could not open the file.'); return data.signedUrl; }
    };
  };
  const vfLocal = {
    read: () => store.get('verif', {}), write(d) { store.set('verif', d); window.dispatchEvent(new Event('raqbo-growth')); },
    async mine() { const me = db.session && db.session.userId; return Object.values(this.read()).filter((v) => v.owner_id === me); },
    async upload(listingId, file) { const id = 'vd-' + uid('f'); await media.put(id, file); return 'local:' + id; },
    async request(a) {
      const d = this.read(); const l = byId(a.listingId); const me = db.session && db.session.userId; const lvl = a.level || 'documents'; const fee = lvl === 'legal' ? ((pf.pub && pf.pub.legal_verification_fee) || 0) : ((gw.pub && gw.pub.verification_fee) || 0);
      if (!l || l.ownerId !== me) throw new Error('You can verify only your own property.');
      const cur = d[a.listingId]; if (cur && cur.status === 'submitted') throw new Error('Your documents are already with RAQBO for checking.'); if (cur && cur.status === 'verified') throw new Error('This property is already RAQBO Verified.');
      d[a.listingId] = { ...(cur || {}), listing_id: a.listingId, owner_id: me, status: 'submitted', level: lvl, checks: [], fee, payment_method: a.method, txn_id: a.txn, payment_proof: a.proof, documents: a.docs, owner_note: a.note, admin_note: '', submitted_at: new Date().toISOString() };
      this.write(d); try { lvLocal.notifyAdmins('listing', 'Verification request: ' + l.title, `${db.session.name} · ${l.ref || ''} · fee Rs ${fee}`, '#admin/verify'); } catch { /* ignore */ }
    },
    async adminList() { const accs = Object.values(store.get('accounts', {})); const idc = store.get('pf.identity', {}); return { identity: Object.values(idc).sort((a, b) => (b.status === 'pending') - (a.status === 'pending')), listings: Object.values(this.read()).map((v) => { const l = byId(v.listing_id) || {}; const a = accs.find((x) => x.userId === v.owner_id) || {}; return { ...v, title: l.title, ref: l.ref, city: l.city, area: l.area, listing_status: l.status, owner: a.name || 'Member', phone: a.phone, email: a.email, owner_id_verified: !!(idc[v.owner_id] && idc[v.owner_id].status === 'verified'), bank_matched: (store.get('pf.bank', []) || []).some((b) => b.matched_kind === 'verification' && b.matched_ref === l.ref) }; }).sort((a, b) => (b.status === 'submitted') - (a.status === 'submitted') || String(b.submitted_at).localeCompare(String(a.submitted_at))) }; },
    async decide(id, ok, note, checks, reason) { const d = this.read(); const v = d[id]; if (!v || v.status !== 'submitted') throw new Error('This request was already handled.'); if (ok && !(checks || []).some((c) => c.result === 'ok')) throw new Error('Tick at least one check that was completed.'); v.status = ok ? 'verified' : 'rejected'; v.admin_note = note || ''; v.decided_at = new Date().toISOString(); if (ok) v.checks = checks; (v.history = v.history || []).push({ event: ok ? 'verified' : 'rejected', level: v.level || 'documents', at: v.decided_at }); this.write(d); try { pfLocal.log(ok ? 'verification.approve' : 'verification.reject', (byId(id) || {}).ref, reason || note, { checks }); } catch { /* ignore */ }
      try { lvLocal.notify(v.owner_id, 'listing', ok ? '✓ Your property is RAQBO Verified' : 'Verification not approved', note || '', ok ? '#property/' + id : '#account'); } catch { /* ignore */ } },
    async fileUrl(path) { const u = await media.url(String(path).replace(/^local:/, '')); if (!u) throw new Error('File not found in this browser.'); return u; }
  };
  const VF = SB ? vfSupabase(SB) : vfLocal;

  // ---------- Helpers used by the property list, details and account ----------
  const vfOn = () => !!(gw.pub && gw.pub.verification_enabled);
  function vfIsVerified(id) { return !!(gw.verified && gw.verified.has(id)); }
  function vfOnly() { return fx.vmode === 'verified'; }
  function vfCardBadge(l) {
    if (l.sample || l.status !== 'published') return '';
    return vfIsVerified(l.id) ? `<span class="vb vb-ok${coreVerifLevel(l.id) === 'legal' ? ' vb-legal' : ''}" title="${coreVerifLevel(l.id) === 'legal' ? 'Enhanced Property Verification by RAQBO' : 'Documents Reviewed by RAQBO'}">${DI(DIC.check, 12)} ${coreVerifLevel(l.id) === 'legal' ? 'Enhanced verified' : 'RAQBO Verified'}</span>` : '<span class="vb vb-no" title="Documents not checked by RAQBO">Unverified</span>';
  }
  function vfDetailBadge(l) {
    if (l.sample || l.status !== 'published') return '';
    return vfIsVerified(l.id) ? `<span class="pp-badge vb-ok">${DI(DIC.check, 12)} ${coreVerifLevel(l.id) === 'legal' ? 'ENHANCED VERIFIED' : 'RAQBO VERIFIED'}</span>` : '<span class="pp-badge vb-no">UNVERIFIED</span>';
  }
  function vfDetailBox(l) {
    if (!vfOn() || l.sample) return '';
    const mine = db.session && l.ownerId === db.session.userId; const fee = gw.pub.verification_fee || 0;
    if (vfIsVerified(l.id)) { setTimeout(() => vfFillTrust(l.id), 0); return `<section class="pp-section"><div class="vf-box ok" data-vf-trust="${esc(l.id)}"><span>${DI(DIC.shield, 22)}</span><div><b>${coreVerifLevel(l.id) === 'legal' ? 'Enhanced Property Verification — RAQBO Verified' : 'Documents Reviewed — RAQBO Verified'}</b><p>RAQBO checked this property. See exactly what was checked and when in the Property Passport.</p><ul class="vf-did"></ul><small class="vf-disc">A RAQBO badge is not a government guarantee of ownership or legal title. Visit the property and get independent legal advice before paying.</small></div></div></section>`; }
    return `<section class="pp-section"><div class="vf-box no"><span>${DI(DIC.alert, 22)}</span><div><b>Unverified listing</b><p>${mine ? `Your property is listed free. Get the <b>RAQBO Verified</b> badge so buyers trust it more: upload your ownership documents and pay the ${fee ? esc(rs(fee)) + ' ' : ''}verification fee.` : 'RAQBO has not checked this property\'s documents. Check the ownership papers and the seller\'s identity yourself before paying anything — or ask RAQBO to verify it.'}</p>
      ${mine ? `<button type="button" class="button button-primary" data-vf="apply" data-id="${esc(l.id)}">${DI(DIC.shield, 16)} Get RAQBO Verified</button>` : '<button type="button" class="button button-outline" data-service="verification">Ask RAQBO to verify a property</button>'}</div></div></section>`;
  }
  async function vfFillTrust(id) {
    const box = $(`[data-vf-trust="${CSS.escape(id)}"]`); if (!box || box.dataset.done) return; box.dataset.done = '1';
    let t = null; try { t = await PF.trust(id); } catch { return; }
    const v = t && t.verification; if (!v || v.status !== 'verified') return;
    $('p', box).innerHTML = `Checked on <b>${esc(fmtDay(v.checked_at))}</b>${t.owner_id_verified ? ' · advertiser\'s identity verified' : ''}.`;
    $('.vf-did', box).innerHTML = (v.checks || []).filter((c) => c.result === 'ok').map((c) => `<li>${DI(DIC.check, 13)} ${esc(c.label)}</li>`).join('');
    if (!$('.vr-open', box)) $('.vf-did', box).insertAdjacentHTML('afterend', `<button type="button" class="link-button vr-open" data-vr="report" data-id="${esc(id)}">${DI(DIC.doc, 14)} Open the verification report (with QR check)</button>`);
  }
  // My account row: status + action
  function vfAccountBits(l) {
    if (!vfOn() || l.sample || l.status === 'rejected') return '';
    const v = vf.mine[l.id]; const fee = gw.pub.verification_fee || 0;
    if (v && v.status === 'verified') return `<span class="vb vb-ok">${DI(DIC.check, 12)} RAQBO Verified</span>`;
    if (v && v.status === 'submitted') return '<span class="vb vb-wait">Verification in review</span>';
    const why = v && (v.status === 'rejected' || v.status === 'expired') && v.admin_note ? `<small class="vf-why">${v.status === 'rejected' ? 'Not verified' : 'Badge removed'}: ${esc(v.admin_note)}</small>` : '';
    return `${why}<button type="button" class="link-button vf-apply" data-vf="apply" data-id="${esc(l.id)}">${DI(DIC.shield, 13)} ${v ? 'Apply again' : 'Get RAQBO Verified'}${fee ? ' · from ' + esc(rs(fee)) : ''}</button>`;
  }
  async function vfLoadMine() {
    if (!(db.session && isComplete())) { vf.mine = {}; return; }
    try { const rows = await VF.mine(); vf.mine = Object.fromEntries((rows || []).map((r) => [r.listing_id, r])); } catch { vf.mine = {}; }
  }
  function vfPlaceToggle() {
    const old = $('.results-controls [data-vf="only"]'); if (old) old.remove(); return;
    const c = $('.results-controls'); if (!c || !vfOn()) return;
    if (!$('[data-vf="only"]', c)) c.insertAdjacentHTML('afterbegin', `<button type="button" class="gw-alert-btn vf-only" data-vf="only" aria-pressed="${vf.only}">${DI(DIC.shield, 15)} Verified only</button>`);
    const b = $('[data-vf="only"]', c); b.classList.toggle('on', vf.only); b.setAttribute('aria-pressed', String(vf.only));
  }

  // ---------- Apply for the badge ----------
  function openVerify(listingId) {
    requireSignIn(async () => {
      const l = byId(listingId); if (!l || l.ownerId !== db.session.userId) { toast('You can verify only your own property.'); return; }
      if (!gw.pub) await gwLoadPub(); if (!vfOn()) { toast('RAQBO verification is not available right now.'); return; }
      const fees = { documents: gw.pub.verification_fee || 0, legal: (pf.pub && pf.pub.legal_verification_fee) || 0 }; let level = 'documents'; let fee = fees.documents; const E = (window.RAQBO_CONTENT && window.RAQBO_CONTENT.escrow) || {};
      const acct = [['Account title', E.accountTitle], ['Bank', E.bank], ['IBAN', E.iban], ['JazzCash', E.jazzcash], ['Easypaisa', E.easypaisa], ['SadaPay', E.sadapay], ['NayaPay', E.nayapay]].filter(([, v]) => v);
      const docs = []; let proof = null;
      if (pp.el && !pp.el.hidden) closeDetails();
      const card = openModal(`<div class="vf-apply-page">
        <div class="eyebrow"><span></span> RAQBO VERIFIED</div><h2>Get the RAQBO Verified badge</h2>
        <p class="modal-lead">${esc(l.title)} · ${esc(l.area)}, ${esc(l.city)}${l.ref ? ' · ' + esc(l.ref) : ''}</p>
        <div class="vf-compare"><div><span class="vb vb-no">Unverified</span><small>Free listing — documents not checked</small></div><div><span class="vb vb-ok">${DI(DIC.check, 12)} RAQBO Verified</span><small>Documents checked by RAQBO — buyers trust it more</small></div></div>
        <form class="vf-form" data-vf-form novalidate>
          <section><h3>1. Choose the check</h3><div class="vf-levels">${[['documents', 'Documents Reviewed', 'Level 2 — the RAQBO Verified badge'], ['legal', 'Enhanced Property Verification', 'Level 3 — our most complete check']].map(([k, t, sub]) => `<label class="vf-level"><input type="radio" name="level" value="${k}" ${k === 'documents' ? 'checked' : ''}><span><b>${esc(t)}</b><em>${fees[k] ? esc(rs(fees[k])) : 'Free'}</em><small>${esc(sub)}</small><ul>${CHECKS[k].map(([, c]) => `<li>${DI(DIC.check, 12)} ${esc(c)}</li>`).join('')}</ul></span></label>`).join('')}</div>
            <p class="form-hint">RAQBO shows buyers exactly what was checked and the date. A badge is not a government guarantee of ownership or legal title.</p></section>
          <section><h3>2. Upload ownership documents</h3><p class="form-hint">Photos or PDF, up to 10 MB each, up to 12 files. For example: ${VF_DOC_TYPES.slice(0, 6).map(esc).join(', ')}.</p>
            <label class="vf-drop"><input type="file" name="docs" accept="image/jpeg,image/png,image/webp,application/pdf" multiple><span>${DI(DIC.doc, 22)}<b>Choose documents</b><small>Tap to add photos or PDF files</small></span></label>
            <ul class="vf-files" data-vf-files></ul></section>
          ${fees.documents || fees.legal ? `<section data-vf-paysec><h3>3. Pay the verification fee: <span data-vf-fee>${esc(rs(fee))}</span></h3>
            ${acct.length ? `<dl class="vf-acct">${acct.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '<p class="form-hint">Ask RAQBO on WhatsApp for the payment details.</p>'}
            <div class="vf-grid"><label><span>Paid by</span><select name="method"><option value="">Choose…</option><option>Bank transfer</option><option>JazzCash</option><option>Easypaisa</option><option>SadaPay</option><option>NayaPay</option></select></label><label><span>Transaction ID (optional)</span><input name="txn" maxlength="80"></label></div>
            <label class="vf-drop small"><input type="file" name="proof" accept="image/jpeg,image/png,image/webp"><span>${DI(DIC.download, 18)}<b>Upload payment screenshot</b><small data-vf-proof>Required</small></span></label></section>` : ''}
          <section><h3>${fees.documents || fees.legal ? '4' : '3'}. Anything to add?</h3><textarea name="note" rows="2" maxlength="600" placeholder="e.g. The property is in my father's name; authority letter attached."></textarea>
            <label class="vf-agree"><input type="checkbox" name="agree"> I confirm these documents are genuine and I am the owner or authorised by the owner. ${fees.documents || fees.legal ? 'The fee is for the check and is not refunded if the documents do not match.' : ''}</label></section>
          <div class="form-error" role="alert" hidden></div>
          <div class="button-row"><button type="submit" class="button button-primary">Send for verification</button><button type="button" class="button button-outline" data-vf="cancel">Cancel</button></div>
          <p class="form-hint" data-vf-progress></p>
        </form></div>`, { wide: true, label: 'Get RAQBO Verified' });
      const form = $('[data-vf-form]', card); const list = $('[data-vf-files]', card);
      const paint = () => { list.innerHTML = docs.map((f, i) => `<li><span>${DI(DIC.doc, 14)} ${esc(f.name)} <small>${(f.size / 1048576).toFixed(1)} MB</small></span><button type="button" class="link-button" data-vf-rm="${i}">Remove</button></li>`).join(''); };
      form.addEventListener('change', (e) => {
        if (e.target.name === 'docs') { for (const f of e.target.files) { if (docs.length >= 12) { toast('Up to 12 documents.'); break; } if (f.size > 25 * 1048576) { toast(`${f.name} is too large.`); continue; } docs.push(f); } e.target.value = ''; paint(); }
        if (e.target.name === 'level') { level = e.target.value; fee = fees[level]; const fs = $('[data-vf-fee]', form); if (fs) fs.textContent = fee ? rs(fee) : 'Free'; const ps = $('[data-vf-paysec]', form); if (ps) ps.hidden = !fee; }
        if (e.target.name === 'proof') { proof = e.target.files[0] || null; const s = $('[data-vf-proof]', form); if (s) s.textContent = proof ? proof.name : 'Required'; }
      });
      form.addEventListener('click', (e) => { const r = e.target.closest('[data-vf-rm]'); if (r) { docs.splice(Number(r.dataset.vfRm), 1); paint(); } if (e.target.closest('[data-vf="cancel"]')) closeModal(); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); const errs = [];
        if (!docs.length) errs.push(['docs', 'Please add at least one ownership document.']);
        if (fee && !form.method.value) errs.push(['method', 'Choose how you paid the fee.']);
        if (fee && !proof) errs.push(['proof', 'Please upload the payment screenshot.']);
        if (!form.agree.checked) errs.push(['agree', 'Please confirm the documents are genuine.']);
        if (showErrors(form, errs)) return;
        const btn = $('[type=submit]', form); const done = busy(btn, 'Sending…'); const prog = $('[data-vf-progress]', form);
        try {
          const paths = [];
          for (let i = 0; i < docs.length; i++) {
            prog.textContent = `Uploading document ${i + 1} of ${docs.length}…`;
            let f = docs[i]; if (/^image\//.test(f.type)) { try { f = await shrinkImage(f, 2200, 0.86); } catch { /* keep original */ } }
            if (f.size > 10 * 1048576) throw new Error(`${docs[i].name} is larger than 10 MB. Please upload a smaller copy.`);
            paths.push({ path: await VF.upload(l.id, f), name: docs[i].name, type: docs[i].type || '' });
          }
          let proofPath = '';
          if (fee && proof) { prog.textContent = 'Uploading the payment screenshot…'; let f = proof; try { f = await shrinkImage(f, 1600, 0.82); } catch { /* keep */ } proofPath = await VF.upload(l.id, f); }
          prog.textContent = 'Sending…';
          await VF.request({ listingId: l.id, level, method: fee ? form.method.value : '', txn: fee ? form.txn.value : '', proof: proofPath, docs: paths, note: form.note.value });
          done(); closeModal(); toast('Sent. RAQBO will check your documents and notify you.'); await vfLoadMine(); openMy('properties');
        } catch (err) { done(); prog.textContent = ''; showErrors(form, [['docs', err.message]]); }
      });
    });
  }

  // ---------- Admin: verification requests ----------
  function vfPendingCount() { const d = vf.admin; if (!d || d.error) return ''; return ((d.listings || []).filter((v) => v.status === 'submitted').length + (d.identity || []).filter((c) => c.status === 'pending').length) || ''; }
  function vfAdminHTML() {
    const d = vf.admin; if (!d) { vfAdminLoad(); return '<div class="admin-empty">Loading…</div>'; }
    if (d.error) return `<div class="admin-empty">${esc(d.error)}<br><br><button type="button" class="admin-refresh" data-vfa="reload">Try again</button></div>`;
    const L = d.listings || []; const IDS = d.identity || []; const open = L.filter((v) => v.status === 'submitted'); const done = L.filter((v) => v.status !== 'submitted').slice(0, 40); const idOpen = IDS.filter((c) => c.status === 'pending');
    const fileBtn = (f, label) => `<button type="button" class="vf-file" data-vfa="file" data-path="${esc(f)}">${DI(DIC.doc, 14)} ${esc(label)}</button>`;
    const stl = { verified: 'Verified', rejected: 'Not verified', expired: 'Badge removed (details changed)' };
    return `<div class="gwa">
      <div class="admin-head-row"><div><h2>Verification requests</h2><p class="admin-sub">Property checks (document or legal level) and member identity checks. Confirm the fee has reached the bank (Payments &amp; bank records), check the documents, then tick exactly what you checked — buyers see those ticks and the date.</p></div><button type="button" class="admin-refresh" data-vfa="reload">${DI(DIC.trend, 15)} Refresh</button></div>
      <section class="gwa-sec"><h3>Waiting for checking <span class="admin-count">${open.length}</span></h3>
        ${open.length ? open.map((v) => `<div class="vfa-req" data-lid="${esc(v.listing_id)}">
          <div class="vfa-top"><div><b>${esc(v.title || 'Listing')}</b><small>${esc(v.ref || '')} · ${esc(v.area || '')}, ${esc(v.city || '')} · listing ${esc(v.listing_status || '')} · sent ${esc(fmtDay(v.submitted_at))}</small><small>Owner: ${esc(v.owner || '')}${v.phone ? ' · ' + esc(v.phone) : ''}${v.email ? ' · ' + esc(v.email) : ''}</small></div>
            <button type="button" class="link-button" data-vfa="view" data-id="${esc(v.listing_id)}">View listing</button></div>
          <div class="vfa-pay"><span class="vfa-level ${v.level === 'legal' ? 'legal' : ''}">${v.level === 'legal' ? 'Enhanced Property Verification' : 'Documents Reviewed'}</span>${v.fee ? `<b>Fee ${esc(rs(v.fee))}</b> · ${esc(v.payment_method || '—')}${v.txn_id ? ' · Txn ' + esc(v.txn_id) : ''} ${v.payment_proof ? fileBtn(v.payment_proof, 'Payment screenshot') : '<em>no screenshot</em>'} ${v.bank_matched ? '<span class="gw-st gw-st-approved">Bank: matched</span>' : '<span class="gw-st gw-st-pending">Bank: no record yet</span>'}` : '<b>No fee</b>'}${v.owner_id_verified ? ' <span class="id-chip">Identity Verified</span>' : ''}</div>
          <div class="vfa-docs">${(v.documents || []).map((f) => fileBtn(f.path, f.name || 'Document')).join('')}</div>
          ${v.owner_note ? `<p class="vfa-note">“${esc(v.owner_note)}”</p>` : ''}
          <fieldset class="vfa-checks"><legend>What did you check? (shown to buyers)</legend>${CHECKS[v.level === 'legal' ? 'legal' : 'documents'].map(([k, c]) => `<label><input type="checkbox" data-ck="${k}" data-label="${esc(c)}"> ${esc(c)}</label>`).join('')}</fieldset>
          ${vrRepFields()}
          ${v.fee && !v.bank_matched ? '<input class="gwa-note vfa-reason" placeholder="No bank match yet — reason to approve anyway (audit log)" maxlength="300" aria-label="Reason">' : ''}
          <div class="vfa-act"><input class="gwa-note vfa-note-in" placeholder="Note to the owner (shown if rejected)" maxlength="600" aria-label="Note"><button type="button" class="button button-primary" data-vfa="approve" data-id="${esc(v.listing_id)}">${DI(DIC.check, 15)} Approve — RAQBO Verified</button><button type="button" class="button button-outline" data-vfa="reject" data-id="${esc(v.listing_id)}">Reject</button></div>
        </div>`).join('') : '<div class="admin-empty sm">No requests waiting. New requests appear here live and in the bell.</div>'}
      </section>
      <section class="gwa-sec"><h3>Identity checks (CNIC) <span class="admin-count">${idOpen.length}</span></h3>
        ${idOpen.length ? idOpen.map((c) => `<div class="vfa-req" data-uid="${esc(c.user_id)}"><div class="vfa-top"><div><b>${esc(c.name_on_cnic)}</b><small>Member: ${esc(c.member || '')}${c.phone ? ' · ' + esc(c.phone) : ''}${c.email ? ' · ' + esc(c.email) : ''} · sent ${esc(fmtDay(c.submitted_at))}</small></div></div>
          <div class="vfa-docs">${(c.files || []).map((f) => `<button type="button" class="vf-file" data-vfa="idfile" data-path="${esc(f.path)}">${DI(DIC.doc, 14)} CNIC ${esc(f.name || '')}</button>`).join('')}</div>
          <p class="admin-sub">Check the name matches the member's account and the CNIC is genuine and readable.</p>
          <div class="vfa-act"><input class="gwa-note vfa-note-in" placeholder="Reason (required to reject)" maxlength="600" aria-label="Note"><button type="button" class="button button-primary" data-vfa="id-approve" data-id="${esc(c.user_id)}">${DI(DIC.check, 15)} Identity verified</button><button type="button" class="button button-outline" data-vfa="id-reject" data-id="${esc(c.user_id)}">Reject</button></div></div>`).join('') : '<div class="admin-empty sm">No identity checks waiting.</div>'}
      </section>
      <section class="gwa-sec"><h3>Recent decisions</h3>${done.length ? `<table class="gw-table"><thead><tr><th>Property</th><th>Owner</th><th>Result</th><th>Date</th></tr></thead><tbody>${done.map((v) => `<tr><td>${esc(v.title || '')}<br><small>${esc(v.ref || '')}</small></td><td>${esc(v.owner || '')}</td><td>${esc(stl[v.status] || v.status)}${v.admin_note ? `<br><small>${esc(v.admin_note)}</small>` : ''}${v.status === 'verified' ? `<br><button type="button" class="link-button" data-vr="edit" data-id="${esc(v.listing_id)}">Report notes</button>` : ''}</td><td>${esc(fmtDay(v.decided_at || v.submitted_at))}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">Nothing yet.</div>'}</section>
    </div>`;
  }
  async function vfAdminLoad() {
    if (vf.adminLoading) return; vf.adminLoading = true;
    vf.loadedAt = Date.now();
    try { vf.admin = (await VF.adminList()) || { listings: [], identity: [] }; } catch (err) { vf.admin = { error: err.message }; }
    vf.adminLoading = false;
    if (admin.el && !admin.el.hidden) { if (admin.tab === 'verify') { const body = ($('.ax-body', admin.el) || $('.admin-content', admin.el)); const y = admin.el.scrollTop; if (body) {
        // keep what the admin has already ticked or typed when live updates arrive
        const keep = {}; $$('.vfa-req', body).forEach((r) => { const k = r.dataset.lid || r.dataset.uid; keep[k] = { ck: $$('[data-ck]', r).filter((c) => c.checked).map((c) => c.dataset.ck), note: ($('.vfa-note-in', r) || {}).value || '', reason: ($('.vfa-reason', r) || {}).value || '', rf: vrReadFields(r) }; });
        const active = document.activeElement && body.contains(document.activeElement) ? document.activeElement : null; const activeSel = active && active.closest('.vfa-req') ? [(active.closest('.vfa-req').dataset.lid || active.closest('.vfa-req').dataset.uid), active.className] : null;
        body.innerHTML = vfAdminHTML(); admin.el.scrollTop = y;
        $$('.vfa-req', body).forEach((r) => { const k = keep[r.dataset.lid || r.dataset.uid]; if (!k) return; $$('[data-ck]', r).forEach((c) => { c.checked = k.ck.includes(c.dataset.ck); }); if ($('.vfa-note-in', r)) $('.vfa-note-in', r).value = k.note; if ($('.vfa-reason', r)) $('.vfa-reason', r).value = k.reason; $$('[data-rf]', r).forEach((t) => { if (k.rf && k.rf[t.dataset.rf] != null) t.value = k.rf[t.dataset.rf]; }); });
        if (activeSel) { const r = $$('.vfa-req', body).find((x) => (x.dataset.lid || x.dataset.uid) === activeSel[0]); const el = r && r.getElementsByClassName(activeSel[1].split(' ').pop())[0]; if (el) el.focus(); }
      } } const cnt = $('[data-tab="verify"] .admin-count', admin.el); if (cnt) cnt.textContent = vfPendingCount(); }
  }

  // ---------- Clicks ----------
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vf]');
    if (b) {
      const a = b.dataset.vf;
      if (a === 'apply') { e.preventDefault(); openVerify(b.dataset.id); }
      else if (a === 'only') { fx.vmode = fx.vmode === 'verified' ? 'all' : 'verified'; renderGrid(); }
      return;
    }
    const x = e.target.closest('[data-vfa]'); if (!x) return; const a = x.dataset.vfa;
    if (a === 'reload') { vf.admin = null; vfAdminLoad(); }
    else if (a === 'view') { if (byId(x.dataset.id)) openDetails(x.dataset.id); else toast('This listing is not loaded.'); }
    else if (a === 'file') { const w = window.open('', '_blank'); try { const u = await VF.fileUrl(x.dataset.path); if (w) w.location = u; else location.assign(u); } catch (err) { if (w) w.close(); toast(err.message); } }
    else if (a === 'idfile') { const w = window.open('', '_blank'); try { const u = await PF.idFileUrl(x.dataset.path); if (w) w.location = u; else location.assign(u); } catch (err) { if (w) w.close(); toast(err.message); } }
    else if (a === 'id-approve' || a === 'id-reject') { const row = x.closest('.vfa-req'); const note = $('.vfa-note-in', row).value.trim(); const done = busy(x, '…'); try { await PF.decideIdentity(x.dataset.id, a === 'id-approve', note); toast('Saved — the member has been notified.'); vf.admin = null; vfAdminLoad(); await pfLoad(); } catch (err) { done(); toast(err.message); } }
    else if (a === 'approve' || a === 'reject') {
      const row = x.closest('.vfa-req'); const note = $('.vfa-note-in', row).value.trim();
      if (a === 'reject' && note.length < 3) { toast('Write a short reason for the owner.'); $('.vfa-note-in', row).focus(); return; }
      const checks = $$('[data-ck]', row).map((c) => ({ key: c.dataset.ck, label: c.dataset.label, result: c.checked ? 'ok' : 'not_checked' }));
      if (a === 'approve' && !checks.some((c) => c.result === 'ok')) { toast('Tick what you checked — buyers will see it.'); return; }
      const reason = $('.vfa-reason', row) ? $('.vfa-reason', row).value.trim() : '';
      const done = busy(x, '…');
      try { await VF.decide(x.dataset.id, a === 'approve', note, checks, reason); if (a === 'approve') await vrSaveReport(x.dataset.id, vrReadFields(row)); toast(a === 'approve' ? 'Approved — the RAQBO Verified badge is now on the listing.' : 'Rejected — the owner has been notified.'); vf.admin = null; vfAdminLoad(); await gwLoadPub(); renderGrid(); }
      catch (err) { done(); toast(err.message); }
    }
  });

