  // =====================================================================
  const rmIsCommercial = (l) => !!(l.commercialKind || l.commercial_kind || l.propertyType === 'Commercial' || l.property_type === 'Commercial');
  const rmCK = (l) => l.commercialKind || l.commercial_kind || '';
  function rmCFilter(list) {
    const f = rm.cf;
    return list.filter((l) => {
      if (l.status !== 'published' || !rmIsCommercial(l)) return false;
      if (f.kind && rmCK(l) !== f.kind) return false;
      if (f.purpose && l.purpose !== f.purpose) return false;
      if (f.city && !String(l.city || '').toLowerCase().includes(f.city.toLowerCase())) return false;
      if (f.min && !(l.price >= +f.min)) return false;
      if (f.max && !(l.price <= +f.max)) return false;
      const sz = +(l.coveredArea || l.covered_area || l.size || 0);
      if (f.sizeMin && !(sz >= +f.sizeMin)) return false;
      if (f.sizeMax && !(sz <= +f.sizeMax)) return false;
      if (f.floor && !String(l.floorNo || l.floor_no || '').toLowerCase().includes(f.floor.toLowerCase())) return false;
      if (f.parking && !(+(l.parkingSpaces || l.parking_spaces || 0) > 0)) return false;
      if (f.income && !(+(l.monthlyIncome || l.monthly_income || 0) > 0) && rmCK(l) !== 'income_property') return false;
      return true;
    });
  }
  function rmCCard(l) {
    const rentish = l.purpose === 'rent';
    const dep = l.securityDeposit || l.security_deposit; const lease = l.leaseMonths || l.lease_months;
    return `<article class="rm-ccard" data-open="${esc(l.id)}" tabindex="0">
      <div class="rm-ccard-top"><span class="rm-ckind">${esc(RM_CKIND[rmCK(l)] || 'Commercial')}</span><span class="rm-cpurp">${rentish ? 'For rent' : 'For sale'}</span></div>
      <b>${esc(l.title)}</b>
      <small>${DI(DIC.pin, 12)} ${esc([l.area, l.city].filter(Boolean).join(', '))}${(l.buildingName || l.building_name) ? ' · ' + esc(l.buildingName || l.building_name) : ''}</small>
      <div class="rm-cfacts"><span><em>${rentish ? 'Rent' : 'Price'}</em>${esc(fmtPrice(l.price))}${rentish ? '/' + esc(l.rentPeriod || l.rent_period || 'month') : ''}</span>
        <span><em>Area</em>${esc(l.size)} ${esc(l.sizeUnit || l.size_unit || '')}${(l.coveredArea || l.covered_area) ? ` · ${esc(l.coveredArea || l.covered_area)} sq ft covered` : ''}</span>
        ${(l.floorNo || l.floor_no) ? `<span><em>Floor</em>${esc(l.floorNo || l.floor_no)}</span>` : ''}
        ${dep ? `<span><em>Deposit</em>${esc(fmtPrice(dep))}</span>` : ''}
        ${lease ? `<span><em>Lease</em>${esc(lease)} months</span>` : ''}
        ${(l.parkingSpaces || l.parking_spaces) ? `<span><em>Parking</em>${esc(l.parkingSpaces || l.parking_spaces)}</span>` : ''}</div>
      <div class="rm-ccard-foot"><button type="button" class="link-button" data-rm="yield" data-id="${esc(l.id)}">Rental yield</button><button type="button" class="link-button" data-open="${esc(l.id)}">View &amp; enquire</button></div></article>`;
  }
  function openCommercial(opts = {}) {
    closeNavMenus(); if (pf.my.open) closeMy();
    Object.assign(rm.cf, opts.f || {});
    const card = openModal('<div class="rm-cpage"></div>', { wide: true, label: 'Commercial & Investment Properties' });
    card.classList.add('gw-card', 'ax-modal');
    try { if (location.hash !== '#commercial') history.replaceState(null, '', '#commercial'); } catch { /* ignore */ }
    rmPaintCommercial(card);
  }
  function rmPaintCommercial(card) {
    const host = $('.rm-cpage', card || document); if (!host) return;
    const all = db.listings.filter((l) => l.status === 'published' && rmIsCommercial(l));
    const list = rmCFilter(db.listings);
    const cities = [...new Set(all.map((l) => l.city).filter(Boolean))].sort();
    host.innerHTML = `<div class="rm-chero"><div><span class="rail-kicker">${DI(DIC.store, 14)} RAQBO COMMERCIAL</span><h2>Commercial &amp; Investment Properties</h2>
        <p>Explore commercial properties, investment opportunities and professional leasing services through RAQBO. Discover offices, shops, commercial buildings, warehouses and other income-generating properties with comprehensive information and convenient enquiry facilities.</p>
        <div class="button-row"><button type="button" class="button button-primary" data-rm="clist">List a commercial property</button><button type="button" class="button button-outline" data-v3s="leasing">Commercial leasing service</button><button type="button" class="button button-outline" data-rm="yield">Rental yield calculator</button></div></div>
        <div class="ax-hero-stats"><div><b>${all.filter((l) => l.purpose === 'rent').length}</b><small>To rent</small></div><div><b>${all.filter((l) => l.purpose === 'sale').length}</b><small>For sale</small></div><div><b>${cities.length}</b><small>Cities</small></div></div></div>
      <div class="rm-ctabs">${Object.entries(RM_CKIND).map(([k, t]) => `<button type="button" data-rm="ckind" data-v="${k}" class="${rm.cf.kind === k ? 'active' : ''}">${esc(t)} <em>${all.filter((l) => rmCK(l) === k).length}</em></button>`).join('')}${rm.cf.kind ? '<button type="button" data-rm="creset" class="rm-clear">Clear</button>' : ''}</div>
      <details class="oa-fbox" ${innerWidth > 820 ? 'open' : ''}><summary>Commercial search filters</summary>
        <form class="oa-filters rm-cfilters" data-rm-cfilters>
          <label>Looking to<select name="purpose"><option value="">Buy or rent</option><option value="rent" ${rm.cf.purpose === 'rent' ? 'selected' : ''}>Rent / lease</option><option value="sale" ${rm.cf.purpose === 'sale' ? 'selected' : ''}>Buy</option></select></label>
          <label>City<select name="city"><option value="">All cities</option>${cities.map((c) => `<option ${c === rm.cf.city ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label>Property kind<select name="kind"><option value="">All commercial</option>${Object.entries(RM_CKIND).map(([k, t]) => `<option value="${k}" ${rm.cf.kind === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label>Floor<input name="floor" value="${esc(rm.cf.floor)}" placeholder="e.g. Ground, 3rd"></label>
          <label>Covered area (sq ft)<span class="oa-pair"><input name="sizeMin" type="number" min="0" value="${esc(rm.cf.sizeMin)}" placeholder="Min"><input name="sizeMax" type="number" min="0" value="${esc(rm.cf.sizeMax)}" placeholder="Max"></span></label>
          <label>Price / rent (PKR)<span class="oa-pair"><input name="min" type="number" min="0" value="${esc(rm.cf.min)}" placeholder="Min"><input name="max" type="number" min="0" value="${esc(rm.cf.max)}" placeholder="Max"></span></label>
          <div class="oa-checks"><label><input type="checkbox" name="parking" ${rm.cf.parking ? 'checked' : ''}> Parking available</label><label><input type="checkbox" name="income" ${rm.cf.income ? 'checked' : ''}> Income-generating</label><button type="button" class="link-button" data-rm="creset">Clear filters</button></div></form></details>
      <div class="oa-results-head"><h3>${list.length} commercial propert${list.length === 1 ? 'y' : 'ies'}</h3></div>
      ${list.length ? `<div class="rm-cgrid">${list.map(rmCCard).join('')}</div>`
        : `<div class="admin-empty">${all.length ? 'No commercial property matches these filters.' : 'No commercial properties are published yet.'}<div class="button-row"><button type="button" class="button button-outline" data-rm="clist">List a commercial property</button>${all.length ? '<button type="button" class="button button-ghost" data-rm="creset">Clear filters</button>' : ''}</div></div>`}
      <p class="form-hint">${DI(DIC.info, 13)} Commercial listings show lease terms — deposit, advance, lease period, yearly increase, maintenance and parking — where the advertiser has given them.</p>`;
    hydrate(host);
  }

  // Rental yield & investment return calculator (section 8)
  function openYield(listing) {
    const l = listing || {};
    const price = l.price || ''; const rent = l.purpose === 'rent' ? l.price : (l.monthlyIncome || l.monthly_income || '');
    const card = openModal(`<div class="v3e-page"><div class="eyebrow"><span></span> INVESTMENT</div><h2>Rental Yield &amp; Investment Return</h2>
      <p class="modal-lead">Compare income-generating properties. Estimates only — no returns are guaranteed.</p>
      <form class="modal-form rm-yield" data-rm-yield>
        <div class="form-grid two"><label>Purchase price (PKR)<input name="price" type="number" min="1" value="${esc(price)}"></label><label>Monthly rental income (PKR)<input name="rent" type="number" min="0" value="${esc(rent)}"></label>
          <label>Annual maintenance (PKR)<input name="maint" type="number" min="0" value="0"></label><label>Property tax &amp; other yearly costs (PKR)<input name="tax" type="number" min="0" value="0"></label>
          <label>Vacancy allowance (%)<input name="vac" type="number" min="0" max="100" step="0.5" value="5"></label><label>Yearly rent increase (%)<input name="esc" type="number" min="0" max="100" step="0.5" value="10"></label></div>
      </form>
      <div class="rm-yout" data-rm-yout></div>
      <p class="form-hint">Gross yield is the yearly rent as a share of the price. Net yield takes off vacancy, maintenance, tax and other costs. Neither is a promise of future income.</p></div>`, { wide: true, label: 'Rental yield calculator' });
    card.classList.add('gw-card');
    rmYieldPaint($('[data-rm-yield]', card));
  }
  function rmYieldPaint(f) {
    if (!f) return; const out = $('[data-rm-yout]', f.closest('.v3e-page')); if (!out) return;
    const n = (k) => +(f[k] && f[k].value) || 0;
    const price = n('price'); const rent = n('rent'); const vac = Math.min(100, n('vac'));
    if (!(price > 0) || !(rent > 0)) { out.innerHTML = '<p class="form-hint">Enter the purchase price and the monthly rent to see the figures.</p>'; return; }
    const gross = rent * 12; const effective = gross * (1 - vac / 100); const costs = n('maint') + n('tax');
    const noi = effective - costs; const gy = (gross / price) * 100; const ny = (noi / price) * 100;
    const y5 = Math.round(gross * Math.pow(1 + n('esc') / 100, 4));
    out.innerHTML = `<div class="rm-ygrid">
      ${[['Gross annual rent', rs(Math.round(gross))], ['Gross rental yield', gy.toFixed(2) + '%'], ['After vacancy allowance', rs(Math.round(effective))], ['Yearly costs', rs(Math.round(costs))], ['Net operating income', rs(Math.round(noi))], ['Net rental yield', ny.toFixed(2) + '%'], ['Rent in year 5 (if it rises)', rs(y5)], ['Payback at today\'s net', noi > 0 ? Math.round(price / noi) + ' years' : '—']]
        .map(([k, v]) => `<div class="rm-y"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
      <p class="oa-govern">${DI(DIC.info, 13)} Estimates based on what you typed. Rents, costs and vacancy change — check with your own adviser before investing.</p>`;
  }

