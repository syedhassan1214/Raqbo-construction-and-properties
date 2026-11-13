  /* =====================================================================
     Grow RAQBO: Founding Members Club, Refer & Earn, My RAQBO Rewards,
     offers, property alerts, Property Wanted, featured trial, guides
     Supabase: update_11_growth.sql · Demo mode: stored in this browser
     ===================================================================== */
  var gw = { pub: null, me: null, uid: null, featured: new Set(), badges: {}, admin: null, unsub: null, timer: null, pageOpen: '' };
  const GI = {
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    medal: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 8 5-3 5 3-1.5-8"/><path d="m12 6 1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 8.3l2-.3z"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5a2.5 2.5 0 0 0 0 5H20"/><path d="M8 7h8"/><path d="M8 11h6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    spark: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m6 6 2.5 2.5"/><path d="m15.5 15.5 2.5 2.5"/><path d="m6 18 2.5-2.5"/><path d="m15.5 8.5 2.5-2.5"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'
  };
  const MEMBER_TYPES = [['owner', 'Property owner'], ['buyer', 'Buyer'], ['tenant', 'Tenant'], ['developer', 'Developer / builder'], ['agent', 'Agent / dealer'], ['legal', 'Legal professional'], ['service', 'Service provider'], ['overseas', 'Overseas Pakistani']];
  const typeName = (t) => (MEMBER_TYPES.find(([k]) => k === t) || [, ''])[1];
  const rs = (n) => 'Rs ' + (Number(n) || 0).toLocaleString('en-US');
  const GW_DEFAULTS = { campaign_on: true, title: 'RAQBO – Pakistan\'s Property World in Your Pocket', tagline: 'Join Free. Connect Directly. Discover More.', cta: 'Become a RAQBO Founding Member and Enjoy Exclusive Benefits.', founding_enabled: true, founding_cap: 10000, founding_discount_pct: 20, founding_discount_max: 500, referral_enabled: true, referral_member_credit: 100, referral_owner_credit: 300, referral_review: true, referral_monthly_cap: 20, credit_expiry_days: 180, featured_trial_enabled: true, featured_trial_days: 7, pilot_cities: ['Lahore'], budget_total: 500000, verification_enabled: true, verification_fee: 2000 };
  const gwSetupMsg = 'Rewards are being set up. (Admin: run update_11_growth.sql in Supabase.)';

  // ---------- Supabase ----------
  const gwSupabase = (sb) => {
    const q = async (p, msg) => { const { data, error } = await p; if (error) throw new Error(/does not exist|schema cache|relation|could not find the function/i.test(error.message || '') ? gwSetupMsg : (error.message || msg)); return data; };
    return {
      pub: () => q(sb.rpc('growth_public'), 'Could not load.'),
      my: () => q(sb.rpc('my_growth'), 'Could not load your rewards.'),
      claim: (code) => q(sb.rpc('claim_referral', { p_code: code }), 'Could not apply the invite.'),
      details: (type, city) => q(sb.rpc('set_member_details', { p_type: type || '', p_city: city || '' }), 'Could not save.'),
      redeem: (kind, amount, note) => q(sb.rpc('request_redemption', { p_kind: kind, p_amount: amount || 0, p_note: note }), 'Could not send the request.'),
      trial: (id) => q(sb.rpc('start_featured_trial', { p_listing: id }), 'Could not start the trial.'),
      badges: async (ids) => { const r = await q(sb.rpc('member_badges', { p_ids: ids }), ''); return r || []; },
      offers: () => q(sb.from('offers').select('*').order('sort').order('created_at', { ascending: false }), 'Could not load offers.'),
      addAlert: (a) => q(sb.from('saved_searches').insert(a), 'Could not save the alert.'),
      delAlert: (id) => q(sb.from('saved_searches').delete().eq('id', id), 'Could not remove the alert.'),
      wanted: () => { const me = db.session && db.session.userId; let r = sb.from('wanted_posts').select('*').order('created_at', { ascending: false }).limit(120); r = me ? r.or(`status.eq.published,user_id.eq.${me}`) : r.eq('status', 'published'); return q(r, 'Could not load requests.'); },
      postWanted: async (w) => { try { return await q(sb.from('wanted_posts').insert(w).select('*').single(), 'Could not post the request.'); } catch (err) { if (!/possession|min_beds|prefs|min_budget|schema cache/i.test(err.message || '')) throw err; const { possession, min_budget, min_beds, prefs, ...rest } = w; return q(sb.from('wanted_posts').insert(rest).select('*').single(), 'Could not post the request.'); } },
      setWanted: (id, status) => q(sb.from('wanted_posts').update({ status }).eq('id', id), 'Could not update the request.'),
      admin: () => q(sb.rpc('admin_growth'), 'Could not load.'),
      saveSettings: (p) => q(sb.rpc('admin_save_growth', { p }), 'Could not save.'),
      decide: (id, ok, note) => q(sb.rpc('admin_decide_credit', { p_id: id, p_approve: ok, p_note: note || '' }), 'Could not save.'),
      saveOffer: (p) => q(sb.rpc('admin_save_offer', { p }), 'Could not save the offer.'),
      delOffer: (id) => q(sb.rpc('admin_delete_offer', { p_id: id }), 'Could not delete.'),
      feature: (id, days) => q(sb.rpc('admin_feature_listing', { p_listing: id, p_days: days }), 'Could not update.'),
      subscribe(cb) { const ch = sb.channel('growth-' + Date.now()); ['credit_ledger', 'wanted_posts', 'growth_settings', 'listing_features', 'listing_verifications'].forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => cb(t))); ch.subscribe(); return () => sb.removeChannel(ch); }
    };
  };

  // ---------- Demo mode (this browser only) ----------
  const gwLocal = (() => {
    const KEY = 'growth'; const now = () => new Date().toISOString();
    const seedOffers = () => [
      { id: 'of1', title: 'Free property advertising', body: 'List your property free and talk to buyers and tenants directly. RAQBO takes no commission on direct deals.', badge: 'Free', audience: ['owner'], cities: [], active: true, sort: 1 },
      { id: 'of2', title: 'Overseas Pakistanis: property help at home', body: 'Tell us what you are looking for and the RAQBO team will help you search, verify documents and arrange visits.', badge: 'Overseas', audience: ['overseas'], cities: [], active: true, sort: 2 },
      { id: 'of3', title: 'Agents and developers: list your projects', body: 'Publish your projects and listings on RAQBO and reach serious buyers. Talk to our team about bulk listings.', badge: 'Partners', audience: ['agent', 'developer'], cities: [], active: true, sort: 3 }];
    const read = () => { const d = store.get(KEY, null) || {}; return { s: { ...GW_DEFAULTS, ...(d.s || {}) }, prof: d.prof || {}, led: d.led || [], alerts: d.alerts || [], wanted: d.wanted || [], offers: d.offers || seedOffers(), feat: d.feat || {}, seq: d.seq || 1 }; };
    const write = (d) => { store.set(KEY, d); window.dispatchEvent(new Event('raqbo-growth')); };
    const me = () => (db.session && db.session.userId) || null;
    const nameOf = (u) => { const a = Object.values(store.get('accounts', {})).find((x) => x.userId === u); return (a && a.name) || 'RAQBO member'; };
    const code = (d) => { let c; do { c = 'RQ' + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01OI]/g, '7'); } while (Object.values(d.prof).some((p) => p.ref_code === c)); return c; };
    const ensure = (d, u) => {
      if (!u) return null; let p = d.prof[u];
      if (!p) p = d.prof[u] = { ref_code: code(d), founding_no: null, member_type: '', city: '', referred_by: null, trial: false, created: Date.now() };
      if (!p.founding_no && d.s.founding_enabled) { const n = Object.values(d.prof).reduce((m, x) => Math.max(m, x.founding_no || 0), 0); if (n < d.s.founding_cap) p.founding_no = n + 1; }
      return p;
    };
    const inPilot = (d, city) => !d.s.pilot_cities.length || d.s.pilot_cities.some((c) => c.trim().toLowerCase() === String(city || '').trim().toLowerCase());
    const available = (d, u) => Math.max(0, d.led.filter((c) => c.user_id === u && c.amount > 0 && c.status === 'approved').reduce((a, c) => a + c.amount, 0) + d.led.filter((c) => c.user_id === u && c.kind === 'redemption' && c.status !== 'rejected').reduce((a, c) => a + c.amount, 0));
    const ntf = (u, title, body, link) => { try { lvLocal.notify(u, 'system', title, body, link); } catch { /* ignore */ } };
    const reward = (d, referrer, kind, source, amount, what) => {
      if (!referrer || amount <= 0 || d.led.some((c) => c.kind === kind && c.source_user === source)) return;
      const used = d.led.filter((c) => c.amount > 0 && c.status !== 'rejected').reduce((a, c) => a + c.amount, 0);
      let st = d.s.referral_review ? 'pending' : 'approved'; let why = d.s.referral_review ? 'Waiting for RAQBO verification' : '';
      if (used + amount > d.s.budget_total) { st = 'pending'; why = 'Campaign budget reached — admin review'; }
      d.led.unshift({ id: d.seq++, user_id: referrer, kind, amount, status: st, source_user: source, note: '', admin_note: why, at: now(), expires_at: d.s.credit_expiry_days ? new Date(Date.now() + d.s.credit_expiry_days * 864e5).toISOString() : null });
      ntf(referrer, st === 'approved' ? `You earned ${rs(amount)} RAQBO credit` : `${rs(amount)} credit on the way`, `${nameOf(source).split(' ')[0]} ${what}.`, '#rewards');
    };
    const pubOf = (d) => ({ campaign_on: d.s.campaign_on, title: d.s.title, tagline: d.s.tagline, cta: d.s.cta, founding_enabled: d.s.founding_enabled, founding_cap: d.s.founding_cap, founding_taken: Object.values(d.prof).filter((p) => p.founding_no).length, founding_discount_pct: d.s.founding_discount_pct, founding_discount_max: d.s.founding_discount_max, referral_enabled: d.s.referral_enabled, referral_member_credit: d.s.referral_member_credit, referral_owner_credit: d.s.referral_owner_credit, featured_trial_enabled: d.s.featured_trial_enabled, featured_trial_days: d.s.featured_trial_days, pilot_cities: d.s.pilot_cities, credit_expiry_days: d.s.credit_expiry_days, verification_enabled: d.s.verification_enabled, verification_fee: d.s.verification_fee, verified: Object.values(store.get('verif', {})).filter((v) => v.status === 'verified').map((v) => v.listing_id), featured: Object.entries(d.feat).filter(([, t]) => t > Date.now()).map(([id]) => id) });
    return {
      async pub() { const d = read(); if (me() && isComplete()) { const before = JSON.stringify(d.prof[me()] || null); ensure(d, me()); if (JSON.stringify(d.prof[me()]) !== before) write(d); } return pubOf(d); },
      async my() {
        const u = me(); if (!u) throw new Error('Please sign in first.'); const d = read(); const before = JSON.stringify(d.prof[u] || null); const p = ensure(d, u); if (JSON.stringify(p) !== before) write(d);
        const mine = d.led.filter((c) => c.user_id === u);
        return { ref_code: p.ref_code, founding_no: p.founding_no, member_type: p.member_type || null, city: p.city || null, referred_by: p.referred_by ? nameOf(p.referred_by) : null, can_claim_referral: !p.referred_by && Date.now() - p.created < 14 * 864e5, featured_trial_used: !!p.trial,
          available: available(d, u), pending: mine.filter((c) => c.amount > 0 && c.status === 'pending').reduce((a, c) => a + c.amount, 0), earned: mine.filter((c) => c.amount > 0 && c.status === 'approved').reduce((a, c) => a + c.amount, 0),
          founding_discount: (() => { const f = mine.find((c) => c.kind === 'founding_discount' && c.status !== 'rejected'); return f ? { status: f.status, note: f.note, admin_note: f.admin_note, at: f.at } : null; })(),
          invited: Object.values(d.prof).filter((x) => x.referred_by === u).length, invited_active: mine.filter((c) => c.kind === 'referral_member' && c.status !== 'rejected').length,
          history: mine.map((c) => ({ ...c, who: c.source_user ? nameOf(c.source_user).split(' ')[0] : null })), alerts: d.alerts.filter((a) => a.user_id === u) };
      },
      async claim(c) {
        const u = me(); const d = read(); const p = ensure(d, u); if (p.referred_by) return 'already';
        const [rid, r] = Object.entries(d.prof).find(([, x]) => x.ref_code === String(c).trim().toUpperCase()) || [];
        if (!rid) throw new Error('That invite code is not valid.'); if (rid === u) throw new Error('You cannot use your own invite code.');
        p.referred_by = rid; ntf(rid, 'Someone joined with your invite', `${nameOf(u).split(' ')[0]} signed up with your link.`, '#rewards');
        if (d.s.referral_enabled && inPilot(d, p.city)) reward(d, rid, 'referral_member', u, d.s.referral_member_credit, 'joined RAQBO with your link');
        write(d); return 'ok';
      },
      async details(type, city) { const u = me(); const d = read(); const p = ensure(d, u); p.member_type = type || ''; p.city = (city || '').trim();
        if (p.referred_by && d.s.referral_enabled && inPilot(d, p.city)) reward(d, p.referred_by, 'referral_member', u, d.s.referral_member_credit, 'joined RAQBO with your link');
        write(d); },
      async redeem(kind, amount, note) {
        const u = me(); const d = read(); const p = ensure(d, u); if (String(note || '').trim().length < 3) throw new Error('Tell us which service or order this is for.');
        if (kind === 'founding') { if (!p.founding_no) throw new Error('This benefit is for Founding Members.'); if (d.led.some((c) => c.user_id === u && c.kind === 'founding_discount' && c.status !== 'rejected')) throw new Error('You have already used your Founding Member discount.');
          d.led.unshift({ id: d.seq++, user_id: u, kind: 'founding_discount', amount: 0, status: 'pending', note: note.trim(), admin_note: '', at: now() }); }
        else { if (!(amount > 0)) throw new Error('Enter the amount of credit to use.'); if (amount > available(d, u)) throw new Error(`You have ${rs(available(d, u))} credit available.`);
          d.led.unshift({ id: d.seq++, user_id: u, kind: 'redemption', amount: -amount, status: 'pending', note: note.trim(), admin_note: '', at: now() }); }
        try { lvLocal.notifyAdmins('system', kind === 'founding' ? 'Founding discount request' : 'Credit redemption request', `${nameOf(u)}: ${note.trim()}`, '#admin/growth'); } catch { /* ignore */ }
        write(d);
      },
      async trial(id) {
        const u = me(); const d = read(); const p = ensure(d, u); const l = byId(id);
        if (!d.s.featured_trial_enabled) throw new Error('The free featured trial is not available right now.'); if (p.trial) throw new Error('You have already used your free featured trial.');
        if (!l || l.ownerId !== u) throw new Error('You can feature only your own property.'); if (l.status !== 'published') throw new Error('Your property must be approved before it can be featured.');
        if (!inPilot(d, l.city)) throw new Error(`The free trial is available in ${d.s.pilot_cities.join(', ')} for now.`);
        const t = Date.now() + d.s.featured_trial_days * 864e5; d.feat[id] = Math.max(d.feat[id] || 0, t); p.trial = true; write(d); return new Date(t).toISOString();
      },
      async badges(ids) { const d = read(); return Object.entries(d.prof).filter(([u, p]) => ids.includes(u) && p.founding_no).map(([id, p]) => ({ id, founding_no: p.founding_no })); },
      async offers() { return read().offers.filter((o) => db.isAdmin || o.active); },
      async addAlert(a) { const u = me(); const d = read(); if (d.alerts.filter((x) => x.user_id === u).length >= 10) throw new Error('You can keep up to 10 property alerts. Remove one first.'); d.alerts.unshift({ ...a, id: 'al' + d.seq++, user_id: u, created_at: now() }); write(d); },
      async delAlert(id) { const d = read(); d.alerts = d.alerts.filter((a) => a.id !== id); write(d); },
      async wanted() { const u = me(); return read().wanted.filter((w) => w.status === 'published' || w.user_id === u || db.isAdmin); },
      async postWanted(w) { const u = me(); const d = read(); const row = { ...w, id: 'w' + d.seq++, ref: 'RQ-WNT-' + Math.random().toString(36).slice(2, 8).toUpperCase(), user_id: u, poster_name: (db.session && db.session.name) || 'RAQBO member', status: 'published', created_at: now() }; d.wanted.unshift(row); write(d); return row; },
      async setWanted(id, status) { const d = read(); const w = d.wanted.find((x) => x.id === id); if (w) w.status = status; write(d); },
      async admin() {
        const d = read(); const nm = nameOf;
        const pend = d.led.filter((c) => c.status === 'pending').reverse();
        return { settings: { ...d.s, campaign_title: d.s.title, campaign_tagline: d.s.tagline, campaign_cta: d.s.cta },
          stats: { founding: Object.values(d.prof).filter((p) => p.founding_no).length, referred: Object.values(d.prof).filter((p) => p.referred_by).length, referred_active: d.led.filter((c) => c.kind === 'referral_member' && c.status !== 'rejected').length, owner_rewards: d.led.filter((c) => c.kind === 'referral_owner' && c.status !== 'rejected').length,
            credit_issued: d.led.filter((c) => c.amount > 0 && c.status === 'approved').reduce((a, c) => a + c.amount, 0), credit_pending: d.led.filter((c) => c.amount > 0 && c.status === 'pending').reduce((a, c) => a + c.amount, 0), credit_used: -d.led.filter((c) => c.kind === 'redemption' && c.status === 'approved').reduce((a, c) => a + c.amount, 0),
            founding_discounts: d.led.filter((c) => c.kind === 'founding_discount' && c.status === 'approved').length, alerts: d.alerts.length, wanted: d.wanted.filter((w) => w.status === 'published').length, featured: Object.values(d.feat).filter((t) => t > Date.now()).length,
            types: Object.values(d.prof).reduce((m, p) => { const k = p.member_type || 'not set'; m[k] = (m[k] || 0) + 1; return m; }, {}) },
          queue: pend.map((c) => ({ ...c, user: nm(c.user_id), who: c.source_user ? nm(c.source_user) : null, founding_no: (d.prof[c.user_id] || {}).founding_no, available: available(d, c.user_id) })),
          recent: d.led.filter((c) => c.status !== 'pending').slice(0, 30).map((c) => ({ ...c, user: nm(c.user_id) })),
          top: Object.entries(Object.values(d.prof).reduce((m, p) => { if (p.referred_by) m[p.referred_by] = (m[p.referred_by] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([u, n]) => ({ name: nm(u), invited: n, rewarded: d.led.filter((c) => c.user_id === u && /^referral/.test(c.kind) && c.status !== 'rejected').length })),
          offers: d.offers, wanted: d.wanted.slice(0, 50) };
      },
      async saveSettings(p) { const d = read(); const m = { ...p }; if ('campaign_title' in m) { m.title = m.campaign_title; delete m.campaign_title; } if ('campaign_tagline' in m) { m.tagline = m.campaign_tagline; delete m.campaign_tagline; } if ('campaign_cta' in m) { m.cta = m.campaign_cta; delete m.campaign_cta; } Object.assign(d.s, m); write(d); },
      async decide(id, ok, note) { const d = read(); const c = d.led.find((x) => x.id === id); if (!c || c.status !== 'pending') throw new Error('This request was already handled.'); c.status = ok ? 'approved' : 'rejected'; c.admin_note = note || (ok ? '' : c.admin_note); c.decided_at = now();
        ntf(c.user_id, c.kind === 'redemption' ? (ok ? `${rs(-c.amount)} credit applied` : 'Credit request not approved') : c.kind === 'founding_discount' ? (ok ? 'Founding Member discount applied' : 'Founding discount request not approved') : (ok ? `${rs(c.amount)} credit is ready to use` : 'Referral reward not approved'), note || '', '#rewards'); write(d); },
      async saveOffer(p) { const d = read(); if (p.id) { const o = d.offers.find((x) => x.id === p.id); if (o) Object.assign(o, p); } else d.offers.push({ ...p, id: 'of' + d.seq++ }); write(d); },
      async delOffer(id) { const d = read(); d.offers = d.offers.filter((o) => o.id !== id); write(d); },
      async feature(id, days) { const d = read(); if (days > 0) d.feat[id] = Date.now() + days * 864e5; else delete d.feat[id]; write(d); },
      subscribe(cb) { const f = () => cb('local'); const g = (e) => { if (e.key && e.key.endsWith(KEY)) cb('local'); }; window.addEventListener('raqbo-growth', f); window.addEventListener('storage', g); return () => { window.removeEventListener('raqbo-growth', f); window.removeEventListener('storage', g); }; }
    };
  })();
  const GW = SB ? gwSupabase(SB) : gwLocal;

  // ---------- State helpers used by the rest of the site ----------
  function gwIsFeatured(id) { return !!(gw && gw.featured && gw.featured.has(id)); }
  function gwFoundingChip(userId, big) { const n = gw && gw.badges && userId ? gw.badges[userId] : null; return n ? `<span class="gw-fchip${big ? ' big' : ''}" title="One of the first ${esc((gw.pub && gw.pub.founding_cap || 10000).toLocaleString('en-US'))} RAQBO members">${DI(GI.medal, big ? 15 : 12)} Founding Member #${esc(n)}</span>` : ''; }
  function gwTrialBtn(l) {
    const p = gw.pub; const me = gw.me;
    if (!p || !p.featured_trial_enabled || !l || l.status !== 'published' || l.sample) return '';
    if (gwIsFeatured(l.id)) return '<span class="gw-feat-on">★ Featured</span>';
    if (me && me.featured_trial_used) return '';
    return `<button type="button" class="link-button gw-trial" data-gw="trial" data-id="${esc(l.id)}">★ Feature free for ${esc(p.featured_trial_days)} days</button>`;
  }
  function gwPendingCount() { return gw.admin && gw.admin.queue ? gw.admin.queue.length : ''; }
  const gwMyFounding = () => (gw.me && gw.me.founding_no) || null;

  const gwKey = () => [[...gw.featured].join(), [...(gw.verified || [])].join(), vfOn(), [...((typeof pf !== 'undefined' && pf.legal) || [])].join(), [...((typeof pf !== 'undefined' && pf.idv) || [])].join()].join('|');
  async function gwLoadPub() {
    const was = gwKey();
    try { gw.pub = await GW.pub(); } catch { gw.pub = null; }
    gw.featured = new Set((gw.pub && gw.pub.featured) || []); gw.verified = new Set((gw.pub && gw.pub.verified) || []);
    await pfLoad(); await Promise.all([dlLoad(), auLoad()]);
    if (was !== gwKey() && db.loaded) renderGrid();
    gwBand(); gwLoadBadges(); coreRails();
  }
  async function gwLoadBadges() {
    const ids = [...new Set(db.listings.filter((l) => l.ownerId && !l.sample && l.status === 'published').map((l) => l.ownerId).concat(db.session ? [db.session.userId] : []))].slice(0, 500);
    if (!ids.length) return;
    try { (await GW.badges(ids)).forEach((b) => { gw.badges[b.id] = b.founding_no; }); } catch { /* ignore */ }
  }
  async function gwLoadMe() {
    if (!(db.session && isComplete())) { gw.me = null; return null; }
    try { gw.me = await GW.my(); if (gw.me && gw.me.founding_no) gw.badges[db.session.userId] = gw.me.founding_no; } catch { gw.me = null; }
    return gw.me;
  }
  // Called whenever the signed-in person changes (from the account button)
  function gwSync() {
    const u = db.session && isComplete() ? db.session.userId : null;
    if (gw.started && u === gw.uid) return; gw.started = true; gw.uid = u; gw.me = null;
    if (!gw.unsub) { try { gw.unsub = GW.subscribe((t) => gwSoon(t)); } catch { gw.unsub = null; } clearInterval(gw.timer); gw.timer = setInterval(() => { if (!document.hidden) gwSoon('poll'); }, 120000); }
    (async () => {
      await gwLoadPub(); if (!u) { gwBand(); return; }
      await gwClaimPending(); await gwLoadMe(); await vfLoadMine(); gwBand(); gwAcctBadge();
      if (gw.me && !gw.me.member_type) setTimeout(gwWelcome, 1400);
    })();
  }
  let gwSoonT = null;
  function gwSoon() { clearTimeout(gwSoonT); gwSoonT = setTimeout(async () => { await gwLoadPub(); if (gw.uid) { await gwLoadMe(); await vfLoadMine(); } gwAcctBadge(); if (admin.el && !admin.el.hidden && admin.tab === 'verify') { vf.admin = null; vfAdminLoad(); } if (gw.pageOpen === 'rewards') gwPaintRewards(); if (gw.pageOpen === 'wanted') gwPaintWanted(); if (admin.el && !admin.el.hidden && admin.tab === 'growth') gwAdminLoad(); }, 500); }

  // ---------- Invite links (?ref=CODE) ----------
  const REF_KEY = 'raqbo-ref';
  (function captureRef() {
    try {
      const u = new URL(location.href); const c = (u.searchParams.get('ref') || '').trim().toUpperCase();
      if (/^RQ[A-Z0-9]{6}$/.test(c)) { localStorage.setItem(REF_KEY, JSON.stringify({ c, t: Date.now() })); u.searchParams.delete('ref'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); gw.invited = true; }
    } catch { /* ignore */ }
  })();
  const pendingRef = () => { try { const v = JSON.parse(localStorage.getItem(REF_KEY) || 'null'); return v && Date.now() - v.t < 30 * 864e5 ? v.c : null; } catch { return null; } };
  async function gwClaimPending() {
    const c = pendingRef(); if (!c) return;
    try { const r = await GW.claim(c); if (r === 'ok') toast('Invite applied — welcome to RAQBO! 🎉'); } catch (err) { if (!/own invite/i.test(err.message)) toast(err.message); }
    try { localStorage.removeItem(REF_KEY); } catch { /* ignore */ }
  }
  const refLink = (code) => `${location.origin}${location.protocol === 'file:' ? location.pathname : '/'}?ref=${encodeURIComponent(code)}`;

  // ---------- Home page campaign band ----------
  function gwBand() {
    const p = gw.pub; let el = $('#gw-band');
    if (!p || !p.campaign_on) { if (el) el.remove(); return; }
    if (!el) { const after = $('.trust-strip') || $('#home'); if (!after) return; el = document.createElement('section'); el.id = 'gw-band'; el.className = 'gw-band'; el.setAttribute('aria-label', 'RAQBO Founding Members Club'); after.after(el); }
    const left = Math.max(0, (p.founding_cap || 0) - (p.founding_taken || 0)); const pct = p.founding_cap ? Math.min(100, Math.round((p.founding_taken / p.founding_cap) * 100)) : 0;
    const me = gw.me; const signed = isComplete();
    const perks = [
      p.founding_enabled ? [GI.medal, 'Founding Member badge', `For the first ${p.founding_cap.toLocaleString('en-US')} members`] : null,
      p.founding_enabled && p.founding_discount_pct ? [DIC.check, `${p.founding_discount_pct}% off, up to ${rs(p.founding_discount_max)}`, 'On your first eligible paid service'] : null,
      [DIC.home, 'Free property ads', 'Talk to buyers directly · no commission'],
      p.referral_enabled ? [GI.gift, 'Refer & Earn credit', `${rs(p.referral_member_credit)} per active member · ${rs(p.referral_owner_credit)} per approved listing`] : null
    ].filter(Boolean);
    el.innerHTML = `<div class="container gw-band-in">
      <div class="gw-band-copy">
        <span class="gw-kicker">${DI(GI.spark, 14)} RAQBO FOUNDING MEMBERS CLUB</span>
        <h2>${esc(p.title)}</h2>
        <p class="gw-tag">${esc(p.tagline)}</p>
        <p class="gw-cta-line">${esc(p.cta)}</p>
        <div class="gw-band-actions">${signed
          ? `<button type="button" class="button button-primary" data-gw="rewards">${DI(GI.gift, 17)} My RAQBO Rewards</button><button type="button" class="button button-ghost" data-gw="invite">${DI(GI.share, 16)} Invite friends</button>`
          : `<button type="button" class="button button-primary" data-gw="join">Join free</button><button type="button" class="button button-ghost" data-gw="signin">I already have an account</button>`}</div>
      </div>
      <div class="gw-band-card">
        ${me && me.founding_no ? `<div class="gw-medal"><span>${DI(GI.medal, 30)}</span><div><small>YOU ARE</small><b>Founding Member #${esc(me.founding_no)}</b><em>of ${esc(p.founding_cap.toLocaleString('en-US'))}</em></div></div>`
          : p.founding_enabled ? `<div class="gw-count"><b data-gw-left>${esc(left.toLocaleString('en-US'))}</b><span>Founding Member places left</span></div>` : ''}
        ${p.founding_enabled ? `<div class="gw-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${esc(p.founding_cap)}" aria-valuenow="${esc(p.founding_taken)}" aria-label="Founding Member places taken"><i style="width:${Math.max(2, pct)}%"></i></div><small class="gw-meter-note">${esc(p.founding_taken.toLocaleString('en-US'))} of ${esc(p.founding_cap.toLocaleString('en-US'))} taken · updates live</small>` : ''}
        <ul class="gw-perks">${perks.map(([ic, b, s]) => `<li><span>${DI(ic, 17)}</span><div><b>${esc(b)}</b><small>${esc(s)}</small></div></li>`).join('')}</ul>
        <p class="gw-fine">Rewards are RAQBO service credit, not cash, and are checked before use.${p.pilot_cities && p.pilot_cities.length ? ` Rewards start in ${esc(p.pilot_cities.join(', '))}.` : ''} <button type="button" class="link-button" data-gw="terms">Terms</button></p>
      </div></div>`;
    if (!gw.inviteShown && gw.invited && !signed) { gw.inviteShown = true; setTimeout(() => toast('You were invited to RAQBO — join free and become a Founding Member.'), 900); }
  }
  // Founding chip in the account menu / drawer
  function gwAcctBadge() {
    const n = gwMyFounding(); const head = $('.acct-head > div'); if (head && n && !$('.gw-fchip', head)) head.insertAdjacentHTML('beforeend', gwFoundingChip(db.session.userId));
    const dr = $('.dr-user > div'); if (dr && n && !$('.gw-fchip', dr)) dr.insertAdjacentHTML('beforeend', gwFoundingChip(db.session.userId));
  }

  // ---------- Welcome: "I am a…" + city ----------
  function gwDetailsForm(me, compact) {
    return `<form class="gw-details" data-gw-details>
      <span class="gw-label">I am a…</span>
      <div class="gw-types">${MEMBER_TYPES.map(([k, t]) => `<label class="gw-type"><input type="radio" name="type" value="${k}" ${me && me.member_type === k ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>
      <label class="gw-city"><span class="gw-label">My city</span><input name="city" list="gw-cities" maxlength="60" placeholder="e.g. Lahore" value="${esc((me && me.city) || '')}"><datalist id="gw-cities">${['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Gujranwala', 'Sialkot', 'Quetta', 'Hyderabad', 'Bahawalpur'].map((c) => `<option value="${c}">`).join('')}</datalist></label>
      <div class="button-row"><button type="submit" class="button button-primary">${compact ? 'Save' : 'Save and continue'}</button>${compact ? '' : '<button type="button" class="button button-outline" data-gw="welcome-skip">Later</button>'}</div>
    </form>`;
  }
  // A small card (not a pop-up) so it never interrupts what the new member was doing
  function gwWelcome() {
    const me = gw.me; if (!me || me.member_type || $('.gw-nudge')) return;
    const k = 'raqbo-gw-welcome-' + gw.uid; try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch { /* ignore */ }
    const first = ((db.session && db.session.name) || '').split(/\s+/)[0];
    const el = document.createElement('div'); el.className = 'gw-nudge'; el.setAttribute('role', 'status');
    el.innerHTML = `<button type="button" class="gw-nudge-x" aria-label="Close">${DI(DIC.x, 16)}</button><span class="gw-nudge-ico">${DI(me.founding_no ? GI.medal : GI.spark, 22)}</span><div><b>${me.founding_no ? `Welcome${first ? ', ' + esc(first) : ''} — you are Founding Member #${esc(me.founding_no)}!` : `Welcome to RAQBO${first ? ', ' + esc(first) : ''}!`}</b><small>Tell us what describes you to see offers and alerts for you.</small><button type="button" class="button button-primary" data-gw="welcome-open">Set up in 10 seconds</button></div>`;
    document.body.append(el); requestAnimationFrame(() => el.classList.add('in'));
    const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); };
    $('.gw-nudge-x', el).addEventListener('click', close); el.addEventListener('click', (e) => { if (e.target.closest('[data-gw="welcome-open"]')) close(); });
    setTimeout(close, 20000);
  }
  function gwWelcomeModal() {
    const me = gw.me; if (!me) return; const first = ((db.session && db.session.name) || '').split(/\s+/)[0];
    openModal(`<div class="gw-welcome">${me.founding_no ? `<div class="gw-medal big"><span>${DI(GI.medal, 34)}</span><div><small>WELCOME TO RAQBO${first ? ', ' + esc(first.toUpperCase()) : ''}</small><b>You are Founding Member #${esc(me.founding_no)}</b><em>Your badge and introductory benefits are ready in My RAQBO Rewards.</em></div></div>` : `<div class="eyebrow"><span></span> WELCOME TO RAQBO</div><h2>Hello${first ? ', ' + esc(first) : ''}!</h2>`}
      <p class="modal-lead">Tell us a little about you so we can show the offers and alerts that fit you.</p>${gwDetailsForm(me)}</div>`, { label: 'Welcome to RAQBO' });
  }

  // ---------- My RAQBO Rewards ----------
  function openRewards() {
    requireSignIn(async () => {
      closeNavMenus(); gw.pageOpen = 'rewards';
      const card = openModal('<div class="gw-loading">Loading your rewards…</div>', { wide: true, label: 'My RAQBO Rewards', onClose: () => { if (gw.pageOpen === 'rewards') gw.pageOpen = ''; } });
      card.classList.add('gw-card');
      try { await gwLoadMe(); if (!gw.pub) await gwLoadPub(); if (!gw.offers) gw.offers = await GW.offers().catch(() => []); } catch { /* shown below */ }
      gwPaintRewards();
    });
  }
  function gwPaintRewards() {
    const card = $('.modal-card.gw-card'); if (!card || gw.pageOpen !== 'rewards') return; const me = gw.me; const p = gw.pub || GW_DEFAULTS;
    if (!me) { setBody(card, `<div class="admin-empty">${esc(gwSetupMsg)}</div>`); return; }
    const link = refLink(me.ref_code); const s = db.session;
    const offers = (gw.offers || []).filter((o) => o.active !== false && (!o.audience || !o.audience.length || o.audience.includes(me.member_type)) && (!o.cities || !o.cities.length || o.cities.some((c) => c.toLowerCase() === String(me.city || '').toLowerCase())));
    const fd = me.founding_discount; const KIND = { referral_member: 'Friend joined', referral_owner: 'Friend\'s property approved', bonus: 'Bonus', redemption: 'Credit used', founding_discount: 'Founding discount' };
    const st = (x) => `<span class="gw-st gw-st-${esc(x)}">${x === 'approved' ? 'Approved' : x === 'rejected' ? 'Not approved' : 'Waiting'}</span>`;
    setBody(card, `<div class="gw-page">
      <div class="gw-head">
        <div class="gw-id">${me.founding_no ? `<div class="gw-medal"><span>${DI(GI.medal, 30)}</span><div><small>FOUNDING MEMBER</small><b>#${esc(me.founding_no)}</b><em>of the first ${esc((p.founding_cap || 10000).toLocaleString('en-US'))}</em></div></div>` : `<div class="gw-medal plain"><span>${DI(DIC.user, 26)}</span><div><small>RAQBO MEMBER</small><b>${esc(s.name || 'Member')}</b><em>${p.founding_enabled ? 'Founding places are full' : 'Welcome to RAQBO'}</em></div></div>`}
          <p class="gw-who">${me.member_type ? esc(typeName(me.member_type)) : 'Member type not set'}${me.city ? ' · ' + esc(me.city) : ''} · <button type="button" class="link-button" data-gw="edit-details">Edit</button></p></div>
        <div class="gw-stats"><div><small>Credit to use</small><b>${esc(rs(me.available))}</b></div><div><small>Waiting for verification</small><b>${esc(rs(me.pending))}</b></div><div><small>Earned so far</small><b>${esc(rs(me.earned))}</b></div></div>
      </div>
      <div class="gw-edit" hidden>${gwDetailsForm(me, true)}</div>
      ${!me.member_type || !me.city ? `<div class="gw-note">${DI(DIC.info, 16)} <span>Add your member type and city to see offers for you${p.pilot_cities && p.pilot_cities.length ? ` — rewards are open in ${esc(p.pilot_cities.join(', '))} first` : ''}. <button type="button" class="link-button" data-gw="edit-details">Add now</button></span></div>` : ''}

      ${p.referral_enabled ? `<section class="gw-sec gw-refer"><h3>${DI(GI.gift, 18)} Refer &amp; Earn</h3>
        <p>Invite people who are interested in property. You earn <b>${esc(rs(p.referral_member_credit))}</b> RAQBO credit when someone joins with your link and starts using RAQBO, and <b>${esc(rs(p.referral_owner_credit))}</b> when someone you invited publishes an approved property.</p>
        <div class="gw-link"><input readonly value="${esc(link)}" aria-label="Your invite link"><button type="button" class="button button-outline" data-gw="copy" data-text="${esc(link)}">${DI(GI.copy, 15)} Copy</button><a class="button button-primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Join me on RAQBO — Pakistan's property world in your pocket. Free property ads, direct owner contact and Founding Member benefits: ${link}`)}">${DI(DIC.chat, 15)} WhatsApp</a></div>
        <p class="gw-mini">Your code: <b>${esc(me.ref_code)}</b> · ${esc(me.invited)} joined with your link · ${esc(me.invited_active)} active</p>
        ${me.referred_by ? `<p class="gw-mini">You were invited by ${esc(me.referred_by)}.</p>` : me.can_claim_referral ? `<form class="gw-inline" data-gw-claim><input name="code" maxlength="12" placeholder="Have an invite code? e.g. RQ7K2M9A" aria-label="Invite code"><button type="submit" class="button button-outline">Apply</button></form>` : ''}
      </section>` : ''}

      ${me.founding_no && p.founding_discount_pct ? `<section class="gw-sec"><h3>${DI(GI.medal, 18)} Founding Member benefit</h3>
        <p><b>${esc(p.founding_discount_pct)}% off, up to ${esc(rs(p.founding_discount_max))}</b>, on your first eligible paid RAQBO service (for example document verification, legal drafting or registry help).</p>
        ${fd ? `<p class="gw-mini">Requested for: ${esc(fd.note)} · ${st(fd.status)}${fd.admin_note ? ' · ' + esc(fd.admin_note) : ''}</p>` : `<form class="gw-inline" data-gw-founding><input name="note" maxlength="300" placeholder="Which service is it for?" aria-label="Service"><button type="submit" class="button button-primary">Use my discount</button></form>`}
      </section>` : ''}

      <section class="gw-sec"><h3>${DI(DIC.cart, 18)} Use my credit</h3>
        ${me.available > 0 ? `<form class="gw-inline gw-redeem" data-gw-redeem><input name="amount" type="number" min="1" max="${esc(me.available)}" placeholder="Amount (Rs)" aria-label="Amount"><input name="note" maxlength="300" placeholder="For which service or order? e.g. Order RQ-ORD-…" aria-label="For which service"><button type="submit" class="button button-primary">Send request</button></form><p class="gw-mini">The RAQBO team applies the credit to that service and confirms here.</p>`
          : '<p class="gw-mini">You have no credit to use yet. Invite friends to earn RAQBO credit.</p>'}
      </section>

      ${offers.length ? `<section class="gw-sec"><h3>${DI(GI.spark, 18)} Offers for you</h3><div class="gw-offers">${offers.map((o) => `<div class="gw-offer">${o.badge ? `<em>${esc(o.badge)}</em>` : ''}<b>${esc(o.title)}</b><p>${esc(o.body)}</p><button type="button" class="link-button" data-chat="support">Ask about this offer →</button></div>`).join('')}</div></section>` : ''}

      <section class="gw-sec"><h3>${DI(DIC.bell, 18)} My property alerts</h3>
        ${me.alerts && me.alerts.length ? `<ul class="gw-alerts">${me.alerts.map((a) => `<li><span>${esc(gwAlertText(a))}</span><button type="button" class="link-button" data-gw="del-alert" data-id="${esc(a.id)}">Remove</button></li>`).join('')}</ul>` : ''}
        <p class="gw-mini">Search the properties, then tap <b>Alert me</b> above the results. You get a notification when a matching property is approved, and when a property you saved drops its price.</p>
        <div class="button-row"><button type="button" class="button button-outline" data-gw="go-search">${DI(DIC.search, 15)} Search properties</button><button type="button" class="button button-outline" data-gw="wanted">${DI(GI.target, 15)} Post a Property Wanted request</button></div>
      </section>

      <section class="gw-sec"><h3>${DI(DIC.list, 18)} History</h3>
        ${me.history && me.history.length ? `<div class="gw-table-wrap"><table class="gw-table"><thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Status</th></tr></thead><tbody>${me.history.map((h) => `<tr><td>${esc(fmtDay(h.at))}</td><td>${esc(KIND[h.kind] || h.kind)}${h.who ? ' · ' + esc(h.who) : ''}${h.note ? `<br><small>${esc(h.note)}</small>` : ''}${h.admin_note ? `<br><small>${esc(h.admin_note)}</small>` : ''}${h.expires_at && h.amount > 0 ? `<br><small>Use by ${esc(fmtDay(h.expires_at))}</small>` : ''}</td><td>${h.amount ? (h.amount > 0 ? '+' : '−') + esc(rs(Math.abs(h.amount))) : '—'}</td><td>${st(h.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="gw-mini">Nothing yet.</p>'}
      </section>
      <p class="gw-fine">${gwTermsText(p)}</p>
    </div>`);
  }
  const gwTermsText = (p) => `RAQBO credit is not cash: it cannot be withdrawn or transferred and is used only against eligible RAQBO services. Rewards are for genuine members and approved, genuine listings, and RAQBO checks them before they can be used. ${p.credit_expiry_days ? `Credit expires ${esc(p.credit_expiry_days)} days after it is earned. ` : ''}Benefits and amounts are introductory and RAQBO may change or end them.`;
  function gwAlertText(a) {
    const bits = [a.property_type || 'Any property', a.purpose === 'rent' ? 'for rent' : a.purpose === 'sale' ? 'for sale' : '', [a.area, a.city].filter(Boolean).join(', ') ? 'in ' + [a.area, a.city].filter(Boolean).join(', ') : '', a.max_price ? 'up to ' + fmtPrice(a.max_price) : '', a.min_price ? 'from ' + fmtPrice(a.min_price) : ''];
    return a.label || bits.filter(Boolean).join(' ');
  }

  // ---------- "Alert me" from the current search ----------
  function gwPlaceAlertBtn() { const c = $('.results-controls'); if (!c || $('[data-gw="alert"]', c)) return; c.insertAdjacentHTML('afterbegin', `<button type="button" class="gw-alert-btn" data-gw="alert" title="Get notified when a matching property is listed">${DI(DIC.bell, 15)} Alert me</button>`); }
  function gwCurrentSearch() {
    const text = loc.value.trim(); const known = Object.keys(CITY_LL); let city = null; let area = text;
    const hit = known.find((c) => text.toLowerCase().split(/[\s,]+/).join(' ').includes(c)); if (hit) { city = hit.replace(/\b\w/g, (m) => m.toUpperCase()); area = text.replace(new RegExp(hit, 'i'), '').replace(/^[\s,]+|[\s,]+$/g, ''); }
    const [bp, min, max] = (budgetSel.value || '').split(':');
    const purpose = ui.deal !== 'all' ? ui.deal : (bp || null);
    return { purpose: purpose || null, property_type: typeSel.value || null, city, area: area || null, min_price: min ? +min || null : null, max_price: max ? +max : null };
  }
  async function gwSaveAlert(btn) {
    requireSignIn(async () => {
      const a = gwCurrentSearch(); a.label = gwAlertText({ ...a, label: '' });
      const done = busy(btn, 'Saving…');
      try { await GW.addAlert(a); done(); toast(`🔔 Alert saved: ${a.label}. We'll notify you about new matches.`); gwLoadMe(); }
      catch (err) { done(); toast(err.message); }
    });
  }

  // ---------- Property Wanted ----------
  let gwWanted = { list: [], filter: { purpose: '', city: '' }, focus: null };
  function openWanted(focusId, compose) {
    closeNavMenus(); gw.pageOpen = 'wanted'; gwWanted.focus = focusId || null;
    const card = openModal('<div class="gw-loading">Loading requests…</div>', { wide: true, label: 'Property Wanted', onClose: () => { if (gw.pageOpen === 'wanted') gw.pageOpen = ''; } });
    card.classList.add('gw-card', 'gw-wanted-card');
    GW.wanted().then((r) => { gwWanted.list = r || []; gwPaintWanted(); if (compose) gwComposeWanted(); }).catch((err) => setBody(card, `<div class="admin-empty">${esc(err.message)}</div>`));
  }
  async function gwPaintWanted(refetch) {
    const card = $('.modal-card.gw-wanted-card'); if (!card || gw.pageOpen !== 'wanted') return;
    if (refetch !== false) { try { gwWanted.list = (await GW.wanted()) || []; } catch { /* keep */ } }
    const me = db.session && db.session.userId; const f = gwWanted.filter;
    const list = gwWanted.list.filter((w) => (!f.purpose || w.purpose === f.purpose) && (!f.city || String(w.city).toLowerCase().includes(f.city.toLowerCase())))
      .sort((a, b) => (a.id === gwWanted.focus ? -1 : b.id === gwWanted.focus ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at)));
    const keepCompose = $('[data-gw-wanted-form]', card);
    const head = `<div class="gw-page">
      <div class="gw-wanted-head"><div><div class="eyebrow"><span></span> PROPERTY WANTED</div><h2>Tell owners what you need</h2><p class="modal-lead">Post what you are looking for — owners with a matching property can message you directly. Owners: reply to buyers and tenants looking for a property like yours.</p></div>
        <button type="button" class="button button-primary" data-gw="compose">${DI(DIC.plus, 16)} Post a request</button></div>
      <div class="gw-compose" hidden></div>
      <div class="gw-filter"><div class="seg" role="group" aria-label="Looking to">${[['', 'All'], ['buy', 'Buy'], ['rent', 'Rent']].map(([v, t]) => `<button type="button" data-gw-wf="${v}" class="${f.purpose === v ? 'active' : ''}">${t}</button>`).join('')}</div><input type="search" data-gw-wcity placeholder="Filter by city" value="${esc(f.city)}" aria-label="Filter by city"></div>
      <div class="gw-wanted-list">${list.length ? list.map((w) => {
        const mine = w.user_id === me; const sz = w.min_size ? `${w.min_size} ${w.size_unit || ''}+` : '';
        return `<article class="gw-want ${w.id === gwWanted.focus ? 'focus' : ''} ${w.status !== 'published' ? 'is-off' : ''}">
          <div class="gw-want-top"><span class="gw-want-tag ${w.purpose}">${w.purpose === 'rent' ? 'TO RENT' : 'TO BUY'}</span><small>${esc(w.ref || '')} · ${esc(relShort(w.created_at))}${w.status !== 'published' ? ' · ' + esc(w.status) : ''}</small></div>
          <h3>${esc(w.property_type)} in ${w.area ? esc(w.area) + ', ' : ''}${esc(w.city)}</h3>
          <div class="gw-want-facts">${w.max_budget ? `<span>${DI(DIC.cart, 14)} Up to ${esc(fmtPrice(w.max_budget))}${w.purpose === 'rent' ? '/month' : ''}</span>` : ''}${sz ? `<span>${DI(DIC.grid, 14)} ${esc(sz)}</span>` : ''}<span>${DI(DIC.user, 14)} ${esc(String(w.poster_name || 'Member').split(' ')[0])}</span>${v3wFacts(w)}</div>
          ${w.details ? `<p>${esc(w.details)}</p>` : ''}
          <div class="gw-want-act">${v3wMatchBtn(w, mine)}${mine ? (w.status === 'published' ? `<button type="button" class="button button-outline" data-gw="close-wanted" data-id="${esc(w.id)}">Close my request</button>` : '') : w.status === 'published' ? `<button type="button" class="button button-primary" data-gw="reply-wanted" data-id="${esc(w.id)}">${DI(DIC.chat, 15)} I have a match — message</button>` : ''}</div>
        </article>`; }).join('') : '<div class="admin-empty">No requests yet. Be the first to post what you are looking for.</div>'}</div></div>`;
    setBody(card, head);
    if (keepCompose) gwComposeWanted();
  }
  function gwComposeWanted() {
    requireSignIn(() => {
      const box = $('.gw-wanted-card .gw-compose'); if (!box) { openWanted(null, true); return; }
      box.hidden = false;
      box.innerHTML = `<form class="gw-wform" data-gw-wanted-form novalidate>
        <div class="gw-grid">
          <label><span>Looking to</span><select name="purpose"><option value="buy">Buy</option><option value="rent">Rent</option></select></label>
          <label><span>Property type</span><select name="property_type"><option>House</option><option>Apartment</option><option>Plot</option><option>Commercial</option></select></label>
          <label><span>City *</span><input name="city" required maxlength="60" list="gw-cities2" placeholder="e.g. Lahore"><datalist id="gw-cities2">${Object.keys(CITY_LL).map((c) => `<option value="${esc(c.replace(/\b\w/g, (m) => m.toUpperCase()))}">`).join('')}</datalist></label>
          <label><span>Area / society</span><input name="area" maxlength="120" placeholder="e.g. DHA Phase 6"></label>
          <label><span>Maximum budget (PKR)</span><input name="max_budget" type="number" min="1" placeholder="e.g. 25000000"></label>
          <label class="gw-size"><span>Minimum size</span><span class="gw-size-in"><input name="min_size" type="number" min="0" step="any" placeholder="e.g. 10"><select name="size_unit"><option>Marla</option><option>Kanal</option><option>sq ft</option><option>sq yd</option><option>Acre</option></select></span></label>
        </div>
        ${v3wFormExtra()}
        <label><span>Details</span><textarea name="details" rows="3" maxlength="600" placeholder="Bedrooms, corner plot, near a school, move-in date…"></textarea></label>
        <p class="form-hint">Your first name and the details above are shown publicly. Your phone number is not — owners reply privately through RAQBO messages. Matching owners are notified, and you get an alert when a matching property is approved.</p>
        <div class="button-row"><button type="submit" class="button button-primary">Post request</button><button type="button" class="button button-outline" data-gw="compose-cancel">Cancel</button></div>
      </form>`;
      const c = $('[name=city]', box); if (c) c.focus();
    });
  }

  // ---------- Guides: checklists and templates (sample formats) ----------
  const GUIDES = {
    checklists: [
      { id: 'buy', title: 'Buying a plot or house', items: [
        'Get a copy of the seller\'s CNIC and verify it. Meet the owner in person, not only a dealer.',
        'For land-record property, get the latest Fard (record of rights) and check the owner\'s name, khasra/khewat numbers and area match the deal.',
        'For a housing society, confirm the file, allotment and transfer letters with the society office, and ask for a no-dues certificate / NOC.',
        'Check the society or scheme is approved by the development authority (in Lahore, LDA publishes approved and illegal schemes).',
        'Check the chain of ownership: previous registry (sale deed) and intiqal (mutation) documents.',
        'Ask whether there is a loan, mortgage, court case or stay order on the property. Your lawyer can search the records.',
        'For a built house, check the approved building map, and that property tax and utility bills are paid.',
        'Pay token money (bayana) only with a written receipt signed by the owner and two witnesses, and agree the final date.',
        'Confirm the current taxes and fees for the transfer (federal advance taxes, stamp duty and registration fees) with your lawyer or tax adviser — rates change.',
        'Complete the transfer at the Sub-Registrar or society office, and make sure the mutation is done in your name.'] },
      { id: 'rent', title: 'Renting a home or shop', items: [
        'Check the landlord owns the property (registry, Fard or society transfer letter) and see their CNIC.',
        'Sign a written tenancy agreement: rent, security deposit, period, yearly increase, notice period, who pays bills and repairs.',
        'In Punjab, tenancy agreements are to be submitted to the Rent Registrar and tenants registered with the local police — ask your lawyer about your city.',
        'Photograph the property and note meter readings on the day you move in.',
        'Pay rent and the deposit by bank transfer and keep every receipt.'] },
      { id: 'sell', title: 'Selling your property', items: [
        'Keep the originals ready: registry, mutation, Fard or society allotment/transfer letters, approved map.',
        'Clear society dues, property tax and utility bills, and get a no-dues certificate.',
        'Compare prices for your area (RAQBO shows the price per marla on each property).',
        'Verify the buyer\'s CNIC and take token money only with a written receipt.',
        'Ask your lawyer which seller-side taxes apply and keep the payment proof for the transfer.'] },
      { id: 'overseas', title: 'Overseas Pakistanis buying from abroad', items: [
        'If someone acts for you in Pakistan, give a specific power of attorney attested by a Pakistan embassy or consulate, not a general one.',
        'Never send money to the personal account of an agent you have not verified. Pay through proper banking channels.',
        'Ask for a live video visit of the property and get the documents checked independently before paying.',
        'Use the checklists above for the documents, and keep copies of every receipt.'] }
    ],
    templates: [
      { id: 'tenancy', title: 'Tenancy (rent) agreement', text: `TENANCY AGREEMENT

This agreement is made at __________ on ____ / ____ / ______ between:

LANDLORD: ______________________, son/daughter/wife of ______________________, CNIC No. _______________, resident of ______________________ (the "Landlord")

TENANT: ______________________, son/daughter/wife of ______________________, CNIC No. _______________, resident of ______________________ (the "Tenant")

1. PROPERTY: The Landlord rents to the Tenant the property at ______________________________________ (the "Property").
2. PERIOD: ____ months, from ____ / ____ / ______ to ____ / ____ / ______.
3. RENT: Rs __________ per month, payable in advance by the ____ of each month, by bank transfer to account __________________.
4. SECURITY DEPOSIT: Rs __________, refundable at the end of the tenancy after deducting unpaid rent, bills or damage beyond normal wear.
5. INCREASE: The rent will increase by ____ % on renewal.
6. BILLS: Electricity, gas, water and other bills will be paid by the ______________.
7. USE: The Property will be used only for ______________ purposes. The Tenant will not sub-let without written permission.
8. REPAIRS: Minor repairs by the Tenant; major structural repairs by the Landlord.
9. NOTICE: Either party may end this agreement with ____ month(s) written notice.
10. HANDOVER: At the end, the Tenant will return the Property and keys in the condition received, except normal wear.

Landlord signature: ____________________      Tenant signature: ____________________

Witness 1: Name ______________ CNIC ______________ Signature ______________
Witness 2: Name ______________ CNIC ______________ Signature ______________` },
      { id: 'token', title: 'Token money (bayana) receipt', text: `TOKEN MONEY (BAYANA) RECEIPT

I, ______________________, son/daughter/wife of ______________________, CNIC No. _______________ (the "Seller"), confirm that I have received Rs __________ (in words: ______________________________) from ______________________, CNIC No. _______________ (the "Buyer"), as token money for the sale of:

Property: ______________________________________________
Area / size: __________     Total agreed price: Rs __________

Payment received by: cash / cheque No. __________ / bank transfer ref. __________ on ____ / ____ / ______.

The balance of Rs __________ will be paid on or before ____ / ____ / ______, when the Seller will hand over the documents and complete the transfer.

If the Seller refuses to complete the sale, the Seller will return ________ the token money. If the Buyer fails to pay the balance by the date above, ______________________________.

Seller signature: ____________________      Buyer signature: ____________________

Witness 1: Name ______________ CNIC ______________ Signature ______________
Witness 2: Name ______________ CNIC ______________ Signature ______________` },
      { id: 'authority', title: 'Authority letter (documents and society office)', text: `AUTHORITY LETTER

Date: ____ / ____ / ______

To: ______________________ (society office / department)

I, ______________________, CNIC No. _______________, owner of ______________________________ (file / plot / house No. ________), authorise ______________________, CNIC No. _______________, to:

[ ] collect documents on my behalf
[ ] submit applications and pay fees on my behalf
[ ] obtain a no-dues certificate / NOC
[ ] other: ______________________________

This authority is valid until ____ / ____ / ______. It does not allow the sale, transfer or mortgage of the property.

Copies of both CNICs are attached.

Signature of owner: ____________________
Signature of authorised person: ____________________` }
    ]
  };
  function openGuides(focus) {
    closeNavMenus(); gw.pageOpen = 'guides';
    const card = openModal(`<div class="gw-page gw-guides">
      <div class="eyebrow"><span></span> FREE PROPERTY GUIDES</div><h2>Checklists and sample documents</h2>
      <p class="modal-lead">Free help for buyers, tenants, sellers and overseas Pakistanis. Use them as a starting point and have important documents checked by a lawyer.</p>
      <div class="gw-tabs" role="tablist"><button type="button" role="tab" data-gw-gtab="checklists" class="active">${DI(DIC.check, 15)} Checklists</button><button type="button" role="tab" data-gw-gtab="templates">${DI(DIC.doc, 15)} Sample documents</button></div>
      <div data-gw-gpane="checklists">${GUIDES.checklists.map((c) => `<details class="gw-acc" ${focus === c.id ? 'open' : ''}><summary>${esc(c.title)}<span>${c.items.length} steps</span></summary><ol class="gw-check">${c.items.map((t, i) => `<li><label><input type="checkbox" data-gw-tick="${esc(c.id)}-${i}"><span>${esc(t)}</span></label></li>`).join('')}</ol></details>`).join('')}</div>
      <div data-gw-gpane="templates" hidden>${GUIDES.templates.map((t) => `<details class="gw-acc"><summary>${esc(t.title)}<span>Sample format</span></summary><pre class="gw-tpl">${esc(t.text)}</pre><div class="button-row"><button type="button" class="button button-outline" data-gw="copy" data-tpl="${esc(t.id)}">${DI(GI.copy, 15)} Copy text</button><button type="button" class="button button-outline" data-gw="print-tpl" data-tpl="${esc(t.id)}">${DI(GI.print, 15)} Print</button></div></details>`).join('')}</div>
      <div class="gw-legal"><p><b>Sample formats for general guidance — not legal advice.</b> Laws, stamp paper and registration rules differ by province and change over time. Get a lawyer to check any document before you sign or pay.</p><button type="button" class="button button-primary" data-service="legal">${DI(DIC.scale, 16)} Ask RAQBO's legal team</button></div>
    </div>`, { wide: true, label: 'Property guides', onClose: () => { if (gw.pageOpen === 'guides') gw.pageOpen = ''; } });
    card.classList.add('gw-card');
    try { const ticks = JSON.parse(localStorage.getItem('raqbo-gw-ticks') || '{}'); $$('[data-gw-tick]', card).forEach((b) => { b.checked = !!ticks[b.dataset.gwTick]; }); } catch { /* ignore */ }
  }

  // ---------- Clicks and forms ----------
  document.addEventListener('click', async (e) => {
    const g = e.target.closest('[data-gw]'); if (!g) {
      const tab = e.target.closest('[data-gw-gtab]'); if (tab) { const root = tab.closest('.gw-guides'); $$('[data-gw-gtab]', root).forEach((b) => b.classList.toggle('active', b === tab)); $$('[data-gw-gpane]', root).forEach((p) => { p.hidden = p.dataset.gwGpane !== tab.dataset.gwGtab; }); return; }
      const wf = e.target.closest('[data-gw-wf]'); if (wf) { gwWanted.filter.purpose = wf.dataset.gwWf; gwPaintWanted(false); return; }
      return;
    }
    const a = g.dataset.gw; if (g.tagName === 'A') e.preventDefault();
    if (a === 'rewards') openRewards();
    else if (a === 'join') showGate('signup');
    else if (a === 'signin') showGate('signin');
    else if (a === 'invite') { requireSignIn(async () => { await gwLoadMe(); if (!gw.me) { toast(gwSetupMsg); return; } const link = refLink(gw.me.ref_code); const text = `Join me on RAQBO — Pakistan's property world in your pocket: ${link}`; if (navigator.share) { try { await navigator.share({ title: 'RAQBO', text, url: link }); return; } catch { /* fall back */ } } try { await navigator.clipboard.writeText(link); toast('Invite link copied. Share it on WhatsApp!'); } catch { openRewards(); } }); }
    else if (a === 'terms') openModal(`<div class="eyebrow"><span></span> RAQBO REWARDS</div><h2>Terms</h2><p>${gwTermsText(gw.pub || GW_DEFAULTS)}</p>`, { label: 'Rewards terms' });
    else if (a === 'copy') { const t = g.dataset.tpl ? (GUIDES.templates.find((x) => x.id === g.dataset.tpl) || {}).text : g.dataset.text; try { await navigator.clipboard.writeText(t || ''); toast('Copied.'); } catch { toast('Could not copy — select the text and copy it.'); } }
    else if (a === 'print-tpl') { const t = GUIDES.templates.find((x) => x.id === g.dataset.tpl); if (!t) return; const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(f); const d = f.contentDocument; d.open(); d.write(`<!doctype html><title>${esc(t.title)}</title><pre style="font:13px/1.7 Georgia,serif;white-space:pre-wrap;margin:24mm">${esc(t.text)}\n\n\nSample format from RAQBO (raqbo.pk). Not legal advice — have it checked by a lawyer.</pre>`); d.close(); setTimeout(() => { try { f.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => f.remove(), 2000); }, 200); }
    else if (a === 'edit-details') { const box = $('.gw-edit'); if (box) { box.hidden = !box.hidden; if (!box.hidden) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
    else if (a === 'welcome-skip') closeModal();
    else if (a === 'welcome-open') gwWelcomeModal();
    else if (a === 'del-alert') { const done = busy(g, '…'); try { await GW.delAlert(g.dataset.id); await gwLoadMe(); gwPaintRewards(); } catch (err) { done(); toast(err.message); } }
    else if (a === 'go-search') { closeModal(); scrollToResults(); }
    else if (a === 'alert') gwSaveAlert(g);
    else if (a === 'wanted') openWanted();
    else if (a === 'post-wanted') openWanted(null, true);
    else if (a === 'guides') openGuides(g.dataset.focus);
    else if (a === 'verify-admin') openAdmin('verify');
    else if (a === 'compose') gwComposeWanted();
    else if (a === 'compose-cancel') { const box = $('.gw-compose'); if (box) { box.hidden = true; box.innerHTML = ''; } }
    else if (a === 'close-wanted') { const done = busy(g, 'Closing…'); try { await GW.setWanted(g.dataset.id, 'closed'); toast('Request closed.'); gwPaintWanted(); } catch (err) { done(); toast(err.message); } }
    else if (a === 'reply-wanted') startChat({ wanted: g.dataset.id }, g);
    else if (a === 'trial') {
      const done = busy(g, 'Starting…');
      try { const until = await GW.trial(g.dataset.id); toast(`★ Your property is featured until ${fmtDay(until)}.`); await gwLoadPub(); await gwLoadMe(); renderGrid(); if ($('.modal-card') && $('[data-gw="trial"]')) openAccount(); }
      catch (err) { done(); toast(err.message); }
    }
  });
  document.addEventListener('input', (e) => { const c = e.target.closest('[data-gw-wcity]'); if (c) { gwWanted.filter.city = c.value; clearTimeout(gwWanted.t); gwWanted.t = setTimeout(() => { gwPaintWanted(false); const n = $('[data-gw-wcity]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); } });
  document.addEventListener('change', (e) => { const t = e.target.closest('[data-gw-tick]'); if (!t) return; try { const m = JSON.parse(localStorage.getItem('raqbo-gw-ticks') || '{}'); m[t.dataset.gwTick] = t.checked; localStorage.setItem('raqbo-gw-ticks', JSON.stringify(m)); } catch { /* ignore */ } });
  document.addEventListener('submit', async (e) => {
    const f = e.target; const btn = $('[type=submit]', f);
    if (f.matches('[data-gw-details]')) {
      e.preventDefault(); const type = (f.elements.type && f.elements.type.value) || ''; const city = f.elements.city.value.trim();
      if (!type) { toast('Choose what describes you best.'); return; } if (city.length < 2) { toast('Please enter your city.'); return; }
      const done = busy(btn, 'Saving…'); try { await GW.details(type, city); await gwLoadMe(); done(); toast('Saved. Thank you!'); if (gw.pageOpen === 'rewards') gwPaintRewards(); else closeModal(); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-gw-claim]')) {
      e.preventDefault(); const c = f.elements.code.value.trim(); if (!c) return; const done = busy(btn, 'Applying…');
      try { const r = await GW.claim(c); done(); toast(r === 'ok' ? 'Invite code applied.' : r === 'already' ? 'You already used an invite.' : 'Invite codes can be used within 14 days of joining.'); await gwLoadMe(); gwPaintRewards(); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-gw-founding]')) {
      e.preventDefault(); const done = busy(btn, 'Sending…'); try { await GW.redeem('founding', 0, f.elements.note.value); done(); toast('Request sent. The RAQBO team will apply your discount and confirm here.'); await gwLoadMe(); gwPaintRewards(); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-gw-redeem]')) {
      e.preventDefault(); const amt = Math.round(Number(f.elements.amount.value) || 0); const done = busy(btn, 'Sending…');
      try { await GW.redeem('credit', amt, f.elements.note.value); done(); toast('Request sent. The RAQBO team will confirm here.'); await gwLoadMe(); gwPaintRewards(); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-gw-wanted-form]')) {
      e.preventDefault(); const v = (n) => (f.elements[n].value || '').trim();
      const errs = []; if (v('city').length < 2) errs.push(['city', 'Please enter the city.']);
      if (v('max_budget') && !(+v('max_budget') > 0)) errs.push(['max_budget', 'Enter the budget in rupees, e.g. 25000000.']);
      if (showErrors(f, errs)) return;
      const row = { purpose: v('purpose'), property_type: v('property_type'), city: v('city').replace(/\b\w/g, (m) => m.toUpperCase()), area: v('area'), max_budget: v('max_budget') ? Math.round(+v('max_budget')) : null, min_size: v('min_size') ? +v('min_size') : null, size_unit: v('min_size') ? v('size_unit') : null, details: v('details'), ...v3wRowExtra(f) };
      const done = busy(btn, 'Posting…');
      try { const w = await GW.postWanted(row); done(); toast('Your request is live. Matching owners will be notified.'); const box = $('.gw-compose'); if (box) { box.hidden = true; box.innerHTML = ''; } gwWanted.focus = w && w.id; gwPaintWanted(); }
      catch (err) { done(); toast(err.message); }
    }
  });
  // Hash links: #rewards, #wanted, #wanted/<id>, #guides
  function gwRoute(h) {
    let m;
    if (typeof dlRoute === 'function' && dlRoute(h)) return true;
    if (typeof auRoute === 'function' && auRoute(h)) return true;
    if (h === '#rewards') openRewards();
    else if ((m = h.match(/^#wanted(?:\/(.+))?$/))) openWanted(m[1] ? decodeURIComponent(m[1]) : null);
    else if (h === '#guides') openGuides();
    else if (h === '#admin/growth') openAdmin('growth');
    else if (h === '#admin/verify') openAdmin('verify');
    else if (/^#my(\/|$)/.test(h)) openMy(h.split('/')[1] || 'overview');
    else return false;
    return true;
  }
  window.addEventListener('hashchange', (e) => { let h = location.hash; try { h = new URL(e.newURL).hash || h; } catch { /* ignore */ } if (gwRoute(h)) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } } });

  // ---------- Admin → Growth & rewards ----------
  function gwAdminHTML() {
    const d = gw.admin; if (!d) { gwAdminLoad(); return '<div class="admin-empty">Loading…</div>'; }
    if (d.error) return `<div class="admin-empty">${esc(d.error)}<br><br><button type="button" class="admin-refresh" data-gwa="reload">Try again</button></div>`;
    const s = d.settings || {}; const t = d.stats || {}; const used = (t.credit_issued || 0) + (t.credit_pending || 0); const bp = s.budget_total ? Math.min(100, Math.round((used / s.budget_total) * 100)) : 0;
    const KIND = { referral_member: 'Referral: member joined', referral_owner: 'Referral: listing approved', redemption: 'Use credit', founding_discount: 'Founding discount', bonus: 'Bonus' };
    const kpi = (label, val, sub) => `<div class="gwa-kpi"><small>${esc(label)}</small><b>${esc(val)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
    const chk = (k, label) => `<label class="gwa-chk"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}> ${esc(label)}</label>`;
    const num = (k, label, min = 0) => `<label><span>${esc(label)}</span><input type="number" name="${k}" min="${min}" value="${esc(s[k] ?? '')}"></label>`;
    const txt = (k, label, max) => `<label class="wide"><span>${esc(label)}</span><input name="${k}" maxlength="${max}" value="${esc(s[k] ?? '')}"></label>`;
    return `<div class="gwa">
      <div class="admin-head-row"><div><h2>Growth &amp; rewards</h2><p class="admin-sub">Founding Members, Refer &amp; Earn, offers and Property Wanted. Every amount below can be changed here — no code changes needed.</p></div><button type="button" class="admin-refresh" data-gwa="reload">${DI(DIC.trend, 15)} Refresh</button></div>
      <div class="gwa-kpis">
        ${kpi('Founding members', `${(t.founding || 0).toLocaleString('en-US')} / ${(s.founding_cap || 0).toLocaleString('en-US')}`, `${Math.max(0, (s.founding_cap || 0) - (t.founding || 0)).toLocaleString('en-US')} places left`)}
        ${kpi('Joined with an invite', (t.referred || 0).toLocaleString('en-US'), `${t.referred_active || 0} active · ${t.owner_rewards || 0} listings approved`)}
        ${kpi('Credit approved', rs(t.credit_issued), `${rs(t.credit_pending)} waiting · ${rs(t.credit_used)} used`)}
        ${kpi('Campaign budget used', bp + '%', `${rs(used)} of ${rs(s.budget_total)}`)}
        ${kpi('Property alerts', (t.alerts || 0).toLocaleString('en-US'), 'saved searches')}
        ${kpi('Property Wanted', (t.wanted || 0).toLocaleString('en-US'), `${t.featured || 0} featured listings now`)}
      </div>
      <div class="gwa-budget"><i style="width:${Math.max(1, bp)}%" class="${bp >= 90 ? 'hot' : ''}"></i></div>

      <section class="gwa-sec"><h3>Waiting for your approval <span class="admin-count">${(d.queue || []).length}</span></h3>
        ${(d.queue || []).length ? `<div class="gwa-queue">${d.queue.map((q) => `<div class="gwa-q" data-qid="${esc(q.id)}">
          <div><b>${esc(KIND[q.kind] || q.kind)}</b> · ${esc(q.user || '')}${q.founding_no ? ` <span class="gw-fchip">#${esc(q.founding_no)}</span>` : ''}<small>${esc(fmtDay(q.at))}${q.who ? ` · invited: ${esc(q.who)}${q.who_verified === false ? ' (not verified)' : ''}${q.who_phone ? ' · ' + esc(q.who_phone) : ''}` : ''}${q.listing ? ' · listing ' + esc(q.listing) : ''}${q.note ? ' · for: ' + esc(q.note) : ''}${q.admin_note ? ' · ' + esc(q.admin_note) : ''}</small>
            <small>${q.kind === 'redemption' ? `Wants to use ${esc(rs(-q.amount))} · has ${esc(rs(q.available))} credit` : q.kind === 'founding_discount' ? `${esc(s.founding_discount_pct)}% off up to ${esc(rs(s.founding_discount_max))}` : `Reward ${esc(rs(q.amount))}`}</small></div>
          <input class="gwa-note" placeholder="Note to member (optional)" maxlength="300" aria-label="Note">
          <div class="gwa-q-act"><button type="button" class="button button-primary" data-gwa="approve" data-id="${esc(q.id)}">${q.kind === 'redemption' || q.kind === 'founding_discount' ? 'Applied' : 'Approve'}</button><button type="button" class="button button-outline" data-gwa="reject" data-id="${esc(q.id)}">Reject</button></div>
        </div>`).join('')}</div>` : '<div class="admin-empty sm">Nothing waiting. New rewards and credit requests appear here live.</div>'}
        <p class="admin-sub">Before approving a referral, check the invited member is a real person (verified phone, real activity). For “use credit” and “founding discount”, apply the discount on the service or order first, then press <b>Applied</b>.</p>
      </section>

      <section class="gwa-sec"><h3>Campaign settings</h3>
        <form class="gwa-form" data-gwa-settings>
          <fieldset><legend>Home page banner</legend>${chk('campaign_on', 'Show the campaign banner on the home page')}${txt('campaign_title', 'Headline', 120)}${txt('campaign_tagline', 'Tagline', 160)}${txt('campaign_cta', 'Call to action', 160)}</fieldset>
          <fieldset><legend>Founding Members Club</legend>${chk('founding_enabled', 'Give new verified members a Founding Member number')}${num('founding_cap', 'Number of founding places')}${num('founding_discount_pct', 'Discount on first paid service (%)')}${num('founding_discount_max', 'Maximum discount (Rs)')}</fieldset>
          <fieldset><legend>Refer &amp; Earn</legend>${chk('referral_enabled', 'Referral rewards switched on')}${chk('referral_review', 'Admin approves each reward before it can be used (recommended)')}${num('referral_member_credit', 'Credit per active member (Rs)')}${num('referral_owner_credit', 'Credit per approved listing (Rs)')}${num('referral_monthly_cap', 'Rewards per member per month')}${num('credit_expiry_days', 'Credit expires after (days, 0 = never)')}</fieldset>
          <fieldset><legend>Featured listing trial</legend>${chk('featured_trial_enabled', 'New advertisers can feature one property free')}${num('featured_trial_days', 'Trial length (days)', 1)}</fieldset>
          <fieldset><legend>RAQBO Verified listings</legend>${chk('verification_enabled', 'Show Verified / Unverified badges and let owners apply')}${num('verification_fee', 'Verification fee (Rs, 0 = free)')}<p class="admin-sub">Requests are checked in Properties → RAQBO Verified requests.</p></fieldset>
          <fieldset><legend>Pilot and budget</legend><label class="wide"><span>Pilot cities (comma-separated; empty = all of Pakistan)</span><input name="pilot_cities" value="${esc((s.pilot_cities || []).join(', '))}" placeholder="e.g. Lahore"></label>${num('budget_total', 'Campaign budget for reward credit (Rs)')}<p class="admin-sub">When approved + waiting credit reaches the budget, new rewards wait for your review instead of being approved.</p></fieldset>
          <div class="button-row"><button type="submit" class="button button-primary">Save settings</button></div>
        </form>
      </section>

      <section class="gwa-sec"><h3>Offers for member types</h3>
        <div class="gwa-offers">${(d.offers || []).map((o) => `<div class="gwa-offer ${o.active ? '' : 'off'}"><div><b>${esc(o.title)}</b>${o.badge ? ` <em>${esc(o.badge)}</em>` : ''}<small>${esc((o.audience || []).length ? o.audience.map(typeName).join(', ') : 'Everyone')}${(o.cities || []).length ? ' · ' + esc(o.cities.join(', ')) : ''}${o.active ? '' : ' · hidden'}</small><p>${esc(o.body)}</p></div><div class="gwa-q-act"><button type="button" class="button button-outline" data-gwa="edit-offer" data-id="${esc(o.id)}">Edit</button><button type="button" class="button button-outline" data-gwa="toggle-offer" data-id="${esc(o.id)}">${o.active ? 'Hide' : 'Show'}</button></div></div>`).join('') || '<div class="admin-empty sm">No offers yet.</div>'}</div>
        <form class="gwa-form gwa-offer-form" data-gwa-offer><input type="hidden" name="id">
          <fieldset><legend>Add or edit an offer</legend>
            <label class="wide"><span>Title</span><input name="title" maxlength="100" required></label>
            <label class="wide"><span>Description</span><textarea name="body" maxlength="500" rows="2"></textarea></label>
            <label><span>Badge (e.g. 20% off)</span><input name="badge" maxlength="30"></label>
            <label><span>Cities (comma-separated, empty = all)</span><input name="cities"></label>
            <div class="wide gwa-aud"><span>Show to (none ticked = everyone)</span>${MEMBER_TYPES.map(([k, t2]) => `<label class="gwa-chk"><input type="checkbox" name="aud" value="${k}"> ${esc(t2)}</label>`).join('')}</div>
            <label class="gwa-chk"><input type="checkbox" name="active" checked> Show on the website</label>
          </fieldset>
          <div class="button-row"><button type="submit" class="button button-primary">Save offer</button><button type="reset" class="button button-outline">Clear</button></div>
        </form>
      </section>

      <section class="gwa-sec"><h3>Feature a property</h3>
        <form class="gwa-inline" data-gwa-feature><input name="ref" placeholder="Property reference, e.g. RQ-LST-1A2B3C4D" aria-label="Property reference"><input name="days" type="number" min="0" value="7" aria-label="Days"><button type="submit" class="button button-primary">Feature</button></form>
        <p class="admin-sub">Featured properties show first in the list with a SPONSORED label. Enter 0 days to remove.</p>
      </section>

      <section class="gwa-sec"><h3>Property Wanted requests</h3>
        ${(d.wanted || []).length ? `<div class="gwa-queue">${d.wanted.slice(0, 30).map((w) => `<div class="gwa-q"><div><b>${esc(w.property_type)} to ${esc(w.purpose)} · ${esc(w.city)}${w.area ? ', ' + esc(w.area) : ''}</b><small>${esc(w.ref)} · ${esc(w.poster_name)} · ${esc(fmtDay(w.created_at))} · ${esc(w.status)}${w.max_budget ? ' · up to ' + esc(fmtPrice(w.max_budget)) : ''}</small>${w.details ? `<small>${esc(w.details)}</small>` : ''}</div><div class="gwa-q-act">${w.status === 'hidden' ? `<button type="button" class="button button-outline" data-gwa="show-wanted" data-id="${esc(w.id)}">Show</button>` : w.status === 'published' ? `<button type="button" class="button button-outline" data-gwa="hide-wanted" data-id="${esc(w.id)}">Hide</button>` : ''}</div></div>`).join('')}</div>` : '<div class="admin-empty sm">No requests yet.</div>'}
      </section>

      <div class="gwa-two">
        <section class="gwa-sec"><h3>Top referrers</h3>${(d.top || []).length ? `<table class="gw-table"><thead><tr><th>Member</th><th>Invited</th><th>Rewarded</th></tr></thead><tbody>${d.top.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.invited)}</td><td>${esc(r.rewarded)}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">No referrals yet.</div>'}</section>
        <section class="gwa-sec"><h3>Members by type</h3>${Object.keys(t.types || {}).length ? `<table class="gw-table"><tbody>${Object.entries(t.types).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(typeName(k) || 'Not set')}</td><td>${esc(n)}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">No data yet.</div>'}</section>
      </div>
      <section class="gwa-sec"><h3>Recent decisions</h3>${(d.recent || []).length ? `<table class="gw-table"><thead><tr><th>Date</th><th>Member</th><th>What</th><th>Amount</th><th>Result</th></tr></thead><tbody>${d.recent.map((r) => `<tr><td>${esc(fmtDay(r.at))}</td><td>${esc(r.user || '')}</td><td>${esc(KIND[r.kind] || r.kind)}</td><td>${r.amount ? esc(rs(Math.abs(r.amount))) : '—'}</td><td>${esc(r.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="admin-empty sm">Nothing yet.</div>'}</section>
    </div>`;
  }
  async function gwAdminLoad() {
    if (gw.adminLoading) return; gw.adminLoading = true;
    gw.loadedAt = Date.now();
    try { gw.admin = await GW.admin(); } catch (err) { gw.admin = { error: err.message }; }
    gw.adminLoading = false;
    if (admin.el && !admin.el.hidden) { if (admin.tab === 'growth') { const body = ($('.ax-body', admin.el) || $('.admin-content', admin.el)); const y = admin.el.scrollTop; if (body) { body.innerHTML = gwAdminHTML(); admin.el.scrollTop = y; } else renderAdmin(); } const cnt = $('[data-tab="growth"] .admin-count', admin.el); if (cnt) cnt.textContent = gwPendingCount(); }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-gwa]'); if (!b) return; const a = b.dataset.gwa; const d = gw.admin || {};
    if (a === 'reload') { gw.admin = null; gwAdminLoad(); return; }
    if (a === 'approve' || a === 'reject') { const row = b.closest('.gwa-q'); const note = $('.gwa-note', row) ? $('.gwa-note', row).value : ''; const done = busy(b, '…'); try { await GW.decide(Number(b.dataset.id) || b.dataset.id, a === 'approve', note); toast(a === 'approve' ? 'Done — the member has been notified.' : 'Rejected — the member has been notified.'); gwAdminLoad(); } catch (err) { done(); toast(err.message); } return; }
    if (a === 'edit-offer') { const o = (d.offers || []).find((x) => String(x.id) === b.dataset.id); const f = $('[data-gwa-offer]'); if (!o || !f) return; f.elements.id.value = o.id; f.elements.title.value = o.title; f.elements.body.value = o.body || ''; f.elements.badge.value = o.badge || ''; f.elements.cities.value = (o.cities || []).join(', '); $$('[name=aud]', f).forEach((c) => { c.checked = (o.audience || []).includes(c.value); }); f.elements.active.checked = o.active !== false; f.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (a === 'toggle-offer') { const o = (d.offers || []).find((x) => String(x.id) === b.dataset.id); if (!o) return; const done = busy(b, '…'); try { await GW.saveOffer({ ...o, active: !o.active }); gwAdminLoad(); } catch (err) { done(); toast(err.message); } return; }
    if (a === 'hide-wanted' || a === 'show-wanted') { const done = busy(b, '…'); try { await GW.setWanted(b.dataset.id, a === 'hide-wanted' ? 'hidden' : 'published'); gwAdminLoad(); } catch (err) { done(); toast(err.message); } }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target; const btn = $('[type=submit]', f);
    if (f.matches('[data-gwa-settings]')) {
      e.preventDefault(); const p = {}; const s = (gw.admin && gw.admin.settings) || {};
      ['campaign_on', 'founding_enabled', 'referral_enabled', 'referral_review', 'featured_trial_enabled', 'verification_enabled'].forEach((k) => { p[k] = !!f.elements[k].checked; });
      ['campaign_title', 'campaign_tagline', 'campaign_cta'].forEach((k) => { p[k] = f.elements[k].value.trim(); });
      ['founding_cap', 'founding_discount_pct', 'founding_discount_max', 'referral_member_credit', 'referral_owner_credit', 'referral_monthly_cap', 'credit_expiry_days', 'featured_trial_days', 'budget_total', 'verification_fee'].forEach((k) => { const v = f.elements[k].value; if (v !== '') p[k] = Math.max(0, Math.round(Number(v) || 0)); });
      if (p.founding_discount_pct > 100) { toast('The discount cannot be more than 100%.'); return; }
      if (p.founding_cap < (gw.admin.stats.founding || 0)) { toast(`There are already ${gw.admin.stats.founding} Founding Members — the number of places cannot be lower.`); return; }
      p.pilot_cities = f.elements.pilot_cities.value.split(',').map((x) => x.trim()).filter(Boolean);
      const done = busy(btn, 'Saving…'); try { await GW.saveSettings(p); done(); toast('Settings saved — the website updates now.'); gw.admin = null; gwAdminLoad(); gwLoadPub(); } catch (err) { done(); toast(err.message); }
      void s;
    } else if (f.matches('[data-gwa-offer]')) {
      e.preventDefault(); if (f.elements.title.value.trim().length < 3) { toast('Please enter a title.'); return; }
      const p = { id: f.elements.id.value || null, title: f.elements.title.value.trim(), body: f.elements.body.value.trim(), badge: f.elements.badge.value.trim(), cities: f.elements.cities.value.split(',').map((x) => x.trim()).filter(Boolean), audience: $$('[name=aud]:checked', f).map((c) => c.value), active: f.elements.active.checked };
      const done = busy(btn, 'Saving…'); try { await GW.saveOffer(p); done(); toast('Offer saved.'); f.reset(); f.elements.id.value = ''; gw.offers = null; gwAdminLoad(); } catch (err) { done(); toast(err.message); }
    } else if (f.matches('[data-gwa-feature]')) {
      e.preventDefault(); const ref = f.elements.ref.value.trim().toUpperCase(); const l = db.listings.find((x) => (x.ref || '').toUpperCase() === ref || x.id === f.elements.ref.value.trim());
      if (!l) { toast('No property found with that reference.'); return; } if (l.status !== 'published') { toast('Only published properties can be featured.'); return; }
      const days = Math.max(0, Math.round(Number(f.elements.days.value) || 0)); const done = busy(btn, 'Saving…');
      try { await GW.feature(l.id, days); done(); toast(days ? `★ ${l.title} is featured for ${days} days.` : 'Feature removed.'); f.reset(); await gwLoadPub(); renderGrid(); gwAdminLoad(); } catch (err) { done(); toast(err.message); }
    }
  });

