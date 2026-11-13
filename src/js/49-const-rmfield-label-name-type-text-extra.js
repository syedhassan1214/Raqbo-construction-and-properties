  // =====================================================================
  const rmField = (label, name, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
  const rmSel = (label, name, opts, val) => `<label>${label}<select name="${name}">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === String(val || '') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;

  function rmPropForm(p) {
    p = p || {};
    const card = openModal(`<div class="eyebrow"><span></span> PROPERTY MANAGEMENT</div><h2>${p.id ? 'Edit property' : 'Add a property'}</h2>
      <p class="modal-lead">This is your own private record. It is not an advert and is never shown to the public.</p>
      <form class="modal-form" data-rm-prop="${esc(p.id || '')}" novalidate>
        <label>Name for this property<input name="title" required maxlength="150" value="${esc(p.title || '')}" placeholder="e.g. Shop at Gulberg Plaza"></label>
        <div class="form-grid two">${rmSel('Kind', 'kind', { residential: 'Residential', commercial: 'Commercial' }, p.kind)}
          ${rmField('City', 'city', 'text', `maxlength="60" value="${esc(p.city || '')}"`)}
          ${rmField('Area', 'area', 'text', `maxlength="120" value="${esc(p.area || '')}"`)}
          ${rmField('Size', 'size', 'number', `min="0" step="0.01" value="${esc(p.size || '')}"`)}
          ${rmSel('Unit', 'size_unit', { Marla: 'Marla', Kanal: 'Kanal', 'sq ft': 'sq ft', 'sq yd': 'sq yd', Acre: 'Acre' }, p.size_unit)}</div>
        <label>Address<input name="address" maxlength="300" value="${esc(p.address || '')}"></label>
        <label>Notes<textarea name="notes" rows="2" maxlength="1000">${esc(p.notes || '')}</textarea></label>
        <div class="form-error" hidden></div>
        <div class="button-row"><button class="button button-primary" type="submit">${p.id ? 'Save' : 'Add property'}</button>${p.id ? `<button type="button" class="button button-ghost" data-rm="prop-del" data-id="${esc(p.id)}">Remove</button>` : ''}</div></form>`, { wide: true, label: 'Property' });
    card.classList.add('gw-card');
  }
  function rmTenantForm(t) {
    t = t || {};
    const card = openModal(`<div class="eyebrow"><span></span> TENANT</div><h2>${t.id ? 'Edit tenant' : 'Add a tenant'}</h2>
      <form class="modal-form" data-rm-tenant="${esc(t.id || '')}" novalidate>
        <div class="form-grid two">${rmField('Full name', 'name', 'text', `required maxlength="120" value="${esc(t.name || '')}"`)}
          ${rmField('Phone', 'phone', 'text', `maxlength="40" value="${esc(t.phone || '')}"`)}
          ${rmField('Email (so they can see rent and receipts on RAQBO)', 'email', 'email', `maxlength="160" value="${esc(t.email || '')}"`)}
          ${rmField('Last 4 digits of CNIC', 'cnic_last4', 'text', `maxlength="4" inputmode="numeric" value="${esc(t.cnic_last4 || '')}"`)}
          ${rmField('Employer', 'employer', 'text', `maxlength="150" value="${esc(t.employer || '')}"`)}
          ${rmField('Current address', 'address', 'text', `maxlength="300" value="${esc(t.address || '')}"`)}</div>
        <p class="form-hint">${DI(DIC.lock, 13)} Only the last four digits of a CNIC are kept. Never store a full CNIC number or a copy of the card here.</p>
        <label>Notes<textarea name="notes" rows="2" maxlength="1000">${esc(t.notes || '')}</textarea></label>
        <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">${t.id ? 'Save' : 'Add tenant'}</button></form>`, { wide: true, label: 'Tenant' });
    card.classList.add('gw-card');
  }
  function rmTenancyForm(y, propId) {
    y = y || {}; const props = (rm.props || []); const tens = (rm.tenants || []);
    if (!props.length) { toast('Add a property first.'); return; }
    if (!tens.length) { toast('Add a tenant first.'); return; }
    const card = openModal(`<div class="eyebrow"><span></span> AGREEMENT</div><h2>${y.id ? 'Edit tenancy' : 'New tenancy'}</h2>
      <form class="modal-form" data-rm-tenancy="${esc(y.id || '')}" novalidate>
        <div class="form-grid two">
          <label>Property<select name="property_id">${props.map((p) => `<option value="${esc(p.id)}" ${p.id === (y.property_id || propId) ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
          <label>Tenant<select name="tenant_id">${tens.map((t) => `<option value="${esc(t.id)}" ${t.id === y.tenant_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          ${rmField('Rent (PKR)', 'rent', 'number', `min="1" required value="${esc(y.rent || '')}"`)}
          ${rmSel('Rent period', 'rent_period', { month: 'Per month', year: 'Per year' }, y.rent_period)}
          ${rmField('Rent due on day', 'due_day', 'number', `min="1" max="28" value="${esc(y.due_day || 5)}"`)}
          ${rmField('Security deposit (PKR)', 'deposit', 'number', `min="0" value="${esc(y.deposit || 0)}"`)}
          ${rmField('Advance rent (months)', 'advance_months', 'number', `min="0" max="36" value="${esc(y.advance_months || 0)}"`)}
          ${rmField('Start date', 'starts_on', 'date', `required value="${esc(y.starts_on || '')}"`)}
          ${rmField('End date', 'ends_on', 'date', `value="${esc(y.ends_on || '')}"`)}
          ${rmField('Yearly increase (%)', 'escalation_pct', 'number', `min="0" max="100" step="0.5" value="${esc(y.escalation_pct || 0)}"`)}
          ${rmField('Increase every (months)', 'escalation_months', 'number', `min="1" max="60" value="${esc(y.escalation_months || 12)}"`)}
          ${rmSel('Maintenance by', 'maintenance_by', { tenant: 'Tenant', landlord: 'Landlord', shared: 'Shared' }, y.maintenance_by)}
          ${rmSel('Utilities by', 'utilities_by', { tenant: 'Tenant', landlord: 'Landlord', shared: 'Shared' }, y.utilities_by)}</div>
        <label>Other agreed terms<textarea name="other_terms" rows="3" maxlength="3000">${esc(y.other_terms || '')}</textarea></label>
        <label class="check-row"><input type="checkbox" name="build" ${y.id ? '' : 'checked'}> Build the rent schedule for the next 12 months</label>
        <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">${y.id ? 'Save' : 'Create tenancy'}</button></form>`, { wide: true, label: 'Tenancy' });
    card.classList.add('gw-card');
  }
  function rmRentPay(r) {
    const y = (rm.tenancies || []).find((x) => x.id === r.tenancy_id) || {};
    const t = (rm.tenants || []).find((x) => x.id === y.tenant_id) || {};
    const card = openModal(`<div class="eyebrow"><span></span> RENT RECEIVED</div><h2>${esc(rs(r.amount - r.paid_amount))} due</h2>
      <p class="modal-lead">${esc(rmMonth(r.period))} · ${esc(t.name || '')}</p>
      <form class="modal-form" data-rm-pay="${esc(r.id)}" novalidate>
        <div class="form-grid two">${rmField('Amount received (PKR)', 'amount', 'number', `min="1" required value="${esc(r.amount - r.paid_amount)}"`)}
          ${rmField('Date received', 'paid_on', 'date', `value="${esc(rmToday())}"`)}
          ${rmSel('Paid by', 'method', { 'Bank transfer': 'Bank transfer', Raast: 'Raast', Cash: 'Cash', JazzCash: 'JazzCash', Easypaisa: 'Easypaisa', Cheque: 'Cheque', Other: 'Other' }, 'Bank transfer')}
          ${rmField('Reference / transaction no.', 'reference', 'text', 'maxlength="80"')}</div>
        <label>Note<input name="note" maxlength="300"></label>
        <p class="form-hint">${DI(DIC.info, 13)} Record the payment once it is in your account. RAQBO issues the receipt — it never receives the money.</p>
        <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">Record payment &amp; issue receipt</button></form>`, { wide: true, label: 'Record rent' });
    card.classList.add('gw-card');
  }
  function rmReceipt(r, y, t, p) {
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the receipt.'); return; }
    const idl = typeof v3fIdLine === 'function' ? v3fIdLine() : '';
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Rent receipt ${esc(r.receipt_no || '')}</title>${RM_TAG('style')}body{font:14px/1.6 system-ui,sans-serif;max-width:620px;margin:40px auto;padding:0 16px;color:#111}h1{font-size:20px;margin:0 0 2px}small{color:#666}table{width:100%;border-collapse:collapse;margin:18px 0}td,th{border-bottom:1px solid #e5e5e5;padding:9px 0;text-align:left}th{color:#666;width:42%;font-weight:600}.ok{display:inline-block;padding:3px 10px;border-radius:7px;background:#e3f3e7;color:#1d6b35;font-weight:700;font-size:12px}@media print{button{display:none}}${RM_END('style')}
      <h1>Rent receipt</h1><small>${esc(idl || 'Issued through RAQBO')}</small><p><span class="ok">${esc(r.status === 'paid' ? 'PAID IN FULL' : 'PART PAYMENT')}</span></p>
      <table><tr><th>Receipt number</th><td>${esc(r.receipt_no || '—')}</td></tr><tr><th>For the month of</th><td>${esc(rmMonth(r.period))}</td></tr><tr><th>Property</th><td>${esc((p && p.title) || '')}${p && p.address ? '<br>' + esc(p.address) : ''}</td></tr><tr><th>Tenant</th><td>${esc((t && t.name) || '')}</td></tr><tr><th>Rent due</th><td>${esc(rs(r.amount))}</td></tr><tr><th>Amount received</th><td><b>${esc(rs(r.paid_amount))}</b></td></tr><tr><th>Date received</th><td>${esc(rmDay(r.paid_on))}</td></tr><tr><th>Paid by</th><td>${esc(r.method || '—')}${r.reference ? ' · ' + esc(r.reference) : ''}</td></tr>${y && y.ref ? `<tr><th>Agreement</th><td>${esc(y.ref)}</td></tr>` : ''}</table>
      <p>__________________________<br><small>Landlord / authorised signature</small></p>
      <p><small>This receipt records a payment made directly to the landlord. RAQBO provides the record and the reminder only, and does not receive rent.</small></p>
      <button onclick="print()">Print / save as PDF</button>`);
    w.document.close();
  }
  function rmScreenForm(tenant) {
    const t = tenant || {};
    const card = openModal(`<div class="eyebrow"><span></span> TENANT SCREENING</div><h2>Tenant Screening &amp; Verification</h2>
      <p class="modal-lead">Make informed rental decisions through a structured tenant-verification process designed to help property owners evaluate prospective tenants.</p>
      <form class="modal-form" data-rm-screen="${esc(t.id || '')}" novalidate>
        <div class="form-grid two">${rmField('Tenant name', 'name', 'text', `required maxlength="120" value="${esc(t.name || '')}"`)}
          ${rmField('Phone', 'phone', 'text', `maxlength="40" value="${esc(t.phone || '')}"`)}
          ${rmField('Email (so the tenant can give consent on RAQBO)', 'email', 'email', `maxlength="160" value="${esc(t.email || '')}"`)}
          ${rmField('Current address', 'address', 'text', `maxlength="300" value="${esc(t.address || '')}"`)}
          ${rmField('Employer', 'employer', 'text', `maxlength="150" value="${esc(t.employer || '')}"`)}
          ${rmField('Job title', 'job_title', 'text', 'maxlength="120"')}
          ${rmField('Monthly income (as stated)', 'income', 'text', 'maxlength="60"')}
          ${rmField('Previous landlord name', 'prev_landlord', 'text', 'maxlength="120"')}
          ${rmField('Previous landlord phone', 'prev_landlord_phone', 'text', 'maxlength="40"')}
          ${rmField('Other reference', 'reference', 'text', 'maxlength="200"')}</div>
        <div class="oa-legal"><b>Consent and privacy</b><p>Nothing is checked until the tenant has read what is asked and given consent. RAQBO verifies only what can be checked lawfully and with that consent — employment, references and the details the tenant supplies. <b>RAQBO does not provide police clearance or criminal-record checks.</b> The report always separates what the tenant told you from what RAQBO independently confirmed.</p></div>
        <p class="form-hint">Landlords in Punjab must also register the tenant with the police: <a href="${RM_LINKS.trs}" target="_blank" rel="noopener nofollow">Punjab Police Tenant Registration System</a>. RAQBO does not do this for you.</p>
        <label class="check-row"><input type="checkbox" name="agree" required> I confirm the tenant knows about this request and I will not use the result unlawfully.</label>
        <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">Send for verification</button></form>`, { wide: true, label: 'Tenant screening' });
    card.classList.add('gw-card');
  }

  // ---------- Clicks ----------
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-rma]'); if (a) { rmAdminClick(a); return; }
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const k = b.dataset.rm; const id = b.dataset.id; const host = b.closest('.modal-card') || document;
    const P = () => (rm.props || []).find((x) => x.id === id);
    const T = () => (rm.tenants || []).find((x) => x.id === id);
    const Y = () => (rm.tenancies || []).find((x) => x.id === id);
    if (k === 'commercial') { e.preventDefault(); openCommercial(); return; }
    if (k === 'ckind') { rm.cf.kind = rm.cf.kind === b.dataset.v ? '' : b.dataset.v; rmPaintCommercial(host); return; }
    if (k === 'creset') { Object.assign(rm.cf, { kind: '', purpose: '', city: '', min: '', max: '', sizeMin: '', sizeMax: '', floor: '', parking: false, income: false }); rmPaintCommercial(host); return; }
    if (k === 'clist') { closeModal(); openListingForm(null, { kicker: 'COMMERCIAL PROPERTY', heading: 'List a commercial property' }); setTimeout(() => { const s = $('[name=type]'); if (s) { s.value = 'Commercial'; s.dispatchEvent(new Event('change', { bubbles: true })); } }, 400); return; }
    if (k === 'yield') { openYield(id ? byId(id) : null); return; }
    if (k === 'tax') { const l = id ? byId(id) : null; openTax(l ? { city: l.city, price: l.price, commercial: rmIsCommercial(l) } : null); return; }
    if (k === 'lease') { openLease(); return; }
    if (k === 'legal') { openLegal(b.dataset.matter); return; }
    if (k === 'landlord') { requireSignIn(() => openMy('landlord')); return; }
    if (k === 'prop-new') { rmPropForm(); return; }
    if (k === 'prop-edit') { rmPropForm(P()); return; }
    if (k === 'prop-del') { if (!confirm('Remove this property from your records? The rent history is kept.')) return; try { await RM.delProp(id); closeModal(); await rmLoad(true); openMy('landlord'); toast('Property removed.'); } catch (err) { toast(err.message); } return; }
    if (k === 'tenant-new') { rmTenantForm(); return; }
    if (k === 'tenant-edit') { rmTenantForm(T()); return; }
    if (k === 'tenancy-new') { rmTenancyForm(null, id); return; }
    if (k === 'tenancy-edit') { rmTenancyForm(Y()); return; }
    if (k === 'build-rent') { const months = +prompt('Build the rent schedule for how many months?', '12'); if (!months) return; try { const n = await RM.buildRent(id, months); await rmLoad(true); openMy('landlord'); toast(n ? `${n} rent month${n === 1 ? '' : 's'} added.` : 'Already up to date.'); } catch (err) { toast(err.message); } return; }
    if (k === 'rent-pay') { const r = (rm.rent || []).find((x) => x.id === id); if (r) rmRentPay(r); return; }
    if (k === 'rent-all') { rmRentAll(); return; }
    if (k === 'remind-all') { rmRemind(); return; }
    if (k === 'receipt') { const r = (rm.rent || []).find((x) => x.id === id) || ((rm.tenant || []).flatMap((y) => y.rent_rows || []).find((x) => x.id === id)); if (!r) { toast('Receipt not found.'); return; }
      const y = (rm.tenancies || []).find((x) => x.id === r.tenancy_id); const t = y ? (rm.tenants || []).find((x) => x.id === y.tenant_id) : null; const p = y ? (rm.props || []).find((x) => x.id === y.property_id) : null;
      rmReceipt({ ...r, paid_amount: r.paid_amount != null ? r.paid_amount : r.paid }, y, t, p); return; }
    if (k === 'statement') { rmStatement(id); return; }
    if (k === 'report-year') { rmStatement(null); return; }
    if (k === 'report-csv') { rmCsv(); return; }
    if (k === 'exp-new') { rmExpenseForm(); return; }
    if (k === 'maint-set') { const m = (rm.maint || []).find((x) => x.id === id); if (!m) return; const st = prompt('Status: open, in_progress, done or rejected', m.status); if (!st) return; const cost = prompt('Cost (PKR, leave blank if none)', m.cost || ''); try { await RM.setMaint(id, { status: st, cost: cost ? +cost : null, closed_at: ['done', 'rejected'].includes(st) ? new Date().toISOString() : null }); await rmLoad(true); openMy('landlord'); toast('Updated.'); } catch (err) { toast(err.message); } return; }
    if (k === 'maint-report') { rmMaintForm(id); return; }
    if (k === 'ask-managed') { if (!confirm('Ask RAQBO to manage this property?\n\nRAQBO will contact you to agree the service and the fee in writing before anything starts.')) return;
      try { await RM.saveProp({ id, managed_by: 'raqbo', mgmt_status: 'requested' }); await rmLoad(true); openMy('landlord'); toast('Request sent. RAQBO will contact you.'); } catch (err) { toast(err.message); } return; }
    if (k === 'screen-new') { rmScreenForm(id ? T() : null); return; }
    if (k === 'ts-yes') { rmConsentForm(b.dataset.ref); return; }
    if (k === 'ts-no') { if (!confirm('Refuse this verification? The landlord will be told you did not consent.')) return; try { await RM.tsConsent(b.dataset.ref, false, ''); openMy('tenant'); toast('The landlord has been told.'); } catch (err) { toast(err.message); } return; }
    if (k === 'pick-lawyer') { const f = $('[data-rm-legal]', host); if (f) { f.lawyer_id.value = b.dataset.id; f.lawyer_name.value = b.dataset.name; f.scrollIntoView({ behavior: 'smooth', block: 'center' }); $$('.rm-lw', host).forEach((x) => x.classList.remove('is-picked')); b.closest('.rm-lw').classList.add('is-picked'); } return; }
    if (k === 'lease-from') { const y = Y(); if (!y) return; const p = (rm.props || []).find((x) => x.id === y.property_id) || {}; const t = (rm.tenants || []).find((x) => x.id === y.tenant_id) || {};
      openLease({ tn_name: t.name, addr: [p.address, p.area, p.city].filter(Boolean).join(', '), rent: y.rent, deposit: y.deposit, advance: y.advance_months, due_day: y.due_day, start: y.starts_on, months: y.ends_on ? Math.max(1, Math.round((Date.parse(y.ends_on) - Date.parse(y.starts_on)) / 2.6298e9)) : 12, esc_pct: y.escalation_pct }); return; }
    if (k === 'rate') { const n = +prompt('How would you rate this consultation, 1 to 5?', '5'); if (!(n >= 1 && n <= 5)) return; const t = prompt('Any comment? (optional)', '') || ''; try { await RM.feedback(b.dataset.ref, n, t); openMy('legal'); toast('Thank you.'); } catch (err) { toast(err.message); } return; }
    if (k === 'appt-set') { const st = prompt('Status: confirmed, completed, cancelled or no_show', 'confirmed'); if (!st) return; const when = st === 'confirmed' ? prompt('Confirmed date and time (YYYY-MM-DD HH:MM)', '') : ''; try { await RM.updateAppt(b.dataset.ref, st, when ? new Date(when.replace(' ', 'T') + ':00+05:00').toISOString() : null, ''); openMy('lawyer'); toast('Updated.'); } catch (err) { toast(err.message); } return; }
    if (k === 'lawyer-apply') { rmLawyerForm(rm.lawyer && rm.lawyer.profile); return; }
  });
  function rmExpenseForm() {
    const props = rm.props || []; if (!props.length) { toast('Add a property first.'); return; }
    const card = openModal(`<div class="eyebrow"><span></span> EXPENSE</div><h2>Record an expense</h2>
      <form class="modal-form" data-rm-exp novalidate><div class="form-grid two">
        <label>Property<select name="property_id">${props.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select></label>
        ${rmField('Date', 'spent_on', 'date', `value="${esc(rmToday())}"`)}
        ${rmField('Category', 'category', 'text', 'required maxlength="60" placeholder="e.g. Plumbing, Paint, Society charges"')}
        ${rmField('Amount (PKR)', 'amount', 'number', 'min="1" required')}</div>
      <label>Note<input name="note" maxlength="300"></label>
      <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">Save expense</button></form>`, { wide: true, label: 'Expense' });
    card.classList.add('gw-card');
  }
  function rmMaintForm(tenancyId) {
    const card = openModal(`<div class="eyebrow"><span></span> MAINTENANCE</div><h2>Report a problem</h2>
      <form class="modal-form" data-rm-maint="${esc(tenancyId)}" novalidate>
        ${rmField('What is the problem?', 'title', 'text', 'required maxlength="150" placeholder="e.g. Kitchen tap is leaking"')}
        <label>Details<textarea name="details" rows="3" maxlength="2000"></textarea></label>
        ${rmSel('How urgent?', 'urgency', { low: 'Not urgent', normal: 'Normal', urgent: 'Urgent' }, 'normal')}
        <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">Send to the landlord</button></form>`, { label: 'Report a problem' });
    card.classList.add('gw-card');
  }
  function rmConsentForm(ref) {
    const card = openModal(`<div class="eyebrow"><span></span> YOUR CONSENT</div><h2>Verification request</h2>
      <p class="modal-lead">A landlord has asked RAQBO to check some of your details before renting to you. Nothing is checked unless you agree.</p>
      <div class="oa-legal"><b>What may be checked, if you agree</b><p>Your identity details as you gave them, your current address, your employment and employer (by contacting them), your stated income, and references from a previous landlord or the people you name. <b>RAQBO does not run police or criminal-record checks.</b></p>
        <p>You can refuse. You can also withdraw later by telling RAQBO. Refusing may mean the landlord does not proceed, but it is your choice.</p></div>
      <form class="modal-form" data-rm-consent="${esc(ref)}" novalidate>
        <label class="check-row"><input type="checkbox" name="agree" required> I have read the above and I consent to these checks being made.</label>
        <label>Anything you want to add or limit<textarea name="text" rows="2" maxlength="1000" placeholder="e.g. Please do not contact my current employer before 20 December."></textarea></label>
        <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">Give my consent</button></form>`, { wide: true, label: 'Consent' });
    card.classList.add('gw-card');
  }
  function rmLawyerForm(p) {
    p = p || {};
    const card = openModal(`<div class="eyebrow"><span></span> LEGAL PROFESSIONAL</div><h2>${p.id ? 'Edit my professional profile' : 'Register as a legal professional'}</h2>
      <p class="modal-lead">RAQBO verifies your enrolment with the bar council before your profile is shown to the public.</p>
      <form class="modal-form" data-rm-lawyer novalidate>
        <div class="form-grid two">${rmField('Full name', 'name', 'text', `required maxlength="120" value="${esc(p.name || (db.session && db.session.name) || '')}"`)}
          ${rmField('Qualification', 'qualification', 'text', `maxlength="200" value="${esc(p.qualification || '')}" placeholder="LLB, LLM"`)}
          ${rmField('Bar council', 'bar_council', 'text', `maxlength="120" value="${esc(p.bar_council || '')}" placeholder="e.g. Punjab Bar Council"`)}
          ${rmField('Enrolment number', 'enrolment_no', 'text', `maxlength="80" value="${esc(p.enrolment_no || '')}"`)}
          ${rmField('Years of practice', 'years', 'number', `min="0" max="70" value="${esc(p.years || '')}"`)}
          ${rmField('City', 'city', 'text', `maxlength="60" value="${esc(p.city || '')}"`)}
          ${rmField('Languages', 'languages', 'text', `maxlength="120" value="${esc(p.languages || '')}" placeholder="Urdu, English, Punjabi"`)}
          ${rmField('Consultation fee (PKR)', 'fee', 'number', `min="0" value="${esc(p.fee || 0)}"`)}</div>
        <fieldset><legend>I advise on</legend><div class="chip-row">${Object.entries(RM_MATTER).map(([k, v]) => `<label class="chip-check"><input type="checkbox" name="specialities" value="${k}" ${(p.specialities || []).includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div></fieldset>
        <fieldset><legend>Consultation types I offer</legend><div class="chip-row">${Object.entries(RM_MODE).map(([k, v]) => `<label class="chip-check"><input type="checkbox" name="modes" value="${k}" ${(p.modes || ['phone']).includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div></fieldset>
        <label>About you<textarea name="profile" rows="3" maxlength="2000">${esc(p.profile || '')}</textarea></label>
        <label>Practising certificate / bar card (kept private)<input type="file" name="docs" accept="application/pdf,image/*" multiple></label>
        <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">${p.id ? 'Save profile' : 'Send for verification'}</button></form>`, { wide: true, label: 'Legal professional' });
    card.classList.add('gw-card');
  }
  function rmRentAll() {
    const rows = (rm.rent || []); const props = rm.props || []; const tens = rm.tenants || []; const ys = rm.tenancies || [];
    const card = openModal(`<div class="eyebrow"><span></span> RENT RECORDS</div><h2>All rent records</h2>
      <table class="gw-table"><thead><tr><th>Month</th><th>Property / tenant</th><th>Due</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => { const y = ys.find((x) => x.id === r.tenancy_id) || {}; const p = props.find((x) => x.id === y.property_id) || {}; const t = tens.find((x) => x.id === y.tenant_id) || {}; const [lab, cls] = RM_RENTST[r.status] || ['', ''];
        return `<tr><td>${esc(rmMonth(r.period))}</td><td>${esc(p.title || '')}<br><small>${esc(t.name || '')}</small></td><td>${esc(rmDay(r.due_on))}</td><td>${esc(rs(r.amount))}${r.paid_amount ? `<br><small>${esc(rs(r.paid_amount))} paid</small>` : ''}</td><td><span class="pay-pill ${cls}">${esc(lab)}</span></td><td>${r.receipt_no ? `<button type="button" class="link-button" data-rm="receipt" data-id="${esc(r.id)}">Receipt</button>` : `<button type="button" class="link-button" data-rm="rent-pay" data-id="${esc(r.id)}">Record</button>`}</td></tr>`; }).join('') || '<tr><td colspan="6">No rent records yet.</td></tr>'}</tbody></table>`, { wide: true, label: 'Rent records' });
    card.classList.add('gw-card');
  }
  function rmRemind() {
    const over = (rm.rent || []).filter((r) => ['due', 'overdue', 'part_paid'].includes(r.status));
    if (!over.length) { toast('No rent is outstanding.'); return; }
    const ys = rm.tenancies || []; const tens = rm.tenants || []; const props = rm.props || [];
    const items = over.map((r) => { const y = ys.find((x) => x.id === r.tenancy_id) || {}; const t = tens.find((x) => x.id === y.tenant_id) || {}; const p = props.find((x) => x.id === y.property_id) || {};
      const msg = `Assalam o Alaikum ${t.name || ''}. This is a reminder that the rent for ${rmMonth(r.period)} for ${p.title || 'the property'} is ${rs(r.amount - r.paid_amount)}, due on ${rmDay(r.due_on)}. Please transfer it to the account we agreed. Thank you.`;
      return { r, t, msg }; });
    const card = openModal(`<div class="eyebrow"><span></span> REMINDERS</div><h2>Send rent reminders</h2>
      <p class="modal-lead">${items.length} tenant${items.length === 1 ? '' : 's'} with rent outstanding. Open WhatsApp with the message ready — you send it yourself.</p>
      <div class="rm-remind">${items.map((x) => `<div class="rm-remind-row"><div><b>${esc(x.t.name || 'Tenant')}</b><small>${esc(rmMonth(x.r.period))} · ${esc(rs(x.r.amount - x.r.paid_amount))}</small></div>${x.t.phone ? `<a class="button button-outline" href="https://wa.me/${esc(String(x.t.phone).replace(/[^0-9]/g, ''))}?text=${encodeURIComponent(x.msg)}" target="_blank" rel="noopener">${DI(DIC.chat, 15)} WhatsApp</a>` : '<small class="form-hint">No phone number saved</small>'}</div>`).join('')}</div>
      <p class="form-hint">RAQBO does not send messages on your behalf — this opens WhatsApp with the text ready so you stay in control.</p>`, { wide: true, label: 'Reminders' });
    card.classList.add('gw-card');
  }
  function rmStatement(propId) {
    const s = rm.sum || {}; const props = rm.props || []; const ys = rm.tenancies || []; const tens = rm.tenants || [];
    const p = propId ? props.find((x) => x.id === propId) : null;
    const yIds = p ? ys.filter((y) => y.property_id === p.id).map((y) => y.id) : null;
    const rent = (rm.rent || []).filter((r) => !yIds || yIds.includes(r.tenancy_id));
    const exp = (rm.exp || []).filter((e) => !p || e.property_id === p.id);
    const income = rent.reduce((a, r) => a + r.paid_amount, 0); const spent = exp.reduce((a, e) => a + +e.amount, 0);
    const idl = typeof v3fIdLine === 'function' ? v3fIdLine() : '';
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the statement.'); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Rental statement</title>${RM_TAG('style')}body{font:13px/1.6 system-ui,sans-serif;max-width:760px;margin:36px auto;padding:0 18px;color:#111}h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:22px 0 6px}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border-bottom:1px solid #e8e8e8;padding:7px 4px;text-align:left}th{color:#666;font-weight:600}tfoot td{font-weight:700;border-top:2px solid #333}@media print{button{display:none}}${RM_END('style')}
      <h1>${p ? 'Property statement' : 'Annual rental summary'}</h1><small>${esc(idl || 'RAQBO')} · ${esc((db.session && db.session.name) || '')} · ${esc(rmDay(s.from))} to ${esc(rmDay(s.to))}</small>
      ${p ? `<p><b>${esc(p.title)}</b><br>${esc([p.address, p.area, p.city].filter(Boolean).join(', '))}</p>` : ''}
      <h2>Rent received</h2><table><thead><tr><th>Month</th><th>Tenant</th><th>Due</th><th>Received</th><th>Date</th><th>Receipt</th></tr></thead><tbody>${rent.filter((r) => r.paid_amount > 0).map((r) => { const y = ys.find((x) => x.id === r.tenancy_id) || {}; const t = tens.find((x) => x.id === y.tenant_id) || {};
        return `<tr><td>${esc(rmMonth(r.period))}</td><td>${esc(t.name || '')}</td><td>${esc(rs(r.amount))}</td><td>${esc(rs(r.paid_amount))}</td><td>${esc(rmDay(r.paid_on))}</td><td>${esc(r.receipt_no || '')}</td></tr>`; }).join('') || '<tr><td colspan="6">No rent received in this period.</td></tr>'}</tbody><tfoot><tr><td colspan="3">Total received</td><td colspan="3">${esc(rs(income))}</td></tr></tfoot></table>
      <h2>Expenses</h2><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Amount</th></tr></thead><tbody>${exp.map((e) => `<tr><td>${esc(rmDay(e.spent_on))}</td><td>${esc(e.category)}</td><td>${esc(e.note || '')}</td><td>${esc(rs(e.amount))}</td></tr>`).join('') || '<tr><td colspan="4">No expenses recorded.</td></tr>'}</tbody><tfoot><tr><td colspan="3">Total expenses</td><td>${esc(rs(spent))}</td></tr></tfoot></table>
      <h2>Summary</h2><table><tbody><tr><td>Rent received</td><td>${esc(rs(income))}</td></tr><tr><td>Expenses</td><td>${esc(rs(spent))}</td></tr><tr><td>Still outstanding</td><td>${esc(rs(rent.reduce((a, r) => a + (['due', 'part_paid', 'overdue'].includes(r.status) ? r.amount - r.paid_amount : 0), 0)))}</td></tr></tbody><tfoot><tr><td>Net</td><td>${esc(rs(income - spent))}</td></tr></tfoot></table>
      <p><small>Prepared from the records you entered on RAQBO. This is not a tax return or an audited statement — check the figures before relying on them.</small></p>
      <button onclick="print()">Print / save as PDF</button>`);
    w.document.close();
  }
  function rmCsv() {
    const ys = rm.tenancies || []; const tens = rm.tenants || []; const props = rm.props || [];
    const rows = [['Type', 'Date', 'Property', 'Tenant', 'Description', 'Amount', 'Status', 'Reference']];
    (rm.rent || []).forEach((r) => { const y = ys.find((x) => x.id === r.tenancy_id) || {}; const p = props.find((x) => x.id === y.property_id) || {}; const t = tens.find((x) => x.id === y.tenant_id) || {};
      rows.push(['Rent', r.paid_on || r.due_on, p.title || '', t.name || '', rmMonth(r.period) + ' rent', r.paid_amount || 0, r.status, r.receipt_no || '']); });
    (rm.exp || []).forEach((e) => { const p = props.find((x) => x.id === e.property_id) || {}; rows.push(['Expense', e.spent_on, p.title || '', '', e.category + (e.note ? ' — ' + e.note : ''), -e.amount, '', '']); });
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'raqbo-rental-records.csv'; a.click();
  }

  // ---------- Admin clicks ----------
  async function rmAdminClick(a) {
    const k = a.dataset.rma;
    if (k === 'reload') { rm.admin = null; rmAdminLoad(admin.tab); return; }
    if (k === 'tax-off') { try { await RM.saveTax({ id: +a.dataset.id || a.dataset.id, active: false }); rm.admin = null; rmAdminLoad('rm-tax'); toast('Rate switched off.'); } catch (err) { toast(err.message); } }
  }

  // ---------- Live-updating filters & calculators ----------
  document.addEventListener('input', (e) => {
    const cf = e.target.closest('[data-rm-cfilters]'); if (cf) { clearTimeout(rm.ft); rm.ft = setTimeout(() => rmApplyCFilters(cf), 300); return; }
    const y = e.target.closest('[data-rm-yield]'); if (y) { clearTimeout(rm.yt); rm.yt = setTimeout(() => rmYieldPaint(y), 200); }
  });
  document.addEventListener('change', (e) => {
    const cf = e.target.closest('[data-rm-cfilters]'); if (cf) { clearTimeout(rm.ft); rmApplyCFilters(cf); return; }
    const y = e.target.closest('[data-rm-yield]'); if (y) rmYieldPaint(y);
    // commercial fields appear on the listing form when the type is Commercial
    const t = e.target.closest('[name=type]'); if (t) rmListingFields(t);
  });
  function rmApplyCFilters(f) { const fd = new FormData(f); Object.keys(rm.cf).forEach((k) => { if (['parking', 'income'].includes(k)) rm.cf[k] = fd.has(k); else if (fd.has(k)) rm.cf[k] = String(fd.get(k)); }); rmPaintCommercial(f.closest('.modal-card') || document); }
  function rmListingFields(sel) {
    const form = sel.closest('form'); if (!form) return;
    let box = $('.rm-cfields', form);
    if (sel.value !== 'Commercial') { if (box) box.hidden = true; return; }
    if (box) { box.hidden = false; return; }
    const html = `<div class="rm-cfields"><h4>${DI(DIC.store, 16)} Commercial details</h4>
      <div class="modal-form-row"><label>Commercial kind<select name="commercial_kind">${Object.entries(RM_CKIND).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label>Covered area (sq ft)<input name="covered_area" type="number" min="0"></label></div>
      <div class="modal-form-row"><label>Floor<input name="floor_no" maxlength="40" placeholder="Ground, 3rd…"></label><label>Building name<input name="building_name" maxlength="120"></label></div>
      <div class="modal-form-row"><label>Security deposit (PKR)<input name="security_deposit" type="number" min="0"></label><label>Advance rent (months)<input name="advance_rent_months" type="number" min="0" max="36"></label></div>
      <div class="modal-form-row"><label>Lease period (months)<input name="lease_months" type="number" min="1" max="240"></label><label>Yearly increase (%)<input name="escalation_pct" type="number" min="0" max="100" step="0.5"></label></div>
      <div class="modal-form-row"><label>Available from<input name="available_from" type="date"></label><label>Maintenance charges (PKR/month)<input name="maintenance_charges" type="number" min="0"></label></div>
      <div class="modal-form-row"><label>Parking spaces<input name="parking_spaces" type="number" min="0"></label><label>Monthly income, if let (PKR)<input name="monthly_income" type="number" min="0"></label></div>
      <label>Electricity &amp; other utilities<input name="utilities_note" maxlength="300" placeholder="e.g. separate meters, 3-phase connection"></label>
      <label>Parking &amp; access<input name="access_notes" maxlength="300" placeholder="e.g. main boulevard access, loading bay"></label>
      <p class="form-hint">These appear on your advert and in the commercial search filters.</p></div>`;
    const row = sel.closest('.modal-form-row') || sel.closest('label');
    if (row) row.insertAdjacentHTML('afterend', html);
  }
  // Keep the extra commercial fields when the listing is saved
  { const base = typeof DB === 'object' && DB && DB.addListing ? null : null;
    document.addEventListener('submit', (e) => {
      const f = e.target; if (!f.matches('form') || !f.querySelector('[name=commercial_kind]')) return;
      const box = $('.rm-cfields', f); if (!box || box.hidden) return;
      const extra = {}; $$('input,select', box).forEach((i) => { if (i.name && i.value !== '') extra[i.name] = /^(covered_area|security_deposit|advance_rent_months|lease_months|escalation_pct|maintenance_charges|parking_spaces|monthly_income)$/.test(i.name) ? +i.value : i.value; });
      rm.pendingCommercial = extra;
    }, true); }

  // ---------- Submits ----------
  const rmErrBox = (f, m) => { const x = $('.form-error', f); if (x) { x.hidden = false; x.textContent = m; x.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } else toast(m); };
  const rmData = (f) => { const o = {}; new FormData(f).forEach((v, k) => { if (o[k] === undefined) o[k] = typeof v === 'string' ? v.trim() : v; }); return o; };
  document.addEventListener('submit', async (e) => {
    const f = e.target; let m;
    if ((m = f.closest('[data-rm-prop]'))) { e.preventDefault(); const d = rmData(m); const done = busy($('button[type=submit]', m), 'Saving…');
      try { const p = { title: d.title, kind: d.kind, city: d.city, area: d.area, address: d.address, notes: d.notes, size: d.size ? +d.size : null, size_unit: d.size_unit }; if (m.dataset.rmProp) p.id = m.dataset.rmProp;
        await RM.saveProp(p); closeModal(); await rmLoad(true); openMy('landlord'); toast('Saved.'); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-tenant]'))) { e.preventDefault(); const d = rmData(m); const done = busy($('button[type=submit]', m), 'Saving…');
      try { const t = { name: d.name, phone: d.phone, email: d.email, cnic_last4: String(d.cnic_last4 || '').replace(/\D/g, '').slice(-4), address: d.address, employer: d.employer, notes: d.notes }; if (m.dataset.rmTenant) t.id = m.dataset.rmTenant;
        await RM.saveTenant(t); closeModal(); await rmLoad(true); openMy('landlord'); toast('Saved.'); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-tenancy]'))) { e.preventDefault(); const d = rmData(m); const done = busy($('button[type=submit]', m), 'Saving…');
      try { const y = { property_id: d.property_id, tenant_id: d.tenant_id, rent: +d.rent, rent_period: d.rent_period, due_day: +d.due_day || 1, deposit: +d.deposit || 0, advance_months: +d.advance_months || 0, starts_on: d.starts_on, ends_on: d.ends_on || null, escalation_pct: +d.escalation_pct || 0, escalation_months: +d.escalation_months || 12, maintenance_by: d.maintenance_by, utilities_by: d.utilities_by, other_terms: d.other_terms };
        if (m.dataset.rmTenancy) y.id = m.dataset.rmTenancy;
        const saved = await RM.saveTenancy(y);
        if (new FormData(m).has('build')) { try { await RM.buildRent(saved.id, 12); } catch { /* ignore */ } }
        closeModal(); await rmLoad(true); openMy('landlord'); toast('Tenancy saved.'); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-pay]'))) { e.preventDefault(); const d = rmData(m); const done = busy($('button[type=submit]', m), 'Saving…');
      try { const rc = await RM.payRent(m.dataset.rmPay, +d.amount, d.paid_on, d.method, d.reference, d.note); closeModal(); await rmLoad(true); openMy('landlord'); toast('Recorded. Receipt ' + rc); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-exp]'))) { e.preventDefault(); const d = rmData(m); const done = busy($('button[type=submit]', m), 'Saving…');
      try { await RM.addExpense({ property_id: d.property_id, spent_on: d.spent_on, category: d.category, amount: +d.amount, note: d.note }); closeModal(); await rmLoad(true); openMy('landlord'); toast('Expense saved.'); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-maint]'))) { e.preventDefault(); const d = rmData(m); const done = busy($('button[type=submit]', m), 'Sending…');
      try { const r = await RM.tenantMaint(m.dataset.rmMaint, d.title, d.details, d.urgency); closeModal(); openMy('tenant'); toast('Sent to your landlord. Reference ' + r); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-screen]'))) { e.preventDefault(); const d = rmData(m);
      if (!new FormData(m).has('agree')) { rmErrBox(m, 'Please confirm the tenant knows about this request.'); return; }
      const done = busy($('button[type=submit]', m), 'Sending…');
      try { const supplied = {}; ['address', 'employer', 'job_title', 'income', 'prev_landlord', 'prev_landlord_phone', 'reference'].forEach((k) => { if (d[k]) supplied[k] = d[k]; });
        const r = await RM.tsRequest(m.dataset.rmScreen || null, d.name, d.phone, d.email, supplied);
        closeModal(); await rmLoad(true); openMy('landlord'); toast('Sent. ' + (d.email ? 'The tenant has been asked for consent.' : 'Ask the tenant to sign in with this email so they can give consent.') + ' Reference ' + r); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-consent]'))) { e.preventDefault(); const d = rmData(m);
      if (!new FormData(m).has('agree')) { rmErrBox(m, 'Tick the box to give your consent, or close this and choose Refuse.'); return; }
      const done = busy($('button[type=submit]', m), 'Saving…');
      try { await RM.tsConsent(m.dataset.rmConsent, true, d.text); closeModal(); openMy('tenant'); toast('Consent recorded. Thank you.'); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-lawyer]'))) { e.preventDefault(); const d = rmData(m); const fd = new FormData(m); const done = busy($('button[type=submit]', m), 'Sending…');
      try { const docs = []; const inp = m.querySelector('[name=docs]');
        if (SB && inp) for (const file of inp.files) { const path = `${rmMe()}/${Date.now().toString(36)}-${file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-50)}`; const { error } = await SB.storage.from('legal-docs').upload(path, file, { contentType: file.type }); if (!error) docs.push({ path, name: file.name }); }
        await RM.lawyerApply({ name: d.name, qualification: d.qualification, bar_council: d.bar_council, enrolment_no: d.enrolment_no, years: d.years, city: d.city, languages: d.languages, fee: d.fee, profile: d.profile, specialities: fd.getAll('specialities'), modes: fd.getAll('modes').length ? fd.getAll('modes') : ['phone'], docs });
        closeModal(); rm.lawyer = null; openMy('lawyer'); toast('Sent. RAQBO will check your enrolment with the bar council.'); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-legal]'))) { e.preventDefault(); const d = rmData(m); const done = busy($('button[type=submit]', m), 'Sending…');
      if (String(d.summary || '').trim().length < 10) { done(); rmErrBox(m, 'Please describe the matter in a sentence or two.'); return; }
      requireSignIn(async () => { try { const docs = []; const inp = m.querySelector('[name=docs]');
          if (SB && inp) for (const file of inp.files) { const path = `${rmMe()}/${Date.now().toString(36)}-${file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-50)}`; const { error } = await SB.storage.from('legal-docs').upload(path, file, { contentType: file.type }); if (!error) docs.push({ path, name: file.name }); }
          const r = await RM.book({ lawyer_id: d.lawyer_id || null, matter: d.matter, mode: d.mode, summary: d.summary, preferred_at: d.preferred_at ? new Date(d.preferred_at).toISOString() : null, docs });
          closeModal(); openMy('legal'); toast('Request sent. Reference ' + r + '. RAQBO will confirm the appointment.'); } catch (err) { done(); rmErrBox(m, err.message); } }); return; }
    if ((m = f.closest('[data-rm-tax]'))) { e.preventDefault(); const d = rmData(m); const out = $('[data-rm-taxout]', m.closest('.v3e-page')); const done = busy($('button[type=submit]', m), 'Working it out…');
      try { const r = await RM.tax(d.province, d.district, d.category, +d.price || 0, +d.valuation || 0, d.filer === '1', d.on || null); done(); rmTaxOut(out, r, d.side, new FormData(m).has('overseas')); } catch (err) { done(); rmErrBox(m, err.message); } return; }
    if ((m = f.closest('[data-rm-lease]'))) { e.preventDefault(); const d = rmData(m); const go = (e.submitter && e.submitter.dataset.go) || 'preview';
      for (const [k, lab] of [['ll_name', 'the landlord\'s name'], ['tn_name', 'the tenant\'s name'], ['addr', 'the property address'], ['rent', 'the monthly rent'], ['start', 'the start date']]) { if (!String(d[k] || '').trim()) { rmErrBox(m, 'Please enter ' + lab + '.'); return; } }
      const x = $('.form-error', m); if (x) x.hidden = true;
      if (go === 'preview') { const { html } = rmLeaseText(d); const out = $('[data-rm-leaseout]', m.closest('.v3e-page'));
        out.innerHTML = `<div class="rm-leasedoc">${html}</div><div class="button-row"><button type="button" class="button button-primary" data-rm-leasego="pdf">Download PDF</button><button type="button" class="button button-outline" data-rm-leasego="doc">Download editable document</button></div>`;
        rm.lease = d; out.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      rm.lease = d; rmLeaseOpen(d, go); return; }
    // admin forms
    if ((m = f.closest('[data-rma-managed]'))) { e.preventDefault(); try { await RM.setManaged(m.dataset.rmaManaged, m.status.value, m.fee.value ? +m.fee.value : null); rm.admin = null; rmAdminLoad('rm-rental'); toast('Saved.'); } catch (err) { toast(err.message); } return; }
    if ((m = f.closest('[data-rma-ts]'))) { e.preventDefault(); try { const v = {}; String(m.verified.value || '').split(',').forEach((pair) => { const [a, b] = pair.split('='); if (a && a.trim()) v[a.trim()] = (b || 'yes').trim(); });
        await RM.tsAdmin(m.dataset.rmaTs, m.status.value, v, m.note.value.trim()); rm.admin = null; rmAdminLoad('rm-screening'); toast('Saved.'); } catch (err) { toast(err.message); } return; }
    if ((m = f.closest('[data-rma-lawyer]'))) { e.preventDefault(); try { await RM.setLawyer(m.dataset.rmaLawyer, m.status.value, m.note.value.trim()); rm.admin = null; rmAdminLoad('rm-legal'); toast('Saved.'); } catch (err) { toast(err.message); } return; }
    if ((m = f.closest('[data-rma-appt]'))) { e.preventDefault(); try { await RM.updateAppt(m.dataset.rmaAppt, m.status.value, m.at.value ? new Date(m.at.value + ':00+05:00').toISOString() : null, '', m.fee_status.value || null); rm.admin = null; rmAdminLoad('rm-legal'); toast('Saved.'); } catch (err) { toast(err.message); } return; }
    if ((m = f.closest('[data-rma-tax]'))) { e.preventDefault(); const d = rmData(m); const done = busy($('button[type=submit]', m), 'Saving…');
      try { await RM.saveTax(d); done(); m.reset(); rm.admin = null; rmAdminLoad('rm-tax'); toast('Rate saved.'); } catch (err) { done(); toast(err.message); } return; }
  });
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-rm-leasego]'); if (g && rm.lease) rmLeaseOpen(rm.lease, g.dataset.rmLeasego); });

  // ---------- Routes ----------
  function rmRoute() { const h = location.hash;
    if (h === '#commercial') { openCommercial(); return true; }
    if (h === '#legal') { openLegal(); return true; }
    if (h === '#tax' || h === '#stamp-duty') { openTax(); return true; }
    if (h === '#lease') { openLease(); return true; }
    if (h === '#yield') { openYield(); return true; }
    return false; }
  addEventListener('hashchange', rmRoute);
  if (/^#(commercial|legal|tax|stamp-duty|lease|yield)$/.test(location.hash)) setTimeout(rmRoute, 900);

  // Commercial rail on the homepage
  RAILS.push(() => { const l = db.listings.filter((x) => x.status === 'published' && rmIsCommercial(x));
    return l.length ? { id: 'rail-commercial', kicker: 'COMMERCIAL & INVESTMENT', title: 'Commercial & investment properties', sub: 'Offices, shops, warehouses and income-generating property — with lease terms and commercial filters.', list: l, html: l.slice(0, 10).map(rmCCard).join(''), action: ['All commercial', 'commercial'] } : null; });
  { const base = typeof coreRailAction === 'function' ? coreRailAction : null; if (base) { /* keep */ } }
  document.addEventListener('click', (e) => { const r = e.target.closest('[data-core="rail"][data-to="commercial"]'); if (r) { e.preventDefault(); e.stopImmediatePropagation(); openCommercial(); } }, true);
