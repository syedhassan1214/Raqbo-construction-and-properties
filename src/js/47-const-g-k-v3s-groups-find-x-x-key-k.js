  // =====================================================================
  { const g = (k) => V3S_GROUPS.find((x) => x.key === k);
    const tx = g('tx'); const legal = g('legal'); const inv = g('invest');
    if (tx) tx.items.push(
      ['commercial_search', 'Commercial & investment properties', 'Offices, shops, warehouses, buildings and income-generating property, with lease terms and commercial filters.', 'Free to search', false, null, 'data-rm="commercial"'],
      ['landlord_mgmt', 'Landlord property management', 'Track your properties, tenants, agreements, rent, expenses and maintenance in one place.', 'Free for self-managed · RAQBO-managed by agreement', false, null, 'data-rm="landlord"'],
      ['tenant_screening', 'Tenant screening & verification', 'A structured, consent-based check of a prospective tenant before you hand over the keys.', 'Fee on request', false, null, 'data-rm="screen-new"'],
      ['rent_collection', 'Rent collection records', 'Rent schedule, reminders and receipts. The rent goes straight to your own bank account.', 'Free with property management', false, null, 'data-rm="landlord"']);
    if (legal) legal.items.push(
      ['lease_generator', 'Lease & rental agreement generator', 'Enter the terms and download a properly formatted tenancy agreement to print and sign.', 'Free', false, null, 'data-rm="lease"'],
      ['legal_booking', 'Legal consultation booking', 'Book a qualified, bar-council-verified legal professional for property, tenancy, inheritance or dispute matters.', 'Fee shown before you confirm', false, null, 'data-rm="legal"'],
      ['tax_calc', 'Stamp duty & property tax calculator', 'Estimate stamp duty, registration and advance tax, with links to the official government portals.', 'Free', false, null, 'data-rm="tax"']);
    if (inv) inv.items.push(['yield_calc', 'Rental yield & investment return', 'Compare income-generating properties on gross and net yield before you buy.', 'Free', false, null, 'data-rm="yield"']);
    ['commercial_search', 'landlord_mgmt', 'tenant_screening', 'rent_collection', 'lease_generator', 'legal_booking', 'tax_calc', 'yield_calc'].forEach((k) => { if (typeof V3S_ALL === 'object') V3S_ALL[k] = { k, t: k, d: '', fee: '', link: `data-rm="${k}"`, group: '' }; }); }
  function rmMenu() {
    const q = $('.mega-quick'); if (q && !$('[data-rm="commercial"]', q)) q.insertAdjacentHTML('beforeend',
      '<button type="button" data-rm="commercial">Commercial &amp; investment</button><button type="button" data-rm="landlord">Property management</button><button type="button" data-rm="legal">Legal consultation</button><button type="button" data-rm="tax">Stamp duty &amp; tax</button>');
  }
  setTimeout(rmMenu, 700); document.addEventListener('click', () => setTimeout(rmMenu, 0), true);

