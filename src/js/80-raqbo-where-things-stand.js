  /* =====================================================================
     RAQBO — Where things stand
     One page in My RAQBO that answers the only question a member really
     has: what is happening with my property, and with the ones I am after?
     Selling and buying are kept apart, each item shows the same five-step
     track as QuickSell, and every card says what happens next.
     ===================================================================== */
  const TRK = { side: null };
  const trkIc = (d, s = 16) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const TRK_IC = {
    check: trkIc('<path d="M5 12.5l4.5 4.5L19 7"></path>', 12),
    home: trkIc('<path d="M3 10.5L12 4l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"></path>', 17),
    cart: trkIc('<path d="M5 7h14l-1.2 12H6.2z"></path><path d="M9 7V5a3 3 0 0 1 6 0v2"></path>', 17),
    warn: trkIc('<path d="M12 4l9 16H3z"></path><path d="M12 10v4M12 17h.01"></path>', 14)
  };

  const TRK_SELL = ['Posted', 'RAQBO review', 'Live on RAQBO', 'Visits', 'Offer'];
  const TRK_BUY = ['Saved', 'Visit booked', 'Offer made', 'Deal'];

  // Draw the five dots. `at` is the step happening now; anything before it is done.
  function trkTrack(steps, at, bad) {
    return `<ol class="trk-steps${bad ? ' bad' : ''}">${steps.map((t, n) => `<li class="${n < at ? 'done' : n === at ? 'now' : ''}"><span>${n < at ? TRK_IC.check : n + 1}</span><b>${esc(t)}</b></li>`).join('')}</ol>`;
  }

  async function trkGather() {
    const s = db.session;
    const uid = s && s.userId;
    const mine = (db.listings || []).filter((l) => !l.sample && l.ownerId === uid);
    let d = { visits: [], received: [], made: [] };
    try { const r = await dlLoadMine(); if (r && !r.error) d = { visits: r.visits || [], received: r.received || [], made: r.made || [] }; } catch { /* offers are optional */ }

    // ---- selling ----
    const sell = mine.map((l) => {
      const offers = d.received.filter((o) => String(o.listing_id) === String(l.id) && !['withdrawn', 'expired', 'rejected'].includes(o.status));
      const rejected = l.status === 'rejected';
      let at = 1, note = '', next = '';
      if (l.status === 'pending') { at = 1; note = 'A reviewer is reading it now — usually within a day.'; next = 'Nothing to do. We will tell you the moment it is live.'; }
      else if (rejected) { at = 1; note = l.reviewNote ? 'Sent back: ' + l.reviewNote : 'Sent back for changes.'; next = 'Fix what the reviewer asked for and send it again.'; }
      else if (l.status === 'published') {
        at = 2; note = 'Live and visible to buyers.'; next = 'Add RAQBO Verified to get more serious enquiries.';
        const visits = d.visits.filter((v) => String(v.listing_id) === String(l.id));
        if (visits.length) { at = 3; note = `${visits.length} visit${visits.length > 1 ? 's' : ''} booked.`; next = 'Be there on time — a visit that happens usually brings an offer.'; }
        if (offers.length) { at = 4; note = `${offers.length} offer${offers.length > 1 ? 's' : ''} on the table.`; next = 'Open Offers and accept, counter or decline.'; }
      } else { at = 0; note = 'Saved as a draft.'; next = 'Finish it and send it for review.'; }
      return { l, at, note, next, bad: rejected, offers: offers.length };
    }).sort((a, b) => b.at - a.at);

    // ---- buying ----
    const ids = new Set();
    (db.favorites || []).forEach((id) => ids.add(String(id)));
    d.visits.forEach((v) => ids.add(String(v.listing_id)));
    d.made.forEach((o) => ids.add(String(o.listing_id)));
    const buy = [...ids].map((id) => {
      const l = byId(id);
      if (!l || l.ownerId === uid) return null;
      const visit = d.visits.find((v) => String(v.listing_id) === id);
      const offer = d.made.find((o) => String(o.listing_id) === id && !['withdrawn', 'expired'].includes(o.status));
      let at = 0, note = 'On your shortlist.', next = 'Book a visit when you are ready to see it.';
      if (visit) { at = 1; note = visit.status === 'confirmed' ? 'Visit confirmed by RAQBO.' : 'Visit requested — RAQBO is confirming the time.'; next = 'Go and see it, then make an offer if it fits.'; }
      if (offer) {
        at = 2;
        note = offer.status === 'accepted' ? 'Your offer was accepted.' : offer.status === 'countered' ? 'The seller countered.' : offer.status === 'rejected' ? 'The seller declined this one.' : 'Offer with the seller.';
        next = offer.status === 'countered' ? 'Open Offers and accept or counter back.' : offer.status === 'accepted' ? 'RAQBO will contact you about the paperwork.' : 'Wait for the seller — we will tell you the moment they reply.';
        if (offer.status === 'accepted') at = 3;
      }
      return { l, at, note, next, bad: offer && offer.status === 'rejected' };
    }).filter(Boolean).sort((a, b) => b.at - a.at);

    return { sell, buy };
  }

  const trkCard = (it, steps) => `<article class="trk-card${it.bad ? ' bad' : ''}">
      <div class="trk-top">
        <span class="trk-img" ${mediaAttr(it.l.photos && it.l.photos[0], true)}></span>
        <div class="trk-id">
          <b>${esc(it.l.title || 'Property')}</b>
          <small>${esc([it.l.area, it.l.city].filter(Boolean).join(', '))} · ${esc(fmtPrice(it.l.price))}${it.l.purpose === 'rent' ? ' / month' : ''}</small>
        </div>
        <button type="button" class="link-button trk-open" data-open="${esc(it.l.id)}">View</button>
      </div>
      ${trkTrack(steps, it.at, it.bad)}
      <p class="trk-now">${it.bad ? TRK_IC.warn : ''}<b>${esc(it.note)}</b></p>
      <p class="trk-next"><span>Next</span>${esc(it.next)}</p>
    </article>`;

  MY_RENDER.track = async () => {
    const { sell, buy } = await trkGather();
    if (!sell.length && !buy.length) {
      return `${myHead('WHERE THINGS STAND', 'Where things stand', 'Every property you are selling or chasing, and exactly what happens next.')}
        <div class="admin-empty">Nothing is moving yet. List a property to start selling, or save one you like to start following it.</div>
        <div class="button-row"><button type="button" class="button button-primary" data-new-listing>${DI(DIC.plus, 16)} List a property</button><button type="button" class="button button-outline" data-action="all">Browse properties</button></div>`;
    }
    const side = TRK.side || (sell.length ? 'sell' : 'buy');
    const list = side === 'sell' ? sell : buy;
    const steps = side === 'sell' ? TRK_SELL : TRK_BUY;
    return `${myHead('WHERE THINGS STAND', 'Where things stand', 'Every property you are selling or chasing, and exactly what happens next.')}
      <div class="trk-switch" role="group" aria-label="Selling or buying">
        <button type="button" class="${side === 'sell' ? 'on' : ''}" data-trk="sell">${TRK_IC.home}<span>I am selling</span><i>${sell.length}</i></button>
        <button type="button" class="${side === 'buy' ? 'on' : ''}" data-trk="buy">${TRK_IC.cart}<span>I am buying</span><i>${buy.length}</i></button>
      </div>
      ${list.length ? `<div class="trk-list">${list.map((it) => trkCard(it, steps)).join('')}</div>`
        : `<div class="admin-empty">${side === 'sell' ? 'You have not listed a property yet.' : 'Save a property, book a visit or make an offer and it will show up here.'}</div>`}`;
  };

  // the tab, right after Overview
  try {
    if (!MY.some((m) => m.id === 'track')) MY.splice(1, 0, { id: 'track', label: 'Where things stand', icon: 'clock' });
  } catch { /* the tab is optional */ }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-trk]');
    if (!b) return;
    e.preventDefault();
    TRK.side = b.dataset.trk;
    renderMy();
  });
