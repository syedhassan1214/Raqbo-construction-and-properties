  /* =====================================================================
     Construction Materials Marketplace — UI
     ===================================================================== */
  const mk = {
    el: null, view: 'dir', data: null, loading: false, err: '', vendorId: null, orderId: null, unsub: null, timer: null,
    filter: { mat: 'all', q: '', city: '', escrow: false, verified: false }, ordersTab: 'buying', shopTab: 'orders', adminTab: 'payments',
    cart: (() => { try { return store.get('mk-cart', { vendorId: null, qty: {} }); } catch { return { vendorId: null, qty: {} }; } })(),
    myVendor() { const s = db.session; return (this.data && s) ? this.data.vendors.find((v) => v.ownerId && v.ownerId === s.userId) || null : null; },
    vendor(id) { return this.data ? this.data.vendors.find((v) => v.id === id) || null : null; },
    order(id) { return this.data ? this.data.orders.find((o) => o.id === id) || null : null; }
  };
  const PKR = (n) => 'PKR ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const waNum = (p) => String(p || '').replace(/\D/g, '');
  const telOf = (p) => '+' + waNum(p);
  const showPhone = (p) => normPhone(p) || p || '';
  const ago = (t) => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
  const chip = (st) => { const [l, c] = ORDER_STATUS[st] || [st, 'muted']; return `<span class="mk-status ${c}">${esc(l)}</span>`; };
  const saveCart = () => { try { store.set('mk-cart', mk.cart); } catch { /* ignore */ } };
  const mkStars = (v, size) => (typeof starsHTML === 'function' ? starsHTML(v, size) : '');
  function priceSummary(v) {
    const priced = v.products.filter((p) => p.price != null && p.stock !== 'out');
    if (!priced.length) return { html: '<span class="mk-por">Price on request</span>', live: null };
    const low = priced.reduce((a, b) => (a.price <= b.price ? a : b));
    const latest = Math.max(...v.products.map((p) => p.priceAt || 0));
    return { html: `<span class="mk-from">From <b>${PKR(low.price)}</b> / ${esc(low.unit)}</span>`, live: latest };
  }
  function trendHTML(p) {
    if (p.price == null || p.prevPrice == null || p.prevPrice === p.price) return '';
    const up = p.price > p.prevPrice; const pct = Math.abs(((p.price - p.prevPrice) / p.prevPrice) * 100).toFixed(1);
    return `<span class="mk-trend ${up ? 'up' : 'down'}" title="Was ${PKR(p.prevPrice)}">${up ? '▲' : '▼'} ${pct}%</span>`;
  }
  const stockHTML = (s) => `<span class="mk-stock ${s}">${s === 'in_stock' ? 'In stock' : s === 'low' ? 'Low stock' : 'Out of stock'}</span>`;

  async function mkLoad() {
    mk.loading = true; mk.err = '';
    try { mk.data = await MK.load(); } catch (err) { mk.err = /does not exist|schema cache|relation/i.test(err.message) ? 'The marketplace is being set up. (Admin: run update_5_marketplace.sql in the Supabase SQL Editor.)' : err.message; if (!mk.data) mk.data = { vendors: [], orders: [], buyer: null, priv: null, admin: null }; }
    mk.loading = false;
  }
  function mkSoon(source) {
    clearTimeout(mk.timer);
    mk.timer = setTimeout(async () => {
      if (!mk.el || mk.el.hidden) { if (admin.el && !admin.el.hidden && String(admin.tab).startsWith('mk-')) { await mkLoad(); renderAdmin(); } else mk.data = null; return; }
      await mkLoad();
      const a = document.activeElement; if (a && mk.el.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && !a.closest('.mk-filters')) { mk.dirty = true; return; }
      mkRender(true);
      if (source && source !== 'local') { const live = $('.mk-livebadge', mk.el); if (live) { live.classList.remove('pulse'); void live.offsetWidth; live.classList.add('pulse'); } }
    }, source === 'local' ? 30 : 350);
  }
  function mkShell() {
    if (mk.el) return mk.el;
    mk.el = document.createElement('div'); mk.el.className = 'mk'; mk.el.hidden = true; mk.el.setAttribute('role', 'dialog'); mk.el.setAttribute('aria-label', 'Construction Materials Marketplace');
    document.body.append(mk.el);
    mk.el.addEventListener('click', mkClick);
    mk.el.addEventListener('input', (e) => {
      const f = e.target.closest('[data-mkf]'); if (f) { const k = f.dataset.mkf; mk.filter[k] = f.type === 'checkbox' ? f.checked : f.value.trim(); clearTimeout(mk.ft); mk.ft = setTimeout(() => renderGridOnly(), k === 'q' ? 160 : 0); }
      const qi = e.target.closest('[data-qty]'); if (qi) { const v = Math.max(0, parseInt(qi.value, 10) || 0); const id = qi.dataset.qty; if (mk.cart.vendorId !== mk.vendorId) mk.cart = { vendorId: mk.vendorId, qty: {} }; if (v) mk.cart.qty[id] = v; else delete mk.cart.qty[id]; saveCart(); renderCartOnly(); }
    });
    mk.el.addEventListener('focusout', () => { if (mk.dirty) setTimeout(() => { const a = document.activeElement; if (!(a && mk.el.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { mk.dirty = false; mkRender(true); } }, 50); });
    return mk.el;
  }
  async function openMarket(view = 'dir', opts = {}) {
    if (pp.el && !pp.el.hidden) closeDetails({ fromHistory: true }); if (au.el && !au.el.hidden) closeAbout({ fromHistory: true }); closeModal(); closeDrawer();
    const el = mkShell(); mk.view = view; if (opts.vendorId) mk.vendorId = opts.vendorId; if (opts.orderId) mk.orderId = opts.orderId;
    el.hidden = false; document.body.classList.add('pp-open');
    const h = mkHash(); if (!opts.fromHistory && location.hash !== h) { try { history.pushState({ mk: 1 }, '', h); } catch { /* ignore */ } }
    if (!mk.data) { el.innerHTML = mkTop() + '<div class="mk-in"><div class="skeleton" style="height:260px;border-radius:20px;margin:40px 0"></div></div>'; await mkLoad(); }
    if (!mk.unsub) { try { mk.unsub = MK.subscribe((t) => mkSoon(t)); } catch { mk.unsub = null; } }
    mkRender(); el.scrollTop = 0;
    if (opts.createProfile) { if (mk.myVendor()) mkShopForm(); else requireSignIn(() => mkShopForm()); }
  }
  function closeMarket(opts = {}) {
    if (!mk.el || mk.el.hidden) return; mk.el.hidden = true; if ((!pp.el || pp.el.hidden) && (!au.el || au.el.hidden)) document.body.classList.remove('pp-open');
    if (mk.unsub && !(admin.el && !admin.el.hidden)) { try { mk.unsub(); } catch { /* ignore */ } mk.unsub = null; }
    if (!opts.fromHistory && location.hash.startsWith('#marketplace')) { try { history.pushState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
  }
  const mkHash = () => (mk.view === 'vendor' && mk.vendorId ? '#marketplace/vendor/' + encodeURIComponent(mk.vendorId) : mk.view === 'order' && mk.orderId ? '#marketplace/order/' + encodeURIComponent(mk.orderId) : '#marketplace');
  // #marketplace, #marketplace/vendor/<id>, #marketplace/order/<id> (the link in order emails)
  function mkParseHash(h) {
    const v = h.match(/^#marketplace\/vendor\/(.+)$/); if (v) return { view: 'vendor', vendorId: decodeURIComponent(v[1]) };
    const o = h.match(/^#marketplace\/order\/(.+)$/); if (o) return { view: 'order', orderId: decodeURIComponent(o[1]) };
    return { view: null };
  }
  function openMarketFromHash() {
    const r = mkParseHash(location.hash);
    if (r.view === 'order' && !isComplete()) { gate.onDone = async () => { await mkLoad(); openMarket('order', { fromHistory: true, orderId: r.orderId }); }; return Promise.resolve(); }
    return openMarket(r.view || 'dir', { fromHistory: true, vendorId: r.vendorId, orderId: r.orderId }).then(() => { if (r.view === 'vendor' && mk.vendor(r.vendorId)) loadVendorReviews(mk.vendor(r.vendorId)); });
  }
  function mkGo(view, extra = {}) {
    mk.view = view; Object.assign(mk, extra); const h = mkHash();
    try { if (location.hash !== h) history.pushState({ mk: 1 }, '', h); } catch { /* ignore */ }
    mkRender(); mk.el.scrollTop = 0;
  }
  window.addEventListener('popstate', () => {
    const h = location.hash;
    if (h.startsWith('#marketplace')) { const r = mkParseHash(h); openMarket(r.view || (['vendor', 'order'].includes(mk.view) ? 'dir' : mk.view), { fromHistory: true, vendorId: r.vendorId, orderId: r.orderId }); }
    else closeMarket({ fromHistory: true });
  });

  function mkTop() {
    const s = db.session; const signed = isComplete(); const myV = mk.data && mk.myVendor();
    const logo = ($('.brand-logo') || {}).src || '';
    const nOpen = mk.data ? mk.data.orders.filter((o) => s && o.buyerId === s.userId && !['released', 'refunded', 'cancelled'].includes(o.status)).length : 0;
    return `<header class="mk-top"><div class="mk-top-in">
      <button type="button" class="mk-back" data-mk="home">${DI('<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>', 16)} <span>Back to Home</span></button>
      <button type="button" class="mk-logo" data-mk="dir" aria-label="Marketplace home">${logo ? `<img src="${esc(logo)}" alt="" width="40" height="34">` : ''}<span><b>RAQBO</b><small>Construction Materials · Order Online</small></span></button>
      <div class="mk-top-actions">
        <button type="button" class="mk-tbtn gold" data-mk="${myV ? 'shop' : 'create-profile'}">${DI(myV ? DIC.store : DIC.plus, 16)} <span>${myV ? 'My shop' : 'Create Profile'}</span></button>
        ${signed ? `<button type="button" class="bell-btn mk-bell" data-bell aria-label="Notifications" aria-haspopup="true" aria-expanded="false">${DI(DIC.bell, 18)}<span class="bell-dot" ${lv.unread ? '' : 'hidden'}>${lv.unread > 9 ? '9+' : lv.unread}</span></button>` : ''}${signed ? `<button type="button" class="mk-tbtn" data-mk="orders">${DI(DIC.cart, 16)} <span>My orders</span>${nOpen ? `<em>${nOpen}</em>` : ''}</button>` : `<button type="button" class="mk-tbtn" data-mk="buyer-login">${DI(DIC.user, 16)} <span>Buyer Sign-Up / Login</span></button>`}
      </div></div>
      ${signed ? `<nav class="mk-tabs" aria-label="Marketplace sections"><div class="mk-tabs-in">
        <button type="button" data-mk="dir" class="${['dir', 'vendor'].includes(mk.view) ? 'on' : ''}">Directory</button>
        <button type="button" data-mk="orders" class="${['orders', 'order'].includes(mk.view) ? 'on' : ''}">My orders</button>
        <button type="button" data-mk="shop" class="${mk.view === 'shop' ? 'on' : ''}">${myV ? 'My shop' : 'Become a supplier'}</button>
        <span class="mk-livebadge" title="Rates and orders update in real time"><i></i> Live</span>
      </div></nav>` : ''}
    </header>`;
  }
  function mkRender(keepScroll) {
    const y = mk.el ? mk.el.scrollTop : 0;
    if (admin.el && !admin.el.hidden && String(admin.tab).startsWith('mk-')) renderAdmin();
    if (!mk.el) return;
    const views = { dir: mkDirHTML, vendor: mkVendorHTML, orders: mkOrdersHTML, order: mkOrderHTML, shop: mkShopHTML };
    if (mk.view === 'admin') mk.view = 'dir';
    setTimeout(v3cBar, 0); mk.el.innerHTML = mkTop() + (mk.err ? `<div class="mk-in"><p class="mk-err">${esc(mk.err)}</p></div>` : '') + (views[mk.view] || mkDirHTML)();
    applyBrandIcons(mk.el); hydrateProofs(mk.el);
    if (keepScroll) mk.el.scrollTop = y;
  }

  /* ---------- Directory ---------- */
  const MAT_ICONS = { Cement: '<path d="M6 3h12l2 18H4L6 3Z"/><path d="M8 8h8M9 13h6"/>', Bricks: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4"/>', Steel: '<path d="M4 7h16M4 12h16M4 17h16"/>', 'Sand & Crush': '<path d="M3 19 9 8l4 6 2-3 6 8H3Z"/>', Tiles: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>', Paint: '<rect x="3" y="4" width="15" height="6" rx="1.5"/><path d="M18 7h2v5h-8v3"/><rect x="10" y="15" width="4" height="6" rx="1"/>', Electrical: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>', Plumbing: '<path d="M4 4v6h8v10"/><path d="M12 14h6a2 2 0 0 1 2 2v4"/>', Wood: '<path d="M3 17 17 3l4 4L7 21H3v-4Z"/>', Glass: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="m8 10 4-4M8 15l8-8"/>', Aluminium: '<path d="M4 20V4h16v16Z"/><path d="M9 4v16M15 4v16"/>', Hardware: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4Z"/>', Solar: '<rect x="3" y="9" width="18" height="10" rx="1"/><path d="M8 9v10M16 9v10M3 14h18M12 2v3M5 5l1.5 1.5M19 5l-1.5 1.5"/>', 'Machinery Rental': '<path d="M3 17h13l3-5h-5V7H6v5H3Z"/><circle cx="7" cy="18" r="2"/><circle cx="15" cy="18" r="2"/>' };
  function vendorList() {
    const f = mk.filter; const q = f.q.toLowerCase();
    return (mk.data ? mk.data.vendors : []).filter((v) => v.status === 'approved')
      .filter((v) => (f.mat === 'all' || v.materials.includes(f.mat) || v.products.some((p) => p.category === f.mat)) && (!f.city || v.city === f.city) && (!f.escrow || v.escrow) && (!f.verified || v.verified)
        && (!q || [v.shop, v.owner, v.area, v.city, ...v.materials, ...v.products.map((p) => p.name + ' ' + p.code + ' ' + p.category)].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.verified - a.verified) || (b.escrow - a.escrow) || ((b.rating ? b.rating.avg : 0) - (a.rating ? a.rating.avg : 0)) || a.shop.localeCompare(b.shop));
  }
  function vendorCard(v) {
    const ps = priceSummary(v); const canBuy = v.escrow && v.products.some((p) => p.price != null && p.stock !== 'out');
    const msg = `Hi ${v.owner}, I found ${v.shop} on RAQBO (raqbo.com). I need ${v.materials.slice(0, 3).join(', ')} in ${v.city}. Please share your rates.`;
    return `<article class="mk-card" data-vendor="${esc(v.id)}">
      <div class="mk-card-top"><span class="mk-avatar">${esc(initialsOf(v.shop))}</span>
        <div class="mk-badges">${v.verified ? `<span class="mk-badge ver">${DI(DIC.check, 12)} Verified</span>` : ''}${v.escrow ? `<span class="mk-badge esc">${DI(DIC.lock, 12)} Protected pay</span>` : ''}${v.sample ? '<span class="mk-badge smp">Sample</span>' : ''}</div></div>
      <div class="mk-card-body">
        <h3><button type="button" data-mk="vendor" data-id="${esc(v.id)}">${esc(v.shop)}</button></h3><p class="mk-owner">${esc(v.owner)}</p>
        <p class="mk-loc">${DI(DIC.pin, 14)} ${esc(v.area ? v.area + ', ' : '')}${esc(v.city)} <span>· ${esc(v.radius)} km radius</span></p>
        <div class="mk-tags">${v.materials.slice(0, 4).map((m) => `<span>${esc(m)}</span>`).join('')}${v.materials.length > 4 ? `<span>+${v.materials.length - 4}</span>` : ''}</div>
        <div class="mk-pricebar">${ps.html}${ps.live ? `<span class="mk-live" title="Rates updated ${esc(fmtDate(ps.live))}"><i></i> Live rate · ${esc(ago(ps.live))}</span>` : ''}</div>
        <div class="mk-rate">${v.rating ? `${mkStars(v.rating.avg, 'sm')} <b>${v.rating.avg.toFixed(1)}</b> <small>(${v.rating.count} review${v.rating.count === 1 ? '' : 's'})</small>` : '<small>New supplier · no reviews yet</small>'}</div>
        <div class="mk-actions">${v3cBox(v)}
          <button type="button" class="button button-primary" data-mk="vendor" data-id="${esc(v.id)}">${canBuy ? `${DI(DIC.lock, 15)} Buy Now` : 'Request Quote'}</button>
          <a class="mk-icon wa" href="https://wa.me/${waNum(v.whatsapp)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(v.shop)}" title="WhatsApp">${DI(DIC.chat, 18)}</a>
          <a class="mk-icon" href="tel:${esc(telOf(v.phone))}" aria-label="Call ${esc(v.shop)}" title="Call">${DI(DIC.phone, 17)}</a>
        </div>
      </div></article>`;
  }
  function gridHTML() {
    const list = vendorList();
    return `<div class="mk-count"><b>${list.length}</b> vendor${list.length === 1 ? '' : 's'} found</div>
      <div class="mk-grid">${list.length ? list.map(vendorCard).join('') : `<div class="mk-empty">${DI(DIC.search, 30)}<b>No vendors match these filters</b><small>Try another material or city — or create the first supplier profile here.</small><button type="button" class="button button-primary" data-mk="create-profile">+ Create supplier profile</button></div>`}</div>`;
  }
  function renderGridOnly() { const g = $('.mk-results', mk.el); if (g) { g.innerHTML = gridHTML(); applyBrandIcons(g); } $$('.mk-chip', mk.el).forEach((c) => c.classList.toggle('on', c.dataset.mat === mk.filter.mat)); }
  function mkDirHTML() {
    const f = mk.filter;
    return `<section class="mk-hero"><div class="mk-in mk-hero-grid">
        <div><div class="eyebrow eyebrow-light"><span></span> VENDOR &amp; BUYER DIRECTORY</div>
          <h1>Find Material Suppliers &amp; <span class="gold-text">Place Secure Orders</span></h1>
          <p>Cement, bricks, steel, tiles and more from suppliers across Pakistan. Negotiate directly on WhatsApp, or order in-app with RAQBO payment protection — your money is released to the vendor only after you confirm delivery.</p>
          <div class="mk-hero-cta"><button type="button" class="button button-primary" data-mk="cta">${DI(DIC.plus, 16)} Create Profile / Order</button><button type="button" class="button mk-ghost" data-mk="browse">Browse Vendors</button><button type="button" class="button mk-ghost" data-v3s="req" data-k="bulk_materials">Bulk enquiry</button></div></div>
        <div class="mk-modes">
          <div class="mk-mode"><span class="mk-mode-ico">${DI(DIC.chat, 22)}</span><div><b>Direct contact</b><p>Call or WhatsApp suppliers to negotiate bulk rates.</p></div></div>
          <div class="mk-mode esc"><span class="mk-mode-ico">${DI(DIC.lock, 22)}</span><div><b>Protected order</b><p>Pay into RAQBO Protected Payment → vendor delivers → you inspect &amp; confirm → vendor gets paid.</p></div></div>
          <div class="mk-mode"><span class="mk-mode-ico">${DI(DIC.truck, 22)}</span><div><b>Delivery tracking</b><p>Vehicle, driver and ETA on every protected order, updated live.</p></div></div>
        </div></div></section>
      <section class="mk-in mk-dir" id="mk-browse">
        <div class="mk-chips" role="toolbar" aria-label="Filter by material">${[['all', 'All Materials'], ...MATERIALS.map((m) => [m, m])].map(([k, l]) => `<button type="button" class="mk-chip ${f.mat === k ? 'on' : ''}" data-mk="mat" data-mat="${esc(k)}">${DI(MAT_ICONS[k] || DIC.grid, 15)} ${esc(l)}</button>`).join('')}</div>
        <div class="mk-filters">
          <label class="mk-search">${DI(DIC.search, 17)}<input type="search" data-mkf="q" value="${esc(f.q)}" placeholder="Search shop name, area, material or product code…" aria-label="Search vendors"></label>
          <select data-mkf="city" aria-label="City"><option value="">All Cities</option>${MK_CITIES.map((c) => `<option ${f.city === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <label class="mk-toggle"><input type="checkbox" data-mkf="escrow" ${f.escrow ? 'checked' : ''}><span></span> Protected payment only</label>
          <label class="mk-toggle"><input type="checkbox" data-mkf="verified" ${f.verified ? 'checked' : ''}><span></span> Verified suppliers</label>
        </div>
        <div class="mk-results">${gridHTML()}</div>
      </section>
      <section class="mk-safety"><div class="mk-in">
        <div class="mk-head"><div class="eyebrow"><span></span> PLATFORM SAFETY</div><h2>Protected from order to delivery</h2></div>
        <div class="mk-safe-grid">
          <div><span>${DI(DIC.lock, 22)}</span><b>Payment protection</b><p>Your payment is held by RAQBO and released to the vendor only after you confirm delivery. Sellers get guaranteed payouts.</p></div>
          <div><span>${DI(DIC.scale, 22)}</span><b>Dispute resolution</b><p>Wrong quality, short quantity or late delivery? Open a dispute in the order and RAQBO decides on a refund or release.</p></div>
          <div><span>${DI(DIC.shield, 22)}</span><b>Identity &amp; policy protection</b><p>Suppliers are checked before the Verified badge. Off-platform payment abuse and fraud lead to account suspension.</p></div>
          <div><span>${DI(DIC.star, 22)}</span><b>Genuine reviews only</b><p>Only buyers who completed an order through RAQBO can rate a vendor.</p></div>
        </div>
        <div class="mk-tier">${DI(DIC.trend, 22)}<div><b>Registered Commercial Buyers</b><p>Contractors, builders and dealers can be registered by RAQBO to unlock vendor bulk discounts on every protected order. Live rates for fluctuating materials like steel and cement update instantly.</p></div><button type="button" class="button button-outline" data-mk="buyer-profile">Set up buyer profile</button></div>
      </div></section>`;
  }

  /* ---------- Vendor page + cart ---------- */
  function cartLines(v) {
    if (mk.cart.vendorId !== v.id) return [];
    return Object.entries(mk.cart.qty).map(([id, qty]) => ({ p: v.products.find((x) => x.id === id), qty })).filter((x) => x.p && x.qty > 0);
  }
  function cartHTML(v) {
    const lines = cartLines(v); const buyer = mk.data.buyer;
    const unpriced = lines.some((l) => l.p.price == null); const sub = lines.reduce((a, l) => a + (l.p.price || 0) * l.qty, 0);
    const disc = buyer && buyer.commercial && v.bulkDiscount ? Math.round(sub * v.bulkDiscount / 100) : 0;
    const belowMin = lines.filter((l) => l.qty < l.p.minQty);
    const canEscrow = v.escrow && !unpriced && lines.length && !belowMin.length;
    return `<div class="mk-cart-head">${DI(DIC.cart, 18)} <b>Your order</b>${lines.length ? `<button type="button" class="link-button" data-mk="cart-clear">Clear</button>` : ''}</div>
      ${lines.length ? `<ul class="mk-cart-lines">${lines.map((l) => `<li><span><b>${esc(l.p.name)}</b><small>${l.qty} × ${l.p.price == null ? 'price on request' : PKR(l.p.price)} / ${esc(l.p.unit)}</small>${l.qty < l.p.minQty ? `<em class="mk-warn">Minimum ${l.p.minQty} ${esc(l.p.unit)}</em>` : ''}</span><b>${l.p.price == null ? '—' : PKR(l.p.price * l.qty)}</b></li>`).join('')}</ul>
        <dl class="mk-totals"><div><dt>Subtotal</dt><dd>${unpriced ? 'On quote' : PKR(sub)}</dd></div><div><dt>Delivery (${esc(v.city)}, ${esc(v.radius)} km)</dt><dd>${PKR(v.deliveryFee)}</dd></div>${disc ? `<div class="disc"><dt>Commercial buyer −${v.bulkDiscount}%</dt><dd>−${PKR(disc)}</dd></div>` : ''}<div class="tot"><dt>Total</dt><dd>${unpriced ? 'On quote' : PKR(sub + v.deliveryFee - disc)}</dd></div></dl>`
        : '<p class="mk-cart-empty">Enter quantities in the catalog to build your order.</p>'}
      <div class="mk-cart-btns">
        ${v.escrow ? `<button type="button" class="button button-primary" data-mk="checkout" ${canEscrow ? '' : 'disabled'}>${DI(DIC.lock, 15)} Proceed to Checkout</button>` : ''}
        <button type="button" class="button ${v.escrow ? 'button-outline' : 'button-primary'}" data-mk="quote" ${lines.length && !belowMin.length ? '' : 'disabled'}>Request Quote</button>
      </div>
      <p class="mk-cart-note">${v.escrow ? (unpriced ? 'Some items are “price on request” — send a quote request; you can pay through RAQBO once the vendor quotes.' : `${DI(DIC.lock, 13)} Payment protected: pay into RAQBO Protected Payment, the vendor is paid only after you confirm delivery.`) : 'This vendor does not take protected orders yet — request a quote or contact them directly.'}</p>`;
  }
  function renderCartOnly() { const v = mk.vendor(mk.vendorId); const c = $('.mk-cart', mk.el); if (v && c) c.innerHTML = cartHTML(v); }
  function mkVendorHTML() {
    const v = mk.vendor(mk.vendorId);
    if (!v) return '<div class="mk-in"><div class="mk-empty"><b>Vendor not found</b><small>This shop may no longer be listed.</small><button type="button" class="button button-primary" data-mk="dir">Back to directory</button></div></div>';
    const myV = mk.myVendor(); const own = myV && myV.id === v.id; const buyer = mk.data.buyer;
    const cats = [...new Set(v.products.map((p) => p.category))];
    const msg = `Hi ${v.owner}, I found ${v.shop} on RAQBO (raqbo.com). Please share your rates.`;
    return `<div class="mk-in mk-vendor">
      <button type="button" class="mk-crumb" data-mk="dir">${DI('<path d="m15 18-6-6 6-6"/>', 15)} All vendors</button>
      <section class="mk-vhead">
        <span class="mk-avatar lg">${esc(initialsOf(v.shop))}</span>
        <div class="mk-vinfo"><div class="mk-badges">${v.verified ? `<span class="mk-badge ver">${DI(DIC.check, 12)} Verified supplier</span>` : '<span class="mk-badge muted">Not yet verified</span>'}${v.escrow ? `<span class="mk-badge esc">${DI(DIC.lock, 12)} Protected payment</span>` : ''}${v.sample ? '<span class="mk-badge smp">Sample shop</span>' : ''}</div>
          <h1>${esc(v.shop)}</h1><p class="mk-owner">${esc(v.owner)} · on RAQBO since ${esc(fmtDay(v.createdAt))}</p>
          <div class="mk-vmeta"><span>${DI(DIC.pin, 15)} ${esc(v.area ? v.area + ', ' : '')}${esc(v.city)}</span><span>${DI(DIC.truck, 15)} ${esc(v.radius)} km radius · delivery ${PKR(v.deliveryFee)}</span>${v.deliveryNote ? `<span>${esc(v.deliveryNote)}</span>` : ''}</div>
          <div class="mk-rate">${v.rating ? `${mkStars(v.rating.avg)} <b>${v.rating.avg.toFixed(1)}</b> <small>(${v.rating.count} verified review${v.rating.count === 1 ? '' : 's'})</small>` : '<small>No reviews yet</small>'}</div>
          ${v.bulkDiscount ? `<p class="mk-tierline">${DI(DIC.trend, 14)} ${v.bulkDiscount}% off for Registered Commercial Buyers${buyer && buyer.commercial ? ' — <b>applied to your orders</b>' : ''}</p>` : ''}
        </div>
        <div class="mk-vcontact">${own ? '' : `<button type="button" class="button button-primary" data-chat="vendor" data-id="${esc(v.id)}">${DI(DIC.chat, 16)} Message shop</button>`}<a class="button mk-wa" href="https://wa.me/${waNum(v.whatsapp)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${DI(DIC.chat, 16)} WhatsApp</a><a class="button button-outline" href="tel:${esc(telOf(v.phone))}">${DI(DIC.phone, 15)} ${esc(showPhone(v.phone))}</a>
          <small>${DI(DIC.alert, 13)} For payment protection, pay only through RAQBO Protected Payment. Off-platform payments are not covered.</small></div>
      </section>
      ${v.about ? `<p class="mk-about">${esc(v.about)}</p>` : ''}
      <div class="mk-vgrid">
        <section class="mk-catalog"><div class="mk-cat-head"><h2>Catalog &amp; live rates</h2><span class="mk-livebadge"><i></i> Live</span></div>
          ${own ? '<p class="form-hint">This is your shop — buyers see this catalog. Manage items from <button type="button" class="link-button" data-mk="shop">My shop</button>.</p>' : ''}
          ${v.products.length ? cats.map((c) => `<h3 class="mk-cat-title">${esc(c)}</h3><div class="mk-table">${v.products.filter((p) => p.category === c).map((p) => `<div class="mk-row">
              <div class="mk-pname"><b>${esc(p.name)}</b>${p.brand ? ` <em class="mk-brand">${esc(p.brand)}</em>` : ''}${p.specs ? `<small class="mk-specs">${esc(p.specs)}</small>` : ''}<small>${p.code ? `Code ${esc(p.code)} · ` : ''}min ${p.minQty} ${esc(p.unit)} · ${stockHTML(p.stock)}${own ? '' : mfWatchBtn(p)}</small></div>
              <div class="mk-pprice">${p.price == null ? '<span class="mk-por">Price on request</span>' : `<b>${PKR(p.price)}</b><small>/ ${esc(p.unit)}</small>${trendHTML(p)}`}<small class="mk-upd">updated ${esc(ago(p.priceAt))}</small></div>
              <div class="mk-pqty">${own || p.stock === 'out' ? '' : `<label><span class="sr-only">Quantity of ${esc(p.name)}</span><input type="number" min="0" step="1" inputmode="numeric" data-qty="${esc(p.id)}" value="${mk.cart.vendorId === v.id && mk.cart.qty[p.id] ? mk.cart.qty[p.id] : ''}" placeholder="Qty"></label>`}</div>
            </div>`).join('')}</div>`).join('') : '<p class="mk-cart-empty">This vendor has not listed items yet — contact them for rates.</p>'}
        </section>
        <aside class="mk-cart">${own ? '<p class="mk-cart-empty">You can’t order from your own shop.</p>' : cartHTML(v)}</aside>
      </div>
      <section class="mk-vreviews"><h2>Verified buyer reviews</h2><div data-mk-reviews><div class="skeleton" style="height:80px;border-radius:14px"></div></div></section>
    </div>`;
  }
  async function loadVendorReviews(v) {
    const box = $('[data-mk-reviews]', mk.el); if (!box) return;
    try {
      const list = await MK.reviews(v.id); if (!box.isConnected) return;
      box.innerHTML = list.length ? list.map((r) => `<article class="rv-item"><span class="rv-avatar">${esc(initialsOf(r.name))}</span><div class="rv-body"><div class="rv-top"><b>${esc(r.name)}</b><span class="rv-you">Verified order</span><span class="rv-date">${esc(fmtDay(r.at))}</span></div><div class="rv-stars">${mkStars(r.rating, 'sm')}</div><p>${esc(r.comment)}</p></div></article>`).join('')
        : '<div class="rv-empty"><span>★</span><b>No reviews yet</b><small>Reviews appear after buyers complete protected orders with this vendor.</small></div>';
    } catch (err) { box.innerHTML = `<p class="form-hint">${esc(err.message)}</p>`; }
  }

  /* ---------- Buyer profile, checkout and quote ---------- */
  function buyerForm(next) {
    requireSignIn(() => {
      const b = mk.data.buyer || { name: db.session.name || '', company: '', type: 'homeowner', addresses: [] };
      const addrs = (b.addresses.length ? b.addresses : [{ label: 'Site', address: '', city: '' }]).concat([{ label: '', address: '', city: '' }, { label: '', address: '', city: '' }]).slice(0, 3);
      const card = openModal(`<div class="eyebrow"><span></span> BUYER PROFILE</div><h2>${mk.data.buyer ? 'Your buyer profile' : 'Create your buyer profile'}</h2><p class="modal-lead">Used for your orders and deliveries. ${b.commercial ? '<b>You are a Registered Commercial Buyer.</b>' : 'Contractors and companies can ask RAQBO to register them as Commercial Buyers for bulk discounts.'}</p>
        <form class="modal-form" data-mkform="buyer" novalidate>
          <div class="form-grid"><label>Full name<input name="name" maxlength="120" value="${esc(b.name)}" autocomplete="name"></label><label>Company name (optional)<input name="company" maxlength="120" value="${esc(b.company)}" autocomplete="organization"></label></div>
          <label>Buyer type<select name="type">${Object.entries(BUYER_TYPES).map(([k, l]) => `<option value="${k}" ${b.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <fieldset class="mk-fs"><legend>Delivery addresses</legend>${addrs.map((a, i) => `<div class="mk-addr"><input name="label${i}" maxlength="30" placeholder="${i ? 'Label' : 'Site'}" value="${esc(a.label)}" aria-label="Address ${i + 1} label"><input name="address${i}" maxlength="250" placeholder="${i ? 'Another address (optional)' : 'Full delivery address'}" value="${esc(a.address)}" aria-label="Address ${i + 1}"><select name="city${i}" aria-label="Address ${i + 1} city"><option value="">City</option>${MK_CITIES.map((c) => `<option ${a.city === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>`).join('')}</fieldset>
          <p class="form-hint">Phone for deliveries: <b>${esc(showPhone(db.session.phone) || 'from your account')}</b></p>
          <button type="submit" class="button button-primary modal-submit">Save buyer profile</button></form>`, { label: 'Buyer profile' });
      $('[data-mkform=buyer]', card).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const errs = [];
        const addresses = [0, 1, 2].map((i) => ({ label: f['label' + i].value.trim() || (i ? 'Address ' + (i + 1) : 'Site'), address: f['address' + i].value.trim(), city: f['city' + i].value })).filter((a) => a.address);
        if (f.elements.name.value.trim().length < 2) errs.push(['name', 'Enter your name.']);
        if (!addresses.length) errs.push(['address0', 'Add at least one delivery address.']);
        addresses.forEach((a, i) => { if (a.address.length < 5) errs.push(['address' + i, 'Enter the full address.']); if (!a.city) errs.push(['city' + i, 'Choose the city.']); });
        if (showErrors(f, errs)) return;
        const done = busy($('[type=submit]', f), 'Saving…');
        try { await MK.saveBuyer({ name: f.elements.name.value.trim(), company: f.company.value.trim(), type: f.type.value, addresses }); await mkLoad(); closeModal(); toast('Buyer profile saved.'); mkRender(true); if (next) next(); }
        catch (err) { done(); showErrors(f, [['name', err.message]]); }
      });
    });
  }
  function checkout(mode) {
    const v = mk.vendor(mk.vendorId); if (!v) return;
    requireSignIn(async () => {
      if (!mk.data.buyer) { await mkLoad(); if (!mk.data.buyer) { buyerForm(() => checkout(mode)); return; } }
      const lines = cartLines(v); if (!lines.length) { toast('Add quantities first.'); return; }
      const b = mk.data.buyer; const unpriced = lines.some((l) => l.p.price == null); if (mode === 'order' && (unpriced || !v.escrow)) mode = 'quote';
      const sub = lines.reduce((a, l) => a + (l.p.price || 0) * l.qty, 0); const disc = b.commercial && v.bulkDiscount ? Math.round(sub * v.bulkDiscount / 100) : 0;
      const card = openModal(`<div class="eyebrow"><span></span> ${mode === 'order' ? 'SECURE CHECKOUT' : 'REQUEST A QUOTE'}</div><h2>${mode === 'order' ? 'Checkout with protected payment' : 'Request a quote'}</h2>
        <p class="modal-lead">${esc(v.shop)} · ${esc(v.city)}</p>
        <ul class="mk-sum">${lines.map((l) => `<li><span>${esc(l.p.name)} <small>× ${l.qty} ${esc(l.p.unit)}</small></span><b>${l.p.price == null ? 'on quote' : PKR(l.p.price * l.qty)}</b></li>`).join('')}
          <li class="sub"><span>Delivery</span><b>${PKR(v.deliveryFee)}</b></li>${disc ? `<li class="sub disc"><span>Commercial buyer discount</span><b>−${PKR(disc)}</b></li>` : ''}
          <li class="tot"><span>Total</span><b>${unpriced || mode === 'quote' && unpriced ? 'Vendor will quote' : PKR(sub + v.deliveryFee - disc)}</b></li></ul>
        <form class="modal-form" data-mkform="checkout" novalidate>
          <label>Deliver to<select name="addr">${b.addresses.map((a, i) => `<option value="${i}">${esc(a.label)} — ${esc(a.address)}, ${esc(a.city)}</option>`).join('')}<option value="new">+ Another address</option></select></label>
          <div class="mk-newaddr" hidden><div class="form-grid"><label>Address<input name="address" maxlength="250" placeholder="Full delivery address"></label><label>City<select name="city"><option value="">City</option>${MK_CITIES.map((c) => `<option>${c}</option>`).join('')}</select></label></div></div>
          <label>Note for the vendor (optional)<textarea name="note" maxlength="600" placeholder="Delivery time, unloading, brand preference…"></textarea></label>
          ${mode === 'order' ? `<fieldset class="mk-fs"><legend>How will you pay into RAQBO Protected Payment?</legend><div class="mk-paygrid">${Object.entries(PAY_METHODS).map(([k, l], i) => `<label class="mk-pay"><input type="radio" name="pay" value="${k}" ${i ? '' : 'checked'}><span>${esc(l)}</span></label>`).join('')}</div></fieldset>
          <div class="mk-escrow-note">${DI(DIC.lock, 18)}<p><b>How protected payment works:</b> after placing the order you pay into RAQBO’s account and upload your payment screenshot. RAQBO verifies it and holds the money. The vendor dispatches, you inspect the material, confirm delivery — then RAQBO releases the payment to the vendor. Problem? Open a dispute before confirming.</p></div>
          <label class="check-row"><input type="checkbox" name="agree"> <span>I will pay only through RAQBO Protected Payment and not directly to the vendor. I understand off-platform payments are not protected and abuse can lead to account suspension (<a href="terms.html" target="_blank" rel="noopener">Terms</a>).</span></label>`
          : '<p class="form-hint">The vendor will reply with prices and delivery charges in <b>My orders</b>. You can then accept and pay through RAQBO (if the vendor offers it) or contact them directly.</p>'}
          <button type="submit" class="button button-primary modal-submit">${mode === 'order' ? 'Place order' : 'Send quote request'}</button></form>`, { label: 'Checkout' });
      const f = $('[data-mkform=checkout]', card);
      f.addr.addEventListener('change', () => { $('.mk-newaddr', f).hidden = f.addr.value !== 'new'; });
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); const errs = []; let address; let city;
        if (f.addr.value === 'new') { address = f.address.value.trim(); city = f.city.value; if (address.length < 5) errs.push(['address', 'Enter the full delivery address.']); if (!city) errs.push(['city', 'Choose the city.']); }
        else { const a = b.addresses[+f.addr.value]; address = a.address; city = a.city; }
        if (mode === 'order' && !f.agree.checked) errs.push(['agree', 'Please confirm you will pay through RAQBO Protected Payment.']);
        if (showErrors(f, errs)) return;
        const done = busy($('[type=submit]', f), mode === 'order' ? 'Placing order…' : 'Sending…');
        try {
          const id = await MK.placeOrder({ vendorId: v.id, items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })), mode, address, city, note: f.note.value.trim(), payMethod: mode === 'order' ? (($('input[name=pay]:checked', f) || {}).value || '') : '' });
          mk.cart = { vendorId: null, qty: {} }; saveCart(); closeModal(); await mkLoad();
          toast(mode === 'order' ? 'Order placed — now pay into RAQBO Protected Payment.' : 'Quote request sent to the vendor.'); mkGo('order', { orderId: id });
        } catch (err) { done(); showErrors(f, [[mode === 'order' ? 'agree' : 'note', err.message]]); }
      });
    });
  }

  /* ---------- Payment screenshots ---------- */
  const proofCache = new Map();
  function proofHTML(o, compact) {
    return `<div class="mk-proof ${compact ? 'compact' : ''}"><button type="button" class="mk-proof-thumb" data-proof="${esc(o.payProof)}" data-proof-ref="${esc(o.ref)}" aria-label="View payment screenshot full size"><span class="mk-proof-loading">Loading screenshot…</span></button>
      <div><b>${DI(DIC.check, 15)} Payment screenshot</b><small>${esc(PAY_METHODS[o.payMethod] || o.payMethod || '')}${o.payRef ? ' · ref ' + esc(o.payRef) : ''}</small><button type="button" class="link-button" data-proof-open="${esc(o.payProof)}" data-proof-ref="${esc(o.ref)}">View full size</button></div></div>`;
  }
  async function proofSrc(path) { if (!proofCache.has(path)) proofCache.set(path, MK.proofUrl(path).catch((e) => { proofCache.delete(path); throw e; })); return proofCache.get(path); }
  function hydrateProofs(root) {
    $$('[data-proof]', root).forEach(async (b) => {
      if (b.dataset.done) return; b.dataset.done = '1';
      try { const src = await proofSrc(b.dataset.proof); b.innerHTML = `<img src="${esc(src)}" alt="Payment screenshot for ${esc(b.dataset.proofRef || '')}">`; }
      catch (err) { b.innerHTML = `<span class="mk-proof-loading">${esc(err.message)}</span>`; }
    });
  }
  async function openProof(path, ref) {
    try { const src = await proofSrc(path); openModal(`<div class="eyebrow"><span></span> PAYMENT SCREENSHOT · ${esc(ref || '')}</div><div class="mk-proof-big"><img src="${esc(src)}" alt="Payment screenshot"></div><p class="form-hint">Match the amount, date and receiving account with RAQBO’s ${'bank / wallet'} statement before confirming.</p><a class="button button-outline" href="${esc(src)}" target="_blank" rel="noopener">Open in new tab</a>`, { wide: true, label: 'Payment screenshot' }); }
    catch (err) { toast(err.message); }
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-proof], [data-proof-open]'); if (!t) return;
    e.preventDefault(); e.stopPropagation(); openProof(t.dataset.proof || t.dataset.proofOpen, t.dataset.proofRef);
  }, true);
  document.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-mkform=pay] input[name=proof]'); if (!inp) return;
    const f = inp.files && inp.files[0]; const drop = inp.closest('[data-drop]'); const img = $('.mk-drop-preview', drop);
    if (!f) { img.hidden = true; drop.classList.remove('has-file'); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Please choose a JPG, PNG or WebP image.'); inp.value = ''; return; }
    if (f.size > 20 * 1024 * 1024) { toast('That image is larger than 20 MB — please send a smaller screenshot.'); inp.value = ''; return; }
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url); img.dataset.url = URL.createObjectURL(f); img.src = img.dataset.url; img.hidden = false; drop.classList.add('has-file'); showErrors(inp.closest('form'), []);
  });

  /* ---------- Orders ---------- */
  function orderRow(o, as) {
    const v = mk.vendor(o.vendorId); const items = o.items.length;
    return `<button type="button" class="mk-orow" data-mk="order" data-id="${esc(o.id)}">
      <span class="mk-orow-main"><b>${esc(as === 'buyer' ? (v ? v.shop : 'Vendor') : o.buyerName || 'Buyer')}</b><small>${esc(o.ref)} · ${items} item${items === 1 ? '' : 's'} · ${esc(fmtDay(o.createdAt))} · ${o.mode === 'quote' ? 'Quote' : 'Protected order'}</small></span>
      <span class="mk-orow-amt">${o.total == null ? '<small>Awaiting quote</small>' : `<b>${PKR(o.total)}</b>`}</span>${chip(o.status)}</button>`;
  }
  function mkOrdersHTML() {
    if (!isComplete()) return `<div class="mk-in mk-pad"><div class="mk-empty">${DI(DIC.user, 30)}<b>Sign in to see your orders</b><small>Create a free account, then order materials with payment protection.</small><button type="button" class="button button-primary" data-mk="buyer-login">Buyer Sign-Up / Login</button></div></div>`;
    const s = db.session; const myV = mk.myVendor();
    const buying = mk.data.orders.filter((o) => o.buyerId === s.userId); const selling = myV ? mk.data.orders.filter((o) => o.vendorId === myV.id) : [];
    const tab = mk.ordersTab === 'selling' && myV ? 'selling' : 'buying'; const list = tab === 'selling' ? selling : buying;
    return `<div class="mk-in mk-pad"><div class="mk-pagehead"><div><div class="eyebrow"><span></span> ORDERS &amp; TRACKING</div><h1>My orders</h1></div>
        <button type="button" class="button button-outline" data-mk="buyer-profile">${DI(DIC.user, 15)} Buyer profile</button></div>
      ${myV ? `<div class="mk-seg"><button type="button" data-mk="otab" data-tab="buying" class="${tab === 'buying' ? 'on' : ''}">Buying (${buying.length})</button><button type="button" data-mk="otab" data-tab="selling" class="${tab === 'selling' ? 'on' : ''}">Selling (${selling.length})</button></div>` : ''}
      ${list.length ? `<div class="mk-olist">${list.map((o) => orderRow(o, tab === 'selling' ? 'vendor' : 'buyer')).join('')}</div>`
        : `<div class="mk-empty">${DI(DIC.cart, 30)}<b>No orders yet</b><small>${tab === 'selling' ? 'Orders and quote requests from buyers appear here.' : 'Browse vendors, add quantities and check out with protected payment.'}</small><button type="button" class="button button-primary" data-mk="dir">Browse vendors</button></div>`}</div>`;
  }
  function escrowSteps(o) {
    if (o.mode === 'quote' && ['quote_requested', 'quoted'].includes(o.status)) return `<div class="mk-steps quote"><div class="${o.status === 'quote_requested' ? 'now' : 'done'}"><i></i><span>Quote requested</span></div><div class="${o.status === 'quoted' ? 'now' : ''}"><i></i><span>Vendor quotes</span></div><div><i></i><span>Accept &amp; pay</span></div></div>`;
    if (['cancelled', 'refunded'].includes(o.status)) return '';
    const order = ESCROW_STEPS.map((s) => s[0]); const idx = o.status === 'disputed' ? order.indexOf((o.events.slice().reverse().find((e) => order.includes(e.status)) || { status: 'paid_escrow' }).status) : order.indexOf(o.status);
    return `<div class="mk-steps">${ESCROW_STEPS.map(([k, l], i) => `<div class="${i < idx ? 'done' : i === idx ? (o.status === 'disputed' ? 'bad' : 'now') : ''}"><i>${i < idx ? DI(DIC.check, 12) : ''}</i><span>${esc(l)}</span></div>`).join('')}</div>`;
  }
  function payInstructions(o) {
    const A = ESCROW_ACCOUNT; const rows = [['Account title', A.accountTitle], ['Bank', A.bank], ['IBAN / account', A.iban], ['JazzCash', A.jazzcash], ['Easypaisa', A.easypaisa], ['SadaPay', A.sadapay], ['NayaPay', A.nayapay]].filter(([, x]) => x);
    const hasAcc = rows.length > 1;
    return `<div class="mk-paybox">${DI(DIC.lock, 22)}<div><b>Pay ${PKR(o.total)} into RAQBO Protected Payment</b>
      ${hasAcc ? `<dl>${rows.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}<div><dt>Reference</dt><dd><b>${esc(o.ref)}</b></dd></div></dl>`
        : `<p>RAQBO will share the collection account details for this order. <a href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Hi RAQBO, please send the protected payment details for order ${o.ref} (${PKR(o.total)}).`)}" target="_blank" rel="noopener">Get payment details on WhatsApp</a> and use <b>${esc(o.ref)}</b> as the reference.</p>`}
      <p class="mk-small">Never pay the vendor directly. After paying, upload the screenshot of your payment below — RAQBO checks it and holds the money until you confirm delivery.</p></div></div>
      <form class="mk-proof-form" data-mkform="pay" data-id="${esc(o.id)}" novalidate>
        <h3>${DI(DIC.check, 18)} I have paid — send proof</h3>
        <div class="mk-proof-grid">
          <label class="mk-drop" data-drop><input type="file" name="proof" accept="image/jpeg,image/png,image/webp" hidden>
            <span class="mk-drop-empty">${DI('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>', 30)}<b>Upload payment screenshot</b><small>Tap to choose · JPG or PNG</small></span>
            <img class="mk-drop-preview" alt="Selected payment screenshot" hidden></label>
          <div class="mk-proof-fields">
            <label>Paid with<select name="method">${Object.entries(PAY_METHODS).map(([k, l]) => `<option value="${k}" ${o.payMethod === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label>Transaction ID <span class="mk-opt">(optional)</span><input name="reference" maxlength="80" placeholder="e.g. 2346 7781 0091"></label>
            <button type="submit" class="button button-primary">Submit payment proof</button>
          </div>
        </div><div class="form-error" hidden></div></form>`;
  }
  function mkOrderHTML() {
    const o = mk.order(mk.orderId);
    if (!o) return '<div class="mk-in mk-pad"><div class="mk-empty"><b>Order not found</b><button type="button" class="button button-primary" data-mk="orders">My orders</button></div></div>';
    const s = db.session; const v = mk.vendor(o.vendorId); const myV = mk.myVendor();
    const isBuyer = s && o.buyerId === s.userId; const isVendor = (myV && myV.id === o.vendorId) || (v && !v.ownerId && db.isAdmin); const adm = db.isAdmin;
    const A = (act, label, cls = 'button-outline', extra = '') => `<button type="button" class="button ${cls}" data-mk="act" data-act="${act}" data-id="${esc(o.id)}" ${extra}>${label}</button>`;
    const acts = [];
    if (isBuyer) {
      if (o.status === 'quoted') { if (v && v.escrow) acts.push(A('accept_quote', `${DI(DIC.lock, 15)} Accept quote &amp; pay via RAQBO`, 'button-primary')); acts.push(A('cancel', 'Cancel')); }
      if (['quote_requested', 'awaiting_payment'].includes(o.status)) acts.push(A('cancel', 'Cancel order'));
      if (['dispatched', 'delivered'].includes(o.status)) acts.push(A('confirm_delivery', `${DI(DIC.check, 15)} I received it — confirm delivery`, 'button-primary'));
      if (['paid_escrow', 'dispatched', 'delivered'].includes(o.status)) acts.push(A('dispute', 'Report a problem', 'button-outline mk-danger'));
    }
    if (isVendor) {
      if (o.status === 'quote_requested') { acts.push(A('send_quote', 'Send quote', 'button-primary')); acts.push(A('decline', 'Decline')); }
      if (o.status === 'awaiting_payment') acts.push(A('decline', 'Decline order'));
      if (o.status === 'paid_escrow') acts.push(A('dispatch', `${DI(DIC.truck, 15)} Dispatch order`, 'button-primary'));
      if (o.status === 'dispatched') acts.push(A('delivered', 'Mark as delivered', 'button-primary'));
    }
    if (adm) {
      if (o.status === 'payment_review') { acts.push(A('payment_received', 'Payment received — hold with RAQBO', 'button-primary')); acts.push(A('payment_rejected', 'Payment not found')); }
      if (o.status === 'completed') acts.push(A('release_payout', 'Release payout to vendor', 'button-primary'));
      if (o.status === 'disputed') { acts.push(A('resolve_release', 'Resolve: pay vendor', 'button-primary')); acts.push(A('resolve_refund', 'Resolve: refund buyer', 'button-outline mk-danger')); }
    }
    const d = o.dispatch || {};
    if (isBuyer) acts.push(`<button type="button" class="button button-outline" data-chat="order" data-id="${esc(o.id)}">${DI(DIC.chat, 15)} Message ${v && v.ownerId ? 'vendor' : 'RAQBO'}</button>`);
    else if ((isVendor && !adm) || (adm && !isBuyer)) acts.push(`<button type="button" class="button button-outline" data-chat="order" data-id="${esc(o.id)}">${DI(DIC.chat, 15)} Message buyer</button>`);
    return `<div class="mk-in mk-pad mk-order">
      <button type="button" class="mk-crumb" data-mk="orders">${DI('<path d="m15 18-6-6 6-6"/>', 15)} My orders</button>
      <div class="mk-pagehead"><div><div class="eyebrow"><span></span> ${o.mode === 'quote' ? 'QUOTE' : 'ESCROW ORDER'} · ${esc(o.ref)}</div><h1>${esc(v ? v.shop : 'Order')}</h1><p class="mk-owner">Placed ${esc(fmtDate(o.createdAt))} · ${isBuyer ? 'you are the buyer' : isVendor ? 'buyer: ' + esc(o.buyerName) : 'admin view'}</p></div>${chip(o.status)}</div>
      ${escrowSteps(o)}
      ${isBuyer && o.status === 'awaiting_payment' ? payInstructions(o) : ''}
      ${o.status === 'payment_review' ? `<div class="mk-note info">${DI(DIC.info, 18)}<p>${isBuyer ? 'Thanks! RAQBO is checking your payment screenshot' : 'Buyer submitted payment'}: <b>${esc(PAY_METHODS[o.payMethod] || o.payMethod)}</b>${o.payRef ? ` · ref <b>${esc(o.payRef)}</b>` : ''}${adm ? ' — match the screenshot with your account, then confirm below.' : '. We’ll email you and update this page once it’s verified.'}</p></div>` : ''}
      ${o.payProof && (isBuyer || adm) ? proofHTML(o) : ''}
      ${o.status === 'paid_escrow' ? `<div class="mk-note ok">${DI(DIC.lock, 18)}<p><b>${PKR(o.total)}</b> is held safely in RAQBO Protected Payment. ${isVendor ? 'Dispatch the material and add vehicle details.' : 'The vendor will dispatch your material now.'}</p></div>` : ''}
      ${o.status === 'quoted' && isBuyer && v && !v.escrow ? `<div class="mk-note info">${DI(DIC.info, 18)}<p>${esc(v.shop)} has sent prices but doesn’t take protected orders yet. To go ahead, confirm with them on <a href="https://wa.me/${waNum(v.whatsapp)}?text=${encodeURIComponent('Hi, about my RAQBO quote ' + o.ref + ' (' + PKR(o.total) + ') — I would like to proceed.')}" target="_blank" rel="noopener">WhatsApp</a> or call <a href="tel:${esc(telOf(v.phone))}">${esc(showPhone(v.phone))}</a>. Direct deals are not covered by RAQBO Protected Payment.</p></div>` : ''}
      ${o.status === 'disputed' ? `<div class="mk-note bad">${DI(DIC.alert, 18)}<p><b>Dispute:</b> ${esc(o.dispute)}<br><small>Payment stays with RAQBO until RAQBO resolves it.</small></p></div>` : ''}
      ${['dispatched', 'delivered', 'completed', 'released'].includes(o.status) && (d.vehicle || d.driver || d.eta) ? `<div class="mk-track">${DI(DIC.truck, 22)}<div><b>Delivery tracking</b><dl>${d.vehicle ? `<div><dt>Vehicle</dt><dd>${esc(d.vehicle)}</dd></div>` : ''}${d.driver ? `<div><dt>Driver</dt><dd>${esc(d.driver)}</dd></div>` : ''}${d.phone ? `<div><dt>Driver phone</dt><dd><a href="tel:${esc(d.phone)}">${esc(d.phone)}</a></dd></div>` : ''}${d.eta ? `<div><dt>ETA</dt><dd>${esc(d.eta)}</dd></div>` : ''}</dl></div></div>` : ''}
      ${acts.length ? `<div class="mk-acts">${acts.join('')}</div>` : ''}
      ${isBuyer && s.email && !['released', 'refunded', 'cancelled'].includes(o.status) ? `<p class="mk-emailnote">${DI(DIC.mail, 16)}<span>We’ll email <b>${esc(s.email)}</b> at every step — payment verified, dispatched, delivered and more.</span></p>` : ''}
      <div class="mk-ogrid">
        <section class="mk-box"><h2>Items</h2><div class="mk-items">${o.items.map((it) => `<div><span><b>${esc(it.name)}</b><small>${it.code ? esc(it.code) + ' · ' : ''}${it.qty} ${esc(it.unit)} × ${it.price == null ? 'awaiting price' : PKR(it.price)}</small></span><b>${it.price == null ? '—' : PKR(it.price * it.qty)}</b></div>`).join('')}</div>
          <dl class="mk-totals"><div><dt>Subtotal</dt><dd>${o.subtotal == null ? 'On quote' : PKR(o.subtotal)}</dd></div><div><dt>Delivery</dt><dd>${PKR(o.deliveryFee)}</dd></div>${o.discount ? `<div class="disc"><dt>Commercial buyer discount</dt><dd>−${PKR(o.discount)}</dd></div>` : ''}<div class="tot"><dt>Total</dt><dd>${o.total == null ? 'Awaiting quote' : PKR(o.total)}</dd></div></dl>
          ${o.vendorNote ? `<p class="mk-small"><b>Vendor note:</b> ${esc(o.vendorNote)}</p>` : ''}${o.buyerNote ? `<p class="mk-small"><b>Buyer note:</b> ${esc(o.buyerNote)}</p>` : ''}</section>
        <section class="mk-box"><h2>Delivery</h2><p>${esc(o.address)}<br><b>${esc(o.city)}</b></p>
          ${isVendor || adm ? `<p class="mk-small">Buyer: <b>${esc(o.buyerName)}</b>${o.buyerPhone ? ` · <a href="tel:${esc(o.buyerPhone)}">${esc(showPhone(o.buyerPhone))}</a>` : ''}</p>` : ''}
          ${isBuyer && v ? `<p class="mk-small">Vendor: <b>${esc(v.shop)}</b> · <a href="tel:${esc(telOf(v.phone))}">${esc(showPhone(v.phone))}</a></p>` : ''}
          ${adm && v ? `<button type="button" class="link-button" data-mk="payout-info" data-id="${esc(v.id)}">Show vendor payout details</button><div data-payout></div>` : ''}
          <h2 class="mk-h2b">Timeline</h2><ol class="mk-timeline">${o.events.slice().reverse().map((e) => `<li class="${esc(e.actor)}"><i></i><div><b>${esc((ORDER_STATUS[e.status] || [e.status])[0])}</b><span>${esc(e.note)}</span><small>${esc(fmtDate(e.at))} · ${esc(e.actor === 'admin' ? 'RAQBO' : e.actor)}</small></div></li>`).join('')}</ol></section>
      </div>
      ${isBuyer && ['completed', 'released'].includes(o.status) && !o.reviewed ? `<section class="mk-box mk-review"><h2>Rate ${esc(v ? v.shop : 'this vendor')}</h2><form data-mkform="review" data-id="${esc(o.id)}" novalidate><div class="rv-picker" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-mkstar="${n}" aria-label="${n} stars">★</button>`).join('')}<input type="hidden" name="rating" value="0"></div><textarea name="comment" maxlength="1000" placeholder="Quality, quantity, delivery time, behaviour…"></textarea><div class="form-error" hidden></div><button type="submit" class="button button-primary">Post review</button></form></section>` : ''}
      ${isBuyer && o.reviewed ? '<p class="mk-small">✓ You reviewed this vendor. Thank you!</p>' : ''}
    </div>`;
  }
  async function orderAct(id, act) {
    const o = mk.order(id); if (!o) return;
    const run = async (payload, btn) => {
      const done = btn ? busy(btn, 'Saving…') : () => {};
      try { await MK.orderAction(id, act, payload); closeModal(); await mkLoad(); mkRender(true); toast((ORDER_STATUS[mk.order(id) ? mk.order(id).status : ''] || ['Updated'])[0] + '.'); }
      catch (err) { done(); toast(err.message); }
    };
    if (act === 'send_quote') {
      const card = openModal(`<div class="eyebrow"><span></span> SEND QUOTE · ${esc(o.ref)}</div><h2>Quote for ${esc(o.buyerName)}</h2><form class="modal-form" data-mkform="quote" novalidate>
        ${o.items.map((it, i) => `<label>${esc(it.name)} — ${it.qty} ${esc(it.unit)} <span class="mk-small">(price per ${esc(it.unit)}, PKR)</span><input name="p${i}" type="number" min="1" step="1" inputmode="numeric" value="${it.price || ''}"></label>`).join('')}
        <label>Delivery charges (PKR)<input name="delivery" type="number" min="0" step="1" value="${o.deliveryFee}"></label><label>Note (optional)<textarea name="note" maxlength="600" placeholder="Validity, brand, delivery time…"></textarea></label>
        <button type="submit" class="button button-primary modal-submit">Send quote</button></form>`, { label: 'Send quote' });
      $('form', card).addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; const errs = o.items.map((it, i) => (+f['p' + i].value > 0 ? null : ['p' + i, 'Enter a price.'])).filter(Boolean); if (showErrors(f, errs)) return; run({ prices: o.items.map((it, i) => ({ product_id: it.product_id, price: +f['p' + i].value })), delivery_fee: +f.delivery.value || 0, note: f.note.value.trim() }, $('[type=submit]', f)); });
    } else if (act === 'dispatch') {
      const card = openModal(`<div class="eyebrow"><span></span> DISPATCH · ${esc(o.ref)}</div><h2>Dispatch details</h2><p class="modal-lead">The buyer sees these details for tracking.</p><form class="modal-form" data-mkform="dispatch" novalidate>
        <div class="form-grid"><label>Vehicle number<input name="vehicle" maxlength="40" placeholder="e.g. LES-1234"></label><label>Driver name<input name="driver" maxlength="80"></label><label>Driver phone<input name="phone" maxlength="20" inputmode="tel" placeholder="03XX XXXXXXX"></label><label>Expected arrival<input name="eta" maxlength="60" placeholder="e.g. Today 5 pm"></label></div>
        <button type="submit" class="button button-primary modal-submit">Mark as dispatched</button></form>`, { label: 'Dispatch' });
      $('form', card).addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; if (showErrors(f, f.vehicle.value.trim() ? [] : [['vehicle', 'Enter the vehicle number.']])) return; run({ vehicle: f.vehicle.value.trim(), driver: f.driver.value.trim(), phone: f.phone.value.trim(), eta: f.eta.value.trim() }, $('[type=submit]', f)); });
    } else if (act === 'dispute') {
      const card = openModal(`<div class="eyebrow"><span></span> REPORT A PROBLEM · ${esc(o.ref)}</div><h2>Open a dispute</h2><p class="modal-lead">Your payment stays with RAQBO while RAQBO reviews the issue with you and the vendor.</p><form class="modal-form" data-mkform="dispute" novalidate>
        <label>What went wrong?<textarea name="reason" maxlength="600" placeholder="e.g. 20 bags were damaged, wrong grade of steel, not delivered…"></textarea></label><button type="submit" class="button button-primary modal-submit">Open dispute</button></form>`, { label: 'Dispute' });
      $('form', card).addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; if (showErrors(f, f.reason.value.trim().length >= 5 ? [] : [['reason', 'Describe the problem.']])) return; run({ reason: f.reason.value.trim() }, $('[type=submit]', f)); });
    } else if (['decline', 'payment_rejected', 'release_payout', 'resolve_release', 'resolve_refund'].includes(act)) {
      const titles = { decline: 'Decline this order?', payment_rejected: 'Payment not found?', release_payout: 'Release payout to vendor?', resolve_release: 'Resolve dispute — pay the vendor?', resolve_refund: 'Resolve dispute — refund the buyer?' };
      const card = openModal(`<div class="eyebrow"><span></span> ${esc(o.ref)}</div><h2>${titles[act]}</h2><form class="modal-form" novalidate><label>Note (optional, visible in the timeline)<textarea name="note" maxlength="300" placeholder="${act.includes('release') || act === 'resolve_refund' ? 'e.g. Transferred to JazzCash 0300…, TX 12345' : ''}"></textarea></label><button type="submit" class="button button-primary modal-submit">Confirm</button></form>`, { label: titles[act] });
      $('form', card).addEventListener('submit', (e) => { e.preventDefault(); run({ note: e.target.note.value.trim() }, $('[type=submit]', e.target)); });
    } else if (act === 'confirm_delivery') {
      const card = openModal(`<div class="eyebrow"><span></span> ${esc(o.ref)}</div><h2>Confirm you received the material?</h2><p class="modal-lead">Only confirm after inspecting quantity and quality. RAQBO will then release <b>${PKR(o.total)}</b> to the vendor — this can’t be undone.</p><div class="button-row"><button type="button" class="button button-primary" data-ok>Yes, everything is fine</button><button type="button" class="button button-outline" data-no>Not yet</button></div>`, { label: 'Confirm delivery' });
      card.addEventListener('click', (e) => { if (e.target.closest('[data-ok]')) run({}, e.target.closest('[data-ok]')); if (e.target.closest('[data-no]')) closeModal(); });
    } else run({});
  }

  /* ---------- Supplier: create profile + dashboard ---------- */
  function mkShopForm() {
    requireSignIn(async () => {
      if (!mk.data) await mkLoad();
      const v = mk.myVendor(); const p = mk.data.priv || {}; const s = db.session;
      const val = (x, d = '') => esc(x == null ? d : x);
      const card = openModal(`<div class="eyebrow"><span></span> CONSTRUCTION MATERIALS</div><h2>${v ? 'Edit your supplier profile' : 'Create your supplier profile'}</h2><p class="modal-lead">${v ? 'Changes appear on your public profile right away.' : 'Free to join. RAQBO reviews new suppliers before they appear in the directory.'}</p>
        <form class="modal-form" data-mkform="shop" novalidate>
          <h3 class="mk-fh">Shop details <small>(public)</small></h3>
          <div class="form-grid"><label>Shop / business name<input name="shop" maxlength="120" value="${val(v && v.shop)}" placeholder="e.g. Al-Noor Building Materials"></label><label>Owner / contact person<input name="owner" maxlength="120" value="${val(v ? v.owner : s.name)}"></label>
            <label>Phone<input name="phone" inputmode="tel" value="${val(v ? showPhone(v.phone) : showPhone(s.phone))}" placeholder="03XX XXXXXXX"></label><label>WhatsApp (if different)<input name="whatsapp" inputmode="tel" value="${val(v && v.whatsapp !== v.phone ? showPhone(v.whatsapp) : '')}" placeholder="03XX XXXXXXX"></label>
            <label>City<select name="city"><option value="">Select city</option>${MK_CITIES.map((c) => `<option ${v && v.city === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label>Area / market<input name="area" maxlength="160" value="${val(v && v.area)}" placeholder="e.g. Raiwind Road"></label></div>
          <fieldset class="mk-fs"><legend>Materials you supply</legend><div class="mk-matpick">${MATERIALS.map((m) => `<label><input type="checkbox" name="mat" value="${esc(m)}" ${v && v.materials.includes(m) ? 'checked' : ''}> ${esc(m)}</label>`).join('')}</div></fieldset>
          <div class="form-grid three"><label>Delivery radius (km)<input name="radius" type="number" min="1" max="2000" value="${val(v ? v.radius : 25)}"></label><label>Delivery charges (PKR)<input name="fee" type="number" min="0" value="${val(v ? v.deliveryFee : 0)}"></label><label>Commercial buyer discount %<input name="disc" type="number" min="0" max="30" step="0.5" value="${val(v ? v.bulkDiscount : 0)}"></label></div>
          <label>Shipping / delivery options<input name="dnote" maxlength="200" value="${val(v && v.deliveryNote)}" placeholder="e.g. Same-day delivery across Lahore, crane unloading available"></label>
          <label>About your business<textarea name="about" maxlength="600" placeholder="Brands, stock, experience, bulk rates…">${val(v && v.about)}</textarea></label>
          <h3 class="mk-fh">Verification &amp; payouts <small>(private — only you and RAQBO)</small></h3>
          <div class="form-grid"><label>NTN or CNIC number<input name="reg" maxlength="40" value="${val(p.reg)}" placeholder="For supplier verification"></label><label>Warehouse address<input name="warehouse" maxlength="300" value="${val(p.warehouse)}"></label>
            <label>Payout method<select name="paym"><option value="">Select</option>${Object.entries(PAY_METHODS).map(([k, l]) => `<option value="${k}" ${p.payMethod === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Account title<input name="payt" maxlength="120" value="${val(p.payTitle)}"></label>
            <label>Account / IBAN / mobile wallet number<input name="paya" maxlength="40" value="${val(p.payAccount)}"></label></div>
          <p class="form-hint">Verification: RAQBO may ask for your NTN/CNIC copy and shop photos on WhatsApp before adding the <b>Verified</b> badge and enabling protected orders.</p>
          ${v ? '' : '<label class="check-row"><input type="checkbox" name="agree"> <span>I agree to RAQBO’s <a href="terms.html" target="_blank" rel="noopener">Terms</a>: no off-platform payment requests for protected orders, accurate rates, and genuine material. Fraud leads to suspension.</span></label>'}
          <button type="submit" class="button button-primary modal-submit">${v ? 'Save changes' : 'Submit for review'}</button></form>`, { wide: true, label: 'Supplier profile' });
      $('form', card).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const errs = []; const mats = $$('input[name=mat]:checked', f).map((x) => x.value);
        const phone = e164(f.phone.value); const wa = f.whatsapp.value.trim() ? e164(f.whatsapp.value) : null;
        if (f.shop.value.trim().length < 2) errs.push(['shop', 'Enter your shop or business name.']);
        if (f.owner.value.trim().length < 2) errs.push(['owner', 'Enter the contact person’s name.']);
        if (!phone) errs.push(['phone', 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.']);
        if (f.whatsapp.value.trim() && !wa) errs.push(['whatsapp', 'Enter a valid WhatsApp number.']);
        if (!f.city.value) errs.push(['city', 'Choose your city.']);
        if (!mats.length) errs.push(['mat', 'Select at least one material.']);
        const radius = parseInt(f.radius.value, 10); if (!(radius >= 1 && radius <= 2000)) errs.push(['radius', '1–2000 km.']);
        const fee = parseInt(f.fee.value || '0', 10); if (!(fee >= 0)) errs.push(['fee', 'Enter 0 or more.']);
        const disc = parseFloat(f.disc.value || '0'); if (!(disc >= 0 && disc <= 30)) errs.push(['disc', '0–30%.']);
        if (f.agree && !f.agree.checked) errs.push(['agree', 'Please accept the supplier terms.']);
        if (showErrors(f, errs)) return;
        const done = busy($('[type=submit]', f), 'Saving…');
        try {
          await MK.saveVendor({ shop: f.shop.value.trim(), owner: f.owner.value.trim(), phone, whatsapp: wa, city: f.city.value, area: f.area.value.trim(), materials: mats, radius, deliveryFee: fee, deliveryNote: f.dnote.value.trim(), bulkDiscount: disc, about: f.about.value.trim() },
            { reg: f.reg.value.trim(), warehouse: f.warehouse.value.trim(), payMethod: f.paym.value, payTitle: f.payt.value.trim(), payAccount: f.paya.value.trim() }, v ? v.id : null);
          closeModal(); await mkLoad(); toast(v ? 'Supplier profile saved.' : 'Profile submitted — RAQBO will review it shortly. Add your catalog now.'); mkGo('shop', { shopTab: v ? mk.shopTab : 'catalog' });
        } catch (err) { done(); showErrors(f, [['shop', err.message]]); }
      });
    });
  }
  function productForm(vendorId, id) {
    const v = mk.vendor(vendorId); const p = id ? v.products.find((x) => x.id === id) : null;
    const card = openModal(`<div class="eyebrow"><span></span> CATALOG</div><h2>${p ? 'Edit item' : 'Add an item'}</h2><form class="modal-form" data-mkform="product" novalidate>
      <div class="form-grid"><label>Item name<input name="name" maxlength="120" value="${esc(p ? p.name : '')}" placeholder="e.g. OPC Cement 50 kg"></label><label>Product code (optional)<input name="code" maxlength="40" value="${esc(p ? p.code : '')}"></label>
        <label>Category<select name="category">${MATERIALS.map((m) => `<option ${(p ? p.category : v.materials[0]) === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label><label>Unit<input name="unit" maxlength="20" value="${esc(p ? p.unit : 'bag')}" placeholder="bag, ton, truck, box…"></label>
        <label>Price per unit (PKR)<input name="price" type="number" min="1" step="1" inputmode="numeric" value="${p && p.price != null ? p.price : ''}" placeholder="Leave empty = price on request"></label><label>Minimum order<input name="min" type="number" min="1" value="${p ? p.minQty : 1}"></label>
        <label>Brand (optional)<input name="brand" maxlength="60" value="${esc(p ? p.brand || '' : '')}" placeholder="e.g. Bestway, Amreli"></label><label class="full">Specifications (optional)<input name="specs" maxlength="600" value="${esc(p ? p.specs || '' : '')}" placeholder="e.g. Grade 60, 12 mm, ASTM A615 · 50 kg bag"></label>
        <label>Stock<select name="stock"><option value="in_stock" ${!p || p.stock === 'in_stock' ? 'selected' : ''}>In stock</option><option value="low" ${p && p.stock === 'low' ? 'selected' : ''}>Low stock</option><option value="out" ${p && p.stock === 'out' ? 'selected' : ''}>Out of stock</option></select></label></div>
      <p class="form-hint">Price changes show instantly to buyers as a live rate (with ▲▼ change). Leave the price empty for items you quote case by case.</p>
      <button type="submit" class="button button-primary modal-submit">${p ? 'Save item' : 'Add to catalog'}</button></form>`, { label: 'Catalog item' });
    $('form', card).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const errs = [];
      if (f.elements.name.value.trim().length < 2) errs.push(['name', 'Enter the item name.']); if (!f.unit.value.trim()) errs.push(['unit', 'Enter the unit.']);
      const price = f.price.value.trim() ? Math.round(+f.price.value) : null; if (price != null && !(price > 0)) errs.push(['price', 'Enter a valid price or leave empty.']);
      const min = parseInt(f.min.value, 10); if (!(min >= 1)) errs.push(['min', 'At least 1.']);
      if (showErrors(f, errs)) return; const done = busy($('[type=submit]', f), 'Saving…');
      try { await MK.saveProduct({ id: p && p.id, vendorId, name: f.elements.name.value.trim(), code: f.code.value.trim(), category: f.category.value, unit: f.unit.value.trim(), price, minQty: min, stock: f.stock.value, brand: f.brand.value.trim(), specs: f.specs.value.trim() }); closeModal(); await mkLoad(); mkRender(true); toast(p ? 'Item updated.' : 'Item added to your catalog.'); }
      catch (err) { done(); showErrors(f, [['name', err.message]]); }
    });
  }
  function mkShopHTML() {
    if (!isComplete()) return `<div class="mk-in mk-pad"><div class="mk-empty">${DI(DIC.store, 30)}<b>Sell your construction material on RAQBO</b><small>Sign in, then create your free supplier profile.</small><button type="button" class="button button-primary" data-mk="create-profile">+ Create Profile</button></div></div>`;
    const v = mk.myVendor();
    if (!v) return `<div class="mk-in mk-pad"><section class="mk-join"><div><div class="eyebrow"><span></span> CONSTRUCTION MATERIALS</div><h1>Grow your material business with <span class="gold-text">RAQBO</span></h1>
        <ul><li>${DI(DIC.check, 16)} Get found by contractors, builders and homeowners by material and city</li><li>${DI(DIC.check, 16)} Receive enquiries on WhatsApp/phone and secure in-app protected orders</li><li>${DI(DIC.check, 16)} Guaranteed payouts once the buyer confirms delivery</li><li>${DI(DIC.check, 16)} Live rates, catalog and order dashboard — free to join</li></ul>
        <button type="button" class="button button-primary" data-mk="create-profile">${DI(DIC.plus, 16)} Create supplier profile</button></div>
        <div class="mk-join-steps"><div><b>1</b><span>Create profile &amp; catalog</span></div><div><b>2</b><span>RAQBO verifies your shop</span></div><div><b>3</b><span>Accept orders &amp; get paid</span></div></div></section></div>`;
    const orders = mk.data.orders.filter((o) => o.vendorId === v.id);
    const active = orders.filter((o) => !['released', 'refunded', 'cancelled'].includes(o.status));
    const paid = orders.filter((o) => o.status === 'released').reduce((a, o) => a + (o.total || 0), 0);
    const need = orders.filter((o) => ['quote_requested', 'paid_escrow', 'dispatched'].includes(o.status)).length;
    const statusMsg = { pending: ['info', 'Your profile is under review. RAQBO will contact you to verify your shop. You can add your catalog meanwhile.'], approved: ['ok', 'Your shop is live in the directory.' + (v.escrow ? ' Protected orders are enabled.' : ' Protected orders will be enabled after verification — buyers can still request quotes and contact you.')], rejected: ['bad', 'Your profile was not approved' + (v.adminNote ? ': ' + v.adminNote : '.') + ' Update it and save to submit again.'], suspended: ['bad', 'Your shop is suspended' + (v.adminNote ? ': ' + v.adminNote : '.') + ' Contact RAQBO.'] }[v.status];
    const tab = mk.shopTab;
    return `<div class="mk-in mk-pad">
      <div class="mk-pagehead"><div><div class="eyebrow"><span></span> SUPPLIER DASHBOARD</div><h1>${esc(v.shop)}</h1><div class="mk-badges">${v.verified ? `<span class="mk-badge ver">${DI(DIC.check, 12)} Verified</span>` : ''}${v.escrow ? `<span class="mk-badge esc">${DI(DIC.lock, 12)} Protected pay</span>` : ''}<span class="mk-badge muted">${esc(v.status)}</span></div></div>
        <div class="button-row"><button type="button" class="button button-outline" data-mk="vendor" data-id="${esc(v.id)}">View public page</button><button type="button" class="button button-outline" data-mk="create-profile">${DI(DIC.edit, 15)} Edit profile</button></div></div>
      <div class="mk-note ${statusMsg[0]}">${DI(statusMsg[0] === 'ok' ? DIC.check : statusMsg[0] === 'bad' ? DIC.alert : DIC.info, 18)}<p>${esc(statusMsg[1])}</p></div>
      <div class="mk-stats"><div><b>${need}</b><span>Need your action</span></div><div><b>${active.length}</b><span>Active orders</span></div><div><b>${v.products.length}</b><span>Catalog items</span></div><div><b>${PKR(paid)}</b><span>Paid out by RAQBO</span></div><div><b>${v.rating ? v.rating.avg.toFixed(1) + ' ★' : '—'}</b><span>${v.rating ? v.rating.count + ' reviews' : 'No reviews yet'}</span></div></div>
      <div class="mk-seg"><button type="button" data-mk="stab" data-tab="orders" class="${tab === 'orders' ? 'on' : ''}">Orders &amp; quotes (${orders.length})</button><button type="button" data-mk="stab" data-tab="catalog" class="${tab === 'catalog' ? 'on' : ''}">Catalog &amp; pricing (${v.products.length})</button></div>
      ${tab === 'catalog' ? `<div class="mk-cat-tools"><button type="button" class="button button-primary" data-mk="add-product" data-id="${esc(v.id)}">${DI(DIC.plus, 15)} Add item</button><span class="form-hint">Tip: update prices whenever rates change — buyers see live rates instantly.</span></div>
        ${v.products.length ? `<div class="mk-mtable">${v.products.map((p) => `<div class="mk-mrow"><span><b>${esc(p.name)}</b><small>${esc(p.category)}${p.code ? ' · ' + esc(p.code) : ''} · min ${p.minQty} ${esc(p.unit)}</small></span><span>${p.price == null ? '<span class="mk-por">On request</span>' : `<b>${PKR(p.price)}</b> / ${esc(p.unit)} ${trendHTML(p)}`}</span><span>${stockHTML(p.stock)}</span><span class="mk-mrow-act"><button type="button" class="link-button" data-mk="edit-product" data-vid="${esc(v.id)}" data-id="${esc(p.id)}">Edit</button><button type="button" class="link-button link-danger" data-mk="del-product" data-id="${esc(p.id)}">Remove</button></span></div>`).join('')}</div>`
          : `<div class="mk-empty">${DI(DIC.box, 30)}<b>No items yet</b><small>Add your materials with prices (or “price on request”).</small></div>`}`
        : (orders.length ? `<div class="mk-olist">${orders.map((o) => orderRow(o, 'vendor')).join('')}</div>` : `<div class="mk-empty">${DI(DIC.cart, 30)}<b>No orders yet</b><small>Quote requests and protected orders appear here instantly.</small></div>`)}
    </div>`;
  }

  /* ---------- Admin: vendors, protected payments, disputes, buyers ---------- */
  function mkAdminCounts() {
    const D = mk.data; if (!D) return { pay: '', disp: '', vend: '', orders: '' };
    return { pay: D.orders.filter((o) => ['payment_review', 'completed'].includes(o.status)).length, disp: D.orders.filter((o) => o.status === 'disputed').length, vend: D.vendors.filter((v) => v.status === 'pending').length, orders: D.orders.length };
  }
  function mkAdminOrderCard(o, kind) {
    const v = mk.vendor(o.vendorId); const A = (act, label, cls = 'button-outline') => `<button type="button" class="button ${cls}" data-mk="act" data-act="${act}" data-id="${esc(o.id)}">${label}</button>`;
    let acts = '';
    if (o.status === 'payment_review') acts = A('payment_received', 'Payment received — hold with RAQBO', 'button-primary') + A('payment_rejected', 'Payment not found');
    else if (o.status === 'completed') acts = A('release_payout', 'Release payout to vendor', 'button-primary');
    else if (o.status === 'disputed') acts = A('resolve_release', 'Resolve: pay vendor', 'button-primary') + A('resolve_refund', 'Resolve: refund buyer', 'button-outline mk-danger');
    return `<article class="admin-card mk-acard"><div class="mk-acard-top"><div><b>${esc(o.ref)}</b> ${chip(o.status)}<small>${esc(fmtDate(o.createdAt))} · ${o.mode === 'quote' ? 'Quote' : 'Protected order'}</small></div><b class="mk-acard-amt">${o.total == null ? 'On quote' : PKR(o.total)}</b></div>
      <dl class="mk-adl"><div><dt>Buyer</dt><dd>${esc(o.buyerName)}${o.buyerPhone ? ` · <a href="tel:${esc(o.buyerPhone)}">${esc(showPhone(o.buyerPhone))}</a>` : ''}</dd></div><div><dt>Vendor</dt><dd>${esc(v ? v.shop : '—')}${v && v.sample ? ' (sample — you act as vendor)' : ''}</dd></div>
        <div><dt>Items</dt><dd>${esc(o.items.map((i) => `${i.name} × ${i.qty} ${i.unit}`).join(', '))}</dd></div><div><dt>Deliver to</dt><dd>${esc(o.address)}, ${esc(o.city)}</dd></div>
        ${o.payMethod ? `<div><dt>Payment</dt><dd><b>${esc(PAY_METHODS[o.payMethod] || o.payMethod)}</b>${o.payRef ? ` · ref <b>${esc(o.payRef)}</b>` : ' · no transaction ID'}</dd></div>` : ''}${o.dispute ? `<div class="bad"><dt>Dispute</dt><dd>${esc(o.dispute)}</dd></div>` : ''}</dl>
      ${o.payProof ? proofHTML(o, true) : (o.status === 'payment_review' ? '<p class="admin-message">No screenshot attached — ask the buyer on WhatsApp.</p>' : '')}
      <div class="admin-actions">${acts}<button type="button" class="link-button" data-mk="order" data-id="${esc(o.id)}">Open full order</button>${kind === 'payout' && v ? `<button type="button" class="link-button" data-mk="payout-info" data-id="${esc(v.id)}">Vendor payout details</button>` : ''}</div>${kind === 'payout' ? '<div data-payout></div>' : ''}</article>`;
  }
  function mkAdminSection(tab) {
    setTimeout(() => { if (admin.el) hydrateProofs(admin.el); }, 0);
    if (!mk.data) { if (!mk.loading) mkLoad().then(() => renderAdmin()); return '<div class="admin-empty">Loading marketplace…</div>'; }
    const D = mk.data; const head = (eb, h, lead) => `<div class="admin-heading"><div><div class="eyebrow"><span></span> ${eb}</div><h1>${h}</h1></div><button type="button" class="admin-refresh" data-mk="adm-refresh">Refresh</button></div><p class="admin-lead">${lead}</p>${mk.err ? `<p class="admin-message">${esc(mk.err)}</p>` : ''}`;
    const empty = (m) => `<div class="admin-empty">${m}</div>`;
    if (tab === 'payments') {
      const pay = D.orders.filter((o) => o.status === 'payment_review'); const rel = D.orders.filter((o) => o.status === 'completed');
      const A = ESCROW_ACCOUNT; const acc = [A.bank, A.iban, A.jazzcash, A.easypaisa, A.sadapay, A.nayapay].filter(Boolean).length;
      return head('CONSTRUCTION MATERIALS', 'Protected payments', 'Check that the buyer’s money reached RAQBO’s account, then hold it with RAQBO. After the buyer confirms delivery, send the money to the vendor and release the payout.')
        + (acc ? '' : '<p class="admin-message">Tip: add RAQBO’s collection bank / JazzCash details in <b>content.js</b> so buyers see them at checkout.</p>')
        + `<h2 class="mk-h2b">Payments to verify (${pay.length})</h2><div class="admin-queue">${pay.length ? pay.map((o) => mkAdminOrderCard(o, 'pay')).join('') : empty('No payments waiting.')}</div>`
        + `<h2 class="mk-h2b">Delivered &amp; confirmed — release payout (${rel.length})</h2><div class="admin-queue">${rel.length ? rel.map((o) => mkAdminOrderCard(o, 'payout')).join('') : empty('Nothing to release.')}</div>`;
    }
    if (tab === 'disputes') { const d = D.orders.filter((o) => o.status === 'disputed'); return head('CONSTRUCTION MATERIALS', 'Disputes', 'Payment stays with RAQBO until you decide. Talk to both sides, then pay the vendor or refund the buyer.') + `<div class="admin-queue">${d.length ? d.map((o) => mkAdminOrderCard(o, 'dispute')).join('') : empty('No open disputes.')}</div>`; }
    if (tab === 'orders') return head('CONSTRUCTION MATERIALS', 'Material orders', 'Every quote and protected order on the marketplace.') + (D.orders.length ? `<div class="mk-olist">${D.orders.map((o) => orderRow(o, 'buyer')).join('')}</div>` : empty('No orders yet.'));
    if (tab === 'buyers') return head('CONSTRUCTION MATERIALS', 'Buyers', 'Register contractors, builders and companies as Commercial Buyers to unlock vendor bulk discounts.') + (D.admin && D.admin.buyers.length ? `<div class="mk-mtable">${D.admin.buyers.map((b) => `<div class="mk-mrow"><span><b>${esc(b.company || b.name)}</b><small>${esc(b.name)} · ${esc(BUYER_TYPES[b.type] || b.type)} · since ${esc(fmtDay(b.createdAt))}</small></span><span>${b.commercial ? '<span class="mk-badge esc">Registered Commercial Buyer</span>' : ''}</span><span></span><span class="mk-mrow-act"><button type="button" class="link-button" data-mk="adm-buyer" data-id="${esc(b.userId)}" data-on="${b.commercial ? '0' : '1'}">${b.commercial ? 'Remove commercial status' : 'Register as commercial buyer'}</button></span></div>`).join('')}</div>` : empty('No buyer profiles yet.'));
    const vs = D.vendors.slice().sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0));
    return head('CONSTRUCTION MATERIALS', 'Suppliers', 'Approve new suppliers, add the Verified badge after checking their NTN/CNIC, and enable protected orders for trusted shops.')
      + `<div class="mk-mtable">${vs.map((v) => `<div class="mk-mrow mk-vrow"><span><b>${esc(v.shop)}</b><small>${esc(v.owner)} · ${esc(showPhone(v.phone))} · ${esc(v.area ? v.area + ', ' : '')}${esc(v.city)} · ${esc(v.materials.join(', '))}${v.sample ? ' · sample' : ''}</small><small>${v.products.length} items · joined ${esc(fmtDay(v.createdAt))}${v.adminNote ? ' · note: ' + esc(v.adminNote) : ''}</small></span>
        <span><span class="mk-badge ${v.status === 'approved' ? 'ver' : v.status === 'pending' ? 'gold' : 'bad'}">${esc(v.status)}</span></span>
        <span class="mk-adm-toggles"><label class="mk-toggle"><input type="checkbox" data-mk="adm-flag" data-id="${esc(v.id)}" data-flag="verified" ${v.verified ? 'checked' : ''}><span></span> Verified</label><label class="mk-toggle"><input type="checkbox" data-mk="adm-flag" data-id="${esc(v.id)}" data-flag="escrow_enabled" ${v.escrow ? 'checked' : ''}><span></span> Protected payment</label></span>
        <span class="mk-mrow-act">${v.status !== 'approved' ? `<button type="button" class="button button-primary" data-mk="adm-status" data-id="${esc(v.id)}" data-st="approved">Approve</button>` : ''}${v.status === 'pending' ? `<button type="button" class="link-button link-danger" data-mk="adm-status" data-id="${esc(v.id)}" data-st="rejected">Reject</button>` : ''}${v.status === 'approved' ? `<button type="button" class="link-button link-danger" data-mk="adm-status" data-id="${esc(v.id)}" data-st="suspended">Suspend</button>` : ''}<button type="button" class="link-button" data-mk="vendor" data-id="${esc(v.id)}">View shop</button><button type="button" class="link-button" data-mk="payout-info" data-id="${esc(v.id)}">Private details</button></span><div data-payout class="mk-vpriv"></div></div>`).join('')}</div>`;
  }

  /* ---------- Click handling ---------- */
  async function mkClick(e) {
    const star = e.target.closest('[data-mkstar]');
    if (star) { const f = star.closest('form'); const n = +star.dataset.mkstar; f.rating.value = n; $$('[data-mkstar]', f).forEach((b) => b.classList.toggle('on', +b.dataset.mkstar <= n)); return; }
    const b = e.target.closest('[data-mk]'); if (!b) return; const a = b.dataset.mk; const id = b.dataset.id;
    if (b.tagName === 'INPUT') { if (a === 'adm-flag') { b.disabled = true; try { await MK.adminVendor(id, { [b.dataset.flag]: b.checked }); await mkLoad(); mkRender(true); toast('Vendor updated.'); } catch (err) { toast(err.message); b.checked = !b.checked; b.disabled = false; } } return; }
    if (a === 'home') { closeMarket(); return; }
    if (a === 'dir') { mkGo('dir'); return; }
    if (a === 'browse') { const t = $('#mk-browse', mk.el); if (t) t.scrollIntoView({ behavior: 'smooth' }); return; }
    if (a === 'mat') { mk.filter.mat = b.dataset.mat; renderGridOnly(); return; }
    if (a === 'vendor') { mkGo('vendor', { vendorId: id }); const v = mk.vendor(id); if (v) loadVendorReviews(v); return; }
    if (a === 'orders') { requireSignIn(() => mkGo('orders')); return; }
    if (a === 'order') { mkGo('order', { orderId: id }); return; }
    if (a === 'shop') { mkGo('shop'); return; }
    if (a === 'admin') { openAdmin('mk-payments'); return; }
    if (a === 'adm-refresh') { await mkLoad(); renderAdmin(); toast('Refreshed.'); return; }
    if (a === 'otab') { mk.ordersTab = b.dataset.tab; mkRender(true); return; }
    if (a === 'stab') { mk.shopTab = b.dataset.tab; mkRender(true); return; }
    if (a === 'atab') { mk.adminTab = b.dataset.tab; mkRender(true); return; }
    if (a === 'buyer-login') { requireSignIn(async () => { await mkLoad(); mkRender(true); if (!mk.data.buyer) buyerForm(); }); return; }
    if (a === 'buyer-profile') { buyerForm(); return; }
    if (a === 'create-profile') { if (mk.myVendor()) mkShopForm(); else requireSignIn(async () => { await mkLoad(); if (mk.myVendor()) mkGo('shop'); else mkShopForm(); }); return; }
    if (a === 'cta') {
      const card = openModal(`<div class="eyebrow"><span></span> GET STARTED</div><h2>What would you like to do?</h2><div class="mk-choose"><button type="button" data-c="supplier">${DI(DIC.store, 28)}<b>I’m a supplier</b><small>Create a vendor profile, list materials and receive orders</small></button><button type="button" data-c="buyer">${DI(DIC.cart, 28)}<b>I’m a buyer</b><small>Find suppliers and place protected orders</small></button></div>`, { label: 'Get started' });
      card.addEventListener('click', (ev) => { const c = ev.target.closest('[data-c]'); if (!c) return; closeModal(); if (c.dataset.c === 'supplier') { if (mk.myVendor()) mkGo('shop'); else requireSignIn(async () => { await mkLoad(); if (mk.myVendor()) mkGo('shop'); else mkShopForm(); }); } else { requireSignIn(async () => { await mkLoad(); if (!mk.data.buyer) buyerForm(() => { const t = $('#mk-browse', mk.el); if (t) t.scrollIntoView({ behavior: 'smooth' }); }); else { mkGo('dir'); setTimeout(() => { const t = $('#mk-browse', mk.el); if (t) t.scrollIntoView({ behavior: 'smooth' }); }, 50); } }); } });
      return;
    }
    if (a === 'cart-clear') { mk.cart = { vendorId: null, qty: {} }; saveCart(); mkRender(true); return; }
    if (a === 'checkout') { checkout('order'); return; }
    if (a === 'quote') { checkout('quote'); return; }
    if (a === 'act') { orderAct(id, b.dataset.act); return; }
    if (a === 'add-product') { productForm(id); return; }
    if (a === 'edit-product') { productForm(b.dataset.vid, id); return; }
    if (a === 'del-product') {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Remove'; } }, 3000); return; }
      try { await MK.deleteProduct(id); await mkLoad(); mkRender(true); toast('Item removed.'); } catch (err) { toast(err.message); } return;
    }
    if (a === 'adm-status') {
      const st = b.dataset.st; const v = mk.vendor(id);
      const save = async (note, btn) => { const done = btn ? busy(btn, 'Saving…') : () => {}; try { await MK.adminVendor(id, { status: st, admin_note: note }); closeModal(); await mkLoad(); mkRender(true); toast(`${v ? v.shop : 'Vendor'} ${st}.`); } catch (err) { done(); toast(err.message); } };
      if (st === 'approved') { save('', b); return; }
      const card = openModal(`<div class="eyebrow"><span></span> ${esc(st.toUpperCase())}</div><h2>${st === 'rejected' ? 'Reject' : 'Suspend'} ${esc(v ? v.shop : 'vendor')}?</h2><form class="modal-form" novalidate><label>Reason (the supplier sees this)<textarea name="note" maxlength="300" placeholder="e.g. Please send your NTN copy on WhatsApp"></textarea></label><button type="submit" class="button button-primary modal-submit">Confirm</button></form>`, { label: 'Vendor status' });
      $('form', card).addEventListener('submit', (ev) => { ev.preventDefault(); save(ev.target.note.value.trim(), $('[type=submit]', ev.target)); });
      return;
    }
    if (a === 'adm-buyer') { try { await MK.adminBuyer(id, b.dataset.on === '1'); await mkLoad(); mkRender(true); toast('Buyer updated.'); } catch (err) { toast(err.message); } return; }
    if (a === 'payout-info') {
      const box = b.parentElement.querySelector('[data-payout]') || b.closest('.mk-mrow, .mk-box').querySelector('[data-payout]'); if (!box) return;
      try { const p = await MK.adminPrivate(id); box.innerHTML = p ? `<dl class="mk-priv"><div><dt>NTN / CNIC</dt><dd>${esc(p.registration_no || '—')}</dd></div><div><dt>Warehouse</dt><dd>${esc(p.warehouse_address || '—')}</dd></div><div><dt>Payout</dt><dd>${esc(PAY_METHODS[p.payout_method] || '—')} · ${esc(p.payout_title || '')} · ${esc(p.payout_account || '')}</dd></div></dl>` : '<p class="form-hint">No private details saved.</p>'; }
      catch (err) { box.textContent = err.message; }
    }
  }
  document.addEventListener('submit', async (e) => {
    const f = e.target; if (!mk.el || !mk.el.contains(f)) return;
    if (f.dataset.mkform === 'pay') {
      e.preventDefault(); const file = f.proof.files && f.proof.files[0];
      if (showErrors(f, file ? [] : [['proof', 'Upload a screenshot of your payment (from your banking or wallet app).']])) return;
      const done = busy($('[type=submit]', f), 'Uploading screenshot…');
      try {
        const path = await MK.uploadProof(f.dataset.id, await shrinkImage(file, 1800, 0.85));
        await MK.orderAction(f.dataset.id, 'submit_payment', { method: f.elements.method.value, reference: f.reference.value.trim(), proof: path });
        await mkLoad(); mkRender(true); toast('Payment proof submitted — RAQBO will verify it.');
      } catch (err) { done(); showErrors(f, [['proof', err.message]]); }
    }
    if (f.dataset.mkform === 'review') {
      e.preventDefault(); const r = +f.rating.value; const c = f.comment.value.trim(); const errs = [];
      if (!r) errs.push(['comment', 'Choose a star rating.']); if (c.length < 3) errs.push(['comment', 'Write a short comment.']); if (showErrors(f, errs)) return;
      const done = busy($('[type=submit]', f), 'Posting…');
      try { await MK.review(f.dataset.id, r, c); await mkLoad(); mkRender(true); toast('Thanks for your review!'); } catch (err) { done(); showErrors(f, [['comment', err.message]]); }
    }
  });


