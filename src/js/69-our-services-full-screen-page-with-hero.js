  /* =====================================================================
     Our Services — full-screen page with hero slideshow
     ===================================================================== */
  const SVP = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1800&q=80`;
  const SV_CONTENT = ((window.RAQBO_CONTENT || {}).services) || {};
  const SERVICES_PAGE = [
    { key: 'market', icon: 'store', title: 'Construction Materials Marketplace', short: 'Order Online', tag: 'NEW',
      tagline: 'Construction materials from suppliers across Pakistan — negotiate on WhatsApp or order with RAQBO payment protection.',
      bullets: ['Cement, steel, bricks, tiles & more', 'Live rates from verified suppliers', 'Pay safely — vendor is paid after delivery'],
      cta: ['Browse vendors', 'market'], cta2: ['Become a supplier', 'market-supplier'], photo: SVP('1504307651254-35680f356dfd') },
    { key: 'verification', icon: 'shield', title: 'Property Verification', short: 'Verification',
      tagline: 'Know exactly what you are buying before you pay a single rupee.',
      bullets: ['Ownership & title checks', 'Document, NOC & approval verification', 'Dues, encumbrance & site checks'],
      cta: ['Request verification', 'svc:verification'], photo: SVP('1560518883-ce09059eeffa') },
    { key: 'legal', icon: 'scale', title: 'Legal Services', short: 'Legal',
      tagline: 'Agreements, transfers and property matters handled by qualified legal professionals.',
      bullets: ['Sale & purchase agreements', 'Transfer and possession guidance', 'Advice on property disputes'],
      cta: ['Talk to our legal team', 'svc:legal'], photo: SVP('1589829545856-d10d557cf95f') },
    { key: 'documents', icon: 'doc', title: 'Document Drafting', short: 'Documents',
      tagline: 'Clear, correct paperwork — drafted, reviewed and ready to sign.',
      bullets: ['Sale deeds & rent agreements', 'Power of attorney & affidavits', 'Review of your existing documents'],
      cta: ['Get documents drafted', 'svc:documents'], photo: SVP('1450101499163-c8848c66ca85') },
    { key: 'registry', icon: 'bank', title: 'Registry Assistance', short: 'Registry',
      tagline: 'From stamp paper to registry and mutation — we walk you through every step.',
      bullets: ['Registry & stamp duty guidance', 'Mutation (intiqal) support', 'Fard and land record checks'],
      cta: ['Get registry help', 'svc:registry'], photo: SVP('1554224155-6726b3ff858f') }
  ].map((s) => Object.assign(s, SV_CONTENT[s.key] || {}));
  const svs = { el: null, car: null };
  const SV_MS = 6500;
  const reduceMotionSv = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const canHoverSv = () => { try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { return false; } };
  // One slideshow controller per hero (home section + services page)
  function svCarousel(hero) {
    const st = { i: 0, timer: null, paused: false, visible: true, x0: null, dead: false };
    const n = $$('.sv-slide', hero).length;
    const schedule = () => {
      clearTimeout(st.timer); if (st.dead) return; hero.classList.toggle('paused', st.paused || !st.visible);
      if (st.paused || !st.visible || document.hidden || reduceMotionSv() || n < 2) return;
      st.timer = setTimeout(() => go(st.i + 1), SV_MS);
    };
    const go = (i, user) => {
      st.i = (i + n) % n;
      $$('.sv-slide', hero).forEach((s, k) => { s.classList.toggle('on', k === st.i); s.setAttribute('aria-hidden', String(k !== st.i)); });
      $$('.sv-tab', hero).forEach((t, k) => { t.classList.toggle('on', k === st.i); t.classList.toggle('done', k < st.i); t.setAttribute('aria-selected', String(k === st.i)); const bar = $('i', t); if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; } });
      const c = $('.sv-counter b', hero); if (c) c.textContent = String(st.i + 1).padStart(2, '0');
      if (user) st.paused = false; schedule();
    };
    hero.addEventListener('click', (e) => {
      const t = e.target.closest('[data-sv-to]'); if (t) { go(+t.dataset.svTo, true); return; }
      const b = e.target.closest('[data-sv]'); if (!b) return;
      if (b.dataset.sv === 'prev') go(st.i - 1, true); else if (b.dataset.sv === 'next') go(st.i + 1, true);
    });
    if (canHoverSv()) {
      hero.addEventListener('mouseover', (e) => { if (e.target.closest('.sv-copy') && !st.paused) { st.paused = true; schedule(); } });
      hero.addEventListener('mouseout', (e) => { if (e.target.closest('.sv-copy') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.sv-copy'))) { st.paused = false; schedule(); } });
    }
    hero.addEventListener('touchstart', (e) => { st.x0 = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
    hero.addEventListener('touchend', (e) => { if (!st.x0) return; const dx = e.changedTouches[0].clientX - st.x0[0]; const dy = e.changedTouches[0].clientY - st.x0[1]; st.x0 = null; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) go(st.i + (dx < 0 ? 1 : -1), true); });
    hero.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') go(st.i - 1, true); else if (e.key === 'ArrowRight') go(st.i + 1, true); });
    $$('.sv-bg img', hero).forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver((en) => { st.visible = en[0].isIntersecting; schedule(); }, { threshold: 0.25 }); io.observe(hero); st.io = io; }
    document.addEventListener('visibilitychange', schedule);
    return { go, schedule, get i() { return st.i; }, destroy() { st.dead = true; clearTimeout(st.timer); if (st.io) st.io.disconnect(); document.removeEventListener('visibilitychange', schedule); } };
  }
  function svHeroHTML(cls = '') {
    const S = SERVICES_PAGE; const n = S.length;
    return `<div class="sv-hero ${cls}" aria-roledescription="carousel" aria-label="RAQBO services" tabindex="-1">
      ${S.map((s, k) => `<article class="sv-slide ${k === 0 ? 'on' : ''}" aria-roledescription="slide" aria-label="${k + 1} of ${n}: ${esc(s.title)}" aria-hidden="${k !== 0}">
        <div class="sv-bg sv-bg-${esc(s.key)}"><span class="sv-bg-icon">${DI(DIC[s.icon], 260)}</span>${s.photo ? `<img src="${esc(s.photo)}" alt="" loading="lazy">` : ''}</div>
        <div class="sv-shade"></div>
        <div class="sv-slide-in"><div class="sv-copy">
          <div class="sv-kicker"><span class="sv-kicker-ico">${DI(DIC[s.icon], 20)}</span><span>OUR SERVICES · ${String(k + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</span>${s.tag ? `<em>${esc(s.tag)}</em>` : ''}</div>
          <h2 class="sv-h">${esc(s.title)}</h2>
          <p>${esc(s.tagline)}</p>
          <ul>${s.bullets.map((b) => `<li>${DI(DIC.check, 16)} ${esc(b)}</li>`).join('')}</ul>
          <div class="sv-ctas"><button type="button" class="button button-primary" data-sv-act="${esc(s.cta[1])}">${esc(s.cta[0])} ${DI('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 16)}</button>${s.cta2 ? `<button type="button" class="button sv-ghost" data-sv-act="${esc(s.cta2[1])}">${esc(s.cta2[0])}</button>` : `<a class="button sv-ghost" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hi RAQBO, I would like to know more about ' + s.title + '.')}" target="_blank" rel="noopener">${DI(DIC.chat, 16)} Ask on WhatsApp</a>`}</div>
        </div></div>
      </article>`).join('')}
      <button type="button" class="sv-arrow prev" data-sv="prev" aria-label="Previous service">${DI('<path d="m15 18-6-6 6-6"/>', 22)}</button>
      <button type="button" class="sv-arrow next" data-sv="next" aria-label="Next service">${DI('<path d="m9 18 6-6-6-6"/>', 22)}</button>
      <div class="sv-counter" aria-hidden="true"><b>01</b><span>/ ${String(n).padStart(2, '0')}</span></div>
      <div class="sv-tabs" role="tablist" aria-label="Choose a service">${S.map((s, k) => `<button type="button" role="tab" class="sv-tab ${k === 0 ? 'on' : ''}" data-sv-to="${k}" aria-selected="${k === 0}"><span>${DI(DIC[s.icon], 15)} ${esc(s.short)}</span><i></i></button>`).join('')}</div>
    </div>`;
  }
  function svCardsHTML() {
    return `<div class="sv-grid">${SERVICES_PAGE.map((s, k) => `<article class="sv-card ${k === 0 ? 'feature' : ''}">
        ${k === 0 ? `<div class="sv-card-media sv-bg-${esc(s.key)}"><span class="sv-bg-icon">${DI(DIC[s.icon], 140)}</span>${s.photo ? `<img src="${esc(s.photo)}" alt="" loading="lazy">` : ''}<em>NEW</em></div>` : ''}
        <div class="sv-card-body"><span class="sv-card-ico">${DI(DIC[s.icon], 26)}</span><h3>${esc(s.title)}</h3><p>${esc(s.tagline)}</p>
          <ul>${s.bullets.map((b) => `<li>${DI(DIC.check, 14)} ${esc(b)}</li>`).join('')}</ul>
          <div class="sv-card-cta"><button type="button" class="button ${k === 0 ? 'button-primary' : 'button-outline'}" data-sv-act="${esc(s.cta[1])}">${esc(s.cta[0])}</button>${k === 0 && s.cta2 ? `<button type="button" class="link-button" data-sv-act="${esc(s.cta2[1])}">${esc(s.cta2[0])} →</button>` : ''}</div></div>
      </article>`).join('')}</div>`;
  }
  function svAction(code) {
    if (code === 'market') { closeServices({ silent: true }); openMarket('dir'); }
    else if (code === 'market-supplier') { closeServices({ silent: true }); openMarket('shop', { createProfile: true }); }
    else if (code.startsWith('svc:')) openEnquiry(code.slice(4));
    else if (code === 'page') openServices();
    else if (code === 'wa') window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hi RAQBO, I need help choosing the right service.')}`, '_blank', 'noopener');
  }
  function servicesHTML() {
    return `<header class="pp-top sv-top"><div class="pp-top-in"><button type="button" class="pp-back" data-sv="close">${DI('<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>', 16)} Back to home</button><span class="sv-top-title">Our Services</span><a class="pp-icon-btn sv-top-wa" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hi RAQBO, I would like to know about your services.')}" target="_blank" rel="noopener">${DI(DIC.chat, 16)} WhatsApp us</a></div></header>
    ${svHeroHTML('page')}
    <section class="sv-sec"><div class="sv-in">
      <div class="sv-head"><div class="eyebrow"><span></span> WHAT WE DO</div><h2>Everything for your property — <span class="gold-text">in one place</span></h2><p>Pick a service, fill a short form, and the RAQBO team takes it from there on WhatsApp.</p></div>
      ${svCardsHTML()}
    </div></section>
    <section class="sv-sec sv-dark"><div class="sv-in">
      <div class="sv-head"><div class="eyebrow eyebrow-light"><span></span> HOW IT WORKS</div><h2>Simple, clear and on WhatsApp</h2></div>
      <ol class="sv-steps">
        <li><b>1</b><h3>Choose a service</h3><p>Verification, legal, documents, registry or materials.</p></li>
        <li><b>2</b><h3>Share the details</h3><p>A short form — city, property and what you need.</p></li>
        <li><b>3</b><h3>We contact you</h3><p>Our team replies on WhatsApp with the next steps and fees.</p></li>
        <li><b>4</b><h3>Done, the right way</h3><p>Checked paperwork and clear updates until it’s complete.</p></li>
      </ol>
      <div class="sv-trust"><span>${DI(DIC.shield, 18)} Qualified professionals</span><span>${DI(DIC.chat, 18)} WhatsApp support</span><span>${DI(DIC.lock, 18)} Your documents kept private</span><span>${DI(DIC.pin, 18)} Major cities across Pakistan</span></div>
    </div></section>
    <section class="sv-cta"><div class="sv-in"><h2>Not sure which service you need?</h2><p>Tell us about your property and we’ll guide you — no obligation.</p><div class="sv-cta-btns"><button type="button" class="button button-primary" data-sv-act="wa">${DI(DIC.chat, 16)} Chat on WhatsApp</button><button type="button" class="button sv-ghost" data-sv-act="svc:general">Send an enquiry</button></div></div></section>`;
  }
  function openServices(opts = {}) {
    closeModal(); closeNavMenus();
    if (pp.el && !pp.el.hidden) closeDetails({ fromHistory: true }); if (au.el && !au.el.hidden) closeAbout({ fromHistory: true }); if (mk.el && !mk.el.hidden) closeMarket({ fromHistory: true });
    if (!svs.el) {
      svs.el = document.createElement('div'); svs.el.className = 'sv'; svs.el.hidden = true; svs.el.setAttribute('role', 'dialog'); svs.el.setAttribute('aria-label', 'Our services');
      document.body.append(svs.el);
      svs.el.addEventListener('click', (e) => { const b = e.target.closest('[data-sv="close"]'); if (b) closeServices(); });
    }
    if (svs.car) svs.car.destroy();
    svs.el.innerHTML = servicesHTML(); if (typeof v3sInject === 'function') v3sInject(svs.el); applyBrandIcons(svs.el);
    $$('.sv-card-media img', svs.el).forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
    svs.el.hidden = false; document.body.classList.add('pp-open'); svs.el.scrollTop = 0;
    svs.car = svCarousel($('.sv-hero', svs.el));
    if (!opts.fromHistory && location.hash !== '#our-services') { try { history.pushState({ sv: 1 }, '', '#our-services'); } catch { /* ignore */ } }
    const start = SERVICES_PAGE.findIndex((s) => s.key === opts.start); svs.car.go(start > 0 ? start : 0);
    setTimeout(() => { const b = $('.pp-back', svs.el); if (b) b.focus({ preventScroll: true }); }, 40);
  }
  function closeServices(opts = {}) {
    if (!svs.el || svs.el.hidden) return; if (svs.car) { svs.car.destroy(); svs.car = null; } svs.el.hidden = true; svs.el.innerHTML = '';
    if ((!pp.el || pp.el.hidden) && (!au.el || au.el.hidden) && (!mk.el || mk.el.hidden)) document.body.classList.remove('pp-open');
    if (!opts.fromHistory && !opts.silent && location.hash === '#our-services') { try { history.pushState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
  }
  window.addEventListener('popstate', () => { if (location.hash === '#our-services') openServices({ fromHistory: true }); else closeServices({ fromHistory: true }); });
  // Any [data-sv-act] button anywhere on the site (home section, services page, Services menu)
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-sv-act]'); if (a) { e.preventDefault(); closeNavMenus(); svAction(a.dataset.svAct); } });

  /* ---------- Home page: eye-catching Our Services section ---------- */
  function renderHomeServices() {
    const sec = $('#services'); if (!sec) return;
    sec.classList.add('svh');
    sec.innerHTML = `<div class="container">
      <div class="svh-head"><div><div class="eyebrow eyebrow-light"><span></span> OUR SERVICES</div><h2>Property help, <span class="gold-text">end to end</span></h2><p>Verification, legal work, documents and registry — plus construction materials with payment protection.</p></div>
        <button type="button" class="button sv-ghost" data-sv-act="page">Explore all services ${DI('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 16)}</button></div>
      ${svHeroHTML('home')}
      <div class="svh-strip">${SERVICES_PAGE.map((s) => `<button type="button" class="svh-item" data-sv-act="${esc(s.cta[1])}"><span class="svh-ico">${DI(DIC[s.icon], 22)}</span><span><b>${esc(s.title)}</b><small>${esc(s.cta[0])} →</small></span>${s.tag ? `<em>${esc(s.tag)}</em>` : ''}</button>`).join('')}</div>
    </div>`;
    applyBrandIcons(sec);
    svCarousel($('.sv-hero', sec));
  }
  setTimeout(renderHomeServices, 0);   // after the whole script has loaded (icons etc.)

