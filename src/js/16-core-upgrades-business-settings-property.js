  /* =====================================================================
     Core upgrades: business settings, Property Passport, RAQBO Direct,
     identity checks, My RAQBO dashboard, service tracking, bank
     reconciliation, admin team + audit log.   Supabase: update_13_core.sql
     ===================================================================== */
  DIC.arrow = DIC.arrow || '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>';
  DIC.clock = DIC.clock || '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  var pf = { pub: null, trust: {}, idv: new Set(), myId: null, admin: {}, my: { open: false, tab: 'overview' } };
  const PF_DEFAULTS = { legal_verification_fee: 10000, identity_checks_enabled: true, urgent_enabled: true, urgent_commission_pct: 2, investors_enabled: true, offer_valid_days: 14, auctions_enabled: true, auction_buyer_premium_pct: 1, auction_seller_commission_pct: 2, auction_default_increment: 100000, auction_deposit_default: 200000, auction_extension_window_min: 5, auction_extension_min: 5, auction_max_extensions: 12, bidder_auto_approve: false };
  const pfSetupMsg = 'This part is being set up. (Admin: run update_13_core.sql in Supabase.)';
  const RAQBO_ROLES = { owner: ['Owned by RAQBO', 'RAQBO owns this property and is the seller.'], purchaser: ['RAQBO is buying', 'RAQBO is considering buying this property; it may be offered to buyers in future.'], agent: ['Marketed by RAQBO', 'RAQBO is selling on behalf of the authorised owner, as their agent. The owner remains the seller.'], partner: ['Partner development', 'RAQBO is marketing a partner\'s development. The developer remains the seller.'], facilitator: ['Facilitated by RAQBO', 'RAQBO only facilitates this transaction between the owner and the buyer.'] };
  const POSSESSION = { vacant: 'Vacant — ready for possession', owner_occupied: 'Occupied by the owner', tenanted: 'Rented out (tenanted)', under_construction: 'Under construction' };
  const PLAN = { yes: 'Approved plan available', no: 'No approved plan', not_applicable: 'Not applicable (plot / land)', unknown: 'Not known' };
  const ENCUMB = { none: 'None declared by the owner', mortgage: 'Mortgage / bank loan', dispute: 'Dispute or court case', dues: 'Outstanding dues', other: 'Other restriction', unknown: 'Not known' };
  const UTIL = { electricity: 'Electricity', gas: 'Gas', water: 'Water', sewerage: 'Sewerage', internet: 'Internet / fibre', phone: 'Phone line' };
  const PERMS = { listings: 'Listings & RAQBO Direct', verification: 'Verification & identity', finance: 'Payments & bank records', urgent: 'QuickSell', auctions: 'Auctions', investors: 'Investors', growth: 'Growth & rewards', settings: 'Business settings', services: 'Service requests' };
  const SVC_STATUS = { new: 'Received', in_progress: 'In progress', awaiting_client: 'Waiting for you', completed: 'Completed', cancelled: 'Cancelled', handled: 'Handled' };
  const CHECKS = {
    documents: [['cnic', 'Owner\'s CNIC matches the ownership documents'], ['title', 'Registry / Fard / allotment or transfer letter is in the owner\'s name'], ['details', 'Area, size and property type match the listing'], ['dues', 'No dues or obvious disputes shown on the documents']],
    legal: [['cnic', 'Owner\'s CNIC matches the ownership documents'], ['title', 'Chain of title (registry and mutation history) checked'], ['records', 'Land / society record confirmed with the issuing office'], ['scheme', 'Society or scheme approval status (e.g. LDA) checked'], ['encumbrance', 'Mortgage, litigation and stay-order search'], ['details', 'Area, size and boundaries match the documents'], ['dues', 'Property tax, society and utility dues checked']]
  };

  // ---------- Supabase ----------
  const pfSupabase = (sb) => {
    const q = async (p, msg) => { const { data, error } = await p; if (error) throw new Error(/does not exist|schema cache|relation|could not find the function|bucket not found/i.test(error.message || '') ? pfSetupMsg : (error.message || msg)); return data; };
    return {
      pub: () => q(sb.rpc('platform_public'), ''),
      trust: (id) => q(sb.rpc('listing_trust', { p_listing: id }), ''),
      memberTrust: (ids) => q(sb.rpc('member_trust', { p_ids: ids }), ''),
      async myIdentity() { const me = db.session && db.session.userId; if (!me) return null; const r = await q(sb.from('identity_checks').select('status, name_on_cnic, admin_note, submitted_at, checked_at').eq('user_id', me).maybeSingle(), ''); return r || null; },
      async uploadId(file) { const path = `${db.session.userId}/${Date.now().toString(36)}-${vfSafeName(file.name)}`; const { error } = await sb.storage.from('identity-docs').upload(path, file, { contentType: file.type, upsert: false }); if (error) throw new Error(/bucket not found/i.test(error.message || '') ? pfSetupMsg : 'Upload failed: ' + error.message); return path; },
      requestIdentity: (name, files) => q(sb.rpc('request_identity_check', { p_name: name, p_files: files }), 'Could not send.'),
      myServices: () => q(sb.rpc('my_service_requests'), ''),
      setRole: (id, role, note, reason) => q(sb.rpc('admin_set_raqbo_role', { p_listing: id, p_role: role || '', p_note: note || '', p_reason: reason || '' }), 'Could not save.'),
      team: () => q(sb.rpc('admin_team'), ''),
      setAdmin: (email, on, perms, reason) => q(sb.rpc('admin_set_admin', { p_email: email, p_admin: on, p_perms: perms, p_reason: reason }), 'Could not save.'),
      audit: () => q(sb.from('admin_audit').select('*').order('at', { ascending: false }).limit(300), ''),
      saveBusiness: (p, reason) => q(sb.rpc('admin_save_platform', { p, p_reason: reason || '' }), 'Could not save.'),
      reconciliation: () => q(sb.rpc('admin_reconciliation'), ''),
      importBank: (lines) => q(sb.rpc('admin_import_bank_lines', { p_lines: lines }), 'Could not import.'),
      matchLine: (id, kind, ref, reason) => q(sb.rpc('admin_match_line', { p_line: id, p_kind: kind || '', p_ref: ref || '', p_reason: reason }), 'Could not save.'),
      decideIdentity: (u, ok, note) => q(sb.rpc('admin_decide_identity', { p_user: u, p_approve: ok, p_note: note || '' }), 'Could not save.'),
      async idFileUrl(path) { const { data, error } = await sb.storage.from('identity-docs').createSignedUrl(path, 3600); if (error) throw new Error('Could not open the file.'); return data.signedUrl; },
      updateService: (id, status, note) => q(sb.rpc('admin_update_service_request', { p_id: id, p_status: status, p_note: note || '' }), 'Could not save.')
    };
  };
  // ---------- Demo mode ----------
  const PF_EXPECTED = [];
  const pfLocal = {
    r: (k, d) => store.get('pf.' + k, d), w(k, v) { store.set('pf.' + k, v); window.dispatchEvent(new Event('raqbo-growth')); },
    me: () => (db.session && db.session.userId) || null,
    log(action, ref, reason, data) { const a = this.r('audit', []); a.unshift({ id: Date.now(), actor_name: (db.session && db.session.name) || 'admin', action, entity_ref: ref || '', reason: reason || '', data: data || {}, at: new Date().toISOString() }); this.w('audit', a.slice(0, 500)); },
    async pub() { const s = { ...PF_DEFAULTS, ...this.r('settings', {}) }; const v = store.get('verif', {}); const idc = this.r('identity', {});
      return { ...s, verified_legal: Object.values(v).filter((x) => x.status === 'verified' && x.level === 'legal').map((x) => x.listing_id), id_verified_owners: Object.entries(idc).filter(([, c]) => c.status === 'verified').map(([u]) => u), is_investor: !!(store.get('deals.investors', {})[this.me()] || {}).status && store.get('deals.investors', {})[this.me()].status === 'approved' }; },
    async trust(id) { const v = store.get('verif', {})[id]; const l = byId(id) || {}; const idc = this.r('identity', {});
      return { verification: v && (v.status === 'verified' || v.status === 'expired') ? { status: v.status, level: v.level || 'documents', checks: v.status === 'verified' ? v.checks || [] : [], checked_at: v.decided_at } : null, history: (v && v.history) || [], owner_id_verified: !!(idc[l.ownerId] && idc[l.ownerId].status === 'verified'), raqbo_role: l.raqboRole || null, raqbo_role_note: l.raqboRoleNote || '' }; },
    async memberTrust(ids) { const idc = this.r('identity', {}); return ids.map((id) => ({ id, id_verified: !!(idc[id] && idc[id].status === 'verified') })); },
    async myIdentity() { return this.r('identity', {})[this.me()] || null; },
    async uploadId(file) { const id = 'id-' + uid('f'); await media.put(id, file); return 'local:' + id; },
    async requestIdentity(name, files) { const all = this.r('identity', {}); const c = all[this.me()]; if (c && c.status === 'verified') throw new Error('Your identity is already verified.'); if (c && c.status === 'pending') throw new Error('Your CNIC is already with RAQBO for checking.'); if (files.length < 2) throw new Error('Upload the front and back of your CNIC.');
      all[this.me()] = { user_id: this.me(), status: 'pending', name_on_cnic: name, files, admin_note: '', submitted_at: new Date().toISOString(), member: db.session.name, phone: db.session.phone, email: db.session.email }; this.w('identity', all); try { lvLocal.notifyAdmins('system', 'Identity check request', name + ' sent CNIC photos for checking.', '#admin/verify'); } catch { /* ignore */ } },
    async myServices() { return (db.enquiries || []).filter((e) => e.userId === this.me() || e.email === (db.session && db.session.email)).map((e) => ({ ref: e.ref, service: e.service, message: e.message, property_ref: e.property, status: e.status, client_note: e.clientNote || '', details: e.details || {}, quote_amount: e.quoteAmount || null, quote_note: e.quoteNote || '', quote_valid_until: e.quoteValidUntil || null, quote_status: e.quoteStatus || '', created_at: new Date(e.createdAt).toISOString(), updated_at: e.updatedAt ? new Date(e.updatedAt).toISOString() : null })); },
    async setRole(id, role, note, reason) { const l = byId(id); if (!l) throw new Error('Listing not found.'); l.raqboRole = role || null; l.raqboRoleNote = note || ''; store.set('listings', db.listings); this.log('listing.raqbo_role', l.ref, reason, { role }); },
    async team() { return Object.values(store.get('accounts', {})).map((a) => ({ id: a.userId, name: a.name, email: a.email, perms: (this.r('perms', {})[a.userId]) || null, me: a.userId === this.me() })); },
    async setAdmin(email, on, perms, reason) { if (!reason || reason.length < 3) throw new Error('Please give a reason (it is kept in the audit log).'); const a = Object.values(store.get('accounts', {})).find((x) => x.email === email.trim().toLowerCase()); if (!a) throw new Error('No member with that email.'); const p = this.r('perms', {}); p[a.userId] = perms; this.w('perms', p); this.log(on ? 'admin.grant' : 'admin.revoke', email, reason, { perms }); },
    async audit() { return this.r('audit', []); },
    async saveBusiness(p, reason) { this.w('settings', { ...this.r('settings', {}), ...p }); this.log('settings.business', 'platform', reason, p); },
    async reconciliation() {
      const lines = this.r('bank', []); const exp = [];
      ((typeof mk !== 'undefined' && mk && mk.orders) ? mk.orders : []).filter((o) => o.status === 'payment_review').forEach((o) => exp.push({ kind: 'order', ref: o.ref, amount: o.total, txn: o.paymentRef || '', who: o.buyerName || '', at: o.updatedAt, label: 'Material order ' + o.ref }));
      Object.values(store.get('verif', {})).filter((v) => v.status === 'submitted' && v.fee > 0).forEach((v) => { const l = byId(v.listing_id) || {}; exp.push({ kind: 'verification', ref: l.ref, amount: v.fee, txn: v.txn_id || '', who: l.ownerName, at: v.submitted_at, label: 'Verification fee ' + l.ref }); });
      PF_EXPECTED.forEach((f) => { try { f(exp); } catch { /* ignore */ } });
      exp.forEach((e) => { if (!lines.some((b) => b.matched_kind === e.kind && b.matched_ref === e.ref)) { const b = lines.find((x) => !x.matched_ref && Math.abs(x.amount - e.amount) < 1 && e.txn && e.txn.length >= 4 && ((x.reference || '') + ' ' + (x.description || '')).toLowerCase().includes(e.txn.toLowerCase())); if (b) { b.matched_kind = e.kind; b.matched_ref = e.ref; b.matched_at = new Date().toISOString(); } } });
      if (JSON.stringify(lines) !== JSON.stringify(this.r('bank', []))) this.w('bank', lines);
      return { expected: exp.map((e) => ({ ...e, matched: lines.some((b) => b.matched_kind === e.kind && b.matched_ref === e.ref), candidates: lines.filter((b) => !b.matched_ref && Math.abs(b.amount - e.amount) < 1).length })), lines: lines.slice().sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date))), unmatched: lines.filter((b) => !b.matched_ref && b.amount > 0).length };
    },
    async importBank(rows) { const lines = this.r('bank', []); let added = 0; rows.forEach((r) => { const k = [r.date, r.amount, r.reference, r.description].join('|'); if (!r.date || isNaN(+r.amount) || lines.some((x) => x.key === k)) return; lines.push({ id: Date.now() + added, key: k, txn_date: r.date, description: r.description || '', amount: +r.amount, reference: r.reference || '' }); added++; }); this.w('bank', lines); const before = lines.filter((x) => x.matched_ref).length; await this.reconciliation(); const after = this.r('bank', []).filter((x) => x.matched_ref).length; this.log('bank.import', '', '', { added }); return { added, matched: after - before }; },
    async matchLine(id, kind, ref, reason) { if (!reason || reason.length < 3) throw new Error('Please give a reason (it is kept in the audit log).'); const lines = this.r('bank', []); const b = lines.find((x) => x.id === id); if (!b) return; if (kind) { b.matched_kind = kind; b.matched_ref = ref; } else { b.matched_kind = null; b.matched_ref = null; } this.w('bank', lines); this.log(kind ? 'bank.match' : 'bank.unmatch', String(id), reason, { kind, ref }); },
    async decideIdentity(u, ok, note) { const all = this.r('identity', {}); const c = all[u]; if (!c || c.status !== 'pending') throw new Error('This request was already handled.'); if (!ok && (!note || note.length < 3)) throw new Error('Write a short reason for the member.'); c.status = ok ? 'verified' : 'rejected'; c.admin_note = note || ''; c.checked_at = new Date().toISOString(); this.w('identity', all); try { lvLocal.notify(u, 'system', ok ? '✓ Your identity is verified' : 'Identity check not approved', note || '', '#my'); } catch { /* ignore */ } this.log(ok ? 'identity.approve' : 'identity.reject', c.name_on_cnic, note); },
    async idFileUrl(path) { return vfLocal.fileUrl(path); },
    async updateService(id, status, note) { const e = (db.enquiries || []).find((x) => x.id === id); if (!e) throw new Error('Request not found.'); e.status = status; e.clientNote = note || ''; e.updatedAt = Date.now(); store.set('enquiries', db.enquiries); }
  };
  const PF = SB ? pfSupabase(SB) : pfLocal;

  async function pfLoad() {
    try { pf.pub = { ...PF_DEFAULTS, ...(await PF.pub()) }; } catch { pf.pub = null; }
    pf.legal = new Set((pf.pub && pf.pub.verified_legal) || []); pf.idv = new Set((pf.pub && pf.pub.id_verified_owners) || []);
  }
  const pfOn = () => !!pf.pub;

  // ---------- Listing extras (used by app.js) ----------
  function coreListingFormHTML() {
    return `<fieldset class="pp-fields"><legend>${DI(DIC.doc, 15)} Property Passport details <small>(optional — buyers trust complete listings more)</small></legend>
      <div class="modal-form-row"><label>Covered area<input name="coveredArea" type="number" min="0" step="any" placeholder="e.g. 2250"></label><label>Unit<select name="coveredUnit"><option>sq ft</option><option>sq yd</option><option>Marla</option><option>Kanal</option></select></label></div>
      <div class="modal-form-row"><label>Possession<select name="possession"><option value="">Choose…</option>${Object.entries(POSSESSION).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label>Approved building plan<select name="approvedPlan"><option value="">Choose…</option>${Object.entries(PLAN).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label></div>
      <label>Mortgage, dispute or dues<select name="encumbrance"><option value="">Choose…</option>${Object.entries(ENCUMB).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <div class="modal-form-row"><label>Nearby landmarks<input name="landmarks" maxlength="300" placeholder="e.g. Near Expo Centre, 2 min from main boulevard"></label><label>Marla standard used<select name="marlaSqft"><option value="">Not sure</option><option value="225">225 sq ft (most societies, e.g. DHA, Bahria)</option><option value="250">250 sq ft</option><option value="272">272 sq ft (revenue records, older areas)</option></select></label></div>
      <label class="v3-avail">Availability<select name="availability"><option value="available">Available</option><option value="under_offer">Under offer</option><option value="sold">Sold</option><option value="rented">Rented out</option></select></label>
      <div class="pp-utils"><span>Utilities connected</span>${Object.entries(UTIL).map(([k, v]) => `<label><input type="checkbox" name="utilities" value="${k}"> ${esc(v)}</label>`).join('')}</div>
    </fieldset>`;
  }
  function coreFormFill(f, l) {
    if (!l) return; if (l.coveredArea) f.coveredArea.value = l.coveredArea; if (l.coveredUnit) f.coveredUnit.value = l.coveredUnit;
    ['possession', 'approvedPlan', 'encumbrance'].forEach((k) => { if (l[k] && f.elements[k]) f.elements[k].value = l[k]; });
    $$('[name=utilities]', f).forEach((c) => { c.checked = (l.utilities || []).includes(c.value); });
    if (f.landmarks) f.landmarks.value = l.landmarks || ''; if (f.marlaSqft && l.marlaSqft) f.marlaSqft.value = String(l.marlaSqft); if (f.availability) f.availability.value = l.availability || 'available';
  }
  function coreFormData(f) {
    return { coveredArea: f.coveredArea && f.coveredArea.value ? Number(f.coveredArea.value) : null, coveredUnit: f.coveredArea && f.coveredArea.value ? f.coveredUnit.value : null, possession: (f.possession && f.possession.value) || null, approvedPlan: (f.approvedPlan && f.approvedPlan.value) || null, encumbrance: (f.encumbrance && f.encumbrance.value) || null, utilities: $$('[name=utilities]:checked', f).map((c) => c.value) , landmarks: (f.landmarks && f.landmarks.value.trim()) || '', marlaSqft: f.marlaSqft && f.marlaSqft.value ? Number(f.marlaSqft.value) : null, availability: (f.availability && f.availability.value) || 'available' };
  }
  const coreRow = (d) => (db.noExt ? {} : { covered_area: d.coveredArea ?? null, covered_unit: d.coveredUnit ?? null, possession: d.possession ?? null, approved_plan: d.approvedPlan ?? null, encumbrance: d.encumbrance ?? null, utilities: d.utilities || [], ...(d.saleMode ? { sale_mode: d.saleMode } : {}), ...(d.channel ? { channel: d.channel } : {}) , ...(db.noV18 ? {} : { landmarks: d.landmarks || '', marla_sqft: d.marlaSqft || null, availability: d.availability || 'available' }) });
  const coreMap = (r) => ({ saleMode: r.sale_mode || 'normal', channel: r.channel || 'public', raqboRole: r.raqbo_role || null, raqboRoleNote: r.raqbo_role_note || '', coveredArea: r.covered_area != null ? Number(r.covered_area) : null, coveredUnit: r.covered_unit || null, possession: r.possession || null, utilities: r.utilities || [], approvedPlan: r.approved_plan || null, encumbrance: r.encumbrance || null , landmarks: r.landmarks || '', availability: r.availability || 'available', marlaSqft: r.marla_sqft || null, confirmedAt: r.confirmed_at ? Date.parse(r.confirmed_at) : null, prevPrice: r.prev_price != null ? Number(r.prev_price) : null, priceChangedAt: r.price_changed_at ? Date.parse(r.price_changed_at) : null });
  const isPublicListing = (l) => (l.channel || 'public') === 'public';

  // RAQBO Direct label on cards and the disclosure on the property page
  function coreCardLabel(l) { const r = l.raqboRole && RAQBO_ROLES[l.raqboRole]; return r ? `<span class="rd-label">${DI(DIC.shield, 11)} RAQBO DIRECT · ${esc(r[0].toUpperCase())}</span>` : ''; }
  function coreDirectBox(l) {
    const r = l.raqboRole && RAQBO_ROLES[l.raqboRole]; if (!r) return '';
    return `<section class="pp-section"><div class="rd-box"><span>${DI(DIC.shield, 22)}</span><div><b>RAQBO Direct — ${esc(r[0])}</b><p>${esc(r[1])}${l.raqboRoleNote ? ' ' + esc(l.raqboRoleNote) : ''}</p><small>RAQBO tells you its role in every RAQBO Direct property, so you always know who you are dealing with.</small></div></div></section>`;
  }
  function coreIdChip(userId) { return userId && pf.idv && pf.idv.has(userId) ? `<span class="id-chip" title="Identity checked by RAQBO">${DI(DIC.check, 11)} Identity Verified</span>` : ''; }
  function coreVerifLevel(id) { return pf.legal && pf.legal.has(id) ? 'legal' : 'documents'; }

  // ---------- Property Passport ----------
  function corePassportBtn(l) { return l.sample ? '' : `<button type="button" class="pp-passport-btn" data-core="passport" data-id="${esc(l.id)}">${DI(DIC.doc, 18)}<span><b>Property Passport</b><small>Identity, documents, possession, utilities and verification history</small></span>${DI(DIC.arrow, 16)}</button>`; }
  async function openPassport(id) {
    const l = byId(id); if (!l) return;
    const card = openModal('<div class="gw-loading">Preparing the Property Passport…</div>', { wide: true, label: 'Property Passport' }); card.classList.add('pass-card');
    let t = null; let trustError = false; try { t = await PF.trust(id); } catch { trustError = true; }
    if (!document.body.contains(card)) return;
    const v = t && t.verification; const lvl = v && v.status === 'verified' ? (v.level === 'legal' ? 'Enhanced Property Verification' : 'Documents Reviewed') : null;
    const publicLink = l.status === 'published' && isPublicListing(l) ? `${location.origin}/#property/${encodeURIComponent(l.id)}` : '';
    const row = (k, val, ok) => `<div class="pass-row"><dt>${esc(k)}</dt><dd class="${ok === true ? 'ok' : ok === false ? 'warn' : ''}">${val}</dd></div>`;
    const docsRow = ['Registry / sale deed', 'Fard / record of rights', 'Mutation (intiqal)', 'Allotment / transfer letter', 'Owner CNIC', 'Approved building plan'];
    const checked = new Set(((v && v.checks) || []).filter((c) => c.result === 'ok').map((c) => c.key));
    const html = `<div class="pass" id="pass-print">
      <div class="pass-head"><div><div class="eyebrow"><span></span> RAQBO PROPERTY PASSPORT</div><h2>${esc(l.title)}</h2><p>${esc(l.ref || '')} · ${esc(l.area)}, ${esc(l.city)} · issued ${esc(fmtDay(Date.now()))}</p></div>
        <div class="pass-head-side"><div class="pass-seal ${lvl ? 'on' : ''}">${DI(DIC.shield, 26)}<b>${trustError ? 'Status unavailable' : lvl ? 'RAQBO Verified' : 'Not verified'}</b><small>${trustError ? 'Could not load verification status' : lvl ? esc(lvl) + (v.checked_at ? ' · ' + esc(fmtDay(v.checked_at)) : '') : 'Documents not checked'}</small></div>${publicLink ? '<div class="vr-qr" data-pass-qr><small>Preparing QR code…</small></div><small>Scan to open the current property page. Sign-in may be required.</small>' : ''}</div></div>
      <section><h3>1. Identification</h3><dl>${row('Reference', esc(l.ref || '—'))}${row('Property type', esc(l.type === 'Plot' ? 'Plot / land' : l.type))}${row('Offered for', l.purpose === 'rent' ? 'Rent' : l.saleMode === 'urgent' ? 'Sale — QuickSell' : l.saleMode === 'auction' ? 'Sale — Auction' : 'Sale')}${row('Price', esc(fmtPrice(l.price)) + (l.purpose === 'rent' ? ' / month' : ''))}${row('Advertised by', esc(l.role === 'Owner' ? 'Owner (direct)' : l.role) + (t && t.owner_id_verified ? ' · <span class="id-chip">Identity Verified</span>' : ''))}${l.raqboRole ? row('RAQBO\'s role', esc(RAQBO_ROLES[l.raqboRole][0])) : ''}</dl></section>
      <section><h3>2. Location</h3><dl>${row('Area / society', esc(l.area))}${row('City', esc(l.city))}${row('Map pin', l.lat != null ? `${(+l.lat).toFixed(5)}, ${(+l.lng).toFixed(5)} · <a href="https://www.openstreetmap.org/?mlat=${esc(l.lat)}&mlon=${esc(l.lng)}#map=17/${esc(l.lat)}/${esc(l.lng)}" target="_blank" rel="noopener">open map</a>` : 'Not pinned by the advertiser', l.lat != null ? true : null)}</dl></section>
      <section><h3>3. Dimensions</h3><dl>${row('Plot / land size', esc(fmtSize(l)))}${row('Covered area', l.coveredArea ? esc(l.coveredArea.toLocaleString('en-US') + ' ' + (l.coveredUnit || 'sq ft')) : 'Not provided')}${l.type !== 'Plot' ? row('Bedrooms / bathrooms', `${l.beds} / ${l.baths}`) : ''}${row('Price per marla', esc(typeof ppm === 'function' && ppm(l) ? fmtPrice(ppm(l)) : '—'))}</dl></section>
      <section><h3>4. Plans, possession and utilities</h3><dl>${row('Approved building plan', esc(PLAN[l.approvedPlan] || 'Not provided'), l.approvedPlan === 'yes' ? true : l.approvedPlan === 'no' ? false : null)}${row('Possession', esc(POSSESSION[l.possession] || 'Not provided'), l.possession === 'vacant' ? true : null)}${row('Utilities', (l.utilities || []).length ? l.utilities.map((u) => esc(UTIL[u] || u)).join(', ') : 'Not provided')}</dl></section>
      <section><h3>5. Encumbrance review</h3><dl>${row('Declared by the owner', esc(ENCUMB[l.encumbrance] || 'Not provided'), l.encumbrance === 'none' ? true : l.encumbrance && l.encumbrance !== 'unknown' ? false : null)}${row('Checked by RAQBO', trustError ? 'Status unavailable' : checked.has('encumbrance') ? 'Mortgage, litigation and stay-order search completed' : 'Not checked', checked.has('encumbrance') ? true : null)}</dl></section>
      <section><h3>6. Ownership documents <small class="pass-conf">confidential — not shown to buyers</small></h3><p class="pass-note">These are examples of documents to ask about, not a list of documents received or checked. See the verification history below for recorded checks.</p><ul class="pass-docs">${docsRow.map((d) => `<li>${DI(DIC.doc, 14)} ${esc(d)}</li>`).join('')}</ul></section>
      <section><h3>7. Verification history</h3>${v && v.status === 'verified' ? `<ul class="pass-checks">${(v.checks || []).map((c) => `<li class="${c.result === 'ok' ? 'ok' : 'na'}">${DI(c.result === 'ok' ? DIC.check : DIC.info, 14)} ${esc(c.label)}${c.result === 'ok' ? '' : ' — not checked'}</li>`).join('')}</ul>` : ''}
        ${(t && t.history && t.history.length) ? `<ol class="pass-hist">${t.history.map((h) => `<li><b>${esc(fmtDay(h.at))}</b> ${h.event === 'verified' ? esc(h.level === 'legal' ? 'Enhanced Property Verification passed' : 'Documents Reviewed — passed') : 'Badge removed — property details changed'}</li>`).join('')}</ol>` : `<p class="pass-note">${trustError ? 'Verification history could not be loaded. Please try again.' : 'No verification yet.'}</p>`}</section>
      <p class="pass-legal">The Property Passport combines what the advertiser declared with what RAQBO checked, and shows the date of each check. A RAQBO badge is not a government guarantee of ownership or legal title. Always obtain independent legal advice and check the official records before buying.</p>
    </div>
    <div class="button-row pass-actions"><button type="button" class="button button-primary" data-core="passport-print" disabled>${DI(GI.print, 16)} Download / print</button>${publicLink ? `<button type="button" class="button button-outline" data-core="passport-qr-retry" data-id="${esc(l.id)}" hidden>Retry QR code</button>` : ''}${!trustError && !lvl && db.session && l.ownerId === db.session.userId ? `<button type="button" class="button button-outline" data-vf="apply" data-id="${esc(l.id)}">Get RAQBO Verified</button>` : ''}${!trustError && !lvl && publicLink && !(db.session && l.ownerId === db.session.userId) ? `<button type="button" class="button button-outline" data-core="passport-request" data-id="${esc(l.id)}">Ask RAQBO to verify it</button>` : ''}</div>`;
    setBody(card, html);
    const print = $('[data-core="passport-print"]', card);
    await vrPassportExtend(card, l);
    if (!document.body.contains(card)) return;
    if (publicLink) await passportQr(card, publicLink);
    else print.disabled = false;
  }
  async function passportQr(card, url) {
    const box = $('[data-pass-qr]', card); const retry = $('[data-core="passport-qr-retry"]', card); const print = $('[data-core="passport-print"]', card);
    print.disabled = true; retry.hidden = true; box.innerHTML = '<small>Preparing QR code…</small>';
    const ok = await vrQrInto(box, url, 'QR code to open this property');
    if (!document.body.contains(card)) return;
    print.disabled = !ok; retry.hidden = ok;
  }
  async function printPassport(button) {
    const el = $('#pass-print'); if (!el) return;
    const done = busy(button, 'Preparing…'); const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(f);
    try {
      const d = f.contentDocument; d.open(); d.write('<!doctype html><html><head><meta charset="utf-8"><title>RAQBO Property Passport</title></head><body></body></html>'); d.close();
      for (const source of document.querySelectorAll('link[rel="stylesheet"], style')) {
        if (source.tagName === 'STYLE') { d.head.append(source.cloneNode(true)); continue; }
        if (new URL(source.href).origin !== location.origin) continue;
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
        let response; try { response = await fetch(source.href, { signal: controller.signal }); } finally { clearTimeout(timer); }
        if (!response.ok) throw new Error('Could not load passport styles.');
        const style = d.createElement('style'); style.textContent = await response.text(); d.head.append(style);
      }
      const extra = d.createElement('style'); extra.textContent = 'body{background:#fff!important;padding:18mm}.pass{max-width:none}'; d.head.append(extra);
      d.body.append(el.cloneNode(true));
      await Promise.all([...d.images].map((img) => img.decode()));
      f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000);
    } catch (err) { f.remove(); toast('Could not prepare the passport for printing: ' + err.message); }
    finally { done(); }
  }
  function requestPassportVerification(id) {
    closeModal();
    requireSignIn(() => {
      const l = byId(id);
      if (!l || l.status !== 'published' || !isPublicListing(l)) { toast('This property is no longer available.'); return; }
      const card = openModal(`<h2>Ask RAQBO to verify this property</h2><p class="modal-lead">${esc(l.title)} · ${esc(l.ref || l.id)}</p><p>RAQBO will review your request. Verification requires the owner's cooperation; fees and the scope of any checks must be agreed before work starts.</p>
        <form data-pass-request="${esc(l.id)}"><label>Name<input name="name" maxlength="120" required value="${esc(db.session.name || '')}"></label><label>Phone<input name="phone" maxlength="20" required value="${esc(db.session.phone || '')}"></label><label>Message (optional)<textarea name="message" maxlength="1000" rows="3"></textarea></label><div class="form-error" role="alert" hidden></div><button type="submit" class="button button-primary">Send request to RAQBO</button></form>`, { label: 'Request property verification' });
      $('form', card).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.currentTarget; const name = f.elements.name.value.trim(); const phone = normPhone(f.elements.phone.value); const errs = [];
        if (!name) errs.push(['name', 'Enter your name.']);
        if (!phone) errs.push(['phone', PK_PHONE_HINT]);
        if (showErrors(f, errs)) return;
        const current = byId(id);
        if (!current || current.status !== 'published' || !isPublicListing(current)) { showErrors(f, [['', 'This property is no longer available.']]); return; }
        const done = busy($('[type=submit]', f), 'Sending…');
        try {
          const ref = await backend.createEnquiry({ service: 'verification', name, phone, email: db.session.email || '', city: current.city || '', property: current.ref || current.id, message: 'Please contact me in the app about verification for this property.' + (f.elements.message.value.trim() ? '\n' + f.elements.message.value.trim() : ''), via: null, userId: db.session.userId });
          refreshAdmin();
          setBody(card, successHTML('Request sent to RAQBO', '<p>Track this request in My RAQBO → Service requests. This does not mean the property has been verified.</p>', ref, '<button type="button" class="button button-outline" data-my="services" data-close>View service requests</button>'));
        } catch (err) { showErrors(f, [['', err.message || 'Could not send the request. Please try again.']]); }
        finally { done(); }
      });
    });
  }

  // ---------- Home rails (Verified, RAQBO Direct; later phases add more) ----------
  const RAILS = [];
  let railKey = ''; let railT = null;
  function coreRailsSoon() { clearTimeout(railT); railT = setTimeout(() => { const k = [db.listings.length, db.listings.filter((l) => l.status === 'published').length, gw.verified ? gw.verified.size : 0, gw.featured ? gw.featured.size : 0, db.listings.filter((l) => l.raqboRole).length, RAILS.length, (window.__railExtra || '')].join('|'); if (k !== railKey) { railKey = k; coreRails(); } }, 120); }
  function coreRailDefs() {
    const pub = db.listings.filter((l) => l.status === 'published' && isPublicListing(l));
    return [
      { id: 'rail-verified', kicker: 'RAQBO VERIFIED', title: 'Properties with checked documents', sub: 'Ownership documents examined by RAQBO.', list: pub.filter((l) => vfIsVerified(l.id)), action: ['Show all verified', 'verified'] },
      { id: 'rail-direct', kicker: 'RAQBO DIRECT', title: 'RAQBO Direct opportunities', sub: 'Properties owned, bought, marketed or handled by RAQBO — with RAQBO\'s role shown on each.', list: pub.filter((l) => l.raqboRole), action: ['Show all RAQBO Direct', 'direct'] },
      ...RAILS.map((f) => f()).filter(Boolean)
    ];
  }
  function coreRails() {
    let host = $('#core-rails'); const anchor = $('#gw-band') || $('.property-section') || $('.trust-strip'); if (!anchor) return;
    if (!host) { host = document.createElement('div'); host.id = 'core-rails'; anchor.after(host); } else if (host.previousElementSibling !== anchor) anchor.after(host);
    const defs = coreRailDefs().filter((d) => d.list.length || d.always);
    host.innerHTML = defs.map((d) => d.section ? d.section : `<section class="rail" id="${esc(d.id)}" aria-label="${esc(d.title)}"><div class="container"><div class="rail-head"><div><span class="rail-kicker">${d.live ? '<i class="live-dot"></i>' : ''}${esc(d.kicker)}</span><h2>${esc(d.title)}</h2><p>${esc(d.sub)}</p></div>${d.action ? `<button type="button" class="button button-ghost rail-more" data-core="rail" data-to="${esc(d.action[1])}">${esc(d.action[0])} ${DI(DIC.arrow, 15)}</button>` : ''}</div>
      <div class="rail-track">${d.html ? d.html : d.list.slice(0, 10).map((l) => railCard(l)).join('')}${d.empty && !d.list.length ? `<div class="rail-empty">${d.empty}</div>` : ''}</div></div></section>`).join('');
    hydrate(host);
  }
  function railCard(l) {
    const p = l.photos[0];
    return `<article class="rail-card" data-open="${esc(l.id)}" tabindex="0"><div class="rail-img" ${mediaAttr(p, true)}>${coreCardLabel(l)}${l.saleMode === 'urgent' ? '<span class="urg-label">QUICKSELL</span>' : ''}</div><div class="rail-body"><small>${esc(l.area)}, ${esc(l.city)}</small><b>${esc(l.title)}</b><span>${esc(fmtPrice(l.price))}${l.purpose === 'rent' ? '/mo' : ''}</span>${vfCardBadge(l)}</div></article>`;
  }

  // ---------- My RAQBO dashboard ----------
  const MY = [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'properties', label: 'My properties', icon: 'home', count: () => db.listings.filter((l) => !l.sample && db.session && l.ownerId === db.session.userId).length },
    { id: 'saved', label: 'Saved properties', icon: 'heart', count: () => db.favorites.length },
    { id: 'services', label: 'Service requests', icon: 'doc' },
    { id: 'identity', label: 'Identity check', icon: 'shield' },
    { id: 'rewards', label: 'Rewards & referrals', icon: 'star' }
  ];
  const MY_RENDER = {};
  function openMy(tab) {
    requireSignIn(async () => {
      closeNavMenus(); if ($('.modal-backdrop')) closeModal(); if (admin.el && !admin.el.hidden) closeAdmin();
      pf.my.tab = tab || pf.my.tab || 'overview';
      let el = $('.my-overlay');
      if (!el) { el = document.createElement('div'); el.className = 'my-overlay'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'My RAQBO'); document.body.append(el); }
      el.hidden = false; document.body.classList.add('no-scroll'); pf.my.open = true; await renderMy();
    });
  }
  function closeMy() { const el = $('.my-overlay'); if (el) el.hidden = true; pf.my.open = false; document.body.classList.remove('no-scroll'); }
  async function renderMy() {
    const el = $('.my-overlay'); if (!el || el.hidden) return; const s = db.session; const t = pf.my.tab;
    const items = MY.filter((m) => (!m.show || m.show()) && (typeof myRoleOk !== 'function' || myRoleOk(m)));
    el.innerHTML = `<div class="my-shell"><aside class="my-side"><div class="my-who"><span class="mt-avatar ${s.photo ? 'has-photo' : ''}">${avatarIn(s)}</span><div><b>${esc(s.name || 'Member')}</b><small>${esc(s.email)}</small>${gwFoundingChip(s.userId)}${coreIdChip(s.userId)}</div></div>
      ${typeof myRoleBar === 'function' ? myRoleBar() : ''}<nav class="my-nav">${items.map((m) => { const c = m.count ? m.count() : ''; return `<button type="button" data-my="${m.id}" class="${t === m.id ? 'active' : ''}">${DI(DIC[m.icon] || GI[m.icon] || DIC.grid, 17)}<span>${esc(m.label)}</span>${c ? `<em>${esc(c)}</em>` : ''}</button>`; }).join('')}</nav>
      <button type="button" class="my-close" data-my-close aria-label="Close">${DI(DIC.x, 18)} Close</button></aside>
      <main class="my-main"><div class="my-loading">Loading…</div></main></div>`;
    const main = $('.my-main', el); let html = '';
    try { html = await (MY_RENDER[t] || MY_RENDER.overview)(); } catch (err) { html = `<div class="admin-empty">${esc(err.message)}</div>`; }
    if (pf.my.tab === t) { main.innerHTML = html; hydrate(main); }
  }
  const myHead = (kicker, title, lead) => `<div class="my-head"><div class="eyebrow"><span></span> ${esc(kicker)}</div><h1>${esc(title)}</h1>${lead ? `<p>${lead}</p>` : ''}</div>`;
  MY_RENDER.overview = async () => {
    const s = db.session; const mine = db.listings.filter((l) => !l.sample && l.ownerId === s.userId);
    const tiles = [['properties', 'My properties', mine.length, `${mine.filter((l) => l.status === 'published').length} live · ${mine.filter((l) => l.status === 'pending').length} in review`], ['saved', 'Saved properties', db.favorites.length, 'Your shortlist'], ...MY.filter((m) => m.tile && (!m.show || m.show())).map((m) => m.tile())];
    return `${myHead('MY RAQBO', `Assalam o Alaikum, ${(s.name || '').split(' ')[0] || 'member'}`, 'Everything you do on RAQBO in one place.')}
      <div class="my-tiles">${tiles.map(([id, label, n, sub]) => `<button type="button" class="my-tile" data-my="${id}"><small>${esc(label)}</small><b>${esc(n)}</b><span>${esc(sub)}</span></button>`).join('')}</div>
      <div class="my-quick"><button type="button" class="button button-primary" data-new-listing>${DI(DIC.plus, 16)} List a property</button>${MY_QUICK.map((f) => f()).join('')}<button type="button" class="button button-outline" data-gw="wanted">${DI(GI.target, 16)} Property Wanted</button><button type="button" class="button button-outline" data-gw="guides">${DI(GI.book, 16)} Free guides</button></div>`;
  };
  const MY_QUICK = [];
  MY_RENDER.properties = async () => {
    const s = db.session; const mine = db.listings.filter((l) => !l.sample && l.ownerId === s.userId).sort((a, b) => b.createdAt - a.createdAt);
    return `${myHead('MY PROPERTIES', 'My properties', 'Edit, verify, feature, or choose how to sell each property.')}
      ${mine.length ? `<div class="my-props">${mine.map((l) => `<article class="my-prop"><div class="my-prop-img" ${mediaAttr(l.photos[0], true)}></div><div class="my-prop-body"><div class="my-prop-top"><b>${esc(l.title)}</b>${pill(l.status)}</div><small>${esc(l.area)}, ${esc(l.city)} · ${esc(fmtPrice(l.price))}${l.purpose === 'rent' ? '/mo' : ''} · ${esc(l.ref || '')}${(l.saleMode || 'normal') !== 'normal' ? ' · ' + (l.saleMode === 'urgent' ? 'QuickSell' : 'Auction') : ''}${l.channel && l.channel !== 'public' ? ' · ' + (l.channel === 'investors' ? 'investors only' : 'private to RAQBO') : ''}</small>
        ${l.reviewNote ? `<small class="vf-why">Reviewer note: ${esc(l.reviewNote)}</small>` : ''}
        <div class="my-prop-act">${vfAccountBits(l)}${gwTrialBtn(l)}${MY_PROP_ACTIONS.map((f) => f(l)).join('')}<button type="button" class="link-button" data-core="passport" data-id="${esc(l.id)}">Passport</button><button type="button" class="link-button" data-open="${esc(l.id)}">View</button><button type="button" class="link-button" data-core="edit" data-id="${esc(l.id)}">Edit</button></div></div></article>`).join('')}</div>` : '<div class="admin-empty">You have not listed a property yet.</div>'}
      <div class="button-row"><button type="button" class="button button-primary" data-new-listing>${DI(DIC.plus, 16)} List a property</button></div>`;
  };
  const MY_PROP_ACTIONS = [];
  MY_RENDER.saved = async () => {
    const list = db.favorites.map(byId).filter(Boolean);
    return `${myHead('SAVED', 'Saved properties', 'You get an alert when a saved property drops its price.')}${list.length ? `<div class="my-grid">${list.map(railCard).join('')}</div>` : '<div class="admin-empty">Tap the heart on any property to save it here.</div>'}`;
  };
  MY_RENDER.services = async () => {
    let rows = []; try { rows = (await PF.myServices()) || []; } catch (err) { return `${myHead('SERVICES', 'Service requests')}<div class="admin-empty">${esc(err.message)}</div>`; }
    const steps = ['new', 'in_progress', 'completed'];
    return `${myHead('SERVICES', 'My service requests', 'Track every verification, legal, documents and registry request you send to RAQBO.')}
      ${rows.length ? `<div class="svc-list">${rows.map((r) => { const at = Math.max(0, steps.indexOf(r.status === 'handled' ? 'completed' : r.status === 'awaiting_client' ? 'in_progress' : r.status)); return `<article class="svc-item"><div class="svc-top"><div><b>${esc((typeof SERVICES !== 'undefined' && SERVICES[r.service]) || r.service)}</b><small>${esc(r.ref)} · sent ${esc(fmtDay(r.created_at))}</small></div><span class="svc-st svc-${esc(r.status)}">${esc(SVC_STATUS[r.status] || r.status)}</span></div>
        ${r.status === 'cancelled' ? '' : `<ol class="svc-steps">${['Received', 'In progress', 'Completed'].map((s, i) => `<li class="${i <= at ? 'done' : ''}">${esc(s)}</li>`).join('')}</ol>`}
        ${r.client_note ? `<p class="svc-note">${DI(DIC.chat, 14)} <span><b>RAQBO:</b> ${esc(r.client_note)}</span></p>` : ''}${typeof v3qRow === 'function' ? v3qRow(r) : ''}<p class="svc-msg">${esc(r.message)}</p></article>`; }).join('')}</div>` : '<div class="admin-empty">No service requests yet.</div>'}
      <div class="button-row"><button type="button" class="button button-primary" data-service="verification">Request a service</button></div>`;
  };
  MY_RENDER.identity = async () => {
    let c = null; try { c = await PF.myIdentity(); } catch (err) { return `${myHead('IDENTITY', 'Identity check')}<div class="admin-empty">${esc(err.message)}</div>`; }
    const head = myHead('IDENTITY', 'Identity check', 'Get the <b>Identity Verified</b> badge (Level 1) next to your name. Needed to bid in auctions, to join the Investors Network and for QuickSells.');
    if (c && c.status === 'verified') return `${head}<div class="vf-box ok"><span>${DI(DIC.shield, 22)}</span><div><b>Your identity is verified</b><p>Checked by RAQBO on ${esc(fmtDay(c.checked_at))}. The Identity Verified badge shows on your listings.</p></div></div>`;
    if (c && c.status === 'pending') return `${head}<div class="vf-box no"><span>${DI(DIC.clock || DIC.info, 22)}</span><div><b>Being checked</b><p>You sent your CNIC on ${esc(fmtDay(c.submitted_at))}. RAQBO will notify you when it is checked.</p></div></div>`;
    return `${head}${c && c.status === 'rejected' ? `<div class="gw-note">${DI(DIC.info, 16)} <span>Last check not approved: ${esc(c.admin_note)}. Please send clearer photos.</span></div>` : ''}
      <form class="vf-form" data-core-id novalidate><section><h3>Name exactly as on your CNIC</h3><input name="name" maxlength="120" value="${esc(db.session.name || '')}"></section>
        <section><h3>CNIC photos</h3><p class="form-hint">Front and back, clear and readable. Photos or PDF, 10 MB each. Only RAQBO's verification team can see them.</p>
          <div class="vf-grid"><label class="vf-drop small"><input type="file" name="front" accept="image/jpeg,image/png,image/webp,application/pdf"><span>${DI(DIC.doc, 18)}<b>CNIC front</b><small data-f="front">Required</small></span></label><label class="vf-drop small"><input type="file" name="back" accept="image/jpeg,image/png,image/webp,application/pdf"><span>${DI(DIC.doc, 18)}<b>CNIC back</b><small data-f="back">Required</small></span></label></div></section>
        <div class="form-error" role="alert" hidden></div><div class="button-row"><button type="submit" class="button button-primary">Send for checking</button></div><p class="form-hint" data-core-progress></p></form>`;
  };
  MY_RENDER.rewards = async () => { setTimeout(() => { closeMy(); openRewards(); }, 0); return '<div class="my-loading">Opening My RAQBO Rewards…</div>'; };

  // ---------- Admin screens ----------
  const coreAdminTabs = () => [['#c', 'CONTROL'], ['reconcile', 'Payments & bank records', pf.admin.recon && pf.admin.recon.unmatchedExpected ? pf.admin.recon.unmatchedExpected : ''], ['business', 'Business settings', ''], ['team', 'Team & permissions', ''], ['audit', 'Audit log', '']];
  async function coreAdminLoad(tab) {
    try {
      if (tab === 'reconcile') { const r = await PF.reconciliation(); r.unmatchedExpected = (r.expected || []).filter((e) => !e.matched).length; pf.admin.recon = r; }
      if (tab === 'team') pf.admin.team = await PF.team();
      if (tab === 'audit') pf.admin.audit = await PF.audit();
      if (tab === 'business') { await pfLoad(); }
      pf.admin.err = null;
    } catch (err) { pf.admin.err = err.message; }
    if (admin.el && !admin.el.hidden && admin.tab === tab) { const body = ($('.ax-body', admin.el) || $('.admin-content', admin.el)); if (body) body.innerHTML = coreAdminHTML(tab); }
  }
  function coreAdminHTML(tab) {
    if (pf.admin.err) return `<div class="admin-empty">${esc(pf.admin.err)}<br><br><button type="button" class="admin-refresh" data-core="admin-reload" data-tab="${esc(tab)}">Try again</button></div>`;
    const head = (k, t, l) => `<div class="admin-head-row"><div><div class="eyebrow"><span></span> ${esc(k)}</div><h2>${esc(t)}</h2><p class="admin-sub">${l}</p></div><button type="button" class="admin-refresh" data-core="admin-reload" data-tab="${esc(tab)}">${DI(DIC.trend, 15)} Refresh</button></div>`;
    if (tab === 'reconcile') {
      const r = pf.admin.recon; if (!r) { coreAdminLoad(tab); return '<div class="admin-empty">Loading…</div>'; }
      return `<div class="gwa">${head('FINANCE', 'Payments & bank records', 'Import the RAQBO bank statement (CSV) and the website matches each payment screenshot with a real bank credit by amount and transaction ID. Approve payments only when they show <b>Matched</b>.')}
        <section class="gwa-sec"><h3>Import bank statement</h3><form class="gwa-inline" data-core-bank><input type="file" name="csv" accept=".csv,text/csv" aria-label="Bank statement CSV"><button type="submit" class="button button-primary">Import and match</button></form><p class="admin-sub">CSV with a date column, a description/narration column, an amount (or credit) column and a reference column. Duplicate lines are skipped automatically.</p></section>
        <section class="gwa-sec"><h3>Payments waiting for a bank match <span class="admin-count">${r.expected.filter((e) => !e.matched).length}</span></h3>${r.expected.length ? `<table class="gw-table"><thead><tr><th>Payment</th><th>From</th><th>Amount</th><th>Transaction ID</th><th>Bank</th></tr></thead><tbody>${r.expected.map((e) => `<tr><td>${esc(e.label)}<br><small>${esc(fmtDay(e.at))}</small></td><td>${esc(e.who || '')}</td><td>${esc(rs(e.amount))}</td><td>${esc(e.txn || '—')}</td><td>${e.matched ? '<span class="gw-st gw-st-approved">Matched</span>' : `<span class="gw-st gw-st-pending">No bank record</span>${e.candidates ? `<br><small>${esc(e.candidates)} possible line(s) with this amount</small>` : ''}`}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">No payments waiting.</div>'}</section>
        <section class="gwa-sec"><h3>Bank lines <span class="admin-count">${r.unmatched || 0} unmatched</span></h3>${r.lines.length ? `<div class="gw-table-wrap"><table class="gw-table"><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Amount</th><th>Matched to</th><th></th></tr></thead><tbody>${r.lines.map((b) => `<tr><td>${esc(b.txn_date)}</td><td>${esc(b.description)}</td><td>${esc(b.reference || '')}</td><td>${esc(rs(b.amount))}</td><td>${b.matched_ref ? esc(b.matched_kind + ' ' + b.matched_ref) : '—'}</td><td>${b.matched_ref ? `<button type="button" class="link-button" data-core="unmatch" data-id="${esc(b.id)}">Unmatch</button>` : `<button type="button" class="link-button" data-core="match" data-id="${esc(b.id)}">Match…</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty sm">No bank lines imported yet.</div>'}</section></div>`;
    }
    if (tab === 'business') {
      const s = { ...PF_DEFAULTS, ...(pf.pub || {}) }; const g = (gw.admin && gw.admin.settings) || {};
      const num = (k, label, step) => `<label><span>${esc(label)}</span><input type="number" name="${k}" min="0" step="${step || 1}" value="${esc(s[k] ?? '')}"></label>`;
      const chk = (k, label) => `<label class="gwa-chk"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}> ${esc(label)}</label>`;
      return `<div class="gwa">${head('SETTINGS', 'Business settings', 'Fees, commissions, time limits and features. Changes apply immediately and are recorded in the audit log. All values start as placeholders for RAQBO to confirm.')}
        <form class="gwa-form" data-core-business>
          <fieldset><legend>Verification</legend><p class="admin-sub wide">Document-check fee and badge on/off are in Growth &amp; rewards (currently ${esc(rs(g.verification_fee ?? (gw.pub && gw.pub.verification_fee) ?? 2000))}).</p>${num('legal_verification_fee', 'Legal & property check fee (Rs)')}${chk('identity_checks_enabled', 'Members can send their CNIC for an identity check')}</fieldset>
          <fieldset><legend>QuickSell</legend>${chk('urgent_enabled', 'QuickSell is open')}${num('urgent_commission_pct', 'RAQBO commission on QuickSells (%)', 0.01)}${num('offer_valid_days', 'Offers stay valid for (days)')}</fieldset>
          <fieldset><legend>Investors Network</legend>${chk('investors_enabled', 'Investors can register and receive opportunities')}</fieldset>
          <fieldset><legend>Auctions</legend>${chk('auctions_enabled', 'Auctions are open')}${num('auction_seller_commission_pct', 'Seller commission (%)', 0.01)}${num('auction_buyer_premium_pct', 'Buyer\'s premium (%)', 0.01)}${num('auction_default_increment', 'Default bid increment (Rs)')}${num('auction_deposit_default', 'Default bidder security deposit (Rs)')}${num('auction_extension_window_min', 'Bids in the last … minutes extend the auction')}${num('auction_extension_min', 'Extend by (minutes)')}${num('auction_max_extensions', 'Maximum extensions')}${chk('bidder_auto_approve', 'Approve bidders automatically when their identity is verified and no deposit is required')}</fieldset>
          <fieldset><legend>Record</legend><label class="wide"><span>Reason for this change (kept in the audit log)</span><input name="reason" maxlength="300" placeholder="e.g. Rates confirmed by management on 8 Nov"></label></fieldset>
          <div class="button-row"><button type="submit" class="button button-primary">Save business settings</button></div></form></div>`;
    }
    if (tab === 'team') {
      const t = pf.admin.team; if (!t) { coreAdminLoad(tab); return '<div class="admin-empty">Loading…</div>'; }
      const admins = t.filter((a) => a.perms !== undefined && (LIVE ? true : true));
      return `<div class="gwa">${head('CONTROL', 'Team & permissions', 'Give staff access only to the areas they work on. Full admins can change everything, including this team. Every change is recorded in the audit log.')}
        <section class="gwa-sec"><h3>Admins</h3><table class="gw-table"><thead><tr><th>Name</th><th>Email</th><th>Access</th></tr></thead><tbody>${admins.map((a) => `<tr><td>${esc(a.name || '')}${a.me ? ' <small>(you)</small>' : ''}</td><td>${esc(a.email || '')}</td><td>${a.perms ? esc(a.perms.map((p) => PERMS[p] || p).join(', ')) : '<b>Full admin</b>'}</td></tr>`).join('')}</tbody></table></section>
        <section class="gwa-sec"><h3>Add, change or remove an admin</h3><form class="gwa-form" data-core-team><fieldset><legend>Member</legend><label class="wide"><span>Email of an existing RAQBO member</span><input name="email" type="email" required></label>
          <label class="gwa-chk"><input type="radio" name="mode" value="full"> Full admin (everything)</label><label class="gwa-chk"><input type="radio" name="mode" value="limited" checked> Staff — only the areas ticked below</label><label class="gwa-chk"><input type="radio" name="mode" value="remove"> Remove admin access</label>
          <div class="wide gwa-aud"><span>Areas</span>${Object.entries(PERMS).map(([k, v]) => `<label class="gwa-chk"><input type="checkbox" name="perm" value="${k}"> ${esc(v)}</label>`).join('')}</div>
          <label class="wide"><span>Reason (kept in the audit log)</span><input name="reason" required maxlength="300"></label></fieldset><div class="button-row"><button type="submit" class="button button-primary">Save</button></div></form></section></div>`;
    }
    if (tab === 'audit') {
      const a = pf.admin.audit; if (!a) { coreAdminLoad(tab); return '<div class="admin-empty">Loading…</div>'; }
      return `<div class="gwa">${head('CONTROL', 'Audit log', 'A permanent record of sensitive admin actions — approvals, bank matches, settings, roles, bids and auctions. Lines cannot be edited or deleted.')}
        <section class="gwa-sec">${a.length ? `<div class="gw-table-wrap"><table class="gw-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Reason</th></tr></thead><tbody>${a.map((x) => `<tr><td>${esc(fmtDay(x.at))}<br><small>${esc(new Date(x.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}</small></td><td>${esc(x.actor_name || '')}</td><td><code>${esc(x.action)}</code></td><td>${esc(x.entity_ref || '')}</td><td>${esc(x.reason || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty sm">Nothing recorded yet.</div>'}</section></div>`;
    }
    return '';
  }
  // Service request actions inside the existing enquiries tab
  function coreEnquiryActions(e) {
    return `<form class="svc-admin" data-core-svc data-id="${esc(e.id)}"><select name="status" aria-label="Status">${Object.entries(SVC_STATUS).filter(([k]) => k !== 'handled' || e.status === 'handled').map(([k, v]) => `<option value="${k}" ${e.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><input name="note" maxlength="600" placeholder="Note to the member (shown in My RAQBO)" value="${esc(e.clientNote || '')}" aria-label="Note"><button type="submit" class="button button-primary">Update</button></form>`;
  }
  // RAQBO role control on admin listing cards
  function coreAdminRoleBtn(l) { return l.status === 'published' && !l.sample ? `<button type="button" data-core="role" data-id="${esc(l.id)}">${l.raqboRole ? 'RAQBO role: ' + esc(RAQBO_ROLES[l.raqboRole][0]) : 'Set RAQBO Direct role'}</button>` : ''; }
  function openRoleForm(id) {
    const l = byId(id); if (!l) return;
    openModal(`<div class="eyebrow"><span></span> RAQBO DIRECT</div><h2>RAQBO's role in this property</h2><p class="modal-lead">${esc(l.title)} · ${esc(l.ref || '')}</p>
      <form class="gwa-form" data-core-role data-id="${esc(id)}"><fieldset><legend>Role</legend>${[['', 'Not a RAQBO Direct property', 'Normal listing by the advertiser.'], ...Object.entries(RAQBO_ROLES).map(([k, [t, d]]) => [k, t, d])].map(([k, t, d]) => `<label class="gwa-chk role-opt"><input type="radio" name="role" value="${k}" ${(l.raqboRole || '') === k ? 'checked' : ''}> <span><b>${esc(t)}</b><small>${esc(d)}</small></span></label>`).join('')}
        <label class="wide"><span>Public note (optional)</span><input name="note" maxlength="300" value="${esc(l.raqboRoleNote || '')}" placeholder="e.g. RAQBO bought this property in October 2026."></label>
        <label class="wide"><span>Reason (kept in the audit log)</span><input name="reason" required maxlength="300" placeholder="e.g. Agency agreement signed on 8 Nov"></label></fieldset>
        <div class="button-row"><button type="submit" class="button button-primary">Save</button></div></form>`, { label: 'RAQBO role' });
  }

  // ---------- CSV import (bank statement) ----------
  function parseCSV(text) {
    const rows = []; let row = []; let f = ''; let q = false;
    for (let i = 0; i < text.length; i++) { const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c; }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  function bankRowsFromCSV(text) {
    const rows = parseCSV(text); if (rows.length < 2) throw new Error('The file has no lines.');
    const h = rows[0].map((x) => x.trim().toLowerCase()); const find = (...ks) => h.findIndex((c) => ks.some((k) => c.includes(k)));
    const di = find('date', 'posting'); const de = find('description', 'narration', 'details', 'particular', 'remarks'); const cr = find('credit', 'deposit', 'amount'); const rf = find('reference', 'ref', 'cheque', 'transaction id', 'txn');
    if (di < 0 || cr < 0) throw new Error('Could not find the date and amount columns. The first row must have column names such as Date, Description, Credit, Reference.');
    const toDate = (s) => { s = String(s).trim(); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; } const t = Date.parse(s); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10); };
    return rows.slice(1).map((r) => ({ date: toDate(r[di]), description: de >= 0 ? (r[de] || '').trim() : '', amount: Number(String(r[cr] || '').replace(/[^\d.-]/g, '')), reference: rf >= 0 ? (r[rf] || '').trim() : '' })).filter((r) => r.date && r.amount > 0);
  }

  // ---------- Events ----------
  document.addEventListener('click', async (e) => {
    const my = e.target.closest('[data-my]'); if (my) { pf.my.tab = my.dataset.my; if (!pf.my.open) openMy(my.dataset.my); else renderMy(); return; }
    if (e.target.closest('[data-my-close]')) { closeMy(); return; }
    if (e.target.closest('.my-overlay [data-new-listing]')) { closeMy(); openListingForm(); return; }
    if (e.target.closest('.my-overlay [data-open]') && !e.target.closest('[data-core],[data-vf],[data-gw]')) { const id = e.target.closest('[data-open]').dataset.open; closeMy(); openDetails(id); return; }
    const c = e.target.closest('[data-core]'); if (!c) return; const a = c.dataset.core;
    if (a === 'passport') { if (pf.my.open) closeMy(); if (pp.el && !pp.el.hidden) closeDetails(); openPassport(c.dataset.id); }
    else if (a === 'passport-print') printPassport(c);
    else if (a === 'passport-qr-retry') { const l = byId(c.dataset.id); if (l && l.status === 'published' && isPublicListing(l)) passportQr(c.closest('.modal-card'), `${location.origin}/#property/${encodeURIComponent(l.id)}`); else toast('This property is no longer available.'); }
    else if (a === 'passport-request') requestPassportVerification(c.dataset.id);
    else if (a === 'edit') { closeMy(); openListingForm(c.dataset.id); }
    else if (a === 'rail') { if (c.dataset.to === 'urgent') { openUrgentPage(); return; } if (c.dataset.to === 'auctions') { openAuctions(); return; } if (c.dataset.to === 'verified') { fx.vmode = 'verified'; renderGrid(); } if (c.dataset.to === 'direct') { fx.kind = 'direct'; renderGrid(); } scrollToResults(); }
    else if (a === 'role') openRoleForm(c.dataset.id);
    else if (a === 'admin-reload') { pf.admin[{ reconcile: 'recon', team: 'team', audit: 'audit' }[c.dataset.tab]] = null; coreAdminLoad(c.dataset.tab); }
    else if (a === 'match' || a === 'unmatch') {
      const id = Number(c.dataset.id) || c.dataset.id; let kind = ''; let ref = '';
      if (a === 'match') { const exp = (pf.admin.recon.expected || []).filter((x) => !x.matched); const pick = prompt(`Match this bank line to which payment?\n${exp.map((x, i) => `${i + 1}. ${x.label} — ${rs(x.amount)}`).join('\n')}\n\nType the number:`); const x = exp[Number(pick) - 1]; if (!x) return; kind = x.kind; ref = x.ref; }
      const reason = prompt('Reason (kept in the audit log):'); if (!reason) return;
      try { await PF.matchLine(id, kind, ref, reason); toast('Saved.'); pf.admin.recon = null; coreAdminLoad('reconcile'); } catch (err) { toast(err.message); }
    }
  });
  document.addEventListener('change', (e) => { const f = e.target.closest('[data-core-id] input[type=file]'); if (f) { const s = $(`[data-f="${f.name}"]`); if (s) s.textContent = f.files[0] ? f.files[0].name : 'Required'; } });
  document.addEventListener('submit', async (e) => {
    const f = e.target; const btn = $('[type=submit]', f);
    if (f.matches('[data-core-id]')) {
      e.preventDefault(); const errs = []; if (f.name.value.trim().length < 3) errs.push(['name', 'Enter your name exactly as on your CNIC.']); if (!f.front.files[0]) errs.push(['front', 'Add the front of your CNIC.']); if (!f.back.files[0]) errs.push(['back', 'Add the back of your CNIC.']); if (showErrors(f, errs)) return;
      const done = busy(btn, 'Sending…'); const pg = $('[data-core-progress]', f);
      try { const files = []; for (const k of ['front', 'back']) { pg.textContent = `Uploading CNIC ${k}…`; let file = f[k].files[0]; if (/^image\//.test(file.type)) { try { file = await shrinkImage(file, 2000, 0.86); } catch { /* keep */ } } files.push({ path: await PF.uploadId(file), name: k }); }
        await PF.requestIdentity(f.name.value.trim(), files); done(); toast('Sent. RAQBO will check your CNIC and notify you.'); renderMy(); }
      catch (err) { done(); pg.textContent = ''; showErrors(f, [['name', err.message]]); }
    } else if (f.matches('[data-core-role]')) {
      e.preventDefault(); const role = (f.elements.role.value || ''); const reason = f.reason.value.trim(); if (reason.length < 3) { toast('Please give a reason.'); return; }
      const done = busy(btn, 'Saving…'); try { await PF.setRole(f.dataset.id, role, f.note.value.trim(), reason); if (LIVE) await backend.reloadListings(); done(); closeModal(); toast('Saved.'); renderGrid(); renderAdmin(); coreRails(); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-core-svc]')) {
      e.preventDefault(); const done = busy(btn, '…'); try { await PF.updateService(f.dataset.id, f.status.value, f.note.value.trim()); const x = (db.enquiries || []).find((y) => y.id === f.dataset.id); if (x) { x.status = f.status.value; x.clientNote = f.note.value.trim(); } done(); toast('Updated — the member has been notified.'); renderAdmin(); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-core-bank]')) {
      e.preventDefault(); const file = f.csv.files[0]; if (!file) { toast('Choose the CSV file first.'); return; } const done = busy(btn, 'Importing…');
      try { const rows = bankRowsFromCSV(await file.text()); const r = await PF.importBank(rows); done(); toast(`${r.added} new bank line(s) imported · ${r.matched} payment(s) matched.`); pf.admin.recon = null; coreAdminLoad('reconcile'); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-core-business]')) {
      e.preventDefault(); const p = {}; Object.keys(PF_DEFAULTS).forEach((k) => { const el = f.elements[k]; if (!el) return; p[k] = el.type === 'checkbox' ? el.checked : Number(el.value); });
      const done = busy(btn, 'Saving…'); try { await PF.saveBusiness(p, f.reason.value.trim()); await pfLoad(); done(); toast('Business settings saved.'); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-core-team]')) {
      e.preventDefault(); const mode = f.elements.mode.value; const perms = mode === 'limited' ? $$('[name=perm]:checked', f).map((c) => c.value) : null;
      if (mode === 'limited' && !perms.length) { toast('Tick at least one area for a staff member.'); return; }
      const done = busy(btn, 'Saving…'); try { await PF.setAdmin(f.email.value.trim(), mode !== 'remove', perms, f.reason.value.trim()); done(); toast('Saved.'); f.reset(); pf.admin.team = null; coreAdminLoad('team'); } catch (err) { done(); toast(err.message); }
    }
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pf.my.open && !$('.modal-backdrop')) { e.stopPropagation(); closeMy(); } }, true);

