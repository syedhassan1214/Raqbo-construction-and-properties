  /* =====================================================================
     Property discovery
     ===================================================================== */
  const grid = $('#property-grid'); const loc = $('#f-location'); const typeSel = $('#f-type'); const budgetSel = $('#f-budget'); const directChk = $('#f-direct');
  const ui = { deal: 'all', sort: 'recommended', savedOnly: false, limit: 12, sig: '' };
  const PAGE = 12;
  const BUDGETS = {
    sale: [['', 'Any budget'], ['sale:0:5000000', 'Under 50 lakh'], ['sale:5000000:10000000', '50 lakh – 1 crore'], ['sale:10000000:20000000', '1 – 2 crore'], ['sale:20000000:50000000', '2 – 5 crore'], ['sale:50000000:100000000', '5 – 10 crore'], ['sale:100000000:', '10 crore +']],
    rent: [['', 'Any budget'], ['rent:0:50000', 'Under 50,000 / month'], ['rent:50000:100000', '50,000 – 1 lakh / month'], ['rent:100000:200000', '1 – 2 lakh / month'], ['rent:200000:500000', '2 – 5 lakh / month'], ['rent:500000:', '5 lakh + / month']]
  };
  const setBudgetOptions = () => {
    const list = BUDGETS[ui.deal === 'rent' ? 'rent' : 'sale']; const cur = budgetSel.value;
    budgetSel.innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    budgetSel.value = list.some(([v]) => v === cur) ? cur : '';
  };
  const budgetOk = (l, b) => { if (!b) return true; const [p, min, max] = b.split(':'); return l.purpose === p && l.price >= +min && (max === '' || l.price < +max); };
  function filtered(skip) {
    const tokens = loc.value.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    const list = db.listings.filter((l) => l.status === 'published'
      && (ui.deal === 'all' || l.purpose === ui.deal)
      && (!tokens.length || tokens.every((t) => [l.title, l.area, l.city].join(' ').toLowerCase().includes(t)))
      && (!typeSel.value || l.type === typeSel.value)
      && (!directChk.checked || l.role === 'Owner')
      && (!ui.savedOnly || db.favorites.includes(l.id))
      && fxMatch(l, skip)
      && isPublicListing(l)
      && budgetOk(l, budgetSel.value));
    if (fxSort(list, ui.sort)) { /* sorted by smart filters */ }
    else if (ui.sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    else if (ui.sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    else if (ui.sort === 'size-desc') list.sort((a, b) => marlaOf(b) - marlaOf(a));
    else if (ui.sort === 'ppm-asc') list.sort((a, b) => (ppm(a) || Infinity) - (ppm(b) || Infinity));
    else if (ui.sort === 'rating') list.sort((a, b) => ((ratingOf(b.id) || {}).avg || 0) - ((ratingOf(a.id) || {}).avg || 0) || (b.publishedAt || 0) - (a.publishedAt || 0));
    else list.sort((a, b) => (gwIsFeatured(b.id) - gwIsFeatured(a.id)) || (vfIsVerified(b.id) - vfIsVerified(a.id)) || (b.publishedAt || 0) - (a.publishedAt || 0));
    return list;
  }
  const specsHTML = (l) => [
    l.beds > 0 ? `<span>${ICON.bed} ${l.beds} bed${l.beds > 1 ? 's' : ''}</span>` : '',
    l.baths > 0 ? `<span>${ICON.bath} ${l.baths} bath${l.baths > 1 ? 's' : ''}</span>` : '',
    `<span>${ICON.area} ${esc(fmtSize(l))}</span>`,
    !(l.beds > 0) ? `<span>${esc(l.type === 'Plot' ? 'Plot / land' : l.type)}</span>` : ''
  ].join('');
  const MARLA = { marla: 1, kanal: 20, 'sq ft': 1 / 225, 'sq yd': 1 / 25, acre: 160 };
  const marlaOf = (l) => { const u = String(l.sizeUnit || '').toLowerCase(); const ms = Number(l.marlaSqft) || 225; const f = u === 'sq ft' ? 1 / ms : u === 'sq yd' ? 9 / ms : MARLA[u] || 0; return (Number(l.size) || 0) * f; };
  const ppm = (l) => (l.purpose !== 'rent' && marlaOf(l) > 0 ? Math.round(l.price / marlaOf(l)) : 0);   // price per marla
  function cardHTML(l) {
    const fav = db.favorites.includes(l.id); const rent = l.purpose === 'rent';
    return `<article class="property-card" data-id="${esc(l.id)}"><div class="property-image" role="button" tabindex="0" aria-label="View ${esc(l.title)}" data-open ${mediaAttr(l.photos[0], true)}><span class="image-label">${rent ? 'FOR RENT' : 'FOR SALE'}</span>${gwIsFeatured(l.id) ? '<span class="feat-label">SPONSORED</span>' : ''}${coreCardLabel(l)}${dlCardLabel(l)}${auCardLabel(l)}${v3CardChips(l)}${l.role === 'Owner' ? '<span class="owner-label"><span></span> DIRECT OWNER</span>' : ''}${l.videos.length ? '<span class="tour-label">▶ VIDEO</span>' : ''}<button class="favorite-button ${fav ? 'saved' : ''}" data-fav aria-label="${fav ? 'Remove from saved' : 'Save property'}" aria-pressed="${fav}">${ICON.heart}</button>${l.status === 'published' ? `<button class="share-button" data-share aria-label="Share property" title="Share">${ICON.share}</button>` : ''}</div><div class="property-info"><div class="property-location">${ICON.pin} ${esc(l.area)}, ${esc(l.city)}${vfCardBadge(l)}</div><h3 title="${esc(l.title)}" data-open style="cursor:pointer">${esc(l.title)}</h3>${ratingOf(l.id) ? `<div class="card-rating">${starsHTML(ratingOf(l.id).avg, 'sm')} <b>${ratingOf(l.id).avg.toFixed(1)}</b> <small>(${ratingOf(l.id).count})</small></div>` : ''}<div class="property-specs">${specsHTML(l)}</div><div class="property-card-bottom"><div class="property-price">${fmtPrice(l.price)}<small>${rent ? 'MONTHLY RENT' : ppm(l) ? `≈ ${esc(fmtPrice(ppm(l)))} / marla` : 'ASKING PRICE'}</small></div><button class="details-button" data-open>View listing ${ICON.arrow}</button></div></div></article>`;
  }
  let loadError = '';
  function renderGrid() {
    if (!db.loaded) { grid.innerHTML = [0, 1, 2].map(() => '<div class="skeleton" style="height:360px"></div>').join(''); $('#results-count').textContent = 'Loading properties…'; return; }
    const list = filtered(); const total = db.listings.filter((l) => l.status === 'published').length;
    const sig = [ui.deal, ui.sort, ui.savedOnly, loc.value.trim(), typeSel.value, budgetSel.value, directChk.checked, ui.extra || '', fxSig()].join('|');
    if (sig !== ui.sig) { ui.sig = sig; ui.limit = PAGE; }
    const shown = list.slice(0, ui.limit); const more = list.length - shown.length;
    grid.innerHTML = loadError
      ? `<div class="empty-results"><span>!</span><h3>Couldn’t load properties</h3><p>${esc(loadError)}</p><button class="button button-primary" data-action="retry">Try again</button></div>`
      : list.length ? shown.map(cardHTML).join('') + (more > 0 ? `<div class="grid-more" data-more><button type="button" class="button button-outline" data-load-more>Show ${Math.min(PAGE, more)} more · ${more} left</button></div>` : '') : `<div class="empty-results"><span>⌕</span><h3>No properties match these filters</h3><p>${ui.savedOnly ? 'You have no saved properties that match. Tap the heart on any listing to save it.' : 'Try another area, property type or budget.'}</p><button class="button button-primary" data-action="all">Show all properties</button></div>`;
    hydrate(grid); watchMore(); areaSuggest(); fxBar(); placeToggle(); gwPlaceAlertBtn(); vfPlaceToggle(); coreRailsSoon(); if (mv.on) { grid.hidden = true; const mm = $('[data-more]'); if (mm) mm.hidden = true; drawMap(); }
    if (!ui.viewRestored && db.loaded) { ui.viewRestored = true; try { if (localStorage.getItem('raqbo-view') === 'map') showMap(true); } catch { /* ignore */ } }
    $('#results-count').textContent = `${list.length} of ${total} ${total === 1 ? 'property' : 'properties'}`;
    const chips = [];
    if (loc.value.trim()) chips.push('“' + loc.value.trim() + '”');
    if (typeSel.value) chips.push(typeSel.options[typeSel.selectedIndex].text);
    if (budgetSel.value) chips.push(budgetSel.options[budgetSel.selectedIndex].text);
    if (directChk.checked) chips.push('Direct owner only');
    if (ui.savedOnly) chips.push('Saved only');
    $('#results-filters').innerHTML = chips.map((c) => `<span class="filter-chip">${esc(c)}</span>`).join('') + fxChips() + (chips.length || fxSig() !== 'all,all,,,,false' ? '<button type="button" class="link-button" data-action="all">Clear filters</button>' : '');
    $('#saved-count').textContent = db.favorites.filter((id) => byId(id) && byId(id).status === 'published').length;
    $('#saved-toggle').setAttribute('aria-pressed', String(ui.savedOnly));
  }
  // Area suggestions while typing: every area + city that has listings
  let areaSig = '';
  function areaSuggest() {
    const pub = db.listings.filter((l) => l.status === 'published'); const sig = pub.length + ':' + (pub[0] && pub[0].id);
    if (sig === areaSig) return; areaSig = sig;
    let dl = $('#area-suggest'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'area-suggest'; document.body.append(dl); loc.setAttribute('list', 'area-suggest'); loc.setAttribute('autocomplete', 'off'); }
    const count = {}; pub.forEach((l) => { [`${l.area}, ${l.city}`, l.city].forEach((k) => { count[k] = (count[k] || 0) + 1; }); });
    dl.innerHTML = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, n]) => `<option value="${esc(k)}">${n} ${n === 1 ? 'property' : 'properties'}</option>`).join('');
  }
  // Infinite scroll: load the next 12 when the visitor nears the end of the list
  let moreObs = null;
  function loadMore() { ui.limit += PAGE; const y = window.scrollY; renderGrid(); window.scrollTo(0, y); }
  function watchMore() {
    const m = $('[data-more]', grid); if (moreObs) moreObs.disconnect(); if (!m || !('IntersectionObserver' in window)) return;
    moreObs = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { moreObs.disconnect(); loadMore(); } }, { rootMargin: '600px 0px' }); moreObs.observe(m);
  }
  function setDeal(deal) {
    ui.deal = deal;
    $$('.search-tabs [data-deal]').forEach((t) => { const on = t.dataset.deal === deal; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    $$('.deal-switch [data-deal]').forEach((t) => t.classList.toggle('active', t.dataset.deal === deal));
    setBudgetOptions(); renderGrid();
  }
  function resetFilters() { fxReset(); loc.value = ''; typeSel.value = ''; budgetSel.value = ''; directChk.checked = false; ui.savedOnly = false; ui.sort = 'recommended'; $('#sort-select').value = 'recommended'; setDeal('all'); }
  const scrollToResults = () => $('#properties').scrollIntoView({ behavior: 'smooth' });
  async function toggleFav(id) {
    // Flip the heart immediately; undo if the server says no
    const was = db.favorites.includes(id);
    $$(`.property-card[data-id="${CSS.escape(id)}"] [data-fav]`).forEach((b) => { b.classList.toggle('saved', !was); b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 350); });
    try { const on = await backend.toggleFavorite(id); toast(on ? (db.session && LIVE ? 'Saved to your favorites.' : 'Saved to favorites in this browser.') : 'Removed from saved properties.'); renderGrid(); return on; } catch (err) { toast(err.message); return db.favorites.includes(id); }
  }

  $('.search-panel').addEventListener('submit', (e) => {
    e.preventDefault(); renderGrid(); scrollToResults();
    const n = filtered().length; toast(n ? `${n} ${n === 1 ? 'property' : 'properties'} found.` : 'No properties match. Try a different area or filter.');
  });
  [typeSel, budgetSel, directChk].forEach((el) => el.addEventListener('change', renderGrid));
  let locTimer; loc.addEventListener('input', () => { clearTimeout(locTimer); locTimer = setTimeout(renderGrid, 250); });
  $$('[data-deal]').forEach((b) => b.addEventListener('click', (e) => { if (b.tagName === 'BUTTON') e.preventDefault(); setDeal(b.dataset.deal); }));
  $('#sort-select').addEventListener('change', (e) => { ui.sort = e.target.value; renderGrid(); });
  $('#saved-toggle').addEventListener('click', () => { ui.savedOnly = !ui.savedOnly; renderGrid(); });
  grid.addEventListener('click', (e) => {
    if (e.target.closest('[data-load-more]')) { loadMore(); return; }
    const card = e.target.closest('.property-card'); if (!card) return;
    if (e.target.closest('[data-fav]')) { e.stopPropagation(); toggleFav(card.dataset.id); return; }
    if (e.target.closest('[data-share]')) { e.stopPropagation(); const l = byId(card.dataset.id); if (l) shareListing(l); return; }
    if (e.target.closest('[data-open]')) openDetails(card.dataset.id);
  });
  grid.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.property-image')) { e.preventDefault(); openDetails(e.target.closest('.property-card').dataset.id); } });
  $$('[data-type]').forEach((b) => b.addEventListener('click', () => { typeSel.value = b.dataset.type; renderGrid(); scrollToResults(); toast(`Showing ${b.querySelector('.category-name').textContent.toLowerCase()}.`); }));

  /* ---------- Property details ---------- */
  function statusBox(l) {
    if (l.status === 'pending') return '<div class="detail-status is-pending"><span>◷</span><span><b>Awaiting admin review — not public</b><small>Only you and RAQBO administrators can see this listing until it is approved.</small></span></div>';
    if (l.status === 'rejected') return `<div class="detail-status is-rejected"><span>✕</span><span><b>Not approved in review</b><small>${esc(l.reviewNote || 'No note was added by the reviewer.')}</small></span></div>`;
    if (l.sample) return '<div class="detail-status"><span>ⓘ</span><span><b>Sample listing · illustrative only</b><small>Shown for demonstration. Not live inventory, an offer, or verified property information.</small></span></div>';
    return `<div class="detail-status"><span>✓</span><span><b>Approved in RAQBO review</b><small>Published ${esc(fmtDay(l.publishedAt))}. Approval is a moderation step, not a title or legal verification.</small></span></div>`;
  }
  /* ---------- Reviews & star ratings (real-time) ---------- */
  const RATING_WORDS = ['', 'Terrible', 'Poor', 'Average', 'Good', 'Excellent'];
  const STAR_PATH = 'M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';
  const starsHTML = (v, size = '') => {
    v = Math.max(0, Math.min(5, +v || 0)); const px = size === 'lg' ? 24 : size === 'sm' ? 14 : 17; const gap = size === 'lg' ? 4 : 2;
    const row = (cls) => `<span class="stars-row ${cls}">${('<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" aria-hidden="true"><path d="' + STAR_PATH + '"/></svg>').repeat(5)}</span>`;
    const fill = Math.floor(v) * (px + gap) + (v % 1) * px;
    return `<span class="stars" style="--gap:${gap}px" role="img" aria-label="${v.toFixed(1)} out of 5 stars">${row('bg')}<span class="stars-fill" style="width:${fill.toFixed(1)}px">${row('fg')}</span></span>`;
  };
  const ratingOf = (id) => (db.ratings && db.ratings[id]) || null;
  const rv = { listingId: null, list: [], unsub: null, timer: null, sort: 'new', draft: null, loading: false, error: '' };
  const myId = () => (db.session && db.session.userId) || null;
  const relTime = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)} day${Math.round(s / 86400) === 1 ? '' : 's'} ago`; return fmtDay(t);
  };
  function updateRatingFromList() {
    if (!rv.listingId) return;
    const n = rv.list.length; db.ratings = db.ratings || {};
    if (n) db.ratings[rv.listingId] = { avg: Math.round((rv.list.reduce((a, r) => a + r.rating, 0) / n) * 10) / 10, count: n }; else delete db.ratings[rv.listingId];
  }
  function ratingLinkHTML(id) {
    const r = ratingOf(id);
    return r ? `${starsHTML(r.avg)} <b>${r.avg.toFixed(1)}</b> <span>· ${r.count} review${r.count === 1 ? '' : 's'}</span>` : `${starsHTML(0)} <span>No reviews yet — be the first</span>`;
  }
  function reviewsHTML(l) {
    const box = (inner) => `<div class="rv-head"><h2>Reviews &amp; ratings</h2><span class="rv-live" title="New reviews appear instantly"><i></i> Live</span></div>${inner}`;
    if (db.reviewsUnavailable) return box('<p class="form-hint">Reviews are being set up. (Admin: run <b>update_4_reviews.sql</b> in the Supabase SQL Editor.)</p>');
    if (l.status !== 'published') return box('<p class="form-hint">Reviews open once this listing is approved and published.</p>');
    if (rv.loading && !rv.list.length) return box('<div class="skeleton" style="height:140px;border-radius:14px"></div>');
    const n = rv.list.length; const avg = n ? rv.list.reduce((a, r) => a + r.rating, 0) / n : 0;
    const dist = [5, 4, 3, 2, 1].map((s) => [s, rv.list.filter((r) => r.rating === s).length]);
    const me = myId(); const mine = me ? rv.list.find((r) => r.userId === me) : null;
    const own = me && l.ownerId && l.ownerId === me;
    const d = rv.draft || { rating: mine ? mine.rating : 0, comment: mine ? mine.comment : '', open: false };
    let form;
    if (!db.session) form = `<div class="rv-cta"><div><b>Been to this property?</b><span>Share your experience to help other buyers and renters.</span></div><button type="button" class="button button-primary" data-rv="signin">Sign in to write a review</button></div>`;
    else if (own) form = '<p class="form-hint rv-own">This is your listing, so you can’t review it. Reviews from visitors will appear here in real time.</p>';
    else if (mine && !d.open) form = `<div class="rv-cta"><div><b>You reviewed this property</b><span>${starsHTML(mine.rating)} ${esc(RATING_WORDS[mine.rating])}</span></div><button type="button" class="button button-outline" data-rv="edit">Edit your review</button></div>`;
    else form = `<form class="rv-form" data-rv-form novalidate>
        <b class="rv-form-title">${mine ? 'Edit your review' : 'Write a review'}</b>
        <div class="rv-picker" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((s) => `<button type="button" role="radio" aria-checked="${d.rating === s}" class="${s <= d.rating ? 'on' : ''}" data-star="${s}" aria-label="${s} star${s === 1 ? '' : 's'} — ${RATING_WORDS[s]}">★</button>`).join('')}<span class="rv-pick-word">${d.rating ? RATING_WORDS[d.rating] : 'Tap a star to rate'}</span></div>
        <textarea name="comment" maxlength="1000" placeholder="What did you like or dislike? Location, condition, owner, value for money…">${esc(d.comment)}</textarea>
        <div class="form-error" hidden></div>
        <div class="rv-form-actions">${mine ? '<button type="button" class="link-button link-danger" data-rv="delete-mine">Delete my review</button>' : '<span></span>'}<div>${mine ? '<button type="button" class="button button-outline" data-rv="cancel">Cancel</button>' : ''}<button type="submit" class="button button-primary">${mine ? 'Update review' : 'Post review'}</button></div></div>
      </form>`;
    const sorted = rv.list.slice().sort((a, b) => rv.sort === 'high' ? b.rating - a.rating || b.createdAt - a.createdAt : rv.sort === 'low' ? a.rating - b.rating || b.createdAt - a.createdAt : b.createdAt - a.createdAt);
    const items = sorted.map((r) => {
      const ini = String(r.name || 'R').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
      const canDel = (me && r.userId === me) || db.isAdmin;
      return `<article class="rv-item ${r.fresh ? 'is-new' : ''}" data-review="${esc(r.id)}"><span class="rv-avatar">${esc(ini)}</span><div class="rv-body">
        <div class="rv-top"><b>${esc(r.name || 'RAQBO user')}</b>${me && r.userId === me ? '<span class="rv-you">You</span>' : ''}<span class="rv-date" title="${esc(fmtDate(r.createdAt))}">${esc(relTime(r.createdAt))}${r.updatedAt - r.createdAt > 60000 ? ' · edited' : ''}</span></div>
        <div class="rv-stars">${starsHTML(r.rating, 'sm')} <span>${esc(RATING_WORDS[r.rating])}</span></div>
        <p>${esc(r.comment)}</p>${canDel && !(me && r.userId === me) ? '<button type="button" class="link-button link-danger rv-del" data-rv="delete">Remove (admin)</button>' : ''}</div></article>`;
    }).join('');
    return box(`<div class="rv-summary">
        <div class="rv-score"><b>${n ? avg.toFixed(1) : '–'}</b>${starsHTML(avg, 'lg')}<span>${n ? `${n} review${n === 1 ? '' : 's'}` : 'No reviews yet'}</span></div>
        <div class="rv-dist">${dist.map(([s, c]) => `<div><span>${s} ★</span><div class="rv-bar"><i style="width:${n ? (c / n) * 100 : 0}%"></i></div><small>${c}</small></div>`).join('')}</div>
      </div>
      ${form}
      ${rv.error ? `<p class="form-hint rv-err">${esc(rv.error)}</p>` : ''}
      ${n ? `<div class="rv-list-head"><b>${n} review${n === 1 ? '' : 's'}</b><label>Sort <select data-rv-sort><option value="new" ${rv.sort === 'new' ? 'selected' : ''}>Newest</option><option value="high" ${rv.sort === 'high' ? 'selected' : ''}>Highest rated</option><option value="low" ${rv.sort === 'low' ? 'selected' : ''}>Lowest rated</option></select></label></div><div class="rv-list">${items}</div>`
        : '<div class="rv-empty"><span>★</span><b>No reviews yet</b><small>Be the first to share your experience with this property.</small></div>'}`);
  }
  function renderReviews() {
    if (!pp.el || pp.el.hidden || pp.id !== rv.listingId) return; const l = byId(rv.listingId); if (!l) return;
    const sec = $('[data-reviews]', pp.el); if (!sec) return;
    const ta = $('textarea[name=comment]', sec); if (ta && rv.draft) rv.draft.comment = ta.value;
    const focused = document.activeElement === ta; const caret = focused ? ta.selectionStart : 0;
    sec.innerHTML = reviewsHTML(l);
    const link = $('.pp-rating-link', pp.el); if (link) link.innerHTML = ratingLinkHTML(l.id);
    if (focused) { const t = $('textarea[name=comment]', sec); if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(caret, caret); } }
  }
  async function fetchReviews(markNew) {
    const id = rv.listingId; if (!id) return;
    const before = new Set(rv.list.map((r) => r.id));
    try {
      const list = await backend.listReviews(id); if (rv.listingId !== id) return;
      rv.list = list.map((r) => ({ ...r, fresh: markNew && before.size + 1 > 0 && !before.has(r.id) })); rv.error = '';
    } catch (err) { rv.error = err.message; }
    rv.loading = false; updateRatingFromList(); renderReviews();
    if (markNew) setTimeout(() => { rv.list.forEach((r) => { r.fresh = false; }); $$('.rv-item.is-new', pp.el || document).forEach((x) => x.classList.remove('is-new')); }, 2500);
  }
  function reviewsOpen(l) {
    reviewsClose(); rv.listingId = l.id; rv.list = []; rv.draft = null; rv.error = ''; rv.sort = 'new';
    if (l.status !== 'published' || db.reviewsUnavailable) { renderReviews(); return; }
    rv.loading = true; renderReviews(); fetchReviews(false);
    try { rv.unsub = backend.subscribeReviews(l.id, () => { clearTimeout(rv.timer); rv.timer = setTimeout(() => fetchReviews(true), 250); }); } catch { rv.unsub = null; }
  }
  function reviewsClose() {
    clearTimeout(rv.timer); if (rv.unsub) { try { rv.unsub(); } catch { /* ignore */ } } rv.unsub = null; rv.listingId = null;
  }
  async function reviewsClick(e) {
    const star = e.target.closest('[data-star]');
    if (star) { const ta = $('textarea[name=comment]', pp.el); rv.draft = { ...(rv.draft || {}), open: true, rating: +star.dataset.star, comment: ta ? ta.value : (rv.draft && rv.draft.comment) || '' }; renderReviews(); return true; }
    const a = e.target.closest('[data-rv]'); if (!a) return false;
    const l = byId(rv.listingId); if (!l) return true; const me = myId(); const mine = me ? rv.list.find((r) => r.userId === me) : null;
    const act = a.dataset.rv;
    if (act === 'signin') requireSignIn(() => { const p = byId(l.id); if (p && pp.id === p.id) renderReviews(); });
    else if (act === 'edit') { rv.draft = { open: true, rating: mine.rating, comment: mine.comment }; renderReviews(); const t = $('textarea[name=comment]', pp.el); if (t) t.focus(); }
    else if (act === 'cancel') { rv.draft = null; renderReviews(); }
    else if (act === 'delete-mine' || act === 'delete') {
      const target = act === 'delete' ? rv.list.find((r) => r.id === a.closest('[data-review]').dataset.review) : mine; if (!target) return true;
      if (a.dataset.confirm !== '1') { a.dataset.confirm = '1'; a.textContent = 'Tap again to delete'; setTimeout(() => { if (a.isConnected) { a.dataset.confirm = ''; a.textContent = act === 'delete' ? 'Remove (admin)' : 'Delete my review'; } }, 3000); return true; }
      try { await backend.deleteReview(target.id); rv.draft = null; rv.list = rv.list.filter((r) => r.id !== target.id); updateRatingFromList(); renderReviews(); renderGridSoon(); toast('Review deleted.'); } catch (err) { toast(err.message); }
    }
    return true;
  }
  async function reviewsSubmit(e) {
    const f = e.target.closest('[data-rv-form]'); if (!f) return false; e.preventDefault();
    const l = byId(rv.listingId); if (!l) return true; const me = myId(); const mine = me ? rv.list.find((r) => r.userId === me) : null;
    const rating = (rv.draft && rv.draft.rating) || 0; const comment = f.comment.value.trim(); const errs = [];
    if (!rating) errs.push(['comment', 'Choose a star rating.']);
    if (comment.length < 3) errs.push(['comment', 'Write a short comment (at least 3 characters).']);
    if (showErrors(f, errs)) return true;
    if (!isComplete()) { requireSignIn(() => renderReviews()); return true; }
    // Show the review straight away; the server copy replaces it a moment later
    const backup = rv.list.slice(); const now = Date.now();
    const temp = { id: mine ? mine.id : 'tmp-' + now, userId: me, name: (db.session && db.session.name) || 'You', rating, comment, createdAt: mine ? mine.createdAt : now, updatedAt: now, fresh: true };
    rv.list = mine ? rv.list.map((r) => (r.id === mine.id ? temp : r)) : [temp, ...rv.list]; rv.draft = null; updateRatingFromList(); renderReviews();
    toast(mine ? 'Your review was updated.' : 'Thanks! Your review is live.');
    try {
      await backend.saveReview(l.id, rating, comment, mine ? mine.id : null);
      await fetchReviews(false); renderGridSoon();
    } catch (err) { rv.list = backup; rv.draft = { open: true, rating, comment }; updateRatingFromList(); renderReviews(); const f2 = $('[data-rv-form]', pp.el); if (f2) showErrors(f2, [['comment', err.message]]); else toast(err.message); }
    return true;
  }
  let gridTimer; const renderGridSoon = () => { clearTimeout(gridTimer); gridTimer = setTimeout(() => { if (typeof renderGrid === 'function') renderGrid(); }, 50); };
  document.addEventListener('change', (e) => { const s = e.target.closest('[data-rv-sort]'); if (s && pp.el && pp.el.contains(s)) { rv.sort = s.value; renderReviews(); } });
  document.addEventListener('input', (e) => { const t = e.target.closest('[data-rv-form] textarea'); if (t) rv.draft = { ...(rv.draft || { rating: 0 }), open: true, comment: t.value }; });
  setInterval(() => { if (pp.el && !pp.el.hidden && rv.list.length) $$('.rv-date', pp.el).forEach((d, i) => { const r = rv.list.find((x) => x.id === d.closest('[data-review]').dataset.review); if (r) d.firstChild.textContent = relTime(r.createdAt) + (r.updatedAt - r.createdAt > 60000 ? ' · edited' : ''); }); }, 60000);


  /* ---------- Full property page (16:9 media player + details) ---------- */
  const pp = { el: null, id: null, idx: 0, items: [], auto: true, timer: null };
  const SLIDE_MS = 5000;
  const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  function ppSchedule() {
    clearTimeout(pp.timer); pp.timer = null; if (!pp.el || pp.el.hidden) return;
    const player = $('.pp-player', pp.el); if (!player) return;
    const on = pp.auto && pp.items.length > 1; const it = pp.items[pp.idx];
    player.classList.toggle('is-playing', on && it && it.kind !== 'video');
    const btn = $('[data-pp=play]', pp.el); if (btn) { btn.textContent = pp.auto ? '❚❚' : '▶'; btn.setAttribute('aria-label', pp.auto ? 'Pause slideshow' : 'Play slideshow'); btn.title = btn.getAttribute('aria-label'); }
    const bar = $('.pp-progress i', pp.el); if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
    if (!on || !it) return;
    if (it.kind === 'video') { const v = $('video', pp.el); if (v) v.onended = () => { if (pp.auto) ppShow(pp.idx + 1); }; return; }
    pp.timer = setTimeout(() => { if (pp.el && !pp.el.hidden) ppShow(pp.idx + 1); }, SLIDE_MS);
  }
  // On the live site share /p/<ref> (rich WhatsApp/Facebook preview + Google page); elsewhere the in-page link
  const listingLink = (id) => { const l = byId(id); if (LIVE && /^https?:$/.test(location.protocol) && l && l.ref && !/^RQ-LST-S/.test(l.ref) && CFG.prettyLinks !== false) return `${location.origin}/p/${encodeURIComponent(l.ref)}`; return `${location.origin}${location.pathname}#property/${encodeURIComponent(id)}`; };
  // Instalment (EMI) estimate — monthly payment for a bank/developer plan
  const emiCalc = (price, downPct, years, rate) => { const P = price * (1 - downPct / 100); const n = years * 12; const r = rate / 1200; return r ? (P * r * (1 + r) ** n) / ((1 + r) ** n - 1) : P / n; };
  function emiHTML(l) {
    return `<details class="pp-emi"><summary>${ICON.area ? '' : ''}<span class="pl-ic">${DI(DIC.bank, 16)} <span>Instalment calculator</span></span><small>Estimate the monthly payment</small></summary>
      <form class="pp-emi-form" data-emi="${esc(l.price)}" onsubmit="return false">
        <label>Down payment <output data-emi-out="down">20%</output><input type="range" name="down" min="0" max="80" step="5" value="20"></label>
        <label>Years <output data-emi-out="years">10</output><input type="range" name="years" min="1" max="25" step="1" value="10"></label>
        <label>Yearly profit / interest rate <output data-emi-out="rate">16%</output><input type="range" name="rate" min="0" max="30" step="0.5" value="16"></label>
        <div class="pp-emi-result"><small>Monthly instalment</small><b data-emi-monthly>—</b><span data-emi-sub></span></div>
        <p class="pp-emi-note">Estimate only — ask your bank or the developer for an exact plan. Not financial advice.</p>
      </form></details>`;
  }
  function emiUpdate(f) {
    const price = +f.dataset.emi; const down = +f.down.value; const years = +f.years.value; const rate = +f.rate.value; const m = emiCalc(price, down, years, rate);
    $('[data-emi-out=down]', f).textContent = down + '%'; $('[data-emi-out=years]', f).textContent = years + (years === 1 ? ' year' : ' years'); $('[data-emi-out=rate]', f).textContent = rate + '%';
    $('[data-emi-monthly]', f).textContent = fmtPrice(Math.round(m));
    $('[data-emi-sub]', f).textContent = `Down payment ${fmtPrice(Math.round(price * down / 100))} · total paid ${fmtPrice(Math.round(m * years * 12 + price * down / 100))}`;
  }
  document.addEventListener('input', (e) => { const f = e.target.closest('form[data-emi]'); if (f) emiUpdate(f); });
  document.addEventListener('toggle', (e) => { if (e.target.matches && e.target.matches('details.pp-emi') && e.target.open) emiUpdate($('form[data-emi]', e.target)); }, true);
  const perUnit = (l) => { const p = ppm(l); if (p) return `${fmtPrice(p)} per marla`; return l.size > 0 && l.purpose !== 'rent' ? `${fmtPrice(Math.round(l.price / l.size))} per ${l.sizeUnit}` : ''; };
  const mapsLink = (l) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.lat != null && l.lng != null ? `${l.lat},${l.lng}` : `${l.area}, ${l.city}, Pakistan`)}`;
  function ppShell() {
    if (pp.el) return pp.el;
    pp.el = document.createElement('div'); pp.el.className = 'pp'; pp.el.setAttribute('role', 'dialog'); pp.el.setAttribute('aria-modal', 'true'); pp.el.hidden = true;
    document.body.append(pp.el);
    pp.el.addEventListener('click', ppClick);
    return pp.el;
  }
  function ppShow(i) {
    const items = pp.items; if (!items.length) return;
    pp.idx = (i + items.length) % items.length; const it = items[pp.idx]; const stage = $('[data-stage]', pp.el);
    $$('video', stage).forEach((v) => v.pause());
    if (it.kind === 'video') stage.innerHTML = `<video class="pp-video" controls playsinline preload="metadata" ${mediaAttr(it)}></video>`;
    else stage.innerHTML = `<div class="pp-backdrop" ${mediaAttr(it, true)}></div><img class="pp-img" alt="Photo ${pp.idx + 1} of ${esc(byId(pp.id).title)}" ${mediaAttr(it)}>`;
    const img = $('.pp-img', stage); if (img) img.addEventListener('error', () => { stage.innerHTML = '<div class="pp-empty">Photo unavailable right now</div>'; });
    hydrate(stage);
    const c = $('[data-count]', pp.el); if (c) c.textContent = `${pp.idx + 1} / ${items.length}`;
    $$('.pp-thumb', pp.el).forEach((t) => { const on = +t.dataset.i === pp.idx; t.classList.toggle('active', on); if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); });
    ppSchedule();
  }
  function openDetails(id, opts = {}) {
    const l = byId(id); if (!l) return;
    if (pp.el && !pp.el.hidden && pp.id === id) { closeModal(); return; }
    closeModal();
    const el = ppShell(); pp.id = id; pp.items = [...l.photos, ...l.videos]; pp.auto = !reduceMotion();
    const fav = db.favorites.includes(l.id); const live = l.status === 'published'; const rent = l.purpose === 'rent';
    const roleText = l.role === 'Owner' ? 'Direct owner' : l.role; const typeText = l.type === 'Plot' ? 'Plot / land' : l.type;
    const similar = db.listings.filter((x) => x.id !== l.id && x.status === 'published' && (x.type === l.type || x.city === l.city)).sort((a, b) => (b.type === l.type) - (a.type === l.type) || (b.publishedAt || 0) - (a.publishedAt || 0)).slice(0, 3);
    const facts = [['Purpose', rent ? 'For rent' : 'For sale'], ['Property type', typeText], ['Size', fmtSize(l)], l.beds > 0 ? ['Bedrooms', l.beds] : null, l.baths > 0 ? ['Bathrooms', l.baths] : null, ['City', l.city], ['Area / society', l.area], ['Advertiser', roleText], ['Listed', fmtDay(l.publishedAt || l.createdAt)], l.ref ? ['Reference', l.ref] : null, ['Media', `${l.photos.length} photo${l.photos.length === 1 ? '' : 's'}${l.videos.length ? ` · ${l.videos.length} video${l.videos.length === 1 ? '' : 's'}` : ''}`]].filter(Boolean);
    const key = [l.beds > 0 ? [ICON.bed, l.beds, l.beds === 1 ? 'Bedroom' : 'Bedrooms'] : null, l.baths > 0 ? [ICON.bath, l.baths, l.baths === 1 ? 'Bathroom' : 'Bathrooms'] : null, [ICON.area, fmtSize(l), 'Size'], [ICON.pin, typeText, 'Type']].filter(Boolean);
    const initials = String(l.ownerName || 'R').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    el.setAttribute('aria-label', l.title);
    el.innerHTML = `
      <header class="pp-top"><div class="pp-top-in">
        <button type="button" class="pp-back" data-pp="close" aria-label="Back to properties">← <span>Back to properties</span></button>
        <div class="pp-top-actions"><button type="button" class="pp-icon-btn" data-pp="share">Share</button>${live ? `<button type="button" class="pp-icon-btn ${fav ? 'is-saved' : ''}" data-pp="fav">${fav ? '♥ Saved' : '♡ Save'}</button>` : ''}</div>
      </div></header>
      <div class="pp-wrap">
        <div class="pp-grid">
          <section class="pp-main">
            <div class="pp-player">
              <div class="pp-stage" data-stage>${pp.items.length ? '' : '<div class="pp-empty">No photos supplied</div>'}</div>
              ${pp.items.length > 1 ? '<button type="button" class="pp-nav pp-prev" data-pp="prev" aria-label="Previous photo">‹</button><button type="button" class="pp-nav pp-next" data-pp="next" aria-label="Next photo">›</button>' : ''}
              ${pp.items.length ? `<span class="pp-count" data-count>1 / ${pp.items.length}</span><button type="button" class="pp-full" data-pp="full" aria-label="Full screen" title="Full screen">⤢</button>` : ''}
              ${pp.items.length > 1 ? '<button type="button" class="pp-play" data-pp="play" aria-label="Pause slideshow" title="Pause slideshow">❚❚</button><div class="pp-progress" aria-hidden="true"><i></i></div>' : ''}
            </div>
            ${pp.items.length > 1 ? `<div class="pp-thumbs">${pp.items.map((m, i) => `<button type="button" class="pp-thumb ${i ? '' : 'active'}" data-i="${i}" aria-label="Show ${m.kind} ${i + 1}">${m.kind === 'video' ? '<span class="pp-thumb-video">▶ Video</span>' : `<span class="pp-thumb-img" ${mediaAttr(m, true)}></span>`}</button>`).join('')}</div>` : ''}
            <div class="pp-badges"><span class="pp-badge dark">${rent ? 'FOR RENT' : 'FOR SALE'}</span>${l.role === 'Owner' ? '<span class="pp-badge gold">DIRECT OWNER</span>' : ''}${l.videos.length ? '<span class="pp-badge">▶ VIDEO TOUR</span>' : ''}${l.sample ? '<span class="pp-badge">SAMPLE</span>' : ''}${vfDetailBadge(l)}</div>
            <h1 class="pp-title">${esc(l.title)}</h1>
            <div class="pp-loc">${ICON.pin} ${esc(l.area)}, ${esc(l.city)} · <a href="${esc(mapsLink(l))}" target="_blank" rel="noopener">View area on map</a></div>
            ${live ? `<button type="button" class="pp-rating-link" data-pp="reviews">${ratingLinkHTML(l.id)}</button>` : ''}
            <div class="pp-price-mobile"><b>${fmtPrice(l.price)}</b>${rent ? ' <small>/ month</small>' : ''}</div>
            <div class="pp-keyfacts">${key.map(([ic, val, lab]) => `<div><span class="pp-kf-ic">${ic}</span><b>${esc(val)}</b><small>${esc(lab)}</small></div>`).join('')}</div>
            <section class="pp-section"><h2>About this property</h2><p class="pp-desc">${esc(l.description)}</p></section>
            <section class="pp-section pp-reviews" id="pp-reviews" data-reviews></section>
            <section class="pp-section"><h2>Property details</h2><dl class="pp-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>
            ${auDetailBox(l)}
            ${v3DetailBox(l)}${v3pBox(l)}${v3iBox(l)}${v3aLink(l) ? `<section class="pp-section">${v3aLink(l)}</section>` : ''}
            ${dlDetailBox(l)}
            ${coreDirectBox(l)}
            ${vfDetailBox(l)}
            <section class="pp-section">${corePassportBtn(l)}</section>
            <section class="pp-section">${statusBox(l)}<p class="pp-disclaimer">Listing content is provided by the advertiser. A direct-owner label is not a guarantee of legal title. RAQBO is not a government registry and never collects deposits or token money.</p></section>
          </section>
          <aside class="pp-side"><div class="pp-card">
            <small class="pp-card-label">${rent ? 'MONTHLY RENT' : 'ASKING PRICE'}</small>
            <div class="pp-card-price">${fmtPrice(l.price)}${rent ? ' <small>/ month</small>' : ''}</div>
            ${perUnit(l) ? `<div class="pp-card-sub">≈ ${esc(perUnit(l))}</div>` : ''}
            ${!rent && l.price > 0 ? emiHTML(l) : ''}
            <button type="button" class="pp-adv" data-adv="${esc(String((!l.sample && l.ownerId) || ''))}" aria-label="See all properties from this advertiser"><span class="pp-avatar">${esc(initials)}</span><div><b>${esc(l.ownerName || 'Advertiser')}</b><small>${esc(roleText)}</small>${gwFoundingChip(l.ownerId)}${coreIdChip(l.ownerId)}</div><span class="pp-adv-go" aria-hidden="true">${DI('<path d="M9 5l7 7-7 7"></path>', 16)}</span></button>
            ${live ? `${dlContactAllowed(l) ? '<button type="button" class="button button-whatsapp pp-wide" data-pp="contact">Contact on WhatsApp</button>' : '<p class="form-hint">Confidential investor opportunity — offers and questions go through RAQBO.</p>'}
            ${dlContactAllowed(l) && !(db.session && l.ownerId && l.ownerId === db.session.userId) ? `<button type="button" class="button button-outline pp-wide pp-chat" data-chat="listing" data-id="${esc(l.id)}">${DI(DIC.chat, 16)} Message ${l.ownerId ? 'the advertiser' : 'RAQBO'}</button>` : ''}
            <div class="pp-card-row"><button type="button" class="button button-outline ${fav ? 'is-saved' : ''}" data-pp="fav">${fav ? '♥ Saved' : '♡ Save'}</button><button type="button" class="button button-outline" data-pp="share">Share</button></div>
            <button type="button" class="link-button pp-report" data-pp="report">Report this property</button>` : '<p class="form-hint">Contact options appear once the listing is approved.</p>'}
            <div class="pp-tips"><b>Stay safe</b><ul><li>Visit the property before paying anything.</li><li>Check ownership documents and the seller’s identity.</li><li>Never send token money to unknown accounts.</li></ul></div>
          </div></aside>
        </div>
        ${similar.length ? `<section class="pp-similar"><h2>Similar properties</h2><div class="property-grid">${similar.map(cardHTML).join('')}</div></section>` : ''}
      </div>`;
    el.hidden = false; document.body.classList.add('pp-open'); el.scrollTop = 0;
    hydrate(el); ppShow(0); applyBrandIcons(el); reviewsOpen(l);
    const player = $('.pp-player', el);
    if (player && pp.items.length > 1) {
      let x0 = null, y0 = null;
      player.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      player.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) ppShow(pp.idx + (dx < 0 ? 1 : -1)); });
      player.addEventListener('play', () => { clearTimeout(pp.timer); player.classList.remove('is-playing'); }, true);
    }
    try {
      const h = '#property/' + encodeURIComponent(id);
      if (opts.fromHistory) { /* already at this URL */ } else if (location.hash.startsWith('#property/')) history.replaceState({ pp: id }, '', h); else history.pushState({ pp: id }, '', h);
    } catch { /* ignore */ }
    setTimeout(() => { const b = $('.pp-back', el); if (b) b.focus({ preventScroll: true }); }, 30);
  }
  function closeDetails(opts = {}) {
    if (!pp.el || pp.el.hidden) return;
    $$('video', pp.el).forEach((v) => v.pause()); clearTimeout(pp.timer); pp.el.hidden = true; document.body.classList.remove('pp-open'); pp.id = null; reviewsClose();
    if (!opts.fromHistory) { try { if (history.state && history.state.pp) history.back(); else if (location.hash.startsWith('#property/')) history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
    renderGrid();
  }
  const SH_ICON = (p) => `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  async function copyText(text, input) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
    try { const t = input || Object.assign(document.createElement('textarea'), { value: text }); if (!input) document.body.append(t); t.select(); t.setSelectionRange(0, 99999); const ok = document.execCommand('copy'); if (!input) t.remove(); return ok; } catch { return false; }
  }
  function shareListing(l) {
    const url = listingLink(l.id); const price = `${fmtPrice(l.price)}${l.purpose === 'rent' ? ' / month' : ''}`;
    const text = `${l.title} — ${price} · ${l.area}, ${l.city} | RAQBO`;
    const card = openModal(`<div class="eyebrow"><span></span> SHARE PROPERTY</div><h2>Share this property</h2>
      <div class="sh-prop"><span class="sh-thumb" ${mediaAttr(l.photos[0], true)}></span><div><b>${esc(l.title)}</b><small>${esc(price)} · ${esc(l.area)}, ${esc(l.city)}</small></div></div>
      <label class="sh-label" for="sh-url">Property link</label>
      <div class="sh-link"><input id="sh-url" readonly value="${esc(url)}"><button type="button" class="button button-primary" data-sh="copy">Copy link</button></div>
      <p class="form-hint sh-note">Anyone you send this link to can open this property. If they don’t have a RAQBO account yet, they create one first and then land straight on this page.</p>
      <div class="sh-apps">
        <a class="sh-app" href="https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}" target="_blank" rel="noopener">${SH_ICON('<path d="M20 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20l1.2-4.4A8.4 8.4 0 1 1 20 11.5Z"/>')}<span>WhatsApp</span></a>
        <a class="sh-app" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener">${SH_ICON('<path d="M15 8h-2a2 2 0 0 0-2 2v11M8 13h6"/>')}<span>Facebook</span></a>
        <a class="sh-app" href="mailto:?subject=${encodeURIComponent('Property on RAQBO: ' + l.title)}&body=${encodeURIComponent(text + '\n\n' + url)}">${SH_ICON('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')}<span>Email</span></a>
        <a class="sh-app" href="sms:?&body=${encodeURIComponent(text + ' ' + url)}">${SH_ICON('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 21 12Z"/><path d="M8 11h8M8 14h5"/>')}<span>SMS</span></a>
        ${navigator.share ? `<button type="button" class="sh-app" data-sh="more">${SH_ICON('<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>')}<span>More</span></button>` : ''}
      </div>`, { label: 'Share property' });
    hydrate(card); applyBrandIcons(card);
    const input = $('#sh-url', card); input.addEventListener('focus', () => input.select());
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-sh]'); if (!b) return;
      if (b.dataset.sh === 'copy') {
        const ok = await copyText(url, input);
        if (ok) { b.textContent = 'Copied ✓'; b.classList.add('is-copied'); toast('Link copied — paste it in any chat to share.'); setTimeout(() => { if (b.isConnected) { b.textContent = 'Copy link'; b.classList.remove('is-copied'); } }, 2500); }
        else { input.focus(); input.select(); toast('Press Ctrl+C (or long-press → Copy) to copy the link.'); }
      } else if (b.dataset.sh === 'more') { try { await navigator.share({ title: l.title, text, url }); } catch { /* cancelled */ } }
    });
  }
  async function ppClick(e) {
    const l = byId(pp.id); if (!l) return;
    if (e.target.closest('[data-reviews]') && await reviewsClick(e)) return;
    const card = e.target.closest('.property-card');
    if (card) { if (e.target.closest('[data-share]')) { const sl = byId(card.dataset.id); if (sl) shareListing(sl); return; } if (e.target.closest('[data-fav]')) { e.stopPropagation(); await toggleFav(card.dataset.id); return; } if (e.target.closest('[data-open]')) openDetails(card.dataset.id); return; }
    const t = e.target.closest('.pp-thumb'); if (t) { ppShow(+t.dataset.i); return; }
    const a = e.target.closest('[data-pp]'); if (!a) return;
    const act = a.dataset.pp;
    if (act === 'close') closeDetails();
    else if (act === 'prev') ppShow(pp.idx - 1);
    else if (act === 'next') ppShow(pp.idx + 1);
    else if (act === 'full') { const st = $('.pp-player', pp.el); try { if (document.fullscreenElement) await document.exitFullscreen(); else await st.requestFullscreen(); } catch { toast('Full screen is not available here.'); } }
    else if (act === 'share') shareListing(l);
    else if (act === 'play') { pp.auto = !pp.auto; if (pp.auto && pp.items[pp.idx] && pp.items[pp.idx].kind !== 'video') ppShow(pp.idx + 1); else ppSchedule(); }
    else if (act === 'reviews') { const r = $('#pp-reviews', pp.el); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (act === 'contact') requireSignIn(() => openContact(l.id));
    else if (act === 'report') openReport(l.id);
    else if (act === 'fav') { const on = await toggleFav(l.id); $$('[data-pp=fav]', pp.el).forEach((b) => { b.classList.toggle('is-saved', on); b.textContent = on ? '♥ Saved' : '♡ Save'; }); }
  }
  document.addEventListener('submit', (e) => { if (pp.el && pp.el.contains(e.target) && e.target.closest('[data-rv-form]')) reviewsSubmit(e); });
  document.addEventListener('keydown', (e) => {
    if (!pp.el || pp.el.hidden || $('.modal-backdrop') || /input|textarea|select/i.test((e.target.tagName || ''))) return;
    if (e.key === 'ArrowLeft') ppShow(pp.idx - 1); else if (e.key === 'ArrowRight') ppShow(pp.idx + 1);
  });
  window.addEventListener('popstate', () => {
    const m = location.hash.match(/^#property\/(.+)$/);
    if (m) { const id = decodeURIComponent(m[1]); if (byId(id)) openDetails(id, { fromHistory: true }); }
    else closeDetails({ fromHistory: true });
  });

  /* ---------- Contact advertiser (presentation flow) ---------- */
  function openContact(id) {
    const l = byId(id); if (!l) return; const s = db.session || {};
    const card = openModal(`
      <div class="eyebrow"><span></span> CONTACT ADVERTISER</div><h2>Ask about this property</h2>
      <p class="modal-lead">${esc(l.title)} · ${esc(l.area)}, ${esc(l.city)}</p>
      <div class="advertiser-box"><b>${esc(l.ownerName || 'Listing advertiser')}</b><span>${esc(l.role === 'Owner' ? 'Direct owner' : l.role)}</span><span>Phone: ${esc(maskPhone(l.ownerPhone))} — shared after phone verification</span></div>
      <form class="modal-form" novalidate>
        <div class="modal-form-row"><label>Your name<input name="name" value="${esc(s.name || '')}" autocomplete="name"></label><label>Mobile number<input name="phone" value="${esc(s.phone || '')}" inputmode="tel" placeholder="03XX XXXXXXX"></label></div>
        <label>Message<textarea name="message">Hi, I am interested in “${esc(l.title)}”. Is it still available, and when could I arrange a viewing?</textarea></label>
        <label>Preferred contact<select name="via"><option>Phone call</option><option>WhatsApp</option><option>Email</option></select></label>
        <div class="form-error" hidden></div>
        <div class="wa-box"><b>Sent to RAQBO on WhatsApp</b><span>Your message goes to the RAQBO team with this listing’s details. We’ll connect you with the advertiser.</span></div>
        <button class="button button-whatsapp modal-submit" type="submit">Continue on WhatsApp</button>
      </form>
      <button type="button" class="link-button" data-back>← Back to listing</button>`, { label: 'Contact advertiser' });
    $('[data-back]', card).addEventListener('click', () => openDetails(l.id));
    $('form', card).addEventListener('submit', (e) => {
      e.preventDefault(); const f = e.target; const errs = [];
      if (!f.name.value.trim()) errs.push(['name', 'Enter your name.']);
      if (!normPhone(f.phone.value)) errs.push(['phone', 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.']);
      if (f.message.value.trim().length < 10) errs.push(['message', 'Write a short message (at least 10 characters).']);
      if (showErrors(f, errs)) return;
      const link = waLink(waMessage('RAQBO — Property enquiry', [['Listing', l.title], ['Reference', l.ref || l.id], ['Location', `${l.area}, ${l.city}`], ['Price', fmtPrice(l.price) + (l.purpose === 'rent' ? ' / month' : '')], ['Advertiser', l.role === 'Owner' ? 'Direct owner' : l.role], ['Name', f.name.value.trim()], ['Phone', normPhone(f.phone.value)], ['Preferred contact', f.via.value]], f.message.value.trim()));
      const opened = openWhatsApp(link);
      setBody(card, successHTML(opened ? 'WhatsApp is ready — tap Send' : 'Open WhatsApp to send', `<p>${opened ? 'WhatsApp opened in a new tab with your message and the listing details. Press <b>Send</b> and the RAQBO team will connect you with the advertiser.' : 'Your browser blocked the new tab. Tap <b>Open WhatsApp</b> below, then press Send.'}</p>`, '', `<a class="button button-whatsapp" href="${esc(link)}" target="_blank" rel="noopener">Open WhatsApp</a><button type="button" class="button button-outline" data-reopen="${esc(l.id)}">Back to listing</button>`));
    });
    card.addEventListener('click', (e) => { const r = e.target.closest('[data-reopen]'); if (r) openDetails(r.dataset.reopen); });
  }

  /* ---------- Report a property ---------- */
  const REPORT_REASONS = ['Incorrect information', 'Suspicious activity', 'Duplicate listing', 'Other concern'];
  function openReport(id) {
    const l = byId(id); if (!l) return; const s = db.session || {};
    const card = openModal(`
      <div class="eyebrow"><span></span> REPORT A PROPERTY</div><h2>What’s wrong with this listing?</h2>
      <p class="modal-lead">${esc(l.title)} · ${esc(l.area)}, ${esc(l.city)}. Reports go to the RAQBO review team.</p>
      <form class="modal-form" novalidate>
        <fieldset><legend>Reason</legend>${REPORT_REASONS.map((r, i) => `<label class="consent-check"><input type="radio" name="reason" value="${esc(r)}" ${i ? '' : 'checked'}> ${esc(r)}</label>`).join('')}</fieldset>
        <label>Details<textarea name="details" maxlength="3000" placeholder="Tell us what you noticed — e.g. wrong price, photos from another property, asked for advance payment…"></textarea></label>
        <div class="modal-form-row"><label>Your name (optional)<input name="name" maxlength="120" value="${esc(s.name || '')}"></label><label>Mobile (optional)<input name="phone" value="${esc(s.phone || '')}" inputmode="tel" placeholder="03XX XXXXXXX"></label></div>
        <div class="form-error" hidden></div>
        <button class="button button-primary modal-submit" type="submit">Submit report</button>
      </form>
      <button type="button" class="link-button" data-back>← Back to listing</button>`, { label: 'Report a property' });
    $('[data-back]', card).addEventListener('click', () => openDetails(l.id));
    $('form', card).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const reason = f.querySelector('input[name=reason]:checked').value; const errs = [];
      if (reason === 'Other concern' && f.details.value.trim().length < 5) errs.push(['details', 'Please describe the concern.']);
      if (f.phone.value.trim() && !normPhone(f.phone.value)) errs.push(['phone', 'Enter a valid mobile number or leave it empty.']);
      if (showErrors(f, errs)) return;
      const done = busy($('.modal-submit', f), 'Sending…');
      try {
        const ref = await backend.createReport({ listingId: l.id, listingTitle: l.title, reason, details: f.details.value.trim(), reporterName: f.name.value.trim(), reporterPhone: normPhone(f.phone.value) || '' });
        refreshAdmin();
        setBody(card, successHTML('Thank you — report received', '<p>The listing stays visible while the RAQBO team reviews your report.</p>', ref));
      } catch (err) { done(); showErrors(f, [['details', err.message]]); }
    });
  }

  /* ---------- Services & contact enquiries ---------- */
  const SERVICES = { verification: 'Property verification request', legal: 'Legal services enquiry', documents: 'Document preparation and drafting request', registry: 'Registry assistance enquiry', general: 'General enquiry' };
  const SERVICE_HELP = {
    verification: 'Tell us about the property and what you would like checked (e.g. ownership documents, authority to sell, site visit).',
    legal: 'Describe your situation and the kind of property consultation you need. Legal work is handled by qualified professionals.',
    documents: 'Tell us which document you need — e.g. sale agreement, rent agreement, token receipt, power of attorney.',
    registry: 'Share the property location and the procedure you need help with — e.g. transfer, mutation, record copies.',
    general: 'Ask us anything about RAQBO, listing a property, or our services.'
  };
  function openEnquiry(service = '') {
    const s = db.session || {}; const isGeneral = service === 'general';
    const card = openModal(`
      <div class="eyebrow"><span></span> ${isGeneral ? 'CONTACT RAQBO' : 'SERVICE ENQUIRY'}</div><h2>${isGeneral ? 'Talk to our team' : esc(SERVICES[service] || 'Request a service')}</h2>
      <p class="modal-lead" data-help>${esc(SERVICE_HELP[service] || 'Choose a service and tell us what you need.')}</p>
      <form class="modal-form" novalidate>
        <label>Enquiry type<select name="service">${typeof v3sOptions === 'function' ? v3sOptions(service) : Object.entries(SERVICES).map(([k, v]) => `<option value="${k}" ${k === (service || '') ? 'selected' : ''}>${esc(v)}</option>`).join('')}${service ? '' : '<option value="" selected disabled>Select a service…</option>'}</select></label>
        <div class="modal-form-row"><label>Full name<input name="name" maxlength="120" value="${esc(s.name || '')}" autocomplete="name"></label><label>Mobile number<input name="phone" value="${esc(s.phone || '')}" inputmode="tel" placeholder="03XX XXXXXXX"></label></div>
        <div class="modal-form-row"><label>Email (optional)<input name="email" type="email" maxlength="200" autocomplete="email"></label><label>City<select name="city"><option>Lahore</option><option>Islamabad</option><option>Rawalpindi</option><option>Karachi</option><option>Faisalabad</option><option>Multan</option><option>Other</option></select></label></div>
        <label>Property reference or address (optional)<input name="property" maxlength="300" placeholder="e.g. 10 Marla house, Block C, Bahria Town"></label>
        <label>How can we help?<textarea name="message" maxlength="3000"></textarea></label>
        <label>Preferred contact<select name="via"><option>Phone call</option><option>WhatsApp</option><option>Email</option></select></label>
        <label class="consent-check"><input type="checkbox" name="consent"> I agree that RAQBO may contact me about this enquiry.</label>
        <div class="form-error" hidden></div>
        <div class="wa-box"><b>Sent through WhatsApp</b><span>When you tap the button, WhatsApp opens with your details filled in — just press Send. Our team replies on WhatsApp or by your preferred contact method.</span></div>
        <button class="button button-whatsapp modal-submit" type="submit">Continue on WhatsApp</button>
        <small>Services depend on location, professional availability and required approvals.</small>
      </form>`, { label: 'Enquiry' });
    const f = $('form', card);
    f.service.addEventListener('change', () => { $('[data-help]', card).textContent = SERVICE_HELP[f.service.value] || ''; });
    if (typeof v3sEnquiryHook === 'function') v3sEnquiryHook(card, f);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const errs = [];
      if (!f.service.value) errs.push(['service', 'Choose an enquiry type.']);
      if (!f.name.value.trim()) errs.push(['name', 'Enter your name.']);
      if (!normPhone(f.phone.value)) errs.push(['phone', 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.']);
      if (f.email.value.trim() && !validEmail(f.email.value.trim())) errs.push(['email', 'Enter a valid email or leave it empty.']);
      if (f.message.value.trim().length < 10) errs.push(['message', 'Describe what you need (at least 10 characters).']);
      if (!f.consent.checked) errs.push(['consent', 'Please agree to be contacted about this enquiry.']);
      if (typeof v3sValidate === 'function') errs.push(...v3sValidate(f));
      if (showErrors(f, errs)) return;
      const ref = refCode('ENQ');
      const enquiry = { ref, service: f.service.value, name: f.name.value.trim(), phone: normPhone(f.phone.value), email: f.email.value.trim(), city: f.city.value, property: f.property.value.trim(), message: f.message.value.trim(), via: f.via.value, details: typeof v3sDetails === 'function' ? v3sDetails(f) : {} };
      const link = waLink(waMessage(`RAQBO — ${SERVICES[enquiry.service]}`, [['Reference', ref], ['Name', enquiry.name], ['Phone', enquiry.phone], ['Email', enquiry.email], ['City', enquiry.city], ['Property', enquiry.property], ...Object.entries(enquiry.details).map(([k, v]) => [typeof v3sFieldLabel === 'function' ? v3sFieldLabel(k) : k, v]), ['Preferred contact', enquiry.via]], enquiry.message));
      const opened = openWhatsApp(link); // must run directly in the click, before any await, so it isn't blocked
      const done = busy($('.modal-submit', f), 'Opening WhatsApp…');
      try { await backend.createEnquiry(enquiry); refreshAdmin(); } catch { /* the WhatsApp message still carries the full request */ }
      done();
      setBody(card, successHTML(opened ? 'WhatsApp is ready — tap Send' : 'Open WhatsApp to send', `<p>${opened ? 'We opened WhatsApp in a new tab with your request filled in. Press <b>Send</b> to deliver it to the RAQBO team.' : 'Your browser blocked the new tab. Tap the button below to open WhatsApp with your request filled in, then press <b>Send</b>.'}</p><p>Didn’t open? Use the button below, or message us on WhatsApp at +${esc(WA_NUMBER)}.</p>`, ref, `<a class="button button-whatsapp" href="${esc(link)}" target="_blank" rel="noopener">Open WhatsApp</a>`));
    });
  }
  $$('[data-service]').forEach((b) => b.addEventListener('click', () => openEnquiry(b.dataset.service)));

  /* ---------- Sign-in screen (email + password, or Google) ---------- */
  const PK_PHONE_HINT = 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.';
  const isComplete = () => !!(db.session && (db.session.verified || (db.isAdmin && LIVE)));
  function updateAuthUI() { const label = db.session ? 'My account' : 'Sign in'; $$('[data-action=signin]').forEach((b) => { b.textContent = label; }); if (typeof updateMenuTrigger === 'function') updateMenuTrigger(); if (mk.data) { mk.data = null; if (mk.el && !mk.el.hidden) mkLoad().then(() => mkRender(true)); } }
  let oauthError = '';
  try {
    const qs = new URLSearchParams(location.search); const hs = new URLSearchParams(location.hash.slice(1));
    oauthError = hs.get('error_description') || qs.get('error_description') || '';
    if (oauthError && /otp|expired|invalid/i.test((hs.get('error_code') || '') + oauthError)) oauthError = 'LINK:This password reset link has expired or was already used. Please request a new one.';
    if (oauthError) history.replaceState(null, '', location.pathname);
  } catch { /* ignore */ }
  const gate = { el: null, view: 'signin', onDone: null };
  const SOCIAL_HTML = () => { const row = $('.social-row'); return row ? row.innerHTML : ''; };
  const FULL_LOGO = () => ($('.footer-logo') || {}).src || '';
  function gateShell() {
    if (gate.el) return gate.el;
    gate.el = document.createElement('div'); gate.el.className = 'auth-gate'; gate.el.setAttribute('role', 'dialog'); gate.el.setAttribute('aria-modal', 'true'); gate.el.setAttribute('aria-label', 'Sign in to RAQBO');
    gate.el.innerHTML = `<div class="auth-shell">
      <aside class="auth-brand">${FULL_LOGO() ? `<img class="auth-logo" src="${esc(FULL_LOGO())}" alt="RAQBO — Properties, Land, Investment">` : ''}
        <h2>Pakistan’s clearer way to buy, rent and list property.</h2>
        <ul><li><span>✓</span> Listings reviewed by the RAQBO team</li><li><span>✓</span> Direct conversations with owners</li><li><span>✓</span> Verification, legal &amp; registry help on WhatsApp</li></ul>
        <div class="auth-contact"><a href="https://wa.me/${esc(WA_NUMBER)}" target="_blank" rel="noopener">WhatsApp</a> · <a href="tel:+923001223344">UAN 0300 1223344</a> · <a href="mailto:raqbo.official@gmail.com">raqbo.official@gmail.com</a></div>
        <div class="social-row auth-social">${SOCIAL_HTML()}</div></aside>
      <section class="auth-panel"><button type="button" class="auth-close" data-gate-close aria-label="Close — keep browsing">×</button><div class="auth-body" aria-live="polite"></div>
        <p class="auth-foot">By continuing you agree to RAQBO’s <a class="link-button" href="terms.html" target="_blank" rel="noopener">Terms of Use</a> and <a class="link-button" href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p></section></div>`;
    document.body.append(gate.el); return gate.el;
  }
  const googleBtn = '<button type="button" class="button auth-google" data-google><span class="auth-google-mark" aria-hidden="true">G</span> Continue with Google</button><div class="auth-divider"><span>or use your email</span></div>';
  function renderGate(view, msg) {
    gate.view = view; const body = $('.auth-body', gateShell());
    const tabs = (active) => `<div class="auth-tabs" role="tablist"><button type="button" role="tab" class="${active === 'signin' ? 'active' : ''}" data-view="signin">Sign in</button><button type="button" role="tab" class="${active === 'signup' ? 'active' : ''}" data-view="signup">Create account</button></div>`;
    const err = `<div class="form-error" ${msg ? '' : 'hidden'}>${msg ? esc(msg) : ''}</div>`;
    const s = db.session || {};
    const inv = gate.invite;
    const invite = inv ? `<div class="auth-invite"><span class="auth-invite-thumb" ${mediaAttr(inv.photos[0], true)}></span><div><small>A property was shared with you</small><b>${esc(inv.title)}</b><span>${esc(fmtPrice(inv.price))}${inv.purpose === 'rent' ? ' / month' : ''} · ${esc(inv.area)}, ${esc(inv.city)}</span></div></div>` : '';
    if (view === 'signin') body.innerHTML = `${invite}${tabs('signin')}<h1>${inv ? 'Sign in to view it' : 'Welcome back'}</h1><p class="auth-lead">${inv ? 'New to RAQBO? Choose <b>Create account</b> — it takes less than a minute, and the property opens right after.' : 'Sign in with your email and password.'}</p>${googleBtn}
      <form class="modal-form" data-form="signin" novalidate>
        <label>Email<input name="email" type="email" maxlength="200" autocomplete="email" placeholder="you@example.com"></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" placeholder="Your password"></label>
        ${err}<button class="button button-primary modal-submit" type="submit">Sign in</button>
        <p class="form-hint auth-forgot"><button type="button" class="link-button" data-view="forgot">Forgot your password?</button></p></form>`;
    else if (view === 'forgot') body.innerHTML = `<div class="eyebrow"><span></span> RESET PASSWORD</div><h1>Forgot your password?</h1><p class="auth-lead">Enter the email you signed up with and we’ll send you a link to set a new password.</p>
      <form class="modal-form" data-form="forgot" novalidate>
        <label>Email<input name="email" type="email" maxlength="200" autocomplete="email" placeholder="you@example.com" value="${esc(gate.resetEmail || '')}"></label>
        ${err}<button class="button button-primary modal-submit" type="submit">Send reset link</button>
        <button type="button" class="link-button auth-back" data-view="signin">← Back to sign in</button></form>`;
    else if (view === 'forgot-sent') body.innerHTML = `<div class="auth-sent"><span class="auth-sent-icon" aria-hidden="true">✉</span><h1>Check your email</h1>
      <p class="auth-lead">If an account exists for <b>${esc(gate.resetEmail || '')}</b>, we’ve sent a password reset link. Open the email and click the link to choose a new password.</p>
      <p class="form-hint">Can’t find it? Check your Spam or Promotions folder. The link works once and expires after a short time.</p>
      <button type="button" class="button button-primary modal-submit" data-view="signin">Back to sign in</button>
      <button type="button" class="link-button auth-back" data-view="forgot">Send the link again</button></div>`;
    else if (view === 'newpass') body.innerHTML = `<div class="eyebrow"><span></span> RESET PASSWORD</div><h1>Choose a new password</h1><p class="auth-lead">${s.email ? `For <b>${esc(s.email)}</b>. ` : ''}Use at least 8 characters.</p>
      <form class="modal-form" data-form="newpass" novalidate>
        <label>New password<input name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></label>
        <label>Confirm new password<input name="password2" type="password" autocomplete="new-password" placeholder="Type it again"></label>
        ${err}<button class="button button-primary modal-submit" type="submit">Save new password</button></form>`;
    else if (view === 'signup') body.innerHTML = `${invite}${tabs('signup')}<h1>Create your RAQBO account</h1><p class="auth-lead">${inv ? 'Free and quick — the shared property opens as soon as you’re done.' : 'It takes less than a minute.'}</p>${googleBtn}
      <form class="modal-form" data-form="signup" novalidate>
        <label>Full name<input name="name" maxlength="120" autocomplete="name" placeholder="e.g. Ayesha Khan"></label>
        <label>Email<input name="email" type="email" maxlength="200" autocomplete="email" placeholder="you@example.com"></label>
        <label>Mobile number<input name="phone" inputmode="tel" autocomplete="tel" placeholder="03XX XXXXXXX"></label>
        ${locFields({})}
        <label>Password<input name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></label>
        ${err}<button class="button button-primary modal-submit" type="submit">Create account</button></form>`;
    else if (view === 'complete') body.innerHTML = `<div class="eyebrow"><span></span> ALMOST DONE</div><h1>Add your mobile number</h1><p class="auth-lead">One last step to finish your RAQBO account.</p>
      <form class="modal-form" data-form="complete" novalidate>
        <label>Full name<input name="name" maxlength="120" autocomplete="name" value="${esc(s.name || '')}"></label>
        <label>Email<input name="email" value="${esc(s.email || '')}" readonly></label>
        <label>Mobile number<input name="phone" inputmode="tel" autocomplete="tel" placeholder="03XX XXXXXXX" value="${esc(s.phone || '')}"></label>
        ${locFields(s)}
        ${err}<button class="button button-primary modal-submit" type="submit">Continue</button>
        <button type="button" class="link-button" data-signout-gate>Use a different account</button></form>`;
    applyBrandIcons(gate.el); hydrate(body);
    const first = $('input:not([readonly])', body); if (first) setTimeout(() => { if (first.isConnected && !body.contains(document.activeElement)) first.focus({ preventScroll: true }); }, 30);
  }
  function showGate(view, msg) {
    if (admin.el && !admin.el.hidden) return;
    closeModal(); const el = gateShell(); const wasOpen = !el.hidden; el.hidden = false; document.body.classList.add('gate-open');
    const v = view || (db.session ? 'complete' : 'signin');
    // Don't wipe what the person is typing if the same screen is already showing
    if (wasOpen && !msg && $('.auth-body form, .auth-body .auth-sent', el) && (gate.view === v || (!view && (gate.view === 'signup' || gate.view === 'forgot')))) return;
    renderGate(v, msg);
    const x = $('.auth-close', el); if (x) x.hidden = gateRequired();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && gate.el && !gate.el.hidden && !$('.modal-backdrop')) { e.stopImmediatePropagation(); closeGate(); } }, true);
  function hideGate() { if (gate.el) gate.el.hidden = true; document.body.classList.remove('gate-open'); }
  // Visitors can browse freely. The sign-in screen appears only when it is needed:
  // saving to an account, contacting, listing, ordering, reviewing — or to finish a half-made account.
  function checkGate() {
    if (location.hash === '#admin') { hideGate(); return; }
    if (oauthError.startsWith('LINK:')) { const m = oauthError.slice(5); oauthError = ''; showGate('forgot', m); return; }
    if (isComplete()) { hideGate(); return; }
    if (db.session) { showGate('complete'); return; }
    if (oauthError) { showGate('signin', `Google sign-in failed: ${oauthError}`); oauthError = ''; return; }
    hideGate();
  }
  const gateRequired = () => !!db.session && !isComplete() || gate.view === 'newpass';
  function closeGate() { if (gateRequired()) return; hideGate(); gate.onDone = null; if (gate.invite) { gate.invite = null; try { sessionStorage.removeItem('raqbo-open-property'); } catch { /* ignore */ } } }
  function finishSignIn() {
    hideGate(); updateAuthUI(); renderGrid();
    toast(`Welcome${db.session && db.session.name ? ', ' + db.session.name.split(' ')[0] : ''}! You’re signed in.`);
    const next = gate.onDone; gate.onDone = null; gate.invite = null; if (next) next();
  }
  function requireSignIn(next) { if (isComplete()) next(); else { gate.onDone = next; showGate(); } }
  async function gateSubmit(e) {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    const kind = f.dataset.form; const btn = $('.modal-submit', f); const errs = [];
    const v = (n) => (f.elements[n] ? f.elements[n].value.trim() : '');
    if (kind === 'signup' || kind === 'complete') {
      if (v('name').length < 2) errs.push(['name', 'Enter your full name.']);
      if (!normPhone(v('phone'))) errs.push(['phone', PK_PHONE_HINT]);
      if (f.elements.city && !v('city')) errs.push(['city', 'Choose your city.']);
      if (v('city') === 'Other' && v('cityOther').length < 2) errs.push(['cityOther', 'Type your city.']);
    }
    if (kind === 'signup' || kind === 'signin' || kind === 'forgot') { if (!validEmail(v('email'))) errs.push(['email', 'Enter a valid email address.']); }
    if (kind === 'newpass') { if (f.password.value.length < 8) errs.push(['password', 'Choose a password with at least 8 characters.']); else if (f.password.value !== f.password2.value) errs.push(['password2', 'The two passwords don’t match.']); }
    if (kind === 'forgot' && !errs.length) {
      const done = busy(btn, 'Sending link…'); gate.resetEmail = v('email').toLowerCase();
      try {
        const r = await backend.resetPassword(gate.resetEmail);
        if (r && r.demo) { toast('Demo mode: no email is sent — choose a new password now.'); renderGate('newpass'); } else renderGate('forgot-sent');
      } catch (err) { done(); showErrors(f, [['email', err.message]]); }
      return;
    }
    if (kind === 'newpass' && !errs.length) {
      const done = busy(btn, 'Saving…');
      try { await backend.updatePassword(f.password.value); recoveryMode = false; toast('Your password has been changed.'); if (isComplete()) finishSignIn(); else renderGate('complete'); }
      catch (err) { done(); showErrors(f, [['password', err.message]]); }
      return;
    }
    if (kind === 'signup' && f.password.value.length < 8) errs.push(['password', 'Choose a password with at least 8 characters.']);
    if (kind === 'signin' && !f.password.value) errs.push(['password', 'Enter your password.']);
    if (showErrors(f, errs)) return;
    const done = busy(btn, kind === 'signup' ? 'Creating account…' : kind === 'signin' ? 'Signing in…' : 'Saving…');
    try {
      if (kind === 'signup') await backend.signUp(v('name'), v('email').toLowerCase(), normPhone(v('phone')), f.password.value);
      else if (kind === 'signin') await backend.signIn(v('email').toLowerCase(), f.password.value);
      else if (kind === 'complete') await backend.completeProfile(v('name'), normPhone(v('phone')));
      if ((kind === 'signup' || kind === 'complete') && f.elements.city) await saveLocation(v('city') === 'Other' ? v('cityOther') : v('city'), v('area'));
      if (isComplete()) finishSignIn(); else renderGate('complete');
    } catch (err) { done(); showErrors(f, [[/password/i.test(err.message) ? 'password' : /email|account/i.test(err.message) ? 'email' : 'phone', err.message]]); }
  }
  async function gateClick(e) {
    if (e.target.closest('[data-gate-close]') || e.target === gate.el) { closeGate(); return; }
    const t = e.target.closest('[data-view]'); if (t) { renderGate(t.dataset.view); return; }
    if (e.target.closest('[data-signout-gate]')) { await backend.signOut(); updateAuthUI(); renderGate('signin'); return; }
    const g = e.target.closest('[data-google]');
    if (g) { const done = busy(g, 'Opening Google…'); try { await backend.googleSignIn(); } catch (err) { done(); const f = $('form', gate.el); if (f) showErrors(f, [['email', err.message]]); } }
  }
  document.addEventListener('submit', (e) => { if (gate.el && gate.el.contains(e.target)) gateSubmit(e); });
  document.addEventListener('click', (e) => { if (gate.el && gate.el.contains(e.target) && !e.target.closest('[data-action]')) gateClick(e); });
  async function signOut() { closeModal(); try { await backend.signOut(); } catch (err) { toast(err.message); } updateAuthUI(); renderGrid(); toast('Signed out.'); checkGate(); }
  const STATUS_LABEL = { expired: 'Paused — not confirmed', pending: 'Pending review', published: 'Published', rejected: 'Rejected', new: 'New', handled: 'Handled', open: 'Open', reviewed: 'Reviewed', in_progress: 'In progress', awaiting_client: 'Waiting for client', completed: 'Completed', cancelled: 'Cancelled' };
  const pill = (st) => `<span class="status-pill status-${esc(st)}">${esc(STATUS_LABEL[st] || st)}</span>`;
  function openAccount() {
    if (!db.session) { showGate(); return; }
    const s = db.session;
    const mine = db.listings.filter((l) => !l.sample && l.ownerId === s.userId).sort((a, b) => b.createdAt - a.createdAt);
    const card = openModal(`
      <div class="eyebrow"><span></span> MY ACCOUNT</div><h2>${esc(s.name)}</h2>
      <p class="modal-lead">${esc(s.email)}${s.phone ? ` · ${esc(s.phone)}` : ''}${db.isAdmin && LIVE ? ' · RAQBO admin' : ''} · member since ${esc(fmtDay(s.since))}</p>
      <h3 class="detail-subhead">My listings</h3>
      ${mine.length ? `<div class="account-list">${mine.map((l) => `<div class="account-item"><div><b>${esc(l.title)}</b><small>${esc(l.area)}, ${esc(l.city)} · ${fmtPrice(l.price)} · submitted ${esc(fmtDay(l.createdAt))}${l.reviewNote ? `<br>Reviewer note: ${esc(l.reviewNote)}` : ''}</small></div><div class="account-item-actions">${pill(l.status)}${vfAccountBits(l)}${gwTrialBtn(l)}<button type="button" class="link-button" data-view="${esc(l.id)}">View</button><button type="button" class="link-button" data-edit="${esc(l.id)}">Edit</button><button type="button" class="link-button link-danger" data-delete="${esc(l.id)}">Delete</button></div></div>`).join('')}</div><p class="form-hint">Editing a listing sends it back for review — it is hidden from the public until approved again.</p>` : '<p class="modal-lead">You haven’t listed a property yet.</p>'}
      <div class="button-row"><button type="button" class="button button-primary" data-new>List a property</button>${db.isAdmin && LIVE ? '<button type="button" class="button button-outline" data-admin>Admin panel</button>' : ''}<button type="button" class="button button-outline" data-signout>Sign out</button></div>`, { label: 'My account' });
    card.addEventListener('click', (e) => {
      const v = e.target.closest('[data-view]'); if (v) openDetails(v.dataset.view);
      const ed = e.target.closest('[data-edit]'); if (ed) openListingForm(ed.dataset.edit);
      const del = e.target.closest('[data-delete]');
      if (del) {
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; setTimeout(() => { if (del.isConnected) { del.dataset.armed = ''; del.textContent = 'Delete'; } }, 4000); return; }
        del.disabled = true; del.textContent = 'Deleting…';
        backend.deleteListing(del.dataset.delete).then(() => { toast('Listing deleted.'); renderGrid(); refreshAdmin(); openAccount(); }).catch((err) => { toast(err.message); del.disabled = false; del.dataset.armed = ''; del.textContent = 'Delete'; });
        return;
      }
      if (e.target.closest('[data-new]')) openListingForm();
      if (e.target.closest('[data-admin]')) openAdmin();
      if (e.target.closest('[data-signout]')) signOut();
    });
  }

  /* ---------- Property listing submission ---------- */
  const LIMITS = { photos: 20, videos: 3, photoMB: 25, videoMB: 50 };   // photos are shrunk to ~300 KB before upload
  function openListingForm(editId, opts = {}) {
    requireSignIn(() => {
      const s = db.session; const files = { photo: [], video: [] }; const previewUrls = [];
      const editing = editId ? byId(editId) : null;
      if (editId && (!editing || editing.ownerId !== s.userId)) { toast('You can only edit your own listings.'); return; }
      const keep = { photo: editing ? [...editing.photos] : [], video: editing ? [...editing.videos] : [] }; const removed = [];
      const card = openModal(`
        <div class="eyebrow"><span></span> ${opts.kicker || (editing ? 'EDIT LISTING' : 'LIST YOUR PROPERTY')}</div><h2>${opts.heading || (editing ? 'Edit your listing' : 'Tell us about your property')}</h2>${opts.intro || ''}
        <p class="modal-lead">${editing ? `Saving sends <b>${esc(editing.title)}</b> back to the review queue. It is <b>hidden from the public</b> until an administrator approves it again.` : `Signed in as <b>${esc(s.name)}</b> (${esc(s.email)}). Your listing goes to the review queue and is <b>not public</b> until an administrator approves it.`}</p>
        <form class="modal-form" novalidate>
          <p class="form-section-title">Basics</p>
          <label>Listing title<input name="title" maxlength="80" placeholder="e.g. Renovated 10 Marla house near the park"></label>
          <label>Description<textarea name="description" maxlength="2000" placeholder="Layout, condition, nearby amenities, parking, utilities…"></textarea></label>
          <div class="modal-form-row"><label>Sale or rent<select name="purpose"><option value="sale">For sale</option><option value="rent">For rent</option></select></label><label>Property type<select name="type"><option value="House">House / villa</option><option value="Apartment">Apartment</option><option value="Plot">Plot / land</option><option value="Commercial">Commercial</option></select></label></div>
          <label>You are advertising as<select name="role"><option value="Owner">Owner (direct)</option><option value="Authorized representative">Authorized representative of the owner</option><option value="Agent">Agent / dealer</option></select></label>
          <p class="form-section-title">Location &amp; size</p>
          <div class="modal-form-row"><label>City<select name="city"><option>Lahore</option><option>Islamabad</option><option>Rawalpindi</option><option>Karachi</option><option>Faisalabad</option><option>Multan</option><option>Other</option></select></label><label>Area / society<input name="area" maxlength="120" placeholder="e.g. DHA Phase 5"></label></div>
          <div class="modal-form-row"><label>Size<input name="size" type="number" min="0" step="any" placeholder="e.g. 10"></label><label>Unit<select name="sizeUnit"><option>Marla</option><option>Kanal</option><option>sq ft</option><option>sq yd</option><option>Acre</option></select></label></div>
          ${pinPickerHTML(editing)}
          <p class="form-section-title">Price &amp; rooms</p>
          <label><span data-price-label>Asking price (PKR)</span><input name="price" type="number" min="1" step="1" placeholder="e.g. 32500000"><span class="form-hint" data-price-hint>Enter the full amount in rupees.</span></label>
          <div class="modal-form-row" data-rooms><label>Bedrooms<input name="beds" type="number" min="0" max="50" step="1"></label><label>Bathrooms<input name="baths" type="number" min="0" max="50" step="1"></label></div>
          ${coreListingFormHTML()}
          <p class="form-section-title">Photos &amp; video</p>
          <label>Property photos <span class="form-hint">At least 1 · up to ${LIMITS.photos} photos · ${LIMITS.photoMB} MB each · JPG, PNG, WebP</span><input type="file" name="photos" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>
          <div class="upload-previews" data-previews="photo"></div>
          <label>Walkthrough video (optional) <span class="form-hint">MP4 only · up to ${LIMITS.videos} videos · ${LIMITS.videoMB} MB each</span><input type="file" name="videos" accept="video/mp4,.mp4" multiple></label>
          <div class="upload-previews" data-previews="video"></div>
          <p class="form-hint">3D models and 360° tour files are not supported yet — please use photos and MP4 video.</p>
          ${opts.extraHTML ? opts.extraHTML() : ''}
          <label class="consent-check"><input type="checkbox" name="consent"> I confirm I am the owner or authorized to advertise this property, and the information is accurate.</label>
          <div class="form-error" hidden></div>
          <button class="button button-primary modal-submit" type="submit">${editing ? 'Save changes' : 'Submit for review'}</button>
        </form>`, { wide: true, label: editing ? 'Edit listing' : 'List your property', onClose: () => previewUrls.forEach((u) => URL.revokeObjectURL(u)) });
      const f = $('form', card);
      if (opts.onOpen) opts.onOpen(f, card);
      if (editing) {
        ['title', 'description', 'purpose', 'type', 'role', 'city', 'area', 'size', 'sizeUnit', 'price', 'beds', 'baths'].forEach((k) => { if (f.elements[k] && editing[k] !== undefined && editing[k] !== null) f.elements[k].value = editing[k]; });
        if (![...f.city.options].some((o) => o.value === editing.city)) f.city.value = 'Other';
        coreFormFill(f, editing);
        f.consent.checked = true;
      }
      const syncPrice = () => {
        const rent = f.purpose.value === 'rent'; $('[data-price-label]', card).textContent = rent ? 'Monthly rent (PKR)' : 'Asking price (PKR)';
        const n = Number(f.price.value); $('[data-price-hint]', card).textContent = n > 0 ? `= ${fmtPrice(n)}${rent ? ' per month' : ''}` : 'Enter the full amount in rupees.';
      };
      const syncRooms = () => { $('[data-rooms]', card).hidden = f.type.value === 'Plot'; };
      f.purpose.addEventListener('change', syncPrice); f.price.addEventListener('input', syncPrice); f.type.addEventListener('change', syncRooms);
      const renderPreviews = (kind) => {
        const box = $(`[data-previews=${kind}]`, card);
        box.innerHTML = keep[kind].map((m, i) => `<div class="upload-preview is-existing">${kind === 'video' ? `<video muted controls preload="metadata" ${mediaAttr(m)}></video>` : `<img alt="" ${mediaAttr(m)}>`}<span title="${esc(m.name || 'Current file')}">Current · ${esc(m.name || kind)}</span><button type="button" aria-label="Remove current ${kind}" data-remove-existing="${kind}:${i}">×</button></div>`).join('')
          + files[kind].map((it, i) => `<div class="upload-preview">${kind === 'video' ? `<video src="${it.url}" muted controls preload="metadata"></video>` : `<img src="${it.url}" alt="">`}<span title="${esc(it.file.name)}">New · ${esc(it.file.name)} · ${(it.file.size / 1048576).toFixed(1)} MB</span><button type="button" aria-label="Remove ${esc(it.file.name)}" data-remove="${kind}:${i}">×</button></div>`).join('');
        hydrate(box);
      };
      const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      const addFiles = (kind, list) => {
        const max = kind === 'photo' ? LIMITS.photos : LIMITS.videos; const mb = kind === 'photo' ? LIMITS.photoMB : LIMITS.videoMB; const skipped = [];
        [...list].forEach((file) => {
          const okType = kind === 'photo' ? PHOTO_TYPES.includes(file.type) : (file.type === 'video/mp4' || (!file.type && /\.mp4$/i.test(file.name)));
          if (!okType) { skipped.push(`${file.name} (${kind === 'photo' ? 'use JPG, PNG or WebP' : 'not an MP4 video'})`); return; }
          if (file.size > mb * 1048576) { skipped.push(`${file.name} (over ${mb} MB)`); return; }
          if (files[kind].length + keep[kind].length >= max) { skipped.push(`${file.name} (limit of ${max} reached)`); return; }
          const url = URL.createObjectURL(file); previewUrls.push(url); files[kind].push({ file, url });
        });
        renderPreviews(kind); if (skipped.length) toast('Skipped: ' + skipped.join(', '));
      };
      f.photos.addEventListener('change', () => { addFiles('photo', f.photos.files); f.photos.value = ''; });
      f.videos.addEventListener('change', () => { addFiles('video', f.videos.files); f.videos.value = ''; });
      card.addEventListener('click', (e) => {
        const x = e.target.closest('[data-remove-existing]'); if (x) { const [kind, i] = x.dataset.removeExisting.split(':'); removed.push(...keep[kind].splice(+i, 1)); renderPreviews(kind); return; }
        const r = e.target.closest('[data-remove]'); if (!r) return; const [kind, i] = r.dataset.remove.split(':'); files[kind].splice(+i, 1); renderPreviews(kind);
      });
      if (editing) { renderPreviews('photo'); renderPreviews('video'); }
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); const errs = []; const v = (n) => f[n].value.trim(); const rooms = f.type.value === 'House' || f.type.value === 'Apartment';
        if (v('title').length < 5) errs.push(['title', 'Add a listing title (at least 5 characters).']);
        if (v('description').length < 20) errs.push(['description', 'Add a description (at least 20 characters).']);
        if (!v('area')) errs.push(['area', 'Enter the area or society.']);
        if (!(Number(v('size')) > 0)) errs.push(['size', 'Enter the property size.']);
        if (!(Number(v('price')) > 0)) errs.push(['price', 'Enter the price in PKR.']);
        if (rooms && v('beds') === '') errs.push(['beds', 'Enter the number of bedrooms.']);
        if (rooms && v('baths') === '') errs.push(['baths', 'Enter the number of bathrooms.']);
        if (!files.photo.length && !keep.photo.length) errs.push(['photos', 'Attach at least one property photo.']);
        if (!f.consent.checked) errs.push(['consent', 'Confirm that you are authorized to advertise this property.']);
        if (opts.validate) errs.push(...opts.validate(f));
        if (showErrors(f, errs)) return;
        const btn = $('.modal-submit', f); btn.disabled = true;
        const data = { title: v('title'), description: v('description'), purpose: f.purpose.value, type: f.type.value, role: f.role.value, city: f.city.value, area: v('area'), size: Number(v('size')), sizeUnit: f.sizeUnit.value, price: Math.round(Number(v('price'))), beds: f.type.value === 'Plot' ? 0 : Math.min(50, Number(v('beds') || 0)), baths: f.type.value === 'Plot' ? 0 : Math.min(50, Number(v('baths') || 0)), lat: f.lat && f.lat.value ? Number(f.lat.value) : null, lng: f.lng && f.lng.value ? Number(f.lng.value) : null, ...coreFormData(f) };
        try {
          btn.textContent = 'Preparing photos…';
          const photos = []; for (let i = 0; i < files.photo.length; i++) { btn.textContent = `Optimising photo ${i + 1} of ${files.photo.length}…`; photos.push(await shrinkImage(files.photo[i].file)); }
          if (editing) {
            await backend.updateListing(editing.id, data, { photo: photos, video: files.video.map((x) => x.file) }, removed, (msg) => { btn.textContent = msg; });
            refreshAdmin(); renderGrid();
            setBody(card, successHTML('Changes saved', `<p><b>${esc(data.title)}</b> has been updated and sent back for review. It will reappear on the website once an administrator approves it.</p>`, editing.ref, '<button type="button" class="button button-outline" data-goto-account>My listings</button>'));
            card.addEventListener('click', (ev) => { if (ev.target.closest('[data-goto-account]')) openAccount(); });
            return;
          }
          if (opts.data) Object.assign(data, opts.data(f));
          const listing = await backend.submitListing(data, { photo: photos, video: files.video.map((x) => x.file) }, (msg) => { btn.textContent = msg; });
          refreshAdmin(); renderGrid();
          if (opts.after) { btn.textContent = 'Sending…'; await opts.after(listing, f, card); return; }
          const np = files.photo.length; const nv = files.video.length;
          setBody(card, successHTML('Submitted for review', `<p><b>${esc(data.title)}</b> is now in the review queue with ${np} photo${np === 1 ? '' : 's'}${nv ? ` and ${nv} video${nv === 1 ? '' : 's'}` : ''}.</p><p>It is <b>not public</b> until an administrator approves it. After approval it appears on the property page with its photos and video in the details gallery.</p>`, listing.ref, `${LIVE ? '' : '<button type="button" class="button button-outline" data-goto-admin>Open admin panel (demo)</button>'}<button type="button" class="button button-outline" data-goto-account>My listings</button>`));
          card.addEventListener('click', (ev) => { if (ev.target.closest('[data-goto-admin]')) { closeModal(); openAdmin('pending'); } if (ev.target.closest('[data-goto-account]')) openAccount(); });
        } catch (err) {
          btn.disabled = false; btn.textContent = editing ? 'Save changes' : 'Submit for review'; showErrors(f, [['photos', err.message]]);
        }
      });
    });
  }

