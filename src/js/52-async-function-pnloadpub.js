  // =====================================================================
  async function pnLoadPub() {
    if (pn.pub && Date.now() - pn.at < 120000) return pn.pub;
    try { pn.pub = await PN.pub(); pn.at = Date.now(); } catch { pn.pub = pn.pub || { settings: {}, rates: [], training: [] }; }
    return pn.pub;
  }

  function openPartners() {
    closeNavMenus(); if (pf.my.open) closeMy();
    const card = openModal('<div class="pn-page"></div>', { wide: true, label: 'Become a RAQBO Partner' });
    card.classList.add('gw-card', 'ax-modal');
    try { if (location.hash !== '#partners') history.replaceState(null, '', '#partners'); } catch { /* ignore */ }
    pnPaintHome(card);
    pnLoadPub().then(() => pnPaintHome(card));
  }

  function pnPaintHome(card) {
    const host = $('.pn-page', card || document); if (!host) return;
    const d = pn.pub || {}; const st = d.settings || {};
    host.innerHTML = `
      <div class="pn-hero">
        <div>
          <span class="rail-kicker">${DI(DIC.users || DIC.user, 14)} RAQBO PARTNER NETWORK</span>
          <h2>Become a RAQBO Partner</h2>
          <p class="pn-tag">Your Local Expertise. Our Digital Platform. Shared Growth.</p>
          <p class="pn-intro">Join RAQBO&rsquo;s growing property-services network and build your business in your own city or locality. Whether you are an individual property professional, an established real estate business, a registered firm or an entrepreneur, RAQBO offers partnership opportunities to connect local expertise with a modern digital property platform.</p>
          <p class="pn-intro">Work with us in property sales, rentals, verification facilitation, commercial leasing, auctions, property management and other approved services under a transparent business-sharing arrangement.</p>
          ${st.intro_note ? `<p class="pn-intro">${esc(st.intro_note)}</p>` : ''}
          <div class="pn-cta">
            <button type="button" class="button button-primary" data-pn="apply">${DI(DIC.plus, 16)} Apply to Become a Partner</button>
            <button type="button" class="button button-light" data-pn="opportunities">${DI(DIC.grid, 16)} Explore Partnership Opportunities</button>
            <button type="button" class="button button-ghost" data-pn="how">${DI(DIC.list, 16)} How Partnership Works</button>
            <button type="button" class="button button-ghost" data-pn="find">${DI(DIC.search, 16)} Find a RAQBO Partner</button>
          </div>
          ${st.network_open === false ? '<p class="pn-closed">RAQBO is not accepting new partner applications at the moment. You can still search the directory.</p>' : ''}
        </div>
        <div class="pn-hero-side">
          <div class="pn-stat"><small>Partners listed</small><b>${esc(d.partners_live || 0)}</b></div>
          <div class="pn-stat"><small>Areas open</small><b>${esc(d.territories_open || 0)}</b></div>
          <div class="pn-stat"><small>Categories</small><b>3</b></div>
        </div>
      </div>

      <h3 class="pn-h">Three ways to work with RAQBO</h3>
      <div class="pn-cats">${Object.entries(PN_CAT).map(([k, c]) => `
        <button type="button" class="pn-cat" data-pn="cat" data-k="${k}">
          <span class="pn-cat-ic">${DI(DIC[c.icon], 22)}</span>
          <b>${esc(c.name)}</b>
          <small>${esc(c.short)}</small>
          <em>${esc(c.earn)}</em>
          ${k === 'franchise' && !(st.franchise_open) ? '<i class="pn-soon">Opening after the pilot</i>' : ''}
        </button>`).join('')}</div>

      <h3 class="pn-h">What RAQBO brings, and what you bring</h3>
      <div class="pn-twoup">
        <div class="pn-box"><b>RAQBO keeps central control of</b><ul>
          <li>The brand, website and mobile application</li>
          <li>Service standards and customer protection</li>
          <li>All financial records and commission calculations</li>
          <li>Which services a partner is authorised to provide</li></ul></div>
        <div class="pn-box"><b>The local partner brings</b><ul>
          <li>Knowledge of the local property market</li>
          <li>Owners, buyers, tenants and landlords on the ground</li>
          <li>Site visits, document collection and local coordination</li>
          <li>Day-to-day service to customers in the area</li></ul></div>
      </div>

      <h3 class="pn-h">How RAQBO is growing the network</h3>
      <div class="pn-phases">${PN_PHASES.map(([t, b], i) => `<div class="pn-phase"><span>${i + 1}</span><div><b>${esc(t)}</b><p>${esc(b)}</p></div></div>`).join('')}</div>
      ${st.pilot_note ? `<p class="pn-note">${esc(st.pilot_note)}</p>` : ''}

      <div class="pn-foot">
        <p class="pn-note">${esc(PN_NOTE_MONEY)}</p>
        <p class="pn-note">${esc(PN_NOTE_RIGHTS)}</p>
        <div class="pn-cta"><button type="button" class="button button-primary" data-pn="apply">Apply to Become a Partner</button>
        <a class="button button-whatsapp" href="${esc(waLink('Hi RAQBO, I would like to know more about becoming a RAQBO partner.'))}" target="_blank" rel="noopener">${DI(DIC.chat, 16)} Ask on WhatsApp</a></div>
      </div>`;
    applyBrandIcons(host);
  }

