  /* =====================================================================
     RAQBO smart filters: listing type, verification, size, urgency,
     auction closing time — with live counts and removable filter chips
     ===================================================================== */
  var fx = { kind: 'all', vmode: 'all', sizeMin: '', sizeMax: '', urgency: '', closing: false, adv: '', fresh: false, reduced: false, open: false };
  const FX_KIND = [['all', 'All listings'], ['normal', 'Normal listings'], ['urgent', 'QuickSell'], ['auction', 'Auctions'], ['direct', 'RAQBO Direct']];
  const FX_V = [['all', 'All'], ['verified', 'Verified'], ['unverified', 'Unverified']];
  const fxKindOf = (l) => (l.saleMode === 'urgent' && dl.urgent.has(l.id) ? 'urgent' : ax.byListing.has(l.id) ? 'auction' : 'normal');
  function fxMatch(l, skip) {
    if (skip !== 'kind' && fx.kind !== 'all') { if (fx.kind === 'direct' ? !l.raqboRole : fxKindOf(l) !== fx.kind) return false; }
    if (skip !== 'verify' && fx.vmode !== 'all' && !l.sample) { if ((fx.vmode === 'verified') !== vfIsVerified(l.id)) return false; }
    if (skip !== 'verify' && fx.vmode !== 'all' && l.sample) return false;
    if (fx.sizeMin !== '' || fx.sizeMax !== '') { const m = marlaOf(l); if (!m) return false; if (fx.sizeMin !== '' && m < +fx.sizeMin) return false; if (fx.sizeMax !== '' && m > +fx.sizeMax) return false; }
    if (fx.urgency) { const t = dl.urgent.get(l.id); if (!t || (fx.urgency === '7_days' ? t !== '7_days' : !['7_days', '30_days'].includes(t))) return false; }
    if (fx.adv && (fx.adv === 'Owner' ? l.role !== 'Owner' : fx.adv === 'Agent' ? l.role !== 'Agent' : ['Owner', 'Agent'].includes(l.role))) return false;
    if (fx.fresh && !v3Fresh(l)) return false;
    if (fx.reduced && !v3Reduced(l)) return false;
    if (fx.closing) { const a = ax.byListing.get(l.id); if (!a || !['live', 'closing'].includes(a.phase) || Date.parse(a.end_at) - auNow() > 24 * 3600e3) return false; }
    return true;
  }
  const fxSig = () => [fx.kind, fx.vmode, fx.sizeMin, fx.sizeMax, fx.urgency, fx.closing, fx.adv, fx.fresh, fx.reduced].join(',');
  const fxMoreCount = () => [fx.sizeMin !== '' || fx.sizeMax !== '', !!fx.urgency, fx.closing, !!fx.adv, fx.fresh, fx.reduced].filter(Boolean).length;
  function fxSort(list, sort) {
    if (sort === 'closing') { const end = (l) => { const a = ax.byListing.get(l.id); return a && ['live', 'closing', 'upcoming'].includes(a.phase) ? Date.parse(a.end_at) : Infinity; }; list.sort((a, b) => end(a) - end(b) || (b.publishedAt || 0) - (a.publishedAt || 0)); return true; }
    if (sort === 'newest') { list.sort((a, b) => (b.publishedAt || b.createdAt || 0) - (a.publishedAt || a.createdAt || 0)); return true; }
    if (sort === 'verified') { list.sort((a, b) => (vfIsVerified(b.id) - vfIsVerified(a.id)) || ((coreVerifLevel(b.id) === 'legal') - (coreVerifLevel(a.id) === 'legal')) || (b.publishedAt || 0) - (a.publishedAt || 0)); return true; }
    return false;
  }
  function fxBar() {
    const host = $('.results-bar'); if (!host) return;
    let bar = $('.fx-bar'); if (!bar) { bar = document.createElement('div'); bar.className = 'fx-bar'; host.after(bar); }
    const base = (skip) => filtered(skip);
    const kList = base('kind'); const vList = base('verify');
    const kc = { all: kList.length, normal: kList.filter((l) => fxKindOf(l) === 'normal').length, urgent: kList.filter((l) => fxKindOf(l) === 'urgent').length, auction: kList.filter((l) => fxKindOf(l) === 'auction').length, direct: kList.filter((l) => l.raqboRole).length };
    const real = vList.filter((l) => !l.sample); const vc = { all: vList.length, verified: real.filter((l) => vfIsVerified(l.id)).length, unverified: real.filter((l) => !vfIsVerified(l.id)).length };
    const n = fxMoreCount();
    bar.innerHTML = `<div class="fx-kinds" role="group" aria-label="Listing type">${FX_KIND.map(([k, t]) => `<button type="button" data-fx="kind" data-v="${k}" class="${fx.kind === k ? 'on' : ''} fx-k-${k}" aria-pressed="${fx.kind === k}">${k === 'urgent' ? '<i class="fx-dot urg"></i>' : k === 'auction' ? `<i class="fx-dot ${ax.list.some((a) => a.phase === 'live' || a.phase === 'closing') ? 'live' : ''}"></i>` : ''}${esc(t)}<em>${kc[k]}</em></button>`).join('')}</div>
      <div class="fx-row2"><div class="fx-verify" role="group" aria-label="Verification">${FX_V.map(([k, t]) => `<button type="button" data-fx="v" data-v="${k}" class="${fx.vmode === k ? 'on' : ''} fx-v-${k}" aria-pressed="${fx.vmode === k}">${k === 'verified' ? DI(DIC.check, 13) : k === 'unverified' ? '<i class="fx-ring"></i>' : DI(DIC.shield, 13)} ${esc(t)}<em>${vc[k]}</em></button>`).join('')}<button type="button" class="fx-help" data-fx="vinfo" aria-label="What do Verified and Unverified mean?">?</button></div>
        <button type="button" class="fx-more ${n ? 'on' : ''}" data-fx="more" aria-expanded="${fx.open}">${DI(DIC.list || DIC.grid, 15)} More filters${n ? ` <em>${n}</em>` : ''}</button></div>
      <div class="fx-panel" ${fx.open ? '' : 'hidden'}>
        <label><span>Size (marla)</span><div class="fx-range"><input type="number" min="0" step="0.5" data-fx-in="sizeMin" placeholder="Min" value="${esc(fx.sizeMin)}"><b>–</b><input type="number" min="0" step="0.5" data-fx-in="sizeMax" placeholder="Max" value="${esc(fx.sizeMax)}"></div><small>1 kanal = 20 marla</small></label>
        <div class="fx-presets">${[['', 5, 'Up to 5 marla'], [5, 10, '5 – 10 marla'], [10, 20, '10 marla – 1 kanal'], [20, '', '1 kanal +']].map(([a, b, t]) => `<button type="button" data-fx="size" data-a="${a}" data-b="${b}" class="${String(fx.sizeMin) === String(a) && String(fx.sizeMax) === String(b) ? 'on' : ''}">${t}</button>`).join('')}</div>
        <label><span>QuickSell — owner wants to sell</span><select data-fx-in="urgency"><option value="">Any time</option><option value="7_days" ${fx.urgency === '7_days' ? 'selected' : ''}>Within 7 days</option><option value="30_days" ${fx.urgency === '30_days' ? 'selected' : ''}>Within 30 days</option></select></label>
        <label><span>Advertiser</span><select data-fx-in="adv"><option value="">Anyone</option><option value="Owner" ${fx.adv === 'Owner' ? 'selected' : ''}>Direct owner</option><option value="Agent" ${fx.adv === 'Agent' ? 'selected' : ''}>Agent</option><option value="Other" ${fx.adv === 'Other' ? 'selected' : ''}>Builder / developer</option></select></label>
        <div class="fx-checks"><label class="fx-chk"><input type="checkbox" data-fx-in="fresh" ${fx.fresh ? 'checked' : ''}> Newly listed (last 7 days)</label><label class="fx-chk"><input type="checkbox" data-fx-in="reduced" ${fx.reduced ? 'checked' : ''}> Price reduced</label><label class="fx-chk"><input type="checkbox" data-fx-in="closing" ${fx.closing ? 'checked' : ''}> Auctions closing within 24 hours</label></div>
        <div class="fx-panel-foot"><button type="button" class="link-button" data-fx="reset-more">Reset these</button><button type="button" class="button button-primary" data-fx="close">Show ${esc(filtered().length)} properties</button></div>
      </div>`;
  }
  function fxChips() {
    const c = [];
    if (fx.kind !== 'all') c.push(['kind', FX_KIND.find((x) => x[0] === fx.kind)[1]]);
    if (fx.vmode !== 'all') c.push(['v', fx.vmode === 'verified' ? 'Verified only' : 'Unverified only']);
    if (fx.sizeMin !== '' || fx.sizeMax !== '') c.push(['size', fx.sizeMin !== '' && fx.sizeMax !== '' ? `${fx.sizeMin}–${fx.sizeMax} marla` : fx.sizeMin !== '' ? `${fx.sizeMin}+ marla` : `Up to ${fx.sizeMax} marla`]);
    if (fx.urgency) c.push(['urgency', fx.urgency === '7_days' ? 'Sell within 7 days' : 'Sell within 30 days']);
    if (fx.closing) c.push(['closing', 'Closing within 24 h']);
    if (fx.adv) c.push(['adv', fx.adv === 'Owner' ? 'Direct owner' : fx.adv === 'Agent' ? 'Agent' : 'Builder / developer']);
    if (fx.fresh) c.push(['fresh', 'Newly listed']);
    if (fx.reduced) c.push(['reduced', 'Price reduced']);
    return c.map(([k, t]) => `<button type="button" class="filter-chip fx-chip" data-fx="drop" data-k="${k}">${esc(t)} <span aria-hidden="true">×</span><span class="sr-only">Remove</span></button>`).join('');
  }
  function fxReset() { Object.assign(fx, { kind: 'all', vmode: 'all', sizeMin: '', sizeMax: '', urgency: '', closing: false, adv: '', fresh: false, reduced: false }); }
  function fxApply() { renderGrid(); }
  function fxVInfo(anchor) {
    $$('.fx-pop').forEach((p) => p.remove());
    const p = document.createElement('div'); p.className = 'fx-pop'; p.setAttribute('role', 'dialog');
    p.innerHTML = `<button type="button" class="fx-pop-x" data-fx="pop-x" aria-label="Close">×</button><b>What the badges mean</b>
      <div><span class="vb vb-ok vb-legal">${DI(DIC.check, 12)} Legal verified</span><small>RAQBO's legal team reviewed title, records and encumbrances.</small></div>
      <div><span class="vb vb-ok">${DI(DIC.check, 12)} RAQBO Verified</span><small>The owner's ownership documents were checked by RAQBO.</small></div>
      <div><span class="vb vb-no">Unverified</span><small>Listed free; RAQBO has not checked the documents yet. Check them yourself or ask RAQBO before paying anything.</small></div>
      <p>Badges show what RAQBO checked and when — they are not a government guarantee of title.</p>
      <div class="fx-pop-act"><button type="button" class="link-button" data-service="verification">Ask RAQBO to verify a property</button>${db.session ? '<button type="button" class="link-button" data-my="properties">Verify my listing</button>' : ''}</div>`;
    document.body.append(p);
    const r = anchor.getBoundingClientRect(); const w = Math.min(320, innerWidth - 24);
    p.style.width = w + 'px'; p.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px'; p.style.top = (r.bottom + scrollY + 8) + 'px';
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.fx-pop') && !e.target.closest('[data-fx="vinfo"]') && !e.target.closest('.vb')) $$('.fx-pop').forEach((p) => p.remove());
    const vb = e.target.closest('.property-card .vb, .pp-badge.vb-no, .pp-badge.vb-ok'); if (vb) { e.preventDefault(); e.stopPropagation(); fxVInfo(vb); return; }
    const b = e.target.closest('[data-fx]'); if (!b) return; const a = b.dataset.fx;
    if (a === 'kind') { fx.kind = b.dataset.v; if (fx.kind === 'auction' || fx.kind === 'urgent') setDeal('sale'); fxApply(); }
    else if (a === 'v') { fx.vmode = b.dataset.v; fxApply(); }
    else if (a === 'vinfo') fxVInfo(b);
    else if (a === 'pop-x') $$('.fx-pop').forEach((p) => p.remove());
    else if (a === 'more') { fx.open = !fx.open; const p = $('.fx-panel'); if (p) p.hidden = !fx.open; b.setAttribute('aria-expanded', String(fx.open)); }
    else if (a === 'close') { fx.open = false; fxApply(); scrollToResults(); }
    else if (a === 'size') { fx.sizeMin = b.dataset.a; fx.sizeMax = b.dataset.b; fxApply(); }
    else if (a === 'reset-more') { Object.assign(fx, { sizeMin: '', sizeMax: '', urgency: '', closing: false, adv: '', fresh: false, reduced: false }); fxApply(); }
    else if (a === 'drop') { const k = b.dataset.k; if (k === 'kind') fx.kind = 'all'; else if (k === 'v') fx.vmode = 'all'; else if (k === 'size') { fx.sizeMin = ''; fx.sizeMax = ''; } else if (k === 'urgency') fx.urgency = ''; else if (k === 'closing') fx.closing = false; else if (k === 'adv') fx.adv = ''; else if (k === 'fresh') fx.fresh = false; else if (k === 'reduced') fx.reduced = false; fxApply(); }
  }, true);
  document.addEventListener('change', (e) => { const i = e.target.closest('[data-fx-in]'); if (!i) return; const k = i.dataset.fxIn; fx[k] = i.type === 'checkbox' ? i.checked : i.value; if (k === 'closing' && fx.closing) fx.kind = fx.kind === 'all' ? 'all' : fx.kind; fxApply(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.fx-pop').forEach((p) => p.remove()); });

