  // =====================================================================
  const pnField = (label, name, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
  const pnArea = (label, name, extra = '') => `<label>${label}<textarea name="${name}" rows="3" ${extra}></textarea></label>`;
  const pnSel = (label, name, opts, val) => `<label>${label}<select name="${name}">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === String(val || '') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;

  async function openPartnerApply(prefer) {
    closeNavMenus(); if (pf.my.open) closeMy();
    if (!db.session) { toast('Please sign in first — your application is kept on your RAQBO account.'); openAuth && openAuth(); return; }
    const card = openModal('<div class="pn-page"><div class="admin-empty">Opening the form…</div></div>', { wide: true, label: 'Apply for RAQBO partnership' });
    card.classList.add('gw-card', 'ax-modal');
    try { if (location.hash !== '#partner-apply') history.replaceState(null, '', '#partner-apply'); } catch { /* ignore */ }
    const d = await pnLoadPub();
    let existing = null; try { existing = await PN.mine(); } catch { /* ignore */ }
    let terrs = []; try { terrs = await PN.territories('', ''); } catch { /* ignore */ }
    const host = $('.pn-page', card); if (!host) return;
    if (existing && !['rejected', 'withdrawn'].includes(existing.stage)) { pnPaintApplicationStatus(host, existing); return; }
    if (d.settings && d.settings.network_open === false) {
      host.innerHTML = '<div class="admin-empty">RAQBO is not accepting partner applications at the moment. Please check again later.</div>';
      return;
    }
    const openTerr = terrs.filter((t) => ['available', 'additional_allowed', 'under_review'].includes(t.status));
    host.innerHTML = `
      <div class="pn-head"><span class="rail-kicker">${DI(DIC.plus, 14)} PARTNER APPLICATION</span>
        <h2>Apply for RAQBO Partnership</h2>
        <p class="admin-sub">${esc(PN_NOTE_RIGHTS)}</p></div>
      <form class="pn-form" data-pn-form="apply" novalidate>
        <fieldset><legend>Section A — Applicant information</legend>
          <div class="pn-grid">
            ${pnField('Full name *', 'full_name', 'text', 'required maxlength="120"')}
            ${pnField('CNIC number', 'cnic', 'text', 'maxlength="20" placeholder="35202-1234567-1"')}
            ${pnField('Mobile number *', 'phone', 'tel', 'required maxlength="20"')}
            ${pnField('WhatsApp number', 'whatsapp', 'tel', 'maxlength="20"')}
            ${pnField('Email address', 'email', 'email', 'maxlength="160"')}
            ${pnField('Residential address', 'home_address', 'text', 'maxlength="300"')}
            ${pnField('Business address', 'office_address', 'text', 'maxlength="300"')}
          </div>
          <label class="pn-photo-field">Profile photograph
            <input type="file" name="photo" accept="image/png,image/jpeg,image/webp">
            <small>A clear head-and-shoulders photograph. It is shown on your public partner profile once you are appointed.</small></label>
          ${pnArea('Professional background', 'background', 'maxlength="1500" placeholder="What you have done in property, and for how long."')}
          <p class="pn-note">RAQBO keeps only the last four digits of your CNIC on file. The full card is checked in person or on a call and is never stored on the website.</p>
        </fieldset>

        <fieldset><legend>Section B — Business status</legend>
          <div class="pn-grid">
            ${pnSel('You are applying as *', 'business_type', PN_BIZ, 'individual')}
            ${pnField('Business name', 'business_name', 'text', 'maxlength="160"')}
            ${pnField('NTN', 'ntn', 'text', 'maxlength="30"')}
            ${pnField('Business registration number', 'registration_no', 'text', 'maxlength="60"')}
            ${pnField('Property-dealer licence or registration', 'dealer_licence', 'text', 'maxlength="80"')}
            ${pnField('Years in business', 'business_years', 'number', 'min="0" max="80"')}
          </div>
          ${pnArea('Existing office details', 'office_details', 'maxlength="600"')}
          ${pnArea('Professional affiliations', 'affiliations', 'maxlength="400" placeholder="Associations or bodies you belong to."')}
        </fieldset>

        <fieldset><legend>Section C — Preferred territory</legend>
          <div class="pn-grid">
            ${pnField('Province', 'province', 'text', 'maxlength="60"')}
            ${pnField('District', 'district', 'text', 'maxlength="60"')}
            ${pnField('City', 'city', 'text', 'maxlength="60"')}
            ${pnField('Tehsil', 'tehsil', 'text', 'maxlength="60"')}
            ${pnField('Specific area you want to work in', 'area_wanted', 'text', 'maxlength="200" placeholder="Housing society, commercial area or locality"')}
            <label>An area RAQBO has already mapped<select name="territory_id"><option value="">Not from the list</option>${openTerr.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.city && t.city !== t.name ? ', ' + esc(t.city) : ''} — ${esc(PN_TSTATUS[t.status] || t.status)}</option>`).join('')}</select></label>
          </div>
          <label class="chip-check"><input type="checkbox" name="has_office"> I already have an office in this area</label>
        </fieldset>

        <fieldset><legend>Section D — Partnership preference</legend>
          <div class="pn-radios">${Object.entries(PN_CAT).map(([k, c]) => `<label class="chip-check"><input type="radio" name="want_category" value="${k}" ${k === (prefer || 'area') ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}
            <label class="chip-check"><input type="radio" name="want_category" value="open"> Open to a suitable arrangement</label></div>
        </fieldset>

        <fieldset><legend>Section E — Experience and resources</legend>
          <div class="pn-grid">
            ${pnField('Years of property-business experience', 'exp_years', 'number', 'min="0" max="80"')}
            ${pnField('Number of staff', 'staff_count', 'number', 'min="0" max="5000"')}
          </div>
          ${pnArea('Existing customer network', 'customer_network', 'maxlength="600"')}
          ${pnArea('Marketing you already do', 'marketing', 'maxlength="600"')}
          ${pnArea('Other relevant skills', 'skills', 'maxlength="600"')}
          ${pnArea('Property you currently have on your books', 'inventory_note', 'maxlength="600"')}
          <b class="pn-sub">Property categories you handle</b>
          <div class="chip-row">${['Houses', 'Plots', 'Apartments', 'Commercial', 'Agricultural', 'Industrial', 'Rentals'].map((c) => `<label class="chip-check"><input type="checkbox" name="cat_${c.toLowerCase()}" value="${esc(c)}"> ${esc(c)}</label>`).join('')}</div>
        </fieldset>

        <fieldset><legend>Section F — Services you can handle</legend>
          <div class="chip-row">${PN_WORK.map(([k, t]) => `<label class="chip-check"><input type="checkbox" name="svc_${k}" value="${k}"> ${esc(t)}</label>`).join('')}</div>
        </fieldset>

        <fieldset><legend>Section G — Supporting documents</legend>
          <p class="pn-note">CNIC, business registration, licence and anything else RAQBO asks for. Documents are stored privately and only RAQBO staff reviewing your application can open them.</p>
          <input type="file" name="docs" multiple accept=".pdf,.jpg,.jpeg,.png,.webp">
          <div class="pn-docs" data-pn-docs></div>
          <small class="pn-note">Each file is uploaded when you send the form. Only RAQBO staff reviewing your application can open them.</small>
        </fieldset>

        <fieldset><legend>Section H — Declaration</legend>
          <label class="chip-check pn-declare"><input type="checkbox" name="declared" required>
            I confirm that the information I have given is accurate, that this application does not by itself grant me any partnership right, and that any appointment depends on verification, approval by RAQBO and a signed agreement.</label>
        </fieldset>

        <div class="form-error" hidden></div>
        <div class="pn-cta"><button type="submit" class="button button-primary">${DI(DIC.check, 16)} Send my application</button>
          <button type="button" class="button button-light" data-pn="how">How partnership works</button></div>
      </form>`;
    applyBrandIcons(host);
  }

  function pnPaintApplicationStatus(host, a) {
    const i = PN_STEPS.findIndex(([k]) => k === a.stage);
    host.innerHTML = `
      <div class="pn-head"><span class="rail-kicker">${DI(DIC.clock, 14)} YOUR APPLICATION</span>
        <h2>Application ${esc(a.ref || '')}</h2>
        <p class="admin-sub">Sent ${esc(pnDate(a.created_at))}. RAQBO will contact you on ${esc(a.phone || 'the number you gave')}.</p></div>
      ${a.stage === 'rejected'
        ? `<div class="admin-empty">RAQBO is not able to take this application forward. ${esc(a.reject_reason || '')}</div>`
        : `<ol class="pn-steps pn-steps-live">${PN_STEPS.map(([k, t], n) => `<li class="${n < i ? 'done' : n === i ? 'now' : ''}"><span>${n + 1}</span><b>${esc(t)}</b></li>`).join('')}</ol>`}
      ${a.stage_note ? `<div class="pn-box"><b>Latest note from RAQBO</b><p>${esc(a.stage_note)}</p></div>` : ''}
      <div class="pn-box"><b>What you sent</b>
        <div class="pn-kv"><span>Name</span><b>${esc(a.full_name || '')}</b></div>
        <div class="pn-kv"><span>Applying as</span><b>${esc(PN_BIZ[a.business_type] || a.business_type || '')}</b></div>
        <div class="pn-kv"><span>Preferred category</span><b>${esc((PN_CAT[a.want_category] || {}).name || 'Open to a suitable arrangement')}</b></div>
        <div class="pn-kv"><span>Area wanted</span><b>${esc(a.area_wanted || a.city || '—')}</b></div>
        <div class="pn-kv"><span>Services offered</span><b>${esc((a.services || []).map((k) => PN_WORK_NAME[k] || k).join(', ') || '—')}</b></div>
      </div>
      <p class="pn-note">${esc(PN_NOTE_RIGHTS)}</p>`;
    applyBrandIcons(host);
  }

