  /* =====================================================================
     RAQBO advertiser profile — the way in, and a category filter
     The profile page itself already exists (#advertiser/<id>): live
     properties, sold and rented history, verified count and real reviews.
     What was missing is a clear way in from the listing, and a way to look
     at just one kind of property. Both are added here.
     ===================================================================== */

  // The advertiser block on a listing is now a button.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-adv]');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.adv;
    if (!id) { toast('This is a sample listing, so there is no advertiser profile behind it.'); return; }
    try { if (pp.el && !pp.el.hidden) closeDetails({ fromHistory: true }); } catch { /* ignore */ }
    openAdvertiser(id);
  });

  // Category chips on the profile, so a visitor can look at houses only,
  // plots only, or just what is for rent — the way people actually browse.
  const rqpCat = (l) => (l.purpose === 'rent' ? 'For rent' : String(l.type || 'Other'));
  function rqpCats(id) {
    const box = $('.v3a');
    if (!box || $('.rqp-cats', box)) return;
    const grid = $('.my-grid', box);
    if (!grid) return;
    const mine = (db.listings || []).filter((l) => !l.sample && l.ownerId === id && l.status === 'published');
    const cats = [];
    for (const l of mine) { const c = rqpCat(l); if (!cats.includes(c)) cats.push(c); }
    if (cats.length < 2) return;

    const nav = document.createElement('nav');
    nav.className = 'rqp-cats';
    nav.setAttribute('aria-label', 'Filter by category');
    nav.innerHTML = `<button type="button" class="rqp-cat on" data-rqp="all">All <i>${mine.length}</i></button>` +
      cats.map((c) => `<button type="button" class="rqp-cat" data-rqp="${esc(c)}">${esc(c)} <i>${mine.filter((l) => rqpCat(l) === c).length}</i></button>`).join('');
    grid.parentNode.insertBefore(nav, grid);

    const byId = new Map(mine.map((l) => [String(l.id), rqpCat(l)]));
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rqp]');
      if (!b) return;
      const want = b.dataset.rqp;
      $$('.rqp-cat', nav).forEach((x) => x.classList.toggle('on', x === b));
      let shown = 0;
      $$('[data-id]', grid).forEach((card) => {
        const c = byId.get(String(card.dataset.id));
        const show = want === 'all' || c === want;
        card.hidden = !show;
        if (show) shown++;
      });
      let none = $('.rqp-none', grid.parentNode);
      if (!shown) {
        if (!none) { none = document.createElement('div'); none.className = 'admin-empty rqp-none'; grid.parentNode.insertBefore(none, grid.nextSibling); }
        none.textContent = 'Nothing in that category right now.';
      } else if (none) none.remove();
    });
  }
  { const base = openAdvertiser; openAdvertiser = function (id) { const r = base(id); setTimeout(() => rqpCats(id), 40); setTimeout(() => rqpCats(id), 320); return r; }; }
