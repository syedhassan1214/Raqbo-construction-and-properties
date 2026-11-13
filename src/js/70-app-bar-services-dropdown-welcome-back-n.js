  /* =====================================================================
     App bar: Services dropdown + "Welcome back, Name" account menu
     ===================================================================== */
  const navUI = { mega: null, acctOpen: false };
  const pwa = { prompt: null, ios: /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone };

  function closeNavMenus() {
    if (navUI.mega && !navUI.mega.hidden) { navUI.mega.hidden = true; const t = $('.main-nav [data-action=services]'); if (t) t.setAttribute('aria-expanded', 'false'); }
    const m = $('.acct-menu'); if (m && !m.hidden) { m.hidden = true; const b = $('.acct-btn'); if (b) b.setAttribute('aria-expanded', 'false'); }
  }
  function megaHTML() {
    const S = SERVICES_PAGE; const mkS = S[0]; const others = S.slice(1);
    return `<div class="mega-in">
      <div class="mega-feature">
        <div class="mega-feature-media sv-bg-market"><span class="sv-bg-icon">${DI(DIC.store, 120)}</span>${mkS.photo ? `<img src="${esc(mkS.photo)}" alt="" loading="lazy">` : ''}<em>NEW</em></div>
        <div class="mega-feature-body"><span class="mega-label">CONSTRUCTION MATERIALS</span><h3>Construction Materials Marketplace</h3><p>Construction materials from verified suppliers — order with RAQBO payment protection.</p>
          <div class="mega-links"><button type="button" data-sv-act="market">${DI(DIC.grid, 15)} Browse vendors</button><button type="button" data-sv-act="market-supplier">${DI(DIC.plus, 15)} Become a supplier</button><button type="button" data-nav="mk-orders">${DI(DIC.cart, 15)} My material orders</button></div></div>
      </div>
      <div class="mega-services"><span class="mega-label">OUR SERVICES</span>
        <div class="mega-grid">${others.map((s) => `<button type="button" class="mega-item" data-sv-act="${esc(s.cta[1])}"><span class="mega-ico">${DI(DIC[s.icon], 22)}</span><span><b>${esc(s.title)}</b><small>${esc(s.tagline)}</small></span></button>`).join('')}</div>
        <button type="button" class="mega-all" data-sv-act="page"><span>${DI(DIC.services, 18)} Explore all services</span>${DI('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 16)}</button>
        <span class="mega-label mega-label2">MORE FROM RAQBO</span>
        <div class="mega-quick"><button type="button" data-v3f="projects">RAQBO Direct &amp; projects</button><button type="button" data-v3p="passport">Property Passport</button><button type="button" data-gw="wanted">Property Wanted</button><button type="button" data-v3s="overseas">RAQBO Overseas</button><button type="button" data-v3f="smart">Smart match</button><button type="button" data-v3e="prices">Price guide</button><button type="button" data-v3e="calc">Cost calculator</button><button type="button" data-v3e="fees">Fees &amp; refunds</button></div>
      </div></div>`;
  }
  function toggleMega(force) {
    const row = $('.nav-row .container'); if (!row) return;
    if (!navUI.mega) {
      navUI.mega = document.createElement('div'); navUI.mega.className = 'mega'; navUI.mega.hidden = true; navUI.mega.setAttribute('role', 'region'); navUI.mega.setAttribute('aria-label', 'RAQBO Connect');
      row.append(navUI.mega); navUI.mega.innerHTML = megaHTML(); applyBrandIcons(navUI.mega);
      $$('img', navUI.mega).forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
    }
    const open = force != null ? force : navUI.mega.hidden;
    const m = $('.acct-menu'); if (m) m.hidden = true;
    navUI.mega.hidden = !open; const t = $('.main-nav [data-action=services]'); if (t) t.setAttribute('aria-expanded', String(open));
  }
  // Account button in the app bar
  function updateMenuTrigger() {
    gwSync();
    const box = $('[data-acct]'); if (!box) return;
    const s = db.session; const signed = isComplete();
    if (!signed) { box.innerHTML = `<button type="button" class="acct-signin" data-action="signin">${DI(DIC.user, 16)} <span>Sign in</span></button>`; lvSync(); return; }
    const first = (s.name || '').split(/\s+/)[0] || 'there';
    const myV = mk.data && mk.myVendor();
    const item = (icon, label, nav) => `<button type="button" role="menuitem" data-nav="${nav}">${DI(DIC[icon], 16)} ${esc(label)}</button>`;
    box.innerHTML = `<button type="button" class="bell-btn" data-bell aria-label="Notifications" aria-haspopup="true" aria-expanded="false">${DI(DIC.bell, 19)}<span class="bell-dot" hidden>0</span></button><button type="button" class="acct-btn" aria-haspopup="menu" aria-expanded="false"><span class="mt-avatar ${s.photo ? 'has-photo' : ''}">${avatarIn(s)}</span><span class="acct-txt"><small>Welcome back,</small><b>${esc(first)}</b></span>${DI(DIC.chev, 15)}</button>
      <div class="acct-menu" role="menu" hidden>
        <div class="acct-head"><span class="mt-avatar lg ${s.photo ? 'has-photo' : ''}">${avatarIn(s)}</span><div><b>${esc(s.name || 'RAQBO member')}</b><small>${esc(s.email || '')}</small></div></div>
        ${item('user', 'My account & listings', 'account')}<button type="button" role="menuitem" data-nav="messages">${DI(DIC.chat, 16)} Messages <span class="menu-count" hidden>0</span></button>${item('heart', 'Saved properties', 'saved')}<button type="button" role="menuitem" data-my="overview">${DI(DIC.grid, 16)} My RAQBO dashboard</button><button type="button" role="menuitem" data-gw="rewards">${DI(GI.gift, 16)} My RAQBO Rewards</button><button type="button" role="menuitem" data-gw="wanted">${DI(GI.target, 16)} Property Wanted</button><button type="button" role="menuitem" data-dl="urgent-page">${DI(DIC.alert, 16)} QuickSell</button><button type="button" role="menuitem" data-ax="home">${DI(DIC.gavel || DIC.star, 16)} Auctions</button>${item('cart', 'My material orders', 'mk-orders')}${item('store', myV ? 'My shop dashboard' : 'Become a supplier', 'mk-shop')}
        ${db.isAdmin ? item('admin', 'Admin panel', 'admin') : ''}
        ${pwa.prompt || pwa.ios ? item('download', 'Install RAQBO app', 'install') : ''}
        <div class="acct-sep"></div>${item('out', 'Sign out', 'signout')}
      </div>`;
    lvSync(); lvBadges(); gwAcctBadge();
  }
  // Start / stop the bell when the signed-in person changes
  function lvSync() { const u = isComplete() ? lvMe() : null; if (u === lv.user) return; lv.user = u; lv.list = []; lv.unread = 0; lv.msgUnread = 0; lv.convs = []; if (u) lvStart(); else { lvStop(); if (typeof closeInbox === 'function') closeInbox(); } }
  document.addEventListener('click', (e) => {
    const svc = e.target.closest('.main-nav [data-action=services]');
    if (svc) { e.preventDefault(); e.stopImmediatePropagation(); toggleMega(); return; }
    const ab = e.target.closest('.acct-btn');
    if (ab) { const m = $('.acct-menu'); if (navUI.mega) navUI.mega.hidden = true; m.hidden = !m.hidden; ab.setAttribute('aria-expanded', String(!m.hidden)); if (!m.hidden) { const f = $('[role=menuitem]', m); if (f) f.focus({ preventScroll: true }); } return; }
    const n = e.target.closest('[data-nav]');
    if (n) {
      closeNavMenus(); const a = n.dataset.nav;
      if (a === 'account') openAccount(); else if (a === 'saved') { if (!ui.savedOnly) { const t = $('#saved-toggle'); if (t) t.click(); } scrollToResults(); }
      else if (a === 'install') installApp();
      else if (a === 'messages') openInbox();
      else if (a === 'mk-orders') openMarket('orders'); else if (a === 'mk-shop') openMarket('shop'); else if (a === 'admin') openAdmin(); else if (a === 'signout') signOut();
      return;
    }
    if (!e.target.closest('.mega, .acct')) closeNavMenus();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ((navUI.mega && !navUI.mega.hidden) || ($('.acct-menu') && !$('.acct-menu').hidden))) { e.stopImmediatePropagation(); closeNavMenus(); } }, true);


  /* ---------- Install as an app (PWA) ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwa.prompt = e; updateMenuTrigger(); const b = $('[data-install-app]'); if (b) b.hidden = false; });
  window.addEventListener('appinstalled', () => { pwa.prompt = null; updateMenuTrigger(); const b = $('[data-install-app]'); if (b) b.hidden = true; toast('RAQBO is installed — find it on your home screen.'); });
  async function installApp() {
    if (pwa.prompt) { pwa.prompt.prompt(); try { await pwa.prompt.userChoice; } catch { /* ignore */ } pwa.prompt = null; updateMenuTrigger(); return; }
    openModal(`<div class="eyebrow"><span></span> INSTALL THE APP</div><h2>Add RAQBO to your home screen</h2>
      <ol class="pwa-steps"><li>Tap the <b>Share</b> button at the bottom of Safari</li><li>Choose <b>Add to Home Screen</b></li><li>Tap <b>Add</b> — RAQBO opens like an app</li></ol>`, { label: 'Install RAQBO' });
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-install-app]')) installApp(); });

  /* ---------- Global actions ---------- */
  const ACTIONS = {
    signin: () => (isComplete() ? openAccount() : showGate()),
    list: () => openListingForm(),
    all: () => { resetFilters(); scrollToResults(); },
    retry: () => load(),
    direct: () => { directChk.checked = true; renderGrid(); scrollToResults(); toast('Showing direct-owner listings.'); },
    services: () => openEnquiry(''),
    contact: () => openEnquiry('general'),
    privacy: () => { window.open('privacy.html', '_blank', 'noopener'); },
    admin: () => openAdmin(),
    find: () => { $('#home').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => loc.focus({ preventScroll: true }), 500); },
    coming: () => openAbout('au-upcoming'),
    about: () => openAbout(),
    menu: () => { const b = $('.acct-btn'); if (b) b.click(); else showGate(); },
    services: () => openServices(),
    market: () => openMarket('dir'),
    'market-supplier': () => openMarket('shop', { createProfile: true }),
    projects: () => openAbout('au-completed')
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]'); if (!el || !ACTIONS[el.dataset.action]) return;
    if (el.tagName === 'A') e.preventDefault(); closeMenu(); ACTIONS[el.dataset.action]();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('.modal-backdrop')) closeModal(); else if (drawer.el && drawer.el.classList.contains('is-open')) closeDrawer(); else if (pp.el && !pp.el.hidden) closeDetails(); else if (au.el && !au.el.hidden) closeAbout(); else if (mk.el && !mk.el.hidden) closeMarket(); else if (svs.el && !svs.el.hidden) closeServices(); else if (admin.el && !admin.el.hidden) closeAdmin(); } });

  /* ---------- Header menu (small screens) ---------- */
  const menuBtn = $('.mobile-menu-button'); const nav = $('.main-nav');
  function closeMenu() { nav.classList.remove('is-open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => { const open = !nav.classList.contains('is-open'); nav.classList.toggle('is-open', open); menuBtn.setAttribute('aria-expanded', String(open)); });
  $$('a', nav).forEach((a) => a.addEventListener('click', closeMenu));

  /* ---------- Banner ---------- */
  const notice = $('.preview-notice');
  if (notice) {
    if (LIVE) notice.hidden = true;
    else if (backendWarning) notice.innerHTML = `<b>Connection problem</b><span>${esc(backendWarning)}</span>`;
  }

  /* ---------- Official brand icons (files you add to the icons/ folder) ---------- */
  const ICON_FILES = Object.assign({ google: 'icons/google.svg', whatsapp: 'icons/whatsapp.svg', instagram: 'icons/instagram.svg', facebook: 'icons/facebook.svg', pinterest: 'icons/pinterest.svg', youtube: 'icons/youtube.svg', linkedin: 'icons/linkedin.svg' }, CFG.brandIcons || {});
  const iconOk = {};
  const iconAvailable = (name) => iconOk[name] || (iconOk[name] = new Promise((resolve) => {
    const src = ICON_FILES[name]; if (!src) { resolve(null); return; }
    const img = new Image(); img.onload = () => resolve(img.naturalWidth ? src : null); img.onerror = () => resolve(null); img.src = src;
  }));
  const ICON_TARGETS = [
    ['a[href*="instagram.com"] > svg', 'instagram'], ['a[href*="facebook.com"] > svg', 'facebook'], ['a[href*="pin.it"] > svg, a[href*="pinterest."] > svg', 'pinterest'],
    ['a[href*="youtube.com"] > svg', 'youtube'], ['a[href*="linkedin.com"] > svg', 'linkedin'], ['a[href*="wa.me"] > svg', 'whatsapp'], ['[data-google] .auth-google-mark', 'google']
  ];
  function applyBrandIcons(root = document) {
    ICON_TARGETS.forEach(([sel, name]) => {
      const els = $$(sel, root); if (!els.length) return;
      iconAvailable(name).then((src) => {
        if (!src) return;
        els.forEach((el) => { if (!el.isConnected) return; const img = document.createElement('img'); img.className = 'brand-icon brand-icon-' + name; img.src = src; img.alt = ''; img.setAttribute('aria-hidden', 'true'); el.replaceWith(img); });
      });
    });
  }

  /* ---------- Init ---------- */
  async function load() {
    db.loaded = false; loadError = '';
    try { if (backend.warm && backend.warm()) db.loaded = true; } catch { /* ignore */ }
    renderGrid();
    try { await backend.init(); } catch (err) { loadError = err.message || 'Please try again.'; }
    db.loaded = true; updateAuthUI(); renderGrid();
    const PENDING = 'raqbo-open-property';
    const pm = location.hash.match(/^#property\/(.+)$/);
    let pid = pm ? decodeURIComponent(pm[1]) : null; let fromStore = false;
    if (!pid) { try { pid = sessionStorage.getItem(PENDING); fromStore = !!pid; } catch { /* ignore */ } }
    const openShared = () => {
      try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
      if (byId(pid)) openDetails(pid, { fromHistory: !!pm && !fromStore && location.hash === '#property/' + encodeURIComponent(pid) });
      else toast('This property is no longer available.');
    };
    if (location.hash === '#admin') openAdmin(); else if (recoveryMode && db.session) showGate('newpass'); else checkGate();
    if (location.hash === '#about-us') openAbout(null, { fromHistory: true });
    if (location.hash.startsWith('#marketplace')) openMarketFromHash();
    if (location.hash === '#our-services') openServices({ fromHistory: true });
    if (/^#messages/.test(location.hash)) { const mm = location.hash.match(/^#messages\/(.+)$/); openInbox(mm && mm[1]); }
    if (/^#(rewards|wanted|guides|my|urgent|auction)/.test(location.hash) && gwRoute(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
    updateMenuTrigger();
    placeLangToggle(); try { if (localStorage.getItem('raqbo-lang') === 'ur') setLang('ur', true); } catch { /* ignore */ }
    if (pid && location.hash !== '#admin' && !recoveryMode) {
      if (isComplete()) openShared();
      else {
        // Not signed in yet: remember the property (survives the Google sign-in redirect), ask them to sign in / register, then open it.
        try { sessionStorage.setItem(PENDING, pid); } catch { /* ignore */ }
        gate.invite = byId(pid) || null; gate.onDone = openShared;
        if (gate.el && !gate.el.hidden) renderGate(gate.view === 'complete' ? 'complete' : (gate.invite ? 'signup' : gate.view));
        else showGate(db.session ? 'complete' : 'signup');
      }
    }
  }
  let rtPaused = false; let rtTimer = null;
  document.addEventListener('visibilitychange', () => {
    if (!SB) return;
    if (document.hidden) { rtTimer = setTimeout(() => { rtPaused = true; try { SB.removeAllChannels(); } catch { /* ignore */ } if (typeof notifPause === 'function') notifPause(); }, 60000); return; }
    clearTimeout(rtTimer); if (!rtPaused) return; rtPaused = false;
    if (pp.el && !pp.el.hidden && byId(pp.id) && typeof reviewsOpen === 'function') reviewsOpen(byId(pp.id));
    if (mk.unsub) { mk.unsub = null; try { mk.unsub = MK.subscribe((t) => mkSoon(t)); } catch { mk.unsub = null; } mkSoon('resume'); }
    if (typeof notifResume === 'function') notifResume();
    if (backend.reloadListings) backend.reloadListings().then(() => renderGrid()).catch(() => {});
  });
  // ---------- UI polish pass (Nov 2026) ----------
  (function polish() {
    const panel = $('.search-panel'); const tabs = $('.search-tabs', panel || document);
    const openLeaseListings = () => { try { openCommercial({ f: { purpose: 'rent' } }); } catch { location.hash = '#commercial'; } };
    if (tabs && !$('[data-lease-tab]', tabs)) {
      const rent = $('[data-deal="rent"]', tabs);
      if (rent) rent.insertAdjacentHTML('afterend', '<button type="button" role="tab" aria-selected="false" data-lease-tab>Lease</button>');
      $('[data-lease-tab]', tabs).addEventListener('click', (e) => { e.preventDefault(); openLeaseListings(); });
    }
    const cap = panel && $('.search-caption', panel);
    if (cap && !$('.quick-areas', panel)) {
      const areas = ['DHA Lahore', 'Bahria Town', 'Gulberg', 'Johar Town', 'Islamabad'];
      cap.insertAdjacentHTML('beforebegin', `<div class="quick-areas"><span>Popular searches</span>${areas.map((a) => `<button type="button" data-qa="${esc(a)}">${esc(a)}</button>`).join('')}<button type="button" class="qa-lease" data-qa-lease>Commercial lease</button></div>`);
      panel.addEventListener('click', (e) => {
        const q = e.target.closest('[data-qa]'); const l = e.target.closest('[data-qa-lease]');
        if (l) { e.preventDefault(); openLeaseListings(); return; }
        if (!q) return; e.preventDefault();
        loc.value = q.dataset.qa.replace(/ Lahore$/, ''); renderGrid(); scrollToResults();
        const n = filtered().length; toast(n ? `${n} ${n === 1 ? 'property' : 'properties'} in ${q.dataset.qa}.` : `No listings in ${q.dataset.qa} yet — try another area.`);
      });
    }
    // Admin "Business control": mute zero tiles, flag tiles that need someone to act
    const ACT = /^(Open complaints|Refunds pending|Service requests|Site visits|Quotations open|Property enquiries|QuickSell requests|Agent packages)$/i;
    const markKpis = (root) => $$('.admin-content .v3x-kpi', root).forEach((k) => {
      const lab = ($('small', k) || {}).textContent || ''; const v = (($('b', k) || {}).textContent || '').replace(/[^0-9.]/g, '');
      const zero = v === '' || Number(v) === 0; k.classList.toggle('kpi-zero', zero); k.classList.toggle('kpi-act', !zero && ACT.test(lab.trim()));
    });
    let mq = false; new MutationObserver(() => { if (mq) return; mq = true; requestAnimationFrame(() => { mq = false; const a = $('.admin-overlay'); if (a && !a.hidden) markKpis(a); }); }).observe(document.body, { childList: true, subtree: true });
  })();
  // ---------- Added features (Nov 2026): bedrooms filter, compare, recently viewed, My payments ----------
  (function addedFeatures() {
    // 1. Bedrooms filter in the hero search
    const selects = $('.search-panel .search-selects');
    if (selects && !$('#f-beds')) {
      selects.insertAdjacentHTML('afterend', '<label class="search-beds"><span>Bedrooms</span><select id="f-beds" aria-label="Minimum bedrooms"><option value="">Any</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option><option value="5">5+</option></select></label>');
    }
    const bedsSel = $('#f-beds');
    if (bedsSel) {
      const baseFiltered = filtered;
      filtered = function (skip) { const list = baseFiltered(skip); const b = Number(bedsSel.value) || 0; return b ? list.filter((l) => (Number(l.beds) || 0) >= b) : list; };
      bedsSel.addEventListener('change', () => renderGrid());
      const baseReset = resetFilters; resetFilters = function () { bedsSel.value = ''; return baseReset.apply(this, arguments); };
      document.addEventListener('click', (e) => { if (e.target.closest('[data-clear-filters],.clear-filters,[data-reset-filters]')) { bedsSel.value = ''; } }, true);
    }

    // 2. Compare up to 3 properties side by side
    let cmp = (store.get('compare', []) || []).filter((id) => byId(id));
    const saveCmp = () => store.set('compare', cmp);
    document.body.insertAdjacentHTML('beforeend', '<div class="cmp-bar" role="region" aria-label="Compare properties"><span><b data-cmp-n>0</b> selected to compare</span><button type="button" class="button button-primary" data-cmp-open>Compare now</button><button type="button" class="cmp-clear" data-cmp-clear>Clear</button></div>');
    const bar = $('.cmp-bar');
    const paintCmp = () => {
      cmp = cmp.filter((id) => byId(id));
      $('[data-cmp-n]', bar).textContent = cmp.length; bar.classList.toggle('show', cmp.length > 0);
      $$('.cmp-btn').forEach((b) => { const on = cmp.includes(b.dataset.cmp); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.lastChild.textContent = on ? 'Comparing' : 'Compare'; });
    };
    const toggleCmp = (id) => {
      if (cmp.includes(id)) cmp = cmp.filter((x) => x !== id);
      else { if (cmp.length >= 3) { toast('You can compare up to 3 properties. Remove one first.'); return; } cmp.push(id); if (cmp.length === 1) toast('Added. Pick one or two more properties to compare.'); }
      saveCmp(); paintCmp();
    };
    const addCmpButtons = (root) => $$('.property-card[data-id]', root).forEach((c) => {
      const img = $('.property-image', c); if (!img || $('.cmp-btn', img)) return;
      img.insertAdjacentHTML('beforeend', `<button type="button" class="cmp-btn" data-cmp="${esc(c.dataset.id)}" aria-pressed="false" aria-label="Compare this property"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 4v16"/></svg><span>Compare</span></button>`);
    });
    const yesNo = (v) => (v ? 'Yes' : 'No');
    function openCompare() {
      const L = cmp.map(byId).filter(Boolean); if (L.length < 2) { toast('Pick at least 2 properties to compare.'); return; }
      const minPrice = Math.min(...L.map((l) => Number(l.price) || Infinity)); const ppms = L.map(ppm).filter(Boolean); const minPpm = ppms.length ? Math.min(...ppms) : 0;
      const maxSize = Math.max(...L.map((l) => marlaOf(l) || 0));
      const row = (label, f) => `<tr><th scope="row">${esc(label)}</th>${L.map((l) => `<td>${f(l)}</td>`).join('')}</tr>`;
      const html = `<div class="eyebrow"><span></span> COMPARE</div><h2>Compare properties</h2><p class="modal-lead">Side by side, so the differences are easy to see. Lowest price, lowest price per marla and largest size are marked in green.</p>
        <div class="cmp-wrap"><table class="cmp-table"><thead><tr><th></th>${L.map((l) => `<td><div class="cmp-img" ${mediaAttr(l.photos[0], true)}></div><b style="display:block;margin-top:8px">${esc(l.title)}</b><button type="button" class="cmp-x" data-cmp-remove="${esc(l.id)}">Remove</button></td>`).join('')}</tr></thead><tbody>
        ${row('Price', (l) => `<span class="${Number(l.price) === minPrice && L.length > 1 ? 'cmp-best' : ''}">${esc(fmtPrice(l.price))}${l.purpose === 'rent' ? ' / month' : ''}</span>`)}
        ${row('Price per marla', (l) => (ppm(l) ? `<span class="${ppm(l) === minPpm ? 'cmp-best' : ''}">${esc(fmtPrice(ppm(l)))}</span>` : '—'))}
        ${row('Location', (l) => esc([l.area, l.city].filter(Boolean).join(', ')))}
        ${row('For', (l) => (l.purpose === 'rent' ? 'Rent' : 'Sale'))}
        ${row('Type', (l) => esc(l.type || '—'))}
        ${row('Size', (l) => `<span class="${marlaOf(l) && marlaOf(l) === maxSize ? 'cmp-best' : ''}">${esc(`${l.size || '—'} ${l.sizeUnit || ''}`.trim())}</span>`)}
        ${row('Bedrooms', (l) => esc(l.beds || '—'))}
        ${row('Bathrooms', (l) => esc(l.baths || '—'))}
        ${row('RAQBO Verified', (l) => yesNo(typeof vfIsVerified === 'function' && vfIsVerified(l.id)))}
        ${row('Direct owner', (l) => yesNo(l.role === 'Owner'))}
        ${row('', (l) => `<button type="button" class="button button-primary" data-cmp-view="${esc(l.id)}">View property</button>`)}
        </tbody></table></div>`;
      const card = openModal(html, { wide: true, label: 'Compare properties' }); if (card && typeof hydrate === 'function') hydrate(card);
    }
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.cmp-btn'); if (b) { e.preventDefault(); e.stopPropagation(); toggleCmp(b.dataset.cmp); return; }
      if (e.target.closest('[data-cmp-open]')) { openCompare(); return; }
      if (e.target.closest('[data-cmp-clear]')) { cmp = []; saveCmp(); paintCmp(); return; }
      const r = e.target.closest('[data-cmp-remove]'); if (r) { cmp = cmp.filter((x) => x !== r.dataset.cmpRemove); saveCmp(); paintCmp(); if (cmp.length >= 2) openCompare(); else { closeModal(); toast('Pick another property to compare.'); } return; }
      const v = e.target.closest('[data-cmp-view]'); if (v) { closeModal(); openDetails(v.dataset.cmpView); }
    }, true);
    const gridEl = $('#property-grid');
    if (gridEl) new MutationObserver(() => { addCmpButtons(gridEl); paintCmp(); }).observe(gridEl, { childList: true });

    // 3. Recently viewed properties
    let recent = store.get('recent', []) || [];
    const baseOpen = openDetails;
    openDetails = function (id) { const r = baseOpen.apply(this, arguments); if (byId(id)) { recent = [id, ...recent.filter((x) => x !== id)].slice(0, 12); store.set('recent', recent); setTimeout(paintRecent, 400); } return r; };
    function paintRecent() {
      const anchor = $('#properties'); if (!anchor || !db.loaded) return;
      const list = recent.map(byId).filter((l) => l && l.status === 'published' && (typeof isPublicListing !== 'function' || isPublicListing(l)));
      let sec = $('#rail-recent');
      if (!list.length) { if (sec) sec.remove(); return; }
      const inner = `<div class="container"><div class="rail-head"><div><span class="rail-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Recently viewed</h2><p>Properties you opened on this device.</p></div><button type="button" class="rv-clear" data-rv-clear>Clear history</button></div><div class="rail-track">${list.map(railCard).join('')}</div></div>`;
      if (!sec) { anchor.insertAdjacentHTML('beforebegin', '<section class="rail" id="rail-recent" aria-label="Recently viewed properties"></section>'); sec = $('#rail-recent'); }
      sec.innerHTML = inner; if (typeof hydrate === 'function') hydrate(sec); if (typeof applyBrandIcons === 'function') applyBrandIcons(sec);
    }
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-rv-clear]')) { recent = []; store.set('recent', recent); paintRecent(); return; }
      const c = e.target.closest('#rail-recent [data-open]'); if (c) { e.preventDefault(); openDetails(c.dataset.open || (c.closest('[data-id]') || {}).dataset.id); }
    });
    if (gridEl) { let once = false; new MutationObserver(() => { if (!once && db.loaded) { once = true; paintRecent(); } }).observe(gridEl, { childList: true }); }

    // 4. My RAQBO → My payments: everything paid, owed or refunded in one place
    if (!MY.some((m) => m.id === 'payments')) {
      const at = MY.findIndex((m) => m.id === 'services');
      MY.splice(at >= 0 ? at + 1 : MY.length, 0, { id: 'payments', label: 'My payments', icon: 'doc' });
    }
    const PAY_ST = { awaiting_payment: ['To pay', 'due'], payment_review: ['Payment being checked', 'due'], paid_escrow: ['Paid · held by RAQBO', 'ok'], dispatched: ['Paid · dispatched', 'ok'], delivered: ['Paid · delivered', 'ok'], completed: ['Paid · confirmed', 'ok'], released: ['Paid · complete', 'ok'], disputed: ['In dispute', 'bad'], refunded: ['Refunded', 'back'], cancelled: ['Cancelled', ''], quote_requested: ['Quote requested', ''], quoted: ['Quote received', 'due'] };
    const PAID = ['paid_escrow', 'dispatched', 'delivered', 'completed', 'released'];
    MY_RENDER.payments = async () => {
      const s = db.session || {}; let orders = []; let svcs = []; const errs = [];
      try { if (typeof mkLoad === 'function' && !(mk.data && mk.data.orders)) await mkLoad(); orders = ((mk.data && mk.data.orders) || []).filter((o) => o.buyerId === s.userId); } catch (err) { errs.push(err.message); }
      try { svcs = ((await PF.myServices()) || []).filter((r) => r.quote_status && Number(r.quote_amount) > 0); } catch (err) { errs.push(err.message); }
      const sum = (a) => a.reduce((t, x) => t + (Number(x) || 0), 0);
      const paid = sum(orders.filter((o) => PAID.includes(o.status)).map((o) => o.total));
      const due = sum(orders.filter((o) => ['awaiting_payment', 'payment_review'].includes(o.status)).map((o) => o.total)) + sum(svcs.filter((r) => r.quote_status === 'sent').map((r) => r.quote_amount));
      const back = sum(orders.filter((o) => o.status === 'refunded').map((o) => o.total));
      const day = (t) => { const d = new Date(t || 0); return isNaN(d) || !t ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
      const rows = [
        ...orders.map((o) => ({ at: o.createdAt || Date.parse(o.created_at) || 0, what: `Material order · ${o.shop || o.vendorName || 'supplier'}`, ref: o.ref, amt: o.total, st: PAY_ST[o.status] || [String(o.status || '').replace(/_/g, ' '), ''], act: '<button type="button" class="link-button" data-pay-orders>Open order</button>' })),
        ...svcs.map((r) => ({ at: Date.parse(r.created_at || r.createdAt) || 0, what: `Service · ${String(r.service || r.kind || 'RAQBO service').replace(/_/g, ' ')}`, ref: r.ref, amt: r.quote_amount, st: r.quote_status === 'sent' ? ['Quotation to accept', 'due'] : r.quote_status === 'accepted' ? ['Quotation accepted', 'ok'] : [r.quote_status === 'declined' ? 'Declined' : 'Expired', ''], act: '<button type="button" class="link-button" data-my="services">View request</button>' }))
      ].sort((a, b) => b.at - a.at);
      return `${myHead('PAYMENTS', 'My payments', 'Everything you have paid RAQBO, what is still due and what was refunded — in one place.')}
        <div class="pay-tiles"><article><small>Paid</small><b>${esc(fmtPrice(paid))}</b><span>material orders</span></article><article><small>To pay</small><b>${esc(fmtPrice(due))}</b><span>orders and quotations waiting</span></article><article><small>Refunded</small><b>${esc(fmtPrice(back))}</b><span>back to you</span></article></div>
        ${errs.length ? `<p class="admin-message">Some payments could not be loaded: ${esc(errs[0])}</p>` : ''}
        ${rows.length ? `<div class="cmp-wrap"><table class="gw-table"><thead><tr><th>Date</th><th>For</th><th>Reference</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(day(r.at))}</td><td>${esc(r.what)}</td><td>${esc(r.ref || '—')}</td><td><b>${esc(fmtPrice(r.amt))}</b></td><td><span class="pay-chip ${r.st[1]}">${esc(r.st[0])}</span></td><td>${r.act}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="admin-empty">No payments yet. Material orders and accepted service quotations will appear here.</div>'}
        <p class="gw-mini">RAQBO only asks you to pay into the account shown on your order. Never pay an individual directly.</p>`;
    };
    document.addEventListener('click', (e) => { if (e.target.closest('.my-overlay [data-pay-orders]')) { closeMy(); openMarket('orders'); } });
  })();
