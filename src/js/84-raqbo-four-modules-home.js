  /* =====================================================================
     RAQBO — the four modules on the front page
     The nav used to be eight flat links, all of them property. RAQBO is
     four things — Properties, Marketplace, Projects and Services — and the
     front page now says so: four tabs, each opening what sits inside it,
     and one search panel that will look in whichever of the four you pick
     instead of only in property.
     ===================================================================== */
  const FM = { open: null, sm: 'properties', prj: null };

  /* ---------- the module dropdowns ---------- */
  function fmClose() {
    if (!FM.open) return;
    const p = $('#mod-' + FM.open);
    if (p) p.hidden = true;
    const t = $(`.main-nav [data-mod="${FM.open}"]`);
    if (t) { t.setAttribute('aria-expanded', 'false'); t.classList.remove('on'); }
    FM.open = null;
  }
  function fmOpen(key) {
    const p = $('#mod-' + key);
    if (!p) return;
    if (FM.open === key) { fmClose(); return; }
    fmClose();
    try { closeNavMenus(); } catch { /* the services mega closes itself */ }
    p.hidden = false;
    const t = $(`.main-nav [data-mod="${key}"]`);
    if (t) { t.setAttribute('aria-expanded', 'true'); t.classList.add('on'); }
    FM.open = key;
    const first = $('.mod-item', p);
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 20);
  }
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.main-nav [data-mod]');
    if (tab) { e.preventDefault(); fmOpen(tab.dataset.mod); return; }
    // anything chosen inside a panel closes it; the item's own handler still runs
    const item = e.target.closest('.mod-item');
    if (item) {
      const go = item.dataset.modGo;
      fmClose();
      if (go === 'properties') setTimeout(() => { const s = $('#properties'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
      return;
    }
    if (FM.open && !e.target.closest('.mod-panel') && !e.target.closest('.main-nav')) fmClose();
  });
  // The services tab stops its click dead before any other listener sees it,
  // and its mega menu is only built on the first open. So rather than chase the
  // click, watch the bar the mega is built into: whenever a mega appears there
  // or stops being hidden, the module panel steps aside.
  {
    const row = $('.nav-row');
    if (row) {
      new MutationObserver(() => {
        if (!FM.open) return;
        const m = $('.mega', row);
        if (m && !m.hidden) fmClose();
      }).observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !FM.open) return;
    e.stopImmediatePropagation();
    const tab = $(`.main-nav [data-mod="${FM.open}"]`);
    fmClose();
    if (tab) tab.focus({ preventScroll: true });
  });
  window.addEventListener('hashchange', fmClose);

  /* ---------- one search panel, four modules ---------- */
  function fmSearch(key) {
    FM.sm = key;
    $$('.sm-body').forEach((b) => { b.hidden = b.dataset.smBody !== key; });
    $$('.mod-pills [data-sm]').forEach((b) => {
      const on = b.dataset.sm === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    const cap = $('.search-caption');
    if (cap) cap.hidden = key !== 'properties';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.mod-pills [data-sm]');
    if (!b) return;
    e.preventDefault();
    fmSearch(b.dataset.sm);
  });
  // only the property body may submit the form; the others carry their own buttons
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('.search-panel');
    if (f && FM.sm !== 'properties') e.preventDefault();
  }, true);

  /* ---------- Projects: upcoming, running, all ---------- */
  // A project is running once RAQBO has recorded progress on it, and upcoming
  // until then. That is the same number the project card already shows, so the
  // two lists can never drift from what a visitor reads on the card.
  const FM_PRJ = {
    upcoming: ['Upcoming projects', 'Launching soon. Plans, approvals and the payment plan are published before work starts.'],
    running: ['Running projects', 'Under construction now, with the progress RAQBO has recorded on each.'],
    all: ['Projects & developments', 'Everything RAQBO owns, markets or develops with partners.']
  };
  function fmPrjFilter() {
    const stage = FM.prj;
    if (!stage || stage === 'all') return;
    const host = $('.v3pr-grid');
    if (!host) return;
    let shown = 0;
    $$('.v3pr', host).forEach((card) => {
      const bar = $('.v3p-bar b', card);
      const pct = bar ? parseInt(String(bar.textContent).replace(/[^\d]/g, ''), 10) || 0 : 0;
      const running = pct > 0;
      const keep = stage === 'running' ? running : !running;
      card.hidden = !keep;
      if (keep) shown++;
    });
    const head = $('.v3e-page h2');
    if (head && FM_PRJ[stage]) {
      head.textContent = FM_PRJ[stage][0];
      const lead = head.nextElementSibling;
      if (lead && lead.classList.contains('modal-lead')) lead.textContent = FM_PRJ[stage][1];
    }
    if (!shown && host && !$('.fm-prj-empty', host.parentNode)) {
      host.insertAdjacentHTML('afterend', `<div class="admin-empty fm-prj-empty">No ${stage} projects right now. <button type="button" class="link-button" data-prj="all">See every project</button></div>`);
    }
    // let a visitor move between the two lists without closing the page
    if (!$('.fm-prj-seg', host.parentNode)) {
      host.insertAdjacentHTML('beforebegin', `<div class="seg fm-prj-seg">${['upcoming', 'running', 'all'].map((k) => `<button type="button" data-prj="${k}" class="${k === stage ? 'active' : ''}">${esc(k === 'all' ? 'All' : FM_PRJ[k][0].replace(' projects', ''))}</button>`).join('')}</div>`);
    } else {
      $$('.fm-prj-seg [data-prj]').forEach((b) => b.classList.toggle('active', b.dataset.prj === stage));
    }
  }
  async function fmProjects(stage) {
    FM.prj = stage;
    fmClose();
    const already = $('.v3pr-grid');
    if (already) {
      const seg = $('.fm-prj-seg'); if (seg) seg.remove();
      const em = $('.fm-prj-empty'); if (em) em.remove();
      fmPrjFilter();
      return;
    }
    try { await openProjects(); } catch { toast('Projects are not available right now.'); return; }
    setTimeout(fmPrjFilter, 60);
    setTimeout(fmPrjFilter, 400);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-prj]');
    if (!b) return;
    e.preventDefault();
    const v = b.dataset.prj;
    if (v === 'search') { const sel = $('#sm-prj'); fmProjects(sel ? sel.value : 'all'); return; }
    fmProjects(v);
  });
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#projects\/(upcoming|running|all)$/);
    if (m) { fmProjects(m[1]); try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
  });

  /* ---------- the marketplace field hands its text to the directory ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sm-body="marketplace"] [data-mk="dir"]');
    if (!b) return;
    const q = $('#sm-mk');
    if (q && q.value.trim()) { try { mk.q = q.value.trim(); } catch { /* the directory has its own search */ } }
  }, true);

  fmSearch('properties');
