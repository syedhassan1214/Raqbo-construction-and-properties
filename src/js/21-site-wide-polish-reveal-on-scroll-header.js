  /* =====================================================================
     Site-wide polish: reveal-on-scroll, header state, back-to-top,
     scroll progress, nicer toasts, and a combined "Sell faster" section
     ===================================================================== */
  // One premium section instead of two empty rows when there is no QuickSell or auction yet
  RAILS.push(() => {
    const urgentN = db.listings.filter((l) => l.saleMode === 'urgent' && l.status === 'published' && dl.urgent.has(l.id)).length;
    const live = ax.list.filter((a) => ['live', 'closing'].includes(a.phase)).length; const soon = ax.list.filter((a) => a.phase === 'upcoming').length;
    if ((!dlOn() && !auOn()) || urgentN || live || soon) return null;
    return { id: 'rail-sellfast', list: [], always: true, section: `<section class="rail sf" id="rail-sellfast" aria-label="Faster ways to sell"><div class="container">
      <div class="sf-head"><span class="rail-kicker">NEW AT RAQBO</span><h2>Two faster ways to sell</h2><p>For owners who cannot wait months — RAQBO reviews every property and keeps you in control of the final price.</p></div>
      <div class="sf-grid">
        ${dlOn() ? `<article class="sf-card sf-urgent"><div class="sf-ico">${DI(DIC.alert, 26)}</div><span class="sf-tag"><i class="fx-dot urg"></i> QUICKSELL</span><h3>Sell within days, not months</h3><p>Offer the property to RAQBO directly, to approved investors privately, or publicly with an QuickSell label.</p>
          <ul><li>${DI(DIC.check, 14)} Your minimum price stays private</li><li>${DI(DIC.check, 14)} Offers and visits handled by RAQBO</li><li>${DI(DIC.check, 14)} Track every step to sale</li></ul>
          <div class="sf-act"><button type="button" class="button button-primary" data-dl="sell">QuickSell</button><button type="button" class="link-button" data-dl="urgent-page">How it works →</button></div></article>` : ''}
        ${auOn() ? `<article class="sf-card sf-auction"><div class="sf-ico">${DI(DIC.gavel, 26)}</div><span class="sf-tag"><i class="fx-dot live"></i> PROPERTY AUCTIONS</span><h3>Let verified buyers compete</h3><p>Transparent online auctions with anonymous bidder numbers, a private reserve price and extra time for late bids.</p>
          <ul><li>${DI(DIC.check, 14)} Only CNIC-verified bidders</li><li>${DI(DIC.check, 14)} Not sold below your reserve</li><li>${DI(DIC.check, 14)} Every bid recorded with time</li></ul>
          <div class="sf-act"><button type="button" class="button button-light" data-ax="sell">Sell by auction</button><button type="button" class="link-button" data-ax="home">See auctions →</button></div></article>` : ''}
      </div></div></section>` };
  });

  (function polish() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Header shadow and scroll progress
    const header = $('.site-header'); const bar = document.createElement('div'); bar.className = 'pl-progress'; document.body.append(bar);
    const top = document.createElement('button'); top.type = 'button'; top.className = 'pl-top'; top.setAttribute('aria-label', 'Back to top'); top.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
    top.addEventListener('click', () => scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })); document.body.append(top);
    let ticking = false;
    const onScroll = () => { ticking = false; const y = scrollY; const max = document.documentElement.scrollHeight - innerHeight; if (header) header.classList.toggle('pl-scrolled', y > 12); bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`; top.classList.toggle('show', y > innerHeight * 1.2); };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true }); onScroll();
    // Reveal-on-scroll for home sections (once)
    if (!reduce && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('pl-in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
      const tag = () => $$('main > section:not(.hero-section) .container > *, .rail .container > *, .site-footer .container > *, .category-card, .dash-kpi').forEach((el) => { if (el.dataset.pl || el.getBoundingClientRect().top < innerHeight * 0.9) { el.dataset.pl = '1'; return; } el.dataset.pl = '1'; el.classList.add('pl-rv'); io.observe(el); });
      tag(); new MutationObserver(() => { clearTimeout(tag.t); tag.t = setTimeout(tag, 120); }).observe(document.body, { childList: true, subtree: true });
    }
    // Toasts: add an icon and a close button
    const t = $('.preview-toast'); const style = () => { const el = $('.preview-toast'); if (!el || el.dataset.pl) return; el.dataset.pl = '1'; el.setAttribute('role', 'status'); };
    style(); if (!t) new MutationObserver((m, o) => { if ($('.preview-toast')) { style(); o.disconnect(); } }).observe(document.body, { childList: true });
  })();
  // My RAQBO: getting-started checklist with progress ring
  { const base = MY_RENDER.overview; MY_RENDER.overview = async () => (await base()) + plStart(); }
  function plStart() {
    const s = db.session; if (!s) return ''; const mine = db.listings.filter((l) => !l.sample && l.ownerId === s.userId);
    const steps = [
      [pf.idv.has(s.userId), 'Verify your identity', 'Get the ID verified chip — needed to bid and to join the Investors Network.', 'data-my="identity"', 'Start'],
      [mine.length > 0, 'List your first property', 'Free for owners. RAQBO reviews it before it goes live.', 'data-new-listing', 'List now'],
      [mine.some((l) => vfIsVerified(l.id)), 'Get the RAQBO Verified badge', 'Verified listings are shown first and earn more trust.', 'data-my="properties"', 'Verify'],
      [db.favorites.length > 0 || !!(gw.me && (gw.me.alerts || []).length), 'Save a property or set an alert', 'We will tell you when prices drop or new matches arrive.', 'data-action="all"', 'Browse'],
      [!!(gw.me && (gw.me.invited || 0)), 'Invite a friend', 'Earn RAQBO service credit when friends join and list.', 'data-my="rewards"', 'Invite']];
    const done = steps.filter((x) => x[0]).length; if (done === steps.length) return '';
    const pct = Math.round(done / steps.length * 100); const C = 2 * Math.PI * 26;
    return `<section class="pl-start"><div class="pl-start-head"><svg class="pl-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26"/><circle cx="32" cy="32" r="26" class="on" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - done / steps.length)}"/></svg><b class="pl-pct">${pct}%</b><div><h3>Get the most out of RAQBO</h3><p>${done} of ${steps.length} steps done</p></div></div>
      <ol>${steps.map(([ok, t, d, attr, btn]) => `<li class="${ok ? 'ok' : ''}"><span class="pl-chk">${ok ? DI(DIC.check, 14) : ''}</span><div><b>${esc(t)}</b><small>${esc(d)}</small></div>${ok ? '<em>Done</em>' : `<button type="button" class="button button-outline" ${attr}>${esc(btn)}</button>`}</li>`).join('')}</ol></section>`;
  }
  document.addEventListener('click', (e) => { if (e.target.closest('.my-overlay [data-action="all"]') && pf.my.open) closeMy(); }, true);
  // ---------- Phone: app-style bottom tab bar ----------
  (function tabbar() {
    const bar = document.createElement('nav'); bar.className = 'pl-tabs'; bar.setAttribute('aria-label', 'Quick navigation');
    const ic = (p) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    bar.innerHTML = `<button type="button" data-pt="home" class="on">${ic('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>')}<span>Home</span></button>
      <button type="button" data-pt="search">${ic('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}<span>Search</span></button>
      <button type="button" data-pt="sell" class="pl-tabs-sell" aria-label="List your property">${ic('<path d="M12 5v14M5 12h14"/>')}<span>Sell</span></button>
      <button type="button" data-pt="saved">${ic('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>')}<span>Saved</span><em hidden></em></button>
      <button type="button" data-pt="me">${ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>')}<span>Account</span></button>`;
    document.body.append(bar); document.body.classList.add('has-pl-tabs');
    const fire = (sel) => { const b = document.createElement('button'); b.type = 'button'; b.hidden = true; Object.entries(sel).forEach(([k, v]) => b.setAttribute(k, v)); document.body.append(b); b.click(); b.remove(); };
    const closeAll = () => { if ($('.modal-backdrop')) closeModal(); if (pf.my.open) closeMy(); closeNavMenus(); };
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pt]'); if (!b) return; const a = b.dataset.pt;
      if (a === 'home') { closeAll(); scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (a === 'search') { closeAll(); fire({ 'data-action': 'all' }); }
      else if (a === 'sell') { closeAll(); fire({ 'data-action': 'list' }); }
      else if (a === 'saved') { closeAll(); fire({ 'data-nav': 'saved' }); }
      else if (a === 'me') { if (!isComplete()) fire({ 'data-action': 'signin' }); else { closeAll(); openMy(); } }
    });
    const sync = () => {
      const res = $('#properties'); const y = scrollY; const r = res ? res.getBoundingClientRect() : null;
      const k = pf.my.open ? 'me' : r && r.top < innerHeight * 0.5 && r.bottom > 80 ? 'search' : y < innerHeight * 0.6 ? 'home' : '';
      $$('[data-pt]', bar).forEach((x) => x.classList.toggle('on', x.dataset.pt === k));
      const n = (db.favorites || []).length; const em = $('[data-pt=saved] em', bar); em.hidden = !n; em.textContent = n > 9 ? '9+' : n;
    };
    addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true }); window.addEventListener('raqbo-growth', sync); setInterval(sync, 2000); sync();
  })();

