  /* =====================================================================
     Client review v3 (Phase C): RAQBO Property Verification Report with a
     unique number and QR code, public #verify/<no> check, and the extended
     Property Passport (land-record references, location and photo history,
     transactions through RAQBO, public summary vs confidential documents).
     Supabase: update_19_reports.sql · Demo mode: this browser only
     ===================================================================== */
  var VR_LEVEL = { identity: 'Identity Verified', documents: 'Documents Reviewed', legal: 'Enhanced Property Verification' };
  const vrLevel = (k) => VR_LEVEL[k] || VR_LEVEL.documents;
  const vrSetupMsg = 'Verification reports are being set up. (Admin: run update_19_reports.sql in Supabase.)';
  const vrUrl = (no) => `${location.origin}${location.pathname}#verify/${encodeURIComponent(no)}`;
  const vrSupabase = (sb) => {
    const q = async (p, msg) => { const { data, error } = await p; if (error) throw new Error(/could not find the function|does not exist|schema cache/i.test(error.message || '') ? vrSetupMsg : (error.message || msg)); return data; };
    return {
      check: (no) => q(sb.rpc('verify_report', { p_no: no }), 'Could not check this report.'),
      passport: (id) => q(sb.rpc('passport_data', { p_listing: id }), 'Could not load the passport.'),
      setReport: (id, f) => q(sb.rpc('admin_set_verification_report', { p_listing: id, p_not_examined: f.not_examined || '', p_concerns: f.concerns || '', p_limitations: f.limitations || '' }), 'Could not save the report.'),
      setPrivate: (id, refs, note) => q(sb.rpc('set_property_private', { p_listing: id, p_land_refs: refs || '', p_ownership_note: note || '' }), 'Could not save.')
    };
  };
  // Demo: report numbers are given out in this browser the first time a verified check is seen
  function vrDemoSync() {
    const d = store.get('verif', {}); const reps = store.get('vr.reports', {}); let seq = store.get('vr.seq', 0); let dirty = false;
    Object.values(d).forEach((v) => {
      if (v.status === 'verified' && !v.report_no) { seq += 1; v.report_no = `RQ-VR-${new Date(v.decided_at || Date.now()).getFullYear()}-${String(seq).padStart(6, '0')}`; dirty = true; }
      if (v.status === 'verified' && v.report_no) { const r = reps[v.report_no] || {}; reps[v.report_no] = { ...r, report_no: v.report_no, listing_id: v.listing_id, level: v.level || 'documents', checks: v.checks || [], not_examined: v.not_examined || '', concerns: v.concerns || '', limitations: v.limitations || '', issued_at: r.issued_at || v.decided_at || new Date().toISOString(), withdrawn_at: null }; }
      if (v.status !== 'verified' && v.report_no && reps[v.report_no] && !reps[v.report_no].withdrawn_at) { reps[v.report_no].withdrawn_at = new Date().toISOString(); reps[v.report_no].withdrawn_reason = v.status === 'expired' ? 'Key property details changed after the check' : 'Verification withdrawn'; }
    });
    if (dirty) { store.set('verif', d); store.set('vr.seq', seq); } store.set('vr.reports', reps); return { d, reps };
  }
  const vrLocal = {
    async check(no) {
      const { d, reps } = vrDemoSync(); const r = reps[String(no || '').trim().toUpperCase()]; if (!r) return null; const l = byId(r.listing_id) || {}; const v = d[r.listing_id];
      return { ...r, current: !r.withdrawn_at && !!v && v.status === 'verified' && v.report_no === r.report_no, listing: { id: l.id, ref: l.ref, title: l.title, city: l.city, area: l.area, size: l.size, size_unit: l.unit, type: l.type, published: l.status === 'published' } };
    },
    async passport(id) {
      const { d, reps } = vrDemoSync(); const l = byId(id); if (!l) return null; const me = db.session && db.session.userId; const allowed = !!(me && (l.ownerId === me || db.isAdmin)); const v = d[id]; const priv = store.get('vr.private', {})[id];
      const tx = []; if (l.availability === 'sold') tx.push({ kind: l.saleMode === 'auction' ? 'auction' : 'quicksell', at: l.updatedAt || l.createdAt, text: 'Marked as sold by the owner' });
      return { property_id: l.ref, listed_at: l.createdAt, location_history: store.get('vr.changes', {})[id] || [], photo_history: (l.photos || []).length ? [{ day: l.createdAt, photos: l.photos.length }] : [], reports: Object.values(reps).filter((r) => r.listing_id === id).sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at))), transactions: tx,
        report: v && v.status === 'verified' ? { report_no: v.report_no, level: v.level || 'documents', checks: v.checks || [], not_examined: v.not_examined || '', concerns: v.concerns || '', limitations: v.limitations || '', issued_at: v.decided_at } : null,
        land_refs_on_file: !!(priv && priv.land_refs), private: allowed ? (priv || null) : null, documents: allowed && v ? v.documents : null, can_see_private: allowed };
    },
    async setReport(id, f) { const d = store.get('verif', {}); const v = d[id]; if (!v) throw new Error('No verification for this property.'); Object.assign(v, { not_examined: (f.not_examined || '').slice(0, 2000), concerns: (f.concerns || '').slice(0, 2000), limitations: (f.limitations || '').slice(0, 2000) }); store.set('verif', d); return vrDemoSync().d[id].report_no; },
    async setPrivate(id, refs, note) { const l = byId(id); const me = db.session && db.session.userId; if (!l || !me || l.ownerId !== me) throw new Error('You can only update your own property.'); const p = store.get('vr.private', {}); p[id] = { land_refs: String(refs || '').trim().slice(0, 600), ownership_note: String(note || '').trim().slice(0, 600) }; store.set('vr.private', p); }
  };
  const VR = SB ? vrSupabase(SB) : vrLocal;
  // Called by the admin's Approve button (verify.js) with the three report boxes
  async function vrSaveReport(id, f) { if (!f || !(f.not_examined || f.concerns || f.limitations)) { if (!SB) vrDemoSync(); return; } try { await VR.setReport(id, f); } catch (err) { toast(err.message); } }

  // ---------- QR code (qrcodejs, loaded only when a report is opened) ----------
  let vrQrP = null;
  function vrQrLib() {
    if (window.QRCode) return Promise.resolve(window.QRCode);
    if (!vrQrP) vrQrP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    // The browser checks the file against this fingerprint and refuses to run
    // it if even one byte differs, so a tampered copy cannot reach a visitor.
    s.integrity = 'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU'; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; s.onload = () => (window.QRCode ? res(window.QRCode) : rej(new Error('qr'))); s.onerror = () => { vrQrP = null; rej(new Error('qr')); }; document.head.append(s); setTimeout(() => rej(new Error('qr')), 6000); });
    return vrQrP;
  }
  async function vrQrInto(box, text) {
    try { const Q = await vrQrLib(); const tmp = document.createElement('div'); new Q(tmp, { text, width: 132, height: 132, correctLevel: Q.CorrectLevel.M }); await new Promise((r) => setTimeout(r, 30)); const c = tmp.querySelector('canvas'); const src = c ? c.toDataURL('image/png') : (tmp.querySelector('img') || {}).src; if (src) { box.innerHTML = `<img src="${src}" width="132" height="132" alt="QR code to check this report on raqbo.com">`; box.classList.add('on'); } }
    catch { box.innerHTML = `<small>Scan unavailable — check at<br><b>${esc(text.replace(/^https?:\/\//, ''))}</b></small>`; }
  }

  // ---------- The report itself ----------
  function vrReportHTML(r, l, opts = {}) {
    const ok = (r.checks || []).filter((c) => c.result === 'ok'); const na = (r.checks || []).filter((c) => c.result !== 'ok');
    const status = opts.status || (r.withdrawn_at ? ['warn', 'No longer valid — ' + (r.withdrawn_reason || 'withdrawn')] : ['ok', 'Valid']);
    const para = (t, empty) => (t && String(t).trim() ? esc(t).replace(/\n/g, '<br>') : `<em>${esc(empty)}</em>`);
    return `<div class="vr" id="vr-print">
      <div class="vr-head"><div><div class="eyebrow"><span></span> RAQBO PROPERTY VERIFICATION REPORT</div><h2>${esc(vrLevel(r.level))}</h2><p>Report no. <b class="vr-no">${esc(r.report_no)}</b> · issued ${esc(fmtDay(r.issued_at))}</p></div>
        <div class="vr-qr" data-vr-qr>${DI(DIC.shield, 22)}</div></div>
      <div class="vr-status vr-${status[0]}">${DI(status[0] === 'ok' ? DIC.check : DIC.alert, 16)} <b>Status: ${esc(status[1])}</b>${r.withdrawn_at ? ' · ' + esc(fmtDay(r.withdrawn_at)) : ''}</div>
      <section><h3>Property</h3><dl class="vr-dl"><div><dt>Property ID</dt><dd>${esc((l && l.ref) || '—')}</dd></div><div><dt>Property</dt><dd>${esc((l && l.title) || '—')}</dd></div><div><dt>Location</dt><dd>${esc([l && l.area, l && l.city].filter(Boolean).join(', ') || '—')}</dd></div><div><dt>Verification level</dt><dd>${esc(vrLevel(r.level))}</dd></div></dl></section>
      <section><h3>What RAQBO examined</h3>${ok.length ? `<ul class="pass-checks">${ok.map((c) => `<li class="ok">${DI(DIC.check, 14)} ${esc(c.label)}</li>`).join('')}</ul>` : '<p class="pass-note">No completed checks recorded.</p>'}</section>
      <section><h3>What was not examined</h3>${na.length ? `<ul class="pass-checks">${na.map((c) => `<li class="na">${DI(DIC.info, 14)} ${esc(c.label)}</li>`).join('')}</ul>` : ''}<p class="vr-p">${para(r.not_examined, na.length ? '' : 'Nothing else recorded.')}</p></section>
      <section><h3>Concerns found</h3><p class="vr-p">${para(r.concerns, 'No concerns were recorded.')}</p></section>
      <section><h3>Limitations</h3><p class="vr-p">${para(r.limitations, 'This review relied on the documents supplied to RAQBO on the date above.')}</p></section>
      <p class="pass-legal">This report records what RAQBO examined on the date shown. It is <b>not a guarantee of clear legal title</b> and is not a government record. Scan the QR code or visit raqbo.com/#verify/${esc(r.report_no)} to confirm the report is genuine and still valid. Always obtain independent legal advice and check the official records before buying.</p>
    </div>`;
  }
  async function vrOpenReport(listingId) {
    const l = byId(listingId); const card = openModal('<div class="gw-loading">Loading the verification report…</div>', { wide: true, label: 'Verification report' }); card.classList.add('pass-card');
    let p = null; try { p = await VR.passport(listingId); } catch (err) { setBody(card, `<div class="admin-empty">${esc(err.message)}</div>`); return; }
    const r = p && p.report; if (!r || !r.report_no) { setBody(card, '<div class="admin-empty">This property has no current RAQBO verification report.</div>'); return; }
    setBody(card, vrReportHTML(r, l) + `<div class="button-row pass-actions"><button type="button" class="button button-primary" data-vr="print">${DI(GI.print, 16)} Download / print report</button><button type="button" class="button button-ghost" data-vr="copy" data-no="${esc(r.report_no)}">Copy check link</button></div>`);
    vrQrInto($('[data-vr-qr]', card), vrUrl(r.report_no));
  }
  // Public check page: #verify/<report no>
  async function vrOpenCheck(no) {
    closeNavMenus(); const card = openModal('<div class="gw-loading">Checking the report number…</div>', { wide: true, label: 'Check a verification report' }); card.classList.add('pass-card');
    const form = (msg) => `<div class="vr-check"><div class="eyebrow"><span></span> CHECK A RAQBO REPORT</div><h2>Is this verification report genuine?</h2><p>${msg}</p><form class="vr-check-f" data-vr-form><input name="no" required maxlength="30" placeholder="RQ-VR-2026-000123" aria-label="Report number" value="${esc(no || '')}"><button class="button button-primary" type="submit">Check</button></form></div>`;
    if (!no) { setBody(card, form('Type the report number printed on the report, or scan its QR code.')); return; }
    let r = null; try { r = await VR.check(no); } catch (err) { setBody(card, form(esc(err.message))); return; }
    if (!r) { setBody(card, form(`<b class="vr-bad">${DI(DIC.alert, 15)} No RAQBO report has the number “${esc(no)}”.</b> Check the number carefully. A report that cannot be found here was not issued by RAQBO.`)); return; }
    const l = r.listing || {}; const status = r.current ? ['ok', 'Genuine and valid'] : ['warn', 'Genuine, but no longer valid' + (r.withdrawn_reason ? ' — ' + r.withdrawn_reason : '')];
    setBody(card, vrReportHTML(r, { ref: l.ref, title: l.title, area: l.area, city: l.city }, { status }) + `<div class="button-row pass-actions">${l.published && byId(l.id) ? `<button type="button" class="button button-primary" data-vr="open-listing" data-id="${esc(l.id)}">View the property</button>` : ''}<button type="button" class="button button-ghost" data-vr="print">${DI(GI.print, 16)} Print</button></div>`);
    vrQrInto($('[data-vr-qr]', card), vrUrl(r.report_no));
  }
  function vrPrint() {
    const el = $('#vr-print'); if (!el) return; const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(f); const d = f.contentDocument;
    d.open(); const ST = ['<sty', 'le>'].join(''); const ET = ['</sty', 'le></he', 'ad>'].join(''); d.write(`<!doctype html><html><head><meta charset="utf-8"><title>RAQBO Verification Report</title>${ST}${css}\nbody{background:#fff!important;padding:16mm}.vr{max-width:none}${ET}<body>${el.outerHTML}</body></html>`); d.close();
    setTimeout(() => { try { f.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => f.remove(), 3000); }, 300);
  }

  // ---------- Passport additions (called by openPassport in core.js) ----------
  async function vrPassportExtend(card, l) {
    const anchor = $('.pass-legal', card); if (!anchor) return;
    let p = null; try { p = await VR.passport(l.id); } catch { return; } if (!p || !document.body.contains(anchor)) return;
    const FIELD = { city: 'City', area: 'Area / society', size: 'Size', type: 'Property type' };
    const sec = document.createElement('div'); sec.className = 'vr-pass'; let n = 7; const N = () => (n += 1) + '. ';
    sec.innerHTML = `
      ${p.report && p.report.report_no ? `<section><h3>${N()}Verification report</h3><div class="vr-mini"><div><b>${esc(vrLevel(p.report.level))}</b><small>Report no. ${esc(p.report.report_no)} · ${esc(fmtDay(p.report.issued_at))}</small></div><button type="button" class="button button-outline" data-vr="report" data-id="${esc(l.id)}">Open the report</button></div></section>` : ''}
      <section><h3>${N()}Land-record references <small class="pass-conf">confidential</small></h3>${p.can_see_private ? `<form class="vr-priv" data-vr-priv="${esc(l.id)}"><label>Khasra / khewat / khatoni / fard / plot numbers<textarea name="refs" rows="2" maxlength="600" placeholder="e.g. Khasra 1234/5, Khewat 88, Plot 12-B">${esc((p.private && p.private.land_refs) || '')}</textarea></label><label>Ownership note<textarea name="note" rows="2" maxlength="600" placeholder="e.g. Inherited in 2019, mutation completed">${esc((p.private && p.private.ownership_note) || '')}</textarea></label><div class="vr-priv-row"><small>${DI(DIC.lock || DIC.shield, 13)} Confidential — only you and RAQBO can see these.</small><button type="submit" class="button button-outline">Save</button></div></form>` : `<p class="pass-note">${p.land_refs_on_file ? `${DI(DIC.check, 13)} Land-record references are on file with RAQBO. They are kept confidential and shared only in a supervised transaction.` : 'No land-record references have been added yet.'}</p>`}</section>
      <section><h3>${N()}Location history</h3>${(p.location_history || []).length ? `<ol class="pass-hist">${p.location_history.map((c) => `<li><b>${esc(fmtDay(c.at))}</b> ${esc(FIELD[c.field] || c.field)} changed from “${esc(c.from || '—')}” to “${esc(c.to || '—')}”</li>`).join('')}</ol>` : `<p class="pass-note">No changes to the location, size or type since it was listed${p.listed_at ? ' on ' + esc(fmtDay(p.listed_at)) : ''}.</p>`}</section>
      <section><h3>${N()}Photo history</h3>${(p.photo_history || []).length ? `<ol class="pass-hist">${p.photo_history.map((h) => `<li><b>${esc(fmtDay(h.day))}</b> ${esc(h.photos)} photo${h.photos == 1 ? '' : 's'} added</li>`).join('')}</ol>` : '<p class="pass-note">No photos uploaded yet.</p>'}</section>
      <section><h3>${N()}Transactions through RAQBO</h3>${(p.transactions || []).length ? `<ol class="pass-hist">${p.transactions.map((t) => `<li><b>${esc(fmtDay(t.at))}</b> ${esc(t.text)}${t.amount ? ' · ' + esc(fmtPrice(t.amount)) : ''}</li>`).join('')}</ol>` : '<p class="pass-note">No sales or auctions through RAQBO recorded for this property.</p>'}</section>
      ${(p.reports || []).length > 1 || (p.reports || []).some((r) => r.withdrawn_at) ? `<section><h3>${N()}Earlier reports</h3><ol class="pass-hist">${p.reports.map((r) => `<li><b>${esc(fmtDay(r.issued_at))}</b> ${esc(r.report_no)} · ${esc(vrLevel(r.level))}${r.withdrawn_at ? ' — no longer valid' : ' — current'}</li>`).join('')}</ol></section>` : ''}
      <section><h3>${N()}Public summary &amp; confidential documents</h3><p class="pass-note">Sections 1–5 and the histories are the <b>public summary</b> anyone can see. Ownership documents, CNIC copies and land-record numbers are <b>confidential</b>: ${p.can_see_private ? `you can see ${(p.documents || []).length} document${(p.documents || []).length === 1 ? '' : 's'} you supplied; buyers cannot.` : 'they are seen only by the owner and RAQBO.'}</p></section>`;
    anchor.before(sec);
  }

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-vr-priv]'); const c = e.target.closest('[data-vr-form]');
    if (f) { e.preventDefault(); const btn = $('button[type=submit]', f); const done = busy(btn, '…'); try { await VR.setPrivate(f.dataset.vrPriv, f.refs.value, f.note.value); done(); toast('Saved — kept confidential.'); } catch (err) { done(); toast(err.message); } }
    else if (c) { e.preventDefault(); const no = c.no.value.trim().toUpperCase(); closeModal(); location.hash = 'verify/' + no; }
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vr]'); if (!b) return; const a = b.dataset.vr;
    if (a === 'report') vrOpenReport(b.dataset.id);
    else if (a === 'print') vrPrint();
    else if (a === 'copy') { try { await navigator.clipboard.writeText(vrUrl(b.dataset.no)); toast('Check link copied.'); } catch { toast(vrUrl(b.dataset.no)); } }
    else if (a === 'open-listing') { closeModal(); openDetails(b.dataset.id); }
    else if (a === 'check') vrOpenCheck('');
    else if (a === 'edit') vrEditReport(b.dataset.id);
  });
  // Admin: edit the report notes after approval
  async function vrEditReport(id) {
    const card = openModal('<div class="gw-loading">Loading…</div>', { label: 'Edit verification report' }); let p = null; try { p = await VR.passport(id); } catch (err) { setBody(card, `<div class="admin-empty">${esc(err.message)}</div>`); return; }
    const r = p && p.report; if (!r) { setBody(card, '<div class="admin-empty">No current report for this property.</div>'); return; }
    setBody(card, `<form class="vr-edit" data-vr-edit="${esc(id)}"><h2>Report ${esc(r.report_no)}</h2><p class="admin-sub">${esc(vrLevel(r.level))} · buyers and anyone checking the number see these notes.</p>${vrRepFields(r)}<div class="button-row"><button class="button button-primary" type="submit">Save report</button><button type="button" class="button button-ghost" data-vr="report" data-id="${esc(id)}">Preview</button></div></form>`);
  }
  function vrRepFields(r = {}) { return `<fieldset class="vfa-rep"><legend>Verification report (shown to buyers)</legend><label>Not examined<textarea data-rf="not_examined" rows="2" maxlength="2000" placeholder="e.g. Original fard not seen; site not visited">${esc(r.not_examined || '')}</textarea></label><label>Concerns found<textarea data-rf="concerns" rows="2" maxlength="2000" placeholder="Leave empty if none">${esc(r.concerns || '')}</textarea></label><label>Limitations<textarea data-rf="limitations" rows="2" maxlength="2000" placeholder="e.g. Copies only; based on documents supplied by the owner">${esc(r.limitations || '')}</textarea></label></fieldset>`; }
  function vrReadFields(root) { const o = {}; $$('[data-rf]', root).forEach((t) => { o[t.dataset.rf] = t.value.trim(); }); return o; }
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-vr-edit]'); if (!f) return; e.preventDefault(); const done = busy($('button[type=submit]', f), '…');
    try { await VR.setReport(f.dataset.vrEdit, vrReadFields(f)); done(); toast('Report saved.'); closeModal(); } catch (err) { done(); toast(err.message); }
  });
  function vrRoute() { const m = /^#verify\/?(.*)$/.exec(location.hash); if (m) vrOpenCheck(decodeURIComponent(m[1] || '').trim().toUpperCase()); }
  addEventListener('hashchange', vrRoute);
  if (/^#verify/.test(location.hash)) setTimeout(vrRoute, 700);

