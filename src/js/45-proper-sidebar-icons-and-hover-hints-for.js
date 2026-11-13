  // =====================================================================
  // Proper sidebar icons and hover hints for the new admin sections
  try {
    Object.assign(AX_ICON, { oa: 'gavel', 'rm-rental': 'home', 'rm-commercial': 'store', 'rm-screening': 'shield', 'rm-legal': 'scale', 'rm-tax': 'bank' });
    Object.assign(AX_HINT, {
      oa: 'Official and institutional auction notices',
      'rm-rental': 'Landlord properties, tenancies, rent and maintenance',
      'rm-commercial': 'Commercial listings, leasing enquiries and lease status',
      'rm-screening': 'Tenant verification applications and consent records',
      'rm-legal': 'Lawyer profiles, verification and appointments',
      'rm-tax': 'Stamp duty, registration and advance-tax rates'
    });
  } catch { /* icons are cosmetic */ }

  { const base = v3AdminTabs; v3AdminTabs = function () { const t = base(); const d = rm.admin && rm.admin.summary;
      const i = t.findIndex((x) => x[0] === 'svcfees');
      t.splice(i >= 0 ? i : t.length, 0, ['#r', 'RENTAL & LEGAL'], ['rm-rental', 'Rental management', d ? (d.rent_overdue_n || '') : ''], ['rm-commercial', 'Commercial leasing', ''], ['rm-screening', 'Tenant verification', d ? (d.screening_open || '') : ''], ['rm-legal', 'Legal consultations', d ? ((d.lawyers_pending || 0) + (d.appointments_open || 0)) || '' : ''], ['rm-tax', 'Property tools & tax', '']);
      return t; }; }
  async function rmAdminLoad(tab) {
    rm.adminAt = Date.now(); await new Promise((r) => setTimeout(r, 0));
    try { const what = { 'rm-rental': 'properties', 'rm-commercial': 'commercial', 'rm-screening': 'screening', 'rm-legal': 'legal', 'rm-tax': 'tax' }[tab] || 'summary';
      const [sum, data] = await Promise.all([RM.admin('summary'), what === 'summary' ? null : RM.admin(what)]);
      rm.admin = { ...(rm.admin || {}), summary: sum, [what]: data, err: null };
    } catch (err) { rm.admin = { ...(rm.admin || {}), err: err.message }; }
    if (admin.el && !admin.el.hidden && String(admin.tab).startsWith('rm-')) { const b = $('.ax-body', admin.el); if (b) b.innerHTML = V3_ADMIN[admin.tab](); }
  }
  const rmAdminShell = (title, sub, body) => `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> RENTAL &amp; LEGAL</div><h2>${esc(title)}</h2><p class="admin-sub">${sub}</p></div><button type="button" class="admin-refresh" data-rma="reload">Refresh</button></div>${body}</div>`;
  const rmAdminBusy = (tab) => { if (!rm.adminBusy) { rm.adminBusy = true; rmAdminLoad(tab).finally(() => { rm.adminBusy = false; }); } };
  V3_ADMIN['rm-rental'] = () => {
    const d = rm.admin || {}; if (!d.properties || Date.now() - rm.adminAt > 25000) rmAdminBusy('rm-rental');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const s = d.summary || {}; const list = d.properties || [];
    return rmAdminShell('Rental management', 'Landlord accounts, RAQBO-managed properties, tenancies, rent and maintenance. RAQBO never holds rental income — the money goes straight to the landlord.',
      `<div class="v3x-kpis v3x-kgrid">${[['Landlord properties', s.rm_properties || 0], ['RAQBO-managed', s.rm_managed || 0], ['Management requests', s.rm_requested || 0], ['Active tenancies', s.tenancies_active || 0], ['Rent overdue', s.rent_overdue_n || 0], ['Open maintenance', s.maintenance_open || 0]].map(([a, b]) => `<div class="v3x-kpi"><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('')}</div>
      <h3>Management requests &amp; managed properties</h3>
      ${list.length ? `<table class="gw-table"><thead><tr><th>Property</th><th>Owner</th><th>Status</th><th>Fee</th><th></th></tr></thead><tbody>${list.map((p) => `<tr><td><b>${esc(p.title)}</b><br><small>${esc([p.area, p.city].filter(Boolean).join(', '))} · ${esc(p.ref || '')} · ${p.tenancies ? esc(p.tenancies) + ' active tenancy' : 'vacant'}</small></td><td>${esc(p.owner || '')}</td><td>${esc(p.mgmt_status)}</td><td>${p.mgmt_fee_pct ? esc(p.mgmt_fee_pct) + '%' : '—'}</td><td><form class="v3x-form" data-rma-managed="${esc(p.id)}"><select name="status"><option value="active">Active</option><option value="requested">Requested</option><option value="ended">Ended</option><option value="none">Self-managed</option></select><input name="fee" type="number" min="0" max="50" step="0.5" placeholder="Fee %" value="${esc(p.mgmt_fee_pct || '')}"><button class="button button-outline" type="submit">Save</button></form></td></tr>`).join('')}</tbody></table>`
        : '<div class="admin-empty">No landlord has asked RAQBO to manage a property yet.</div>'}
      <p class="form-hint">RAQBO-managed properties need a separate written management agreement with the owner before the service starts.</p>`);
  };
  V3_ADMIN['rm-commercial'] = () => {
    const d = rm.admin || {}; if (!d.commercial || Date.now() - rm.adminAt > 25000) rmAdminBusy('rm-commercial');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const list = d.commercial || [];
    return rmAdminShell('Commercial leasing', 'Commercial listings, leasing enquiries, inspections and lease status.',
      list.length ? `<table class="gw-table"><thead><tr><th>Property</th><th>Kind</th><th>For</th><th>Price</th><th>Status</th><th>Enquiries</th><th></th></tr></thead><tbody>${list.map((l) => `<tr><td><b>${esc(l.title)}</b><br><small>${esc([l.area, l.city].filter(Boolean).join(', '))} · ${esc(l.ref || '')}</small></td><td>${esc(RM_CKIND[l.kind] || 'Commercial')}</td><td>${esc(l.purpose === 'rent' ? 'Rent / lease' : 'Sale')}</td><td>${esc(rs(l.price))}</td><td>${esc(l.status)}</td><td>${esc(l.enquiries || 0)}</td><td><button type="button" class="link-button" data-open="${esc(l.id)}">Open</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="admin-empty">No commercial listings yet.</div>');
  };
  V3_ADMIN['rm-screening'] = () => {
    const d = rm.admin || {}; if (!d.screening || Date.now() - rm.adminAt > 25000) rmAdminBusy('rm-screening');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const list = d.screening || [];
    return rmAdminShell('Tenant verification', 'Verification applications, consent records, progress and completed reports. Nothing may be checked until the tenant has given consent.',
      list.length ? `${list.map((c) => `<details class="oa-arow"><summary><span class="pay-pill ${c.consent ? 'good' : 'wait'}">${c.consent ? 'Consent given' : 'No consent yet'}</span><b>${esc(c.tenant_name)}</b><small>${esc(c.ref)} · asked by ${esc(c.owner || '')} · ${esc(rmDay(c.created_at))} · ${esc(c.status)}</small></summary>
        <div class="oa-arow-body"><div class="rm-twocol"><div><h4>Supplied by the tenant</h4><table class="gw-table"><tbody>${Object.entries(c.supplied || {}).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td>${esc(String(v))}</td></tr>`).join('') || '<tr><td>Nothing supplied</td></tr>'}</tbody></table></div>
          <div><h4>Independently verified by RAQBO</h4><table class="gw-table"><tbody>${Object.entries(c.verified || {}).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td>${esc(String(v))}</td></tr>`).join('') || '<tr><td>Nothing verified yet</td></tr>'}</tbody></table></div></div>
          ${c.consent_text ? `<p class="form-hint">Consent wording: “${esc(c.consent_text)}”${c.consent_at ? ' · ' + esc(rmDay(c.consent_at)) : ''}</p>` : ''}
          <form class="v3x-form" data-rma-ts="${esc(c.ref)}"><select name="status"><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="rejected">Rejected</option></select><input name="verified" maxlength="300" placeholder="Verified items, e.g. employer_confirmed=yes, prev_landlord=contacted"><input name="note" maxlength="500" placeholder="Report note for the landlord"><button class="button button-outline" type="submit">Save</button></form>
          <p class="form-hint">${DI(DIC.lock, 13)} RAQBO does not provide police clearance or criminal-record checks. Only lawful, consented checks are recorded here.</p></div></details>`).join('')}`
        : '<div class="admin-empty">No screening requests yet.</div>');
  };
  V3_ADMIN['rm-legal'] = () => {
    const d = rm.admin || {}; if (!d.legal || Date.now() - rm.adminAt > 25000) rmAdminBusy('rm-legal');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const L = (d.legal && d.legal.lawyers) || []; const A = (d.legal && d.legal.appointments) || [];
    return rmAdminShell('Legal consultations', 'Lawyer profiles, professional verification, appointments, fees and feedback. Verify bar-council enrolment before approving a profile.',
      `<h3>Legal professionals <span class="admin-count">${L.length}</span></h3>
      ${L.length ? `<table class="gw-table"><thead><tr><th>Name</th><th>Enrolment</th><th>Fee</th><th>Status</th><th></th></tr></thead><tbody>${L.map((l) => `<tr><td><b>${esc(l.name)}</b><br><small>${esc(l.qualification || '')} · ${esc(l.city || '')}</small></td><td>${esc(l.bar_council || '—')}<br><small>${esc(l.enrolment_no || 'no enrolment number')}</small></td><td>${l.fee ? esc(rs(l.fee)) : '—'}</td><td>${esc(l.status)}${l.admin_note ? `<br><small>${esc(l.admin_note)}</small>` : ''}</td><td><form class="v3x-form" data-rma-lawyer="${esc(l.id)}"><select name="status"><option value="verified">Verify</option><option value="rejected">Reject</option><option value="suspended">Suspend</option><option value="pending">Back to pending</option></select><input name="note" maxlength="300" placeholder="How verified / reason"><button class="button button-outline" type="submit">Save</button></form></td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty">No legal professionals registered yet.</div>'}
      <h3>Appointments <span class="admin-count">${A.length}</span></h3>
      ${A.length ? `<table class="gw-table"><thead><tr><th>Matter</th><th>Client / lawyer</th><th>When</th><th>Fee</th><th>Status</th><th></th></tr></thead><tbody>${A.map((a) => `<tr><td><b>${esc(RM_MATTER[a.matter] || a.matter)}</b><br><small>${esc(a.ref)} · ${esc(RM_MODE[a.mode] || a.mode)}</small></td><td>${esc(a.who || '')}<br><small>${esc(a.lawyer || 'not assigned')}</small></td><td>${esc(a.confirmed_at ? rmDay(a.confirmed_at) : a.preferred_at ? rmDay(a.preferred_at) : '—')}</td><td>${a.fee ? esc(rs(a.fee)) + ' · ' + esc(a.fee_status) : '—'}</td><td>${esc(a.status)}${a.rating ? '<br>' + '★'.repeat(a.rating) : ''}</td><td><form class="v3x-form" data-rma-appt="${esc(a.ref)}"><select name="status"><option value="confirmed">Confirm</option><option value="completed">Completed</option><option value="cancelled">Cancel</option><option value="no_show">No show</option></select><input name="at" type="datetime-local"><select name="fee_status"><option value="">Fee unchanged</option><option value="paid">Fee paid</option><option value="waived">Fee waived</option></select><button class="button button-outline" type="submit">Save</button></form></td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty">No appointments yet.</div>'}
      <p class="form-hint">Confidential client documents are visible only to the client, the assigned legal professional and a full administrator.</p>`);
  };
  V3_ADMIN['rm-tax'] = () => {
    const d = rm.admin || {}; if (!d.tax || Date.now() - rm.adminAt > 25000) rmAdminBusy('rm-tax');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const rates = (d.tax && d.tax.rates) || []; const hist = (d.tax && d.tax.history) || [];
    return rmAdminShell('Property tools & tax', 'Stamp duty, registration and advance-tax rates, with effective dates and a record of every change. Rates are never written into the website — they are set here.',
      `<form class="v3x-form rm-taxform" data-rma-tax>
        <select name="province">${RM_PROV.map((p) => `<option>${esc(p)}</option>`).join('')}</select>
        <input name="district" maxlength="60" placeholder="District (blank = whole province)">
        <select name="prop_category"><option value="any">Any category</option><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="industrial">Industrial</option><option value="agricultural">Agricultural</option></select>
        <label>Effective from<input name="effective_from" type="date" value="${esc(rmToday())}"></label>
        <label>Stamp duty %<input name="stamp_duty_pct" type="number" step="0.001" min="0" placeholder="1"></label>
        <label>Registration %<input name="registration_pct" type="number" step="0.001" min="0" placeholder="1"></label>
        <label>Registration flat<input name="registration_flat" type="number" min="0" placeholder="0"></label>
        <label>Local fee %<input name="local_fee_pct" type="number" step="0.001" min="0"></label>
        <label>Buyer tax (filer) %<input name="buyer_tax_filer_pct" type="number" step="0.001" min="0"></label>
        <label>Buyer tax (non-filer) %<input name="buyer_tax_nonfiler_pct" type="number" step="0.001" min="0"></label>
        <label>Seller tax (filer) %<input name="seller_tax_filer_pct" type="number" step="0.001" min="0"></label>
        <label>Seller tax (non-filer) %<input name="seller_tax_nonfiler_pct" type="number" step="0.001" min="0"></label>
        <label>Other %<input name="other_pct" type="number" step="0.001" min="0"></label>
        <select name="basis"><option value="higher">Higher of price / valuation</option><option value="price">Price</option><option value="valuation">Official valuation</option></select>
        <input name="source_note" maxlength="200" placeholder="Source (e.g. Punjab Finance Act 2026)">
        <button class="button button-outline" type="submit">Add rate</button></form>
      ${rates.length ? `<table class="gw-table"><thead><tr><th>Where</th><th>From</th><th>Stamp</th><th>Registration</th><th>Buyer tax F/NF</th><th>Seller tax F/NF</th><th>Basis</th><th></th></tr></thead><tbody>${rates.map((r) => `<tr><td>${esc(r.province)}${r.district ? ' · ' + esc(r.district) : ''}<br><small>${esc(r.prop_category)}${r.source_note ? ' · ' + esc(r.source_note) : ''}</small></td><td>${esc(rmDay(r.effective_from))}${r.effective_to ? '<br><small>to ' + esc(rmDay(r.effective_to)) + '</small>' : ''}</td><td>${esc(r.stamp_duty_pct)}%</td><td>${esc(r.registration_pct)}%${+r.registration_flat ? ' + ' + esc(rs(r.registration_flat)) : ''}</td><td>${esc(r.buyer_tax_filer_pct)} / ${esc(r.buyer_tax_nonfiler_pct)}%</td><td>${esc(r.seller_tax_filer_pct)} / ${esc(r.seller_tax_nonfiler_pct)}%</td><td>${esc(r.basis)}</td><td><button type="button" class="link-button" data-rma="tax-off" data-id="${esc(r.id)}">${r.active === false ? 'Switched off' : 'Switch off'}</button></td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty">No rates published yet — the calculator sends people to the official portals until you add them.</div>'}
      <h3>Official links shown to visitors</h3>
      <table class="gw-table"><tbody><tr><td>Punjab e-Stamp portal</td><td><a href="${RM_LINKS.stamp}" target="_blank" rel="noopener nofollow">${esc(RM_LINKS.stamp.slice(8, 60))}…</a></td></tr><tr><td>FBR withholding rate card</td><td><a href="${RM_LINKS.fbr}" target="_blank" rel="noopener nofollow">fbr.gov.pk</a></td></tr><tr><td>Punjab Police tenant registration</td><td><a href="${RM_LINKS.trs}" target="_blank" rel="noopener nofollow">trs.punjabpolice.gov.pk</a></td></tr></tbody></table>
      ${hist.length ? `<h3>Rate change history</h3><ul class="oa-hist">${hist.slice(0, 20).map((h) => `<li><time>${esc(rmDay(h.at))}</time><b>${esc(h.action)}</b> · ${esc(h.actor_name)}${h.data && h.data.source_note ? ' — ' + esc(h.data.source_note) : ''}</li>`).join('')}</ul>` : ''}`);
  };

