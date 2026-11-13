  /* =====================================================================
     Client review v3: homepage option tiles, RAQBO Verified page,
     "Newest first" that really is newest
     ===================================================================== */
  const V3_TILES = [
    ['buy', 'Buy Property', 'Homes, plots and commercial', '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>', 'data-v3="deal" data-v="sale"'],
    ['sell', 'Sell Property', 'List free — reviewed by RAQBO', '<path d="M12 5v14M5 12h14"/>', 'data-action="list"'],
    ['rent', 'Rent Property', 'Houses, flats and offices', '<path d="M15 7a4 4 0 1 1-3.9 4.9L3 20v-3l2-2v-2h2l1.6-1.6"/><circle cx="16.5" cy="7.5" r=".8"/>', 'data-v3="deal" data-v="rent"'],
    ['quick', 'QuickSell', 'Sell fast — RAQBO, investors or public', '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', 'data-dl="urgent-page"'],
    ['auction', 'Property Auctions', 'Transparent, verified bidding', '<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/>', 'data-ax="home"'],
    ['verified', 'RAQBO Verified', 'See what was checked and when', '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>', 'data-v3="verified"'],
    ['services', 'Property Services', 'Legal, documents, construction', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 'data-action="services"']];
  (function v3Tiles() {
    const hero = $('#home'); if (!hero || $('.v3-tiles')) return;
    const s = document.createElement('section'); s.className = 'v3-tiles'; s.setAttribute('aria-label', 'What would you like to do?');
    s.innerHTML = `<div class="container"><div class="v3-grid">${V3_TILES.map(([k, t, d, p, attr]) => `<button type="button" class="v3-tile v3-${k}" ${attr}><span class="v3-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg></span><b>${t}</b><small>${d}</small></button>`).join('')}</div></div>`;
    hero.after(s);
  })();
  // RAQBO Verified explainer page (#verified)
  function openVerifiedPage() {
    closeNavMenus(); if (pf.my.open) closeMy();
    const n = db.listings.filter((l) => !l.sample && l.status === 'published' && vfIsVerified(l.id)).length;
    const fee = (gw.pub && gw.pub.verification_fee) || 2000; const legal = (pf.pub && pf.pub.legal_verification_fee) || 10000;
    const card = openModal(`<div class="v3-ver">
      <div class="v3-ver-hero"><span class="rail-kicker">RAQBO VERIFIED</span><h2>Know what was checked — before you pay a single rupee.</h2><p>Every RAQBO verification report says what was examined, what could not be examined, the date, the status and any concerns found.</p>
        <div class="button-row"><button type="button" class="button button-primary" data-v3="show-verified">Show verified properties (${n})</button><button type="button" class="button button-ghost" data-my="properties">Verify my property</button><button type="button" class="button button-ghost" data-v3="check-report">Check a report number</button></div></div>
      <div class="v3-levels">
        <article><span>Level 1</span><h3>Identity Verified</h3><p>The advertiser's identity (CNIC) and contact details have been checked.</p><em>Free with CNIC upload</em></article>
        <article><span>Level 2</span><h3>Documents Reviewed</h3><p>Specified property documents have been examined by RAQBO — the report lists each one.</p><em>From ${esc(rs(fee))}</em></article>
        <article><span>Level 3</span><h3>Enhanced Property Verification</h3><p>A detailed review that may include official land records, ownership chain, encumbrances, possession and approvals — depending on the property and the records available.</p><em>From ${esc(rs(legal))}</em></article></div>
      <div class="v3-ver-note">${DI(DIC.info, 16)} <span>A RAQBO badge is <b>not a guarantee of clear legal title</b>. Each report carries a unique number and a QR code so anyone can confirm it is genuine.</span></div></div>`, { wide: true, label: 'RAQBO Verified' });
    card.classList.add('gw-card');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v3]'); if (!b) return; const a = b.dataset.v3; if (b.tagName === 'A') e.preventDefault();
    if (a === 'deal') { setDeal(b.dataset.v); scrollToResults(); }
    else if (a === 'verified') { closeNavMenus(); openVerifiedPage(); }
    else if (a === 'check-report') { closeModal(); location.hash = 'verify/'; vrOpenCheck(''); }
    else if (a === 'show-verified') { closeModal(); fx.vmode = 'verified'; renderGrid(); scrollToResults(); }
  });
  addEventListener('hashchange', (e) => { if (/#verified$/.test(e.newURL)) openVerifiedPage(); });
  if (location.hash === '#verified') setTimeout(openVerifiedPage, 600);

