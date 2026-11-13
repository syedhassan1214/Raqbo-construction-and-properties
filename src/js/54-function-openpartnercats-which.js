  // =====================================================================
  function openPartnerCats(which) {
    closeNavMenus();
    const card = openModal('<div class="pn-page"></div>', { wide: true, label: 'Partnership opportunities' });
    card.classList.add('gw-card', 'ax-modal');
    try { if (location.hash !== '#partner-opportunities') history.replaceState(null, '', '#partner-opportunities'); } catch { /* ignore */ }
    const d = pn.pub || {}; const st = d.settings || {};
    const rateFor = (cat) => (d.rates || []).filter((r) => r.category === cat);
    const host = $('.pn-page', card);
    host.innerHTML = `
      <div class="pn-head"><span class="rail-kicker">${DI(DIC.grid, 14)} PARTNERSHIP OPPORTUNITIES</span>
        <h2>Three categories of RAQBO partner</h2>
        <p class="admin-sub">Choose the one that matches how you want to work. RAQBO decides the category at appointment, after looking at your experience, your area and what you are able to handle.</p></div>
      ${Object.entries(PN_CAT).map(([k, c]) => `
        <section class="pn-catfull" id="pn-cat-${k}">
          <div class="pn-catfull-top"><span class="pn-cat-ic">${DI(DIC[c.icon], 22)}</span><div><h3>${esc(c.name)}</h3><p>${esc(c.short)}</p></div>
            ${k === 'franchise' && !st.franchise_open ? '<span class="pn-soon">Opening after the pilot</span>' : ''}</div>
          <p>${esc(c.who)}</p>
          <div class="pn-catgrid">
            <div><b>Office</b><p>${esc(c.office)}</p></div>
            <div><b>How you earn</b><p>${esc(c.earn)}</p></div>
            <div><b>Illustrative share</b><p>${rateFor(k).length ? rateFor(k).map((r) => `${esc(r.partner_pct)}%${r.lead_source !== 'any' ? ' (' + (r.lead_source === 'partner' ? 'you originated it' : 'RAQBO passed it on') + ')' : ''}`).join(' · ') : 'Set by RAQBO before appointment'}</p></div>
          </div>
          ${k === 'area' ? `<div class="pn-worklist"><b>Approved work an Area Partner may undertake</b><ul>${PN_WORK.map(([, t]) => `<li>${esc(t)}</li>`).join('')}</ul>
            <p class="pn-note">All activities remain subject to the partner&rsquo;s qualifications, the law, and the authorisation RAQBO grants.</p></div>` : ''}
          ${k === 'franchise' ? `<div class="pn-worklist"><b>A franchise arrangement requires</b><ul>${PN_FRANCHISE_NEEDS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            <p class="pn-note">RAQBO intends to offer full franchises only once the local partnership model has been tested.</p></div>` : ''}
          <div class="pn-cta"><button type="button" class="button button-primary" data-pn="apply" data-k="${k}">Apply as ${esc(c.name)}</button></div>
        </section>`).join('')}
      <p class="pn-note">An Area Partner is an independent business working with RAQBO. A partner is not a shareholder or co-owner of RAQBO merely because the partner receives a percentage of service revenue.</p>
      <p class="pn-note">${esc(PN_NOTE_MONEY)}</p>`;
    applyBrandIcons(host);
    if (which && $('#pn-cat-' + which, host)) setTimeout(() => $('#pn-cat-' + which, host).scrollIntoView({ block: 'start', behavior: 'smooth' }), 120);
  }

