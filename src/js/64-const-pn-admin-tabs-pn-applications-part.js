  // =====================================================================
  const PN_ADMIN_TABS = [['pn-applications', 'Partner applications'], ['pn-partners', 'Partners'],
    ['pn-territories', 'Territories'], ['pn-leads', 'Lead distribution'], ['pn-money', 'Commission & payments']];

  try {
    Object.assign(AX_ICON, { 'pn-applications': 'doc', 'pn-partners': 'users', 'pn-territories': 'pin', 'pn-leads': 'trend', 'pn-money': 'bank' });
    Object.assign(AX_HINT, {
      'pn-applications': 'Applications, verification, interviews and appointment',
      'pn-partners': 'Appointed partners, status, powers, agreements and training',
      'pn-territories': 'Map areas, allocate them and control exclusivity',
      'pn-leads': 'Send customers to partners and watch the response time',
      'pn-money': 'Commission rates, approvals, statements and payments'
    });
  } catch { /* icons are cosmetic */ }

  { const base = v3AdminTabs; v3AdminTabs = function () {
      const t = base(); const d = pn.admin && pn.admin.summary;
      const i = t.findIndex(([k]) => k === '#r');
      const rows = [['#pn', 'PARTNER NETWORK'],
        ['pn-applications', 'Partner applications', d ? (d.applications_new || '') : ''],
        ['pn-partners', 'Partners', d ? (d.partners_review || '') : ''],
        ['pn-territories', 'Territories', ''],
        ['pn-leads', 'Lead distribution', d ? ((d.leads_waiting || 0) + (d.leads_overdue || 0) || '') : ''],
        ['pn-money', 'Commission & payments', d ? (d.commission_disputed || '') : '']];
      t.splice(i >= 0 ? i : t.length, 0, ...rows);
      return t; }; }

  const pnAdminShell = (title, sub, body) => `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> PARTNER NETWORK</div><h2>${esc(title)}</h2><p class="admin-sub">${sub}</p></div><button type="button" class="admin-refresh" data-pna="reload">Refresh</button></div>${body}</div>`;

  async function pnAdminLoad(tab) {
    const what = { 'pn-applications': 'applications', 'pn-partners': 'partners', 'pn-territories': 'territories',
      'pn-leads': 'leads', 'pn-money': 'money' }[tab] || 'summary';
    try {
      const [summary, data, partners] = await Promise.all([PN.admin('summary'), PN.admin(what),
        ['pn-territories', 'pn-leads', 'pn-money'].includes(tab) ? PN.admin('partners') : Promise.resolve(null)]);
      pn.admin = { ...(pn.admin || {}), summary, err: '' };
      if (partners) pn.admin.partners = partners;
      pn.admin[what] = data;
    } catch (e) { pn.admin = { ...(pn.admin || {}), err: e.message }; }
    pn.adminAt = Date.now();
    if (admin.el && !admin.el.hidden) renderAdmin();
  }
  const pnAdminBusy = (tab) => { if (!pn.adminBusy) { pn.adminBusy = true; pnAdminLoad(tab).finally(() => { pn.adminBusy = false; }); } };
  const pnK = (list) => `<div class="v3x-kpis v3x-kgrid">${list.map(([a, b]) => `<div class="v3x-kpi"><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('')}</div>`;

  V3_ADMIN['pn-applications'] = () => {
    const d = pn.admin || {}; if (!d.applications || Date.now() - pn.adminAt > 25000) pnAdminBusy('pn-applications');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const list = d.applications || []; const s = d.summary || {};
    const open = list.filter((a) => !['activated', 'rejected', 'withdrawn'].includes(a.stage));
    return pnAdminShell('Partner applications', 'Review, verify, interview and appoint. An application grants no rights, and a partner is not active until the agreement is executed and training is finished.',
      `${pnK([['New applications', s.applications_new || 0], ['In progress', s.applications_open || 0], ['Partners active', s.partners_active || 0], ['Awaiting activation', s.partners_review || 0]])}
      <h3>Applications</h3>
      ${open.length ? open.map((a) => pnAppRow(a)).join('') : '<div class="admin-empty">No applications are waiting.</div>'}
      ${list.length > open.length ? `<h3>Closed</h3><table class="gw-table"><thead><tr><th>Applicant</th><th>Area</th><th>Outcome</th></tr></thead><tbody>
        ${list.filter((a) => ['activated', 'rejected', 'withdrawn'].includes(a.stage)).map((a) => `<tr><td>${esc(a.full_name)}<br><small>${esc(a.ref)}</small></td><td>${esc(a.area_wanted || a.city || '—')}</td><td>${esc(a.stage)}${a.reject_reason ? '<br><small>' + esc(a.reject_reason) + '</small>' : ''}</td></tr>`).join('')}</tbody></table>` : ''}`);
  };

  function pnAppRow(a) {
    const i = PN_STEPS.findIndex(([k]) => k === a.stage);
    const score = PN_ASSESS.reduce((n, [k]) => n + (+a['score_' + k] || 0), 0);
    return `<details class="oa-arow"><summary><b>${esc(a.full_name)}</b> — ${esc(a.area_wanted || a.city || 'area not given')} · ${esc((PN_CAT[a.want_category] || {}).name || 'Open')} <span class="pn-badge">${esc((PN_STEPS[i] || [, a.stage])[1] || a.stage)}</span></summary>
      <div class="pn-appbody">
        <div class="pn-kv"><span>Reference</span><b>${esc(a.ref)}</b></div>
        <div class="pn-kv"><span>Applying as</span><b>${esc(PN_BIZ[a.business_type] || a.business_type || '')}${a.business_name ? ' — ' + esc(a.business_name) : ''}</b></div>
        <div class="pn-kv"><span>Contact</span><b>${esc(a.phone || '')}${a.email ? ' · ' + esc(a.email) : ''}</b></div>
        <div class="pn-kv"><span>CNIC on file</span><b>${a.cnic_last4 ? '•••• ' + esc(a.cnic_last4) : 'Not given'}</b></div>
        <div class="pn-kv"><span>NTN / registration</span><b>${esc(a.ntn || '—')}${a.registration_no ? ' · ' + esc(a.registration_no) : ''}</b></div>
        <div class="pn-kv"><span>Licence</span><b>${esc(a.dealer_licence || '—')}</b></div>
        <div class="pn-kv"><span>Experience</span><b>${esc(a.exp_years || 0)} years · ${esc(a.staff_count || 0)} staff · office: ${a.has_office ? 'yes' : 'no'}</b></div>
        <div class="pn-kv"><span>Services offered</span><b>${esc((a.services || []).map((k) => PN_WORK_NAME[k] || k).join(', ') || '—')}</b></div>
        ${a.background ? `<div class="pn-kv"><span>Background</span><b>${esc(a.background)}</b></div>` : ''}
        ${a.customer_network ? `<div class="pn-kv"><span>Customer network</span><b>${esc(a.customer_network)}</b></div>` : ''}
        <div class="pn-kv"><span>Documents</span><b>${esc((a.doc_paths || []).length)} uploaded</b></div>

        <form class="pn-form pn-inline" data-pna-review="${esc(a.id)}">
          <b class="pn-sub">Assessment — total ${esc(score)} of 45</b>
          <div class="pn-scores">${PN_ASSESS.map(([k, t]) => `<label>${esc(t)}<select name="score_${k}"><option value="">—</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${String(a['score_' + k] || '') === String(n) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('')}</div>
          <div class="pn-grid">
            <label class="chip-check"><input type="checkbox" name="identity_verified" ${a.identity_verified ? 'checked' : ''}> Identity verified</label>
            <label class="chip-check"><input type="checkbox" name="business_verified" ${a.business_verified ? 'checked' : ''}> Business verified</label>
            <label>Interview<input type="datetime-local" name="interview_at" value="${esc(a.interview_at ? String(a.interview_at).slice(0, 16) : '')}"></label>
          </div>
          <label>Interview note<textarea name="interview_note" rows="2" maxlength="1500">${esc(a.interview_note || '')}</textarea></label>
          <button type="submit" class="button button-light">Save assessment</button>
        </form>

        <form class="pn-form pn-inline" data-pna-stage="${esc(a.id)}">
          <div class="pn-grid"><label>Move to<select name="stage">${PN_STEPS.concat([['rejected', 'Rejected']]).map(([k, t]) => `<option value="${k}" ${k === a.stage ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label>Note to the applicant<input name="note" maxlength="300"></label></div>
          <button type="submit" class="button button-light">Update stage</button>
        </form>

        <form class="pn-form pn-inline" data-pna-approve="${esc(a.id)}">
          <b class="pn-sub">Appoint as a partner</b>
          <div class="pn-grid"><label>Category<select name="category">${Object.entries(PN_CAT).map(([k, c]) => `<option value="${k}" ${k === a.want_category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label>Designation<input name="designation" placeholder="Leave empty for the standard wording" maxlength="120"></label></div>
          <button type="submit" class="button button-primary">Appoint</button>
          <p class="pn-note">Appointing creates the partner record and the RAQBO Partner ID. The account stays inactive until an agreement is executed and the training is complete.</p>
        </form>
      </div></details>`;
  }

  V3_ADMIN['pn-partners'] = () => {
    const d = pn.admin || {}; if (!d.partners || Date.now() - pn.adminAt > 25000) pnAdminBusy('pn-partners');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const list = d.partners || []; const s = d.summary || {};
    return pnAdminShell('Partners', 'Status, powers, territories, agreements and training. A partner cannot be made active without an executed agreement and finished training.',
      `${pnK([['Active', s.partners_active || 0], ['Awaiting activation', s.partners_review || 0], ['Suspended or ended', s.partners_suspended || 0], ['Partner listings', s.partner_listings || 0], ['Agreements expiring', s.agreements_expiring || 0], ['Documents expiring', s.documents_expiring || 0]])}
      ${list.length ? list.map((p) => `<details class="oa-arow"><summary><b>${esc(p.display_name)}</b> — ${esc(p.partner_id)} · ${esc((PN_CAT[p.category] || {}).name || p.category)}
          <span class="pn-badge ${p.status === 'active' ? 'ok' : ''}">${esc(PN_PSTATUS[p.status] || p.status)}</span></summary>
        <div class="pn-appbody">
          <div class="pn-kv"><span>Designation</span><b>${esc(p.designation || '—')}</b></div>
          <div class="pn-kv"><span>Agreement</span><b>${p.agreement_ok ? 'In force' : (p.agreement || 'none')}</b></div>
          <div class="pn-kv"><span>Training</span><b>${p.training_done ? 'Complete' : 'Not finished'}</b></div>
          <div class="pn-kv"><span>Areas</span><b>${esc((p.territories || []).map((t) => t.name + (t.exclusive ? ' (exclusive)' : '')).join(', ') || 'none allocated')}</b></div>
          <div class="pn-kv"><span>Open leads</span><b>${esc(p.leads_open || 0)}</b></div>
          <div class="pn-kv"><span>Approved and owed</span><b>${esc(pnMoney(p.owed))}</b></div>

          <form class="pn-form pn-inline" data-pna-status="${esc(p.partner_id)}">
            <div class="pn-grid"><label>Status<select name="status">${Object.entries(PN_PSTATUS).map(([k, t]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
              <label>Reason<input name="note" maxlength="300"></label></div>
            <button type="submit" class="button button-light">Save status</button></form>

          <form class="pn-form pn-inline" data-pna-powers="${esc(p.partner_id)}">
            <b class="pn-sub">What this partner may do</b>
            <div class="chip-row">${PN_WORK.map(([k, t]) => `<label class="chip-check"><input type="checkbox" name="svc_${k}" ${(p.services || []).includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
            <div class="pn-grid"><label>Designation<input name="designation" value="${esc(p.designation || '')}" maxlength="120"></label></div>
            <div class="chip-row">
              <label class="chip-check"><input type="checkbox" name="branding_approved" ${p.branding_approved ? 'checked' : ''}> Branding approved (name only)</label>
              <label class="chip-check"><input type="checkbox" name="office_branding" ${p.office_branding ? 'checked' : ''}> Full office branding (franchise only)</label>
              <label class="chip-check"><input type="checkbox" name="may_collect_money" ${p.may_collect_money ? 'checked' : ''}> May take money for RAQBO (written authority)</label>
              <label class="chip-check"><input type="checkbox" name="may_run_auction" ${p.may_run_auction ? 'checked' : ''}> May run a RAQBO auction (written authority)</label>
              <label class="chip-check"><input type="checkbox" name="listed" ${p.listed === false ? '' : 'checked'}> Show in the public directory</label></div>
            <button type="submit" class="button button-light">Save</button></form>

          <form class="pn-form pn-inline" data-pna-agreement="${esc(p.partner_id)}">
            <b class="pn-sub">Agreement</b>
            <div class="pn-grid">
              ${['parties', 'relationship', 'services', 'territory_text'].map((k) => `<label>${esc((PN_AGREEMENT_ITEMS.find(([x]) => x === k) || [, k])[1])}<input name="${k}" maxlength="600"></label>`).join('')}
              <label>Exclusive or non-exclusive<select name="exclusivity"><option value="non_exclusive">Non-exclusive</option><option value="exclusive">Exclusive</option></select></label>
              <label>Starts<input type="date" name="starts_on"></label><label>Ends<input type="date" name="ends_on"></label>
              ${['renewal', 'commission_text', 'lead_allocation', 'local_expenses', 'brand_use', 'data_protection', 'reporting', 'restrictions', 'disputes', 'termination', 'after_termination']
                .map((k) => `<label>${esc((PN_AGREEMENT_ITEMS.find(([x]) => x === k) || [, k])[1])}<input name="${k}" maxlength="800"></label>`).join('')}
            </div>
            ${p.category === 'franchise' ? `<div class="pn-franchise">
              <b class="pn-sub">Franchise terms</b>
              <div class="pn-grid">
                <label>Initial franchise fee (PKR)<input type="number" name="franchise_fee" min="0" step="1000" value="0"></label>
                <label>Brand royalty (% of service fees)<input type="number" name="royalty_pct" min="0" max="100" step="0.5" value="0"></label>
                <label>Or a fixed monthly royalty (PKR)<input type="number" name="royalty_monthly" min="0" step="1000" value="0"></label>
                <label>Office setup standards<input name="office_standards" maxlength="800"></label>
                <label>Marketing commitment<input name="marketing_commitment" maxlength="800"></label>
                <label>Technology access<input name="technology_access" maxlength="800"></label>
                <label>Staff training<input name="staff_training" maxlength="800"></label>
                <label>Minimum performance<input name="min_performance" maxlength="800"></label>
              </div>
              <p class="pn-note">A franchise agreement cannot be recorded as executed until at least one of the fee, the royalty or a written commission arrangement is filled in.</p>
            </div>` : ''}
            <div class="chip-row">
              <label class="chip-check"><input type="checkbox" name="territory_entitlement"> The partner is entitled to a share on any transaction in the territory</label>
              <label class="chip-check"><input type="checkbox" name="legal_reviewed"> Legally reviewed</label></div>
            <div class="pn-grid"><label>Record as<select name="status"><option value="draft">Draft</option><option value="sent">Sent for signature</option><option value="executed">Executed</option><option value="terminated">Terminated</option></select></label></div>
            <button type="submit" class="button button-light">Save agreement</button>
            <p class="pn-note">An agreement can only be recorded as executed once it is marked legally reviewed. Executing one is what allows the partner to be made active.</p></form>

          ${(p.listings || []).length ? `<div class="pn-plist">
            <b class="pn-sub">Properties this partner has put up</b>
            <table class="gw-table"><thead><tr><th>Property</th><th>Where</th><th>Owner said yes</th><th>Advert ends</th><th>Remove</th></tr></thead><tbody>
            ${(p.listings || []).map((l) => `<tr>
              <td><b>${esc(l.title || l.ref)}</b><small>${esc(l.ref)} · ${esc(l.status)}</small></td>
              <td>${esc([l.area, l.city].filter(Boolean).join(', '))}</td>
              <td>${l.owner_authorised ? 'Yes' : '<em>Not confirmed</em>'}</td>
              <td>${esc(l.advert_expires_on || '—')}</td>
              <td><form class="pn-assign" data-pna-takedown="${esc(l.id)}"><input name="reason" maxlength="300" placeholder="Why it is being removed" required><button type="submit" class="button button-text">Take down</button></form></td>
            </tr>`).join('')}</tbody></table>
            <p class="pn-note">Taking a listing down records the reason, tells the partner, and leaves a permanent note on their record.</p>
          </div>` : ''}

          <form class="pn-form pn-inline" data-pna-feedback="${esc(p.partner_id)}">
            <b class="pn-sub">Customer feedback</b>
            ${p.rating && p.rating.count ? `<p class="pn-note">${pnStars(p.rating)} from ${esc(p.rating.count)} customer${p.rating.count === 1 ? '' : 's'}${p.rating.low ? ' · ' + esc(p.rating.low) + ' poor' : ''}</p>`
              : '<p class="pn-note">No customer has rated this partner yet.</p>'}
            <div class="pn-grid">
              <label>Rating<select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n} out of 5</option>`).join('')}</select></label>
              <label>Customer<input name="customer" maxlength="120" placeholder="Who gave this feedback"></label>
            </div>
            <label>What they said<input name="comment" maxlength="1000"></label>
            <button type="submit" class="button button-light">Record feedback</button>
            <p class="pn-note">Record only what a customer actually told RAQBO. This feeds the partner&rsquo;s rating and their performance review.</p></form>
        </div></details>`).join('')
        : '<div class="admin-empty">No partner has been appointed yet.</div>'}`);
  };

  V3_ADMIN['pn-territories'] = () => {
    const d = pn.admin || {}; if (!d.territories || Date.now() - pn.adminAt > 25000) pnAdminBusy('pn-territories');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const list = d.territories || []; const s = d.summary || {}; const partners = (d.partners || []).filter((p) => ['active', 'probation', 'under_review'].includes(p.status));
    return pnAdminShell('Territories', 'Province, division, district, tehsil, city, town, housing society, commercial area or a described boundary. Exclusivity is granted deliberately, never automatically.',
      `${pnK([['Areas mapped', s.territories_total || 0], ['Open for applications', s.territories_open || 0], ['Partners active', s.partners_active || 0]])}
      <form class="pn-form pn-inline" data-pna-territory>
        <b class="pn-sub">Add or change an area</b>
        <div class="pn-grid">
          <label>Level<select name="level">${Object.entries(PN_LEVEL).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
          <label>Name<input name="name" maxlength="120" placeholder="DHA Phase 5"></label>
          <label>Province<input name="province" maxlength="60"></label>
          <label>Division<input name="division" maxlength="60"></label>
          <label>District<input name="district" maxlength="60"></label>
          <label>Tehsil<input name="tehsil" maxlength="60"></label>
          <label>City<input name="city" maxlength="60"></label>
          <label>Status<select name="status">${Object.entries(PN_TSTATUS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
          <label>How many partners allowed<input type="number" name="max_partners" value="1" min="1" max="50"></label>
        </div>
        <label>Boundary, in words<textarea name="boundary_note" rows="2" maxlength="600"></textarea></label>
        <button type="submit" class="button button-primary">Save area</button></form>
      ${list.length ? `<table class="gw-table"><thead><tr><th>Area</th><th>Where</th><th>Status</th><th>Partners</th><th>Allocate</th></tr></thead><tbody>
        ${list.map((t) => `<tr>
          <td><b>${esc(t.name)}</b><br><small>${esc(PN_LEVEL[t.level] || t.level)} · ${esc(t.code || '')}</small></td>
          <td>${esc([t.city, t.district, t.province].filter(Boolean).join(', ') || '—')}</td>
          <td>${esc(PN_TSTATUS[t.status] || t.status)}${t.exclusive ? '<br><small>Exclusive</small>' : ''}<br><small>max ${esc(t.max_partners || 1)}</small></td>
          <td>${(t.partners || []).length ? (t.partners || []).map((p) => `${esc(p.name || p.partner_id)}${p.exclusive ? ' (exclusive)' : ''} <button type="button" class="pn-x" data-pna="unassign" data-k="${esc(p.partner_id)}" data-t="${esc(t.id)}" title="Remove">×</button>`).join('<br>') : '<small>none</small>'}</td>
          <td><form class="pn-assign" data-pna-assign="${esc(t.id)}"><select name="partner_id"><option value="">Choose a partner</option>${partners.map((p) => `<option value="${esc(p.partner_id)}">${esc(p.display_name)}</option>`).join('')}</select>
            <label class="chip-check"><input type="checkbox" name="exclusive"> Exclusive</label>
            <button type="submit" class="button button-light">Allocate</button></form></td></tr>`).join('')}</tbody></table>`
        : '<div class="admin-empty">No area has been mapped yet. Add the first one above.</div>'}`);
  };

  V3_ADMIN['pn-leads'] = () => {
    const d = pn.admin || {}; if (!d.leads || Date.now() - pn.adminAt > 25000) pnAdminBusy('pn-leads');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const list = d.leads || []; const s = d.summary || {}; const partners = (d.partners || []).filter((p) => ['active', 'probation'].includes(p.status));
    const open = list.filter((l) => !['completed', 'lost'].includes(l.stage));
    return pnAdminShell('Lead distribution', 'Every customer is routed by area, service, authorisation, availability and workload. A lead nobody accepts in time comes back here.',
      `${pnK([['Waiting to be sent', s.leads_waiting || 0], ['With a partner', s.leads_assigned || 0], ['Past the deadline', s.leads_overdue || 0], ['Open altogether', s.leads_open || 0]])}
      <div class="pn-cta"><button type="button" class="button button-light" data-pna="sweep">Return the leads nobody answered</button>
        <button type="button" class="button button-light" data-pna="newlead">Record a lead by hand</button></div>
      ${open.length ? `<table class="gw-table"><thead><tr><th>Customer</th><th>Where</th><th>Stage</th><th>Partner</th><th>Action</th></tr></thead><tbody>
        ${open.map((l) => `<tr>
          <td><b>${esc(l.customer_name || 'Not named')}</b><br><small>${esc(l.ref)} · ${esc(l.kind)}${l.service ? ' · ' + esc(l.service) : ''}</small>${l.customer_note ? '<br><small>' + esc(l.customer_note) + '</small>' : ''}</td>
          <td>${esc([l.area, l.city, l.province].filter(Boolean).join(', ') || '—')}</td>
          <td>${esc((PN_LEAD_STEPS.find(([k]) => k === l.stage) || [, l.stage])[1])}${l.stage === 'assigned' && l.accept_by ? `<br><small>answer by ${esc(new Date(l.accept_by).toLocaleString('en-GB'))}</small>` : ''}${l.reassigned ? `<br><small>reassigned ${esc(l.reassigned)}×</small>` : ''}</td>
          <td>${esc(l.partner_name || (l.handled_by_raqbo ? 'RAQBO directly' : '—'))}</td>
          <td><form class="pn-assign" data-pna-lead="${esc(l.ref)}"><select name="partner_id"><option value="">Send to…</option>${partners.map((p) => `<option value="${esc(p.partner_id)}">${esc(p.display_name)}</option>`).join('')}</select>
            <button type="submit" class="button button-light">Assign</button>
            <button type="button" class="button button-ghost" data-pna="take" data-k="${esc(l.ref)}">RAQBO handles it</button></form></td></tr>`).join('')}</tbody></table>`
        : '<div class="admin-empty">No customer is waiting.</div>'}`);
  };

  V3_ADMIN['pn-money'] = () => {
    const d = pn.admin || {}; if (!d.money || Date.now() - pn.adminAt > 25000) pnAdminBusy('pn-money');
    if (d.err) return `<div class="admin-empty">${esc(d.err)}</div>`;
    const m = d.money || {}; const s = d.summary || {}; const partners = d.partners || [];
    return pnAdminShell('Commission & payments', 'Commission is worked out on the service fee RAQBO actually received, never on the property price. A payment needs approval and a traceable bank reference.',
      `${pnK([['Waiting for approval', pnMoney(s.commission_pending)], ['Approved and owed', pnMoney(s.commission_approved)], ['Being queried', s.commission_disputed || 0], ['Transactions', (m.transactions || []).length]])}
      <h3>Commission rates</h3>
      <p class="admin-sub">Set by category, by service and by who brought the customer in. The figures that came with RAQBO are illustrative only — replace them before appointing anyone.</p>
      <table class="gw-table"><thead><tr><th>Category</th><th>Service</th><th>Lead from</th><th>Partner share</th><th>From</th><th></th></tr></thead><tbody>
        ${(m.rates || []).map((r) => `<tr><td>${esc((PN_CAT[r.category] || {}).name || r.category)}</td><td>${esc(r.service)}</td><td>${esc(r.lead_source)}</td>
          <td><form class="pn-assign" data-pna-rate="${esc(r.id)}"><input type="number" name="partner_pct" value="${esc(r.partner_pct)}" min="0" max="100" step="0.5"> %
            <button type="submit" class="button button-light">Save</button></form></td>
          <td>${esc(pnDate(r.effective_from))}</td><td>${r.active ? '' : '<small>off</small>'}</td></tr>`).join('')}</tbody></table>
      <form class="pn-form pn-inline" data-pna-newrate>
        <b class="pn-sub">Add a rate</b>
        <div class="pn-grid">
          <label>Category<select name="category">${Object.entries(PN_CAT).map(([k, c]) => `<option value="${k}">${esc(c.name)}</option>`).join('')}</select></label>
          <label>Service<input name="service" placeholder="any" maxlength="60"></label>
          <label>Lead from<select name="lead_source"><option value="any">Either</option><option value="partner">The partner</option><option value="raqbo">RAQBO</option></select></label>
          <label>Partner share %<input type="number" name="partner_pct" min="0" max="100" step="0.5" value="40"></label>
          <label>Effective from<input type="date" name="effective_from"></label>
          <label>Note<input name="note" maxlength="200"></label>
        </div><button type="submit" class="button button-light">Add rate</button></form>

      <h3>Transactions and commission</h3>
      <form class="pn-form pn-inline" data-pna-tx>
        <b class="pn-sub">Record a transaction</b>
        <div class="pn-grid">
          <label>Partner<select name="partner_id">${partners.map((p) => `<option value="${esc(p.partner_id)}">${esc(p.display_name)}</option>`).join('')}</select></label>
          <label>Service<input name="service" maxlength="60" placeholder="sale, rent, verification…"></label>
          <label>Lead came from<select name="lead_source"><option value="partner">The partner</option><option value="raqbo">RAQBO</option></select></label>
          <label>What it was<input name="description" maxlength="200"></label>
          <label>Property value (for the file)<input type="number" name="property_value" min="0"></label>
          <label>Service fee charged<input type="number" name="gross_fee" min="0"></label>
          <label>Fee RAQBO received<input type="number" name="fee_received" min="0"></label>
          <label>Tax deducted<input type="number" name="tax_deduction" min="0" value="0"></label>
          <label>Third-party charges<input type="number" name="third_party" min="0" value="0"></label>
          <label>Refunded<input type="number" name="refunded" min="0" value="0"></label>
          <label>Other deduction<input type="number" name="other_deduction" min="0" value="0"></label>
          <label>Completed on<input type="date" name="completed_on"></label>
        </div>
        <label>Note on the deductions<input name="deduction_note" maxlength="300"></label>
        <button type="submit" class="button button-primary">Save and work out the commission</button>
        <p class="pn-note">No commission is created until the fee RAQBO received is above zero.</p></form>
      ${(m.transactions || []).length ? `<table class="gw-table"><thead><tr><th>Transaction</th><th>Partner</th><th>Fee received</th><th>Share</th><th>Commission</th><th>Action</th></tr></thead><tbody>
        ${(m.transactions || []).map((x) => { const c = x.commission || {}; return `<tr>
          <td><b>${esc(x.ref)}</b><br><small>${esc(x.service || '')} · ${esc(x.description || '')}</small></td>
          <td>${esc(x.partner_name || '')}</td><td>${esc(pnMoney(x.fee_received))}</td>
          <td>${c.rate_pct != null ? esc(c.rate_pct) + '%' : '—'}</td>
          <td>${c.amount != null ? '<b>' + esc(pnMoney(c.amount)) + '</b><br><small>' + esc(c.status) + '</small>' : '<small>none yet</small>'}</td>
          <td>${c.ref ? `<form class="pn-assign" data-pna-cm="${esc(c.ref)}"><select name="status">${['pending', 'approved', 'paid', 'disputed', 'rejected', 'cancelled'].map((k) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
            <input name="note" placeholder="note" maxlength="200"><button type="submit" class="button button-light">Save</button></form>${c.dispute_note ? '<small>Query: ' + esc(c.dispute_note) + '</small>' : ''}` : ''}</td></tr>`; }).join('')}</tbody></table>` : ''}

      <h3>Payments to partners</h3>
      <form class="pn-form pn-inline" data-pna-payout>
        <div class="pn-grid"><label>Partner<select name="partner_id">${partners.map((p) => `<option value="${esc(p.partner_id)}">${esc(p.display_name)} — ${esc(pnMoney(p.owed))} owed</option>`).join('')}</select></label>
          <label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label></div>
        <button type="submit" class="button button-light">Gather approved commission into a payment</button></form>
      ${(m.payouts || []).length ? `<table class="gw-table"><thead><tr><th>Payment</th><th>Partner</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
        ${(m.payouts || []).map((o) => `<tr><td>${esc(o.ref)}<br><small>${esc(pnDate(o.period_from))} – ${esc(pnDate(o.period_to))}</small></td>
          <td>${esc(o.partner_name || '')}</td><td><b>${esc(pnMoney(o.amount))}</b></td><td>${esc(o.status)}${o.reference ? '<br><small>' + esc(o.reference) + '</small>' : ''}</td>
          <td><form class="pn-assign" data-pna-po="${esc(o.ref)}"><select name="status"><option value="draft">draft</option><option value="approved" ${o.status === 'approved' ? 'selected' : ''}>approved</option><option value="paid" ${o.status === 'paid' ? 'selected' : ''}>paid</option><option value="cancelled">cancelled</option></select>
            <input name="reference" placeholder="Bank reference" value="${esc(o.reference || '')}" maxlength="120"><button type="submit" class="button button-light">Save</button></form></td></tr>`).join('')}</tbody></table>`
        : '<div class="admin-empty">No payment has been prepared yet.</div>'}
      <p class="pn-note">Partners are paid through traceable banking channels only. A payment must be approved by a full admin, and the bank reference is required before it can be marked paid.</p>

      <h3>Network settings</h3>
      <form class="pn-form pn-inline" data-pna-settings>
        <div class="pn-grid">
          <label class="chip-check"><input type="checkbox" name="network_open" checked> Accepting partner applications</label>
          <label class="chip-check"><input type="checkbox" name="directory_public" checked> Public partner directory switched on</label>
          <label class="chip-check"><input type="checkbox" name="franchise_open"> Full franchises open</label>
          <label>Hours to accept a lead<input type="number" name="lead_accept_hours" min="1" max="168" value="24"></label>
          <label>Hours to contact the customer<input type="number" name="lead_contact_hours" min="1" max="336" value="48"></label>
        </div>
        <label>Note shown on the Become a Partner page<textarea name="intro_note" rows="2" maxlength="1200"></textarea></label>
        <label>Pilot note<textarea name="pilot_note" rows="2" maxlength="600"></textarea></label>
        <button type="submit" class="button button-light">Save settings</button></form>`);
  };

