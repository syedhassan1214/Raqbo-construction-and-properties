  /* =====================================================================
     Client review v3 (Phase D): Property Wanted matching, role-based
     My RAQBO (enquiries, inspection appointments, alerts, investor
     pending / completed deals), RAQBO projects (progress updates and
     payment plans) and construction-material comparison.
     Supabase: update_20_services.sql · Demo mode: this browser only
     ===================================================================== */
  // ---------- Property Wanted ----------
  var V3W_PREFS = ['Corner', 'Park facing', 'Main road', 'Near school', 'Near mosque', 'Gated society', 'Furnished', 'Lift', 'Parking', 'Gas connection'];
  var V3W_POSS = { any: 'Any possession', vacant: 'Vacant / ready to move', tenanted: 'Tenanted is fine', under_construction: 'Under construction is fine' };
  function v3wMatches(w) {
    const mm = (u, n) => (String(u || '').toLowerCase() === 'kanal' ? 20 : String(u || '').toLowerCase() === 'marla' ? 1 : 0) * (Number(n) || 0);
    const minM = mm(w.size_unit, w.min_size);
    return db.listings.filter((l) => !l.sample && l.status === 'published' && l.ownerId !== w.user_id && l.purpose === (w.purpose === 'rent' ? 'rent' : 'sale') && l.type === w.property_type
      && String(l.city).toLowerCase() === String(w.city).toLowerCase() && (!w.area || String(l.area).toLowerCase().includes(String(w.area).toLowerCase()))
      && (!w.max_budget || l.price <= w.max_budget) && (!w.min_budget || l.price >= w.min_budget)
      && (!w.possession || w.possession === 'any' || !l.possession || l.possession === w.possession || (w.possession === 'vacant' && l.possession === 'owner_occupied'))
      && (!w.min_beds || ['Plot', 'Commercial'].includes(l.type) || (l.beds || 0) >= w.min_beds)
      && (!minM || !(marlaOf(l) > 0) || marlaOf(l) >= minM));
  }
  function v3wFormExtra() {
    return `<div class="gw-grid v3w-grid">
      <label><span>Minimum budget (PKR)</span><input name="min_budget" type="number" min="1" placeholder="optional"></label>
      <label><span>Possession</span><select name="possession">${Object.entries(V3W_POSS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label><span>Bedrooms (at least)</span><select name="min_beds"><option value="">Any</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join('')}</select></label></div>
      <fieldset class="v3w-prefs"><legend>Preferences</legend>${V3W_PREFS.map((p) => `<label><input type="checkbox" name="pref" value="${esc(p)}"> ${esc(p)}</label>`).join('')}</fieldset>`;
  }
  function v3wRowExtra(f) {
    const v = (n) => ((f.elements[n] || {}).value || '').trim();
    return { min_budget: v('min_budget') && +v('min_budget') > 0 ? Math.round(+v('min_budget')) : null, possession: v('possession') || 'any', min_beds: v('min_beds') ? +v('min_beds') : null, prefs: $$('[name=pref]', f).filter((c) => c.checked).map((c) => c.value) };
  }
  function v3wFacts(w) {
    return `${w.possession && w.possession !== 'any' ? `<span>${DI(DIC.home, 14)} ${esc(V3W_POSS[w.possession])}</span>` : ''}${w.min_beds ? `<span>${DI(DIC.bed || DIC.home, 14)} ${esc(w.min_beds)}+ bedrooms</span>` : ''}${w.min_budget ? `<span>${DI(DIC.cart, 14)} From ${esc(fmtPrice(w.min_budget))}</span>` : ''}${(w.prefs || []).map((p) => `<span class="v3w-pref">${esc(p)}</span>`).join('')}`;
  }
  function v3wMatchBtn(w, mine) {
    if (w.status !== 'published') return ''; const n = v3wMatches(w).length;
    return n ? `<button type="button" class="button ${mine ? 'button-primary' : 'button-outline'} v3w-match" data-v3w="matches" data-id="${esc(w.id)}">${DI(DIC.search, 15)} ${n} matching propert${n === 1 ? 'y' : 'ies'} now</button>` : (mine ? '<small class="v3w-none">No matching properties yet — owners are notified and you get an alert when one is approved.</small>' : '');
  }
  function v3wOpenMatches(id) {
    const w = (gwWanted.list || []).find((x) => String(x.id) === String(id)); if (!w) return; const list = v3wMatches(w);
    const card = openModal(`<div class="eyebrow"><span></span> MATCHES · ${esc(w.ref || '')}</div><h2>${esc(w.property_type)} in ${w.area ? esc(w.area) + ', ' : ''}${esc(w.city)}</h2><p class="modal-lead">Approved properties that match this request today. Owners can also reply privately — their phone number stays hidden.</p>
      <div class="my-grid">${list.map(railCard).join('') || '<div class="admin-empty">No matches right now.</div>'}</div>`, { wide: true, label: 'Matching properties' });
    hydrate(card);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-v3w]'); if (!b) return; if (b.dataset.v3w === 'matches') v3wOpenMatches(b.dataset.id); });

  // ---------- My RAQBO by role ----------
  var MY_ROLES = [['all', 'Everything'], ['sell', 'Selling'], ['buy', 'Buying'], ['invest', 'Investing']];
  const MY_ROLE_OF = { properties: ['sell'], urgent: ['sell'], auctions: ['sell'], enquiries: ['sell', 'buy'], offers: ['sell', 'buy', 'invest'], saved: ['buy'], alerts: ['buy'], bids: ['buy', 'invest'], visits: ['buy', 'sell', 'invest'], investor: ['invest'] };
  const myRole = () => { try { return localStorage.getItem('raqbo.myrole') || 'all'; } catch { return 'all'; } };
  function myRoleOk(m) { const r = myRole(); return r === 'all' || !MY_ROLE_OF[m.id] || MY_ROLE_OF[m.id].includes(r) || m.id === pf.my.tab; }
  function myRoleBar() { const r = myRole(); return `<div class="my-role" role="group" aria-label="Show my dashboard for">${MY_ROLES.map(([k, t]) => `<button type="button" data-myrole="${k}" class="${r === k ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`; }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-myrole]'); if (!b) return; try { localStorage.setItem('raqbo.myrole', b.dataset.myrole); } catch { /* ignore */ } renderMy(); });
  MY.splice(MY.findIndex((m) => m.id === 'services'), 0,
    { id: 'enquiries', label: 'My enquiries', icon: 'chat' },
    { id: 'visits', label: 'Inspection appointments', icon: 'clock' },
    { id: 'alerts', label: 'Property alerts', icon: 'bell', count: () => (gw.me && gw.me.alerts && gw.me.alerts.length) || '' });
  MY_RENDER.enquiries = async () => {
    const me = db.session.userId; let convs = []; try { convs = (await LV.convs()) || []; } catch (err) { return `${myHead('ENQUIRIES', 'My enquiries')}<div class="admin-empty">${esc(err.message)}</div>`; }
    const about = (c) => c.listing_id && byId(c.listing_id); const received = convs.filter((c) => about(c) && byId(c.listing_id).ownerId === me && c.starter_id !== me); const sent = convs.filter((c) => (about(c) || c.wanted_id) && c.starter_id === me);
    const row = (c) => { const l = about(c); return `<button type="button" class="v3m-conv ${c.unread ? 'unread' : ''}" data-v3m="conv" data-id="${esc(c.id)}"><span><b>${esc(l ? l.title : c.subject)}</b><small>${esc(c.last_preview || 'No messages yet')} · ${esc(relShort(c.last_message_at))}</small></span>${c.unread ? `<em>${esc(c.unread)}</em>` : ''}</button>`; };
    return `${myHead('ENQUIRIES', 'My enquiries', 'Questions from buyers about your properties, and the enquiries you sent to owners. Phone numbers stay private until you choose to share them.')}
      <section class="gw-sec"><h3>${DI(DIC.home, 18)} About my properties <span class="admin-count">${received.length}</span></h3>${received.length ? received.map(row).join('') : '<p class="gw-mini">No enquiries on your properties yet.</p>'}</section>
      <section class="gw-sec"><h3>${DI(DIC.chat, 18)} Enquiries I sent <span class="admin-count">${sent.length}</span></h3>${sent.length ? sent.map(row).join('') : '<p class="gw-mini">Tap <b>Message</b> on any property to ask the owner a question.</p>'}</section>`;
  };
  MY_RENDER.visits = async () => {
    const d = await dlLoadMine(); let mine = []; try { mine = SB ? ((await SB.rpc('my_property_visits')).data || []) : store.get('deals.visits', []).filter((v) => { const l = byId(v.listing_id); return l && l.ownerId === db.session.userId; }).map((v) => ({ ...v, title: (byId(v.listing_id) || {}).title })); } catch { mine = []; }
    const when = (v) => (v.confirmed_at || v.preferred_at ? new Date(v.confirmed_at || v.preferred_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Time to be confirmed');
    const st = (s) => `<span class="gw-st ${s === 'confirmed' ? 'gw-st-approved' : s === 'cancelled' ? 'gw-st-rejected' : 'gw-st-pending'}">${esc(s === 'requested' ? 'waiting for RAQBO' : s)}</span>`;
    const row = (v) => `<div class="offer-row"><div><b>${esc(v.title || '')}</b> ${st(v.status)}<small>${esc(when(v))}${v.admin_note ? ' · ' + esc(v.admin_note) : ''}</small></div><button type="button" class="link-button" data-open="${esc(v.listing_id)}">View</button></div>`;
    return `${myHead('INSPECTIONS', 'Inspection appointments', 'Site visits you booked, and visits booked on your properties. RAQBO confirms each time with both sides.')}
      <section class="gw-sec"><h3>${DI(DIC.clock, 18)} Visits I booked</h3>${(d.visits || []).length ? d.visits.map(row).join('') : '<p class="gw-mini">Open any property and tap <b>Book a site visit</b>.</p>'}</section>
      <section class="gw-sec"><h3>${DI(DIC.home, 18)} Visits to my properties</h3>${mine.length ? mine.map(row).join('') : '<p class="gw-mini">No visits booked on your properties yet.</p>'}</section>`;
  };
  MY_RENDER.alerts = async () => {
    if (!gw.me) await gwLoadMe(); const al = (gw.me && gw.me.alerts) || [];
    return `${myHead('ALERTS', 'Property alerts', 'You are notified when a matching property is approved, and when a property you saved drops its price.')}
      ${al.length ? `<ul class="gw-alerts">${al.map((a) => `<li><span>${esc(gwAlertText(a))}</span><button type="button" class="link-button" data-gw="del-alert" data-id="${esc(a.id)}">Remove</button></li>`).join('')}</ul>` : '<div class="admin-empty">No alerts yet. Search the properties, then tap <b>Alert me</b> above the results.</div>'}
      <div class="button-row"><button type="button" class="button button-outline" data-gw="go-search">${DI(DIC.search, 15)} Search properties</button><button type="button" class="button button-outline" data-gw="wanted">${DI(GI.target, 15)} Property Wanted</button></div>`;
  };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-v3m="conv"]'); if (!b) return; closeMy(); openInbox(b.dataset.id); });
  { const base = MY_RENDER.investor; MY_RENDER.investor = async () => {
    const html = await base(); const d = dl.mine || {}; const acc = (d.made || []).filter((o) => o.status === 'accepted'); if (!acc.length && !(d.investor && d.investor.status === 'approved')) return html;
    const done = (o) => { const l = byId(o.listing_id); return (l && l.availability === 'sold') || o.stage === 'sold'; };
    const row = (o) => `<div class="offer-row"><div><b>${esc(o.title || '')}</b> <span class="gw-st ${done(o) ? 'gw-st-approved' : 'gw-st-pending'}">${done(o) ? 'Completed' : 'In progress'}</span><small>Your offer ${esc(rs(o.amount))} · accepted ${esc(fmtDay(o.updated_at || o.created_at))}${o.listing_ref ? ' · ' + esc(o.listing_ref) : ''}</small></div></div>`;
    return `${html}<section class="gw-sec"><h3>${DI(DIC.clock, 18)} Pending transactions</h3>${acc.filter((o) => !done(o)).map(row).join('') || '<p class="gw-mini">No accepted offers in progress.</p>'}</section>
      <section class="gw-sec"><h3>${DI(DIC.check, 18)} Completed transactions</h3>${acc.filter(done).map(row).join('') || '<p class="gw-mini">No completed purchases yet.</p>'}</section>`;
  }; }

  // ---------- RAQBO projects: progress updates + payment plans ----------
  const V3P = SB ? {
    async get(id) {
      const [u, p] = await Promise.all([SB.from('project_updates').select('*').eq('listing_id', id).order('created_at', { ascending: false }), SB.from('listings').select('payment_plan').eq('id', id).maybeSingle()]);
      return { updates: u.error ? [] : (u.data || []), plan: p.error || !p.data ? [] : (p.data.payment_plan || []) };
    },
    async add(id, t, b, pr) { const { error } = await SB.rpc('admin_project_update', { p_listing: id, p_title: t, p_body: b, p_progress: pr }); if (error) throw new Error(/could not find the function/i.test(error.message || '') ? 'Run update_20_services.sql in Supabase first.' : error.message); },
    async del(uid2) { const { error } = await SB.rpc('admin_project_delete_update', { p_id: uid2 }); if (error) throw new Error(error.message); },
    async plan(id, plan) { const { error } = await SB.rpc('admin_set_payment_plan', { p_listing: id, p_plan: plan }); if (error) throw new Error(error.message); }
  } : {
    async get(id) { return { updates: (store.get('proj.updates', {})[id] || []), plan: store.get('proj.plans', {})[id] || [] }; },
    async add(id, t, b, pr) { const l = byId(id); if (!l || !l.raqboRole) throw new Error('Progress updates are for RAQBO Direct properties only.'); const all = store.get('proj.updates', {}); (all[id] = all[id] || []).unshift({ id: uid('pu'), listing_id: id, title: t, body: b, progress: pr, created_at: new Date().toISOString() }); store.set('proj.updates', all); },
    async del(uid2) { const all = store.get('proj.updates', {}); Object.keys(all).forEach((k) => { all[k] = all[k].filter((u) => u.id !== uid2); }); store.set('proj.updates', all); },
    async plan(id, plan) { const all = store.get('proj.plans', {}); all[id] = plan; store.set('proj.plans', all); }
  };
  function v3pBox(l) { if (!l || !l.raqboRole || l.sample) return ''; setTimeout(() => v3pFill(l.id), 0); return `<section class="pp-section v3p" data-v3p="${esc(l.id)}" hidden></section>`; }
  async function v3pFill(id) {
    const box = $(`[data-v3p="${CSS.escape(id)}"]`); if (!box) return; let d = null; try { d = await V3P.get(id); } catch { return; }
    if (!d.updates.length && !d.plan.length) return; const last = d.updates.find((u) => u.progress != null);
    box.innerHTML = `<div class="eyebrow"><span></span> RAQBO PROJECT</div><h2 class="pp-h">Progress &amp; payment plan</h2>
      ${last ? `<div class="v3p-bar"><div><b>${esc(last.progress)}%</b><small>complete · updated ${esc(fmtDay(last.created_at))}</small></div><span><i style="width:${Math.max(0, Math.min(100, +last.progress))}%"></i></span></div>` : ''}
      ${d.updates.length ? `<ol class="pass-hist v3p-ups">${d.updates.slice(0, 8).map((u) => `<li><b>${esc(fmtDay(u.created_at))}</b> ${esc(u.title)}${u.progress != null ? ` · ${esc(u.progress)}%` : ''}${u.body ? `<small>${esc(u.body)}</small>` : ''}</li>`).join('')}</ol>` : ''}
      ${d.plan.length ? `<table class="gw-table v3p-plan"><thead><tr><th>Payment</th><th>Share</th><th>When</th></tr></thead><tbody>${d.plan.map((p) => `<tr><td>${esc(p.label || '')}</td><td>${p.pct != null ? esc(p.pct) + '%' : p.amount ? esc(rs(p.amount)) : '—'}</td><td>${esc(p.when || '')}</td></tr>`).join('')}</tbody></table><p class="form-hint">Payment plans are indicative until confirmed in a signed agreement. Pay only into RAQBO's official bank account.</p>` : ''}
      <div class="button-row"><button type="button" class="button button-outline" data-dl="visit" data-id="${esc(id)}">${DI(DIC.clock, 15)} Book a site visit</button></div>`;
    box.hidden = false;
  }
  const v3pPlanText = (plan) => (plan || []).map((p) => [p.label, p.pct != null ? p.pct + '%' : p.amount || '', p.when || ''].join(' | ')).join('\n');
  function v3pParse(txt) {
    return String(txt || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 24).map((line) => { const [label, share, when] = line.split('|').map((s) => (s || '').trim()); const pct = /%$/.test(share) ? Number(share.replace('%', '')) : null; const amount = !pct && share ? Math.round(Number(share.replace(/[^\d.]/g, ''))) || null : null; return { label: label.slice(0, 80), pct: pct != null && pct >= 0 && pct <= 100 ? pct : null, amount, when: (when || '').slice(0, 60) }; });
  }
  var v3pa = { data: {} };
  V3_ADMIN.projects = () => {
    const list = db.listings.filter((l) => !l.sample && l.raqboRole);
    if (list.some((l) => !v3pa.data[l.id])) { Promise.all(list.map(async (l) => { v3pa.data[l.id] = await V3P.get(l.id).catch(() => ({ updates: [], plan: [] })); })).then(() => { if (admin.tab === 'projects') { const b = $('.ax-body', admin.el); if (b) b.innerHTML = V3_ADMIN.projects(); } }); }
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> RAQBO DIRECT</div><h2>RAQBO projects</h2><p class="admin-sub">Post progress updates and payment plans on RAQBO Direct properties. People who saved the property are notified of each update.</p></div></div>
      ${list.length ? list.map((l) => { const d = v3pa.data[l.id] || { updates: [], plan: [] }; return `<section class="gwa-sec v3p-adm" data-pid="${esc(l.id)}"><h3>${esc(l.title)} <small>${esc(l.ref || '')} · ${esc((RAQBO_ROLES[l.raqboRole] || [''])[0])}</small></h3>
        <div class="v3p-adm-grid"><form data-v3pa="update"><b>New progress update</b><input class="gwa-note" name="t" maxlength="140" placeholder="e.g. Grey structure complete"><textarea class="gwa-note" name="b" rows="2" maxlength="2000" placeholder="Details (optional)"></textarea><label>Progress % <input class="gwa-note" name="p" type="number" min="0" max="100" style="max-width:90px"></label><button class="button button-primary" type="submit">Post update</button>
          ${d.updates.length ? `<ul class="v3p-list">${d.updates.map((u) => `<li>${esc(fmtDay(u.created_at))} · ${esc(u.title)}${u.progress != null ? ` (${esc(u.progress)}%)` : ''} <button type="button" class="link-button" data-v3pa="del" data-id="${esc(u.id)}">Remove</button></li>`).join('')}</ul>` : ''}</form>
        <form data-v3pa="plan"><b>Payment plan</b><textarea class="gwa-note" name="plan" rows="5" placeholder="One line each: Label | 20% or amount | when&#10;Booking | 20% | On booking&#10;Instalments | 60% | 8 quarterly&#10;Possession | 20% | On possession">${esc(v3pPlanText(d.plan))}</textarea><button class="button button-outline" type="submit">Save plan</button></form></div></section>`; }).join('') : '<div class="admin-empty">No RAQBO Direct properties yet. Set RAQBO\'s role on a published property first.</div>'}</div>`;
  };
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-v3pa]'); if (!f) return; e.preventDefault(); const id = f.closest('[data-pid]').dataset.pid; const btn = $('button[type=submit]', f); const done = busy(btn, '…');
    try {
      if (f.dataset.v3pa === 'update') { const t = f.t.value.trim(); if (t.length < 2) throw new Error('Write a short title for the update.'); const p = f.p.value === '' ? null : Math.max(0, Math.min(100, Math.round(+f.p.value))); await V3P.add(id, t, f.b.value.trim(), p); toast('Update posted.'); }
      else { await V3P.plan(id, v3pParse(f.plan.value)); toast('Payment plan saved.'); }
      v3pa.data[id] = await V3P.get(id); const b = $('.ax-body', admin.el); if (b) b.innerHTML = V3_ADMIN.projects();
    } catch (err) { done(); toast(err.message); }
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v3pa="del"]'); if (!b) return; const id = b.closest('[data-pid]').dataset.pid;
    try { await V3P.del(b.dataset.id); v3pa.data[id] = await V3P.get(id); const body = $('.ax-body', admin.el); if (body) body.innerHTML = V3_ADMIN.projects(); } catch (err) { toast(err.message); }
  });

  // ---------- Construction materials: compare suppliers ----------
  var v3c = new Set();
  function v3cBox(v) { return `<label class="v3c-pick"><input type="checkbox" data-v3c-pick="${esc(v.id)}" ${v3c.has(v.id) ? 'checked' : ''}> Compare</label>`; }
  function v3cBar() {
    let bar = $('.v3c-bar'); if (!v3c.size || !mk.el || mk.el.hidden) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'v3c-bar'; mk.el.append(bar); }
    bar.innerHTML = `<span><b>${v3c.size}</b> supplier${v3c.size === 1 ? '' : 's'} selected${v3c.size < 2 ? ' — pick at least 2' : ''}</span><button type="button" class="button button-primary" data-v3c="open" ${v3c.size < 2 ? 'disabled' : ''}>Compare</button><button type="button" class="link-button" data-v3c="clear">Clear</button>`;
  }
  function v3cOpen() {
    const vs = [...v3c].map((id) => mk.vendor(id)).filter(Boolean); const mat = mk.filter.mat && mk.filter.mat !== 'all' ? mk.filter.mat : null;
    const low = (v) => { const ps = v.products.filter((p) => p.price != null && (!mat || p.category === mat)); if (!ps.length) return 'On request'; const p = ps.reduce((a, b) => (a.price <= b.price ? a : b)); return `${PKR(p.price)} / ${esc(p.unit)}<small>${esc(p.name)}</small>`; };
    const rows = [['Location', (v) => esc(`${v.area ? v.area + ', ' : ''}${v.city}`)], ['Delivery', (v) => `${esc(v.radius)} km · ${PKR(v.deliveryFee)}${v.deliveryNote ? `<small>${esc(v.deliveryNote)}</small>` : ''}`], ['Verified supplier', (v) => (v.verified ? '✓ Yes' : 'Not yet')], ['RAQBO Protected Payment', (v) => (v.escrow ? '✓ Available' : 'Direct only')],
      ['Rating', (v) => (v.rating ? `${v.rating.avg.toFixed(1)} ★ (${v.rating.count})` : 'No reviews yet')], [mat ? `Lowest ${esc(mat)} rate` : 'Lowest listed rate', low], ['Items in catalog', (v) => esc(v.products.length)], ['Commercial buyer discount', (v) => (v.bulkDiscount ? esc(v.bulkDiscount) + '%' : '—')], ['Materials', (v) => esc(v.materials.join(', '))]];
    const card = openModal(`<div class="eyebrow"><span></span> CONSTRUCTION MATERIALS</div><h2>Compare suppliers</h2><div class="v3c-wrap"><table class="gw-table v3c-table"><thead><tr><th></th>${vs.map((v) => `<th>${esc(v.shop)}</th>`).join('')}</tr></thead><tbody>${rows.map(([k, f]) => `<tr><th>${k}</th>${vs.map((v) => `<td>${f(v)}</td>`).join('')}</tr>`).join('')}<tr><th></th>${vs.map((v) => `<td><button type="button" class="button button-outline" data-v3c="go" data-id="${esc(v.id)}">Open shop</button></td>`).join('')}</tr></tbody></table></div>
      <p class="form-hint">Rates are set by each supplier and can change. Ask for a quote before you order.</p><div class="button-row"><button type="button" class="button button-primary" data-v3s="req" data-k="bulk_materials">Send one bulk enquiry to RAQBO</button></div>`, { wide: true, label: 'Compare suppliers' });
    card.classList.add('gw-card');
  }
  document.addEventListener('change', (e) => { const c = e.target.closest('[data-v3c-pick]'); if (!c) return; if (c.checked) { if (v3c.size >= 4) { c.checked = false; toast('Compare up to 4 suppliers at a time.'); return; } v3c.add(c.dataset.v3cPick); } else v3c.delete(c.dataset.v3cPick); v3cBar(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v3c]'); if (!b) return; const a = b.dataset.v3c;
    if (a === 'open') v3cOpen(); else if (a === 'clear') { v3c.clear(); $$('[data-v3c-pick]').forEach((c) => { c.checked = false; }); v3cBar(); }
    else if (a === 'go') { closeModal(); mkGo('vendor', { vendorId: b.dataset.id }); }
  });

