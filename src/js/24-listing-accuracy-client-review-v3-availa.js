  /* =====================================================================
     Listing accuracy (client review v3): availability, landmarks, last
     confirmed, price history, duplicates, expiry, site visits everywhere
     Supabase: update_18_listings.sql
     ===================================================================== */
  const AVAIL = { available: 'Available', under_offer: 'Under offer', sold: 'Sold', rented: 'Rented out' };
  const V3DAY = 864e5;
  const v3Fresh = (l) => (l.publishedAt || l.createdAt || 0) > Date.now() - 7 * V3DAY;
  const v3Reduced = (l) => !!(l.prevPrice && l.prevPrice > l.price && (l.priceChangedAt || 0) > Date.now() - 60 * V3DAY);
  function v3CardChips(l) {
    if (l.status !== 'published') return '';
    const c = [];
    if (l.availability && l.availability !== 'available') c.push(`<span class="v3c v3c-${esc(l.availability)}">${esc(AVAIL[l.availability])}</span>`);
    if (v3Reduced(l)) c.push(`<span class="v3c v3c-drop">▼ ${Math.round((1 - l.price / l.prevPrice) * 100)}% price cut</span>`);
    else if (v3Fresh(l) && !l.sample) c.push('<span class="v3c v3c-new">NEW</span>');
    return c.length ? `<span class="v3-chips">${c.join('')}</span>` : '';
  }
  const v3Ago = (t) => { if (!t) return ''; const d = Math.floor((Date.now() - t) / V3DAY); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 31 ? `${d} days ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  function v3DetailBox(l) {
    if (l.sample) return '';
    setTimeout(() => v3FillHistory(l), 0);
    const facts = [
      ['Availability', `<b class="v3a-${esc(l.availability || 'available')}">${esc(AVAIL[l.availability || 'available'])}</b>`],
      l.landmarks ? ['Nearby', esc(l.landmarks)] : null,
      ['Advertiser', esc(l.role === 'Owner' ? 'Owner (direct)' : l.role || '—')],
      l.marlaSqft ? ['Marla standard', `${esc(l.marlaSqft)} sq ft per marla`] : null,
      l.confirmedAt ? ['Last confirmed', `${esc(v3Ago(l.confirmedAt))} by the advertiser`] : null,
      ['Verification', vfIsVerified(l.id) ? (coreVerifLevel(l.id) === 'legal' ? 'Enhanced Property Verification' : 'Documents Reviewed') : (pf.idv.has(l.ownerId) ? 'Identity Verified (advertiser)' : 'Unverified')]].filter(Boolean);
    const mine = db.session && db.session.userId === l.ownerId;
    return `<section class="pp-section v3-facts"><h2>Listing facts</h2><dl>${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <div class="v3-ph" data-v3-ph="${esc(l.id)}"></div>
      ${mine || l.status !== 'published' ? '' : `<div class="v3-visit"><div><b>Want to see it in person?</b><small>Book a site visit — RAQBO confirms the time with you and the advertiser.</small></div><button type="button" class="button button-primary" data-dl="visit" data-id="${esc(l.id)}">${DI(DIC.clock, 16)} Book a site visit</button></div>`}</section>`;
  }
  async function v3FillHistory(l) {
    const box = $(`[data-v3-ph="${CSS.escape(l.id)}"]`); if (!box) return; let h = [];
    try { h = SB ? ((await SB.rpc('listing_price_history', { p_listing: l.id })).data || []) : (l.prevPrice ? [{ price: l.prevPrice, at: new Date(l.createdAt).toISOString() }, { price: l.price, at: new Date(l.priceChangedAt || Date.now()).toISOString() }] : []); } catch { h = []; }
    if (h.length < 2) return;
    box.innerHTML = `<h3>Price history</h3><ol>${h.slice().reverse().map((x, i, a) => { const prev = a[i + 1]; const d = prev ? x.price - prev.price : 0; return `<li><span>${esc(new Date(x.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</span><b>${esc(fmtPrice(x.price))}</b>${d ? `<em class="${d < 0 ? 'down' : 'up'}">${d < 0 ? '▼' : '▲'} ${esc(fmtPrice(Math.abs(d)))}</em>` : '<em>Listed</em>'}</li>`; }).join('')}</ol>`;
  }
  // ---------- Duplicate detection ----------
  const v3Norm = (s) => String(s || '').toLowerCase().replace(/phase\s*/g, 'ph').replace(/[^a-z0-9]/g, '');
  function v3Dups(l) {
    const m = marlaOf(l); const area = v3Norm(l.area);
    return db.listings.filter((x) => x.id !== l.id && !x.sample && ['pending', 'published', 'expired'].includes(x.status) && x.city === l.city && x.purpose === l.purpose && x.type === l.type
      && v3Norm(x.area) === area && (!m || Math.abs(marlaOf(x) - m) <= Math.max(0.5, m * 0.05)) && Math.abs(x.price - l.price) <= l.price * 0.15);
  }
  function v3DupChip(l) { if (l.sample) return ''; const d = v3Dups(l); return d.length ? `<p class="v3-dup">${DI(DIC.alert, 15)} <span><b>Possible duplicate</b> of ${d.slice(0, 3).map((x) => `<button type="button" class="link-button" data-open="${esc(x.id)}">${esc(x.ref || x.title)}</button>${x.ownerId === l.ownerId ? ' (same advertiser)' : ' (different advertiser)'}`).join(', ')} — same area, type, size and similar price.</span></p>` : ''; }
  // ---------- Admin: Site visits + Duplicates ----------
  var v3a = { visits: null, loadedAt: 0 };
  var V3_ADMIN = {};
  function v3AdminTabs() { return [['#t', 'TRUST & FINANCE'], ['complaints', 'Complaints & disputes', v3x.k && !v3x.k.error ? (v3x.k.complaints_open || '') : ''], ['refunds', 'Refunds register', v3x.k && !v3x.k.error ? (v3x.k.refunds_pending_n || '') : ''], ['finance', 'Revenue & expenses', ''], ['agents', 'Agent packages', ''], ['accounts', 'Account checks', ''], ['security', 'Security & tools', ''], ['#s', 'SERVICES & PROJECTS'], ['svcfees', 'Services & fees', ''], ['projects', 'RAQBO projects', ''], ['visits', 'Site visits', v3a.visits && Array.isArray(v3a.visits) ? (v3a.visits.filter((v) => v.status === 'requested').length || '') : ''], ['duplicates', 'Possible duplicates', (() => { const s = new Set(); db.listings.filter((l) => !l.sample && ['pending', 'published'].includes(l.status)).forEach((l) => { if (v3Dups(l).length) s.add(l.id); }); return s.size || ''; })()]]; }
  async function v3VisitsLoad() {
    v3a.loadedAt = Date.now(); await new Promise((r) => setTimeout(r, 0));
    try { v3a.visits = SB ? ((await SB.rpc('admin_visits')).data || []) : store.get('deals.visits', []).map((v) => { const l = byId(v.listing_id) || {}; const a = Object.values(store.get('accounts', {})); const u = a.find((x) => x.userId === v.user_id) || {}; const o = a.find((x) => x.userId === l.ownerId) || {}; return { ...v, title: l.title, ref: l.ref, area: l.area, city: l.city, who: u.name, phone: u.phone, owner: o.name || l.ownerName, owner_phone: o.phone }; }); } catch (err) { v3a.visits = { error: err.message }; }
    if (admin.el && !admin.el.hidden && admin.tab === 'visits') { const b = $('.ax-body', admin.el); if (b) b.innerHTML = V3_ADMIN.visits(); }
  }
  V3_ADMIN.visits = () => {
    const d = v3a.visits; if (!d) { v3VisitsLoad(); return '<div class="admin-empty">Loading…</div>'; } if (d.error) return `<div class="admin-empty">${esc(d.error)}</div>`;
    const when = (v) => v.confirmed_at || v.preferred_at ? new Date(v.confirmed_at || v.preferred_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Any time';
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> PROPERTIES</div><h2>Site visits</h2><p class="admin-sub">Visit requests on every listing. Confirm a time to notify both the visitor and the advertiser.</p></div><button type="button" class="admin-refresh" data-v3a="reload">Refresh</button></div>
      ${d.length ? `<table class="gw-table"><thead><tr><th>When</th><th>Property</th><th>Visitor</th><th>Advertiser</th><th>Status</th><th></th></tr></thead><tbody>${d.map((v) => `<tr><td>${esc(when(v))}${v.note ? `<br><small>${esc(v.note)}</small>` : ''}</td><td><button type="button" class="link-button" data-open="${esc(v.listing_id)}">${esc(v.title || '')}</button><br><small>${esc(v.ref || '')} · ${esc(v.area || '')}, ${esc(v.city || '')}</small></td><td>${esc(v.who || '')}<br><small>${esc(v.phone || '')}</small></td><td>${esc(v.owner || '')}<br><small>${esc(v.owner_phone || '')}</small></td><td><span class="svc-st">${esc(v.status)}</span></td><td>${['requested', 'confirmed'].includes(v.status) ? `<button type="button" class="link-button" data-v3a="visit" data-act="confirmed" data-id="${esc(v.id)}">Confirm</button> <button type="button" class="link-button" data-v3a="visit" data-act="completed" data-id="${esc(v.id)}">Done</button> <button type="button" class="link-button" data-v3a="visit" data-act="cancelled" data-id="${esc(v.id)}">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">No visit requests yet.</div>'}</div>`;
  };
  V3_ADMIN.duplicates = () => {
    const seen = new Set(); const groups = [];
    db.listings.filter((l) => !l.sample && ['pending', 'published', 'expired'].includes(l.status)).forEach((l) => { if (seen.has(l.id)) return; const d = v3Dups(l); if (!d.length) return; const g = [l, ...d]; g.forEach((x) => seen.add(x.id)); groups.push(g); });
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> PROPERTIES</div><h2>Possible duplicates</h2><p class="admin-sub">Listings in the same city and area with the same type, a size within 5% and a price within 15%. Check the photos and advertisers, then return a duplicate to review or reject it.</p></div></div>
      ${groups.length ? groups.map((g) => `<div class="v3-dupg">${g.map((l) => `<div><button type="button" class="link-button" data-open="${esc(l.id)}"><b>${esc(l.title)}</b></button><small>${esc(l.ref || '')} · ${esc(l.area)}, ${esc(l.city)} · ${esc(fmtSize(l))} · ${esc(fmtPrice(l.price))} · ${esc(l.ownerName || '')} · ${esc(STATUS_LABEL[l.status] || l.status)}</small></div>`).join('')}</div>`).join('') : '<div class="admin-empty sm">No probable duplicates found.</div>'}</div>`;
  };
  document.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-v3a]'); if (!x) return; const a = x.dataset.v3a;
    if (a === 'reload') { v3a.visits = null; v3VisitsLoad(); }
    else if (a === 'visit') { let when = null; if (x.dataset.act === 'confirmed') { const v = prompt('Confirmed date and time (e.g. 2026-11-15 11:00):'); if (!v) return; const t = Date.parse(v.replace(' ', 'T')); if (isNaN(t)) { toast('Use the format 2026-11-15 11:00'); return; } when = new Date(t).toISOString(); } const note = prompt('Note to the visitor (optional):') || ''; try { await DL.setVisit(x.dataset.id, x.dataset.act, when, note); toast('Saved — the visitor has been notified.'); v3a.visits = null; v3VisitsLoad(); } catch (err) { toast(err.message); } }
  });
  // ---------- My properties: confirm availability ----------
  MY_PROP_ACTIONS.unshift((l) => {
    if (l.sample || !['published', 'expired'].includes(l.status)) return '';
    const due = l.status === 'expired' || (l.confirmedAt && l.confirmedAt < Date.now() - 50 * V3DAY);
    return `<span class="v3-conf ${due ? 'due' : ''}">${l.status === 'expired' ? 'Paused — not confirmed' : `Confirmed ${esc(v3Ago(l.confirmedAt) || '—')}`} <button type="button" class="link-button" data-v3c="${esc(l.id)}">${l.status === 'expired' ? 'Confirm & show again' : 'Still available?'}</button></span>`;
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v3c]'); if (!b) return; const l = byId(b.dataset.v3c); if (!l) return;
    const card = openModal(`<div class="eyebrow"><span></span> CONFIRM AVAILABILITY</div><h2>${esc(l.title)}</h2><p class="modal-lead">Listings must be confirmed every ${esc((pf.pub && pf.pub.listing_confirm_days) || 60)} days, so buyers only see properties that are really available.</p>
      <form class="gwa-form" data-v3-confirm data-id="${esc(l.id)}"><fieldset><legend>Current status</legend>${Object.entries(AVAIL).map(([k, t]) => `<label class="gwa-chk"><input type="radio" name="av" value="${k}" ${(l.availability || 'available') === k ? 'checked' : ''}> ${t}</label>`).join('')}</fieldset><div class="button-row"><button type="submit" class="button button-primary">Confirm</button></div></form>`, { label: 'Confirm availability' });
    card.classList.add('gw-card');
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target; if (!f.matches('[data-v3-confirm]')) return; e.preventDefault(); const av = ($('[name=av]:checked', f) || {}).value || 'available'; const l = byId(f.dataset.id);
    const done = busy($('[type=submit]', f), 'Saving…');
    try {
      if (SB) { const { error } = await SB.rpc('confirm_listing', { p_listing: l.id, p_availability: av }); if (error) throw new Error(/function|schema cache/i.test(error.message) ? 'Ask the admin to run update_18_listings.sql.' : error.message); await backend.reloadListings(); }
      else { l.availability = av; l.confirmedAt = Date.now(); if (l.status === 'expired') l.status = 'published'; store.set('listings', db.listings); }
      done(); closeModal(); toast(av === 'available' ? 'Thanks — your listing stays live.' : `Marked as ${AVAIL[av].toLowerCase()}.`); renderGrid(); if (pf.my.open) renderMy();
    } catch (err) { done(); toast(err.message); }
  });

