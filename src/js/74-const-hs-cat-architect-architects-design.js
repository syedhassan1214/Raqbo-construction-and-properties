  // =====================================================================
  const HS_CAT = { architect: 'Architects & design', contractor: 'Contractors & builders', renovation: 'Renovation & interiors', movers: 'Movers & packers', electrician_plumber: 'Electricians & plumbers', surveyor: 'Surveyors & valuers' };
  const HS_V3S = { architect: 'architecture', contractor: 'construction', renovation: 'renovation', surveyor: 'valuation' };
  const MFB = SB ? {
    async list(all) { let q = SB.from('area_boundaries').select('*').order('city').order('name'); if (!all) q = q.eq('active', true); const { data, error } = await q; if (error) { if (/does not exist|schema cache/.test(error.message)) return []; throw new Error(error.message); } return data || []; },
    async add(b) { const { error } = await SB.from('area_boundaries').insert(b); if (error) throw new Error(/row-level security/.test(error.message) ? 'Only an admin can add boundaries.' : /does not exist|schema cache/.test(error.message) ? 'Run update_34_boundaries_home_services.sql in Supabase first.' : error.message); },
    async set(id, patch) { const { error } = await SB.from('area_boundaries').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw new Error(error.message); },
    async del(id) { const { error } = await SB.from('area_boundaries').delete().eq('id', id); if (error) throw new Error(error.message); }
  } : {
    async list(all) { return (store.get('mf_bounds', []) || []).filter((b) => all || b.active); },
    async add(b) { const all = store.get('mf_bounds', []) || []; all.push({ ...b, id: Date.now() + Math.floor(Math.random() * 1000), active: true, created_at: new Date().toISOString() }); store.set('mf_bounds', all); },
    async set(id, patch) { const all = store.get('mf_bounds', []) || []; const b = all.find((x) => x.id === id); if (b) Object.assign(b, patch); store.set('mf_bounds', all); },
    async del(id) { store.set('mf_bounds', (store.get('mf_bounds', []) || []).filter((x) => x.id !== id)); }
  };
  const HS = SB ? {
    async list() { const { data, error } = await SB.from('service_providers').select('*').eq('status', 'approved').order('created_at', { ascending: false }).limit(500); if (error) { if (/does not exist|schema cache/.test(error.message)) return []; throw new Error(error.message); } return data || []; },
    async mine() { const me = lvMe(); if (!me) return []; const { data } = await SB.from('service_providers').select('*').eq('owner_id', me); return data || []; },
    async apply(p) { const { error } = await SB.from('service_providers').insert(p); if (error) throw new Error(/duplicate|unique/.test(error.message) ? 'You have already applied in this category.' : /row-level security/.test(error.message) ? 'Please verify your account (email and mobile) before listing a business.' : /phone/.test(error.message) ? 'Enter a valid mobile number, e.g. +92 300 1234567.' : /does not exist|schema cache/.test(error.message) ? 'Home Services is being switched on. Please try again later.' : error.message); },
    async adminList() { const { data, error } = await SB.from('service_providers').select('*').order('created_at', { ascending: false }).limit(500); if (error) throw new Error(/does not exist|schema cache/.test(error.message) ? 'Run update_34_boundaries_home_services.sql in Supabase to switch on Home Services.' : error.message); return data || []; },
    async decide(id, status, note) { const { error } = await SB.rpc('admin_decide_provider', { p_id: id, p_status: status, p_note: note }); if (error) throw new Error(error.message); }
  } : {
    async list() { return (store.get('mf_providers', []) || []).filter((p) => p.status === 'approved'); },
    async mine() { const me = lvMe(); return (store.get('mf_providers', []) || []).filter((p) => p.owner_id === me); },
    async apply(p) { const all = store.get('mf_providers', []) || []; const me = lvMe(); if (all.some((x) => x.owner_id === me && x.category === p.category)) throw new Error('You have already applied in this category.'); if (!/^\+?[0-9 ()-]{10,20}$/.test(p.phone)) throw new Error('Enter a valid mobile number, e.g. +92 300 1234567.'); all.unshift({ ...p, id: 'sp-' + Date.now(), owner_id: me, status: 'pending', admin_note: '', created_at: new Date().toISOString() }); store.set('mf_providers', all); lvLocal.notifyAdmins('service', 'New Home Services application', `${p.business} · ${p.category} · ${p.city}`, '#admin/homeservices'); },
    async adminList() { return store.get('mf_providers', []) || []; },
    async decide(id, status, note) { if (['rejected', 'suspended'].includes(status) && String(note || '').trim().length < 3) throw new Error('Give a reason (the business is told).'); const all = store.get('mf_providers', []) || []; const p = all.find((x) => x.id === id); if (!p) throw new Error('Not found.'); Object.assign(p, { status, admin_note: note, decided_at: new Date().toISOString() }); store.set('mf_providers', all); lvLocal.notify(p.owner_id, 'service', status === 'approved' ? 'Your business is listed in RAQBO Home Services' : 'Your Home Services application was updated', p.business, '#home-services'); }
  };

  // ---------- Boundaries on the public map ----------
  const mfb = { list: null, layer: null, map: null };
  async function mfbLoad(force) { if (mfb.list && !force) return mfb.list; try { mfb.list = await MFB.list(false); } catch { mfb.list = []; } return mfb.list; }
  async function mfbPaint() {
    const L = window.L; if (!L || !mv.map) return; const list = await mfbLoad();
    if (mfb.layer && mfb.map === mv.map) mfb.layer.clearLayers(); else { mfb.layer = L.layerGroup().addTo(mv.map); mfb.map = mv.map; }
    list.forEach((b) => { const pts = Array.isArray(b.shape) ? b.shape : []; if (pts.length < 3) return;
      const pg = L.polygon(pts, { color: '#8a6a2c', weight: 1.5, dashArray: '4 4', fillColor: '#c8942f', fillOpacity: 0.04 });
      pg.bindTooltip(`${esc(b.name)}${b.city ? ' · ' + esc(b.city) : ''}`, { sticky: true });
      pg.on('click', (e) => { if (mf.drawing) return; L.DomEvent.stopPropagation(e); mfSetArea(pts.map((p) => [+p[0], +p[1]])); toast(`${filtered().length} ${filtered().length === 1 ? 'property' : 'properties'} inside ${b.name}.`); });
      pg.addTo(mfb.layer); });
    const t = mv.el && $('.mf-draw', mv.el); if (t && list.length && !$('.mfb-hint', t)) t.insertAdjacentHTML('beforeend', `<span class="mfb-hint">${mfT('Tap a society outline to search inside it')}</span>`);
  }
  { const base = showMap; showMap = async function (on) { await base.apply(this, arguments); if (on) mfbPaint(); }; }
  { const base = mfPaintTools; mfPaintTools = function () { base.apply(this, arguments); const t = mv.el && $('.mf-draw', mv.el); if (t && mf.poly && db.isAdmin && !mf.drawing && !$('[data-mfb=save]', t)) t.insertAdjacentHTML('beforeend', '<button type="button" data-mfb="save">Save as boundary</button>'); if (t && mfb.list && mfb.list.length && !mf.drawing && !mf.poly && !$('.mfb-hint', t)) t.insertAdjacentHTML('beforeend', `<span class="mfb-hint">${mfT('Tap a society outline to search inside it')}</span>`); }; }
  function mfbForm(shape, source) {
    const card = openModal(`<div class="eyebrow"><span></span> MAP</div><h2>Save as an area boundary</h2><p class="modal-lead">Everyone will see this outline on the map and can tap it to search inside. Only save outlines you are sure of.</p>
      <form class="modal-form" data-mfb-form><div class="modal-form-row"><label>Society / area name<input name="name" required minlength="2" maxlength="120" placeholder="e.g. DHA Phase 6"></label><label>City<input name="city" maxlength="80" placeholder="e.g. Lahore"></label></div>
      <label>Kind<select name="kind"><option value="society">Society</option><option value="phase">Phase</option><option value="block">Block</option><option value="area">Area</option><option value="city">City</option></select></label>
      <p class="form-hint">${shape.length} corner points · ${esc(source)}</p><p class="form-error" hidden></p><button type="submit" class="button button-primary modal-submit">Save boundary</button></form>`, { label: 'Save boundary' });
    const f = $('[data-mfb-form]', card); f._shape = shape; f._source = source;
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-mfb=save]') && mf.poly) mfbForm(mf.poly.map((p) => [+(+p[0]).toFixed(6), +(+p[1]).toFixed(6)]), 'Drawn on the map by an admin'); });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-mfb-form]'); if (!f) return; e.preventDefault(); const done = busy($('button[type=submit]', f), 'Saving…');
    try { await MFB.add({ name: f.name.value.trim(), city: f.city.value.trim(), kind: f.kind.value, shape: f._shape, source: f._source }); closeModal(); mfb.list = null; await mfbLoad(true); mfbPaint(); toast('Boundary saved. It now shows on the map.'); mfbAdmin.list = null; }
    catch (err) { done(); const x = $('.form-error', f); x.hidden = false; x.textContent = err.message; }
  });

  // GeoJSON → [[lat, lng], …] rings
  function mfbFromGeoJSON(gj, fallbackName) {
    const out = []; const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', properties: {}, geometry: gj }];
    (feats || []).forEach((ft, i) => { const g = ft && ft.geometry; if (!g) return; const p = ft.properties || {};
      const name = String(p.name || p.NAME || p.Name || p.title || p.society || `${fallbackName} ${i + 1}`).slice(0, 120);
      const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((c) => c[0]) : [];
      rings.forEach((r, j) => { if (!Array.isArray(r) || r.length < 4) return; let pts = r.map((c) => [+(+c[1]).toFixed(6), +(+c[0]).toFixed(6)]).filter((c) => isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180);
        if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        if (pts.length > 2000) { const step = Math.ceil(pts.length / 2000); pts = pts.filter((_, k) => k % step === 0); }
        if (pts.length >= 3) out.push({ name: rings.length > 1 ? `${name} (${j + 1})` : name, city: String(p.city || p.CITY || p.district || '').slice(0, 80), shape: pts }); }); });
    return out;
  }

  // Admin → Area boundaries
  const mfbAdmin = { list: null, at: 0, err: '', busy: false };
  async function mfbAdminLoad() { mfbAdmin.busy = true; try { mfbAdmin.list = await MFB.list(true); mfbAdmin.err = ''; } catch (err) { mfbAdmin.list = []; mfbAdmin.err = err.message; } mfbAdmin.at = Date.now(); mfbAdmin.busy = false; mfAdminRepaint('boundaries'); }
  function mfAdminRepaint(tab) { if (admin.el && !admin.el.hidden && admin.tab === tab) { const b = $('.ax-body', admin.el) || $('.admin-content', admin.el); if (b) { const y = admin.el.scrollTop; b.innerHTML = V3_ADMIN[tab](); admin.el.scrollTop = y; } } }
  V3_ADMIN.boundaries = () => {
    if (!mfbAdmin.list || Date.now() - mfbAdmin.at > 30000) { if (!mfbAdmin.busy) mfbAdminLoad(); if (!mfbAdmin.list) return '<div class="gw-loading">Loading boundaries…</div>'; }
    const L = mfbAdmin.list;
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> MAP</div><h2>Area boundaries</h2><p class="admin-sub">${L.length} outline${L.length === 1 ? '' : 's'}. Members see active outlines on the map and can tap one to search inside it. Add an outline by importing a GeoJSON file, or by drawing an area on the public map (Map view → Draw an area → Save as boundary).</p></div><button type="button" class="admin-refresh" data-mfb-a="reload">Refresh</button></div>
      ${mfbAdmin.err ? `<p class="admin-message">${esc(mfbAdmin.err)}</p>` : ''}
      <section class="gwa-sec"><h3>Import GeoJSON</h3><form class="modal-form" data-mfb-import><div class="modal-form-row"><label>GeoJSON file (.geojson or .json)<input type="file" name="file" accept=".geojson,.json,application/geo+json,application/json"></label><label>City for these outlines<input name="city" maxlength="80" placeholder="e.g. Lahore"></label></div>
        <label>…or paste GeoJSON<textarea name="text" rows="4" placeholder='{"type":"FeatureCollection","features":[…]}'></textarea></label>
        <p class="form-hint">Polygons and MultiPolygons are imported; each feature’s <code>name</code> becomes the outline’s name. Use outlines you have the right to use (for example, from OpenStreetMap, with credit, or the society’s own plan).</p><p class="form-error" hidden></p><button type="submit" class="button button-primary">Import outlines</button></form></section>
      ${L.length ? `<table class="gw-table"><thead><tr><th>Name</th><th>City</th><th>Kind</th><th>Points</th><th>Source</th><th></th></tr></thead><tbody>${L.map((b) => `<tr><td><b>${esc(b.name)}</b>${b.active ? '' : ' <span class="admin-status">hidden</span>'}</td><td>${esc(b.city || '—')}</td><td>${esc(b.kind || '')}</td><td>${esc((b.shape || []).length)}</td><td><small>${esc(b.source || '')}</small></td><td><div class="admin-actions"><button type="button" data-mfb-a="${b.active ? 'hide' : 'show'}" data-id="${esc(b.id)}">${b.active ? 'Hide' : 'Show'}</button><button type="button" data-mfb-a="del" data-id="${esc(b.id)}">Delete</button></div></td></tr>`).join('')}</tbody></table>`
        : '<div class="admin-empty">No boundaries yet.</div>'}</div>`;
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mfb-a]'); if (!b) return; const a = b.dataset.mfbA; const id = isNaN(+b.dataset.id) ? b.dataset.id : +b.dataset.id;
    if (a === 'reload') { mfbAdmin.list = null; mfbAdminLoad(); return; }
    if (a === 'del' && !mfConfirm(b, 'Delete this boundary? It disappears from the map.')) return;
    try { if (a === 'del') await MFB.del(id); else await MFB.set(id, { active: a === 'show' }); mfb.list = null; toast('Saved.'); mfbAdminLoad(); } catch (err) { toast(err.message); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-mfb-import]'); if (!f) return; e.preventDefault(); const err = $('.form-error', f); err.hidden = true; const done = busy($('button[type=submit]', f), 'Importing…');
    try {
      const file = f.file.files[0]; if (file && file.size > 8 * 1024 * 1024) throw new Error('That file is over 8 MB. Split it into smaller files.');
      const txt = file ? await file.text() : f.text.value.trim(); if (!txt) throw new Error('Choose a GeoJSON file or paste GeoJSON.');
      let gj; try { gj = JSON.parse(txt); } catch { throw new Error('That is not valid GeoJSON (it could not be read as JSON).'); }
      const rows = mfbFromGeoJSON(gj, file ? file.name.replace(/\.[^.]+$/, '') : 'Area'); if (!rows.length) throw new Error('No polygon outlines were found in that GeoJSON.');
      if (rows.length > 300) throw new Error(`That has ${rows.length} outlines. Import at most 300 at a time.`);
      const city = f.city.value.trim(); let n = 0;
      for (const r of rows) { await MFB.add({ name: r.name, city: city || r.city, kind: 'society', shape: r.shape, source: file ? `Imported from ${file.name}` : 'Imported GeoJSON' }); n++; }
      done(); f.reset(); mfb.list = null; toast(`${n} outline${n === 1 ? '' : 's'} imported.`); mfbAdminLoad();
    } catch (x) { done(); err.hidden = false; err.textContent = x.message; }
  });

  // ---------- Home Services directory ----------
  const hs = { list: null, mine: [], cat: '', city: '', q: '' };
  async function openHomeServices(cat) {
    closeNavMenus(); if (pf.my.open) closeMy(); if (cat) hs.cat = cat;
    const card = openModal('<div class="hs-page"><div class="gw-loading">Loading Home Services…</div></div>', { wide: true, label: 'RAQBO Home Services' }); card.classList.add('gw-card', 'ax-modal');
    try { if (location.hash !== '#home-services') history.replaceState(null, '', '#home-services'); } catch { /* ignore */ }
    try { hs.list = await HS.list(); hs.mine = db.session ? await HS.mine() : []; } catch (err) { hs.list = []; toast(err.message); }
    hsPaint(card);
  }
  function hsPaint(card) {
    const host = $('.hs-page', card || document); if (!host) return; const all = hs.list || []; const q = hs.q.toLowerCase();
    const list = all.filter((p) => (!hs.cat || p.category === hs.cat) && (!hs.city || p.city === hs.city) && (!q || [p.business, p.areas, p.about].join(' ').toLowerCase().includes(q)));
    const cities = [...new Set(all.map((p) => p.city).filter(Boolean))].sort();
    const ST = { pending: 'Under review', approved: 'Listed', rejected: 'Not approved', suspended: 'Suspended' };
    const tel = (p) => String(p.phone || '').replace(/[^0-9+]/g, ''); const wa = (p) => String(p.whatsapp || p.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '92');
    host.innerHTML = `<div class="rm-chero"><div><span class="rail-kicker">${DI(DIC.home || DIC.store, 14)} RAQBO HOME SERVICES</span><h2>Home Services</h2>
        <p>Architects, contractors, renovation and interiors, movers, electricians and plumbers, and surveyors — businesses RAQBO has checked before listing. Agree the price and the work in writing before anything starts.</p>
        <div class="button-row"><button type="button" class="button button-primary" data-hs="apply">List your business</button><button type="button" class="button button-outline" data-v3s="construction">Ask RAQBO to arrange it</button></div></div>
        <div class="ax-hero-stats"><div><b>${all.length}</b><small>Listed businesses</small></div><div><b>${cities.length}</b><small>Cities</small></div><div><b>${Object.keys(HS_CAT).length}</b><small>Categories</small></div></div></div>
      ${hs.mine.length ? `<div class="hs-mine">${hs.mine.map((p) => `<p><b>${esc(p.business)}</b> · ${esc(HS_CAT[p.category] || p.category)} · <span class="pay-chip ${p.status === 'approved' ? 'ok' : p.status === 'pending' ? 'due' : 'bad'}">${esc(ST[p.status] || p.status)}</span>${p.admin_note ? ` <small>${esc(p.admin_note)}</small>` : ''}</p>`).join('')}</div>` : ''}
      <div class="rm-ctabs">${Object.entries(HS_CAT).map(([k, t]) => `<button type="button" data-hs="cat" data-v="${k}" class="${hs.cat === k ? 'active' : ''}">${esc(t)} <em>${all.filter((p) => p.category === k).length}</em></button>`).join('')}${hs.cat ? '<button type="button" data-hs="cat" data-v="" class="rm-clear">Clear</button>' : ''}</div>
      <div class="hs-filters"><label><span class="sr-only">City</span><select data-hs-city><option value="">All cities</option>${cities.map((c) => `<option ${c === hs.city ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label class="hs-q"><span class="sr-only">Search</span><input data-hs-q type="search" value="${esc(hs.q)}" placeholder="Search by business or area…"></label></div>
      <div class="oa-results-head"><h3>${list.length} ${list.length === 1 ? 'business' : 'businesses'}</h3></div>
      ${list.length ? `<div class="rm-cgrid">${list.map((p) => `<article class="hs-card"><div class="hs-top"><span class="hs-cat">${esc(HS_CAT[p.category] || p.category)}</span><span class="hs-ok">${DI(DIC.shield, 12)} ${mfT('Checked by RAQBO')}</span></div>
          <h4>${esc(p.business)}</h4><p class="hs-loc">${DI(DIC.pin, 13)} ${esc(p.city)}${p.areas ? ' · ' + esc(p.areas) : ''}</p>
          ${p.about ? `<p class="hs-about">${esc(p.about)}</p>` : ''}
          <p class="hs-meta">${p.years ? `<span>${esc(p.years)} ${mfT('years')}</span>` : ''}${p.licence ? `<span>${esc(p.licence)}</span>` : ''}</p>
          <div class="hs-acts"><a class="button button-primary" href="tel:${esc(tel(p))}">${DI(DIC.phone || DIC.chat, 14)} ${mfT('Call')}</a><a class="button button-outline" href="https://wa.me/${esc(wa(p))}?text=${encodeURIComponent('Assalam o Alaikum, I found you on RAQBO Home Services.')}" target="_blank" rel="noopener">${mfT('WhatsApp')}</a>${HS_V3S[p.category] ? `<button type="button" class="link-button" data-v3s="${HS_V3S[p.category]}">${mfT('Ask RAQBO instead')}</button>` : ''}</div></article>`).join('')}</div>`
        : `<div class="admin-empty">${all.length ? 'No business matches these filters.' : 'No businesses are listed yet. RAQBO is checking applications city by city.'}<div class="button-row"><button type="button" class="button button-outline" data-hs="apply">List your business</button></div></div>`}
      <p class="form-hint">${DI(DIC.info, 13)} RAQBO checks a business’s identity and contact details before listing it, but the work is agreed directly between you and the business. Never pay the full amount in advance, and keep a written estimate.</p>`;
    hydrate(host);
  }
  function hsApplyForm() {
    requireSignIn(() => {
      const s = db.session || {};
      openModal(`<div class="eyebrow"><span></span> HOME SERVICES</div><h2>List your business</h2><p class="modal-lead">RAQBO checks every business before it appears. You will get a notification when it is approved.</p>
        <form class="modal-form" data-hs-apply>
          <div class="modal-form-row"><label>Business name<input name="business" required minlength="2" maxlength="120"></label><label>Category<select name="category">${Object.entries(HS_CAT).map(([k, t]) => `<option value="${k}" ${hs.cat === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
          <div class="modal-form-row"><label>Contact person<input name="contact_name" maxlength="120" value="${esc(s.name || '')}"></label><label>Years in business<input name="years" type="number" min="0" max="80"></label></div>
          <div class="modal-form-row"><label>City<input name="city" required minlength="2" maxlength="80" placeholder="e.g. Lahore"></label><label>Areas you cover<input name="areas" maxlength="300" placeholder="e.g. DHA, Gulberg, Johar Town"></label></div>
          <div class="modal-form-row"><label>Mobile (shown publicly)<input name="phone" required inputmode="tel" value="${esc(s.phone || '')}" placeholder="+92 300 1234567"></label><label>WhatsApp (optional)<input name="whatsapp" inputmode="tel" maxlength="20"></label></div>
          <div class="modal-form-row"><label>Licence / registration (optional)<input name="licence" maxlength="120" placeholder="e.g. PEC, PCATP or council number"></label><label>Website (optional)<input name="website" maxlength="200" type="url" placeholder="https://"></label></div>
          <label>About your work<textarea name="about" maxlength="1200" placeholder="What you do, typical jobs, how you price"></textarea></label>
          <label class="consent-check"><input type="checkbox" name="ok" required> The details are true, and I agree that my business name, city, areas and mobile number are shown publicly once approved.</label>
          <p class="form-error" hidden></p><button type="submit" class="button button-primary modal-submit">Send for review</button></form>`, { label: 'List your business' });
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hs]'); if (!b) return; const a = b.dataset.hs;
    if (a === 'apply') { hsApplyForm(); return; }
    if (a === 'cat') { hs.cat = b.dataset.v || ''; hsPaint(b.closest('.modal-card')); }
  });
  document.addEventListener('change', (e) => { const s = e.target.closest('[data-hs-city]'); if (s) { hs.city = s.value; hsPaint(s.closest('.modal-card')); } });
  document.addEventListener('input', (e) => { const i = e.target.closest('[data-hs-q]'); if (!i) return; clearTimeout(hs.t); hs.t = setTimeout(() => { hs.q = i.value.trim(); const card = i.closest('.modal-card'); hsPaint(card); const ni = $('[data-hs-q]', card); if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); } }, 300); });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-hs-apply]'); if (!f) return; e.preventDefault(); const done = busy($('button[type=submit]', f), 'Sending…');
    try { const g = (n) => (f.elements[n].value || '').trim();
      await HS.apply({ business: g('business'), category: g('category'), contact_name: g('contact_name'), years: g('years') ? Number(g('years')) : null, city: g('city'), areas: g('areas'), phone: g('phone'), whatsapp: g('whatsapp'), licence: g('licence'), website: g('website'), about: g('about') });
      closeModal(); toast('Sent. RAQBO will check your business and tell you when it is listed.'); openHomeServices(); }
    catch (err) { done(); const x = $('.form-error', f); x.hidden = false; x.textContent = err.message; }
  });
  addEventListener('hashchange', () => { if (location.hash === '#home-services') openHomeServices(); });
  if (location.hash === '#home-services') setTimeout(() => openHomeServices(), 900);
  function hsMenu() { const q = $('.mega-quick'); if (q && !$('[data-hs-open]', q)) q.insertAdjacentHTML('beforeend', '<button type="button" data-hs-open>Home services</button>'); }
  setTimeout(hsMenu, 800); document.addEventListener('click', (e) => { setTimeout(hsMenu, 0); if (e.target.closest('[data-hs-open]')) openHomeServices(); }, true);

  // Admin → Home services
  const hsa = { list: null, at: 0, err: '', busy: false };
  async function hsaLoad() { hsa.busy = true; try { hsa.list = await HS.adminList(); hsa.err = ''; } catch (err) { hsa.list = []; hsa.err = err.message; } hsa.at = Date.now(); hsa.busy = false; mfAdminRepaint('homeservices'); }
  V3_ADMIN.homeservices = () => {
    if (!hsa.list || Date.now() - hsa.at > 30000) { if (!hsa.busy) hsaLoad(); if (!hsa.list) return '<div class="gw-loading">Loading applications…</div>'; }
    const L = hsa.list.slice().sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> DIRECTORY</div><h2>Home services</h2><p class="admin-sub">${L.filter((p) => p.status === 'pending').length} waiting · ${L.filter((p) => p.status === 'approved').length} listed. Check the business (call the number, ask for a licence or past work) before approving — approved details are shown publicly.</p></div><button type="button" class="admin-refresh" data-hsa="reload">Refresh</button></div>
      ${hsa.err ? `<p class="admin-message">${esc(hsa.err)}</p>` : ''}
      ${L.length ? L.map((p) => `<article class="admin-card" data-hsa-id="${esc(p.id)}"><div class="admin-card-heading"><div><h2>${esc(p.business)}</h2><p>${esc(HS_CAT[p.category] || p.category)} · ${esc(p.city)}${p.areas ? ' · ' + esc(p.areas) : ''} · ${esc(fmtDay(p.created_at))}</p></div><span class="admin-status">${esc(p.status)}</span></div>
        <p><b>Contact:</b> ${esc(p.contact_name || '—')} · ${esc(p.phone)}${p.whatsapp ? ' · WhatsApp ' + esc(p.whatsapp) : ''}${p.years ? ` · ${esc(p.years)} years` : ''}${p.licence ? ` · ${esc(p.licence)}` : ''}${p.website ? ` · ${esc(p.website)}` : ''}</p>${p.about ? `<p>${esc(p.about)}</p>` : ''}${p.admin_note ? `<p><b>Note:</b> ${esc(p.admin_note)}</p>` : ''}
        <label>Note to the business (required to reject or suspend)<textarea data-hsa-note maxlength="600"></textarea></label>
        <div class="admin-actions">${p.status !== 'approved' ? '<button type="button" data-hsa="approved">Approve</button>' : ''}${p.status === 'pending' ? '<button type="button" data-hsa="rejected">Reject</button>' : ''}${p.status === 'approved' ? '<button type="button" data-hsa="suspended">Suspend</button>' : ''}</div></article>`).join('')
        : '<div class="admin-empty">No applications yet. Businesses apply from Home services → List your business.</div>'}</div>`;
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hsa]'); if (!b) return; const a = b.dataset.hsa;
    if (a === 'reload') { hsa.list = null; hsaLoad(); return; }
    const card = b.closest('[data-hsa-id]'); const done = busy(b, '…');
    try { await HS.decide(card.dataset.hsaId, a, ($('[data-hsa-note]', card) || {}).value || ''); toast('Saved. The business was told.'); hsaLoad(); } catch (err) { done(); toast(err.message); }
  });
  { const base = v3AdminTabs; v3AdminTabs = function () { const t = base(); const n = hsa.list ? hsa.list.filter((p) => p.status === 'pending').length : ''; const i = t.findIndex((x) => x[0] === 'allchats'); t.splice(i >= 0 ? i + 1 : t.length, 0, ['homeservices', 'Home services', n || ''], ['boundaries', 'Area boundaries', '']); return t; }; }
  if (typeof AX_ICON === 'object') Object.assign(AX_ICON, { homeservices: 'store', boundaries: 'pin' });
  if (typeof AX_HINT === 'object') Object.assign(AX_HINT, { homeservices: 'Architects, contractors, movers… applying to be listed', boundaries: 'Society and area outlines shown on the map' });
