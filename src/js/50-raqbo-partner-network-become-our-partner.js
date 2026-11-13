  /* =====================================================================
     RAQBO PARTNER NETWORK — Become Our Partner, Grow With RAQBO
     Local expertise + RAQBO's platform, under a transparent arrangement.

     Website:  Become a RAQBO Partner · Partnership opportunities ·
               How partnership works · Apply · Find a RAQBO Partner ·
               Check a partner by QR
     Member:   the partner dashboard (territory, properties, customers,
               leads, transactions, earnings, performance, training)
     Admin:    RAQBO Partner Network Management
     ===================================================================== */

  const PN_CAT = {
    associate: {
      name: 'RAQBO Associate Partner',
      short: 'Introduce customers, earn a referral share',
      who: 'For individuals who can introduce buyers, sellers, landlords, tenants or other genuine customers — property dealers, local professionals and people with property-market contacts.',
      office: 'No RAQBO-branded office needed.',
      earn: 'A referral commission when a qualifying transaction is completed and RAQBO has actually received its fee.',
      icon: 'user'
    },
    area: {
      name: 'RAQBO Area Partner',
      short: 'Represent RAQBO in your own area',
      who: 'A local individual, sole proprietor, AOP, firm or company associated with RAQBO for a specified geographical area. This is RAQBO’s principal partnership category in the first stage.',
      office: 'An office helps but is not required at the start.',
      earn: 'A share of the service fee: a larger share where the partner originated and substantially handled the work, a smaller share where RAQBO passed the customer on.',
      icon: 'pin'
    },
    franchise: {
      name: 'RAQBO Franchise Partner',
      short: 'An approved RAQBO office under full branding',
      who: 'For established, capable and financially sound property businesses. The franchisee may run an approved office under RAQBO branding within an agreed territory.',
      office: 'A RAQBO-branded office to agreed standards.',
      earn: 'Individually negotiated, with a larger share possible where the franchisee carries substantial local costs.',
      icon: 'store'
    }
  };

  // What an Area Partner may be authorised to do
  const PN_WORK = [
    ['listing', 'Property listing and marketing'],
    ['find', 'Finding sellers and buyers'],
    ['rent', 'Property rental and leasing'],
    ['inspection', 'Arranging property inspections'],
    ['market', 'Local market assessment'],
    ['documents', 'Facilitating document collection'],
    ['verify', 'Coordinating property verification'],
    ['enquiries', 'Handling local customer enquiries'],
    ['management', 'Facilitating property-management services'],
    ['quicksell', 'Assisting with QuickSell opportunities'],
    ['auction', 'Marketing authorised auction notices'],
    ['connect', 'Connecting owners with RAQBO’s approved services']
  ];
  const PN_WORK_NAME = Object.fromEntries(PN_WORK);

  const PN_FRANCHISE_NEEDS = ['Formal franchise agreement', 'Brand-use permission', 'Specified geographical territory',
    'Office and staffing standards', 'Training and operating procedures', 'Approved marketing practices',
    'Financial and commission arrangements', 'Performance obligations', 'Quality-control and reporting requirements'];

  const PN_LEVEL = { province: 'Province', division: 'Division', district: 'District', tehsil: 'Tehsil', city: 'City',
    town: 'Town', society: 'Housing society', commercial_area: 'Commercial area', locality: 'Locality or boundary' };
  const PN_TSTATUS = { available: 'Available', under_review: 'Applications under review', appointed: 'Partner appointed',
    additional_allowed: 'Additional partners permitted', suspended: 'Temporarily suspended', reserved: 'Reserved by RAQBO' };
  const PN_BIZ = { individual: 'Individual', sole_proprietor: 'Sole proprietor', aop: 'Partnership / AOP',
    private_limited: 'Private limited company', agency: 'Existing real estate agency', other_registered: 'Other registered business' };
  const PN_PSTATUS = { under_review: 'Under review', probation: 'Probation', active: 'Active', suspended: 'Temporarily suspended', terminated: 'Terminated' };
  const PN_STEPS = [
    ['submitted', 'Application submitted'], ['preliminary_review', 'Preliminary review'],
    ['verification', 'Identity & business verification'], ['interview', 'Interview'],
    ['territory_assessment', 'Territory assessment'], ['commercial_terms', 'Commercial terms'],
    ['agreement', 'Agreement'], ['training', 'Training'], ['activated', 'Activation']
  ];
  const PN_ASSESS = [['reputation', 'Reputation'], ['experience', 'Local market experience'], ['competence', 'Professional competence'],
    ['customers', 'Existing customer base'], ['compliance', 'Legal and tax compliance'], ['capacity', 'Financial and operational capacity'],
    ['communication', 'Communication skills'], ['premises', 'Office and staff'], ['standards', 'Ability to follow RAQBO standards']];
  const PN_AGREEMENT_ITEMS = [
    ['parties', 'Legal identity of the parties'], ['relationship', 'Nature of the business relationship'],
    ['services', 'Services the partner may provide'], ['territory_text', 'Allocated geographical territory'],
    ['exclusivity', 'Exclusive or non-exclusive'], ['renewal', 'Duration and renewal'],
    ['commission_text', 'Commission and revenue-sharing formula'], ['lead_allocation', 'Allocation of leads and transactions'],
    ['local_expenses', 'Responsibility for local operating expenses'], ['brand_use', 'Brand and trademark usage'],
    ['data_protection', 'Customer-data protection'], ['reporting', 'Reporting and performance requirements'],
    ['restrictions', 'Restrictions on unauthorised commitments'], ['disputes', 'Dispute-resolution procedure'],
    ['termination', 'Termination, suspension and default'], ['after_termination', 'Ongoing transactions after termination']
  ];
  const PN_LEAD_STEPS = [['new', 'New lead'], ['raqbo_review', 'RAQBO review'], ['assigned', 'Partner assignment'],
    ['accepted', 'Partner acceptance'], ['contacted', 'Customer contact'], ['site_visit', 'Site visit / service'],
    ['negotiation', 'Negotiation'], ['completed', 'Transaction completion']];
  const PN_TRAIN_FALLBACK = [
    ['intro', 'Introduction to RAQBO services'], ['listing', 'Property listing standards'], ['customer', 'Customer communication'],
    ['verify', 'Buyer and seller verification'], ['documents', 'Document handling'], ['quicksell', 'The QuickSell process'],
    ['auctions', 'Property auction procedures'], ['leads', 'The lead management system'], ['commission', 'Commission structure'],
    ['privacy', 'Customer privacy'], ['fraud', 'Fraud prevention'], ['complaints', 'Complaint handling'], ['conduct', 'Professional conduct']];

  const PN_PHASES = [
    ['Phase 1 — Punjab pilot', 'A small number of carefully chosen partners in Lahore, Gujranwala, Faisalabad, Multan, Sialkot and Rawalpindi/Islamabad, run for about 90 days and then assessed.'],
    ['Phase 2 — Across Punjab', 'More districts and localities, based on demand, proven capacity and trustworthy applicants.'],
    ['Phase 3 — Other provinces', 'Karachi, Hyderabad, Peshawar, Quetta and other cities, observing each place’s own requirements.'],
    ['Phase 4 — Franchising', 'Properly structured RAQBO franchises in selected territories, once the operating model is settled.']
  ];

  const PN_NOTE_MONEY = 'Commission is a share of the service fee RAQBO actually receives. It is never a share of the property price, and no income is guaranteed.';
  const PN_NOTE_RIGHTS = 'Sending this application does not by itself give you any partnership right. An appointment follows verification, approval and a signed agreement.';

  const pn = { pub: null, at: 0, mine: null, dash: null, dashAt: 0, admin: null, adminAt: 0, adminBusy: false,
    dir: null, dirQ: { province: '', city: '', area: '', service: '', q: '' }, check: null, busy: false, tab: 'leads' };

  const pnMe = () => (db.session && db.session.userId) || 'demo-user';
  const pnErr = (e) => new Error((e && (e.message || e.msg)) || 'Something went wrong. Please try again.');
  const pnRpc = async (fn, args) => { const { data, error } = await SB.rpc(fn, args || {}); if (error) throw pnErr(error); return data; };
  const pnMoney = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-PK');
  const pnDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  // ---------------------------------------------------------------
  // Talking to the database (or, with no database, a demo on this browser)
  // ---------------------------------------------------------------
  const PN = SB ? {
    pub: () => pnRpc('pn_public'),
    territories: (prov, city) => pnRpc('pn_territories_open', { p_province: prov || '', p_city: city || '' }),
    apply: (p) => pnRpc('pn_apply', { p }),
    mine: () => pnRpc('pn_my_application'),
    directory: (q) => pnRpc('pn_directory', { p_province: q.province || '', p_city: q.city || '', p_area: q.area || '', p_service: q.service || '', p_q: q.q || '' }),
    verify: (token) => pnRpc('pn_verify_qr', { p_token: token }),
    dashboard: () => pnRpc('pn_dashboard'),
    statement: (from, to) => pnRpc('pn_statement', { p_from: from, p_to: to }),
    accept: (ref) => pnRpc('pn_lead_accept', { p_ref: ref }),
    decline: (ref, why) => pnRpc('pn_lead_decline', { p_ref: ref, p_reason: why || '' }),
    stage: (ref, st, note) => pnRpc('pn_lead_stage', { p_ref: ref, p_stage: st, p_note: note || '' }),
    train: (code) => pnRpc('pn_training_complete', { p_code: code }),
    saveProfile: (p) => pnRpc('pn_profile_save', { p }),
    quicksell: (p) => pnRpc('pn_quicksell', { p }),
    dispute: (ref, why) => pnRpc('pn_commission_dispute', { p_ref: ref, p_reason: why }),
    claim: (id, ok, note) => pnRpc('pn_claim_listing', { p_listing: id, p_authorised: !!ok, p_note: note || '' }),
    dupes: (city, area, size, price) => pnRpc('pn_duplicate_check', { p_city: city || '', p_area: area || '', p_size: size || null, p_price: price || null }),
    // admin
    admin: (what) => pnRpc('pn_admin', { p_what: what || 'summary' }),
    appStage: (id, st, note) => pnRpc('pn_app_stage', { p_id: id, p_stage: st, p_note: note || '' }),
    appReview: (p) => pnRpc('pn_app_review', { p }),
    appApprove: (id, cat, desig) => pnRpc('pn_app_approve', { p_id: id, p_category: cat, p_designation: desig || '' }),
    setStatus: (pid, st, note) => pnRpc('pn_partner_status', { p_partner_id: pid, p_status: st, p_note: note || '' }),
    setPowers: (pid, p) => pnRpc('pn_partner_powers', { p_partner_id: pid, p }),
    saveTerritory: (p) => pnRpc('pn_territory_save', { p }),
    assign: (pid, tid, ex) => pnRpc('pn_territory_assign', { p_partner_id: pid, p_territory: tid, p_exclusive: !!ex }),
    unassign: (pid, tid) => pnRpc('pn_territory_remove', { p_partner_id: pid, p_territory: tid }),
    saveAgreement: (p) => pnRpc('pn_agreement_save', { p }),
    newLead: (p) => pnRpc('pn_lead_create', { p }),
    assignLead: (ref, pid) => pnRpc('pn_lead_assign', { p_ref: ref, p_partner_id: pid }),
    returnLead: (ref, note) => pnRpc('pn_lead_return', { p_ref: ref, p_note: note || '' }),
    takeLead: (ref) => pnRpc('pn_lead_take', { p_ref: ref }),
    saveTx: (p) => pnRpc('pn_tx_save', { p }),
    cmStatus: (ref, st, note) => pnRpc('pn_commission_status', { p_ref: ref, p_status: st, p_note: note || '' }),
    buildPayout: (pid, from, to) => pnRpc('pn_payout_build', { p_partner_id: pid, p_from: from, p_to: to }),
    payoutStatus: (ref, st, method, reference) => pnRpc('pn_payout_status', { p_ref: ref, p_status: st, p_method: method || 'bank', p_reference: reference || '' }),
    setPhoto: (pid, path) => pnRpc('pn_set_photo', { p_partner: pid || null, p_path: path || '' }),
    addFeedback: (p) => pnRpc('pn_add_feedback', { p }),
    addDoc: (p) => pnRpc('pn_doc_add', { p }),
    rating: (pid) => pnRpc('pn_rating', { p_partner: pid }),
    takedown: (id, why) => pnRpc('pn_takedown_listing', { p_listing: id, p_reason: why }),
    saveSettings: (p) => pnRpc('pn_save_settings', { p }),
    saveRate: (p) => pnRpc('pn_save_rate', { p }),
    run: () => pnRpc('pn_run')
  } : (() => {
    // Demo: everything lives in this browser only, so the pages can be seen
    // and tried without a database behind them.
    const g = (k, d) => store.get('pn.' + k, d); const s = (k, v) => store.set('pn.' + k, v);
    const need = (c, m) => { if (!c) throw new Error(m); };
    const rid = (p) => p + Math.random().toString(36).slice(2, 9).toUpperCase();
    const seedRates = () => g('rates', [
      { id: 'r1', category: 'associate', service: 'any', lead_source: 'any', partner_pct: 17.5, active: true, note: 'Referral commission — illustrative' },
      { id: 'r2', category: 'area', service: 'any', lead_source: 'partner', partner_pct: 40, active: true, note: 'Partner originated — illustrative' },
      { id: 'r3', category: 'area', service: 'any', lead_source: 'raqbo', partner_pct: 25, active: true, note: 'RAQBO originated — illustrative' },
      { id: 'r4', category: 'franchise', service: 'any', lead_source: 'any', partner_pct: 50, active: true, note: 'Negotiated — illustrative' }]);
    const seedSettings = () => g('settings', { network_open: true, lead_accept_hours: 24, lead_contact_hours: 48,
      directory_public: true, franchise_open: false, pilot_note: '', intro_note: '' });
    const myPartner = () => g('partners', []).find((p) => p.user_id === pnMe()) || null;
    const rateFor = (cat, service, source) => {
      const list = seedRates().filter((r) => r.active && r.category === cat
        && (r.service === service || r.service === 'any') && (r.lead_source === source || r.lead_source === 'any'));
      list.sort((a, b) => (b.service !== 'any') - (a.service !== 'any') || (b.lead_source !== 'any') - (a.lead_source !== 'any'));
      return list[0] || null;
    };
    return {
      async setPhoto(pid, path) {
        const list = g('partners', []); const me = myPartner();
        const row = pid ? list.find((x) => x.id === pid) : me;
        need(row, 'No partner account.');
        need(!pid || (me && row.id === me.id) || db.isAdmin, 'Only the partner, or RAQBO staff, may change this photograph.');
        need(!path || /^[A-Za-z0-9/._-]{3,400}$/.test(path), 'That does not look like a stored file.');
        row.photo_path = path || ''; s('partners', list);
      },
      async addDoc() { return 'demo-doc'; },
      async addFeedback(p) {
        need(db.isAdmin, 'Only RAQBO staff may record customer feedback.');
        const me = myPartner();
        need(!me || me.id !== p.partner_id, 'A partner cannot record feedback about themselves.');
        need(p.rating >= 1 && p.rating <= 5, 'Give a rating from 1 to 5.');
        const list = g('feedback', []);
        need(!p.lead_id || !list.some((f) => f.lead_id === p.lead_id), 'This job has already been rated.');
        list.unshift({ id: rid('F'), partner_id: p.partner_id, lead_id: p.lead_id || null, rating: +p.rating,
          comment: p.comment || '', customer: p.customer || '', created_at: new Date().toISOString() });
        s('feedback', list); return list[0].id;
      },
      async rating(pid) {
        const rows = g('feedback', []).filter((f) => f.partner_id === pid);
        return { count: rows.length, average: rows.length ? Math.round((rows.reduce((a, b) => a + b.rating, 0) / rows.length) * 10) / 10 : null,
          five: rows.filter((f) => f.rating === 5).length, low: rows.filter((f) => f.rating <= 2).length };
      },
      async takedown(id, why) {
        need(String(why || '').trim(), 'Say why the listing is being removed.');
        need(db.isAdmin, 'You do not have permission to remove a listing.');
        const l = db.listings.find((x) => x.id === id); need(l, 'That listing no longer exists.');
        l.status = 'rejected'; l.reviewNote = String(why).trim();
        l.takedownReason = String(why).trim(); l.takedownAt = new Date().toISOString();
      },
      async pub() {
        return { settings: seedSettings(), rates: seedRates(),
          training: PN_TRAIN_FALLBACK.map(([code, title]) => ({ code, title, body: '', required: true })),
          partners_live: g('partners', []).filter((p) => ['active', 'probation'].includes(p.status) && p.listed !== false).length,
          cities: [...new Set(g('territories', []).map((t) => t.city).filter(Boolean))],
          territories_open: g('territories', []).filter((t) => ['available', 'additional_allowed'].includes(t.status)).length };
      },
      async territories(prov, city) {
        return g('territories', []).filter((t) => (!prov || t.province === prov) && (!city || t.city === city))
          .map((t) => ({ ...t, taken: g('partner_terr', []).filter((x) => x.territory_id === t.id).length }));
      },
      async apply(p) {
        need(seedSettings().network_open, 'RAQBO is not accepting partner applications at the moment.');
        need(p.declared, 'Please confirm the declaration. An application does not by itself grant any partnership right.');
        need(String(p.full_name || '').trim().length >= 3, 'Enter your full name.');
        need(String(p.phone || '').trim().length >= 7, 'Enter a mobile number RAQBO can reach you on.');
        const all = g('applications', []);
        need(!all.some((a) => a.user_id === pnMe() && !['rejected', 'withdrawn'].includes(a.stage)),
          'You already have an application with RAQBO. Please follow it in My RAQBO instead of sending another.');
        const row = { ...p, id: rid('app'), ref: rid('RQ-PA-'), user_id: pnMe(), stage: 'submitted', stage_note: '',
          cnic_last4: String(p.cnic || '').replace(/\D/g, '').slice(-4), created_at: new Date().toISOString() };
        delete row.cnic;
        all.unshift(row); s('applications', all); return row.ref;
      },
      async mine() { return g('applications', []).find((a) => a.user_id === pnMe()) || null; },
      async directory(q) {
        if (!seedSettings().directory_public) return [];
        const terr = g('partner_terr', []); const tt = g('territories', []);
        return g('partners', []).filter((p) => p.listed !== false && ['active', 'probation'].includes(p.status))
          .map((p) => { const mine = terr.filter((x) => x.partner_id === p.id).map((x) => tt.find((t) => t.id === x.territory_id)).filter(Boolean);
            return { ...p, territories: mine.map((t) => ({ name: t.name, level: t.level, city: t.city })),
              city: [...new Set(mine.map((t) => t.city).filter(Boolean))].join(', '),
              province: [...new Set(mine.map((t) => t.province).filter(Boolean))].join(', '),
              verified: p.status === 'active' && !!p.agreement_ok }; })
          .filter((p) => (!q.service || (p.services || []).includes(q.service))
            && (!q.q || (p.display_name + ' ' + p.partner_id).toLowerCase().includes(q.q.toLowerCase()))
            && (!q.province || (p.province || '').toLowerCase().includes(q.province.toLowerCase()))
            && (!q.city || (p.city || '').toLowerCase().includes(q.city.toLowerCase()))
            && (!q.area || (p.territories || []).some((t) => (t.name || '').toLowerCase().includes(q.area.toLowerCase()))));
      },
      async verify(token) {
        const p = g('partners', []).find((x) => x.qr_token === token);
        if (!p) return { found: false };
        return { found: true, partner_id: p.partner_id, name: p.display_name, category: p.category, designation: p.designation,
          status: p.status, active: p.status === 'active' && !!p.agreement_ok, office_branding: !!p.office_branding,
          may_collect_money: !!p.may_collect_money, services: p.services || [], since: p.joined_on, checked_at: new Date().toISOString(),
          territories: g('partner_terr', []).filter((x) => x.partner_id === p.id)
            .map((x) => (g('territories', []).find((t) => t.id === x.territory_id) || {}).name).filter(Boolean) };
      },
      async dashboard() {
        const p = myPartner(); if (!p) return { partner: null };
        const tt = g('territories', []);
        const leads = g('leads', []).filter((l) => l.partner_id === p.id || l.origin_partner === p.id);
        const tx = g('tx', []).filter((x) => x.partner_id === p.id);
        const cm = g('commissions', []).filter((c) => c.partner_id === p.id);
        const sum = (f) => cm.filter(f).reduce((a, c) => a + (+c.amount || 0), 0);
        return { partner: p,
          territories: g('partner_terr', []).filter((x) => x.partner_id === p.id)
            .map((x) => { const t = tt.find((y) => y.id === x.territory_id) || {}; return { name: t.name, level: t.level, city: t.city, province: t.province, status: t.status, exclusive: x.exclusive, from: x.from_date }; }),
          agreement: g('agreements', []).find((a) => a.partner_id === p.id && a.status === 'executed') || null,
          listings: db.listings.filter((l) => l.partnerId === p.id).map((l) => ({ id: l.id, ref: l.ref, title: l.title, status: l.status, city: l.city, area: l.area, price: l.price, purpose: l.purpose, owner_authorised: true, expires: l.advertExpires })),
          leads, transactions: tx, commissions: cm,
          payouts: g('payouts', []).filter((o) => o.partner_id === p.id),
          training: PN_TRAIN_FALLBACK.map(([code, title]) => ({ code, title, body: '', required: true,
            done: g('training', []).some((d) => d.partner_id === p.id && d.code === code) })),
          documents: [],
          performance: {
            from: null, to: null,
            listings: db.listings.filter((l) => l.partnerId === p.id).length,
            leads_total: leads.length, leads_generated: leads.filter((l) => l.origin_partner === p.id).length,
            leads_accepted: leads.filter((l) => l.accepted_at).length, leads_lost: leads.filter((l) => l.stage === 'lost').length,
            leads_returned: leads.filter((l) => l.stage === 'returned').length,
            visits: leads.filter((l) => l.visit_at).length, completed: leads.filter((l) => l.stage === 'completed').length,
            revenue: tx.reduce((a, x) => a + (+x.fee_received || 0), 0), response_hours: null, complaints: 0 },
          earnings: { earned: sum((c) => ['approved', 'paid'].includes(c.status)), pending: sum((c) => c.status === 'pending'),
            paid: sum((c) => c.status === 'paid'), disputed: sum((c) => c.status === 'disputed') } };
      },
      async statement(from, to) {
        const p = myPartner(); need(p, 'Only a RAQBO partner can download a statement.');
        const cm = g('commissions', []).filter((c) => c.partner_id === p.id);
        const tx = g('tx', []);
        const lines = cm.map((c) => { const x = tx.find((y) => y.id === c.transaction_id) || {};
          return { date: x.completed_on, ref: x.ref, service: x.service, description: x.description, gross_fee: x.gross_fee,
            fee_received: x.fee_received, deductions: (+x.tax_deduction || 0) + (+x.third_party || 0) + (+x.refunded || 0) + (+x.other_deduction || 0),
            deduction_note: x.deduction_note, distributable: c.distributable, rate_pct: c.rate_pct, amount: c.amount, status: c.status, commission_ref: c.ref }; });
        return { partner: { partner_id: p.partner_id, name: p.display_name, category: p.category }, from, to,
          issued_at: new Date().toISOString(), lines, total: lines.reduce((a, l) => a + (+l.amount || 0), 0), note: PN_NOTE_MONEY };
      },
      async accept(ref) { const all = g('leads', []); const l = all.find((x) => x.ref === ref); need(l, 'Lead not found.');
        need(l.stage === 'assigned', 'That lead can no longer be accepted.');
        l.stage = 'accepted'; l.accepted_at = new Date().toISOString(); s('leads', all); },
      async decline(ref, why) { const all = g('leads', []); const l = all.find((x) => x.ref === ref); need(l, 'Lead not found.');
        l.stage = 'returned'; l.partner_id = null; l.decline_reason = why || ''; s('leads', all); },
      async stage(ref, st, note) { const all = g('leads', []); const l = all.find((x) => x.ref === ref); need(l, 'Lead not found.');
        need(l.accepted_at, 'Accept the lead before moving it forward.');
        l.stage = st; l.stage_note = note || '';
        if (st === 'contacted') l.contacted_at = new Date().toISOString();
        if (st === 'site_visit') l.visit_at = new Date().toISOString();
        if (st === 'completed') l.completed_at = new Date().toISOString();
        s('leads', all); },
      async train(code) { const p = myPartner(); need(p, 'Only a RAQBO partner can record training.');
        const all = g('training', []); if (!all.some((d) => d.partner_id === p.id && d.code === code)) all.push({ partner_id: p.id, code });
        s('training', all);
        const ps = g('partners', []); const me = ps.find((x) => x.id === p.id);
        me.training_done = PN_TRAIN_FALLBACK.every(([c]) => all.some((d) => d.partner_id === p.id && d.code === c));
        s('partners', ps); },
      async saveProfile(p) { const ps = g('partners', []); const me = ps.find((x) => x.user_id === pnMe()); need(me, 'Only a RAQBO partner can do this.');
        ['phone', 'whatsapp', 'email', 'office_address', 'about'].forEach((k) => { if (p[k] !== undefined) me[k] = p[k]; });
        if (p.listed !== undefined) me.listed = !!p.listed;
        s('partners', ps); },
      async quicksell(p) { const me = myPartner(); need(me && ['active', 'probation'].includes(me.status), 'Only an active RAQBO partner can send an opportunity.');
        const all = g('leads', []); const ref = rid('RQ-LD-');
        all.unshift({ id: rid('ld'), ref, source: 'partner', origin_partner: me.id, kind: 'quicksell', service: 'quicksell',
          customer_name: p.owner_name || '', customer_phone: p.phone || '', customer_note: p.detail || '',
          province: p.province || '', city: p.city || '', area: p.area || '', stage: 'raqbo_review', created_at: new Date().toISOString() });
        s('leads', all); return ref; },
      async dispute(ref, why) { const all = g('commissions', []); const c = all.find((x) => x.ref === ref); need(c, 'Commission not found.');
        need(c.status !== 'paid', 'This commission has already been paid. Please raise a complaint instead.');
        c.status = 'disputed'; c.dispute_note = why; s('commissions', all); },
      async claim(id, okAuth, note) { const me = myPartner(); need(me && ['active', 'probation'].includes(me.status), 'Only an active RAQBO partner can do this.');
        need(okAuth, 'Confirm that the owner has authorised this advertisement before sending it.');
        const l = db.listings.find((x) => x.id === id); need(l, 'Property not found.');
        need(!l.partnerId || l.partnerId === me.id, 'Another partner has already submitted this property.');
        l.partnerId = me.id; l.ownerAuthorised = true; l.ownerAuthNote = note || '';
        l.advertExpires = l.advertExpires || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10); },
      async dupes(city, area, size, price) {
        return db.listings.filter((l) => ['published', 'pending'].includes(l.status)
          && (l.city || '').toLowerCase() === String(city || '').toLowerCase()
          && (!area || (l.area || '').toLowerCase() === String(area).toLowerCase())
          && (!size || Math.abs((+l.size || 0) - size) <= size * 0.05)
          && (!price || Math.abs((+l.price || 0) - price) <= price * 0.1))
          .slice(0, 10).map((l) => ({ ref: l.ref, title: l.title, status: l.status, city: l.city, area: l.area, price: l.price }));
      },
      // ---- admin (demo) ----
      async admin(what) {
        const tt = g('territories', []); const ps = g('partners', []);
        if (what === 'applications') return g('applications', []);
        if (what === 'partners') return ps.map((p) => ({ ...p,
          territories: g('partner_terr', []).filter((x) => x.partner_id === p.id).map((x) => { const t = tt.find((y) => y.id === x.territory_id) || {}; return { id: t.id, name: t.name, city: t.city, exclusive: x.exclusive }; }),
          agreement: (g('agreements', []).find((a) => a.partner_id === p.id) || {}).status || null,
          leads_open: g('leads', []).filter((l) => l.partner_id === p.id && !['completed', 'lost', 'returned'].includes(l.stage)).length,
          owed: g('commissions', []).filter((c) => c.partner_id === p.id && c.status === 'approved').reduce((a, c) => a + (+c.amount || 0), 0) }));
        if (what === 'territories') return tt.map((t) => ({ ...t,
          partners: g('partner_terr', []).filter((x) => x.territory_id === t.id).map((x) => { const p = ps.find((y) => y.id === x.partner_id) || {}; return { partner_id: p.partner_id, name: p.display_name, status: p.status, exclusive: x.exclusive }; }) }));
        if (what === 'leads') return g('leads', []).map((l) => ({ ...l, partner_name: (ps.find((p) => p.id === l.partner_id) || {}).display_name, events: [] }));
        if (what === 'money') return { transactions: g('tx', []).map((x) => ({ ...x, partner_name: (ps.find((p) => p.id === x.partner_id) || {}).display_name, commission: g('commissions', []).find((c) => c.transaction_id === x.id) || null })),
          payouts: g('payouts', []).map((o) => ({ ...o, partner_name: (ps.find((p) => p.id === o.partner_id) || {}).display_name })),
          rates: seedRates(), disputed: g('commissions', []).filter((c) => c.status === 'disputed').length };
        if (what === 'agreements') return g('agreements', []).map((a) => ({ ...a, partner_name: (ps.find((p) => p.id === a.partner_id) || {}).display_name, partner_ref: (ps.find((p) => p.id === a.partner_id) || {}).partner_id }));
        if (what === 'documents') return [];
        if (what === 'activity') return [];
        const cm = g('commissions', []); const leads = g('leads', []);
        return { applications_new: g('applications', []).filter((a) => ['submitted', 'preliminary_review'].includes(a.stage)).length,
          applications_open: g('applications', []).filter((a) => !['activated', 'rejected', 'withdrawn'].includes(a.stage)).length,
          partners_active: ps.filter((p) => p.status === 'active').length,
          partners_review: ps.filter((p) => ['under_review', 'probation'].includes(p.status)).length,
          partners_suspended: ps.filter((p) => ['suspended', 'terminated'].includes(p.status)).length,
          territories_total: tt.length, territories_open: tt.filter((t) => ['available', 'additional_allowed'].includes(t.status)).length,
          leads_waiting: leads.filter((l) => ['new', 'raqbo_review', 'returned'].includes(l.stage)).length,
          leads_assigned: leads.filter((l) => l.stage === 'assigned').length, leads_overdue: 0,
          leads_open: leads.filter((l) => !['completed', 'lost'].includes(l.stage)).length,
          commission_pending: cm.filter((c) => c.status === 'pending').reduce((a, c) => a + (+c.amount || 0), 0),
          commission_approved: cm.filter((c) => c.status === 'approved').reduce((a, c) => a + (+c.amount || 0), 0),
          commission_disputed: cm.filter((c) => c.status === 'disputed').length,
          agreements_expiring: 0, documents_expiring: 0,
          partner_listings: db.listings.filter((l) => l.partnerId).length,
          partner_listings_pending: db.listings.filter((l) => l.partnerId && l.status === 'pending').length };
      },
      async appStage(id, st, note) { const all = g('applications', []); const a = all.find((x) => x.id === id); need(a, 'Application not found.');
        if (st === 'interview') need(a.identity_verified && a.business_verified, 'Verify identity and business details before the interview stage.');
        a.stage = st; a.stage_note = note || ''; s('applications', all); },
      async appReview(p) { const all = g('applications', []); const a = all.find((x) => x.id === p.id); need(a, 'Application not found.');
        Object.assign(a, p); s('applications', all); },
      async appApprove(id, cat, desig) {
        const all = g('applications', []); const a = all.find((x) => x.id === id); need(a, 'Application not found.');
        need(a.identity_verified && a.business_verified, 'Identity and business details must be verified before a partner is appointed.');
        if (cat === 'franchise') need(seedSettings().franchise_open, 'Full franchises are not open yet. Appoint as an Area Partner, or open franchising in the settings first.');
        const ps = g('partners', []);
        need(!ps.some((p) => p.user_id === a.user_id && p.status !== 'terminated'), 'This person is already a RAQBO partner.');
        const pid = rid('RQ-P-');
        ps.unshift({ id: rid('pn'), partner_id: pid, user_id: a.user_id, application_id: a.id, category: cat,
          display_name: a.business_name || a.full_name, business_type: a.business_type || 'individual',
          phone: a.phone, whatsapp: a.whatsapp, email: a.email, office_address: a.office_address, services: a.services || [],
          designation: desig || (cat === 'franchise' ? 'RAQBO Franchise Partner' : cat === 'area'
            ? 'RAQBO Authorised Area Partner' + (a.area_wanted ? ' — ' + a.area_wanted : a.city ? ' — ' + a.city : '')
            : 'RAQBO Associate Partner'),
          status: 'under_review', agreement_ok: false, training_done: false, listed: true,
          may_collect_money: false, may_run_auction: false, office_branding: false,
          qr_token: Math.random().toString(36).slice(2, 14), created_at: new Date().toISOString() });
        s('partners', ps);
        if (a.territory_id) { const pt = g('partner_terr', []); pt.push({ partner_id: ps[0].id, territory_id: a.territory_id, exclusive: false, from_date: new Date().toISOString().slice(0, 10) }); s('partner_terr', pt);
          const tt = g('territories', []); const t = tt.find((x) => x.id === a.territory_id); if (t && ['available', 'under_review'].includes(t.status)) { t.status = 'appointed'; s('territories', tt); } }
        a.stage = 'agreement'; a.stage_note = 'Approved. Waiting for the agreement to be executed.'; s('applications', all);
        return pid; },
      async setStatus(pid, st, note) { const ps = g('partners', []); const p = ps.find((x) => x.partner_id === pid); need(p, 'Partner not found.');
        if (st === 'active') { need(p.agreement_ok, 'This partner cannot be made active until an agreement has been executed.');
          need(p.training_done, 'This partner cannot be made active until the required training is complete.'); }
        p.status = st; p.status_note = note || ''; if (st === 'active' && !p.joined_on) p.joined_on = new Date().toISOString().slice(0, 10);
        if (['suspended', 'terminated'].includes(st)) { const ls = g('leads', []); ls.forEach((l) => { if (l.partner_id === p.id && ['assigned', 'accepted', 'contacted', 'site_visit', 'negotiation'].includes(l.stage)) { l.partner_id = null; l.stage = 'returned'; } }); s('leads', ls); }
        s('partners', ps); },
      async setPowers(pid, p) { const ps = g('partners', []); const me = ps.find((x) => x.partner_id === pid); need(me, 'Partner not found.');
        if (p.office_branding && me.category !== 'franchise') throw new Error('Office branding is only for a franchise partner.');
        Object.assign(me, p); s('partners', ps); },
      async saveTerritory(p) { const all = g('territories', []);
        if (p.id) { const t = all.find((x) => x.id === p.id); need(t, 'Territory not found.'); Object.assign(t, p); s('territories', all); return t.id; }
        need(String(p.name || '').trim().length >= 2, 'Enter the name of the area.');
        const row = { ...p, id: rid('tr'), code: rid('RQ-TR-'), status: p.status || 'available', max_partners: +p.max_partners || 1, exclusive: false };
        all.push(row); s('territories', all); return row.id; },
      async assign(pid, tid, ex) {
        const ps = g('partners', []); const p = ps.find((x) => x.partner_id === pid); need(p, 'Partner not found.');
        const tt = g('territories', []); const t = tt.find((x) => x.id === tid); need(t, 'Territory not found.');
        need(!['suspended', 'reserved'].includes(t.status), 'That territory is ' + t.status + ' and cannot be given to a partner.');
        const pt = g('partner_terr', []);
        need(!pt.some((x) => x.territory_id === tid && x.exclusive && x.partner_id !== p.id), 'Another partner already holds this territory exclusively.');
        const others = pt.filter((x) => x.territory_id === tid && x.partner_id !== p.id).length;
        need(others < (+t.max_partners || 1), 'This territory already has the number of partners it allows (' + (t.max_partners || 1) + '). Raise the limit first if that is intended.');
        const row = pt.find((x) => x.territory_id === tid && x.partner_id === p.id);
        if (row) row.exclusive = !!ex; else pt.push({ partner_id: p.id, territory_id: tid, exclusive: !!ex, from_date: new Date().toISOString().slice(0, 10) });
        s('partner_terr', pt);
        if (['available', 'under_review'].includes(t.status)) t.status = 'appointed'; if (ex) t.exclusive = true; s('territories', tt); },
      async unassign(pid, tid) { const p = g('partners', []).find((x) => x.partner_id === pid); if (!p) return;
        s('partner_terr', g('partner_terr', []).filter((x) => !(x.partner_id === p.id && x.territory_id === tid)));
        if (!g('partner_terr', []).some((x) => x.territory_id === tid)) { const tt = g('territories', []); const t = tt.find((x) => x.id === tid); if (t) { t.status = 'available'; t.exclusive = false; s('territories', tt); } } },
      async saveAgreement(p) {
        const ps = g('partners', []); const me = ps.find((x) => x.partner_id === p.partner_id); need(me, 'Partner not found.');
        const status = p.status || 'draft';
        if (status === 'executed') need(p.legal_reviewed, 'Mark the agreement as legally reviewed before recording it as executed.');
        const all = g('agreements', []);
        let row = p.id ? all.find((x) => x.id === p.id) : null;
        if (row) Object.assign(row, p, { status }); else { row = { ...p, id: rid('ag'), ref: rid('RQ-AG-'), partner_id: me.id, status }; all.unshift(row); }
        if (status === 'executed' && !row.executed_on) row.executed_on = new Date().toISOString().slice(0, 10);
        s('agreements', all);
        me.agreement_ok = all.some((a) => a.partner_id === me.id && a.status === 'executed');
        if (!me.agreement_ok && me.status === 'active') { me.status = 'under_review'; me.status_note = 'No agreement in force.'; }
        s('partners', ps); return row.ref; },
      async newLead(p) { const all = g('leads', []); const ref = rid('RQ-LD-');
        all.unshift({ ...p, id: rid('ld'), ref, stage: 'raqbo_review', source: p.source || 'raqbo', created_at: new Date().toISOString() });
        s('leads', all); return ref; },
      async assignLead(ref, pid) {
        const ps = g('partners', []); const p = ps.find((x) => x.partner_id === pid); need(p, 'Partner not found.');
        need(['active', 'probation'].includes(p.status), 'A lead can only go to an active partner. This partner is ' + p.status + '.');
        const all = g('leads', []); const l = all.find((x) => x.ref === ref); need(l, 'Lead not found.');
        if (l.service && (p.services || []).length && !(p.services || []).includes(l.service)) throw new Error('This partner is not authorised for ' + l.service + '.');
        l.partner_id = p.id; l.stage = 'assigned'; l.assigned_at = new Date().toISOString();
        l.accept_by = new Date(Date.now() + (seedSettings().lead_accept_hours || 24) * 3600000).toISOString();
        l.accepted_at = null; s('leads', all); },
      async returnLead(ref, note) { const all = g('leads', []); const l = all.find((x) => x.ref === ref); need(l, 'Lead not found.');
        l.partner_id = null; l.stage = 'returned'; l.stage_note = note || ''; s('leads', all); },
      async takeLead(ref) { const all = g('leads', []); const l = all.find((x) => x.ref === ref); need(l, 'Lead not found.');
        l.handled_by_raqbo = true; l.partner_id = null; l.stage = 'raqbo_review'; s('leads', all); },
      async saveTx(p) {
        const ps = g('partners', []); const me = ps.find((x) => x.partner_id === p.partner_id); need(me, 'Partner not found.');
        const all = g('tx', []); let row = p.id ? all.find((x) => x.id === p.id) : null;
        if (row) Object.assign(row, p); else { row = { ...p, id: rid('tx'), ref: rid('RQ-TX-'), partner_id: me.id, stage: p.stage || 'open' }; all.unshift(row); }
        s('tx', all);
        const cms = g('commissions', []);
        const existing = cms.find((c) => c.transaction_id === row.id);
        if (!(+row.fee_received > 0)) { if (existing && existing.status === 'pending') s('commissions', cms.filter((c) => c !== existing)); return row.ref; }
        const r = rateFor(me.category, row.service || 'any', row.lead_source || 'raqbo');
        need(r, 'No commission rule applies to a ' + me.category + ' partner on a ' + (row.lead_source || 'raqbo') + ' lead. Add one under Property partners → Commission rates.');
        const dist = Math.max((+row.fee_received || 0) - (+row.tax_deduction || 0) - (+row.third_party || 0) - (+row.refunded || 0) - (+row.other_deduction || 0), 0);
        const amount = Math.round(dist * r.partner_pct / 100);
        if (existing) { if (existing.status !== 'paid') Object.assign(existing, { rate_pct: r.partner_pct, distributable: dist, amount, rate_source: 'category ' + me.category }); }
        else cms.unshift({ id: rid('cm'), ref: rid('RQ-CM-'), transaction_id: row.id, partner_id: me.id, rate_pct: r.partner_pct,
          rate_source: 'category ' + me.category + ', service ' + r.service + ', lead ' + r.lead_source, distributable: dist, amount, status: 'pending', created_at: new Date().toISOString() });
        s('commissions', cms); return row.ref; },
      async cmStatus(ref, st, note) { const all = g('commissions', []); const c = all.find((x) => x.ref === ref); need(c, 'Commission not found.');
        if (st === 'paid') need(c.status === 'approved', 'Approve the commission before marking it paid.');
        if (c.status === 'disputed' && st !== 'disputed') c.dispute_outcome = note || '';
        if (st === 'disputed') c.dispute_note = note || '';
        c.status = st; s('commissions', all); },
      async buildPayout(pid, from, to) {
        const p = g('partners', []).find((x) => x.partner_id === pid); need(p, 'Partner not found.');
        const cms = g('commissions', []); const take = cms.filter((c) => c.partner_id === p.id && c.status === 'approved' && !c.payout_id);
        need(take.length, 'There is no approved commission for this partner in that period.');
        const total = take.reduce((a, c) => a + (+c.amount || 0), 0);
        const all = g('payouts', []); const row = { id: rid('po'), ref: rid('RQ-PO-'), partner_id: p.id, period_from: from, period_to: to, amount: total, status: 'draft', method: 'bank', reference: '', created_at: new Date().toISOString() };
        all.unshift(row); s('payouts', all); take.forEach((c) => { c.payout_id = row.id; }); s('commissions', cms); return row.ref; },
      async payoutStatus(ref, st, method, reference) {
        const all = g('payouts', []); const o = all.find((x) => x.ref === ref); need(o, 'Payout not found.');
        if (st === 'paid') { need(o.status === 'approved', 'A payout must be approved before it is marked paid.');
          need(String(reference || '').trim(), 'Record the bank reference. Partner payments must go through a traceable banking channel.'); }
        o.status = st; o.method = method || o.method; o.reference = reference || o.reference;
        if (st === 'paid') { o.paid_on = new Date().toISOString().slice(0, 10);
          const cms = g('commissions', []); cms.forEach((c) => { if (c.payout_id === o.id && c.status === 'approved') c.status = 'paid'; }); s('commissions', cms); }
        if (st === 'cancelled') { const cms = g('commissions', []); cms.forEach((c) => { if (c.payout_id === o.id) c.payout_id = null; }); s('commissions', cms); }
        s('payouts', all); },
      async saveSettings(p) { s('settings', { ...seedSettings(), ...p }); },
      async saveRate(p) { const all = seedRates();
        if (p.id) { const r = all.find((x) => x.id === p.id); if (r) Object.assign(r, p); }
        else { const same = all.find((x) => x.category === p.category && x.service === (p.service || 'any') && x.lead_source === (p.lead_source || 'any'));
          if (same) Object.assign(same, { partner_pct: p.partner_pct, note: p.note, active: true });
          else all.push({ ...p, id: rid('r'), service: p.service || 'any', lead_source: p.lead_source || 'any', active: true }); }
        s('rates', all); return true; },
      async run() { return { leads_returned: 0, documents_reminded: 0 }; }
    };
  })();

