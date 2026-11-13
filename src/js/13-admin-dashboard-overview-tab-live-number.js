  /* =====================================================================
     Admin dashboard (Overview tab) — live numbers, trends and activity.
     Supabase: one call to admin_dashboard() (update_10_admin_dashboard.sql)
     refreshed by realtime changes; demo mode builds the same numbers locally.
     ===================================================================== */
  const ad = { data: null, at: 0, loading: false, err: '', unsub: null, timer: null, tick: null, debounce: null, shown: {}, series: { users: true, listings: true, orders: true }, flash: false };
  const pkrShort = (n) => { n = Number(n) || 0; if (n >= 1e7) return 'PKR ' + (Math.round(n / 1e5) / 100) + ' Cr'; if (n >= 1e5) return 'PKR ' + (Math.round(n / 1e3) / 100) + ' Lakh'; return 'PKR ' + n.toLocaleString('en-US'); };
  const dayKey = (t) => { const d = new Date(t); return new Date(d.getTime() + 5 * 3600e3).toISOString().slice(0, 10); };   // Pakistan date
  // Support chats where the member wrote last and no one from RAQBO has answered yet (demo store)
  function dashSupportLocal() {
    try { const d = store.get('live', { c: [] }); return (d.c || []).filter((c) => !c.other_id && c.last_sender && c.last_sender === c.starter_id).length; } catch { return 0; }
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-dash-support]')) { e.preventDefault(); openInbox(); } });
  function localDash() {
    const now = Date.now(); const W = 7 * 864e5, M = 30 * 864e5; const today = dayKey(now);
    const acc = Object.values(store.get('accounts', {}));
    const L = db.listings.filter((l) => !l.sample); const pub = db.listings.filter((l) => l.status === 'published');
    const D = mk.data || { vendors: [], orders: [], products: [], buyers: [] };
    const V = D.vendors.filter((v) => v.ownerId); const O = D.orders || [];
    const sum = (arr) => arr.reduce((a, o) => a + (Number(o.total) || 0), 0);
    const count = (arr, f) => arr.filter(f).length;
    const byCity = {}; pub.forEach((l) => { byCity[l.city] = (byCity[l.city] || 0) + 1; });
    const pipe = {}; O.forEach((o) => { pipe[o.status] = (pipe[o.status] || 0) + 1; });
    const days = Array.from({ length: 30 }, (_, i) => dayKey(now - (29 - i) * 864e5));
    const oAt = (o) => o.createdAt || 0; const aAt = (a) => a.since || a.createdAt || 0;
    const series = days.map((day) => ({ day, users: count(acc, (a) => aAt(a) && dayKey(aAt(a)) === day), listings: count(L, (l) => l.createdAt && dayKey(l.createdAt) === day), orders: count(O, (o) => oAt(o) && dayKey(oAt(o)) === day) }));
    const act = [
      ...acc.map((a) => ({ kind: 'user', at: aAt(a), text: `${a.name || 'New member'} joined`, link: '' })),
      ...L.map((l) => ({ kind: 'listing', at: l.createdAt || 0, text: `Listing ${l.status}: ${l.title}`, link: 'listing:' + l.id })),
      ...O.flatMap((o) => (o.events || []).map((e) => ({ kind: 'order', at: e.at || Date.parse(e.created_at) || 0, text: `${o.ref} · ${String(e.status).replace(/_/g, ' ')} (${e.actor})`, link: 'order:' + o.id }))),
      ...V.map((v) => ({ kind: 'supplier', at: v.createdAt || 0, text: `Supplier ${v.status}: ${v.shop}`, link: 'vendor:' + v.id })),
      ...db.enquiries.map((e) => ({ kind: 'enquiry', at: e.createdAt || 0, text: `Service enquiry from ${e.name}`, link: 'tab:enquiries' })),
      ...db.reports.map((r) => ({ kind: 'report', at: r.createdAt || 0, text: `Property reported: ${r.reason}`, link: 'tab:reports' }))
    ].filter((a) => a.at).sort((a, b) => b.at - a.at).slice(0, 40).map((a) => ({ ...a, at: new Date(a.at).toISOString() }));
    return {
      generated_at: new Date().toISOString(), demo: true,
      users: { total: acc.length, verified: acc.length, admins: 0, today: count(acc, (a) => aAt(a) && dayKey(aAt(a)) === today), week: count(acc, (a) => now - aAt(a) < W), month: count(acc, (a) => now - aAt(a) < M), prev_month: count(acc, (a) => { const g = now - aAt(a); return g >= M && g < 2 * M; }) },
      listings: { total: L.length, pending: count(db.listings, (l) => l.status === 'pending'), published: pub.length, rejected: count(db.listings, (l) => l.status === 'rejected'), sale: count(pub, (l) => l.purpose !== 'rent'), rent: count(pub, (l) => l.purpose === 'rent'), week: count(L, (l) => now - (l.createdAt || 0) < W), pinned: count(pub, (l) => l.lat != null) },
      cities: Object.entries(byCity).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([city, n]) => ({ city, n })),
      suppliers: { total: V.length, approved: count(V, (v) => v.status === 'approved'), pending: count(D.vendors, (v) => v.status === 'pending'), verified: count(V, (v) => v.verified), escrow: count(V, (v) => v.escrow), samples: count(D.vendors, (v) => !v.ownerId), week: count(V, (v) => now - (v.createdAt || 0) < W) },
      products: D.vendors.reduce((a, v) => a + ((v.products || []).length), 0), buyers: (D.buyers || []).length || new Set(O.map((o) => o.buyerId)).size,
      orders: { total: O.length, today: count(O, (o) => dayKey(oAt(o)) === today), week: count(O, (o) => now - oAt(o) < W), to_verify: pipe.payment_review || 0, disputes: pipe.disputed || 0, payouts_due: pipe.completed || 0,
        active: O.filter((o) => ['quote_requested', 'quoted', 'awaiting_payment', 'payment_review', 'paid_escrow', 'dispatched', 'delivered'].includes(o.status)).length,
        escrow_held: sum(O.filter((o) => ['paid_escrow', 'dispatched', 'delivered', 'completed', 'disputed'].includes(o.status))), sales: sum(O.filter((o) => ['completed', 'released'].includes(o.status))), released: sum(O.filter((o) => o.status === 'released')) },
      pipeline: pipe,
      engagement: { reviews: 0, avg_rating: null, favorites: db.favorites.length, enquiries_new: count(db.enquiries, (e) => e.status === 'new'), enquiries: db.enquiries.length, reports_open: count(db.reports, (r) => r.status === 'open'), conversations: 0, messages_week: 0, support_waiting: dashSupportLocal() },
      series, activity: act
    };
  }
  async function dashFetch(quiet) {
    if (ad.loading) return; ad.loading = true; if (!quiet && !ad.data) dashPaint();
    try {
      if (LIVE && SB) {
        const { data, error } = await SB.rpc('admin_dashboard', { p_days: 30 });
        if (error) { if (/admin_dashboard|function|schema cache/i.test(error.message || '')) { ad.err = 'Run supabase/update_10_admin_dashboard.sql to switch on the live dashboard. Showing what the panel already knows.'; if (!mk.data) await mkLoad(); ad.data = localDash(); ad.data.demo = false; ad.data.partial = true; } else throw new Error(error.message); }
        else { ad.err = ''; ad.data = data; }
      } else { if (!mk.data) await mkLoad(); ad.data = localDash(); }
      ad.at = Date.now();
    } catch (err) { ad.err = err.message || 'Could not load the dashboard.'; }
    ad.loading = false; dashPaint();
  }
  // number that counts up from its last value
  const cnt = (key, value, fmt = 'n') => `<b class="kpi-num" data-cnt="${esc(key)}" data-v="${Number(value) || 0}" data-fmt="${fmt}">${fmt === 'pkr' ? esc(pkrShort(value)) : (Number(value) || 0).toLocaleString('en-US')}</b>`;
  function animateCounts(root) {
    $$('[data-cnt]', root).forEach((el) => {
      const k = el.dataset.cnt; const to = Number(el.dataset.v) || 0; const from = ad.shown[k]; ad.shown[k] = to;
      if (from === undefined || from === to) return;
      el.classList.add(to > from ? 'up' : 'down'); setTimeout(() => el.classList.remove('up', 'down'), 1600);
      if (el.dataset.fmt === 'pkr') return; const t0 = performance.now(); const dur = 700;
      const step = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(from + (to - from) * (1 - (1 - p) ** 3)).toLocaleString('en-US'); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  const KICON = { user: 'user', listing: 'home', order: 'cart', supplier: 'store', enquiry: 'mail', report: 'info', review: 'star' };
  const pl = (n, one, many) => `${(Number(n) || 0).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;
  function trendChart(series) {
    const S = [['users', 'Sign-ups', 'var(--dash-c1)'], ['listings', 'Listings', 'var(--dash-c2)'], ['orders', 'Orders', 'var(--dash-c3)']];
    const w = ad.w || 640, h = 210, l = 34, r = 12, t = 14, b = 28; const n = series.length;
    const max = Math.max(1, ...series.flatMap((d) => S.filter(([k]) => ad.series[k]).map(([k]) => Number(d[k]) || 0)));
    const nice = max <= 4 ? 4 : max <= 10 ? 10 : Math.ceil(max / 5) * 5;
    const X = (i) => l + (i / Math.max(1, n - 1)) * (w - l - r); const Y = (v) => t + (1 - v / nice) * (h - t - b);
    const ticks = [0, nice / 2, nice];
    const lines = S.filter(([k]) => ad.series[k]).map(([k, , c]) => { const pts = series.map((d, i) => `${X(i).toFixed(1)},${Y(Number(d[k]) || 0).toFixed(1)}`); return `<path d="M${pts.join('L')}L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z" fill="${c}" opacity=".10"/><polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`; }).join('');
    const fmtD = (s) => { const [, m, d] = s.split('-'); return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].at(Number(m) - 1)}`; };
    const tot = (k) => series.reduce((a, d) => a + (Number(d[k]) || 0), 0);
    return `<div class="dash-chart-head"><div><h3>Last 30 days</h3><p>New sign-ups, listings and material orders per day</p></div><div class="dash-legend">${S.map(([k, label, c]) => `<button type="button" class="${ad.series[k] ? 'on' : ''}" data-dash-series="${k}" style="--c:${c}"><i></i>${label} <b>${tot(k)}</b></button>`).join('')}</div></div>
      <div class="dash-trend" data-dash-trend data-n="${n}"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily sign-ups, listings and orders over the last 30 days">
        ${ticks.map((v) => `<line x1="${l}" x2="${w - r}" y1="${Y(v)}" y2="${Y(v)}" class="dash-grid"/><text x="${l - 8}" y="${Y(v) + 4}" text-anchor="end" class="dash-tick">${v}</text>`).join('')}
        ${[0, Math.floor((n - 1) / 2), n - 1].map((i) => `<text x="${X(i)}" y="${h - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="dash-tick">${fmtD(series[i].day)}</text>`).join('')}
        ${lines}<line class="dash-cross" x1="0" x2="0" y1="${t}" y2="${h - b}" visibility="hidden"/></svg>
        <div class="dash-tip" hidden></div></div>`;
  }
  function hbar(rows, max, cls = '') { return rows.map(([label, n, extra]) => `<div class="dash-bar ${cls}"><span class="dash-bar-label">${esc(label)}</span><span class="dash-bar-track"><i style="width:${max ? Math.max(3, (n / max) * 100) : 0}%"></i></span><b>${Number(n).toLocaleString('en-US')}</b>${extra || ''}</div>`).join(''); }
  function dashHTML() {
    const d = ad.data;
    const head = `<div class="admin-heading dash-head"><div><div class="eyebrow"><span></span> LIVE FIGURES</div><h2>Business overview</h2></div><div class="dash-live ${ad.flash ? 'flash' : ''}"><span class="dash-dot"></span><span><b>${LIVE ? 'Live' : 'Demo'}</b> · <span data-dash-ago>${ad.at ? 'updated just now' : 'loading…'}</span></span><button type="button" class="admin-refresh" data-dash-refresh>Refresh</button></div></div>`;
    if (!d) return head + (ad.err ? `<div class="admin-empty">${esc(ad.err)}</div>` : `<div class="dash-kpis">${'<div class="dash-kpi skeleton" style="height:118px"></div>'.repeat(8)}</div>`);
    const u = d.users || {}; const li = d.listings || {}; const s = d.suppliers || {}; const o = d.orders || {}; const e = d.engagement || {};
    const growth = u.prev_month ? Math.round(((u.month - u.prev_month) / u.prev_month) * 100) : null;
    const att = [['pending', 'Listings to review', li.pending], ['mk-payments', 'Payments to verify', o.to_verify], ['mk-disputes', 'Disputes', o.disputes], ['mk-orders', 'Payouts to release', o.payouts_due], ['mk-vendors', 'Suppliers to approve', s.pending], ['enquiries', 'New enquiries', e.enquiries_new], ['reports', 'Open reports', e.reports_open], ['@support', 'Support chats waiting for a reply', e.support_waiting]];
    const todo = att.filter(([, , n]) => n > 0);
    const PIPE = [['quote_requested', 'Quote requested'], ['quoted', 'Quoted'], ['awaiting_payment', 'Awaiting payment'], ['payment_review', 'Verifying payment'], ['paid_escrow', 'Held by RAQBO'], ['dispatched', 'Dispatched'], ['delivered', 'Delivered'], ['completed', 'Payout pending'], ['released', 'Vendor paid'], ['disputed', 'Disputed'], ['refunded', 'Refunded'], ['cancelled', 'Cancelled']];
    const pipeRows = PIPE.map(([k, label]) => [label, (d.pipeline || {})[k] || 0]).filter(([, n]) => n > 0);
    const cityMax = Math.max(0, ...(d.cities || []).map((c) => c.n));
    const pubTot = (li.sale || 0) + (li.rent || 0);
    return `${head}
      ${ad.err ? `<p class="admin-message">${esc(ad.err)}</p>` : ''}
      <div class="dash-attn ${todo.length ? '' : 'clear'}">${todo.length ? `<b>${DI(DIC.bell, 16)} Needs attention</b>${todo.map(([tab, label, n]) => `<button type="button" ${tab === '@support' ? 'data-dash-support class="attn-chat"' : `data-tab="${tab}"`}><span>${n}</span>${tab === '@support' ? DI(DIC.chat, 14) + ' ' : ''}${esc(label)}</button>`).join('')}` : `<b>${DI(DIC.check || DIC.info, 16)} All clear</b><span>No listings, payments, disputes, approvals or support chats waiting.</span>`}</div>
      <div class="dash-kpis">
        <article class="dash-kpi k1"><span class="dash-kpi-ico">${DI(DIC.user, 20)}</span><small>Registered users</small>${cnt('users', u.total)}<p><em class="pos">+${u.week || 0}</em> this week · ${u.today || 0} today${growth !== null ? ` · <em class="${growth >= 0 ? 'pos' : 'neg'}">${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}%</em> vs last month` : ''}</p></article>
        <article class="dash-kpi k2"><span class="dash-kpi-ico">${DI(DIC.store, 20)}</span><small>Suppliers</small>${cnt('suppliers', s.approved)}<p>${s.pending || 0} awaiting approval · ${s.verified || 0} verified · ${pl(d.products, 'product', 'products')}</p></article>
        <article class="dash-kpi k3"><span class="dash-kpi-ico">${DI(DIC.cart, 20)}</span><small>Buyers</small>${cnt('buyers', d.buyers)}<p>${pl(o.total, 'material order', 'material orders')} · ${o.active || 0} in progress</p></article>
        <article class="dash-kpi k4"><span class="dash-kpi-ico">${DI(DIC.home, 20)}</span><small>Published listings</small>${cnt('published', li.published)}<p>${li.sale || 0} for sale · ${li.rent || 0} for rent · ${li.pending || 0} pending</p></article>
        <article class="dash-kpi k5"><span class="dash-kpi-ico">${DI(DIC.lock || DIC.info, 20)}</span><small>Held by RAQBO</small>${cnt('escrow', o.escrow_held, 'pkr')}<p>${pl(o.to_verify, 'payment', 'payments')} to verify · ${pl(o.payouts_due, 'payout', 'payouts')} due</p></article>
        <article class="dash-kpi k6"><span class="dash-kpi-ico">${DI(DIC.check || DIC.info, 20)}</span><small>Completed sales</small>${cnt('sales', o.sales, 'pkr')}<p>${esc(pkrShort(o.released))} paid out to suppliers</p></article>
        <article class="dash-kpi k7"><span class="dash-kpi-ico">${DI(DIC.cart, 20)}</span><small>Orders this week</small>${cnt('orders-week', o.week)}<p>${o.today || 0} today · ${o.disputes || 0} in dispute</p></article>
        <article class="dash-kpi k8"><span class="dash-kpi-ico">${DI(DIC.star || DIC.info, 20)}</span><small>Community</small>${cnt('reviews', e.reviews)}<p>${Number(e.reviews) === 1 ? 'review' : 'reviews'}${e.avg_rating ? ` · ★ ${Number(e.avg_rating).toFixed(1)} average` : ''} · ${pl(e.favorites, 'save', 'saves')} · ${pl(e.messages_week, 'message', 'messages')} this week</p></article>
      </div>
      <div class="dash-grid2">
        <section class="dash-card dash-wide">${trendChart(d.series || [])}</section>
        <section class="dash-card"><h3>Listings by city</h3><p class="dash-sub">${pubTot} published · ${li.pinned || 0} pinned on the map</p>${(d.cities || []).length ? hbar(d.cities.map((c) => [c.city, c.n]), cityMax) : '<p class="dash-none">No published listings yet.</p>'}
          <div class="dash-split"><span style="--w:${pubTot ? (li.sale / pubTot) * 100 : 50}%"><i></i></span><small><b>${li.sale || 0}</b> sale</small><small><b>${li.rent || 0}</b> rent</small></div></section>
        <section class="dash-card"><h3>Order pipeline</h3><p class="dash-sub">Where every material order stands now</p>${pipeRows.length ? hbar(pipeRows, Math.max(...pipeRows.map((x) => x[1])), 'pipe') : '<p class="dash-none">No material orders yet.</p>'}
          <div class="dash-mini"><div><b>${s.total || 0}</b><small>supplier shops</small></div><div><b>${s.escrow || 0}</b><small>with protected payment</small></div><div><b>${s.samples || 0}</b><small>RAQBO samples</small></div></div></section>
        <section class="dash-card dash-feed"><div class="dash-feed-head"><h3>Live activity</h3><span class="dash-dot"></span></div><ul>${(d.activity || []).slice(0, 14).map((a) => `<li><span class="dash-feed-ico k-${esc(a.kind)}">${DI(DIC[KICON[a.kind]] || DIC.info, 15)}</span><button type="button" class="dash-feed-txt" data-dash-link="${esc(a.link || '')}"><b>${esc(a.text)}</b><small data-dash-time="${esc(a.at)}">${esc(relShort(a.at))} ago</small></button></li>`).join('') || '<li class="dash-none">No activity yet.</li>'}</ul></section>
      </div>`;
  }
  function dashPaint() {
    if (!admin.el || admin.el.hidden || admin.tab !== 'overview') return;
    const box = ($('.ax-body', admin.el) || $('.admin-content', admin.el)); if (!box) return;
    const keep = box.scrollTop; const msg = '';
    ad.w = ad.wFixed && Math.abs(ad.wFixed - (box.clientWidth - (innerWidth < 700 ? 64 : 120))) < 120
      ? ad.wFixed : Math.max(300, Math.round(box.clientWidth - (innerWidth < 700 ? 64 : 120)));
    const html = msg + dashHTML();
    // A refresh that produces exactly what is already on screen is not drawn
    // again. Without this the dashboard rebuilt itself every minute and on
    // every change anywhere in the database, which read as flickering.
    if (html === ad.lastHTML && $('[data-dash-trend]', box)) { animateCounts(box); dashAgo(); return; }
    ad.lastHTML = html;
    box.innerHTML = html; box.scrollTop = keep;
    // The chart is drawn at a guessed width and then measured. Re-drawing the
    // whole panel to correct it made the dashboard visibly flash on every
    // refresh, so the correction is done once, only when it is worth doing,
    // and never twice in a row for the same measurement.
    const tw = $('[data-dash-trend]', box);
    if (tw && Math.abs(tw.clientWidth - ad.w) > 24 && ad.wFixed !== tw.clientWidth) {
      ad.wFixed = ad.w = tw.clientWidth; ad.lastHTML = msg + dashHTML(); box.innerHTML = ad.lastHTML;
    }
    animateCounts(box); dashAgo();
    const tr = $('[data-dash-trend]', box); if (tr) dashTrendHover(tr);
  }
  function dashTrendHover(tr) {
    const svg = $('svg', tr); const tip = $('.dash-tip', tr); const cross = $('.dash-cross', tr); const S = (ad.data && ad.data.series) || []; const n = S.length; if (!n) return;
    const show = (ev) => { const W = ad.w || 640; const r = svg.getBoundingClientRect(); const x = ((ev.clientX - r.left) / r.width) * W; const i = Math.max(0, Math.min(n - 1, Math.round(((x - 34) / (W - 46)) * (n - 1)))); const d = S.at(i); const cx = 34 + (i / Math.max(1, n - 1)) * (W - 46);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      tip.hidden = false; tip.innerHTML = `<b>${esc(new Date(d.day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</b><span><i style="background:var(--dash-c1)"></i>${pl(d.users, 'sign-up', 'sign-ups')}</span><span><i style="background:var(--dash-c2)"></i>${pl(d.listings, 'listing', 'listings')}</span><span><i style="background:var(--dash-c3)"></i>${pl(d.orders, 'order', 'orders')}</span>`;
      const px = (cx / W) * r.width; tip.style.left = Math.min(r.width - 150, Math.max(0, px + 12)) + 'px'; };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  }
  function dashAgo() { const el = admin.el && $('[data-dash-ago]', admin.el); if (el && ad.at) { const s = Math.round((Date.now() - ad.at) / 1000); el.textContent = s < 5 ? 'updated just now' : s < 60 ? `updated ${s}s ago` : `updated ${Math.round(s / 60)} min ago`; } if (admin.el) $$('[data-dash-time]', admin.el).forEach((t) => { t.textContent = relShort(t.dataset.dashTime) + ' ago'; }); }
  function dashSoon() { clearTimeout(ad.debounce); ad.debounce = setTimeout(async () => { ad.flash = true; await dashFetch(true); setTimeout(() => { ad.flash = false; const l = admin.el && $('.dash-live', admin.el); if (l) l.classList.remove('flash'); }, 1500); }, 1200); }
  function dashMount() {
    dashFetch();
    if (ad.unsub || ad.timer) return;
    if (LIVE && SB) {
      try { let ch = SB.channel('admin-dashboard'); ['profiles', 'listings', 'orders', 'order_events', 'vendors', 'vendor_products', 'enquiries', 'reports', 'reviews', 'buyer_profiles', 'conversations'].forEach((tb) => { ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, () => dashSoon()); }); ch.subscribe(); ad.unsub = () => SB.removeChannel(ch); } catch { ad.unsub = null; }
    } else { const f = () => dashSoon(); window.addEventListener('storage', f); window.addEventListener('raqbo-live', f); ad.unsub = () => { window.removeEventListener('storage', f); window.removeEventListener('raqbo-live', f); }; }
    ad.timer = setInterval(() => { if (!document.hidden) dashFetch(true); }, LIVE ? 60000 : 20000);
    ad.tick = setInterval(dashAgo, 5000);
  }
  // When the window changes size the measured chart width is no longer right,
  // so it is forgotten and measured again on the next paint.
  { let t = null; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { dashForget(); if (admin.el && !admin.el.hidden && admin.tab === 'overview') dashPaint(); }, 250); }); }
  function dashForget() { ad.lastHTML = ''; ad.wFixed = 0; }
  function dashStop() { if (ad.unsub) { try { ad.unsub(); } catch { /* ignore */ } } ad.unsub = null; clearInterval(ad.timer); clearInterval(ad.tick); ad.timer = null; ad.tick = null; clearTimeout(ad.debounce); }
  document.addEventListener('click', (e) => {
    if (!admin.el || admin.el.hidden) return;
    const sr = e.target.closest('[data-dash-series]'); if (sr) { const k = sr.dataset.dashSeries; ad.series[k] = !ad.series[k]; if (!Object.values(ad.series).some(Boolean)) ad.series[k] = true; dashPaint(); return; }
    if (e.target.closest('[data-dash-refresh]')) { dashFetch(true); return; }
    const ln = e.target.closest('[data-dash-link]'); if (!ln || !ln.dataset.dashLink) return;
    const [kind, id] = ln.dataset.dashLink.split(':');
    if (kind === 'tab') { admin.tab = id; renderAdmin(); }
    else if (kind === 'order') openMarket('order', { orderId: id });
    else if (kind === 'vendor') openMarket('vendor', { vendorId: id });
    else if (kind === 'listing') { const l = byId(id); if (l) { admin.tab = l.status === 'published' ? 'published' : l.status === 'rejected' ? 'rejected' : 'pending'; renderAdmin(); } }
  });

