  /* =====================================================================
     Client review v3 (acceptance round): Property Passport explainer page
     (#passport) reachable from the RAQBO Services menu and catalogue.
     ===================================================================== */
  function openPassportInfo() {
    closeNavMenus(); if (pf.my.open) closeMy(); if ($('.modal-backdrop')) closeModal();
    const rows = [['Unique RAQBO Property ID', 'Public'], ['Location, area and nearby landmarks', 'Public'], ['Category, dimensions and marla standard', 'Public'], ['Approved building plan, utilities and development details', 'Public'], ['Verification reports with number and QR check', 'Public summary'], ['Photograph and location history', 'Public'], ['Transactions recorded through RAQBO', 'Public'], ['Ownership information', 'Summary only (privacy rules)'], ['Land-record references (khasra, khewat, fard, plot no.)', 'Confidential — owner and RAQBO'], ['Ownership documents and CNIC copies', 'Confidential — owner and RAQBO']];
    const mine = db.listings.filter((l) => !l.sample && db.session && l.ownerId === db.session.userId);
    const card = openModal(`<div class="v3e-page"><div class="eyebrow"><span></span> PROPERTY PASSPORT</div><h2>One record for every property</h2><p class="modal-lead">Every property on RAQBO gets a Passport: a public summary anyone can check, and a confidential section that only the owner and RAQBO can open.</p>
      <table class="gw-table v3e-fees"><thead><tr><th>What the Passport holds</th><th>Who can see it</th></tr></thead><tbody>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${/Confidential/.test(b) ? `<span class="pass-conf">${esc(b)}</span>` : esc(b)}</td></tr>`).join('')}</tbody></table>
      <p class="form-hint">Open any property and tap <b>Property Passport</b> to see its record. A Passport is a record of information supplied and checked — not a government record or a guarantee of title.</p>
      <div class="button-row">${mine.length ? '<button type="button" class="button button-primary" data-my="properties">Passports of my properties</button>' : '<button type="button" class="button button-primary" data-action="list">List a property</button>'}<button type="button" class="button button-outline" data-v3="verified">About RAQBO Verified</button></div></div>`, { wide: true, label: 'Property Passport' });
    card.classList.add('gw-card');
  }
  V3S_GROUPS.find((g) => g.key === 'legal').items.push(['passport_page', 'Property Passport', 'A public summary and a confidential record for every property: ID, plans, reports, history and land-record references.', 'Free with every listing', false, null, 'data-v3p="passport"']);
  V3S_ALL.passport_page = { k: 'passport_page', t: 'Property Passport', d: '', fee: 'Free with every listing', link: 'data-v3p="passport"', group: 'Legal & Documentation' };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-v3p="passport"]'); if (!b) return; e.preventDefault(); openPassportInfo(); });
  addEventListener('hashchange', () => { if (location.hash === '#passport') openPassportInfo(); });
  if (location.hash === '#passport') setTimeout(openPassportInfo, 800);

