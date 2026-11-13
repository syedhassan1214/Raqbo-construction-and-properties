  // =====================================================================
  const mf = { poly: null, drawing: false, pts: [], tmp: null, shape: null, editId: null, pendingOwn: null, watch: new Set(), blocked: {}, reports: null, reportsAt: 0 };
  const mfT = (t) => (i18n.lang === 'ur' && UR[t]) || t;   // Urdu for text inside areas the page translator skips
  const MF_COMM = ['commercial_kind', 'floor_no', 'building_name', 'rent_period', 'security_deposit', 'advance_rent_months', 'lease_months', 'escalation_pct', 'available_from', 'maintenance_charges', 'parking_spaces', 'monthly_income'];
  const mfToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);   // the local date, not UTC
  const MF_OWN = { sole: 'Sole owner', joint: 'Joint ownership', attorney: 'Power of attorney', company: 'Company / firm' };
  function mfCols(cols) {
    let c = cols;
    if (!db.noV27c) c = c.replace('review_note,', 'review_note, ' + MF_COMM.join(', ') + ',');
    if (!db.noV32) c = c.replace('review_note,', 'review_note, ownership_type, co_owners, all_owners_consent,');
    return c;
  }
  function mfColsFail(error) {
    const m = (error && error.message) || '';
    if (!db.noV32 && /ownership_type|co_owners|all_owners_consent/i.test(m)) { db.noV32 = true; return true; }   // run update_32
    if (!db.noV27c && new RegExp(MF_COMM.join('|'), 'i').test(m)) { db.noV27c = true; return true; }      // run update_27
    return false;
  }
  function mfMap(r) {
    const o = {}; MF_COMM.forEach((k) => { if (r[k] != null && r[k] !== '') o[k] = r[k]; });
    if (o.commercial_kind) o.commercialKind = o.commercial_kind;
    if (r.ownership_type) { o.ownershipType = r.ownership_type; o.coOwners = Array.isArray(r.co_owners) ? r.co_owners : []; o.ownersConsent = !!r.all_owners_consent; }
    return o;
  }

  // ---------- Data: live (Supabase) and demo (this browser) ----------
  const MF = SB ? {
    async saveExtra(id, row) { if (!Object.keys(row).length) return; const { error } = await SB.from('listings').update(row).eq('id', id); if (error) throw new Error(/ownership_type|co_owners/.test(error.message) ? 'Ownership details need the latest database update (update_32).' : error.message); },
    async blocked() { const { data, error } = await SB.rpc('my_blocked_chats'); if (error) return {}; const o = {}; (data || []).forEach((r) => { o[r.conversation_id] = r.by_me ? 'me' : 'them'; }); return o; },
    async block(cid, on) { const { error } = await SB.rpc('block_chat_user', { p_conv: cid, p_block: on }); if (error) throw new Error(error.message); },
    async report(cid, reason, details) { const { error } = await SB.rpc('report_chat', { p_conv: cid, p_reason: reason, p_details: details }); if (error) throw new Error(error.message); },
    async reports() { const { data, error } = await SB.from('chat_reports').select('*, reporter:profiles!chat_reports_reporter_id_fkey(full_name), reported:profiles!chat_reports_reported_id_fkey(full_name)').order('created_at', { ascending: false }).limit(200); if (error) throw new Error(/does not exist|schema cache/.test(error.message) ? 'Run update_32_missing_features.sql in Supabase to switch on chat reports.' : error.message); return (data || []).map((r) => ({ ...r, reporter_name: (r.reporter && r.reporter.full_name) || 'Member', reported_name: (r.reported && r.reported.full_name) || 'Member' })); },
    async decide(id, status, note, block) { const { error } = await SB.rpc('admin_decide_chat_report', { p_id: id, p_status: status, p_note: note, p_block: !!block }); if (error) throw new Error(error.message); },
    async assessments(lid) { const { data, error } = await SB.from('listing_assessments').select('*').eq('listing_id', lid).order('assessed_on', { ascending: false }); if (error) return []; return data || []; },
    async addAssessment(a) { const { error } = await SB.rpc('admin_add_assessment', { p_listing: a.listing_id, p_kind: a.kind, p_name: a.reviewer_name, p_reg: a.reviewer_reg, p_on: a.assessed_on, p_outcome: a.outcome, p_findings: a.findings, p_limits: a.limitations }); if (error) throw new Error(/check constraint/.test(error.message) ? 'Check the details: an advocate’s enrolment number is required, findings need at least 10 characters and the date cannot be in the future.' : error.message); },
    async withdrawAssessment(id, reason) { const { error } = await SB.rpc('admin_withdraw_assessment', { p_id: id, p_reason: reason }); if (error) throw new Error(error.message); },
    async watches() { const { data, error } = await SB.from('product_watch').select('product_id'); if (error) return []; return (data || []).map((r) => r.product_id); },
    async watch(pid, on) { const q = on ? SB.from('product_watch').insert({ product_id: pid }) : SB.from('product_watch').delete().eq('product_id', pid).eq('user_id', lvMe()); const { error } = await q; if (error && !/duplicate/.test(error.message)) throw new Error(error.message); }
  } : {
    async saveExtra(id, row) { const l = byId(id); if (!l) return; Object.assign(l, row, mfMap(row)); store.set('listings', db.listings); },
    async blocked() { const o = {}; const me = lvMe(); (store.get('mf_blocks', []) || []).forEach((b) => { if (b.by === me) o[b.conv] = 'me'; else if (b.other === me && !o[b.conv]) o[b.conv] = 'them'; }); return o; },
    async block(cid, on) { const c = lv.convs.find((x) => x.id === cid); if (!c || !c.other_id) throw new Error('The RAQBO team cannot be blocked. Use Report instead.'); const me = lvMe(); const other = c.starter_id === me ? c.other_id : c.starter_id; let b = (store.get('mf_blocks', []) || []).filter((x) => !(x.by === me && x.conv === cid)); if (on) b.push({ by: me, other, conv: cid }); store.set('mf_blocks', b); },
    async report(cid, reason, details) {
      if (reason === 'other' && String(details || '').trim().length < 5) throw new Error('Tell RAQBO briefly what happened.');
      const c = lv.convs.find((x) => x.id === cid) || {}; const me = lvMe(); const msgs = (await LV.msgs(cid)).slice(-30);
      const all = store.get('mf_chatreports', []) || []; if (all.filter((r) => r.reporter_id === me && Date.now() - Date.parse(r.created_at) < 864e5).length >= 5) throw new Error('You have sent several reports today. RAQBO will review them first.');
      all.unshift({ id: Date.now(), conversation_id: cid, reporter_id: me, reporter_name: (db.session && db.session.name) || 'Member', reported_name: typeof lvOther === 'function' ? lvOther(c) : 'Member', reason, details: String(details || '').trim(), snapshot: msgs.map((m) => ({ from: m.sender_id === me ? 'reporter' : 'other', at: m.created_at, body: m.body })), status: 'open', admin_note: '', created_at: new Date().toISOString() });
      store.set('mf_chatreports', all); lvLocal.notifyAdmins('message', 'Chat reported: ' + reason.replace(/_/g, ' '), c.subject || '', '#admin/chatreports');
    },
    async reports() { return store.get('mf_chatreports', []) || []; },
    async decide(id, status, note) { const all = store.get('mf_chatreports', []) || []; const r = all.find((x) => x.id === id); if (!r) throw new Error('Report not found.'); Object.assign(r, { status, admin_note: note, decided_at: new Date().toISOString() }); store.set('mf_chatreports', all); lvLocal.notify(r.reporter_id, 'message', 'Your chat report was reviewed', status === 'actioned' ? 'RAQBO took action. Thank you for reporting.' : 'RAQBO reviewed it and found no breach of the rules.', '#messages'); },
    async assessments(lid) { return (store.get('mf_assess', []) || []).filter((a) => a.listing_id === lid).sort((a, b) => String(b.assessed_on).localeCompare(String(a.assessed_on))); },
    async addAssessment(a) {
      if (a.kind === 'legal_opinion' && String(a.reviewer_reg || '').trim().length < 3) throw new Error('Enter the advocate’s bar council enrolment number.');
      if (String(a.reviewer_name || '').trim().length < 3) throw new Error('Enter the reviewer’s name.');
      if (String(a.findings || '').trim().length < 10) throw new Error('Write the findings (at least 10 characters).');
      if (!a.assessed_on || a.assessed_on > mfToday()) throw new Error('Choose the date it was done (not in the future).');
      const all = store.get('mf_assess', []) || []; all.push({ ...a, id: Date.now(), created_at: new Date().toISOString(), withdrawn_at: null }); store.set('mf_assess', all);
      const l = byId(a.listing_id); if (l && l.ownerId) lvLocal.notify(l.ownerId, 'listing', a.kind === 'legal_opinion' ? 'Legal opinion added to your Property Passport' : 'Physical inspection added to your Property Passport', l.title, '#property/' + l.id);
    },
    async withdrawAssessment(id, reason) { if (String(reason || '').trim().length < 5) throw new Error('Give a reason for withdrawing it.'); const all = store.get('mf_assess', []) || []; const a = all.find((x) => x.id === id); if (a) { a.withdrawn_at = new Date().toISOString(); a.withdrawn_reason = reason; } store.set('mf_assess', all); },
    async watches() { const me = lvMe(); return (store.get('mf_watch', []) || []).filter((w) => w.user === me).map((w) => w.pid); },
    async watch(pid, on) { const me = lvMe(); let all = (store.get('mf_watch', []) || []).filter((w) => !(w.user === me && w.pid === pid)); if (on) all.push({ user: me, pid }); store.set('mf_watch', all); }
  };

  // ---------- 1. Commercial lease details + ownership: actually save them ----------
  document.addEventListener('submit', (e) => {
    const f = e.target; if (!f.matches || !f.matches('form') || !f.querySelector('[name=sizeUnit]') || !f.querySelector('[name=consent]')) return;
    const box = $('.rm-cfields', f); if (!box || box.hidden) rm.pendingCommercial = null;
    const own = $('.mf-own', f); if (!own) { mf.pendingOwn = null; return; }
    const type = ($('[name=ownership_type]', own) || {}).value || 'sole';
    const co = $$('.mf-co', own).map((r) => ({ name: $('[data-co=name]', r).value.trim(), share: $('[data-co=share]', r).value.trim() })).filter((x) => x.name);
    mf.pendingOwn = { ownership_type: type, co_owners: type === 'sole' ? [] : co.slice(0, 10), all_owners_consent: type === 'sole' ? false : !!($('[name=all_owners_consent]', own) || {}).checked };
  }, true);
  function mfTakeExtra() {
    const row = {};
    if (rm.pendingCommercial) Object.assign(row, rm.pendingCommercial);
    if (mf.pendingOwn && !db.noV32) Object.assign(row, mf.pendingOwn);
    rm.pendingCommercial = null; mf.pendingOwn = null; return row;
  }
  ['submitListing', 'updateListing'].forEach((k) => {
    const base = backend[k]; if (typeof base !== 'function') return;
    backend[k] = async function () {
      const row = mfTakeExtra(); const data = k === 'submitListing' ? arguments[0] : arguments[1];
      if (!SB && data) Object.assign(data, row, mfMap(row));                 // demo: stored with the listing itself
      const res = await base.apply(this, arguments);
      if (SB) { const id = (res && res.id) || (k === 'updateListing' ? arguments[0] : null);
        if (id && Object.keys(row).length) { try { await MF.saveExtra(id, row); const l = byId(id); if (l) Object.assign(l, row, mfMap(row)); } catch (err) { toast('Listing saved, but some details were not: ' + err.message); } } }
      return res;
    };
  });
  // Ownership block on the listing form, and the commercial box filled in when editing
  { const base = openListingForm; openListingForm = function (editId) { mf.editId = editId || null; return base.apply(this, arguments); }; }
  function mfDecorateListingForm(f) {
    if (f.dataset.mf) return; f.dataset.mf = '1';
    const l = mf.editId ? byId(mf.editId) : null;
    const consent = f.querySelector('[name=consent]'); const anchor = consent && (consent.closest('label') || consent);
    if (anchor && !db.noV32) {
      const t = (l && l.ownershipType) || 'sole'; const co = (l && l.coOwners) || [];
      anchor.insertAdjacentHTML('beforebegin', `<div class="mf-own"><h4>Who owns this property?</h4>
        <label>Ownership<select name="ownership_type">${Object.entries(MF_OWN).map(([k, v]) => `<option value="${k}" ${k === t ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <div data-mf-co ${t === 'sole' ? 'hidden' : ''}><p class="form-hint">Add the other owners (or the principal, for a power of attorney). Names are seen only by RAQBO, never by buyers.</p>
          <div data-mf-co-list>${(co.length ? co : [{ name: '', share: '' }]).map(mfCoRow).join('')}</div>
          <button type="button" class="mf-add" data-mf-co-add>+ Add another owner</button>
          <label class="consent-check"><input type="checkbox" name="all_owners_consent" ${l && l.ownersConsent ? 'checked' : ''}> All owners (or the principal) agree to this property being advertised.</label></div></div>`);
    }
    const typeSel = f.querySelector('[name=type]');
    if (l && typeSel && typeSel.value === 'Commercial' && typeof rmListingFields === 'function') {
      rmListingFields(typeSel); const box = $('.rm-cfields', f);
      if (box) MF_COMM.forEach((k) => { const i = $(`[name=${k}]`, box); if (i && l[k] != null) i.value = l[k]; });
    }
  }
  const mfCoRow = (c) => `<div class="mf-co"><input data-co="name" maxlength="80" placeholder="Owner’s name" value="${esc(c.name || '')}" aria-label="Owner’s name"><input data-co="share" maxlength="20" placeholder="Share e.g. 50%" value="${esc(c.share || '')}" aria-label="Share"><button type="button" data-mf-co-del aria-label="Remove owner">×</button></div>`;
  document.addEventListener('change', (e) => { const s = e.target.closest('.mf-own [name=ownership_type]'); if (s) { const box = $('[data-mf-co]', s.closest('.mf-own')); if (box) box.hidden = s.value === 'sole'; } });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-mf-co-add]')) { const list = $('[data-mf-co-list]', e.target.closest('.mf-own')); if ($$('.mf-co', list).length < 10) list.insertAdjacentHTML('beforeend', mfCoRow({})); return; }
    const d = e.target.closest('[data-mf-co-del]'); if (d) { const list = d.closest('[data-mf-co-list]'); if ($$('.mf-co', list).length > 1) d.closest('.mf-co').remove(); else $$('input', d.closest('.mf-co')).forEach((i) => { i.value = ''; }); }
  });
  new MutationObserver(() => { $$('form').forEach((f) => { if (!f.dataset.mf && f.querySelector('[name=sizeUnit]') && f.querySelector('[name=consent]')) mfDecorateListingForm(f); }); }).observe(document.body, { childList: true, subtree: true });

  // Property page: lease terms (commercial) and how the property is owned
  { const base = openDetails; openDetails = function (id) { const r = base.apply(this, arguments); setTimeout(() => mfDetailExtra(id), 60); return r; }; }
  function mfDetailExtra(id) {
    const l = byId(id); const root = pp && pp.el; if (!l || !root || root.hidden) return;
    const host = $('.pp-keyfacts', root) || $('.pp-desc', root); if (!host || $('.mf-detail', root)) return;
    const rows = [];
    const pk = (n) => esc(fmtPrice(n));
    if (l.security_deposit) rows.push(['Security deposit', pk(l.security_deposit)]);
    if (l.advance_rent_months) rows.push(['Advance rent', `${esc(l.advance_rent_months)} month${l.advance_rent_months == 1 ? '' : 's'}`]);
    if (l.lease_months) rows.push(['Lease period', `${esc(l.lease_months)} months`]);
    if (l.escalation_pct) rows.push(['Yearly increase', `${esc(l.escalation_pct)}%`]);
    if (l.maintenance_charges) rows.push(['Maintenance', pk(l.maintenance_charges) + ' / month']);
    if (l.available_from) rows.push(['Available from', esc(fmtDay(l.available_from))]);
    if (l.floor_no) rows.push(['Floor', esc(l.floor_no)]);
    if (l.building_name) rows.push(['Building', esc(l.building_name)]);
    if (l.parking_spaces) rows.push(['Parking', `${esc(l.parking_spaces)} space${l.parking_spaces == 1 ? '' : 's'}`]);
    let html = '';
    if (rows.length) html += `<section class="pp-section mf-detail"><h3>Lease terms</h3><dl class="pp-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;
    if (l.ownershipType && l.ownershipType !== 'sole') {
      const n = (l.coOwners || []).length;
      html += `<div class="mf-ownline mf-detail">${DI(DIC.users || DIC.user, 18)}<span><b>${esc(MF_OWN[l.ownershipType] || 'Shared ownership')}</b>${l.ownershipType === 'joint' && n ? ` · ${n + 1} owners` : ''}. ${l.ownersConsent ? 'The advertiser declares that all owners agree to this sale or rental.' : 'Ask the advertiser to confirm that every owner agrees before you pay any token money.'} Every owner (or the principal) must sign the sale or rent agreement.</span></div>`;
    }
    if (html) host.insertAdjacentHTML('afterend', html);
  }

  // ---------- 2. Map: draw your own area ----------
  { const base = filtered; filtered = function (skip) { const list = base(skip); if (!mf.poly) return list; return list.filter((l) => l.lat != null && l.lng != null && mfInside([+l.lat, +l.lng], mf.poly)); }; }
  function mfInside(p, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i]; const [yj, xj] = poly[j]; if (((yi > p[0]) !== (yj > p[0])) && (p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
  { const base = showMap; showMap = async function (on) { await base.apply(this, arguments); if (on) mfDrawTools(); }; }
  function mfDrawTools() {
    if (!mv.el || !mv.map || $('.mf-draw', mv.el)) { mfPaintTools(); return; }
    mv.el.insertAdjacentHTML('afterbegin', '<div class="mf-draw" role="toolbar" aria-label="Draw an area"></div>');
    mv.map.on('click', (e) => { if (!mf.drawing) return; mf.pts.push([e.latlng.lat, e.latlng.lng]); mfPreview(); mfPaintTools(); });
    mfPaintTools();
  }
  function mfPaintTools() {
    const t = mv.el && $('.mf-draw', mv.el); if (!t) return;
    t.innerHTML = mf.drawing
      ? `<span>Tap the map to mark the corners of your area (${mf.pts.length} so far)</span><button type="button" data-mf-draw="finish" ${mf.pts.length < 3 ? 'disabled' : ''}>Search this area</button><button type="button" data-mf-draw="cancel">Cancel</button>`
      : mf.poly ? '<button type="button" data-mf-draw="start">Redraw area</button><button type="button" data-mf-draw="clear">Clear area</button>'
        : '<button type="button" data-mf-draw="start">✎ Draw an area</button>';
  }
  function mfPreview() {
    const L = window.L; if (!L || !mv.map) return;
    if (mf.tmp) { mv.map.removeLayer(mf.tmp); mf.tmp = null; }
    if (mf.pts.length) mf.tmp = (mf.pts.length > 2 ? L.polygon(mf.pts, { color: '#c8942f', weight: 2, dashArray: '6 6', fillOpacity: 0.08 }) : L.polyline(mf.pts, { color: '#c8942f', weight: 2, dashArray: '6 6' })).addTo(mv.map);
  }
  function mfSetArea(poly) {
    const L = window.L; if (mf.shape && mv.map) { mv.map.removeLayer(mf.shape); mf.shape = null; }
    mf.poly = poly; if (poly && L && mv.map) mf.shape = L.polygon(poly, { color: '#c8942f', weight: 2, fillOpacity: 0.1 }).addTo(mv.map);
    renderGrid(); if (typeof drawMap === 'function') drawMap(); mfAreaChip(); mfPaintTools();
    if (poly && mf.shape && mv.map) mv.map.fitBounds(mf.shape.getBounds(), { padding: [30, 30] });
  }
  function mfAreaChip() {
    const g = $('#property-grid'); if (!g) return; let c = $('.mf-area-chip');
    if (!mf.poly) { if (c) c.remove(); return; }
    const n = filtered().length; const html = `<span>${DI(DIC.pin, 14)} ${n} ${n === 1 ? 'property' : 'properties'} inside your drawn area</span><button type="button" data-mf-draw="clear">Clear area</button>`;
    if (!c) { g.insertAdjacentHTML('beforebegin', '<div class="mf-area-chip"></div>'); c = $('.mf-area-chip'); } c.innerHTML = html;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mf-draw]'); if (!b) return; const a = b.dataset.mfDraw;
    if (a === 'start') { mf.drawing = true; mf.pts = []; if (mv.map) { mv.map.doubleClickZoom.disable(); mv.el.classList.add('mf-drawing'); } mfPreview(); mfPaintTools(); }
    else if (a === 'cancel') { mf.drawing = false; mf.pts = []; mfPreview(); if (mv.map) mv.map.doubleClickZoom.enable(); mfPaintTools(); }
    else if (a === 'finish') { if (mf.pts.length < 3) return; const poly = mf.pts.slice(); mf.drawing = false; mf.pts = []; mfPreview(); if (mv.map) mv.map.doubleClickZoom.enable(); mfSetArea(poly); const n = filtered().length; toast(n ? `${n} ${n === 1 ? 'property' : 'properties'} inside your area.` : 'No pinned properties inside this area yet. Try a bigger area.'); }
    else if (a === 'clear') { mfSetArea(null); }
  });

  // ---------- 3. Messages: block and report ----------
  { const base = lvOpenThread; lvOpenThread = async function (cid, quiet) { await base.apply(this, arguments); try { mf.blocked = await MF.blocked(); } catch { /* ignore */ } mfChatDecorate(cid); }; }
  { const base = LV.send; LV.send = async function (cid) { if (mf.blocked[cid]) throw new Error(mf.blocked[cid] === 'me' ? 'You blocked this member. Unblock to send messages.' : 'This member is not accepting messages from you.'); try { return await base.apply(this, arguments); } catch (err) { throw new Error(/row-level security/i.test(err.message) ? 'This conversation is blocked.' : err.message); } }; }
  function mfChatDecorate(cid) {
    const main = lv.inbox && $('.lv-main', lv.inbox); const head = main && $('.lv-thread-head', main); if (!head) return;
    const c = lv.convs.find((x) => x.id === cid) || {}; const st = mf.blocked[cid];
    let tools = $('.mf-chat-tools', head); if (!tools) { head.insertAdjacentHTML('beforeend', '<div class="mf-chat-tools"></div>'); tools = $('.mf-chat-tools', head); }
    tools.innerHTML = `${c.other_id ? `<button type="button" data-mf-chat="${st === 'me' ? 'unblock' : 'block'}">${mfT(st === 'me' ? 'Unblock' : 'Block')}</button>` : ''}<button type="button" class="danger" data-mf-chat="report">${mfT('Report')}</button>`;
    const comp = $('.lv-compose', main); let note = $('.mf-blocked', main);
    if (st) { if (comp) comp.hidden = true; const txt = st === 'me' ? 'You blocked this member. They cannot message you here.<button type="button" data-mf-chat="unblock">Unblock</button>' : 'You can no longer send messages in this conversation.'; if (!note) { (comp || $('.lv-msgs', main)).insertAdjacentHTML('afterend', `<p class="mf-blocked">${txt}</p>`); } else note.innerHTML = txt; }
    else { if (comp) comp.hidden = false; if (note) note.remove(); }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mf-chat]'); if (!b || !lv.conv) return; const a = b.dataset.mfChat; const cid = lv.conv;
    if (a === 'block' || a === 'unblock') {
      if (a === 'block' && !mfConfirm(b, 'Block this member? They will not be able to message you here.')) return;
      try { await MF.block(cid, a === 'block'); mf.blocked = await MF.blocked(); mfChatDecorate(cid); toast(a === 'block' ? 'Blocked. You can unblock any time.' : 'Unblocked.'); } catch (err) { toast(err.message); }
    }
    if (a === 'report') mfReportForm(cid);
  });
  // Ask twice instead of a browser dialog (dialogs block the page)
  function mfConfirm(btn, msg) { if (btn.dataset.sure) { delete btn.dataset.sure; return true; } btn.dataset.sure = '1'; const t = btn.textContent; btn.textContent = 'Tap again to confirm'; toast(msg); setTimeout(() => { if (btn.dataset.sure) { delete btn.dataset.sure; btn.textContent = t; } }, 4000); return false; }
  function mfReportForm(cid) {
    const card = openModal(`<div class="eyebrow"><span></span> REPORT A CHAT</div><h2>Report this conversation</h2><p class="modal-lead">RAQBO will see the last 30 messages of this chat and review them. The other person is not told who reported.</p>
      <form class="modal-form" data-mf-report="${esc(cid)}"><label>What happened?<select name="reason"><option value="scam">Asked for money outside RAQBO / possible scam</option><option value="abuse">Abusive or threatening</option><option value="spam">Spam or repeated messages</option><option value="fake_listing">Fake or misleading property</option><option value="other">Something else</option></select></label>
      <label>Details (optional)<textarea name="details" maxlength="1000" placeholder="Anything RAQBO should know"></textarea></label>
      <p class="form-error" hidden></p><button type="submit" class="button button-primary modal-submit">Send report</button></form>`, { label: 'Report a chat' });
    const bd = card && card.closest('.modal-backdrop'); if (bd) bd.style.zIndex = '400';   // above the Messages window
    return card;
  }
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-mf-report]'); if (!f) return; e.preventDefault();
    const done = busy($('button[type=submit]', f), 'Sending…');
    try { await MF.report(f.dataset.mfReport, f.reason.value, f.details.value); closeModal(); toast('Reported. RAQBO will review this chat.'); } catch (err) { done(); const x = $('.form-error', f); x.hidden = false; x.textContent = err.message; }
  });

  // Admin → Chat reports
  { const base = v3AdminTabs; v3AdminTabs = function () { const t = base(); const n = mf.reports ? mf.reports.filter((r) => r.status === 'open').length : ''; const i = t.findIndex((x) => x[0] === 'complaints'); t.splice(i >= 0 ? i + 1 : t.length, 0, ['chatreports', 'Chat reports', n || '']); return t; }; }
  if (typeof AX_ICON === 'object') AX_ICON.chatreports = 'alert';
  if (typeof AX_HINT === 'object') AX_HINT.chatreports = 'Conversations members reported, with the messages kept';
  const MF_REASON = { scam: 'Possible scam / money outside RAQBO', abuse: 'Abusive or threatening', spam: 'Spam', fake_listing: 'Fake or misleading property', other: 'Something else' };
  async function mfLoadReports() { try { mf.reports = await MF.reports(); mf.reportsErr = ''; } catch (err) { mf.reports = []; mf.reportsErr = err.message; } mf.reportsAt = Date.now(); if (admin.el && !admin.el.hidden && admin.tab === 'chatreports') { const b = $('.ax-body', admin.el) || $('.admin-content', admin.el); if (b) b.innerHTML = V3_ADMIN.chatreports(); } }
  V3_ADMIN.chatreports = () => {
    if (!mf.reports || Date.now() - mf.reportsAt > 30000) { if (!mf.reportsBusy) { mf.reportsBusy = true; mfLoadReports().finally(() => { mf.reportsBusy = false; }); } if (!mf.reports) return '<div class="gw-loading">Loading chat reports…</div>'; }
    const list = mf.reports; const open = list.filter((r) => r.status === 'open');
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> TRUST &amp; SAFETY</div><h2>Chat reports</h2><p class="admin-sub">${open.length} open · members reported these conversations. The last 30 messages were kept when the report was made.</p></div><button type="button" class="admin-refresh" data-mf-rep="reload">Refresh</button></div>
      ${mf.reportsErr ? `<p class="admin-message">${esc(mf.reportsErr)}</p>` : ''}
      ${list.length ? list.map((r) => `<article class="admin-card" data-rep="${esc(r.id)}"><div class="admin-card-heading"><div><h2>${esc(MF_REASON[r.reason] || r.reason)}</h2><p>${esc(r.reporter_name || 'Member')} reported ${esc(r.reported_name || 'a member')} · ${esc(fmtDay(r.created_at))}</p></div><span class="admin-status">${esc(r.status)}</span></div>
        ${r.details ? `<p><b>Details:</b> ${esc(r.details)}</p>` : ''}
        <div class="mf-snap">${(r.snapshot || []).length ? r.snapshot.map((m) => `<p><b>${m.from === 'reporter' ? 'Reporter' : 'Reported member'}:</b> ${esc(m.body)}</p>`).join('') : '<p>No messages in the chat.</p>'}</div>
        ${r.status === 'open' ? `<label>Note (kept in the audit log)<textarea data-rep-note maxlength="1000"></textarea></label><div class="admin-actions"><button type="button" data-mf-rep="actioned">Action taken</button><button type="button" data-mf-rep="actioned-block" title="Also stop the reported member messaging the reporter">Action taken &amp; block</button><button type="button" data-mf-rep="dismissed">Dismiss</button></div>` : `<p><b>Outcome:</b> ${esc(r.status)}${r.admin_note ? ' · ' + esc(r.admin_note) : ''}</p>`}
      </article>`).join('') : '<div class="admin-empty">No chat reports. Members can report a conversation from the Report button in Messages.</div>'}</div>`;
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mf-rep]'); if (!b) return; const a = b.dataset.mfRep;
    if (a === 'reload') { mf.reports = null; mfLoadReports(); return; }
    const card = b.closest('[data-rep]'); if (!card) return; const id = isNaN(+card.dataset.rep) ? card.dataset.rep : +card.dataset.rep;
    const done = busy(b, '…'); try { await MF.decide(id, a.startsWith('actioned') ? 'actioned' : 'dismissed', ($('[data-rep-note]', card) || {}).value || '', a === 'actioned-block'); toast('Saved. The member who reported was told.'); await mfLoadReports(); } catch (err) { done(); toast(err.message); }
  });

  // ---------- 4. Property Passport: levels D (legal opinion) and E (physical inspection) ----------
  { const base = vrPassportExtend; vrPassportExtend = async function (card, l) { await base.apply(this, arguments); mfPassport(card, l); }; }
  const MF_OUT = { confirmed: 'Confirmed', issue_identified: 'Issue identified', unconfirmed: 'Could not be confirmed' };
  async function mfPassport(card, l) {
    const anchor = $('.pass-legal', card); if (!anchor || $('.mf-pass', card)) return;
    let list = []; try { list = await MF.assessments(l.id); } catch { list = []; }
    const isAdm = db.isAdmin; const vis = list.filter((a) => !a.withdrawn_at || isAdm);
    const block = (kind, title, sub) => { const xs = vis.filter((a) => a.kind === kind); return `<section class="mf-pass"><h3>${esc(title)}</h3><p class="pass-note">${esc(sub)}</p>${xs.length ? xs.map((a) => `<div class="mf-assess ${a.withdrawn_at ? 'withdrawn' : ''}"><span class="mf-out ${esc(a.outcome)}">${esc(MF_OUT[a.outcome] || a.outcome)}</span> <b>${esc(a.reviewer_name)}</b>${a.reviewer_reg ? ` <small>· ${kind === 'legal_opinion' ? 'Enrolment' : 'Licence'} ${esc(a.reviewer_reg)}</small>` : ''} <small>· ${esc(fmtDay(a.assessed_on))}</small><p>${esc(a.findings)}</p>${a.limitations ? `<p><small><b>Not covered:</b> ${esc(a.limitations)}</small></p>` : ''}${a.withdrawn_at ? `<p><small>Withdrawn: ${esc(a.withdrawn_reason || '')}</small></p>` : isAdm ? `<button type="button" class="link-button" data-mf-ass-wd="${esc(a.id)}">Withdraw</button>` : ''}</div>`).join('') : `<p class="pass-note"><i>Not done for this property.</i></p>`}</section>`; };
    const html = `${l.ownershipType && l.ownershipType !== 'sole' ? `<section class="mf-pass"><h3>Ownership</h3><dl><div class="pass-row"><dt>Held as</dt><dd>${esc(MF_OWN[l.ownershipType])}${l.ownershipType === 'joint' && (l.coOwners || []).length ? ` · ${(l.coOwners || []).length + 1} owners` : ''}</dd></div><div class="pass-row"><dt>All owners agree</dt><dd class="${l.ownersConsent ? 'ok' : 'warn'}">${l.ownersConsent ? 'Declared by the advertiser' : 'Not declared'}</dd></div></dl></section>` : ''}
      ${block('legal_opinion', 'Level D · Independent legal opinion', 'A signed, dated title-risk opinion from an enrolled advocate, with its scope and caveats.')}
      ${block('inspection', 'Level E · Physical inspection', 'A site visit by a named inspector, with measured observations.')}`;
    anchor.insertAdjacentHTML('beforebegin', html);
    if (isAdm) { const acts = $('.pass-actions', card); if (acts && !$('[data-mf-ass-add]', acts)) acts.insertAdjacentHTML('beforeend', `<button type="button" class="button button-outline" data-mf-ass-add="legal_opinion" data-id="${esc(l.id)}">+ Legal opinion (D)</button><button type="button" class="button button-outline" data-mf-ass-add="inspection" data-id="${esc(l.id)}">+ Inspection (E)</button>`); }
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-mf-ass-add]'); if (a) { const k = a.dataset.mfAssAdd; const id = a.dataset.id; const today = mfToday();
      openModal(`<div class="eyebrow"><span></span> PROPERTY PASSPORT</div><h2>${k === 'legal_opinion' ? 'Record an independent legal opinion' : 'Record a physical inspection'}</h2><p class="modal-lead">${k === 'legal_opinion' ? 'Only an enrolled advocate’s signed opinion. Keep the signed copy on file.' : 'What the inspector saw and measured on site, on the date of the visit.'}</p>
        <form class="modal-form" data-mf-ass="${esc(k)}" data-id="${esc(id)}"><div class="modal-form-row"><label>${k === 'legal_opinion' ? 'Advocate’s name' : 'Inspector’s name'}<input name="name" required minlength="3" maxlength="120"></label><label>${k === 'legal_opinion' ? 'Bar council enrolment no.' : 'Licence / ID (optional)'}<input name="reg" maxlength="80" ${k === 'legal_opinion' ? 'required minlength="3"' : ''}></label></div>
        <div class="modal-form-row"><label>Date<input name="on" type="date" max="${today}" value="${today}" required></label><label>Outcome<select name="outcome"><option value="confirmed">Confirmed</option><option value="issue_identified">Issue identified</option><option value="unconfirmed">Could not be confirmed</option></select></label></div>
        <label>Findings (shown to buyers)<textarea name="findings" required minlength="10" maxlength="3000"></textarea></label><label>What was not covered (optional)<textarea name="limits" maxlength="1500"></textarea></label>
        <p class="form-error" hidden></p><button type="submit" class="button button-primary modal-submit">Save to the Passport</button></form>`, { label: 'Record a Passport check' }); return; }
    const w = e.target.closest('[data-mf-ass-wd]'); if (w) { const card = w.closest('.mf-assess'); if (!$('[data-mf-wd-reason]', card)) { card.insertAdjacentHTML('beforeend', '<div class="admin-actions"><input data-mf-wd-reason maxlength="300" placeholder="Reason for withdrawing"><button type="button" data-mf-wd-go="' + esc(w.dataset.mfAssWd) + '">Withdraw</button></div>'); } return; }
    const g = e.target.closest('[data-mf-wd-go]'); if (g) { const r = ($('[data-mf-wd-reason]', g.closest('.mf-assess')) || {}).value || ''; const id = isNaN(+g.dataset.mfWdGo) ? g.dataset.mfWdGo : +g.dataset.mfWdGo; MF.withdrawAssessment(id, r).then(() => { toast('Withdrawn.'); const pid = (e.target.closest('.modal-card') || document).querySelector('[data-mf-ass-add]'); closeModal(); if (pid) openPassport(pid.dataset.id); }).catch((err) => toast(err.message)); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-mf-ass]'); if (!f) return; e.preventDefault(); const done = busy($('button[type=submit]', f), 'Saving…');
    try { await MF.addAssessment({ listing_id: f.dataset.id, kind: f.dataset.mfAss, reviewer_name: f.name.value.trim(), reviewer_reg: f.reg.value.trim(), assessed_on: f.on.value, outcome: f.outcome.value, findings: f.findings.value.trim(), limitations: f.limits.value.trim() }); closeModal(); toast('Added to the Property Passport. The owner was told.'); openPassport(f.dataset.id); }
    catch (err) { done(); const x = $('.form-error', f); x.hidden = false; x.textContent = err.message; }
  });

  // ---------- 5. Construction materials: price and stock alerts ----------
  function mfWatchBtn(p) { const on = mf.watch.has(p.id); return `<button type="button" class="mk-watch ${on ? 'on' : ''}" data-mf-watch="${esc(p.id)}" aria-pressed="${on}" title="Get a notification when the price changes or it is back in stock">${DI(DIC.bell || DIC.info, 12)} ${mfT(on ? 'Alert on' : 'Price alert')}</button>`; }
  async function mfLoadWatch() { if (!db.session) { mf.watch = new Set(); return; } try { mf.watch = new Set(await MF.watches()); } catch { /* ignore */ } }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mf-watch]'); if (!b) return; e.preventDefault();
    requireSignIn(async () => { const pid = b.dataset.mfWatch; const on = !mf.watch.has(pid);
      try { await MF.watch(pid, on); if (on) mf.watch.add(pid); else mf.watch.delete(pid); $$(`[data-mf-watch="${CSS.escape(pid)}"]`).forEach((x) => { x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); x.innerHTML = `${DI(DIC.bell || DIC.info, 12)} ${mfT(on ? 'Alert on' : 'Price alert')}`; }); toast(on ? 'You will be told when the price changes or it is back in stock.' : 'Price alert removed.'); } catch (err) { toast(err.message); } });
  });
  { const base = openMarket; openMarket = function () { mfLoadWatch().then(() => { if (mk.el && !mk.el.hidden) $$('[data-mf-watch]', mk.el).forEach((x) => { const on = mf.watch.has(x.dataset.mfWatch); x.classList.toggle('on', on); x.innerHTML = `${DI(DIC.bell || DIC.info, 12)} ${mfT(on ? 'Alert on' : 'Price alert')}`; }); }); return base.apply(this, arguments); }; }
  // Demo mode: tell watchers when a supplier changes a price or restocks (the database trigger does this live)
  if (!SB && MK && typeof MK.saveProduct === 'function') {
    const base = MK.saveProduct; MK.saveProduct = async function (p) {
      const old = p.id && mk.data ? (mk.data.vendors || []).flatMap((v) => v.products || []).find((x) => x.id === p.id) : null;
      const before = old ? { price: old.price, stock: old.stock, name: old.name, unit: old.unit } : null;
      const r = await base.apply(this, arguments);
      if (before) { let t = ''; let b = ''; const P = (n) => 'Rs ' + Number(n).toLocaleString('en-US');
        if (p.price != null && before.price != null && p.price < before.price) { t = 'Price down: ' + before.name; b = `Now ${P(p.price)} / ${before.unit} (was ${P(before.price)})`; }
        else if (p.price != null && before.price != null && p.price > before.price) { t = 'Price up: ' + before.name; b = `Now ${P(p.price)} / ${before.unit} (was ${P(before.price)})`; }
        else if (before.stock === 'out' && p.stock && p.stock !== 'out') { t = 'Back in stock: ' + before.name; b = 'Order now while it lasts.'; }
        if (t) (store.get('mf_watch', []) || []).filter((w) => w.pid === p.id).forEach((w) => lvLocal.notify(w.user, 'deal', t, b, '#marketplace/vendor/' + p.vendorId)); }
      return r;
    };
  }
  // Open a supplier's shop from a notification
  { const base = lvGo; lvGo = function (link) { const m = String(link || '').match(/^#marketplace\/vendor\/(.+)$/); if (m) { lvClosePanel(); mkLoad().then(() => openMarket('vendor', { vendorId: decodeURIComponent(m[1]) })); return; } return base.apply(this, arguments); }; }
  // ---------- Admin → All chats (update 33): read any conversation; every one opened is audit-logged ----------
  const MFAC = SB ? {
    async list(q) { const { data, error } = await SB.rpc('admin_conversations', { p_q: q || '', p_limit: 100, p_offset: 0 }); if (error) throw new Error(/does not exist|schema cache|function/.test(error.message) ? 'Run update_33_admin_chats.sql in Supabase to switch on All chats.' : error.message); return data || []; },
    async msgs(cid) { const { data, error } = await SB.rpc('admin_conversation_messages', { p_conv: cid }); if (error) throw new Error(error.message); return data || []; }
  } : {
    async list(q) {
      const d = store.get('live', { c: [], m: [] }); const blocks = store.get('mf_blocks', []) || []; const reps = store.get('mf_chatreports', []) || []; const s = String(q || '').toLowerCase();
      return (d.c || []).map((c) => ({ id: c.id, subject: c.subject, starter_name: c.starter_name || 'Member', other_name: c.other_id ? (c.other_name || 'Member') : 'RAQBO team', is_support: !c.other_id, last_message_at: c.last_message_at, last_preview: c.last_preview || '', messages: (d.m || []).filter((m) => m.conversation_id === c.id).length, reports: reps.filter((r) => r.conversation_id === c.id).length, blocked: blocks.some((b) => b.conv === c.id) }))
        .filter((c) => !s || [c.subject, c.starter_name, c.other_name, c.last_preview].join(' ').toLowerCase().includes(s)).sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)));
    },
    async msgs(cid) { const d = store.get('live', { c: [], m: [] }); const c = (d.c || []).find((x) => x.id === cid) || {}; return (d.m || []).filter((m) => m.conversation_id === cid).map((m) => ({ ...m, sender_name: m.sender_id === c.starter_id ? (c.starter_name || 'Member') : c.other_id ? (c.other_name || 'Member') : 'RAQBO team' })); }
  };
  const ac = { list: null, at: 0, q: '', open: null, msgs: {}, err: '', busy: false };
  { const base = v3AdminTabs; v3AdminTabs = function () { const t = base(); const i = t.findIndex((x) => x[0] === 'chatreports'); t.splice(i >= 0 ? i + 1 : t.length, 0, ['allchats', 'All chats', '']); return t; }; }
  if (typeof AX_ICON === 'object') AX_ICON.allchats = 'chat';
  if (typeof AX_HINT === 'object') AX_HINT.allchats = 'Every member conversation — each one you open is recorded in the audit log';
  async function acLoad() { ac.busy = true; try { ac.list = await MFAC.list(ac.q); ac.err = ''; } catch (err) { ac.list = []; ac.err = err.message; } ac.at = Date.now(); ac.busy = false; acPaint(); }
  function acPaint() { if (admin.el && !admin.el.hidden && admin.tab === 'allchats') { const b = $('.ax-body', admin.el) || $('.admin-content', admin.el); if (b) { const y = admin.el.scrollTop; b.innerHTML = V3_ADMIN.allchats(); admin.el.scrollTop = y; const i = $('[data-ac-q]', b); if (i && ac.focus) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } } }
  const acWhen = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  V3_ADMIN.allchats = () => {
    if (!ac.list || Date.now() - ac.at > 30000) { if (!ac.busy) acLoad(); if (!ac.list) return '<div class="gw-loading">Loading conversations…</div>'; }
    const L = ac.list;
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> TRUST &amp; SAFETY</div><h2>All chats</h2><p class="admin-sub">${L.length} conversation${L.length === 1 ? '' : 's'}${ac.q ? ` matching “${esc(ac.q)}”` : ''}. These are private messages: open one only for a reason (a report, a dispute, fraud). Every conversation you open is recorded in the Audit log.</p></div><button type="button" class="admin-refresh" data-ac="reload">Refresh</button></div>
      <label class="ac-search"><span class="sr-only">Search conversations</span><input data-ac-q type="search" value="${esc(ac.q)}" placeholder="Search by name, property or message…"></label>
      ${ac.err ? `<p class="admin-message">${esc(ac.err)}</p>` : ''}
      ${L.length ? `<div class="ac-list">${L.map((c) => `<article class="ac-item ${ac.open === c.id ? 'open' : ''}">
          <button type="button" class="ac-row" data-ac-open="${esc(c.id)}" aria-expanded="${ac.open === c.id}"><span class="ac-who"><b>${esc(c.starter_name)}</b> ↔ <b>${esc(c.other_name)}</b><small>${esc(c.subject || '')}</small></span><span class="ac-prev">${esc(c.last_preview || '')}</span>
            <span class="ac-meta"><small>${esc(acWhen(c.last_message_at))}</small><span>${esc(c.messages)} msg</span>${c.is_support ? '<em class="ac-tag sup">Support</em>' : ''}${Number(c.reports) > 0 ? `<em class="ac-tag rep">${esc(c.reports)} report${c.reports == 1 ? '' : 's'}</em>` : ''}${c.blocked ? '<em class="ac-tag blk">Blocked</em>' : ''}</span></button>
          ${ac.open === c.id ? `<div class="ac-thread">${ac.msgs[c.id] ? (ac.msgs[c.id].error ? `<p class="admin-message">${esc(ac.msgs[c.id].error)}</p>` : ac.msgs[c.id].length ? ac.msgs[c.id].map((m) => `<div class="ac-msg"><b>${esc(m.sender_name)}</b><small>${esc(acWhen(m.created_at))}${m.read_at ? ' · read' : ''}</small><p>${esc(m.body)}</p></div>`).join('') : '<p class="admin-sub">No messages yet.</p>') : '<div class="gw-loading">Opening… (recorded in the audit log)</div>'}</div>` : ''}
        </article>`).join('')}</div>` : '<div class="admin-empty">No conversations yet.</div>'}</div>`;
  };
  document.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-ac="reload"]'); if (r) { ac.list = null; ac.msgs = {}; acLoad(); return; }
    const o = e.target.closest('[data-ac-open]'); if (!o) return; const id = o.dataset.acOpen;
    if (ac.open === id) { ac.open = null; acPaint(); return; }
    ac.open = id; ac.focus = false; acPaint();
    try { ac.msgs[id] = await MFAC.msgs(id); } catch (err) { ac.msgs[id] = { error: err.message }; } acPaint();
  });
  document.addEventListener('input', (e) => { const i = e.target.closest('[data-ac-q]'); if (!i) return; clearTimeout(ac.t); ac.t = setTimeout(() => { ac.q = i.value.trim(); ac.focus = true; ac.open = null; acLoad(); }, 350); });
