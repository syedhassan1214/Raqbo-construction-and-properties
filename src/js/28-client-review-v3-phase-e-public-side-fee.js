  /* =====================================================================
     Client review v3 (Phase E, public side): Fees & refund rules,
     construction cost calculator, RAQBO price guide, advertiser profiles,
     complaints from members, WhatsApp click tracking, optional analytics.
     Supabase: update_21_admin.sql · Demo mode: this browser only
     ===================================================================== */
  var V3E_RATES = { grey: 3150, economy: 5200, standard: 6800, premium: 10000 };   // PKR per sq ft — indicative Lahore 2026, admin-editable
  const v3eRates = () => ({ ...V3E_RATES, ...((SB ? (pf.pub && pf.pub.cost_rates) : store.get('v3e.rates', null)) || {}) });
  const v3eRefundRules = () => (SB ? (pf.pub && pf.pub.refund_rules) : store.get('v3e.refund', '')) || '';
  const v3eClose = () => { closeNavMenus(); if (pf.my.open) closeMy(); if ($('.modal-backdrop')) closeModal(); };

  // ---------- Fees & refund rules (#fees) ----------
  function openFees() {
    v3eClose(); const g = gw.pub || {}; const p = pf.pub || {}; const pct = (x) => (x != null ? `${x}%` : 'Set by RAQBO');
    const rows = [
      ['Listing a property', 'Free', 'Every listing is reviewed by RAQBO before it goes live.'],
      ['Identity Verified (Level 1)', 'Free', 'CNIC check for the advertiser.'],
      ['Documents Reviewed (Level 2)', g.verification_fee ? rs(g.verification_fee) : 'Set by RAQBO', 'Not refunded once the review has started; refunded in full if RAQBO cannot start it.'],
      ['Enhanced Property Verification (Level 3)', p.legal_verification_fee ? rs(p.legal_verification_fee) : 'Set by RAQBO', 'Scope confirmed in writing before payment.'],
      ['QuickSell commission', pct(p.urgent_commission_pct), 'Payable only when the property is sold through RAQBO.'],
      ['Auction — seller commission', pct(p.auction_seller_commission_pct), 'Payable only on a completed sale.'],
      ['Auction — buyer premium', pct(p.auction_buyer_premium_pct), 'Added to the winning bid.'],
      ['Auction bidder deposit', p.auction_deposit_default ? rs(p.auction_deposit_default) : 'Shown on each auction', 'Returned to unsuccessful bidders after the auction closes.'],
      ['Featured / sponsored listing', 'Shown when you choose it', 'Sponsored listings are always labelled “Sponsored”.']];
    const def = ['Payments are made only to RAQBO\'s official bank account, never to an individual. Keep the transaction ID.', 'If RAQBO cannot provide a paid service, the fee is refunded in full.', 'Refunds are made to the account the payment came from, usually within 10 working days of approval.', 'Auction deposits of unsuccessful bidders are returned after the auction closes. A winning bidder who does not complete the purchase may lose the deposit, as stated in the auction terms.', 'Every refund has a reference number and is recorded in RAQBO\'s refunds register.', 'Disagree with a decision? Open a complaint — a different team member reviews it.'];
    const custom = v3eRefundRules().split('\n').map((x) => x.trim()).filter(Boolean);
    const card = openModal(`<div class="v3e-page"><div class="eyebrow"><span></span> CLEAR PRICING</div><h2>Fees &amp; refund rules</h2><p class="modal-lead">Every RAQBO fee in one place. Fees for other services are shown on each service and confirmed before any work starts.</p>
      <table class="gw-table v3e-fees"><thead><tr><th>What</th><th>Fee</th><th>Notes</th></tr></thead><tbody>${rows.map(([a, b, c]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table>
      <h3>Refund rules</h3><ol class="v3e-rules">${(custom.length ? custom : def).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      <div class="button-row"><button type="button" class="button button-primary" data-v3s="catalog">See all services</button><button type="button" class="button button-outline" data-v3e="complaint">Open a complaint</button></div></div>`, { wide: true, label: 'Fees and refund rules' });
    card.classList.add('gw-card');
  }

  // ---------- Construction cost calculator (#cost-calculator) ----------
  function openCostCalc() {
    v3eClose(); const R = v3eRates();
    const card = openModal(`<div class="v3e-page v3e-calc"><div class="eyebrow"><span></span> PLANNING TOOL</div><h2>Construction cost calculator</h2><p class="modal-lead">A quick, indicative estimate for building a house in Pakistan. Rates vary by city, design and market prices — get a site-specific quote before you decide.</p>
      <form class="v3e-cform" data-v3e-calc novalidate>
        <label>Plot size<span class="v3e-in"><input name="size" type="number" min="1" step="any" value="10"><select name="unit"><option>Marla</option><option>Kanal</option></select></span></label>
        <label>Floors<select name="floors"><option value="1">Single storey</option><option value="2" selected>Double storey</option><option value="3">Triple storey</option></select></label>
        <label>Covered area (sq ft) <small>— leave empty to estimate</small><input name="covered" type="number" min="100" placeholder="auto"></label>
        <label>Build type<select name="q"><option value="grey">Grey structure only</option><option value="economy">Complete — economy finish</option><option value="standard" selected>Complete — standard finish</option><option value="premium">Complete — premium finish</option></select></label>
      </form>
      <div class="v3e-out" data-v3e-out></div>
      <p class="form-hint">Rates used (PKR per sq ft): grey ${esc(R.grey.toLocaleString('en-US'))} · economy ${esc(R.economy.toLocaleString('en-US'))} · standard ${esc(R.standard.toLocaleString('en-US'))} · premium ${esc(R.premium.toLocaleString('en-US'))}. Material quantities are rough rules of thumb for a grey structure. Not a quotation.</p>
      <div class="button-row"><button type="button" class="button button-primary" data-v3s="req" data-k="construction">Get a construction quote</button><button type="button" class="button button-outline" data-v3s="req" data-k="bulk_materials">Bulk material enquiry</button></div></div>`, { wide: true, label: 'Construction cost calculator' });
    card.classList.add('gw-card'); const f = $('[data-v3e-calc]', card); const paint = () => v3eCalcPaint(f, $('[data-v3e-out]', card)); f.addEventListener('input', paint); f.addEventListener('change', paint); paint();
  }
  function v3eCalc(o) {
    const R = v3eRates(); const marla = (Number(o.size) || 0) * (o.unit === 'Kanal' ? 20 : 1); const floors = Math.max(1, Number(o.floors) || 1);
    const covered = Number(o.covered) > 0 ? Number(o.covered) : Math.round(marla * 225 * (marla <= 5 ? 0.9 : marla <= 10 ? 0.8 : 0.7) * floors);
    const rate = R[o.q] || R.standard; const total = covered * rate; const grey = covered * R.grey;
    return { marla, covered, rate, total, grey, finish: Math.max(0, total - grey), cement: Math.round(covered * 0.45), steelT: Math.round(covered * 3.6 / 100) / 10, bricks: Math.round(covered * 22 / 1000) * 1000 };
  }
  function v3eCalcPaint(f, out) {
    const c = v3eCalc({ size: f.size.value, unit: f.unit.value, floors: f.floors.value, covered: f.covered.value, q: f.q.value });
    if (!c.covered) { out.innerHTML = '<p class="gw-mini">Enter the plot size.</p>'; return; }
    out.innerHTML = `<div class="v3e-total"><small>Estimated cost</small><b>${esc(fmtPrice(c.total))}</b><span>${esc(c.covered.toLocaleString('en-US'))} sq ft covered × ${esc(rs(c.rate))} / sq ft</span></div>
      <div class="v3e-break"><div><small>Grey structure</small><b>${esc(fmtPrice(c.grey))}</b></div>${c.finish ? `<div><small>Finishing</small><b>${esc(fmtPrice(c.finish))}</b></div>` : ''}<div><small>Cement (approx.)</small><b>${esc(c.cement.toLocaleString('en-US'))} bags</b></div><div><small>Steel (approx.)</small><b>${esc(c.steelT)} tons</b></div><div><small>Bricks (approx.)</small><b>${esc(c.bricks.toLocaleString('en-US'))}</b></div></div>`;
  }

  // ---------- RAQBO price guide (#price-guide) and the "compared with the area" line ----------
  function v3iStats() {
    const rows = {}; db.listings.filter((l) => !l.sample && l.status === 'published' && l.purpose === 'sale' && ppm(l) > 0).forEach((l) => { const k = `${l.city}|${l.area}|${l.type}`; (rows[k] = rows[k] || { city: l.city, area: l.area, type: l.type, list: [] }).list.push(l); });
    return Object.values(rows).map((r) => { const v = r.list.map(ppm).sort((a, b) => a - b); return { ...r, n: v.length, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), lo: v[0], hi: v[v.length - 1], cuts: r.list.filter((l) => l.prevPrice && l.prevPrice > l.price).length }; }).sort((a, b) => b.n - a.n);
  }
  function v3iBox(l) {
    if (!l || l.sample || l.purpose !== 'sale' || !(ppm(l) > 0)) return '';
    const peers = db.listings.filter((x) => x.id !== l.id && !x.sample && x.status === 'published' && x.purpose === 'sale' && x.type === l.type && x.city === l.city && x.area === l.area && ppm(x) > 0);
    if (peers.length < 2) return '';
    const avg = peers.reduce((a, x) => a + ppm(x), 0) / peers.length; const d = Math.round(((ppm(l) - avg) / avg) * 100);
    return `<section class="pp-section"><div class="v3i-line">${DI(DIC.trend, 18)}<span>${d === 0 ? 'In line with' : `<b>${Math.abs(d)}% ${d > 0 ? 'above' : 'below'}</b>`} the average asking price per marla of ${peers.length} other ${esc(l.type.toLowerCase())} listings in ${esc(l.area)} on RAQBO (${esc(fmtPrice(Math.round(avg)))} / marla). Asking prices only — not a valuation.</span></div></section>`;
  }
  function openPriceGuide(city) {
    v3eClose(); const all = v3iStats(); const cities = [...new Set(all.map((r) => r.city))].sort(); const c = city && cities.includes(city) ? city : '';
    const rows = all.filter((r) => !c || r.city === c);
    const card = openModal(`<div class="v3e-page"><div class="eyebrow"><span></span> PRICE INTELLIGENCE</div><h2>RAQBO price guide</h2><p class="modal-lead">Average asking price per marla from approved listings on RAQBO, by area and property type. Asking prices are not sale prices or valuations.</p>
      <div class="v3e-filter"><select data-v3e-city aria-label="City"><option value="">All cities</option>${cities.map((x) => `<option ${x === c ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      ${rows.length ? `<div class="v3c-wrap"><table class="gw-table v3e-guide"><thead><tr><th>Area</th><th>Type</th><th>Listings</th><th>Average / marla</th><th>Range / marla</th><th>Price cuts</th></tr></thead><tbody>${rows.slice(0, 80).map((r) => `<tr><td><b>${esc(r.area)}</b><br><small>${esc(r.city)}</small></td><td>${esc(r.type)}</td><td>${esc(r.n)}</td><td><b>${esc(fmtPrice(r.avg))}</b></td><td>${esc(fmtPrice(r.lo))} – ${esc(fmtPrice(r.hi))}</td><td>${r.cuts ? esc(r.cuts) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty">Not enough approved listings yet. The guide fills in as owners list their properties.</div>'}
      <div class="button-row"><button type="button" class="button button-outline" data-v3s="req" data-k="valuation">Ask RAQBO for valuation help</button></div></div>`, { wide: true, label: 'Price guide' });
    card.classList.add('gw-card'); const s = $('[data-v3e-city]', card); if (s) s.addEventListener('change', () => openPriceGuide(s.value));
  }

  // ---------- Advertiser profiles (#advertiser/<id>) ----------
  function v3aLink(l) { return l && !l.sample && l.ownerId ? `<button type="button" class="link-button v3a-link" data-v3e="advertiser" data-id="${esc(l.ownerId)}">${DI(DIC.user, 14)} See all properties by this advertiser</button>` : ''; }
  function openAdvertiser(id) {
    v3eClose(); const mine = db.listings.filter((l) => !l.sample && l.ownerId === id && l.status === 'published'); const any = db.listings.find((l) => l.ownerId === id);
    if (!any) { toast('This advertiser has no live properties.'); return; }
    const name = any.ownerName || any.advertiser || 'Advertiser'; const role = any.role || 'Owner'; const since = Math.min(...db.listings.filter((l) => l.ownerId === id).map((l) => l.createdAt || Date.now()));
    const ver = mine.filter((l) => vfIsVerified(l.id)).length; const idv = pf.idv && pf.idv.has(id);
    const card = openModal(`<div class="v3e-page v3a"><div class="v3a-head"><span class="mt-avatar">${esc(String(name).split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase())}</span><div><div class="eyebrow"><span></span> ${esc(role.toUpperCase())} PROFILE</div><h2>${esc(name)}</h2><p>${idv ? `<span class="id-chip">${DI(DIC.check, 11)} Identity Verified</span> · ` : ''}On RAQBO since ${esc(fmtDay(since))}</p></div></div>
      <div class="my-tiles"><div class="my-tile"><small>Live properties</small><b>${mine.length}</b><span>approved by RAQBO</span></div><div class="my-tile"><small>RAQBO Verified</small><b>${ver}</b><span>documents reviewed</span></div><div class="my-tile"><small>Cities</small><b>${new Set(mine.map((l) => l.city)).size}</b><span>${esc([...new Set(mine.map((l) => l.city))].slice(0, 3).join(', '))}</span></div></div>
      <div class="my-grid">${mine.map(railCard).join('') || '<div class="admin-empty">No live properties right now.</div>'}</div>
      <p class="form-hint">Contact details are shared through RAQBO messages. Report an advertiser from any of their listings if something looks wrong.</p></div>`, { wide: true, label: 'Advertiser profile' });
    card.classList.add('gw-card'); hydrate(card);
  }

  // ---------- Complaints (members) ----------
  const V3E_KINDS = { listing: 'A property listing', advertiser: 'An advertiser or agent', order: 'A construction-material order', service: 'A RAQBO service', auction: 'An auction', quicksell: 'A QuickSell request', payment: 'A payment or refund', other: 'Something else' };
  const V3E = SB ? {
    submit: async (k, r, d, amt) => { const { data, error } = await SB.rpc('submit_complaint', { p_kind: k, p_subject_ref: r, p_details: d, p_refund: amt || null }); if (error) throw new Error(/could not find the function/i.test(error.message || '') ? 'Complaints are being set up. (Admin: run update_21_admin.sql.)' : error.message); return data; },
    mine: async () => { const { data, error } = await SB.from('complaints').select('*').order('created_at', { ascending: false }); if (error) throw new Error(/does not exist|schema cache/i.test(error.message || '') ? 'Complaints are being set up.' : error.message); return data || []; }
  } : {
    submit: async (k, r, d, amt) => { if (String(d).trim().length < 10) throw new Error('Describe the problem (at least 10 characters).'); const all = store.get('v3e.complaints', []); const ref = 'RQ-CMP-' + Math.random().toString(36).slice(2, 10).toUpperCase(); all.unshift({ id: uid('c'), ref, user_id: db.session.userId, name: db.session.name, kind: k, subject_ref: r, details: d, refund_requested: amt || null, status: 'open', resolution: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); store.set('v3e.complaints', all); return ref; },
    mine: async () => store.get('v3e.complaints', []).filter((c) => c.user_id === db.session.userId)
  };
  function openComplaint(kind, ref) {
    requireSignIn(() => {
      v3eClose();
      const card = openModal(`<div class="eyebrow"><span></span> COMPLAINTS &amp; DISPUTES</div><h2>Tell us what went wrong</h2><p class="modal-lead">A RAQBO team member reviews every complaint and replies in My RAQBO → Complaints. You get a reference number straight away.</p>
        <form class="modal-form" data-v3e-cform novalidate><label>What is it about?<select name="kind">${Object.entries(V3E_KINDS).map(([k, v]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Reference (optional)<input name="ref" maxlength="80" value="${esc(ref || '')}" placeholder="e.g. RQ-LST-…, order or request number"></label>
        <label>What happened?<textarea name="details" maxlength="3000" rows="5" placeholder="Dates, amounts and what you expected"></textarea></label>
        <label>Refund you are asking for (PKR, optional)<input name="amount" type="number" min="1"></label>
        <div class="form-error" hidden></div><button class="button button-primary modal-submit" type="submit">Send complaint</button></form>`, { label: 'Complaint' });
      $('form', card).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const errs = []; if (f.details.value.trim().length < 10) errs.push(['details', 'Describe the problem (at least 10 characters).']); if (showErrors(f, errs)) return;
        const done = busy($('[type=submit]', f), 'Sending…');
        try { const ref2 = await V3E.submit(f.kind.value, f.ref.value.trim(), f.details.value.trim(), f.amount.value ? Math.round(+f.amount.value) : null); setBody(card, successHTML('Complaint received', '<p>RAQBO will review it and reply in My RAQBO → Complaints. A different team member reviews any appeal.</p>', ref2, '<button type="button" class="button button-primary" data-my="complaints">Track it</button>')); }
        catch (err) { done(); showErrors(f, [['details', err.message]]); }
      });
    });
  }
  MY.splice(MY.findIndex((m) => m.id === 'identity'), 0, { id: 'complaints', label: 'Complaints', icon: 'alert' });
  MY_RENDER.complaints = async () => {
    let rows = []; try { rows = await V3E.mine(); } catch (err) { return `${myHead('COMPLAINTS', 'Complaints')}<div class="admin-empty">${esc(err.message)}</div>`; }
    const st = { open: 'Received', investigating: 'Being investigated', resolved: 'Resolved', rejected: 'Closed' };
    return `${myHead('COMPLAINTS', 'Complaints & disputes', 'Every complaint gets a reference number and a written outcome.')}
      ${rows.length ? rows.map((c) => `<article class="svc-item"><div class="svc-top"><div><b>${esc(V3E_KINDS[c.kind] || c.kind)}${c.subject_ref ? ' · ' + esc(c.subject_ref) : ''}</b><small>${esc(c.ref)} · sent ${esc(fmtDay(c.created_at))}${c.refund_requested ? ' · refund asked ' + esc(rs(c.refund_requested)) : ''}</small></div><span class="svc-st svc-${esc(c.status)}">${esc(st[c.status] || c.status)}</span></div><p class="svc-msg">${esc(c.details)}</p>${c.resolution ? `<p class="svc-note">${DI(DIC.chat, 14)} <span><b>RAQBO:</b> ${esc(c.resolution)}</span></p>` : ''}</article>`).join('') : '<div class="admin-empty">No complaints. We hope it stays that way.</div>'}
      <div class="button-row"><button type="button" class="button button-primary" data-v3e="complaint">Open a complaint</button></div>`;
  };

  // ---------- WhatsApp click tracking (counts only — no personal data) ----------
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="wa.me"], .button-whatsapp, [data-wa]'); if (!a) return;
    const m = /#property\/([^/?]+)/.exec(location.hash); const lid = (a.closest('[data-open]') || {}).dataset ? (a.closest('[data-open]') || {}).dataset.open : null; const id = lid || (m && m[1]) || null;
    const src = a.closest('.site-footer') ? 'footer' : a.closest('.mk-vcontact, .mk-card') ? 'supplier' : id ? 'property' : a.closest('.modal-card') ? 'form' : 'site';
    if (SB) { try { SB.rpc('track_whatsapp', { p_listing: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null, p_source: src }).then(() => {}, () => {}); } catch { /* ignore */ } }
    else { const w = store.get('v3e.wa', []); w.push({ id, src, at: Date.now() }); store.set('v3e.wa', w.slice(-500)); }
  }, true);

  // ---------- Optional analytics (Google Analytics 4 — only when an ID is set in admin) ----------
  function v3eAnalytics() {
    const id = SB ? (pf.pub && pf.pub.analytics_id) : store.get('v3e.ga', ''); if (!id || !/^G-[A-Z0-9]{4,14}$/.test(id) || window.__raqboGa) return; window.__raqboGa = 1;
    const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + id; document.head.append(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); }; window.gtag('js', new Date()); window.gtag('config', id, { anonymize_ip: true });
  }
  setTimeout(v3eAnalytics, 2500);

  // ---------- Links: footer, catalogue, hashes ----------
  (function v3eFooter() {
    const col = $$('.site-footer .footer-column').find((c) => /Services/i.test(($('h3', c) || {}).textContent || '')); if (!col || $('.v3e-flinks', col)) return;
    col.insertAdjacentHTML('beforeend', '<span class="v3e-flinks"></span><button type="button" data-v3s="catalog">RAQBO Connect — all services</button><button type="button" data-v3s="overseas">RAQBO Overseas</button><button type="button" data-v3e="fees">Fees &amp; refund rules</button><button type="button" data-v3e="calc">Construction cost calculator</button><button type="button" data-v3e="prices">Price guide</button><button type="button" data-v3e="complaint">Complaints</button>');
  })();
  V3S_GROUPS.find((g) => g.key === 'support').items.push(['price_guide', 'Price guide', 'Average asking prices per marla by area, from approved RAQBO listings.', 'Free', false, null, 'data-v3e="prices"'], ['cost_calc', 'Construction cost calculator', 'An indicative cost for building your house, with rough material quantities.', 'Free', false, null, 'data-v3e="calc"'], ['fees_page', 'Fees & refund rules', 'Every RAQBO fee and how refunds work.', 'Free to read', false, null, 'data-v3e="fees"'], ['complaints', 'Complaints & disputes', 'Something went wrong? Get a reference number and a written outcome.', 'Free', false, null, 'data-v3e="complaint"']);
  V3S_GROUPS.find((g) => g.key === 'support').items.forEach(([k, t, d, fee, pro, fields, link]) => { if (!V3S_ALL[k]) V3S_ALL[k] = { k, t, d, fee, pro, fields, link, group: 'Property Support' }; });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v3e]'); if (!b) return; const a = b.dataset.v3e; e.preventDefault();
    if (a === 'fees') openFees(); else if (a === 'calc') openCostCalc(); else if (a === 'prices') openPriceGuide(''); else if (a === 'complaint') openComplaint(b.dataset.kind || '', b.dataset.ref || ''); else if (a === 'advertiser') openAdvertiser(b.dataset.id);
  });
  const V3E_HASH = { '#fees': () => openFees(), '#cost-calculator': () => openCostCalc(), '#price-guide': () => openPriceGuide(''), '#complaint': () => openComplaint('', '') };
  function v3eRoute() { const h = location.hash; if (V3E_HASH[h]) V3E_HASH[h](); else { const m = /^#advertiser\/(.+)$/.exec(h); if (m) openAdvertiser(decodeURIComponent(m[1])); } }
  addEventListener('hashchange', v3eRoute); if (V3E_HASH[location.hash] || /^#advertiser\//.test(location.hash)) setTimeout(v3eRoute, 700);

