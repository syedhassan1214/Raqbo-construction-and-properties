  // =====================================================================
  async function openLegal(matter) {
    closeNavMenus(); if (pf.my.open) closeMy();
    const card = openModal('<div class="rm-legal"><div class="my-loading">Loading legal professionals…</div></div>', { wide: true, label: 'Book a property legal consultation' });
    card.classList.add('gw-card');
    try { if (location.hash !== '#legal') history.replaceState(null, '', '#legal'); } catch { /* ignore */ }
    let lw = []; try { lw = await RM.lawyers(); } catch (err) { lw = []; rm.lawErr = err.message; }
    rm.lawyers = lw;
    const host = $('.rm-legal', card); if (!host) return;
    host.innerHTML = `<div class="eyebrow"><span></span> LEGAL &amp; DOCUMENTATION</div><h2>Book a Property Legal Consultation</h2>
      <p class="modal-lead">Connect with qualified legal professionals for advice and assistance concerning property transactions, agreements, documentation, tenancy matters, inheritance and property disputes.</p>
      ${lw.length ? `<div class="rm-lwgrid">${lw.map(rmLawyerCard).join('')}</div>` : `<div class="admin-empty">${esc(rm.lawErr || 'No legal professionals have been verified yet. You can still send your matter to RAQBO and it will arrange a qualified lawyer.')}</div>`}
      <h3>Tell us about the matter</h3>
      <form class="modal-form" data-rm-legal novalidate>
        <input type="hidden" name="lawyer_id" value="">
        <div class="form-grid two"><label>Type of legal matter<select name="matter">${Object.entries(RM_MATTER).map(([k, v]) => `<option value="${k}" ${k === matter ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label>Consultation type<select name="mode"><option value="phone">By telephone</option><option value="video">Online video</option><option value="physical">In person</option></select></label>
          <label>Preferred date &amp; time<input name="preferred_at" type="datetime-local"></label>
          <label>Chosen professional<input name="lawyer_name" readonly placeholder="Any available professional"></label></div>
        <label>Brief description of the matter<textarea name="summary" rows="4" required minlength="10" maxlength="3000" placeholder="What has happened, what you need, and any dates that matter."></textarea></label>
        <label>Upload relevant documents (kept confidential)<input type="file" name="docs" accept="application/pdf,image/*" multiple></label>
        <p class="form-hint">${DI(DIC.lock, 13)} Documents you upload can be opened only by you, the legal professional on your appointment and a RAQBO full administrator.</p>
        <div class="form-error" hidden></div>
        <button class="button button-primary modal-submit" type="submit">Request the consultation</button></form>
      <div class="oa-legal"><b>How this works</b><p>RAQBO arranges the appointment. The advice itself is given by an independent, qualified legal practitioner whose enrolment RAQBO has checked with the bar council. Any fee is disclosed before the appointment is confirmed. RAQBO is the booking and facilitation platform, not the lawyer.</p></div>`;
  }
  function rmLawyerCard(l) {
    return `<article class="rm-lw"><div class="rm-lw-top">${l.photo ? `<img src="${esc(l.photo)}" alt="">` : `<span class="rm-lw-ini">${esc(String(l.name || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase())}</span>`}
      <div><b>${esc(l.name)}</b><small>${esc(l.qualification || '')}${l.years ? ` · ${esc(l.years)} years` : ''}</small><small class="rm-lw-bar">${DI(DIC.check, 11)} ${esc(l.bar_council || '')}${l.enrolment_no ? ' · ' + esc(l.enrolment_no) : ''}</small></div></div>
      ${l.profile ? `<p>${esc(l.profile)}</p>` : ''}
      <div class="rm-lw-tags">${(l.specialities || []).slice(0, 4).map((s) => `<span>${esc(RM_MATTER[s] || s)}</span>`).join('')}</div>
      <div class="rm-lw-foot"><span>${l.fee ? esc(rs(l.fee)) + ' consultation' : 'Fee on request'}</span><span class="rm-lw-modes">${(l.modes || []).map((m) => esc(RM_MODE[m] || m)).join(' · ')}</span></div>
      <button type="button" class="button button-outline" data-rm="pick-lawyer" data-id="${esc(l.id)}" data-name="${esc(l.name)}">Choose ${esc(String(l.name).split(/\s+/).slice(0, 2).join(' '))}</button></article>`;
  }

