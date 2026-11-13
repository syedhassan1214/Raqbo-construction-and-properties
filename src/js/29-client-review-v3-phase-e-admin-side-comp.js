  /* =====================================================================
     Client review v3 (Phase E, admin side): complaints & disputes centre,
     refunds register, revenue & expenses, extra dashboard KPIs, security
     (admin two-factor sign-in), analytics ID, calculator rates and
     refund rules. Supabase: update_21_admin.sql · Demo: this browser only
     ===================================================================== */
  var v3x = { c: null, r: null, f: null, k: null, mfa: null, month: null };
  const V3X_SETUP = 'Run update_21_admin.sql in Supabase first.';
  const v3xErr = (e) => new Error(/could not find the function|does not exist|schema cache/i.test((e && e.message) || '') ? V3X_SETUP : (e && e.message) || 'Something went wrong.');
  const v3xRpc = async (fn, args) => { const { data, error } = await SB.rpc(fn, args); if (error) throw v3xErr(error); return data; };
  const v3xMonth = () => v3x.month || new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 7);
  const v3xRange = (ym) => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]; };
  const V3X = SB ? {
    complaints: async () => { const { data, error } = await SB.from('complaints').select('*').order('created_at', { ascending: false }).limit(300); if (error) throw v3xErr(error); return data || []; },
    setComplaint: (id, s, note) => v3xRpc('admin_update_complaint', { p_id: id, p_status: s, p_resolution: note }),
    refunds: async () => { const { data, error } = await SB.from('refunds').select('*').order('created_at', { ascending: false }).limit(300); if (error) throw v3xErr(error); return data || []; },
    addRefund: (r) => v3xRpc('admin_add_refund', { p_kind: r.kind, p_related_ref: r.related_ref, p_payee: r.payee, p_amount: r.amount, p_method: r.method, p_reason: r.reason, p_complaint: r.complaint_id || null }),
    setRefund: (id, s, txn, reason) => v3xRpc('admin_set_refund', { p_id: id, p_status: s, p_txn: txn || '', p_reason: reason || '' }),
    report: (from, to) => v3xRpc('admin_finance_report', { p_from: from, p_to: to }),
    addEntry: (e) => v3xRpc('admin_add_finance', { p_kind: e.kind, p_category: e.category, p_amount: e.amount, p_date: e.date || null, p_note: e.note || '', p_ref: e.ref || '' }),
    delEntry: (id, reason) => v3xRpc('admin_delete_finance', { p_id: id, p_reason: reason }),
    kpis: async () => { try { return await v3xRpc('admin_kpis_v4', {}); } catch (err) { if (err.message === V3X_SETUP) return v3xRpc('admin_kpis_v3', {}); throw err; } },
    saveMisc: (rates, rules, reason) => v3xRpc('admin_save_misc', { p_cost_rates: rates, p_refund_rules: rules, p_reason: reason || '' }),
    saveGa: (id) => v3xRpc('admin_save_analytics', { p_id: id, p_reason: '' }),
    setMfa: (on) => v3xRpc('admin_set_mfa_required', { p_on: on, p_reason: '' })
  } : {
    complaints: async () => store.get('v3e.complaints', []),
    async setComplaint(id, s, note) { if (['resolved', 'rejected'].includes(s) && String(note || '').trim().length < 5) throw new Error('Write the outcome for the member (at least 5 characters).'); const all = store.get('v3e.complaints', []); const c = all.find((x) => x.id === id); if (!c) throw new Error('Complaint not found.'); Object.assign(c, { status: s, resolution: note || '', updated_at: new Date().toISOString() }); store.set('v3e.complaints', all); try { pfLocal.log('complaint.' + s, c.ref, note, null); } catch { /* ignore */ } },
    refunds: async () => store.get('v3e.refunds', []),
    async addRefund(r) { if (!(r.amount > 0)) throw new Error('Enter the refund amount.'); if (String(r.payee || '').trim().length < 2) throw new Error('Enter who is being refunded.'); if (String(r.reason || '').trim().length < 3) throw new Error('Give the reason for the refund.'); const all = store.get('v3e.refunds', []); const ref = 'RQ-RFD-' + Math.random().toString(36).slice(2, 10).toUpperCase(); all.unshift({ ...r, id: uid('r'), ref, status: 'requested', txn_id: '', created_at: new Date().toISOString() }); store.set('v3e.refunds', all); try { pfLocal.log('refund.request', ref, r.reason, { amount: r.amount }); } catch { /* ignore */ } return ref; },
    async setRefund(id, s, txn, reason) { const all = store.get('v3e.refunds', []); const f = all.find((x) => x.id === id); if (!f) throw new Error('Refund not found.'); if (['paid', 'rejected'].includes(f.status)) throw new Error('This refund is already closed.'); if (s === 'paid' && String(txn || '').trim().length < 3) throw new Error('Enter the bank transaction ID of the refund payment.'); Object.assign(f, { status: s, txn_id: s === 'paid' ? txn : f.txn_id, decided_at: f.decided_at || new Date().toISOString(), paid_at: s === 'paid' ? new Date().toISOString() : f.paid_at }); store.set('v3e.refunds', all); try { pfLocal.log('refund.' + s, f.ref, reason, { txn }); } catch { /* ignore */ } },
    async report(from, to) { const inR = (d) => d >= from && d <= to; return { entries: store.get('v3e.fin', []).filter((e) => inR(e.entry_date)), refunds_paid: store.get('v3e.refunds', []).filter((r) => r.status === 'paid' && inR(String(r.paid_at).slice(0, 10))).map((r) => ({ ref: r.ref, amount: r.amount, paid_at: r.paid_at, payee: r.payee, kind: r.kind })) }; },
    async addEntry(e) { if (!(e.amount > 0)) throw new Error('Enter the amount.'); if (String(e.category || '').trim().length < 2) throw new Error('Enter a category.'); const all = store.get('v3e.fin', []); all.unshift({ ...e, id: uid('f'), entry_date: e.date || new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10), created_at: new Date().toISOString() }); store.set('v3e.fin', all); },
    async delEntry(id, reason) { if (String(reason || '').trim().length < 3) throw new Error('Give a reason for deleting this entry.'); store.set('v3e.fin', store.get('v3e.fin', []).filter((e) => e.id !== id)); },
    async kpis() { const m0 = v3xRange(new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 7))[0]; const fin = store.get('v3e.fin', []).filter((e) => e.entry_date >= m0); const rf = store.get('v3e.refunds', []); const wa = store.get('v3e.wa', []).filter((w) => w.at > Date.now() - 7 * 864e5);
      return { complaints_open: store.get('v3e.complaints', []).filter((c) => ['open', 'investigating'].includes(c.status)).length, refunds_pending: rf.filter((r) => ['requested', 'approved'].includes(r.status)).reduce((a, r) => a + r.amount, 0), refunds_pending_n: rf.filter((r) => ['requested', 'approved'].includes(r.status)).length,
        income_month: fin.filter((e) => e.kind === 'income').reduce((a, e) => a + e.amount, 0), expense_month: fin.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0) + rf.filter((r) => r.status === 'paid' && String(r.paid_at).slice(0, 10) >= m0).reduce((a, r) => a + r.amount, 0), wa_clicks_7d: wa.length, wa_top: [],
        services_open: (db.enquiries || []).filter((e) => ['new', 'in_progress', 'awaiting_client'].includes(e.status)).length, wanted_active: '—', verified_live: db.listings.filter((l) => l.status === 'published' && vfIsVerified(l.id)).length, published: db.listings.filter((l) => !l.sample && l.status === 'published').length, visits_open: store.get('deals.visits', []).filter((v) => v.status === 'requested').length,
        completed_month: db.listings.filter((l) => ['sold', 'rented'].includes(l.availability)).length, completed_total: db.listings.filter((l) => ['sold', 'rented'].includes(l.availability)).length, agents_active: store.get('v3f.subs', []).filter((s) => s.status === 'active').length, agents_pending: store.get('v3f.subs', []).filter((s) => s.status === 'pending').length, quotes_open: (db.enquiries || []).filter((e) => e.quoteStatus === 'sent').length,
        enquiries_month: (store.get('live', { c: [] }).c || []).length, quicksell_open: Object.values(store.get('deals.urgent', {}) || {}).filter((u) => !['sold', 'closed', 'rejected'].includes(u.stage)).length, offers_month: (store.get('deals.offers', []) || []).length, auction_bidders: (store.get('auc.bidders', []) || []).filter((x) => x.status === 'approved').length, auction_bids_month: (store.get('auc.bids', []) || []).length, registrations_today: Object.values(store.get('accounts', {})).filter((a) => (a.since || 0) > Date.now() - 864e5).length }; },
    async saveMisc(rates, rules) { store.set('v3e.rates', rates); store.set('v3e.refund', rules); },
    async saveGa(id) { store.set('v3e.ga', id); },
    async setMfa() { throw new Error('Two-factor sign-in works with the live Supabase site (not in this demo).'); }
  };
  const v3xRepaint = () => { if (admin.el && !admin.el.hidden && ['complaints', 'refunds', 'finance', 'security'].includes(admin.tab)) { const b = $('.ax-body', admin.el); if (b) b.innerHTML = V3_ADMIN[admin.tab](); } };
  async function v3xLoad(k) { try { v3x[k] = k === 'c' ? await V3X.complaints() : k === 'r' ? await V3X.refunds() : k === 'f' ? await V3X.report(...v3xRange(v3xMonth())) : null; } catch (err) { v3x[k] = { error: err.message }; } v3xRepaint(); }
  const v3xSt = (s) => `<span class="gw-st ${['resolved', 'paid', 'approved'].includes(s) ? 'gw-st-approved' : ['rejected'].includes(s) ? 'gw-st-rejected' : 'gw-st-pending'}">${esc(s)}</span>`;
  const V3X_REF_KINDS = { verification: 'Verification fee', service: 'Service fee', order: 'Material order', auction_deposit: 'Auction deposit', quicksell: 'QuickSell', featured: 'Featured listing', other: 'Other' };

  V3_ADMIN.complaints = () => {
    const d = v3x.c; if (!d) { v3xLoad('c'); return '<div class="admin-empty">Loading…</div>'; } if (d.error) return `<div class="admin-empty">${esc(d.error)}</div>`;
    const open = d.filter((c) => ['open', 'investigating'].includes(c.status)); const done = d.filter((c) => !['open', 'investigating'].includes(c.status)).slice(0, 60);
    const card = (c) => `<div class="vfa-req" data-cid="${esc(c.id)}"><div class="vfa-top"><div><b>${esc(V3E_KINDS[c.kind] || c.kind)}${c.subject_ref ? ' · ' + esc(c.subject_ref) : ''}</b><small>${esc(c.ref)} · ${esc(c.name || '')} · ${esc(fmtDay(c.created_at))}${c.refund_requested ? ' · refund asked ' + esc(rs(c.refund_requested)) : ''}</small></div>${v3xSt(c.status)}</div><p class="vfa-note">${esc(c.details)}</p>
      <div class="vfa-act"><input class="gwa-note" data-cnote placeholder="Outcome / note to the member" maxlength="2000" value="${esc(c.resolution || '')}"><button type="button" class="button button-outline" data-v3x="c-investigating">Investigating</button><button type="button" class="button button-primary" data-v3x="c-resolved">Resolved</button><button type="button" class="button button-outline" data-v3x="c-rejected">Close</button>${c.refund_requested ? `<button type="button" class="button button-outline" data-v3x="c-refund" data-amt="${esc(c.refund_requested)}" data-ref="${esc(c.ref)}" data-name="${esc(c.name || '')}">Create refund</button>` : ''}</div></div>`;
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> TRUST &amp; SAFETY</div><h2>Complaints &amp; disputes</h2><p class="admin-sub">Every complaint gets a reference number. Write the outcome before resolving or closing — the member sees it. Material-order disputes stay under Construction Materials → Disputes.</p></div><button type="button" class="admin-refresh" data-v3x="reload-c">Refresh</button></div>
      <section class="gwa-sec"><h3>Open <span class="admin-count">${open.length}</span></h3>${open.map(card).join('') || '<div class="admin-empty sm">No open complaints.</div>'}</section>
      <section class="gwa-sec"><h3>Closed</h3>${done.length ? `<table class="gw-table"><thead><tr><th>Complaint</th><th>Member</th><th>Outcome</th><th>Date</th></tr></thead><tbody>${done.map((c) => `<tr><td>${esc(c.ref)}<br><small>${esc(V3E_KINDS[c.kind] || c.kind)}</small></td><td>${esc(c.name || '')}</td><td>${v3xSt(c.status)}<br><small>${esc(c.resolution || '')}</small></td><td>${esc(fmtDay(c.updated_at || c.created_at))}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">Nothing yet.</div>'}</section></div>`;
  };
  V3_ADMIN.refunds = () => {
    const d = v3x.r; if (!d) { v3xLoad('r'); return '<div class="admin-empty">Loading…</div>'; } if (d.error) return `<div class="admin-empty">${esc(d.error)}</div>`;
    const open = d.filter((r) => ['requested', 'approved'].includes(r.status)); const pre = v3x.refundPrefill || {};
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> FINANCE</div><h2>Refunds register</h2><p class="admin-sub">Record every refund with its reason, approve it, then mark it paid with the bank transaction ID. Paid refunds count as expenses in Revenue &amp; expenses. A refund you created should be approved by another finance admin.</p></div><button type="button" class="admin-refresh" data-v3x="reload-r">Refresh</button></div>
      <section class="gwa-sec"><h3>New refund</h3><form class="v3x-form" data-v3x-form="refund"><select name="kind">${Object.entries(V3X_REF_KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><input name="related_ref" maxlength="80" placeholder="Related reference" value="${esc(pre.ref || '')}"><input name="payee" maxlength="120" placeholder="Refund to (name)" value="${esc(pre.name || '')}"><input name="amount" type="number" min="1" placeholder="Amount (PKR)" value="${esc(pre.amount || '')}"><input name="method" maxlength="40" placeholder="Method (bank, JazzCash…)"><input name="reason" maxlength="600" placeholder="Reason" class="wide"><input type="hidden" name="complaint_id" value="${esc(pre.cid || '')}"><button class="button button-primary" type="submit">Add refund</button></form></section>
      <section class="gwa-sec"><h3>Open <span class="admin-count">${open.length}</span> · ${esc(rs(open.reduce((a, r) => a + Number(r.amount), 0)))}</h3>${open.map((r) => `<div class="vfa-req" data-rid="${esc(r.id)}"><div class="vfa-top"><div><b>${esc(rs(r.amount))} to ${esc(r.payee)}</b><small>${esc(r.ref)} · ${esc(V3X_REF_KINDS[r.kind] || r.kind)}${r.related_ref ? ' · ' + esc(r.related_ref) : ''} · ${esc(r.method || '')} · ${esc(fmtDay(r.created_at))}</small><small>${esc(r.reason)}</small></div>${v3xSt(r.status)}</div>
        <div class="vfa-act">${r.status === 'requested' ? '<button type="button" class="button button-outline" data-v3x="r-approved">Approve</button>' : ''}<input class="gwa-note" data-rtxn placeholder="Bank transaction ID (to mark paid)" maxlength="80"><button type="button" class="button button-primary" data-v3x="r-paid">Mark paid</button><button type="button" class="button button-outline" data-v3x="r-rejected">Reject</button></div></div>`).join('') || '<div class="admin-empty sm">No open refunds.</div>'}</section>
      <section class="gwa-sec"><h3>History</h3>${d.filter((r) => !open.includes(r)).length ? `<table class="gw-table"><thead><tr><th>Refund</th><th>Amount</th><th>Status</th><th>Txn</th><th>Date</th></tr></thead><tbody>${d.filter((r) => !open.includes(r)).slice(0, 80).map((r) => `<tr><td>${esc(r.ref)}<br><small>${esc(r.payee)}</small></td><td>${esc(rs(r.amount))}</td><td>${v3xSt(r.status)}</td><td>${esc(r.txn_id || '—')}</td><td>${esc(fmtDay(r.paid_at || r.decided_at || r.created_at))}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">Nothing yet.</div>'}</section></div>`;
  };
  V3_ADMIN.finance = () => {
    const d = v3x.f; if (!d) { v3xLoad('f'); return '<div class="admin-empty">Loading…</div>'; } if (d.error) return `<div class="admin-empty">${esc(d.error)}</div>`;
    const inc = d.entries.filter((e) => e.kind === 'income'); const exp = d.entries.filter((e) => e.kind === 'expense'); const ref = d.refunds_paid || [];
    const sum = (a) => a.reduce((x, e) => x + Number(e.amount), 0); const ti = sum(inc); const te = sum(exp) + sum(ref);
    const byCat = (a) => { const o = {}; a.forEach((e) => { o[e.category] = (o[e.category] || 0) + Number(e.amount); }); return Object.entries(o).sort((x, y) => y[1] - x[1]); };
    const expCats = byCat(exp); if (ref.length) expCats.push(['Refunds paid', sum(ref)]); const max = Math.max(1, ...byCat(inc).map((x) => x[1]), ...expCats.map((x) => x[1]));
    const bars = (rows) => rows.map(([k, n]) => `<div class="dash-bar"><span class="dash-bar-label">${esc(k)}</span><span class="dash-bar-track"><i style="width:${Math.max(3, (n / max) * 100)}%"></i></span><b>${esc(rs(n))}</b></div>`).join('') || '<p class="gw-mini">Nothing recorded.</p>';
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> FINANCE</div><h2>Revenue &amp; expenses</h2><p class="admin-sub">Record income and expenses as they reach the bank. Paid refunds are added automatically. Export the month as CSV for your accountant.</p></div><div class="v3x-month"><input type="month" data-v3x-month value="${esc(v3xMonth())}" aria-label="Month"><button type="button" class="admin-refresh" data-v3x="csv">Export CSV</button></div></div>
      <div class="my-tiles"><div class="my-tile"><small>Income</small><b>${esc(rs(ti))}</b><span>${inc.length} entries</span></div><div class="my-tile"><small>Expenses</small><b>${esc(rs(te))}</b><span>incl. ${esc(rs(sum(ref)))} refunds</span></div><div class="my-tile"><small>Net</small><b class="${ti - te < 0 ? 'neg' : ''}">${esc(rs(ti - te))}</b><span>${esc(v3xMonth())}</span></div></div>
      <section class="gwa-sec"><h3>Add an entry</h3><form class="v3x-form" data-v3x-form="entry"><select name="kind"><option value="income">Income</option><option value="expense">Expense</option></select><input name="category" maxlength="60" placeholder="Category (e.g. Verification fees, Salaries)" list="v3x-cats"><datalist id="v3x-cats">${['Verification fees', 'QuickSell commission', 'Auction commission', 'Buyer premium', 'Service fees', 'Featured listings', 'Marketplace commission', 'Salaries', 'Marketing', 'Office & utilities', 'Software & hosting', 'Legal & professional', 'Transport'].map((c) => `<option>${c}</option>`).join('')}</datalist><input name="amount" type="number" min="1" placeholder="Amount (PKR)"><input name="date" type="date"><input name="ref" maxlength="80" placeholder="Reference / bank txn"><input name="note" maxlength="300" placeholder="Note" class="wide"><button class="button button-primary" type="submit">Add</button></form></section>
      <div class="v3x-cols"><section class="gwa-sec"><h3>Income by category</h3>${bars(byCat(inc))}</section><section class="gwa-sec"><h3>Expenses by category</h3>${bars(expCats)}</section></div>
      <section class="gwa-sec"><h3>Entries</h3>${d.entries.length ? `<table class="gw-table"><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>Note</th><th></th></tr></thead><tbody>${d.entries.map((e) => `<tr><td>${esc(e.entry_date)}</td><td>${esc(e.kind)}</td><td>${esc(e.category)}</td><td>${esc(rs(e.amount))}</td><td>${esc(e.note || '')}${e.ref ? `<br><small>${esc(e.ref)}</small>` : ''}</td><td><button type="button" class="link-button" data-v3x="f-del" data-id="${esc(e.id)}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">No entries this month.</div>'}</section></div>`;
  };
  V3_ADMIN.security = () => {
    const p = pf.pub || {}; const R = v3eRates(); const m = v3x.mfa;
    if (SB && !m) { v3xMfaLoad(); }
    const mfaHTML = !SB ? '<p class="gw-mini">Two-factor sign-in uses Supabase Auth (an authenticator app such as Google Authenticator or Microsoft Authenticator). It works on the live site — not in this demo.</p>'
      : !m ? '<p class="gw-mini">Checking…</p>' : m.error ? `<p class="gw-mini">${esc(m.error)}</p>`
      : `<p>${m.factors.length ? `${DI(DIC.check, 14)} An authenticator app is set up on your account (${esc(m.level === 'aal2' ? 'you signed in with it' : 'not used in this sign-in')}).` : 'No authenticator app on your account yet.'}</p>
        ${m.enroll ? `<div class="v3x-qr"><img src="${esc(m.enroll.qr)}" width="180" height="180" alt="QR code for your authenticator app"><div><p>Scan with your authenticator app, or type this key: <code>${esc(m.enroll.secret)}</code></p><form data-v3x-form="mfa-verify"><input name="code" inputmode="numeric" maxlength="6" placeholder="6-digit code"><button class="button button-primary" type="submit">Confirm</button></form></div></div>`
          : m.factors.length ? (m.level !== 'aal2' ? '<form data-v3x-form="mfa-verify"><input name="code" inputmode="numeric" maxlength="6" placeholder="6-digit code"><button class="button button-primary" type="submit">Verify this sign-in</button></form>' : '') : '<button type="button" class="button button-primary" data-v3x="mfa-enroll">Set up an authenticator app</button>'}
        <label class="v3x-toggle"><input type="checkbox" data-v3x="mfa-required" ${p.admin_mfa_required ? 'checked' : ''} ${m.level === 'aal2' ? '' : 'disabled'}> Require two-factor sign-in for every admin</label><p class="gw-mini">Turn this on only after every admin has set up an authenticator app. You must have signed in with your own code first, so you cannot lock yourself out.</p>`;
    return `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> SETTINGS</div><h2>Security, analytics &amp; tools</h2></div></div>
      <section class="gwa-sec"><h3>${DI(DIC.lock, 18)} Admin two-factor sign-in</h3>${mfaHTML}</section>
      <section class="gwa-sec"><h3>${DI(DIC.trend, 18)} Website analytics (optional)</h3><p class="gw-mini">Paste a Google Analytics 4 measurement ID (G-…) to measure visits. Leave empty to switch analytics off. WhatsApp clicks are always counted anonymously on the dashboard.</p><form class="v3x-form" data-v3x-form="ga"><input name="ga" maxlength="20" placeholder="G-XXXXXXXXXX" value="${esc(SB ? p.analytics_id || '' : store.get('v3e.ga', ''))}"><button class="button button-outline" type="submit">Save</button></form></section>
      <section class="gwa-sec"><h3>${DI(DIC.home, 18)} Construction cost calculator rates (PKR per sq ft)</h3><form class="v3x-form" data-v3x-form="rates">${['grey', 'economy', 'standard', 'premium'].map((k) => `<label>${esc(k)}<input name="${k}" type="number" min="100" value="${esc(R[k])}"></label>`).join('')}<label class="wide">Refund rules shown on the Fees page (one per line — empty uses the standard rules)<textarea name="rules" rows="5">${esc(v3eRefundRules())}</textarea></label><button class="button button-outline" type="submit">Save rates &amp; rules</button></form></section></div>`;
  };
  let v3xMfaInFlight = null;
  async function v3xMfaLoad() {
    // Only ever one check at a time. Starting a second one while the first is
    // still running left the panel stuck on "Checking your sign-in…".
    if (v3xMfaInFlight) return v3xMfaInFlight;
    v3x.mfa = { loading: true, factors: [] };
    v3xMfaInFlight = (async () => {
      try {
        // If the check cannot finish, say so instead of waiting for ever.
        const timeout = new Promise((_, no) => setTimeout(() => no(new Error('The sign-in check timed out.')), 12000));
        const [{ data: f }, { data: a }] = await Promise.race([
          Promise.all([SB.auth.mfa.listFactors(), SB.auth.mfa.getAuthenticatorAssuranceLevel()]),
          timeout
        ]);
        v3x.mfa = { factors: ((f && f.totp) || []).filter((x) => x.status === 'verified'), level: a && a.currentLevel };
      } catch (err) { v3x.mfa = { error: err.message || 'The sign-in check failed.', factors: [] }; }
      v3xMfaInFlight = null;
      v3xRepaint();
    })();
    return v3xMfaInFlight;
  }
  // Gate: when two-factor is required, an admin signed in without it is asked for a code first
  function v3xGate() {
    if (!SB || !((pf.pub && pf.pub.admin_mfa_required) || v3x.needCode)) return '';
    if (!v3x.mfa) { v3xMfaLoad(); return '<div class="admin-empty">Checking your sign-in…</div>'; }
    if (v3x.mfa.error) return `<div class="gwa v3x-gate"><h2>${DI(DIC.lock, 22)} Could not check your sign-in</h2><p>${esc(v3x.mfa.error)}</p><button type="button" class="button button-primary" data-v3x="mfa-retry">Try again</button> <button type="button" class="button button-text" data-v3x="mfa-signout">Sign out and sign in again</button></div>`;
    if (v3x.mfa.level === 'aal2' || v3x.mfa.loading) return v3x.mfa.loading ? '<div class="admin-empty">Checking your sign-in…</div>' : '';
    return `<div class="gwa v3x-gate"><h2>${DI(DIC.lock, 22)} Two-factor sign-in required</h2><p>RAQBO requires a code from your authenticator app before you use the admin panel.</p>${v3x.mfa.factors.length ? '<form data-v3x-form="mfa-verify"><input name="code" inputmode="numeric" maxlength="6" placeholder="6-digit code" autofocus><button class="button button-primary" type="submit">Continue</button></form>' : '<p>No authenticator app is set up on your account. Ask a full admin to switch the requirement off, set up your app, then sign in again.</p>'}</div>`;
  }
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-v3x-form]'); if (!f) return; e.preventDefault(); const k = f.dataset.v3xForm; const btn = $('button[type=submit]', f); const done = busy(btn, '…');
    try {
      if (k === 'refund') { const ref = await V3X.addRefund({ kind: f.kind.value, related_ref: f.related_ref.value.trim(), payee: f.payee.value.trim(), amount: Math.round(+f.amount.value || 0), method: f.method.value.trim(), reason: f.reason.value.trim(), complaint_id: f.complaint_id.value || null }); toast('Refund ' + ref + ' recorded.'); v3x.refundPrefill = null; v3x.r = null; v3x.k = null; v3xLoad('r'); return; }
      if (k === 'entry') { await V3X.addEntry({ kind: f.kind.value, category: f.category.value.trim(), amount: Math.round(+f.amount.value || 0), date: f.date.value || null, note: f.note.value.trim(), ref: f.ref.value.trim() }); toast('Saved.'); v3x.f = null; v3x.k = null; v3xLoad('f'); return; }
      if (k === 'ga') { const id = f.ga.value.trim().toUpperCase(); if (id && !/^G-[A-Z0-9]{4,14}$/.test(id)) throw new Error('That does not look like a GA4 ID (G-XXXXXXXXXX).'); await V3X.saveGa(id); if (SB) await pfLoad(); done(); toast(id ? 'Analytics ID saved.' : 'Analytics switched off.'); return; }
      if (k === 'rates') { const rates = {}; ['grey', 'economy', 'standard', 'premium'].forEach((n) => { rates[n] = Math.max(100, Math.round(+f[n].value || V3E_RATES[n])); }); await V3X.saveMisc(rates, f.rules.value.trim()); if (SB) await pfLoad(); done(); toast('Rates and refund rules saved.'); return; }
      if (k === 'mfa-verify') {
        const code = f.code.value.replace(/\D/g, ''); if (code.length !== 6) throw new Error('Enter the 6-digit code from your app.');
        const factorId = (v3x.mfa.enroll && v3x.mfa.enroll.id) || (v3x.mfa.factors[0] && v3x.mfa.factors[0].id); const { error } = await SB.auth.mfa.challengeAndVerify({ factorId, code }); if (error) throw new Error(error.message || 'That code did not work.');
        toast('Verified.'); v3x.mfa = null; v3x.needCode = false; await v3xMfaLoad(); v3xAfterVerify(); return;
      }
    } catch (err) { done(); toast(err.message); }
  });
  document.addEventListener('change', async (e) => {
    const m = e.target.closest('[data-v3x-month]'); if (m) { v3x.month = m.value; v3x.f = null; v3xLoad('f'); return; }
    const t = e.target.closest('[data-v3x="mfa-required"]'); if (t) { try { await V3X.setMfa(t.checked); await pfLoad(); toast(t.checked ? 'Two-factor sign-in is now required for admins.' : 'Two-factor sign-in is optional again.'); } catch (err) { t.checked = !t.checked; toast(err.message); } }
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v3x]'); if (!b || b.tagName === 'INPUT') return; const a = b.dataset.v3x;
    if (a === 'reload-c') { v3x.c = null; v3xLoad('c'); }
    else if (a === 'reload-r') { v3x.r = null; v3xLoad('r'); }
    else if (a.startsWith('c-') && a !== 'c-refund') { const row = b.closest('[data-cid]'); const done = busy(b, '…'); try { await V3X.setComplaint(row.dataset.cid, a.slice(2), $('[data-cnote]', row).value.trim()); toast('Saved — the member has been notified.'); v3x.c = null; v3x.k = null; v3xLoad('c'); } catch (err) { done(); toast(err.message); } }
    else if (a === 'c-refund') { v3x.refundPrefill = { amount: b.dataset.amt, ref: b.dataset.ref, name: b.dataset.name, cid: b.closest('[data-cid]').dataset.cid }; admin.tab = 'refunds'; renderAdmin(); }
    else if (a.startsWith('r-')) { const row = b.closest('[data-rid]'); const st = a.slice(2); const reason = st === 'rejected' ? (prompt('Reason for rejecting this refund (kept in the audit log):') || '') : ''; if (st === 'rejected' && reason.length < 3) return; const done = busy(b, '…'); try { await V3X.setRefund(row.dataset.rid, st, ($('[data-rtxn]', row) || {}).value || '', reason); toast('Saved.'); v3x.r = null; v3x.k = null; v3xLoad('r'); } catch (err) { done(); if (/another finance admin/i.test(err.message)) { const why = prompt(err.message + '\n\nReason to continue:'); if (why) { try { await V3X.setRefund(row.dataset.rid, st, ($('[data-rtxn]', row) || {}).value || '', why); toast('Saved.'); v3x.r = null; v3xLoad('r'); } catch (e2) { toast(e2.message); } } } else toast(err.message); } }
    else if (a === 'f-del') { const why = prompt('Reason for deleting this entry (kept in the audit log):'); if (!why) return; try { await V3X.delEntry(b.dataset.id, why); v3x.f = null; v3xLoad('f'); } catch (err) { toast(err.message); } }
    else if (a === 'csv') { const d = v3x.f; if (!d || d.error) return; const rows = [['date', 'type', 'category', 'amount', 'reference', 'note'], ...d.entries.map((x) => [x.entry_date, x.kind, x.category, x.amount, x.ref || '', x.note || '']), ...(d.refunds_paid || []).map((r) => [String(r.paid_at).slice(0, 10), 'expense', 'Refunds paid', r.amount, r.ref, r.payee])];
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const l = document.createElement('a'); l.href = url; l.download = `raqbo-finance-${v3xMonth()}.csv`; document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
    else if (a === 'mfa-enroll') { const done = busy(b, '…'); try { const { data, error } = await SB.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'RAQBO admin ' + new Date().toISOString().slice(0, 10) }); if (error) throw new Error(error.message); v3x.mfa = { ...(v3x.mfa || {}), enroll: { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret } }; v3xRepaint(); } catch (err) { done(); toast(err.message); } }
  });

  // ---------- Dashboard: extra business KPIs ----------
  function v3xKpiHTML() {
    const k = v3x.k; if (!k) { V3X.kpis().then((d) => { v3x.k = d; v3x.kAt = Date.now(); if (admin.tab === 'overview') renderAdmin(); }).catch((err) => { v3x.k = { error: err.message }; }); return ''; }
    if (k.error) return ''; if (Date.now() - (v3x.kAt || 0) > 60000) { v3x.kAt = Date.now(); V3X.kpis().then((d) => { v3x.k = d; }).catch(() => {}); }
    const t = (label, val, sub, tab) => `<button type="button" class="v3x-kpi" ${tab ? `data-tab="${tab}"` : ''}><small>${esc(label)}</small><b>${esc(val)}</b><span>${esc(sub)}</span></button>`;
    return `<section class="v3x-kpis"><h3>Business control</h3><div class="v3x-kgrid">${t('Open complaints', k.complaints_open, 'waiting for an outcome', 'complaints')}${t('Refunds pending', rs(k.refunds_pending || 0), `${k.refunds_pending_n || 0} to approve or pay`, 'refunds')}${t('Income this month', rs(k.income_month || 0), 'recorded', 'finance')}${t('Expenses this month', rs(k.expense_month || 0), 'incl. refunds paid', 'finance')}${t('WhatsApp clicks', k.wa_clicks_7d, 'last 7 days')}${t('Service requests', k.services_open, 'open', 'enquiries')}${t('Verified & live', k.verified_live, `of ${k.published} live listings`, 'verify')}${t('Site visits', k.visits_open, 'waiting to confirm', 'visits')}</div>
      ${(k.wa_top || []).length ? `<p class="gw-mini">Most WhatsApp clicks (30 days): ${k.wa_top.map((x) => `${esc(x.title)} (${esc(x.n)})`).join(' · ')}</p>` : ''}</section>`;
  }
  { const base = dashHTML; dashHTML = function () { return base() + v3xKpiHTML(); }; }
  Object.assign(AX_ICON, { complaints: 'alert', refunds: 'bank', finance: 'trend', security: 'lock', svcfees: 'doc', projects: 'home', visits: 'clock', duplicates: 'grid' });
  Object.assign(AX_HINT, { complaints: 'Member complaints and written outcomes', refunds: 'Every refund with reason, approval and bank txn', finance: 'Income, expenses and monthly CSV', security: 'Two-factor sign-in, analytics, calculator rates', svcfees: 'Fee text and which services are shown', projects: 'Progress updates and payment plans', visits: 'Site visit requests to confirm', duplicates: 'Listings that look like the same property' });

  // Two-factor state must follow the current sign-in, not an earlier one in the same tab
  function v3xAfterVerify() { try { if (typeof ad === 'object' && ad) { ad.err = ''; ad.data = null; ad.at = 0; } } catch { /* ignore */ } v3x.k = null; v3x.c = null; v3x.r = null; v3x.f = null; if (typeof adminReload === 'function' && db.isAdmin) adminReload(); else renderAdmin(); }
  function v3xNeedCode() {
    if (v3x.needCode) return;                       // already asking — never re-render on top of the gate
    v3x.needCode = true; v3x.mfa = null;
    if (admin.el && !admin.el.hidden) renderAdmin();
  }
  // Only these events actually change which authenticators exist or how far
  // this sign-in has been verified. SIGNED_IN and TOKEN_REFRESHED fire on
  // every page load and every hour, and clearing the check on those made the
  // panel re-check itself without end — which is what made it blink and then
  // sit on "Checking your sign-in…".
  if (SB) {
    try {
      SB.auth.onAuthStateChange((ev) => {
        if (ev === 'SIGNED_OUT') { v3x.mfa = null; v3x.needCode = false; return; }
        if (ev === 'MFA_CHALLENGE_VERIFIED' || ev === 'USER_UPDATED') { v3x.mfa = null; v3xMfaLoad(); }
      });
    } catch { /* ignore */ }
  }
  // If the database refuses an admin because this sign-in has no two-factor code yet, ask for the code instead of showing an error
  {
    const base = dashFetch;
    dashFetch = async function (quiet) {
      // Only hold the dashboard back while a gate is genuinely on screen.
      // Holding it back on the flag alone would leave an admin who is not
      // asked for a code staring at an empty panel.
      if (v3xGate()) return;
      await base(quiet);
      if (SB && ad.err && /admins only|only (a )?full admin|permission/i.test(ad.err) && db.isAdmin) {
        try {
          const { data } = await SB.auth.mfa.getAuthenticatorAssuranceLevel();
          if (data && data.currentLevel !== 'aal2' && data.nextLevel === 'aal2') { ad.err = ''; v3xNeedCode(); }
        } catch { /* ignore */ }
      }
    };
  }

  // ---------------------------------------------------------------
  // The admin panel asks for the authenticator code every time it is opened
  //
  // Signing in with two-factor keeps the browser trusted until the admin
  // signs out, which can be weeks. That is too long for a panel that can
  // change prices, approve payments and read customer records, so the code
  // is asked for each time the panel is opened. Moving between tabs inside
  // the panel does not ask again; closing it and opening it again does.
  // The website itself is unaffected.
  // ---------------------------------------------------------------
  v3x.locked = true;                 // locked until a code is entered this time

  {
    const baseGate = v3xGate;
    v3xGate = function () {
      const out = baseGate();
      if (out) return out;                                   // already asking, or two-factor is off
      if (!SB || !(pf.pub && pf.pub.admin_mfa_required)) return '';
      if (!v3x.mfa || v3x.mfa.loading || v3x.mfa.level !== 'aal2') return '';
      if (!v3x.mfa.factors || !v3x.mfa.factors.length) return '';
      if (!v3x.locked) return '';
      return `<div class="gwa v3x-gate"><h2>${DI(DIC.lock, 22)} Enter your code</h2><p>The admin panel asks for the six-digit code from your authenticator app each time it is opened, even though you are already signed in. Moving between sections will not ask again.</p><form data-v3x-form="mfa-verify"><input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code" autofocus><button class="button button-primary" type="submit">Open the admin panel</button></form></div>`;
    };
  }

  // A code that is accepted unlocks the panel for as long as it stays open
  { const base = v3xAfterVerify; v3xAfterVerify = function () { v3x.locked = false; return base(); }; }

  // Closing the panel locks it again, so the next time it is opened the code
  // is asked for. Signing out does the same.
  { const base = closeAdmin; closeAdmin = function () { v3x.locked = true; v3x.needCode = false; return base.apply(this, arguments); }; }
  if (SB) { try { SB.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { v3x.locked = true; v3x.needCode = false; } }); } catch { /* ignore */ } }

  // Signing out clears it, so the next admin on this computer must enter a code

  // ---------------------------------------------------------------
  // Handing the authenticator over to someone else
  //
  // The authenticator app lives on one phone. When RAQBO's owner takes
  // over the admin panel, the code must move to their phone. This does it
  // safely: the new phone is set up and confirmed FIRST, and only then is
  // the old one removed, so there is never a moment with no way in.
  //
  // Each admin account has its own authenticator. The cleanest handover is
  // for the owner to sign in to their own admin account and set up their
  // own app — this screen says so. This button is for the case where the
  // same account has to move to a different phone.
  // ---------------------------------------------------------------
  // Ways out of a failed sign-in check, so the panel can never trap anyone
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v3x="mfa-retry"], [data-v3x="mfa-signout"]'); if (!b || !SB) return;
    if (b.dataset.v3x === 'mfa-retry') { v3x.mfa = null; v3xRepaint(); v3xMfaLoad(); return; }
    try { await SB.auth.signOut(); } catch { /* ignore */ }
    location.reload();
  });

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v3x="mfa-replace"], [data-v3x="mfa-cancel-replace"]'); if (!b || !SB) return;
    if (b.dataset.v3x === 'mfa-cancel-replace') {
      const keep = (v3x.mfa && v3x.mfa.enroll && v3x.mfa.enroll.id) || null;
      v3x.replaceNew = null; if (v3x.mfa) v3x.mfa.enroll = null;
      if (keep) { try { await SB.auth.mfa.unenroll({ factorId: keep }); } catch { /* it was never confirmed */ } }
      v3xRepaint(); return;
    }
    const done = busy(b, '…');
    try {
      const { data, error } = await SB.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'RAQBO admin (new phone) ' + new Date().toISOString().slice(0, 10) });
      if (error) throw new Error(error.message);
      v3x.replaceNew = data.id;
      v3x.mfa = { ...(v3x.mfa || {}), enroll: { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
      v3xRepaint();
    } catch (err) { done(); toast(err.message); }
  });

  // Once the new phone's code is accepted, remove the old authenticator
  {
    const base = v3xAfterVerify;
    v3xAfterVerify = function () {
      const fresh = v3x.replaceNew;
      if (fresh) {
        v3x.replaceNew = null;
        (async () => {
          try {
            const { data } = await SB.auth.mfa.listFactors();
            const all = (data && data.totp) || [];
            for (const f of all) { if (f.id !== fresh) { try { await SB.auth.mfa.unenroll({ factorId: f.id }); } catch { /* already gone */ } } }
            v3x.mfa = null; await v3xMfaLoad(); v3xRepaint();
            toast('The new phone is now the authenticator for this account. The old one no longer works.');
          } catch { toast('The new phone works, but the old authenticator could not be removed. Try again from Settings.'); }
        })();
      }
      return base();
    };
  }

  // Put the button, and the explanation, on the Settings screen
  {
    const base = V3_ADMIN.security;
    V3_ADMIN.security = function () {
      let html = base();
      const m = v3x.mfa;
      if (!SB || !m || m.error || m.loading) return html;
      const busyEnroll = !!(m.enroll && v3x.replaceNew);
      const extra = busyEnroll
        ? `<p class="gw-mini">Scan the code above with the <strong>new</strong> phone, then enter its 6-digit code. The old phone keeps working until you do, so you cannot be locked out. <button type="button" class="button button-text" data-v3x="mfa-cancel-replace">Cancel</button></p>`
        : (m.factors.length && m.level === 'aal2' && !m.enroll
          ? `<p class="gw-mini" style="margin-top:10px"><strong>Handing the admin panel to RAQBO's owner?</strong> The best way is for the owner to sign in with their own admin account and set up their own authenticator app here — then each person has their own code and nobody shares one. If instead this same account has to move to a different phone, use the button below. The new phone is confirmed before the old one is switched off.</p>
             <button type="button" class="button button-outline" data-v3x="mfa-replace">Move the authenticator to a different phone</button>`
          : '');
      if (extra) html = html.replace('<label class="v3x-toggle">', extra + '<label class="v3x-toggle">');
      return html;
    };
  }
  // The RAQBO mark, carried in the page itself so any document the site
  // produces — a backup report, a partner card — always has the logo on it,
  // with no file to fetch and nothing to go missing.
  const RAQBO_MARK = { w: 130, h: 112, url: 'data:image/png;base64,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' };

