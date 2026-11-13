  /* =====================================================================
     Admin panel
     ===================================================================== */
  const admin = { tab: 'overview', el: null, loading: false, error: '' };
  const adminCounts = () => ({
    pending: db.listings.filter((l) => l.status === 'pending').length,
    published: db.listings.filter((l) => l.status === 'published').length,
    rejected: db.listings.filter((l) => l.status === 'rejected').length,
    enquiries: db.enquiries.filter((e) => e.status === 'new').length,
    reports: db.reports.filter((r) => r.status === 'open').length
  });
  function adminListingCard(l) {
    const items = [...l.photos, ...l.videos];
    const actions = l.status === 'pending'
      ? '<button type="button" data-admin-act="approve">Approve &amp; publish</button><button type="button" class="danger" data-admin-act="reject">Reject</button><button type="button" data-admin-act="preview">Preview</button>'
      : l.status === 'published'
        ? '<button type="button" data-admin-act="return">Return to review</button><button type="button" data-admin-act="preview">View public listing</button>'
        : '<button type="button" data-admin-act="return">Return to review</button><button type="button" data-admin-act="preview">Preview</button>';
    const roleBtn = coreAdminRoleBtn(l);
    return `<article class="admin-card" data-listing="${esc(l.id)}">
      <div class="admin-card-heading"><div><h2>${esc(l.title)}</h2><p>${esc(l.area)}, ${esc(l.city)} · ${fmtPrice(l.price)}${l.purpose === 'rent' ? ' / month' : ''} · For ${l.purpose === 'rent' ? 'rent' : 'sale'} · ${esc(l.type === 'Plot' ? 'Plot / land' : l.type)}${l.ref ? ` · ${esc(l.ref)}` : ''}</p></div><span class="admin-status status-${esc(l.status)}">${esc(STATUS_LABEL[l.status])}</span></div>
      <div class="admin-listing-review-details">
        ${v3DupChip(l)}<p><b>Advertiser:</b> ${esc(l.ownerName)}${l.ownerPhone ? ` · ${esc(l.ownerPhone)}` : ''} · ${esc(l.role === 'Owner' ? 'Owner (direct)' : l.role)}${l.sample ? ' · <i>Sample listing</i>' : ''}</p>
        <p><b>Size:</b> ${esc(fmtSize(l))} · <b>Bedrooms:</b> ${l.beds} · <b>Bathrooms:</b> ${l.baths}</p>
        <p><b>Submitted:</b> ${esc(fmtDate(l.createdAt))}${l.publishedAt ? ` · <b>Published:</b> ${esc(fmtDate(l.publishedAt))}` : ''}</p>
        <p><b>Description:</b> ${esc(l.description)}</p>
        ${l.reviewNote ? `<p><b>Last review note:</b> ${esc(l.reviewNote)}</p>` : ''}
      </div>
      <div class="admin-listing-media"><h3>Media · ${l.photos.length} photo${l.photos.length === 1 ? '' : 's'}, ${l.videos.length} video${l.videos.length === 1 ? '' : 's'}</h3>
        ${items.length ? items.map((m) => `<div class="admin-listing-media-item"><p>${m.kind === 'video' ? 'Video' : 'Photo'} · ${esc(m.name || '')}${m.size ? ` · ${(m.size / 1048576).toFixed(1)} MB` : ''}</p>${m.kind === 'video' ? `<video class="admin-property-video" controls preload="metadata" ${mediaAttr(m)}></video>` : `<img alt="" loading="lazy" ${mediaAttr(m)}>`}</div>`).join('') : '<p>No media supplied.</p>'}
      </div>
      <label>Review note ${l.status === 'pending' ? '(shown to the advertiser; recommended when rejecting)' : '(optional)'}<textarea data-note maxlength="1000" placeholder="e.g. Please add a clear exterior photo."></textarea></label>
      <div class="admin-actions">${actions}${roleBtn}</div>
    </article>`;
  }
  function adminBody() {
    const c = adminCounts(); const t = admin.tab;
    const empty = (m) => `<div class="admin-empty">${m}</div>`;
    if (admin.loading) return '<div class="admin-empty">Loading…</div>';
    if (typeof v3xGate === 'function') { const g = v3xGate(); if (g) return g; }
    if (t.startsWith('mk-')) return mkAdminSection(t.slice(3));
    if (admin.error) return `<div class="admin-empty">${esc(admin.error)}<br><br><button type="button" class="admin-refresh" data-admin-refresh>Try again</button></div>`;
    if (t === 'overview') return dashHTML();
    if (t === 'growth') return gwAdminHTML();
    if (t === 'verify') return vfAdminHTML();
    if (['reconcile', 'business', 'team', 'audit'].includes(t)) return coreAdminHTML(t);
    if (t === 'urgent' || t === 'investors') return dlAdminHTML(t);
    if (t === 'auctions') return auAdminHTML();
    if (V3_ADMIN[t]) return V3_ADMIN[t]();
    if (t === 'overview-old') {
      const recent = [
        ...db.listings.filter((l) => !l.sample).map((l) => ({ at: l.createdAt, text: `Listing submitted: ${l.title}`, st: l.status })),
        ...db.enquiries.map((e) => ({ at: e.createdAt, text: `${SERVICES[e.service]}: ${e.name}`, st: e.status })),
        ...db.reports.map((r) => ({ at: r.createdAt, text: `Report (${r.reason}): ${r.listingTitle}`, st: r.status }))
      ].sort((a, b) => b.at - a.at).slice(0, 8);
      return `<div class="admin-heading"><div><div class="eyebrow"><span></span> ADMIN</div><h1>Overview</h1></div>${LIVE ? '<button type="button" class="admin-refresh" data-admin-refresh>Refresh</button>' : ''}</div>
        <div class="admin-metrics"><article>Pending review<b>${c.pending}</b></article><article>Published listings<b>${c.published}</b></article><article>Rejected<b>${c.rejected}</b></article><article>New enquiries<b>${c.enquiries}</b></article><article>Open reports<b>${c.reports}</b></article></div>
        <div class="admin-card" style="margin-top:18px"><h2>Recent activity</h2>${recent.length ? `<ul class="admin-mini-list">${recent.map((r) => `<li><span>${esc(r.text)}<br><small>${esc(fmtDate(r.at))}</small></span>${pill(r.st)}</li>`).join('')}</ul>` : '<p>No submissions yet.</p>'}</div>`;
    }
    if (t === 'pending' || t === 'published' || t === 'rejected') {
      const list = db.listings.filter((l) => l.status === t || (t === 'published' && l.status === 'expired')).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const titles = { pending: ['Pending review', 'Review details and media, then approve to publish or reject. Pending listings are not public.'], published: ['Published listings', 'Listings visible on the public property page. Return a listing to review to take it off the site.'], rejected: ['Rejected listings', 'Rejected listings are hidden from the site. Return one to review to reconsider it.'] };
      return `<div class="admin-heading"><div><div class="eyebrow"><span></span> LISTINGS</div><h1>${titles[t][0]}</h1></div></div><p class="admin-lead">${titles[t][1]}</p><div class="admin-queue">${list.length ? list.map(adminListingCard).join('') : empty(t === 'pending' ? 'The review queue is empty.' : 'Nothing here yet.')}</div>`;
    }
    if (t === 'enquiries') {
      return `<div class="admin-heading"><div><div class="eyebrow"><span></span> SERVICES</div><h1>Service enquiries</h1></div></div><p class="admin-lead">Verification, legal, documents, registry and general enquiries submitted through the website.</p><div class="admin-queue">${db.enquiries.length ? db.enquiries.map((e) => `<article class="admin-card" data-enquiry="${esc(e.id)}"><div class="admin-card-heading"><div><h2>${esc(SERVICES[e.service] || e.service)}</h2><p>${esc(e.ref)} · ${esc(fmtDate(e.createdAt))}</p></div><span class="admin-status status-${esc(e.status)}">${esc(STATUS_LABEL[e.status])}</span></div><div class="admin-listing-review-details"><p><b>Name:</b> ${esc(e.name)} · <b>Phone:</b> ${esc(e.phone)}${e.email ? ` · <b>Email:</b> ${esc(e.email)}` : ''}</p><p><b>City:</b> ${esc(e.city)} · <b>Preferred contact:</b> ${esc(e.via)}</p>${e.property ? `<p><b>Property:</b> ${esc(e.property)}</p>` : ''}${Object.entries(e.details || {}).map(([k, v]) => `<p><b>${esc(typeof v3sFieldLabel === 'function' ? v3sFieldLabel(k) : k)}:</b> ${esc(v)}</p>`).join('')}<p><b>Message:</b> ${esc(e.message)}</p></div><div class="admin-actions">${coreEnquiryActions(e)}</div></article>`).join('') : empty('No service enquiries yet.')}</div>`;
    }
    if (t === 'reports') {
      return `<div class="admin-heading"><div><div class="eyebrow"><span></span> SAFETY</div><h1>Property reports</h1></div></div><p class="admin-lead">Reports about incorrect information, suspicious activity, duplicates or other concerns.</p><div class="admin-queue">${db.reports.length ? db.reports.map((r) => { const l = byId(r.listingId); return `<article class="admin-card" data-report="${esc(r.id)}"><div class="admin-card-heading"><div><h2>${esc(r.reason)}</h2><p>${esc(r.ref)} · ${esc(fmtDate(r.createdAt))}</p></div><span class="admin-status status-${esc(r.status)}">${esc(STATUS_LABEL[r.status])}</span></div><div class="admin-listing-review-details"><p><b>Listing:</b> ${esc(r.listingTitle)} ${l ? pill(l.status) : '(removed)'}</p><p><b>Details:</b> ${esc(r.details || '—')}</p><p><b>Reported by:</b> ${esc(r.reporterName || 'Anonymous')}${r.reporterPhone ? ` · ${esc(r.reporterPhone)}` : ''}</p></div><div class="admin-actions">${l ? '<button type="button" data-admin-act="report-view">View listing</button>' : ''}${l && l.status === 'published' ? '<button type="button" data-admin-act="report-unpublish">Return listing to review</button>' : ''}${r.status === 'open' ? '<button type="button" data-admin-act="report-close">Mark as reviewed</button>' : '<button type="button" data-admin-act="report-reopen">Reopen</button>'}</div></article>`; }).join('') : empty('No property reports yet.')}</div>`;
    }
    return '';
  }
  function adminLoginHTML(msg = '') {
    return `<div class="admin-auth"><a class="brand" href="#home" data-admin-exit aria-label="Back to RAQBO website">${BRAND_HTML('ADMIN PANEL')}</a>
      <form class="admin-auth-card" data-admin-login novalidate><div class="eyebrow"><span></span> STAFF SIGN-IN</div><h1>Admin panel</h1><p>Sign in with a RAQBO staff account. Accounts are created in Supabase and given the admin role.</p>
      <label>Email<input name="email" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      ${CAPTCHA_BOX()}
      ${msg ? `<p class="admin-message" style="color:#9a3d34;background:#fbefed;border-color:#efd2ce">${esc(msg)}</p>` : ''}
      <button class="button button-primary" type="submit">Sign in</button></form>
      <button type="button" class="admin-back-link" data-admin-exit>← Back to website</button></div>`;
  }
  function renderAdmin(loginMsg) {
    if (!admin.el) return;
    if (LIVE && !db.isAdmin) { admin.el.innerHTML = adminLoginHTML(loginMsg); admin.captcha = captcha.mount($('[data-captcha]', admin.el)); return; }
    const c = adminCounts();
    const mc = mkAdminCounts();
    const tabs = [['#p', 'PROPERTIES'], ['overview', 'Dashboard', ''], ['pending', 'Pending review', c.pending], ['published', 'Published', c.published], ['rejected', 'Rejected', c.rejected], ['enquiries', 'Service enquiries', c.enquiries], ['reports', 'Property reports', c.reports], ['verify', 'Verification requests', vfPendingCount()], ['#m', 'CONSTRUCTION MATERIALS'], ['mk-payments', 'Protected payments', mc.pay], ['mk-disputes', 'Disputes', mc.disp], ['mk-vendors', 'Suppliers', mc.vend], ['mk-buyers', 'Buyers', ''], ['mk-orders', 'Material orders', mc.orders], ['#g', 'GROW RAQBO'], ['growth', 'Growth & rewards', gwPendingCount()], ...dlAdminTabs(), ...auAdminTabs(), ...v3AdminTabs(), ...coreAdminTabs()];
    const sideY = ($('.admin-sidebar', admin.el) || {}).scrollTop || 0; const sideX = ($('.admin-sidebar', admin.el) || {}).scrollLeft || 0;
    axp.tabs = tabs; const me = db.session || {}; const ini = String(me.name || 'Admin').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
    const topRight = `<button type="button" class="ax-search" data-ax-pal aria-label="Search or jump (Ctrl+K)">${DI(DIC.search || DIC.info, 16)}<span>Search or jump to…</span><kbd>Ctrl K</kbd></button>
      <span class="ax-me"><span class="ax-av">${esc(ini)}</span><span class="ax-me-txt"><b>${esc(me.name || 'Admin')}</b><small>${LIVE ? esc(me.email || 'Administrator') : 'Demo admin'}</small></span></span>
      ${LIVE ? '<button type="button" class="ax-ghost" data-admin-signout>Sign out</button>' : '<button type="button" class="ax-ghost" data-admin-reset>Reset demo</button>'}<button type="button" class="ax-exit" data-admin-exit>${DI(DIC.home, 15)}<span>Website</span></button>`;
    admin.el.innerHTML = `<div class="admin-shell ax">
      <header class="admin-topbar"><div class="admin-brand"><a class="brand" href="#home" data-admin-exit aria-label="Back to RAQBO website">${BRAND_HTML('ADMIN PANEL')}</a>${LIVE ? '<span class="ax-live"><i></i> Live</span>' : '<span>DEMO PANEL</span>'}</div><div class="admin-account">${topRight}</div></header>
      <div class="admin-layout"><nav class="admin-sidebar" aria-label="Admin sections">${tabs.map(([k, label, n]) => k.startsWith('#') ? `<span class="admin-group">${label}</span>` : axSidebarItem(k, label, n)).join('')}<div class="ax-side-foot"><span class="ax-dot ${LIVE ? 'on' : ''}"></span><div><b>${LIVE ? 'Connected' : 'Demo mode'}</b><small>${LIVE ? 'RAQBO database · live updates' : 'Data stays in this browser'}</small></div><button type="button" data-ax-pal title="Quick jump">Ctrl K</button></div></nav>
      <section class="admin-content">${axCrumbs(tabs)}${LIVE ? '' : '<p class="admin-message">Demonstration admin panel — there is no secure staff authentication. Anyone using this browser can open it.</p>'}${axHero(tabs)}<div class="ax-body" data-tabkey="${esc(admin.tab)}">${adminBody()}</div></section></div></div>`;
    { const sb = $('.admin-sidebar', admin.el); const act = sb && $('button.active', sb); if (sb) { sb.scrollTop = sideY; sb.scrollLeft = sideX; if (act) { if (act.offsetTop < sb.scrollTop || act.offsetTop + act.offsetHeight > sb.scrollTop + sb.clientHeight - 90) sb.scrollTop = act.offsetTop - 120; if (sb.scrollWidth > sb.clientWidth + 4 && (act.offsetLeft < sb.scrollLeft || act.offsetLeft + act.offsetWidth > sb.scrollLeft + sb.clientWidth)) sb.scrollLeft = act.offsetLeft - 16; } } }
    hydrate(admin.el);
    if (admin.tab === 'overview') dashMount(); else dashStop();
    if (db.isAdmin && !vf.adminLoading && (!vf.admin || (admin.tab === 'verify' && Date.now() - (vf.loadedAt || 0) > 4000))) vfAdminLoad(); if (db.isAdmin && !gw.adminLoading && (!gw.admin || (admin.tab === 'growth' && Date.now() - (gw.loadedAt || 0) > 4000))) gwAdminLoad(); if (db.isAdmin && ['reconcile', 'team', 'audit', 'business'].includes(admin.tab) && Date.now() - (pf.admin.loadedAt || 0) > 4000) { pf.admin.loadedAt = Date.now(); coreAdminLoad(admin.tab); } if (db.isAdmin && ['urgent', 'investors'].includes(admin.tab) && Date.now() - (dl.loadedAt || 0) > 4000) dlAdminLoad(admin.tab); if (db.isAdmin && admin.tab === 'auctions' && Date.now() - (ax.loadedAt || 0) > 4000) auAdminLoad();
  }
  async function adminReload() {
    admin.loading = true; admin.error = ''; renderAdmin();
    try { await backend.adminLoad(); await mkLoad(); } catch (err) { admin.error = err.message; }
    admin.loading = false; renderAdmin();
  }
  function refreshAdmin() { if (admin.el && !admin.el.hidden && !LIVE) renderAdmin(); }
  function openAdmin(tab) {
    closeModal(); if (pf.my.open) closeMy(); if (tab) admin.tab = tab;
    if (!admin.el) {
      admin.el = document.createElement('div'); admin.el.className = 'admin-overlay'; admin.el.setAttribute('role', 'region'); admin.el.setAttribute('aria-label', 'RAQBO admin panel'); document.body.append(admin.el);
      admin.el.addEventListener('click', adminClick); admin.el.addEventListener('submit', adminSubmit);
    }
    hideGate(); admin.el.hidden = false; document.body.classList.add('admin-open'); admin.el.scrollTop = 0;
    if (LIVE && db.isAdmin) adminReload(); else { renderAdmin(); mkLoad().then(() => renderAdmin()); }
    if (!mk.unsub) { try { mk.unsub = MK.subscribe((t2) => mkSoon(t2)); } catch { mk.unsub = null; } }
    try { if (location.hash !== '#admin') history.replaceState(null, '', '#admin'); } catch { /* ignore */ }
  }
  function closeAdmin() {
    if (!admin.el) return; dashStop(); $$('video', admin.el).forEach((v) => v.pause()); admin.el.hidden = true; document.body.classList.remove('admin-open'); renderGrid(); updateAuthUI();
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
    checkGate();
  }
  async function adminSubmit(e) {
    const form = e.target.closest('[data-admin-login]'); if (!form) return; e.preventDefault();
    const btn = $('button[type=submit]', form); const done = busy(btn, 'Signing in…');
    try { const token = await (admin.captcha || { get: async () => undefined }).get(); await backend.adminSignIn(form.email.value.trim(), form.password.value, token); updateAuthUI(); await adminReload(); toast('Signed in to the admin panel.'); }
    catch (err) { done(); renderAdmin(err.message); }
  }
  let resetArmed = false;
  async function adminClick(e) {
    const mkb = e.target.closest('[data-mk]');
    if (mkb) { if (mkb.dataset.mk === 'order') { openMarket('order', { orderId: mkb.dataset.id }); return; } if (mkb.dataset.mk === 'vendor') { openMarket('vendor', { vendorId: mkb.dataset.id }).then(() => { const v = mk.vendor(mkb.dataset.id); if (v) loadVendorReviews(v); }); return; } mkClick(e); return; }
    const tab = e.target.closest('[data-tab]'); if (tab) { admin.tab = tab.dataset.tab; renderAdmin(); admin.el.scrollTop = 0; return; }
    if (e.target.closest('[data-admin-exit]')) { e.preventDefault(); closeAdmin(); return; }
    if (e.target.closest('[data-admin-refresh]')) { adminReload(); return; }
    if (e.target.closest('[data-admin-signout]')) { await backend.signOut(); updateAuthUI(); renderAdmin(); toast('Signed out.'); return; }
    const reset = e.target.closest('[data-admin-reset]');
    if (reset) {
      if (!resetArmed) { resetArmed = true; reset.textContent = 'Click again to erase all demo data'; setTimeout(() => { resetArmed = false; if (reset.isConnected) reset.textContent = 'Reset demo data'; }, 4000); return; }
      resetArmed = false; await backend.reset(); admin.tab = 'overview'; renderAdmin(); toast('Demo data reset to the sample listings.'); return;
    }
    const act = e.target.closest('[data-admin-act]'); if (!act) return; const a = act.dataset.adminAct;
    const run = async (fn, msg) => { act.disabled = true; try { await fn(); if (msg) toast(msg); } catch (err) { toast(err.message); } renderAdmin(); };
    const lc = act.closest('[data-listing]');
    if (lc) {
      const l = byId(lc.dataset.listing); if (!l) return; const noteEl = $('[data-note]', lc); const note = noteEl ? noteEl.value.trim() : '';
      if (a === 'preview') { openDetails(l.id); return; }
      if (a === 'approve') return run(() => backend.setListingStatus(l.id, 'published', note), `Published: ${l.title}`);
      if (a === 'reject') return run(() => backend.setListingStatus(l.id, 'rejected', note), `Rejected: ${l.title}`);
      if (a === 'return') return run(() => backend.setListingStatus(l.id, 'pending', note), `Returned to review: ${l.title}`);
      return;
    }
    const ec = act.closest('[data-enquiry]');
    if (ec) return run(() => backend.setEnquiryStatus(ec.dataset.enquiry, a === 'handle' ? 'handled' : 'new'));
    const rc = act.closest('[data-report]');
    if (rc) {
      const r = db.reports.find((x) => x.id === rc.dataset.report); if (!r) return; const l = byId(r.listingId);
      if (a === 'report-view' && l) { openDetails(l.id); return; }
      if (a === 'report-unpublish' && l) return run(() => backend.setListingStatus(l.id, 'pending', `Returned to review after report: ${r.reason}`), 'Listing taken off the site and returned to review.');
      if (a === 'report-close') return run(() => backend.setReportStatus(r.id, 'reviewed'));
      if (a === 'report-reopen') return run(() => backend.setReportStatus(r.id, 'open'));
    }
  }
  window.addEventListener('hashchange', () => { if (location.hash === '#admin') openAdmin(); else if (admin.el && !admin.el.hidden && !location.hash.startsWith('#property/') && !/^#(admin\/|my|rewards|wanted|guides|urgent|auction)/.test(location.hash)) closeAdmin(); });

  /* ---------- Privacy & terms ---------- */
  function openPrivacy() {
    const dataSection = LIVE
      ? '<h3>Where your data goes</h3><ul><li>Listings, photos, videos, enquiries and reports are stored in RAQBO’s database and file storage.</li><li>Your profile includes a phone number; sign-in uses email and password or Google. Phone numbers are not verified by SMS. Advertisers’ numbers are not displayed on property pages.</li><li>Pending listings and their media are visible only to you and authorized RAQBO staff.</li></ul><h3>Not yet available</h3><ul><li>Listing upload supports photos and MP4 video; 3D and 360° tour files are not supported yet.</li></ul>'
      : '<h3>Where your data goes</h3><ul><li>Listings, requests, reports, favorites and uploaded media are stored only in the browser used for the demo.</li><li>They are not visible to other users or devices, and are removed if this browser’s site data is cleared.</li></ul><h3>What is simulated</h3><ul><li>No SMS phone verification is sent in demo mode.</li><li>The admin panel has no secure staff authentication.</li><li>In-app messages are stored only in this browser; some service requests open WhatsApp.</li><li>Listing upload supports photos and MP4 video; 3D and 360° tour files are not supported yet.</li></ul>';
    openModal(`<div class="eyebrow"><span></span> PRIVACY &amp; TERMS</div><h2>${LIVE ? 'Privacy and terms' : 'Demo scope and limitations'}</h2><div class="privacy-body">${dataSection}
      <h3>Contact RAQBO</h3><ul><li>WhatsApp: +${esc(WA_NUMBER)} · UAN: 0300 1223344</li><li>Email: raqbo.official@gmail.com · Website: raqbo.com</li></ul>
      <h3>Important</h3><ul><li>RAQBO is not a government registry and does not guarantee legal title. A direct-owner label is not a title guarantee.</li><li>RAQBO does not collect deposits or token money, or hold funds for property purchases.</li><li>Sample listings are illustrative and not live inventory.</li></ul></div>`, { label: 'Privacy and terms' });
  }

  /* ---------- About us page (founder, projects slideshows, upcoming) ---------- */
  const SP = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1600&q=80`;
  const ABOUT_DEFAULT = {
    sample: false,            // true = yellow "sample text" note at the top
    projectsSample: true,     // true = small "sample projects" note above the project slideshows
    tagline: ['Every Property Solution.', 'One Place.'],
    intro: ["RAQBO is a next-generation property marketplace and digital community, created to transform Pakistan’s real estate experience.", "More than a property portal, RAQBO brings together property transactions, professional expertise and comprehensive property-related services on one innovative platform."],
    pillars: [['scale', 'Founded on Judicial Experience'], ['shield', 'Built on Trust'], ['spark', 'Driven by Innovation']],
    vision: "A property platform built not merely around advertisements, but around transparency, informed decisions and access to professional expertise.",
    ambition: "Our ambition is to make RAQBO Pakistan’s most trusted and connected property ecosystem — where property meets people, expertise and technology.",
    ambitionHighlight: 'where property meets people, expertise and technology',
    // "More than a property portal" — three things RAQBO brings together: [icon, title, line]
    offer: [["hand", "Property transactions", "Buy, sell and rent with clear information on one platform."], ["scale", "Professional expertise", "Legal, verification and documentation professionals within easy reach."], ["key", "Property services", "Virtually every property-related service, in one place."]],
    // "How did it all begin?" — the story in four steps (client's own words)
    story: [{"n": "01", "label": "The Bench", "icon": "scale", "text": "RAQBO is the vision of a District & Sessions Judge (R), whose extensive judicial career and first-hand understanding of property-related legal complexities inspired a new approach to Pakistan’s real estate sector."}, {"n": "02", "label": "The Problem", "icon": "shield", "text": "Years of judicial experience highlighted the serious challenges arising from disputed ownership, defective documentation, fraudulent transactions and complicated legal procedures.", "chips": ["Disputed ownership", "Defective documentation", "Fraudulent transactions", "Complicated legal procedures"]}, {"n": "03", "label": "The Vision", "icon": "key", "text": "This understanding gave rise to a powerful vision: a property platform built not merely around advertisements, but around transparency, informed decisions and access to professional expertise."}, {"n": "04", "label": "RAQBO", "icon": "spark", "text": "RAQBO was conceived to turn that vision into reality by connecting property owners, buyers, investors and professionals through technology, while bringing virtually every property-related service within easy reach."}],
    values: [
      ['scale', 'Judicial experience', 'Founded by a retired District & Sessions Judge with first-hand knowledge of where property matters go wrong.'],
      ['shield', 'Transparency', 'Clear ownership, proper documentation and honest information — not just advertisements.'],
      ['hand', 'Professional expertise', 'Lawyers, verifiers and property professionals within easy reach on one platform.'],
      ['spark', 'Technology', 'Owners, buyers, investors and professionals connected through one innovative platform.']
    ],
    founder: {
      name: '',                 // founder's name (leave '' to show the title only)
      title: 'Former District & Sessions Judge',
      role: 'Founder, RAQBO',
      photo: '',
      heading: 'How did it all begin?',
      message: ["RAQBO is the vision of a District & Sessions Judge (R), whose extensive judicial career and first-hand understanding of property-related legal complexities inspired a new approach to Pakistan’s real estate sector.", "Years of judicial experience highlighted the serious challenges arising from disputed ownership, defective documentation, fraudulent transactions and complicated legal procedures. This understanding gave rise to a powerful vision: a property platform built not merely around advertisements, but around transparency, informed decisions and access to professional expertise.", "RAQBO was conceived to turn that vision into reality by connecting property owners, buyers, investors and professionals through technology, while bringing virtually every property-related service within easy reach."]
    },
    motto: ['Founded on Judicial Experience.', 'Built on Trust.', 'Driven by Innovation.'],
    completed: [
      { title: 'RAQBO Residency', location: 'DHA Phase 6, Lahore', year: '2023', text: '48 modern family homes, handed over on schedule.', photos: [SP('1600596542815-ffad4c1539a9'), SP('1600585154340-be6161a56a0c')] },
      { title: 'Gulberg Heights', location: 'Gulberg III, Lahore', year: '2022', text: 'A 12-storey residential tower with 96 apartments.', photos: [SP('1545324418-cc1a3fa10c00')] },
      { title: 'Bahria Villas', location: 'Bahria Town, Rawalpindi', year: '2021', text: '24 luxury villas with landscaped streets.', photos: [SP('1613490493576-7fde63acd811')] },
      { title: 'Blue Area Business Centre', location: 'Blue Area, Islamabad', year: '2020', text: 'Grade-A offices and ground-floor retail.', photos: [SP('1486406146926-c627a92ad1ab')] }
    ],
    ongoing: [
      { title: 'RAQBO Grand Apartments', location: 'Clifton, Karachi', progress: 70, handover: 'Handover: June 2027', text: 'Structure complete — finishing works in progress.', photos: [SP('1541888946425-d81bb19240f5')] },
      { title: 'Green Valley Farmhouses', location: 'Bedian Road, Lahore', progress: 45, handover: 'Handover: Dec 2027', text: 'Boundary, roads and first 10 farmhouses under construction.', photos: [SP('1503387762-592deb58ef4e')] },
      { title: 'RAQBO Trade Centre', location: 'Faisalabad', progress: 25, handover: 'Handover: 2028', text: 'Foundation and basement levels under way.', photos: [SP('1504307651254-35680f356dfd')] }
    ],
    upcoming: [
      { title: 'RAQBO Skyline', location: 'Gulberg, Islamabad', type: 'Luxury apartments', launch: 'Launching early 2027', text: '2 and 3 bedroom apartments with rooftop amenities.', photo: SP('1460317442991-0ec209397118') },
      { title: 'RAQBO Enclave', location: 'Multan Road, Lahore', type: 'Gated community', launch: 'Launching mid 2027', text: '5 and 10 marla plots with ready infrastructure.', photo: SP('1500382017468-9049fed747ef') },
      { title: 'RAQBO Square', location: 'Peshawar', type: 'Commercial', launch: 'Launching 2028', text: 'Shops, offices and a food court on the main boulevard.', photo: SP('1487958449943-2429e8be8625') }
    ]
  };
  const ABOUT = (() => {
    const c = (window.RAQBO_CONTENT && window.RAQBO_CONTENT.about) || {};
    const out = Object.assign({}, ABOUT_DEFAULT, c);
    out.founder = Object.assign({}, ABOUT_DEFAULT.founder, c.founder || {});
    return out;
  })();
  const AI = {
    shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.2 2.2 4.3-4.4"/>',
    scale: '<path d="M12 4v16"/><path d="M7 20h10"/><path d="M5 7h14"/><path d="M12 4.5 9.5 7"/><path d="m5 7-3 6a3 3 0 0 0 6 0L5 7Z"/><path d="m19 7-3 6a3 3 0 0 0 6 0l-3-6Z"/>',
    hand: '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2"/><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2.1 2.1 0 0 0-3 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a3.5 3.5 0 0 1 4.6-.3l.4.3a3 3 0 0 0 2 .7H21"/><path d="M21 4v9h-2"/><path d="M3 4v9h2l5.5 5.5a1.4 1.4 0 0 0 2-2"/><path d="M3 4h8"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m16 7 3 3"/><path d="m14 9 2 2"/>',
    chat: '<path d="M20 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20l1.2-4.4A8.4 8.4 0 1 1 20 11.5Z"/>',
    pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    back: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m5.6 5.6 2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'
  };
  const ai = (k, s = 20) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${AI[k] || ''}</svg>`;
  const initials = (n) => String(n || 'R').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const au = { el: null, timers: [] };

  function slidesFor(list, kind) {
    const out = [];
    (list || []).forEach((p) => (p.photos && p.photos.length ? p.photos : [p.photo || '']).forEach((src) => out.push({ src, p, kind })));
    return out;
  }
  function slideCaption(s) {
    const p = s.p;
    const meta = s.kind === 'ongoing'
      ? `<div class="au-progress"><div class="au-progress-top"><span>Construction progress</span><b>${esc(p.progress || 0)}%</b></div><div class="au-progress-bar"><i style="width:${Math.max(0, Math.min(100, +p.progress || 0))}%"></i></div>${p.handover ? `<small>${esc(p.handover)}</small>` : ''}</div>`
      : `<span class="au-chip">${s.kind === 'completed' ? 'Completed' : ''}${p.year ? ' · ' + esc(p.year) : ''}</span>`;
    return `<div class="au-cap"><div class="au-cap-main">${s.kind === 'completed' ? meta : '<span class="au-chip live">Under construction</span>'}<h3>${esc(p.title)}</h3><p class="au-cap-loc">${ai('pin', 15)} ${esc(p.location)}</p>${p.text ? `<p class="au-cap-text">${esc(p.text)}</p>` : ''}</div>${s.kind === 'ongoing' ? meta : ''}</div>`;
  }
  function carouselHTML(id, slides) {
    if (!slides.length) return '<p class="au-empty">Projects will appear here soon.</p>';
    return `<div class="au-car" data-car="${id}" tabindex="0" aria-roledescription="carousel">
      <div class="au-track">${slides.map((s, i) => `<figure class="au-slide" aria-label="Slide ${i + 1} of ${slides.length}"><div class="au-ph" data-title="${esc(s.p.title)}">${s.src ? `<img src="${esc(s.src)}" alt="${esc(s.p.title)}" loading="${i ? 'lazy' : 'eager'}">` : ''}</div>${slideCaption(s)}</figure>`).join('')}</div>
      ${slides.length > 1 ? `<button type="button" class="au-arrow prev" data-car-go="-1" aria-label="Previous slide">‹</button><button type="button" class="au-arrow next" data-car-go="1" aria-label="Next slide">›</button>
      <div class="au-dots">${slides.map((_, i) => `<button type="button" data-car-to="${i}" aria-label="Go to slide ${i + 1}"></button>`).join('')}</div><div class="au-count"><b>1</b> / ${slides.length}</div>` : ''}
    </div>`;
  }
  function initCarousel(car) {
    const track = $('.au-track', car); const n = track.children.length; let i = 0; let timer = null;
    const go = (k) => {
      i = (k + n) % n; track.style.transform = `translateX(-${i * 100}%)`;
      $$('.au-dots button', car).forEach((d, j) => d.classList.toggle('active', j === i));
      const c = $('.au-count b', car); if (c) c.textContent = i + 1;
    };
    const start = () => { stop(); if (n > 1) timer = setInterval(() => go(i + 1), 5000); };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    car.addEventListener('click', (e) => {
      const g = e.target.closest('[data-car-go]'); const t = e.target.closest('[data-car-to]');
      if (g) { go(i + +g.dataset.carGo); start(); } else if (t) { go(+t.dataset.carTo); start(); }
    });
    car.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { go(i - 1); start(); } else if (e.key === 'ArrowRight') { go(i + 1); start(); } });
    car.addEventListener('mouseenter', stop); car.addEventListener('mouseleave', start);
    let x0 = null;
    car.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; stop(); }, { passive: true });
    car.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); x0 = null; start(); });
    go(0); start(); au.timers.push(stop);
  }
  function auReveal(root) {
    const els = $$('.rv', root); if (!els.length) return;
    const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    if (reduce || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const scroller = root.classList && root.classList.contains('au') ? root : null;
    const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { root: scroller, threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach((e) => io.observe(e));
  }
  function photoFallbacks(root) {
    setTimeout(() => auReveal(root), 30);
    $$('.au-ph img, .au-up-img img', root).forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
    const fp = $('.au-founder-photo img', root);
    if (fp) fp.addEventListener('error', () => { const fr = fp.closest('.au-frame'); fp.remove(); if (fr) fr.classList.add('au-frame-logo'); }, { once: true });
    const logo = ($('.brand-logo') || $('.au-top-title img') || {}).src || window.RAQBO_LOGO || '';
    $$('img[data-au-logo]', root).forEach((im) => { if (logo) im.src = logo; else im.remove(); });
  }
  function aboutHTML() {
    const f = ABOUT.founder; const A = ABOUT;
    return `<header class="pp-top au-top"><div class="pp-top-in"><button type="button" class="pp-back" data-au="close">${ai('back', 16)} Back to home</button><span class="au-top-title">About RAQBO</span><a class="pp-icon-btn au-top-wa" href="${waLink('Hi RAQBO, I would like to know more about your projects.')}" target="_blank" rel="noopener">WhatsApp us</a></div></header>
    ${A.sample ? '<div class="au-sample-note">Sample text and photos — replace them with RAQBO’s real details in <b>content.js</b> and the <b>images</b> folder.</div>' : ''}
    <section class="au-hero2">
      <div class="au-hero2-bg" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="au-in au-hero2-grid">
        <div class="au-hero2-copy">
          <div class="eyebrow eyebrow-light rv"><span></span> ABOUT RAQBO</div>
          <h1 class="rv"><span class="au-h1a">${esc((A.tagline || [])[0] || 'Every Property Solution.')}</span><span class="au-h1b gold-shine">${esc((A.tagline || [])[1] || 'One Place.')}</span></h1>
          ${[].concat(A.intro || []).map((p, i) => `<p class="rv ${i ? '' : 'au-lead'}" style="--d:${120 + i * 90}ms">${esc(p)}</p>`).join('')}
          <div class="au-hero2-cta rv" style="--d:320ms"><button type="button" class="button button-primary" data-au="browse">Browse properties</button><a class="button au-ghost" href="${waLink('Hi RAQBO, I would like to know more.')}" target="_blank" rel="noopener">${ai('chat', 16)} Talk to RAQBO</a></div>
        </div>
        <div class="au-orb rv" style="--d:200ms" aria-hidden="true">
          <div class="au-orb-ring"></div><div class="au-orb-ring r2"></div><div class="au-orb-core"><img data-au-logo alt=""></div>
          ${(A.pillars || []).map(([ic, t], i) => `<span class="au-float c${i}">${ai(ic, 16)} ${esc(t)}</span>`).join('')}
        </div>
      </div>
      <nav class="au-in au-jump rv" aria-label="On this page"><a href="#au-offer" data-au-jump>What we do</a><a href="#au-founder" data-au-jump>Our story</a><a href="#au-ambition" data-au-jump>Our ambition</a><a href="#au-completed" data-au-jump>Projects</a></nav>
    </section>
    <div class="au-marquee" aria-label="${esc((A.motto || []).join(' '))}"><div class="au-marquee-track" aria-hidden="true">${Array.from({ length: 4 }, () => (A.motto || []).map((m) => `<span>${esc(m.replace(/\.$/, ''))}</span><i>✦</i>`).join('')).join('')}</div></div>
    <section class="au-sec au-name" id="au-name"><div class="au-in au-name-grid">
      <div class="au-name-mark rv" aria-hidden="true"><b lang="ur" dir="rtl">رقبہ</b><small>RAQBA · land, area</small></div>
      <div class="rv"><div class="eyebrow"><span></span> THE NAME</div><h2>RAQBO — <span class="gold-text">Inspired by Land. Built on Trust.</span></h2>
        <p>The name RAQBO is inspired by the Urdu word <b>Raqba (رقبہ)</b>, meaning land or area. It reflects our vision of connecting people with reliable property information, transactions and services through one modern digital platform.</p></div>
    </div></section>
    <section class="au-sec au-offer" id="au-offer"><div class="au-in">
      <div class="au-center rv"><div class="eyebrow"><span></span> MORE THAN A PROPERTY PORTAL</div><h2>Everything property, <span class="gold-text">on one innovative platform.</span></h2></div>
      <div class="au-offer-grid">${(A.offer || []).map(([ic, t, d], i) => `<article class="au-offer-card rv" style="--d:${i * 110}ms"><span class="au-offer-n">0${i + 1}</span><span class="au-offer-ic">${ai(ic, 26)}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join('')}</div>
    </div></section>
    <section class="au-sec au-story" id="au-founder"><div class="au-in au-story-grid">
      <div class="au-story-side rv">
        <div class="eyebrow eyebrow-light"><span></span> OUR STORY</div><h2>${esc(f.heading || 'How did it all begin?')}</h2>
        <div class="au-founder-photo"><div class="au-frame${f.photo ? '' : ' au-frame-logo'}">${f.photo ? `<img src="${esc(f.photo)}" alt="${esc([f.name, f.title].filter(Boolean).join(', '))}">` : ''}<span class="au-frame-mark" aria-hidden="true"><img data-au-logo alt=""></span><span class="au-logo-tag"><img data-au-logo alt="RAQBO"><b>RAQBO</b></span></div><div class="au-founder-badge"><b>${esc(f.name || f.title)}</b><span>${esc(f.name ? f.title + ' · ' + (f.role || 'Founder') : (f.role || 'Founder, RAQBO'))}</span></div></div>
      </div>
      <div class="au-story-main"><ol class="au-timeline">${(A.story && A.story.length ? A.story : (f.message || []).map((t, i) => ({ n: '0' + (i + 1), label: '', text: t }))).map((st, i) => `<li class="rv" style="--d:${i * 90}ms"><span class="au-tl-dot">${ai(st.icon || 'spark', 18)}</span><div><span class="au-tl-n">${esc(st.n || '')}${st.label ? ' · ' + esc(st.label) : ''}</span><p>${esc(st.text)}</p>${st.chips ? `<div class="au-tl-chips">${st.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}</div></li>`).join('')}</ol>
      <p class="au-endorse">RAQBO is a private business. The founder's former judicial office is mentioned as professional background only and does not imply any government or judicial endorsement.</p></div>
    </div></section>
    <section class="au-ambition" id="au-ambition"><div class="au-in rv">
      <span class="au-amb-mark" aria-hidden="true">“</span>
      <p class="au-amb-text">${(() => { const t = esc(A.ambition || ''); const h = esc(A.ambitionHighlight || ''); return h && t.includes(h) ? t.replace(h, `<span class="gold-shine">${h}</span>`) : t; })()}</p>
    </div></section>
    <section class="au-motto2"><div class="au-in">
      <img class="au-motto2-logo rv" data-au-logo alt="RAQBO">
      <div class="au-motto2-lines">${(A.motto || []).map((m, i) => `<b class="rv" style="--d:${i * 160}ms">${esc(m)}</b>`).join('')}</div>
    </div></section>
    <section class="au-sec au-dark" id="au-completed"><div class="au-in">
      <div class="au-head"><div><div class="eyebrow eyebrow-light"><span></span> OUR TRACK RECORD</div><h2>Completed projects</h2></div><p>Homes, towers and commercial spaces we have delivered across Pakistan.</p></div>
      ${A.projectsSample ? '<p class="au-proj-sample">Sample projects — replace them with RAQBO’s real projects in <b>content.js</b>.</p>' : ''}
      ${carouselHTML('completed', slidesFor(A.completed, 'completed'))}
    </div></section>
    <section class="au-sec" id="au-ongoing"><div class="au-in">
      <div class="au-head"><div><div class="eyebrow"><span></span> UNDER CONSTRUCTION</div><h2>Ongoing projects</h2></div><p>Live progress on the projects our teams are building right now.</p></div>
      ${carouselHTML('ongoing', slidesFor(A.ongoing, 'ongoing'))}
    </div></section>
    <section class="au-sec au-soft" id="au-upcoming"><div class="au-in">
      <div class="au-head"><div><div class="eyebrow"><span></span> COMING SOON</div><h2>Upcoming projects</h2></div><p>Register your interest early for first access to launch prices and plot or unit selection.</p></div>
      <div class="au-up-grid">${(A.upcoming || []).map((p) => `<article class="au-up"><div class="au-up-img au-ph" data-title="${esc(p.title)}">${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.title)}" loading="lazy">` : ''}<span class="au-up-launch">${ai('cal', 14)} ${esc(p.launch || 'Coming soon')}</span></div>
        <div class="au-up-body"><span class="au-up-type">${esc(p.type || '')}</span><h3>${esc(p.title)}</h3><p class="au-cap-loc">${ai('pin', 15)} ${esc(p.location)}</p><p>${esc(p.text || '')}</p>
        <a class="button button-primary au-up-btn" href="${waLink(`Hi RAQBO, I am interested in your upcoming project "${p.title}" (${p.location}). Please share details and launch prices.`)}" target="_blank" rel="noopener">${ai('chat', 16)} Register interest</a></div></article>`).join('')}</div>
    </div></section>
    <section class="au-cta"><div class="au-in"><h2>Have a property or project in mind?</h2><p>Talk to the RAQBO team — we reply on WhatsApp.</p><div class="au-cta-actions"><a class="button button-primary" href="${waLink('Hi RAQBO, I would like to discuss a property / project.')}" target="_blank" rel="noopener">${ai('chat', 16)} Chat on WhatsApp</a><button type="button" class="button button-ghost" data-au="browse">Browse properties</button></div></div></section>`;
  }
  function openAbout(section, opts = {}) {
    if (pp.el && !pp.el.hidden) closeDetails({ fromHistory: true });
    closeModal();
    if (!au.el) {
      au.el = document.createElement('div'); au.el.className = 'au'; au.el.setAttribute('role', 'dialog'); au.el.setAttribute('aria-modal', 'true'); au.el.setAttribute('aria-label', 'About RAQBO');
      document.body.append(au.el);
      au.el.addEventListener('click', (e) => {
        const j = e.target.closest('[data-au-jump]'); if (j) { e.preventDefault(); const t = $(j.getAttribute('href'), au.el); if (t) t.scrollIntoView({ behavior: 'smooth' }); return; }
        const b = e.target.closest('[data-au]'); if (!b) return;
        if (b.dataset.au === 'close') closeAbout();
        else if (b.dataset.au === 'browse') { closeAbout(); setTimeout(scrollToResults, 60); }
      });
    }
    if (au.el.hidden !== false || !au.el.innerHTML) {
      au.el.innerHTML = aboutHTML(); photoFallbacks(au.el); $$('.au-car', au.el).forEach(initCarousel); applyBrandIcons(au.el);
    }
    au.el.hidden = false; document.body.classList.add('pp-open');
    if (!opts.fromHistory && location.hash !== '#about-us') { try { history.pushState({ au: 1 }, '', '#about-us'); } catch { /* ignore */ } }
    const target = section ? $('#' + section, au.el) : null;
    setTimeout(() => { if (target) target.scrollIntoView({ behavior: 'smooth' }); else au.el.scrollTop = 0; const b = $('.pp-back', au.el); if (b) b.focus({ preventScroll: true }); }, 40);
  }
  function closeAbout(opts = {}) {
    if (!au.el || au.el.hidden) return;
    au.timers.forEach((s) => s()); au.timers = []; au.el.hidden = true; au.el.innerHTML = '';
    if (!pp.el || pp.el.hidden) document.body.classList.remove('pp-open');
    if (!opts.fromHistory) { try { if (history.state && history.state.au) history.back(); else if (location.hash === '#about-us') history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
  }
  window.addEventListener('popstate', () => { if (location.hash === '#about-us') openAbout(null, { fromHistory: true }); else closeAbout({ fromHistory: true }); });


