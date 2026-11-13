  /* =====================================================================
     Client review v3 (Phase D): RAQBO Services catalogue in five groups
     (intro, request form, fee, tracking number), RAQBO Overseas Property
     Services, and the admin "Services & fees" page.
     Supabase: update_20_services.sql · Demo mode: this browser only
     ===================================================================== */
  const V3S_PRO = 'Provided by appropriately qualified professionals arranged by RAQBO.';
  const V3S_OVF = [['country', 'Country you live in', true], ['call_time', 'Best time to call (your local time)']];
  var V3S_GROUPS = [
    { key: 'tx', title: 'Property Transactions', icon: 'home', intro: 'Buy, sell, rent, lease and manage property with RAQBO beside you.', items: [
      ['buy_assist', 'Buying assistance', 'Tell us what you need. RAQBO shortlists suitable properties, arranges visits and supports you through the offer.', 'Free first consultation · any success fee agreed in writing first'],
      ['sell_assist', 'Selling assistance', 'RAQBO markets your property, screens enquiries, manages viewings and helps you compare offers.', 'Commission agreed in writing before marketing starts'],
      ['rent_assist', 'Renting & tenant finding', 'Find a tenant or a home to rent, with tenant checks and a written rent agreement.', 'Usually one month\'s rent — agreed in advance'],
      ['leasing', 'Commercial leasing', 'Shops, offices and warehouses: terms, negotiation and lease documents.', 'Quoted after review'],
      ['property_mgmt', 'Property management', 'Rent collection, maintenance and tenant management — ideal for owners who live away.', 'Monthly fee quoted per property']] },
    { key: 'legal', title: 'Legal & Documentation', icon: 'scale', intro: 'Document review, ownership verification, transfers and property paperwork.', items: [
      ['verification', 'Ownership verification', 'RAQBO examines the ownership documents and records what was and was not checked in a numbered report.', () => `From ${rs((gw.pub && gw.pub.verification_fee) || 2000)}`],
      ['doc_review', 'Document review', 'Your registry, fard, mutation or allotment papers reviewed and explained in plain language.', 'From Rs 5,000 · quoted per document set', true],
      ['transfer', 'Transfer guidance', 'Step-by-step help with transfers, NOCs and society or authority procedures.', 'Quoted after review', true],
      ['documents', 'Document drafting', 'Sale agreements, rent agreements, token receipts and powers of attorney — drafted and reviewed.', 'From Rs 3,000 per document', true],
      ['registry', 'Registry & mutation assistance', 'From stamp paper to registry and mutation (intiqal) — we guide you through every step.', 'Quoted after review', true],
      ['legal', 'Legal consultation', 'Property advice from qualified lawyers. RAQBO arranges the appointment.', 'Lawyer\'s fee confirmed before the meeting', true]] },
    { key: 'build', title: 'Construction & Development', icon: 'tool', intro: 'Design, maps, construction, renovation, project management and materials.', items: [
      ['architecture', 'Architectural design', 'House and commercial designs, 3D views and interior layouts.', 'Per sq ft — quoted after the brief', true],
      ['maps', 'Maps & approvals', 'Building plan drawings and submission for approval (LDA, CDA, RDA or society).', 'Quoted per plot size and authority', true],
      ['construction', 'Construction', 'Grey structure or turnkey construction by vetted contractors, with photo progress reports.', 'Per sq ft — quoted after a site visit'],
      ['renovation', 'Renovation', 'Kitchens, bathrooms, flooring, painting and repairs.', 'Quoted after a site visit'],
      ['project_mgmt', 'Project management', 'RAQBO supervises your contractor, checks quality and reports progress — on site or by video.', 'Monthly or % of project — agreed in advance'],
      ['bulk_materials', 'Bulk material enquiry', 'Need cement, steel, bricks or tiles in bulk? Send one list — RAQBO collects quotes from several suppliers.', 'Free to request', false, [['items', 'Materials and quantities', true, 'textarea'], ['site_city', 'Delivery city / site'], ['needed_by', 'Needed by']]],
      ['materials', 'Construction Materials Marketplace', 'Compare suppliers, live rates and product specifications, then order.', 'Free to browse', false, null, 'data-sv-act="market"']] },
    { key: 'invest', title: 'Property Investment', icon: 'trend', intro: 'Investor matching, RAQBO Direct, QuickSell and auction opportunities.', items: [
      ['investor_matching', 'Investors Network', 'Approved investors receive private QuickSell opportunities that match their budget.', 'Free to apply · identity check required', false, null, 'data-my="investor"'],
      ['raqbo_direct', 'RAQBO Direct', 'Properties RAQBO owns, markets or facilitates — with RAQBO\'s role shown on every listing.', 'Ask us about current RAQBO Direct properties'],
      ['quicksell', 'QuickSell', 'Need to sell fast? An offer from RAQBO, private investors, a public urgent listing or an assisted sale.', 'Commission shown before you submit', false, null, 'data-dl="urgent-page"'],
      ['auctions', 'Property Auctions', 'Transparent online auctions with verified bidders and a public bid history.', 'Fees shown before you list', false, null, 'data-ax="home"']] },
    { key: 'support', title: 'Property Support', icon: 'shield', intro: 'Valuation help, site inspections and help for owners who live overseas.', items: [
      ['valuation', 'Valuation assistance', 'A price guide based on recent asking prices and a site visit. A formal valuation report is arranged through a qualified valuer.', 'From Rs 5,000', false, [['purpose', 'Purpose (selling, buying, bank, family division…)']]],
      ['site_inspection', 'Site inspection', 'A RAQBO visit with photos, video and a short written report on the property\'s condition and surroundings.', 'From Rs 3,000 within city limits', false, [['visit_date', 'Preferred visit date']]],
      ['overseas', 'RAQBO Overseas', 'Verification, video inspections, management and documentation for Pakistanis living abroad.', 'See Overseas services', false, null, 'data-v3s="overseas"']] }
  ];
  var V3S_OVERSEAS = [
    ['overseas_verify', 'Property verification', 'We check the documents and record exactly what was examined — with a report you can confirm by QR code.', 'From Rs 5,000'],
    ['overseas_video', 'Video site inspection', 'A live video call from the property at a time that suits your time zone, plus photos afterwards.', 'From Rs 4,000'],
    ['overseas_buysell', 'Buying & selling assistance', 'We shortlist, inspect, negotiate and coordinate the transfer while you stay abroad.', 'Agreed in writing first'],
    ['overseas_manage', 'Property management', 'Tenants, rent collection, bills and maintenance — with monthly statements.', 'Monthly fee quoted per property'],
    ['overseas_construction', 'Construction monitoring', 'Regular site visits with photo and video progress reports on your house or project.', 'Per visit or monthly'],
    ['overseas_docs', 'Documentation coordination', 'Help with powers of attorney, NICOP/POC-related property paperwork and registry steps.', 'Quoted after review', true],
    ['overseas_appoint', 'Appointments with professionals', 'Video appointments with lawyers, architects and other authorised professionals.', 'Professional\'s fee confirmed first', true]];
  // one flat lookup used by the enquiry form
  var V3S_ALL = {};
  V3S_GROUPS.forEach((g) => g.items.forEach(([k, t, d, fee, pro, fields, link]) => { V3S_ALL[k] = { k, t, d, fee, pro, fields, link, group: g.title }; }));
  V3S_OVERSEAS.forEach(([k, t, d, fee, pro]) => { V3S_ALL[k] = { k, t, d, fee, pro, fields: V3S_OVF, group: 'RAQBO Overseas' }; });
  Object.values(V3S_ALL).forEach((s) => { if (!s.link && !SERVICES[s.k]) SERVICES[s.k] = s.t; if (!s.link) SERVICE_HELP[s.k] = s.d; });
  SERVICES.bulk_materials = 'Bulk construction-material enquiry';
  const v3sFees = () => (SB ? (pf.pub && pf.pub.service_fees) : store.get('svc.fees', {})) || {};
  const v3sOff = () => (SB ? (pf.pub && pf.pub.services_off) : store.get('svc.off', [])) || [];
  function v3sFee(k) { const o = v3sFees()[k]; if (o) return o; const s = V3S_ALL[k]; if (!s) return ''; return typeof s.fee === 'function' ? s.fee() : s.fee; }
  const v3sLive = (k) => !v3sOff().includes(k);

  // ---------- Enquiry form hooks (called from openEnquiry in app.js) ----------
  function v3sOptions(sel) {
    const opt = (k, t) => `<option value="${k}" ${k === (sel || '') ? 'selected' : ''}>${esc(t)}</option>`;
    const groups = V3S_GROUPS.map((g) => `<optgroup label="${esc(g.title)}">${g.items.filter(([k, , , , , , link]) => !link && v3sLive(k)).map(([k, t]) => opt(k, t)).join('')}</optgroup>`).join('');
    return groups + `<optgroup label="RAQBO Overseas">${V3S_OVERSEAS.filter(([k]) => v3sLive(k)).map(([k, t]) => opt(k, t)).join('')}</optgroup><optgroup label="Other">${opt('general', SERVICES.general)}</optgroup>`;
  }
  function v3sEnquiryHook(card, f) {
    const sel = f.service; if (!sel) return;
    sel.closest('label').insertAdjacentHTML('afterend', '<p class="v3s-fee" data-v3s-fee hidden></p><div class="v3s-extra" data-v3s-extra></div>');
    const paint = () => {
      const s = V3S_ALL[sel.value]; const fee = $('[data-v3s-fee]', f); const box = $('[data-v3s-extra]', f); const keep = v3sDetails(f);
      fee.hidden = !s; if (s) fee.innerHTML = `${DI(DIC.info, 14)} <span><b>Fee:</b> ${esc(v3sFee(s.k))}. RAQBO confirms the fee before any work starts — you pay nothing until you agree.${s.pro ? ' ' + esc(V3S_PRO) : ''}</span>`;
      box.innerHTML = s && s.fields ? s.fields.map(([n, label, req, kind]) => `<label>${esc(label)}${req ? '' : ' (optional)'}${kind === 'textarea' ? `<textarea name="x_${n}" maxlength="800" rows="3">${esc(keep[n] || '')}</textarea>` : `<input name="x_${n}" maxlength="120" value="${esc(keep[n] || '')}">`}</label>`).join('') : '';
      const h = $('[data-help]', card); if (h && s) h.textContent = s.d;
      const t = $('h2', card); if (t && s) t.textContent = s.t;
    };
    sel.addEventListener('change', paint); paint();
  }
  function v3sDetails(f) { const o = {}; $$('[name^="x_"]', f).forEach((i) => { const v = i.value.trim(); if (v) o[i.name.slice(2)] = v.slice(0, 800); }); return o; }
  function v3sValidate(f) { const s = V3S_ALL[f.service.value]; if (!s || !s.fields) return []; return s.fields.filter(([n, , req]) => req && !(($(`[name="x_${n}"]`, f) || {}).value || '').trim()).map(([n, label]) => ['x_' + n, `Please fill in: ${label}.`]); }
  function v3sFieldLabel(k) { for (const s of Object.values(V3S_ALL)) { const fl = (s.fields || []).find(([n]) => n === k); if (fl) return fl[1]; } return k; }

  // ---------- Catalogue section on the Services page ----------
  function v3sCard(k, t, d, link) {
    return `<article class="v3s-card"><h4>${esc(t)}</h4><p>${esc(d)}</p><div class="v3s-card-foot"><span class="v3s-price">${esc(v3sFee(k))}</span>${link ? `<button type="button" class="button button-outline" ${link}>Open</button>` : `<button type="button" class="button button-primary" data-v3s="req" data-k="${esc(k)}">Request</button>`}</div></article>`;
  }
  function v3sCatalogHTML(active) {
    const g = V3S_GROUPS.find((x) => x.key === active) || V3S_GROUPS[0];
    return `<section class="sv-sec v3s-cat" id="v3s-cat"><div class="sv-in">
      <div class="sv-head"><div class="eyebrow"><span></span> RAQBO CONNECT · ALL SERVICES</div><h2>Choose a service — <span class="gold-text">track it to completion</span></h2><p>Every request gets a tracking number. Follow it in My RAQBO → Service requests. Fees are confirmed before any work starts.</p></div>
      <div class="v3s-tabs" role="tablist">${V3S_GROUPS.map((x) => `<button type="button" role="tab" aria-selected="${x === g}" class="${x === g ? 'on' : ''}" data-v3s="tab" data-g="${x.key}">${DI(DIC[x.icon] || GI[x.icon] || DIC.grid, 16)} ${esc(x.title)}</button>`).join('')}</div>
      <p class="v3s-intro">${esc(g.intro)}</p>
      <div class="v3s-grid">${g.items.filter(([k]) => v3sLive(k)).map(([k, t, d, , , , link]) => v3sCard(k, t, d, link)).join('')}</div>
      <p class="v3s-note">${DI(DIC.info, 14)} Where professional licensing or independent expertise is required, the service is provided by appropriately qualified persons. RAQBO never promises a sale or a legal outcome.</p>
    </div></section>`;
  }
  function v3sInject(root) { const first = $('.sv-sec', root); if (first && !$('.v3s-cat', root)) first.insertAdjacentHTML('afterend', v3sCatalogHTML()); }

  // ---------- RAQBO Overseas Property Services (#overseas) ----------
  function openOverseas() {
    closeNavMenus(); if (pf.my.open) closeMy();
    const live = V3S_OVERSEAS.filter(([k]) => v3sLive(k));
    const card = openModal(`<div class="v3s-ovs">
      <div class="v3s-ovs-hero"><span class="rail-kicker">FOR PAKISTANIS ABROAD</span><h2>RAQBO Overseas Property Services</h2><p>Your property in Pakistan, looked after while you live abroad — verified, inspected by video, managed and documented, with every request tracked.</p></div>
      <div class="v3s-grid">${live.map(([k, t, d]) => v3sCard(k, t, d)).join('')}</div>
      <div class="v3s-ovs-how"><div><b>1</b><span>Send a request — tell us your country and the best time to call.</span></div><div><b>2</b><span>RAQBO confirms what we can do in that city and the fee, before any work starts.</span></div><div><b>3</b><span>Follow progress with your tracking number, video calls and reports.</span></div></div>
      <p class="v3s-note">${DI(DIC.info, 14)} We start with services we can deliver reliably in each city, and add more as our local teams grow. Payments are made only to RAQBO's official bank account — never to an individual.</p></div>`, { wide: true, label: 'RAQBO Overseas' });
    card.classList.add('gw-card');
  }

  // ---------- Clicks and links ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v3s]'); if (!b) return; const a = b.dataset.v3s;
    if (a === 'req') { const k = b.dataset.k; if ($('.modal-backdrop')) closeModal(); openEnquiry(k); }
    else if (a === 'tab') { const sec = b.closest('.v3s-cat'); if (sec) { sec.outerHTML = v3sCatalogHTML(b.dataset.g); const n = $(`.v3s-cat [data-g="${b.dataset.g}"]`); if (n) n.focus(); } }
    else if (a === 'overseas') { if ($('.modal-backdrop')) closeModal(); openOverseas(); }
    else if (a === 'catalog') { closeNavMenus(); openServices({}); setTimeout(() => { const c = $('.v3s-cat'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120); }
  });
  addEventListener('hashchange', () => { if (location.hash === '#overseas') openOverseas(); });
  if (location.hash === '#overseas') setTimeout(openOverseas, 600);

  // ---------- Admin: Services & fees ----------
  V3_ADMIN.svcfees = () => {
    const fees = v3sFees(); const off = v3sOff();
    const row = (k, t, def) => `<tr><td><b>${esc(t)}</b><br><small>${esc(k)}</small></td><td><input class="gwa-note" data-sf="${esc(k)}" maxlength="120" value="${esc(fees[k] || '')}" placeholder="${esc(def)}"></td><td><label class="v3s-on"><input type="checkbox" data-so="${esc(k)}" ${off.includes(k) ? '' : 'checked'}> Shown</label></td></tr>`;
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> SERVICES</div><h2>Services &amp; fees</h2><p class="admin-sub">The fee text shown on each service. Leave a box empty to use the default (shown in grey). Untick a service to hide it until RAQBO can deliver it reliably.</p></div></div>
      ${[...V3S_GROUPS.map((g) => [g.title, g.items.filter((x) => !x[6])]), ['RAQBO Overseas', V3S_OVERSEAS]].map(([title, items]) => `<section class="gwa-sec"><h3>${esc(title)}</h3><table class="gw-table v3s-ftable"><thead><tr><th>Service</th><th>Fee shown to customers</th><th></th></tr></thead><tbody>${items.map(([k, t]) => row(k, t, (() => { const s = V3S_ALL[k]; return typeof s.fee === 'function' ? s.fee() : s.fee; })())).join('')}</tbody></table></section>`).join('')}
      <div class="button-row"><input class="gwa-note" data-sf-reason placeholder="Reason for the change (optional, kept in the audit log)" maxlength="300"><button type="button" class="button button-primary" data-v3sa="save">Save services</button></div></div>`;
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v3sa]'); if (!b) return; const root = b.closest('.gwa');
    const fees = {}; $$('[data-sf]', root).forEach((i) => { if (i.value.trim()) fees[i.dataset.sf] = i.value.trim().slice(0, 120); });
    const off = $$('[data-so]', root).filter((c) => !c.checked).map((c) => c.dataset.so); const reason = ($('[data-sf-reason]', root) || {}).value || '';
    const done = busy(b, 'Saving…');
    try {
      if (SB) { const { error } = await SB.rpc('admin_save_services', { p_fees: fees, p_off: off, p_reason: reason }); if (error) throw new Error(/could not find the function/i.test(error.message || '') ? 'Run update_20_services.sql in Supabase first.' : error.message); await pfLoad(); }
      else { store.set('svc.fees', fees); store.set('svc.off', off); try { pfLocal.log('settings.services', 'services', reason, { fees, off }); } catch { /* ignore */ } }
      done(); toast('Services saved.');
    } catch (err) { done(); toast(err.message); }
  });

