  /* =====================================================================
     Main menu drawer ("Welcome back, Name")
     ===================================================================== */
  const DI = (p, s = 18) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const DIC = {
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>', check: '<path d="M20 6 9 17l-5-5"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    home: '<path d="M3 11.2 12 4l9 7.2"/><path d="M5.5 9.5V20h13V9.5"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', chat: '<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-5.6A8 8 0 1 1 21 12Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
    buy: '<path d="M3 11.2 12 4l9 7.2"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>', sell: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    rent: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m16 7 3 3"/>', direct: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
    services: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>', shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.2 2.2 4.3-4.4"/>',
    scale: '<path d="M12 4v16M7 20h10M5 7h14"/><path d="m5 7-3 6a3 3 0 0 0 6 0L5 7Z"/><path d="m19 7-3 6a3 3 0 0 0 6 0l-3-6Z"/>', doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    bank: '<path d="M3 21h18M4 18h16M12 3 3.5 8h17L12 3Z"/><path d="M6 8.5V18M10 8.5V18M14 8.5V18M18 8.5V18"/>', store: '<path d="M4 9.5V20h16V9.5"/><path d="M2.8 9.5 4.5 4h15l1.7 5.5"/><path d="M2.8 9.5a2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.6 0"/><path d="M9.5 20v-5h5v5"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/>', box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', heart: '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6Z"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    admin: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>', chat: '<path d="M20 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20l1.2-4.4A8.4 8.4 0 1 1 20 11.5Z"/>',
    chev: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', menu: '<path d="M4 7h16M4 12h16M4 17h10"/>', truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
    pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', check: '<path d="m5 12 4.5 4.5L19 7"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>', star: '<path d="m12 2.6 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>'
  };
  const initialsOf = (n) => String(n || 'R').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'R';
  // Member picture: Google profile photo when they signed in with Google, otherwise their initials
  const avatarIn = (s) => { const ini = esc(initialsOf(s && s.name)); const ph = s && s.photo; return ph ? `<img class="av-photo" src="${esc(ph)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async" data-ini="${ini}" onerror="this.parentNode.classList.remove('has-photo');this.replaceWith(this.dataset.ini)">` : ini; };
  const drawer = { el: null };
  function drawerHTML(focus) {
    const s = db.session; const signed = isComplete();
    const first = s && s.name ? s.name.split(/\s+/)[0] : '';
    const hour = new Date().getHours(); const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const it = (icon, label, attrs, sub = '') => `<button type="button" class="dr-item" ${attrs}><span class="dr-ico">${DI(DIC[icon])}</span><span class="dr-txt"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
    const myOrders = (mk.data && mk.data.orders || []).filter((o) => s && o.buyerId === s.userId && !['released', 'refunded', 'cancelled'].includes(o.status)).length;
    return `<div class="dr-panel" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="dr-head">
        <button type="button" class="dr-close" data-dr="close" aria-label="Close menu">${DI(DIC.x, 20)}</button>
        ${signed ? `<div class="dr-user"><span class="dr-avatar ${s.photo ? 'has-photo' : ''}">${avatarIn(s)}</span><div><small>${esc(greet)} 👋</small><h2>Welcome back, <span class="gold-text">${esc(first || 'friend')}</span></h2><p>${esc(s.email || '')}</p></div></div>`
          : `<div class="dr-user"><span class="dr-avatar">R</span><div><small>Welcome to RAQBO</small><h2>Sign in to get started</h2><p>Save properties, list yours and order materials.</p></div></div><div class="dr-auth"><button type="button" class="button button-primary" data-dr="signin">Sign in</button><button type="button" class="button dr-ghost" data-dr="signup">Create account</button></div>`}
      </div>
      <div class="dr-body">
        <div class="dr-group"><span class="dr-label">Explore properties</span>
          ${it('buy', 'Buy', 'data-dr="deal" data-deal-to="sale"', 'Homes, plots & commercial for sale')}
          ${it('sell', 'Sell', 'data-dr="list"', 'List your property with RAQBO')}
          ${it('rent', 'Rent', 'data-dr="deal" data-deal-to="rent"', 'Houses & apartments for rent')}
          ${it('direct', 'RAQBO Direct', 'data-dr="anchor" data-to="#direct"', 'Deal directly with owners')}
          <button type="button" class="dr-item" data-dr="gw" data-gw="wanted"><span class="dr-ico">${DI(GI.target)}</span><span class="dr-txt"><b>Property Wanted</b><small>Post what you need · owners reply</small></span></button>
          <button type="button" class="dr-item" data-dr="gw" data-dl="urgent-page"><span class="dr-ico">${DI(DIC.alert)}</span><span class="dr-txt"><b>QuickSell</b><small>Sell fast · RAQBO, investors or public</small></span></button>
          <button type="button" class="dr-item" data-dr="gw" data-ax="home"><span class="dr-ico">${DI(DIC.gavel || DIC.star)}</span><span class="dr-txt"><b>Property auctions</b><small>Live, upcoming and completed</small></span></button>
          <button type="button" class="dr-item" data-dr="gw" data-gw="guides"><span class="dr-ico">${DI(GI.book)}</span><span class="dr-txt"><b>Free property guides</b><small>Checklists &amp; sample documents</small></span></button>
        </div>
        <div class="dr-group dr-services ${focus === 'services' ? 'is-focus' : ''}" id="dr-services"><span class="dr-label">RAQBO Connect</span>
          <button type="button" class="dr-allsvc" data-dr="services-page"><span>${DI(DIC.services, 18)} Explore all services</span>${DI('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 16)}</button>
          <button type="button" class="dr-feature" data-dr="market"><span class="dr-feature-ico">${DI(DIC.store, 24)}</span><span><b>Construction Materials Marketplace</b><small>Construction material suppliers · secure protected orders</small></span><span class="dr-new">NEW</span></button>
          <div class="dr-sub">
            <button type="button" data-dr="market">${DI(DIC.grid, 15)} Browse vendors</button>
            <button type="button" data-dr="market-supplier">${DI(DIC.plus, 15)} Create supplier profile</button>
            <button type="button" data-dr="market-orders">${DI(DIC.cart, 15)} My material orders${myOrders ? ` <em>${myOrders}</em>` : ''}</button>
          </div>
          <span class="dr-label dr-label-sub">Our services</span>
          ${it('shield', 'Property verification', 'data-dr="service" data-svc="verification"', 'Title, ownership & document checks')}
          ${it('scale', 'Legal services', 'data-dr="service" data-svc="legal"', 'Agreements, transfers & advice')}
          ${it('doc', 'Document drafting', 'data-dr="service" data-svc="documents"', 'Sale deeds, rent agreements & more')}
          ${it('bank', 'Registry assistance', 'data-dr="service" data-svc="registry"', 'Registry, mutation & transfer help')}
        </div>
        <div class="dr-group"><span class="dr-label">Company</span>
          ${it('info', 'About us', 'data-dr="about"', 'Founder, projects & our story')}
          ${it('box', 'Our projects', 'data-dr="projects"', 'Completed, ongoing & upcoming')}
          ${it('chat', 'Contact RAQBO', 'data-dr="whatsapp"', 'Chat with us on WhatsApp')}
        </div>
        ${signed ? `<div class="dr-group"><span class="dr-label">My account</span>
          ${it('user', 'My account & listings', 'data-dr="account"')}
          <button type="button" class="dr-item" data-dr="gw" data-my="overview"><span class="dr-ico">${DI(DIC.grid)}</span><span class="dr-txt"><b>My RAQBO dashboard</b><small>Properties, requests, offers &amp; bids</small></span></button>
          <button type="button" class="dr-item" data-dr="gw" data-gw="rewards"><span class="dr-ico">${DI(GI.gift)}</span><span class="dr-txt"><b>My RAQBO Rewards</b><small>Founding badge, invite link &amp; credit</small></span></button>
          ${it('heart', 'Saved properties', 'data-dr="saved"')}
          ${(mk.data && mk.myVendor()) ? it('store', 'My shop dashboard', 'data-dr="market-shop"') : ''}
          ${db.isAdmin && LIVE ? it('admin', 'Admin panel', 'data-dr="admin"') : ''}
          ${it('out', 'Sign out', 'data-dr="signout"')}
        </div>` : ''}
      </div>
    </div>`;
  }
  function openDrawer(focus) {
    if (!drawer.el) {
      drawer.el = document.createElement('div'); drawer.el.className = 'dr'; drawer.el.hidden = true; document.body.append(drawer.el);
      drawer.el.addEventListener('mousedown', (e) => { if (e.target === drawer.el) closeDrawer(); });
      drawer.el.addEventListener('click', drawerClick);
    }
    drawer.el.innerHTML = drawerHTML(focus); applyBrandIcons(drawer.el);
    drawer.el.hidden = false; requestAnimationFrame(() => drawer.el.classList.add('is-open')); document.body.classList.add('dr-open');
    $$('.menu-trigger').forEach((b) => b.setAttribute('aria-expanded', 'true'));
    setTimeout(() => { const t = focus === 'services' ? $('#dr-services', drawer.el) : null; if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); const c = $('.dr-close', drawer.el); if (c) c.focus({ preventScroll: true }); }, 60);
  }
  function closeDrawer() {
    if (!drawer.el || drawer.el.hidden) return; drawer.el.classList.remove('is-open'); document.body.classList.remove('dr-open');
    $$('.menu-trigger').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    setTimeout(() => { if (!drawer.el.classList.contains('is-open')) drawer.el.hidden = true; }, 260);
  }
  function drawerClick(e) {
    const b = e.target.closest('[data-dr]'); if (!b) return; const a = b.dataset.dr; closeDrawer();
    const go = (fn) => setTimeout(fn, 120);
    if (a === 'close') return;
    if (a === 'signin') go(() => showGate('signin')); else if (a === 'signup') go(() => showGate('signup'));
    else if (a === 'deal') go(() => { closeOverlays(); setDeal(b.dataset.dealTo); scrollToResults(); });
    else if (a === 'list') go(() => ACTIONS.list()); else if (a === 'anchor') go(() => { closeOverlays(); const t = $(b.dataset.to); if (t) t.scrollIntoView({ behavior: 'smooth' }); });
    else if (a === 'market') go(() => openMarket('dir')); else if (a === 'market-supplier') go(() => openMarket('shop', { createProfile: true }));
    else if (a === 'market-orders') go(() => openMarket('orders')); else if (a === 'market-shop') go(() => openMarket('shop'));
    else if (a === 'service') go(() => { closeOverlays(); openEnquiry(b.dataset.svc); });
    else if (a === 'services-page') go(() => openServices());
    else if (a === 'about') go(() => openAbout()); else if (a === 'projects') go(() => openAbout('au-completed'));
    else if (a === 'whatsapp') window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hi RAQBO, I need some help.')}`, '_blank', 'noopener');
    else if (a === 'account') go(() => openAccount()); else if (a === 'saved') go(() => { closeOverlays(); if (!ui.savedOnly) { const t = $('#saved-toggle'); if (t) t.click(); } scrollToResults(); });
    else if (a === 'admin') go(() => openAdmin()); else if (a === 'signout') go(() => signOut());
  }
  function closeOverlays() { if (pp.el && !pp.el.hidden) closeDetails(); if (au.el && !au.el.hidden) closeAbout(); if (mk.el && !mk.el.hidden) closeMarket(); if (svs.el && !svs.el.hidden) closeServices(); }
  function updateMenuTrigger() {
    const s = db.session; const signed = isComplete();
    $$('.menu-trigger').forEach((b) => { b.innerHTML = signed ? `<span class="mt-avatar ${s.photo ? 'has-photo' : ''}">${avatarIn(s)}</span><span class="mt-label">Menu</span>${DI(DIC.menu, 18)}` : `<span class="mt-label">Menu</span>${DI(DIC.menu, 18)}`; });
  }

