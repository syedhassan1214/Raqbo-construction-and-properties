  /* =====================================================================
     Client review v3 (final round): photo-based duplicate detection,
     business identity, service quotations, agent packages, advertiser
     reviews & performance, listing performance, project showcase,
     smart property matching, duplicate-account checks, data backup.
     Supabase: update_22_complete.sql · Demo mode: this browser only
     ===================================================================== */
  const V3F_SETUP = 'Run update_22_complete.sql in Supabase first.';
  const v3fErr = (e) => new Error(/could not find the function|does not exist|schema cache/i.test((e && e.message) || '') ? V3F_SETUP : (e && e.message) || 'Something went wrong.');
  const v3fRpc = async (fn, args) => { const { data, error } = await SB.rpc(fn, args || {}); if (error) throw v3fErr(error); return data; };
  const v3fMe = () => (db.session && db.session.userId) || null;
  var V3F_PLANS = [{ key: 'starter', name: 'Agent Starter', price: 3000, listings: 15, featured: 1, perks: 'Agent profile badge, 15 live listings, 1 sponsored listing a month' }, { key: 'pro', name: 'Agent Pro', price: 7500, listings: 50, featured: 4, perks: 'Pro badge, 50 live listings, 4 sponsored listings a month, performance report' }, { key: 'developer', name: 'Developer', price: 20000, listings: 200, featured: 10, perks: 'Project showcase pages, 200 live listings, 10 sponsored listings a month' }];
  const v3fPlans = () => (SB ? (pf.pub && pf.pub.agent_plans) : store.get('v3f.plans', null)) || V3F_PLANS;

  // ---------- 1. Photo-based duplicate detection (difference hash of the cover photo) ----------
  const v3hCache = {};
  async function v3hUrl(ref) { if (!ref) return null; if (ref.src) return ref.thumb || ref.src; try { return await media.url(ref.id); } catch { return null; } }
  function v3hHash(url) {
    if (v3hCache[url] !== undefined) return Promise.resolve(v3hCache[url]);
    return new Promise((res) => { const img = new Image(); img.crossOrigin = 'anonymous'; const done = (h) => { v3hCache[url] = h; res(h); };
      img.onload = () => { try { const c = document.createElement('canvas'); c.width = 9; c.height = 8; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 9, 8); const d = x.getImageData(0, 0, 9, 8).data; let bits = '';
        for (let y = 0; y < 8; y++) for (let i = 0; i < 8; i++) { const p = (y * 9 + i) * 4; const q = p + 4; const a = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114; const b = d[q] * 0.299 + d[q + 1] * 0.587 + d[q + 2] * 0.114; bits += a > b ? '1' : '0'; } done(bits); } catch { done(null); } };
      img.onerror = () => done(null); setTimeout(() => { if (v3hCache[url] === undefined) done(null); }, 8000); img.src = url; });
  }
  const v3hDist = (a, b) => { let n = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) n++; return n; };
  async function v3hScan(box) {
    const list = db.listings.filter((l) => !l.sample && ['pending', 'published', 'expired'].includes(l.status) && l.photos && l.photos[0]).slice(0, 400);
    const hs = []; for (const l of list) { const u = await v3hUrl(l.photos[0]); const h = u ? await v3hHash(u) : null; if (h) hs.push([l, h]); }
    const pairs = []; for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const d = v3hDist(hs[i][1], hs[j][1]); if (d <= 6 && hs[i][0].photos[0] !== hs[j][0].photos[0]) pairs.push([hs[i][0], hs[j][0], d]); }
    if (!document.body.contains(box)) return;
    box.innerHTML = `<h3>Same or very similar cover photo <span class="admin-count">${pairs.length}</span></h3><p class="admin-sub">Checked ${hs.length} listings by comparing a fingerprint of the first photo — this finds the same property listed by different agents even when the area, size or price was typed differently.</p>
      ${pairs.length ? `<table class="gw-table"><thead><tr><th>Listing</th><th>Looks like</th><th>Match</th></tr></thead><tbody>${pairs.slice(0, 80).map(([a, b, d]) => `<tr><td><button type="button" class="link-button" data-open="${esc(a.id)}">${esc(a.ref || a.title)}</button><br><small>${esc(a.area)}, ${esc(a.city)} · ${esc(a.status)}</small>${rqaModerationActions(a)}</td><td><button type="button" class="link-button" data-open="${esc(b.id)}">${esc(b.ref || b.title)}</button><br><small>${esc(b.area)}, ${esc(b.city)} · ${a.ownerId === b.ownerId ? 'same advertiser' : 'different advertiser'}</small>${rqaModerationActions(b)}</td><td>${d === 0 ? 'Identical photo' : `${Math.round((1 - d / 64) * 100)}% similar`}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">No matching photos found.</div>'}`;
  }
  { const base = V3_ADMIN.duplicates; V3_ADMIN.duplicates = () => { setTimeout(() => { const b = $('[data-v3h]'); if (b && !b.dataset.run) { b.dataset.run = '1'; v3hScan(b); } }, 0); return base().replace(/<\/div>\s*$/, '') + '<section class="gwa-sec" data-v3h><h3>Same or very similar cover photo</h3><p class="admin-sub">Comparing photos…</p></section></div>'; }; }

  // ---------- 2. Business identity (footer, fees page, reports) ----------
  const v3fId = () => { const s = SB ? (pf.pub || {}) : store.get('v3f.identity', {}); return { legal_name: s.legal_name || '', legal_type: s.legal_type || '', legal_reg_no: s.legal_reg_no || '', legal_ntn: s.legal_ntn || '', legal_address: s.legal_address || '' }; };
  function v3fIdLine() { const i = v3fId(); if (!i.legal_name) return ''; return [i.legal_name + (i.legal_type ? ` (${i.legal_type})` : ''), i.legal_reg_no && 'Reg. no. ' + i.legal_reg_no, i.legal_ntn && 'NTN ' + i.legal_ntn, i.legal_address].filter(Boolean).join(' · '); }
  function v3fFooter() { const fb = $('.site-footer .footer-bottom'); if (!fb) return; let s = $('.v3f-legal', fb); const t = v3fIdLine(); if (!t) { if (s) s.remove(); return; } if (!s) { s = document.createElement('span'); s.className = 'v3f-legal'; fb.prepend(s); } s.textContent = t; }
  setTimeout(v3fFooter, 200); setTimeout(v3fFooter, 1500); setInterval(v3fFooter, 15000);
  { const base = vrReportHTML; vrReportHTML = function (r, l, o) { const t = v3fIdLine(); return base(r, l, o).replace('<p class="pass-legal">', `${t ? `<p class="v3f-issuer">Issued by ${esc(t)}</p>` : ''}<p class="pass-legal">`); }; }

  // ---------- 3. Service quotations ----------
  function v3qRow(r) {
    if (!r.quote_status) return '';
    const exp = r.quote_valid_until && String(r.quote_valid_until) < new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
    return `<div class="v3q ${esc(r.quote_status)}"><div><small>QUOTATION</small><b>${esc(rs(r.quote_amount))}</b><span>${r.quote_valid_until ? `valid until ${esc(fmtDay(r.quote_valid_until))}` : ''}${r.quote_note ? ' · ' + esc(r.quote_note) : ''}</span></div>
      ${r.quote_status === 'sent' && !exp ? `<div class="v3q-act"><button type="button" class="button button-primary" data-v3q="accept" data-ref="${esc(r.ref)}">Accept</button><button type="button" class="button button-outline" data-v3q="decline" data-ref="${esc(r.ref)}">Decline</button></div>` : `<em>${r.quote_status === 'accepted' ? 'Accepted' : r.quote_status === 'declined' ? 'Declined' : 'Expired — ask for a new quote'}</em>`}</div>`;
  }
  { const base = coreEnquiryActions; coreEnquiryActions = function (e) {
    const q = e.quoteStatus ? `<p class="v3q-adm">Quote ${esc(rs(e.quoteAmount))} · ${esc(e.quoteStatus)}${e.quoteValidUntil ? ' · valid until ' + esc(fmtDay(e.quoteValidUntil)) : ''}</p>` : '';
    return base(e) + q + `<form class="v3x-form v3q-form" data-v3q-form data-id="${esc(e.id)}"><input name="amount" type="number" min="1" placeholder="Quote amount (PKR)"><input name="valid" type="date" aria-label="Valid until"><input name="note" maxlength="1000" placeholder="What the quote includes"><button class="button button-outline" type="submit">Send quotation</button></form>`; }; }
  document.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-v3q-form]'); if (!f) return; ev.preventDefault(); const amt = Math.round(+f.amount.value || 0); if (!(amt > 0)) { toast('Enter the quoted amount.'); return; } const done = busy($('button', f), '…');
    try {
      if (SB) await v3fRpc('admin_send_quote', { p_id: f.dataset.id, p_amount: amt, p_valid_until: f.valid.value || null, p_note: f.note.value.trim() });
      else { const e = db.enquiries.find((x) => x.id === f.dataset.id); Object.assign(e, { quoteAmount: amt, quoteValidUntil: f.valid.value || new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), quoteNote: f.note.value.trim(), quoteStatus: 'sent', status: 'awaiting_client', updatedAt: Date.now() }); store.set('enquiries', db.enquiries); }
      toast('Quotation sent — the member has been notified.'); if (typeof refreshAdmin === 'function') refreshAdmin(); else renderAdmin();
    } catch (err) { done(); toast(err.message); }
  });
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-v3q]'); if (!b) return; const ok = b.dataset.v3q === 'accept'; if (!ok && !confirm('Decline this quotation? The request will be closed.')) return; const done = busy(b, '…');
    try { if (SB) await v3fRpc('respond_quote', { p_ref: b.dataset.ref, p_accept: ok }); else { const e = db.enquiries.find((x) => x.ref === b.dataset.ref); Object.assign(e, { quoteStatus: ok ? 'accepted' : 'declined', status: ok ? 'in_progress' : 'cancelled' }); store.set('enquiries', db.enquiries); } toast(ok ? 'Accepted — RAQBO will start the work.' : 'Quotation declined.'); renderMy(); } catch (err) { done(); toast(err.message); }
  });

  // ---------- 4. Agent packages ----------
  var v3g = { badges: {} };
  async function v3gLoadBadges() { try { v3g.badges = SB ? ((await SB.rpc('agent_badges')).data || {}) : Object.fromEntries(store.get('v3f.subs', []).filter((s) => s.status === 'active' && new Date(s.ends_at) > new Date()).map((s) => [s.user_id, s.plan_name])); } catch { v3g.badges = {}; } }
  v3gLoadBadges();
  const V3G = SB ? {
    mine: async () => { const { data, error } = await SB.from('agent_subscriptions').select('*').order('created_at', { ascending: false }); if (error) throw v3fErr(error); return data || []; },
    request: (k, m, t) => v3fRpc('request_agent_plan', { p_plan: k, p_months: m, p_txn: t }),
    all: async () => { const { data, error } = await SB.from('agent_subscriptions').select('*').order('created_at', { ascending: false }).limit(300); if (error) throw v3fErr(error); return data || []; },
    set: (id, s, n) => v3fRpc('admin_set_agent_plan', { p_id: id, p_status: s, p_note: n })
  } : {
    mine: async () => store.get('v3f.subs', []).filter((s) => s.user_id === v3fMe()),
    async request(k, m, t) { const p = v3fPlans().find((x) => x.key === k); if (!p) throw new Error('Unknown package.'); if (String(t || '').trim().length < 3) throw new Error('Enter the bank transaction ID of your payment.'); const all = store.get('v3f.subs', []); if (all.some((s) => s.user_id === v3fMe() && s.status === 'pending')) throw new Error('You already have a request waiting for RAQBO.'); const ref = 'RQ-SUB-' + Math.random().toString(36).slice(2, 10).toUpperCase(); all.unshift({ id: uid('s'), ref, user_id: v3fMe(), user_name: db.session.name, plan_key: k, plan_name: p.name, months: m, amount: p.price * m, txn_id: t, status: 'pending', created_at: new Date().toISOString() }); store.set('v3f.subs', all); return ref; },
    all: async () => store.get('v3f.subs', []),
    async set(id, s, n) { const all = store.get('v3f.subs', []); const x = all.find((y) => y.id === id); if (s === 'rejected' && String(n || '').trim().length < 3) throw new Error('Give a reason for the agent.'); Object.assign(x, { status: s, admin_note: n || '' }, s === 'active' ? { starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + x.months * 30 * 864e5).toISOString() } : {}); store.set('v3f.subs', all); }
  };
  MY.splice(MY.findIndex((m) => m.id === 'services'), 0, { id: 'performance', label: 'Listing performance', icon: 'trend' }, { id: 'agent', label: 'Agent package', icon: 'star' });
  MY_RENDER.agent = async () => {
    let mine = []; try { mine = await V3G.mine(); } catch (err) { return `${myHead('AGENTS', 'Agent package')}<div class="admin-empty">${esc(err.message)}</div>`; }
    const act = mine.find((s) => s.status === 'active' && new Date(s.ends_at) > new Date()); const pend = mine.find((s) => s.status === 'pending'); const E = (window.RAQBO_CONTENT && window.RAQBO_CONTENT.escrow) || {};
    return `${myHead('FOR AGENTS & DEVELOPERS', 'Agent package', 'Basic listings stay free. Agents and developers who list many properties can choose a package.')}
      ${act ? `<div class="vf-box ok"><span>${DI(DIC.star, 22)}</span><div><b>${esc(act.plan_name)} — active</b><p>Until ${esc(fmtDay(act.ends_at))} · ${esc(act.ref)}</p></div></div>` : ''}${pend ? `<div class="gw-note">${DI(DIC.clock, 16)} <span>${esc(pend.plan_name)} request ${esc(pend.ref)} is waiting for RAQBO to confirm your payment.</span></div>` : ''}
      <div class="v3g-plans">${v3fPlans().map((p) => `<article class="v3g-plan"><h3>${esc(p.name)}</h3><b>${esc(rs(p.price))}<small> / month</small></b><p>${esc(p.perks)}</p><ul><li>${esc(p.listings)} live listings</li><li>${esc(p.featured)} sponsored listing${p.featured === 1 ? '' : 's'} a month</li></ul></article>`).join('')}</div>
      ${pend ? '' : `<form class="gwa-form v3g-form" data-v3g-form><fieldset><legend>Request a package</legend><label><span>Package</span><select name="plan">${v3fPlans().map((p) => `<option value="${esc(p.key)}">${esc(p.name)} — ${esc(rs(p.price))}/month</option>`).join('')}</select></label><label><span>Months</span><select name="months">${[1, 3, 6, 12].map((m) => `<option>${m}</option>`).join('')}</select></label><label><span>Bank transaction ID</span><input name="txn" maxlength="80" placeholder="After paying to RAQBO's account"></label></fieldset>
        <p class="form-hint">Pay to ${E.accountTitle ? esc(E.accountTitle) + (E.iban ? ' · IBAN ' + esc(E.iban) : '') : 'RAQBO\'s official bank account'}. RAQBO activates the package after the payment reaches the bank.</p><div class="button-row"><button class="button button-primary" type="submit">Send request</button></div></form>`}
      ${mine.length ? `<section class="gw-sec"><h3>History</h3><table class="gw-table"><thead><tr><th>Ref</th><th>Package</th><th>Amount</th><th>Status</th></tr></thead><tbody>${mine.map((s) => `<tr><td>${esc(s.ref)}</td><td>${esc(s.plan_name)} · ${esc(s.months)} mo</td><td>${esc(rs(s.amount))}</td><td>${esc(s.status)}${s.admin_note ? `<br><small>${esc(s.admin_note)}</small>` : ''}</td></tr>`).join('')}</tbody></table></section>` : ''}`;
  };
  document.addEventListener('submit', async (ev) => { const f = ev.target.closest('[data-v3g-form]'); if (!f) return; ev.preventDefault(); const done = busy($('button[type=submit]', f), '…'); try { const r = await V3G.request(f.plan.value, +f.months.value, f.txn.value.trim()); toast('Request ' + r + ' sent.'); renderMy(); } catch (err) { done(); toast(err.message); } });
  var v3ga = { list: null };
  V3_ADMIN.agents = () => {
    if (!v3ga.list) { V3G.all().then((d) => { v3ga.list = d; }).catch((e) => { v3ga.list = { error: e.message }; }).then(() => { if (admin.tab === 'agents') renderAdmin(); }); return '<div class="admin-empty">Loading…</div>'; }
    if (v3ga.list.error) return `<div class="admin-empty">${esc(v3ga.list.error)}</div>`; const pend = v3ga.list.filter((s) => s.status === 'pending');
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> FINANCE</div><h2>Agent packages</h2><p class="admin-sub">Check the payment in the bank records, then activate. Package names and prices are set in Security &amp; tools.</p></div></div>
      <section class="gwa-sec"><h3>Waiting <span class="admin-count">${pend.length}</span></h3>${pend.map((s) => `<div class="vfa-req" data-sid="${esc(s.id)}"><div class="vfa-top"><div><b>${esc(s.plan_name)} · ${esc(s.months)} month(s) · ${esc(rs(s.amount))}</b><small>${esc(s.ref)} · txn ${esc(s.txn_id)} · ${esc(fmtDay(s.created_at))}${s.user_name ? ' · ' + esc(s.user_name) : ''}</small></div></div><div class="vfa-act"><input class="gwa-note" data-gnote placeholder="Note (required to reject)"><button type="button" class="button button-primary" data-v3ga="active">Activate</button><button type="button" class="button button-outline" data-v3ga="rejected">Reject</button></div></div>`).join('') || '<div class="admin-empty sm">No requests waiting.</div>'}</section>
      <section class="gwa-sec"><h3>All packages</h3><table class="gw-table"><thead><tr><th>Ref</th><th>Package</th><th>Amount</th><th>Status</th><th>Until</th></tr></thead><tbody>${v3ga.list.map((s) => `<tr><td>${esc(s.ref)}</td><td>${esc(s.plan_name)}</td><td>${esc(rs(s.amount))}</td><td>${esc(s.status)}</td><td>${s.ends_at ? esc(fmtDay(s.ends_at)) : '—'}</td></tr>`).join('')}</tbody></table></section></div>`;
  };
  document.addEventListener('click', async (ev) => { const b = ev.target.closest('[data-v3ga]'); if (!b) return; const row = b.closest('[data-sid]'); const done = busy(b, '…'); try { await V3G.set(row.dataset.sid, b.dataset.v3ga, $('[data-gnote]', row).value.trim()); v3ga.list = null; await v3gLoadBadges(); toast('Saved — the agent has been notified.'); renderAdmin(); } catch (err) { done(); toast(err.message); } });

  // ---------- 5. Advertiser profile: performance history and genuine reviews ----------
  async function v3aStats(id) {
    if (SB) return v3fRpc('advertiser_stats', { p_user: id });
    const L = db.listings.filter((l) => l.ownerId === id); const rv = store.get('v3f.reviews', []).filter((r) => r.advertiser_id === id);
    return { live: L.filter((l) => l.status === 'published').length, sold: L.filter((l) => l.availability === 'sold').length, rented: L.filter((l) => l.availability === 'rented').length, rating: rv.length ? Math.round(rv.reduce((a, r) => a + r.rating, 0) / rv.length * 10) / 10 : null, reviews: rv, plan: v3g.badges[id] || null };
  }
  { const base = openAdvertiser; openAdvertiser = function (id) { base(id); setTimeout(() => v3aFill(id), 0); }; }
  async function v3aFill(id) {
    const box = $('.v3a'); if (!box) return; let s = null; try { s = await v3aStats(id); } catch { return; } if (!document.body.contains(box)) return;
    const stars = (n) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));
    const tiles = $('.my-tiles', box); if (tiles) tiles.insertAdjacentHTML('beforeend', `<div class="my-tile"><small>Sold or rented</small><b>${esc((s.sold || 0) + (s.rented || 0))}</b><span>${esc(s.sold || 0)} sold · ${esc(s.rented || 0)} rented</span></div><div class="my-tile"><small>Customer rating</small><b>${s.rating ? esc(s.rating) + ' ★' : '—'}</b><span>${esc((s.reviews || []).length)} verified review${(s.reviews || []).length === 1 ? '' : 's'}</span></div>`);
    if (s.plan) { const h = $('.v3a-head p', box); if (h) h.insertAdjacentHTML('afterbegin', `<span class="v3g-badge">${DI(DIC.star, 11)} ${esc(s.plan)}</span> `); }
    box.insertAdjacentHTML('beforeend', `<section class="gw-sec v3a-rev"><h3>Reviews from people who visited or made an offer</h3>${(s.reviews || []).map((r) => `<div class="v3a-r"><b>${esc(stars(r.rating))}</b> <span>${esc(r.name)} · ${r.basis === 'visit' ? 'visited a property' : 'made an offer'} · ${esc(fmtDay(r.at || r.created_at))}</span><p>${esc(r.comment)}</p></div>`).join('') || '<p class="gw-mini">No reviews yet.</p>'}
      ${v3fMe() && v3fMe() !== id ? `<form class="v3a-form" data-v3a-form="${esc(id)}"><select name="rating" aria-label="Rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select><input name="comment" maxlength="1000" placeholder="How was your experience with this advertiser?"><button class="button button-outline" type="submit">Post review</button></form><p class="form-hint">Only people who visited one of their properties or made an offer through RAQBO can post a review.</p>` : ''}</section>`);
  }
  document.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-v3a-form]'); if (!f) return; ev.preventDefault(); const id = f.dataset.v3aForm; if (f.comment.value.trim().length < 3) { toast('Write a short comment.'); return; } const done = busy($('button', f), '…');
    try {
      if (SB) await v3fRpc('add_advertiser_review', { p_advertiser: id, p_rating: +f.rating.value, p_comment: f.comment.value.trim() });
      else { const me = v3fMe(); const visited = store.get('deals.visits', []).some((v) => v.user_id === me && (byId(v.listing_id) || {}).ownerId === id && v.status === 'confirmed'); if (!visited) throw new Error('Only people who visited one of this advertiser\'s properties or made an offer through RAQBO can review them.'); const all = store.get('v3f.reviews', []).filter((r) => !(r.advertiser_id === id && r.user_id === me)); all.unshift({ advertiser_id: id, user_id: me, name: String(db.session.name || 'Member').split(' ')[0], rating: +f.rating.value, comment: f.comment.value.trim(), basis: 'visit', at: new Date().toISOString() }); store.set('v3f.reviews', all); }
      toast('Thank you — your review is posted.'); openAdvertiser(id);
    } catch (err) { done(); toast(err.message); }
  });

  // ---------- 6. Listing performance (owners and agents) ----------
  MY_RENDER.performance = async () => {
    const me = v3fMe(); const mine = db.listings.filter((l) => !l.sample && l.ownerId === me); let st = {};
    try { if (SB) st = await v3fRpc('my_listing_stats'); else { const visits = store.get('deals.visits', []); const wa = store.get('v3e.wa', []); let convs = []; try { convs = (await LV.convs()) || []; } catch { /* ignore */ } mine.forEach((l) => { st[l.id] = { saves: db.favorites.includes(l.id) ? 1 : 0, enquiries: convs.filter((c) => c.listing_id === l.id).length, visits: visits.filter((v) => v.listing_id === l.id).length, offers: (store.get('deals.offers', []) || []).filter((o) => o.listing_id === l.id).length, whatsapp: wa.filter((w) => w.id === l.id).length }; }); } }
    catch (err) { return `${myHead('PERFORMANCE', 'Listing performance')}<div class="admin-empty">${esc(err.message)}</div>`; }
    const tot = (k) => mine.reduce((a, l) => a + ((st[l.id] || {})[k] || 0), 0);
    return `${myHead('PERFORMANCE', 'Listing performance', 'How buyers respond to each of your properties. WhatsApp clicks cover the last 30 days.')}
      <div class="my-tiles">${[['Saves', 'saves'], ['Enquiries', 'enquiries'], ['Site visits', 'visits'], ['Offers', 'offers'], ['WhatsApp clicks', 'whatsapp']].map(([t, k]) => `<div class="my-tile"><small>${t}</small><b>${esc(tot(k))}</b><span>all your listings</span></div>`).join('')}</div>
      ${mine.length ? `<div class="v3c-wrap"><table class="gw-table"><thead><tr><th>Property</th><th>Status</th><th>Saves</th><th>Enquiries</th><th>Visits</th><th>Offers</th><th>WhatsApp</th></tr></thead><tbody>${mine.map((l) => { const s = st[l.id] || {}; return `<tr><td><button type="button" class="link-button" data-open="${esc(l.id)}">${esc(l.title)}</button><br><small>${esc(l.ref || '')}</small></td><td>${esc(l.status)}</td><td>${esc(s.saves || 0)}</td><td>${esc(s.enquiries || 0)}</td><td>${esc(s.visits || 0)}</td><td>${esc(s.offers || 0)}</td><td>${esc(s.whatsapp || 0)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="admin-empty">You have not listed a property yet.</div>'}`;
  };

  // ---------- 7. Project showcase (#projects) ----------
  const V3PI = SB ? { get: async (id) => { const { data } = await SB.from('listings').select('project_info').eq('id', id).maybeSingle(); return (data && data.project_info) || {}; }, set: (id, p) => v3fRpc('admin_set_project_info', { p_listing: id, p }) }
    : { get: async (id) => store.get('proj.info', {})[id] || {}, set: async (id, p) => { const a = store.get('proj.info', {}); a[id] = p; store.set('proj.info', a); } };
  const V3PI_FIELDS = [['developer', 'Developer / builder'], ['approvals', 'Approvals (authority, NOC numbers)'], ['possession', 'Expected possession'], ['units', 'Units / plot sizes'], ['layout', 'Layout plan image link'], ['map', 'Map or location link']];
  async function openProjects() {
    closeNavMenus(); if (pf.my.open) closeMy(); if ($('.modal-backdrop')) closeModal();
    const list = db.listings.filter((l) => !l.sample && l.status === 'published' && l.raqboRole);
    const card = openModal('<div class="gw-loading">Loading projects…</div>', { wide: true, label: 'RAQBO projects' }); card.classList.add('gw-card');
    const rows = await Promise.all(list.map(async (l) => { const [d, info] = await Promise.all([V3P.get(l.id).catch(() => ({ updates: [], plan: [] })), V3PI.get(l.id).catch(() => ({}))]); return { l, d, info }; }));
    setBody(card, `<div class="v3e-page"><div class="eyebrow"><span></span> RAQBO DIRECT</div><h2>Projects &amp; developments</h2><p class="modal-lead">Properties RAQBO owns, markets or develops with partners — with RAQBO's role, approvals, progress and payment plans in one place.</p>
      <div class="v3pr-grid">${rows.map(({ l, d, info }) => { const last = d.updates.find((u) => u.progress != null); return `<article class="v3pr"><div class="v3pr-img" ${mediaAttr(l.photos[0], true)}><span class="rd-label">${esc((RAQBO_ROLES[l.raqboRole] || [''])[0])}</span></div><div class="v3pr-body"><h3>${esc(l.title)}</h3><small>${esc(l.area)}, ${esc(l.city)} · ${esc(fmtPrice(l.price))}</small>
        ${last ? `<div class="v3p-bar"><div><b>${esc(last.progress)}%</b><small>complete</small></div><span><i style="width:${Math.max(0, Math.min(100, +last.progress))}%"></i></span></div>` : ''}
        <dl>${V3PI_FIELDS.filter(([k]) => info[k] && !['layout', 'map'].includes(k)).map(([k, t]) => `<div><dt>${esc(t)}</dt><dd>${esc(info[k])}</dd></div>`).join('')}${d.plan.length ? `<div><dt>Payment plan</dt><dd>${esc(d.plan.map((p) => `${p.label} ${p.pct != null ? p.pct + '%' : p.amount ? rs(p.amount) : ''}`).join(' · '))}</dd></div>` : ''}</dl>
        <div class="button-row"><button type="button" class="button button-primary" data-open="${esc(l.id)}">View project</button>${/^https:\/\//.test(info.layout || '') ? `<a class="button button-outline" href="${esc(info.layout)}" target="_blank" rel="noopener">Layout plan</a>` : ''}${/^https:\/\//.test(info.map || '') ? `<a class="button button-outline" href="${esc(info.map)}" target="_blank" rel="noopener">Map</a>` : ''}</div></div></article>`; }).join('') || '<div class="admin-empty">No RAQBO projects are listed yet.</div>'}</div></div>`);
    hydrate(card);
  }
  { const base = V3_ADMIN.projects; V3_ADMIN.projects = () => { const html = base(); setTimeout(v3piAdminFill, 0); return html; }; }
  async function v3piAdminFill() {
    for (const sec of $$('.v3p-adm[data-pid]')) { if ($('[data-v3pi]', sec)) continue; const id = sec.dataset.pid; const info = await V3PI.get(id).catch(() => ({}));
      sec.insertAdjacentHTML('beforeend', `<form class="v3x-form" data-v3pi="${esc(id)}"><b class="wide">Project details (shown on the Projects page)</b>${V3PI_FIELDS.map(([k, t]) => `<label>${esc(t)}<input name="${k}" maxlength="300" value="${esc(info[k] || '')}"></label>`).join('')}<button class="button button-outline" type="submit">Save details</button></form>`); }
  }
  document.addEventListener('submit', async (ev) => { const f = ev.target.closest('[data-v3pi]'); if (!f) return; ev.preventDefault(); const p = {}; V3PI_FIELDS.forEach(([k]) => { const v = f[k].value.trim(); if (v) p[k] = v.slice(0, 300); }); const done = busy($('button', f), '…'); try { await V3PI.set(f.dataset.v3pi, p); done(); toast('Project details saved.'); } catch (err) { done(); toast(err.message); } });

  // ---------- 8. Smart matching (#smart-match) ----------
  const V3M_TYPES = [['Apartment', /\b(flat|apartment|apt)s?\b/], ['Plot', /\b(plot|land|file)s?\b/], ['Commercial', /\b(shop|office|commercial|plaza|warehouse)s?\b/], ['House', /\b(house|home|villa|bungalow|ghar)s?\b/]];
  function v3mParse(text) {
    const t = ' ' + String(text || '').toLowerCase().replace(/,/g, ' ') + ' '; const o = {};
    o.purpose = /\b(rent|kiraye|kiraya|lease)\b/.test(t) ? 'rent' : /\b(buy|purchase|sale|khareed)\b/.test(t) ? 'sale' : '';
    for (const [k, re] of V3M_TYPES) if (re.test(t)) { o.type = k; break; }
    const sz = /(\d+(?:\.\d+)?)\s*(marla|kanal)/.exec(t); if (sz) o.marla = +sz[1] * (sz[2] === 'kanal' ? 20 : 1);
    const bud = /(?:under|below|upto|up to|max|budget|within|tak)?\s*(?:rs\.?|pkr)?\s*(\d+(?:\.\d+)?)\s*(crore|cr|lakh|lac|k|thousand|million|m)\b/.exec(t);
    if (bud) { const n = +bud[1]; o.budget = Math.round(n * ({ crore: 1e7, cr: 1e7, lakh: 1e5, lac: 1e5, k: 1e3, thousand: 1e3, million: 1e6, m: 1e6 }[bud[2]])); }
    const beds = /(\d+)\s*(bed|bedroom|bhk|room)/.exec(t); if (beds) o.beds = +beds[1];
    const cities = [...new Set(db.listings.map((l) => String(l.city).toLowerCase()))]; o.city = cities.find((c) => t.includes(' ' + c + ' ')) || '';
    const areas = [...new Set(db.listings.map((l) => String(l.area)))].filter(Boolean); const area = areas.map((a) => [a, a.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && t.includes(' ' + w + ' ')).length / a.split(/\s+/).length]).sort((a, b) => b[1] - a[1])[0];
    if (area && area[1] >= 0.3) o.area = area[0];
    o.prefs = ['corner', 'park', 'main road', 'furnished', 'new', 'verified'].filter((w) => t.includes(w)); return o;
  }
  function v3mScore(l, o) {
    let s = 0, max = 0; const why = []; const add = (w, ok, txt) => { max += w; if (ok) { s += w; if (txt) why.push(txt); } };
    if (o.purpose) add(20, l.purpose === o.purpose, l.purpose === 'rent' ? 'for rent' : 'for sale');
    if (o.type) add(20, l.type === o.type, l.type.toLowerCase());
    if (o.city) add(15, String(l.city).toLowerCase() === o.city, l.city);
    if (o.area) add(15, l.area === o.area, l.area);
    if (o.budget) { max += 15; if (l.price <= o.budget) { s += 15; why.push('within budget'); } else if (l.price <= o.budget * 1.1) s += 7; }
    if (o.marla) { max += 10; const m = marlaOf(l); if (m && Math.abs(m - o.marla) <= o.marla * 0.1) { s += 10; why.push(`${Math.round(m * 10) / 10} marla`); } else if (m && Math.abs(m - o.marla) <= o.marla * 0.3) s += 4; }
    if (o.beds) add(5, (l.beds || 0) >= o.beds, `${l.beds} beds`);
    if (o.prefs.includes('verified')) add(5, vfIsVerified(l.id), 'RAQBO Verified');
    if (o.prefs.includes('furnished')) add(3, /furnish/i.test(l.title + ' ' + (l.description || '')), 'furnished');
    if (o.prefs.includes('corner')) add(3, /corner/i.test(l.title + ' ' + (l.description || '')), 'corner');
    return { score: max ? Math.round((s / max) * 100) : 0, why };
  }
  function openSmartMatch(q) {
    closeNavMenus(); if (pf.my.open) closeMy(); if ($('.modal-backdrop')) closeModal();
    const card = openModal(`<div class="v3e-page v3m"><div class="eyebrow"><span></span> SMART MATCH</div><h2>Describe what you are looking for</h2><p class="modal-lead">Write it the way you would say it — for example “10 marla house in DHA Lahore under 6 crore, corner, verified”. RAQBO ranks every approved property by how well it fits.</p>
      <form class="v3m-form" data-v3m-form><input name="q" maxlength="300" value="${esc(q || '')}" placeholder="e.g. 2 bed flat for rent in Gulberg Lahore under 80k"><button class="button button-primary" type="submit">Find matches</button></form><div data-v3m-out></div>
      <p class="form-hint">Smart match follows clear rules (purpose, type, city, area, budget, size, bedrooms, preferences) — it is a search aid, not a valuation or verification.</p></div>`, { wide: true, label: 'Smart match' });
    card.classList.add('gw-card'); if (q) v3mRun(card, q);
  }
  function v3mRun(card, q) {
    const o = v3mParse(q); const out = $('[data-v3m-out]', card);
    const chips = [o.purpose && (o.purpose === 'rent' ? 'Rent' : 'Buy'), o.type, o.city && o.city.replace(/\b\w/g, (m) => m.toUpperCase()), o.area, o.marla && `${o.marla} marla`, o.budget && `up to ${fmtPrice(o.budget)}`, o.beds && `${o.beds}+ beds`, ...o.prefs].filter(Boolean);
    const res = db.listings.filter((l) => l.status === 'published').map((l) => ({ l, ...v3mScore(l, o) })).filter((r) => r.score >= 40).sort((a, b) => b.score - a.score).slice(0, 12);
    out.innerHTML = `<p class="v3m-chips">${chips.length ? 'Understood: ' + chips.map((c) => `<span>${esc(c)}</span>`).join('') : 'Add a few details — type, city, budget or size.'}</p>
      ${res.length ? `<div class="v3m-list">${res.map((r) => `<article class="v3m-item" data-open="${esc(r.l.id)}" tabindex="0"><div class="rail-img" ${mediaAttr(r.l.photos[0], true)}></div><div><b>${esc(r.l.title)}</b><small>${esc(r.l.area)}, ${esc(r.l.city)} · ${esc(fmtPrice(r.l.price))}${r.l.purpose === 'rent' ? '/mo' : ''}</small><span>${esc(r.why.join(' · '))}</span></div><em>${esc(r.score)}%</em></article>`).join('')}</div>` : '<div class="admin-empty">No close matches yet.</div>'}
      <div class="button-row"><button type="button" class="button button-outline" data-gw="post-wanted">Post this as a Property Wanted request</button></div>`;
    hydrate(out);
  }
  document.addEventListener('submit', (ev) => { const f = ev.target.closest('[data-v3m-form]'); if (!f) return; ev.preventDefault(); v3mRun(f.closest('.modal-card'), f.q.value); });

  // ---------- 9. Possible duplicate accounts ----------
  var v3da = { d: null };
  V3_ADMIN.accounts = () => {
    if (!v3da.d) { (async () => { await new Promise((r) => setTimeout(r, 0)); try { if (SB) v3da.d = await v3fRpc('admin_account_checks'); else { const acc = Object.values(store.get('accounts', {})); const g = {}; acc.forEach((a) => { const k = String(a.phone || '').replace(/\D/g, '').slice(-10); if (k) (g[k] = g[k] || []).push({ id: a.userId, name: a.name, email: a.email }); }); v3da.d = { same_phone: Object.entries(g).filter(([, m]) => m.length > 1).map(([k, m]) => ({ k, members: m, n: m.length })), same_cnic_name: [], referral_bursts: [] }; } } catch (e) { v3da.d = { error: e.message }; } if (admin.tab === 'accounts') renderAdmin(); })(); return '<div class="admin-empty">Checking accounts…</div>'; }
    const d = v3da.d; if (d.error) return `<div class="admin-empty">${esc(d.error)}</div>`;
    const grp = (rows, label) => rows.length ? rows.map((g) => `<div class="vfa-req"><b>${esc(label)} ${esc(g.k)}</b> · ${esc(g.n)} accounts<ul>${(g.members || []).map((m) => `<li>${esc(m.name || '')} · ${esc(m.email || '')}${m.joined ? ' · joined ' + esc(fmtDay(m.joined)) : ''}${m.referred_by ? ' · referred' : ''}</li>`).join('')}</ul></div>`).join('') : '<div class="admin-empty sm">None found.</div>';
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> GROW RAQBO</div><h2>Account checks</h2><p class="admin-sub">Accounts that share a phone number or a CNIC name, and members who referred many sign-ups in one day. Hold referral rewards for these until you have checked them.</p></div><button type="button" class="admin-refresh" data-v3da="reload">Refresh</button></div>
      <section class="gwa-sec"><h3>Same phone number</h3>${grp(d.same_phone || [], 'Phone ending')}</section><section class="gwa-sec"><h3>Same name on CNIC</h3>${grp(d.same_cnic_name || [], 'Name')}</section>
      <section class="gwa-sec"><h3>Many referrals in 24 hours</h3>${(d.referral_bursts || []).map((r) => `<p>${esc(r.name || '')} · ${esc(r.email || '')} — ${esc(r.n)} sign-ups</p>`).join('') || '<div class="admin-empty sm">None.</div>'}</section></div>`;
  };
  document.addEventListener('click', (ev) => { if (ev.target.closest('[data-v3da="reload"]')) { v3da.d = null; renderAdmin(); } });

  // ---------- 10. Security tab: business identity, agent packages, data backup ----------
  { const base = V3_ADMIN.security; V3_ADMIN.security = () => { const i = v3fId(); return base().replace(/<\/div>\s*$/, '') + `
      <section class="gwa-sec"><h3>${DI(DIC.doc, 18)} Business identity</h3><p class="gw-mini">Shown in the footer, on verification reports and receipts. Fill in only what is registered — leave empty until the business is registered.</p><form class="v3x-form" data-v3f-form="identity">${[['legal_name', 'Registered name'], ['legal_type', 'Type (e.g. sole proprietor, SMC-Private Limited)'], ['legal_reg_no', 'Registration no.'], ['legal_ntn', 'NTN'], ['legal_address', 'Registered address']].map(([k, t]) => `<label>${esc(t)}<input name="${k}" maxlength="300" value="${esc(i[k])}"></label>`).join('')}<button class="button button-outline" type="submit">Save identity</button></form></section>
      <section class="gwa-sec"><h3>${DI(DIC.star, 18)} Agent packages</h3><form class="v3x-form" data-v3f-form="plans"><label class="wide">One package per line: key | name | price per month | live listings | sponsored per month | what it includes<textarea name="plans" rows="4">${esc(v3fPlans().map((p) => [p.key, p.name, p.price, p.listings, p.featured, p.perks].join(' | ')).join('\n'))}</textarea></label><button class="button button-outline" type="submit">Save packages</button></form></section>
      <section class="gwa-sec"><h3>${DI(DIC.lock, 18)} Data backup</h3><p class="gw-mini">A copy of listings, members, verifications, requests, complaints, refunds, finances and settings. The report is for reading, printing and filing. The data file is the one a developer would use to put the information back. Supabase also keeps its own daily backups on the Pro plan.</p><div class="pn-cta"><button type="button" class="button button-primary" data-v3f="backup">Download the backup report</button> <button type="button" class="button button-outline" data-v3f="backup-data">Download the data file</button></div></section></div>`; }; }
  document.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-v3f-form]'); if (!f) return; ev.preventDefault(); const done = busy($('button[type=submit]', f), '…');
    try {
      if (f.dataset.v3fForm === 'identity') { const p = {}; ['legal_name', 'legal_type', 'legal_reg_no', 'legal_ntn', 'legal_address'].forEach((k) => { p[k] = f[k].value.trim(); }); if (SB) { await v3fRpc('admin_save_identity', { p, p_reason: '' }); await pfLoad(); } else store.set('v3f.identity', p); v3fFooter(); }
      else { const plans = f.plans.value.split('\n').map((x) => x.split('|').map((y) => y.trim())).filter((a) => a.length >= 3 && a[0]).map(([key, name, price, listings, featured, perks]) => ({ key: key.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30), name: name || key, price: Math.max(0, Math.round(+price || 0)), listings: Math.round(+listings || 0), featured: Math.round(+featured || 0), perks: perks || '' }));
        if (!plans.length) throw new Error('Add at least one package.');
        if (SB) { await v3fRpc('admin_save_agent_plans', { p_plans: plans }); await pfLoad(); } else store.set('v3f.plans', plans); }
      done(); toast('Saved.');
    } catch (err) { done(); toast(err.message); }
  });
  // ---------- The backup, as a PDF anyone can read and file ----------
  // A page of raw data is useless to the people who need the backup. This
  // makes a proper document: RAQBO's logo, the date, what was taken, and
  // every record in a plain table, as a PDF that can be printed or emailed.
  // The data file is still available beside it, because that is the copy a
  // developer needs to put the information back.
  const V3F_PDF = [
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk'],
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3']
  ];
  let v3fPdfP = null;
  function v3fPdfLib() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve(window.jspdf.jsPDF);
    if (!v3fPdfP) {
      // Each file is checked against its fingerprint, so a tampered copy
      // cannot run even if the network it comes from were interfered with.
      v3fPdfP = V3F_PDF.reduce((chain, [src, integrity]) => chain.then(() => new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = src; sc.integrity = integrity; sc.crossOrigin = 'anonymous'; sc.referrerPolicy = 'no-referrer';
        sc.onload = res; sc.onerror = () => rej(new Error('The PDF tools could not be loaded. Check the internet connection and try again.'));
        document.head.appendChild(sc);
      })), Promise.resolve()).then(() => window.jspdf.jsPDF);
    }
    return v3fPdfP;
  }

  // The RAQBO mark comes from the page itself (see brandlogo.js), so the
  // document always carries it — nothing to fetch and nothing to go missing.
  const v3fLogoPng = () => (typeof RAQBO_MARK === 'object' && RAQBO_MARK && RAQBO_MARK.url) ? RAQBO_MARK : null;

  const v3fLabel = (k) => String(k).replace(/[_.]/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bId\b/g, 'ID').replace(/\bNtn\b/g, 'NTN').replace(/\bCnic\b/g, 'CNIC')
    .replace(/\bQr\b/g, 'QR').replace(/\bPkr\b/g, 'PKR').replace(/\bUrl\b/g, 'link').replace(/\bRef\b/g, 'Reference');
  const v3fVal = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.length ? v.map(v3fVal).join(', ') : '—';
    if (typeof v === 'object') return Object.entries(v).map(([k2, v2]) => v3fLabel(k2) + ': ' + v3fVal(v2)).join('; ') || '—';
    const str = String(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(str)) { const d = new Date(str); if (!isNaN(d)) return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) { const d = new Date(str + 'T12:00:00'); if (!isNaN(d)) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    return str.length > 220 ? str.slice(0, 217) + '…' : str;
  };

  const V3F_GOLD = [200, 148, 47], V3F_INK = [22, 18, 10], V3F_MUTED = [107, 102, 92], V3F_LINE = [230, 221, 200];

  async function v3fReportPdf(data) {
    const JsPDF = await v3fPdfLib();
    const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
    const W = doc.internal.pageSize.getWidth(), M = 40;
    const when = new Date();
    const who = (db.session && db.session.email) || '';
    const id = v3fId();
    const skip = new Set(['exported_at', 'demo']);
    const sections = Object.entries(data).filter(([k]) => !skip.has(k));
    const countOf = (v) => Array.isArray(v) ? v.length
      : (v && typeof v === 'object' ? Object.values(v).reduce((a, x) => a + (Array.isArray(x) ? x.length : 1), 0) : 1);
    const total = sections.reduce((a, [, v]) => a + countOf(v), 0);

    // ---- the heading block, with the logo ----
    let y = M;
    const logo = v3fLogoPng();
    let x = M;
    if (logo) {
      try {
        const h = 40, w = Math.max(10, (logo.w / Math.max(1, logo.h)) * h);
        doc.addImage(logo.url, 'PNG', M, y - 4, w, h);
        x = M + w + 12;
      } catch { x = M; }
    }
    doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...V3F_INK).text('RAQBO', x, y + 18, { charSpace: 1.6 });
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...V3F_MUTED)
      .text('EVERY PROPERTY SOLUTION. ONE PLACE.', x + 1, y + 30, { charSpace: 1.1 });
    y += 44;
    doc.setDrawColor(...V3F_GOLD).setLineWidth(2).line(M, y, W - M, y); y += 28;

    doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...V3F_INK).text('Data backup', M, y); y += 18;
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...V3F_MUTED)
      .text('A readable copy of everything RAQBO holds, as it stood at the moment below.', M, y); y += 22;

    const meta = [['Taken on', when.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })]];
    if (who) meta.push(['Taken by', who]);
    if (id.legal_name) meta.push(['Business', id.legal_name + (id.legal_reg_no ? ' · ' + id.legal_reg_no : '') + (id.legal_ntn ? ' · NTN ' + id.legal_ntn : '')]);
    meta.push(['Records in this copy', total.toLocaleString('en-GB') + ' across ' + sections.length + ' sections']);
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'plain', body: meta,
      styles: { fontSize: 9, cellPadding: 4, textColor: V3F_INK },
      columnStyles: { 0: { cellWidth: 130, textColor: V3F_MUTED, fontStyle: 'bold' } }
    });
    y = doc.lastAutoTable.finalY + 22;

    const heading = (text, note) => {
      if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = M; }
      doc.setDrawColor(...V3F_LINE).setLineWidth(0.5).line(M, y - 10, W - M, y - 10);
      doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...V3F_INK).text(text, M, y + 4);
      if (note) doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...V3F_MUTED).text(note, W - M, y + 4, { align: 'right' });
      y += 16;
    };
    const tableOpts = {
      margin: { left: M, right: M }, theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 3.5, textColor: V3F_INK, lineColor: [239, 233, 219], lineWidth: 0.4, overflow: 'linebreak' },
      headStyles: { fillColor: [250, 246, 236], textColor: V3F_MUTED, fontStyle: 'bold', fontSize: 7, lineColor: V3F_LINE },
      alternateRowStyles: { fillColor: [252, 251, 247] }
    };

    heading('What is in this backup', sections.length + ' sections');
    doc.autoTable({ ...tableOpts, startY: y, head: [['Section', 'Records']],
      body: sections.map(([k, v]) => [v3fLabel(k), countOf(v).toLocaleString('en-GB')]),
      columnStyles: { 1: { halign: 'right', cellWidth: 70 } } });
    y = doc.lastAutoTable.finalY + 24;

    const listTable = (rows) => {
      if (!rows.length) { doc.setFont('helvetica', 'italic').setFontSize(9).setTextColor(...V3F_MUTED).text('Nothing recorded.', M, y); y += 20; return; }
      if (typeof rows[0] !== 'object' || rows[0] === null) {
        doc.autoTable({ ...tableOpts, startY: y, body: rows.map((r) => [v3fVal(r)]) });
      } else {
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 9);
        doc.autoTable({ ...tableOpts, startY: y, head: [cols.map(v3fLabel)], body: rows.map((r) => cols.map((c) => v3fVal(r[c]))) });
      }
      y = doc.lastAutoTable.finalY + 22;
    };

    sections.forEach(([k, v]) => {
      heading(v3fLabel(k), countOf(v) + (countOf(v) === 1 ? ' record' : ' records'));
      if (Array.isArray(v)) { listTable(v); return; }
      if (v && typeof v === 'object') {
        const entries = Object.entries(v);
        const plain = entries.filter(([, x]) => !Array.isArray(x));
        const lists = entries.filter(([, x]) => Array.isArray(x));
        if (plain.length) {
          doc.autoTable({ ...tableOpts, startY: y, body: plain.map(([k2, v2]) => [v3fLabel(k2), v3fVal(v2)]),
            columnStyles: { 0: { cellWidth: 150, textColor: V3F_MUTED, fontStyle: 'bold' } } });
          y = doc.lastAutoTable.finalY + 18;
        }
        lists.forEach(([k2, v2]) => {
          if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = M; }
          doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...V3F_INK).text(v3fLabel(k2), M, y);
          doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...V3F_MUTED)
            .text(v2.length + (v2.length === 1 ? ' record' : ' records'), W - M, y, { align: 'right' });
          y += 10; listTable(v2);
        });
        return;
      }
      doc.autoTable({ ...tableOpts, startY: y, body: [[v3fLabel(k), v3fVal(v)]],
        columnStyles: { 0: { cellWidth: 150, textColor: V3F_MUTED, fontStyle: 'bold' } } });
      y = doc.lastAutoTable.finalY + 22;
    });

    // ---- page numbers and a note on every page ----
    const pages = doc.internal.getNumberOfPages();
    const stamp = when.toLocaleString('en-GB');
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      const H = doc.internal.pageSize.getHeight();
      doc.setDrawColor(...V3F_LINE).setLineWidth(0.5).line(M, H - 34, W - M, H - 34);
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...V3F_MUTED);
      doc.text('RAQBO data backup · ' + stamp, M, H - 22);
      doc.text('Page ' + i + ' of ' + pages, W - M, H - 22, { align: 'right' });
    }
    return doc;
  }

  const v3fSave = (text, type, name) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  async function v3fBackupData() {
    let data;
    if (SB) { data = await v3fRpc('admin_export_backup'); try { Object.assign(data, await v3fRpc('oa_admin_export')); } catch { /* official auctions not set up */ } }
    else { data = { exported_at: new Date().toISOString(), demo: true };
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);
        if (k && k.startsWith('raqbo.demo.')) { try { data[k.slice(11)] = JSON.parse(localStorage.getItem(k)); } catch { /* ignore */ } } } }
    return data;
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-v3f="backup"], [data-v3f="backup-data"]'); if (!b) return;
    const raw = b.dataset.v3f === 'backup-data';
    const done = busy(b, 'Preparing…');
    try {
      const data = await v3fBackupData();
      const day = new Date().toISOString().slice(0, 10);
      if (raw) { v3fSave(JSON.stringify(data, null, 1), 'application/json', `raqbo-backup-${day}.json`); done(); toast('Data file downloaded. Keep it somewhere safe.'); return; }
      const doc = await v3fReportPdf(data);
      doc.save(`RAQBO-backup-${day}.pdf`);
      done(); toast('Backup report downloaded as a PDF. Keep a copy somewhere other than this computer.');
    } catch (err) { done(); toast(err.message); }
  });

  // ---------- KPI tiles for the new numbers ----------
  { const base = v3xKpiHTML; v3xKpiHTML = function () { const h = base(); const k = v3x.k; if (!h || !k || k.error || k.completed_month === undefined) return h;
    const t = (label, val, sub, tab) => `<button type="button" class="v3x-kpi" ${tab ? `data-tab="${tab}"` : ''}><small>${esc(label)}</small><b>${esc(val)}</b><span>${esc(sub)}</span></button>`;
    return h.replace('</div>\n', `${t('Property enquiries', k.enquiries_month ?? '—', 'buyer conversations this month', 'enquiries')}${t('QuickSell requests', k.quicksell_open ?? '—', 'open in the pipeline', 'urgent')}${t('Purchase offers', k.offers_month ?? '—', 'made this month', 'urgent')}${t('Auction participation', k.auction_bidders ?? '—', `approved bidders · ${k.auction_bids_month ?? 0} bids this month`, 'auctions')}${t('New registrations', k.registrations_today ?? '—', 'today')}${t('Completed transactions', k.completed_month, `this month · ${k.completed_total} in total`)}${t('Agent packages', k.agents_active, `${k.agents_pending} waiting`, 'agents')}${t('Quotations open', k.quotes_open, 'waiting for the customer', 'enquiries')}</div>\n`); }; }

  // ---------- Links ----------
  Object.assign(MY_ROLE_OF, { performance: ['sell'], agent: ['sell'] });
  Object.assign(AX_ICON, { agents: 'star', accounts: 'user' }); Object.assign(AX_HINT, { agents: 'Agent and developer packages to activate', accounts: 'Accounts that may belong to the same person' });
  V3S_GROUPS.find((g) => g.key === 'invest').items.push(['projects_page', 'Projects & developments', 'RAQBO Direct and partner projects with approvals, progress and payment plans.', 'Free to browse', false, null, 'data-v3f="projects"'], ['smart_match', 'Smart match', 'Describe what you need in your own words and see the best-fitting properties ranked.', 'Free', false, null, 'data-v3f="smart"'], ['agent_packages', 'Agent & developer packages', 'Packages for agents and developers with many listings. Basic listings stay free.', 'From Rs 3,000 / month', false, null, 'data-my="agent"']);
  ['projects_page', 'smart_match', 'agent_packages'].forEach((k) => { const it = V3S_GROUPS.find((g) => g.key === 'invest').items.find((x) => x[0] === k); V3S_ALL[k] = { k, t: it[1], d: it[2], fee: it[3], link: it[6], group: 'Property Investment' }; });
  document.addEventListener('click', (ev) => { const b = ev.target.closest('[data-v3f]'); if (!b || b.dataset.v3f === 'backup') return; ev.preventDefault(); if (b.dataset.v3f === 'projects') openProjects(); else if (b.dataset.v3f === 'smart') openSmartMatch(''); });
  (function v3fLinks() { const col = $('.site-footer .v3e-flinks'); if (col && !$('[data-v3f="projects"]', col.parentNode)) col.insertAdjacentHTML('afterend', '<button type="button" data-v3f="projects">RAQBO projects</button><button type="button" data-v3f="smart">Smart match</button>'); })();
  addEventListener('hashchange', () => { if (location.hash === '#projects') openProjects(); else if (location.hash === '#smart-match') openSmartMatch(''); });
  if (location.hash === '#projects') setTimeout(openProjects, 800); else if (location.hash === '#smart-match') setTimeout(() => openSmartMatch(''), 800);

