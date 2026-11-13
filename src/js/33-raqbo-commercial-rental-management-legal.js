  /* =====================================================================
     RAQBO — COMMERCIAL, RENTAL MANAGEMENT & LEGAL SERVICES
     Commercial & investment property · landlord property management ·
     tenant screening · rent collection records · lease agreement
     generator · legal consultation booking · stamp duty & tax calculator ·
     rental yield calculator · landlord / tenant / lawyer dashboards.
     Supabase: update_27_commercial_rental_legal.sql
     ===================================================================== */
  var rm = { props: null, tenants: null, tenancies: null, rent: null, exp: null, maint: null, sum: null, at: 0, tenant: null, lawyer: null, lawyers: null, admin: null, adminAt: 0, adminTab: 'summary', cf: { kind: '', purpose: '', city: '', min: '', max: '', sizeMin: '', sizeMax: '', floor: '', parking: false, income: false } };
  const RM_SETUP = 'These services are being set up. (Admin: run update_27_commercial_rental_legal.sql in Supabase.)';
  const rmErr = (e) => new Error(/could not find the function|does not exist|schema cache|relation/i.test((e && e.message) || '') ? RM_SETUP : (e && e.message) || 'Something went wrong.');
  const rmRpc = async (fn, args) => { const { data, error } = await SB.rpc(fn, args || {}); if (error) throw rmErr(error); return data; };
  const rmMe = () => (db.session && db.session.userId) || null;
  const RM_CKIND = { office: 'Office', office_floor: 'Office floor', shop: 'Shop', showroom: 'Showroom', warehouse: 'Warehouse', industrial_unit: 'Industrial unit', building: 'Commercial building', coworking: 'Co-working space', income_property: 'Income-generating property', other: 'Other commercial' };
  const RM_MATTER = { sale_purchase: 'Property sale & purchase agreement', lease_tenancy: 'Lease & tenancy agreement', title_review: 'Property ownership & title review', documentation: 'Property documentation', disputes: 'Property dispute', landlord_tenant: 'Landlord–tenant dispute', inheritance: 'Inheritance & succession', mutation_transfer: 'Mutation & transfer', tax_stamp: 'Property tax & stamp duty guidance', notice_review: 'Legal notice & contract review', other: 'Other property legal matter' };
  const RM_MODE = { physical: 'In person', phone: 'By telephone', video: 'Online video' };
  const RM_RENTST = { due: ['Due', 'wait'], part_paid: ['Part paid', 'wait'], paid: ['Paid', 'good'], overdue: ['Overdue', 'bad'], waived: ['Waived', ''] };
  const RM_PROV = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan', 'Azad Kashmir'];
  // Tags built at run time: a literal style or script tag inside a string is
  // picked up by the build's minifier and breaks the whole bundle.
  const RM_TAG = (n, a) => '<' + n + (a ? ' ' + a : '') + '>';
  const RM_END = (n) => '<' + '/' + n + '>';

  const RM_LINKS = { stamp: 'https://es.punjab-zameen.gov.pk/eStampCitizenPortal/ChallanFormView/HomePage', stampInfo: 'https://www.punjab-zameen.gov.pk/estampInfo', fbr: 'https://www.fbr.gov.pk/withholding-taxes-rate-card/174298/174301', trs: 'https://trs.punjabpolice.gov.pk/' };
  const RM_DISCLAIMER = 'Calculations are indicative only and may vary according to current laws, official valuations, exemptions and applicable government notifications. The final payable amounts must be confirmed through the relevant government authority.';
  const rmDay = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return String(d); } };
  const rmMonth = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); } catch { return String(d); } };
  const rmToday = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);

  // ---------- Data ----------
  const RM = SB ? {
    props: () => SB.from('rm_properties').select('*').eq('owner_id', rmMe()).order('created_at').then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    saveProp: async (p) => { const r = p.id ? await SB.from('rm_properties').update(p).eq('id', p.id).select().single() : await SB.from('rm_properties').insert({ ...p, owner_id: rmMe() }).select().single(); if (r.error) throw rmErr(r.error); return r.data; },
    delProp: async (id) => { const { error } = await SB.from('rm_properties').update({ archived: true }).eq('id', id); if (error) throw rmErr(error); },
    tenants: () => SB.from('rm_tenants').select('*').eq('owner_id', rmMe()).order('created_at').then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    saveTenant: async (t) => { const r = t.id ? await SB.from('rm_tenants').update(t).eq('id', t.id).select().single() : await SB.from('rm_tenants').insert({ ...t, owner_id: rmMe() }).select().single(); if (r.error) throw rmErr(r.error); return r.data; },
    tenancies: () => SB.from('rm_tenancies').select('*').eq('owner_id', rmMe()).order('created_at', { ascending: false }).then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    saveTenancy: async (y) => { const r = y.id ? await SB.from('rm_tenancies').update(y).eq('id', y.id).select().single() : await SB.from('rm_tenancies').insert({ ...y, owner_id: rmMe() }).select().single(); if (r.error) throw rmErr(r.error); return r.data; },
    buildRent: (id, months) => rmRpc('rm_build_rent', { p_tenancy: id, p_months: months || 12 }),
    rent: () => SB.from('rm_rent').select('*').eq('owner_id', rmMe()).order('due_on', { ascending: false }).limit(400).then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    payRent: (id, amount, on, method, ref, note) => rmRpc('rm_pay_rent', { p_rent: id, p_amount: amount, p_paid_on: on || null, p_method: method || '', p_reference: ref || '', p_note: note || '' }),
    overdue: () => rmRpc('rm_mark_overdue'),
    expenses: () => SB.from('rm_expenses').select('*').eq('owner_id', rmMe()).order('spent_on', { ascending: false }).limit(300).then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    addExpense: async (e) => { const { error } = await SB.from('rm_expenses').insert({ ...e, owner_id: rmMe() }); if (error) throw rmErr(error); },
    maint: () => SB.from('rm_maintenance').select('*').eq('owner_id', rmMe()).order('created_at', { ascending: false }).limit(200).then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    setMaint: async (id, p) => { const { error } = await SB.from('rm_maintenance').update(p).eq('id', id); if (error) throw rmErr(error); },
    summary: (f, t) => rmRpc('rm_summary', { p_from: f || null, p_to: t || null }),
    tenantView: () => rmRpc('rm_tenant_view'),
    tenantMaint: (y, title, details, urgency) => rmRpc('rm_tenant_maintenance', { p_tenancy: y, p_title: title, p_details: details, p_urgency: urgency }),
    screenings: () => SB.from('ts_checks').select('*').order('created_at', { ascending: false }).limit(200).then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    tsRequest: (tenant, name, phone, email, supplied) => rmRpc('ts_request', { p_tenant: tenant || null, p_name: name, p_phone: phone || '', p_email: email || '', p_supplied: supplied || {} }),
    tsConsent: (ref, agree, text) => rmRpc('ts_consent', { p_ref: ref, p_agree: agree, p_text: text || '' }),
    tsAdmin: (ref, status, verified, note) => rmRpc('ts_admin_update', { p_ref: ref, p_status: status, p_verified: verified || {}, p_note: note || '' }),
    lawyers: () => SB.from('lawyers').select('id,name,qualification,bar_council,enrolment_no,years,city,languages,specialities,profile,fee,modes,photo,status').eq('status', 'verified').eq('active', true).order('name').then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    lawyerApply: (p) => rmRpc('lawyer_apply', { p }),
    lawyerView: () => rmRpc('lawyer_view'),
    book: (p) => rmRpc('legal_book', { p }),
    myAppts: () => SB.from('legal_appointments').select('*').eq('user_id', rmMe()).order('created_at', { ascending: false }).then(({ data, error }) => { if (error) throw rmErr(error); return data || []; }),
    updateAppt: (ref, status, at, note, fee) => rmRpc('legal_update', { p_ref: ref, p_status: status, p_confirmed: at || null, p_note: note || '', p_fee_status: fee || null }),
    feedback: (ref, rating, text) => rmRpc('legal_feedback', { p_ref: ref, p_rating: rating, p_text: text || '' }),
    tax: (prov, dist, cat, price, val, filer, on) => rmRpc('tax_estimate', { p_province: prov, p_district: dist || '', p_category: cat || 'any', p_price: price || 0, p_valuation: val || 0, p_filer: !!filer, p_on: on || null }),
    saveTax: (p) => rmRpc('admin_save_tax_rate', { p }),
    admin: (what) => rmRpc('rm_admin', { p_what: what || 'summary' }),
    setManaged: (id, status, fee) => rmRpc('admin_set_managed', { p_id: id, p_status: status, p_fee: fee || null }),
    setLawyer: (id, status, note) => rmRpc('admin_set_lawyer', { p_id: id, p_status: status, p_note: note || '' }),
    setRoles: (roles) => rmRpc('set_member_roles', { p_roles: roles })
  } : (() => {
    const g = (k, d) => store.get('rm.' + k, d); const s = (k, v) => store.set('rm.' + k, v);
    const mine = (k) => g(k, []).filter((x) => x.owner_id === rmMe());
    const need = (c, m) => { if (!c) throw new Error(m); };
    const put = (k, row) => { const a = g(k, []); if (row.id) { const i = a.findIndex((x) => x.id === row.id); if (i >= 0) { a[i] = { ...a[i], ...row }; s(k, a); return a[i]; } } const r = { ...row, id: row.id || uid(k), owner_id: rmMe(), created_at: new Date().toISOString() }; a.push(r); s(k, a); return r; };
    return {
      async props() { return mine('props').filter((p) => !p.archived); },
      async saveProp(p) { if (!p.id) { need(String(p.title || '').trim().length >= 3, 'Enter a name for the property.'); return put('props', { ...p, ref: 'RQ-PM-' + Math.random().toString(36).slice(2, 10).toUpperCase() }); } return put('props', p); },
      async delProp(id) { put('props', { id, archived: true }); },
      async tenants() { return mine('tenants'); },
      async saveTenant(t) { need(String(t.name || '').trim().length >= 2, 'Enter the tenant\'s name.'); return put('tenants', t); },
      async tenancies() { return mine('tenancies'); },
      async saveTenancy(y) { need(y.property_id, 'Choose the property.'); need(y.tenant_id, 'Choose the tenant.'); need(+y.rent > 0, 'Enter the rent.'); need(y.starts_on, 'Enter the start date.'); return put('tenancies', { ...y, ref: y.ref || 'RQ-LSE-' + Math.random().toString(36).slice(2, 10).toUpperCase(), status: y.status || 'draft' }); },
      async buildRent(id, months) {
        const y = g('tenancies', []).find((x) => x.id === id); need(y, 'Tenancy not found.');
        const all = g('rent', []); let n = 0; let amt = +y.rent; const step = y.rent_period === 'year' ? 12 : 1;
        const d0 = new Date(y.starts_on + 'T00:00:00Z');
        for (let i = 0; i < Math.min(months || 12, 60); i++) {
          const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i * step, 1));
          if (y.ends_on && d > new Date(y.ends_on + 'T00:00:00Z')) break;
          if (+y.escalation_pct > 0 && i > 0 && (i * step) % Math.max(1, +y.escalation_months || 12) === 0) amt = Math.round(amt * (1 + +y.escalation_pct / 100));
          const period = d.toISOString().slice(0, 10);
          if (all.some((r) => r.tenancy_id === id && r.period === period)) continue;
          const due = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), +y.due_day || 1)).toISOString().slice(0, 10);
          all.push({ id: uid('rent'), tenancy_id: id, owner_id: rmMe(), period, due_on: due, amount: amt, paid_amount: 0, status: 'due' }); n++;
        }
        s('rent', all); put('tenancies', { id, status: y.status === 'draft' ? 'active' : y.status }); return n;
      },
      async rent() { return mine('rent').sort((a, b) => (a.due_on < b.due_on ? 1 : -1)); },
      async payRent(id, amount, on, method, ref, note) {
        const all = g('rent', []); const r = all.find((x) => x.id === id); need(r, 'Rent record not found.'); need(+amount > 0, 'Enter the amount received.');
        need(r.paid_amount + +amount <= r.amount * 2, 'That is far more than the rent due. Check the amount.');
        r.paid_amount += +amount; r.paid_on = on || rmToday(); r.method = method || ''; r.reference = ref || ''; r.note = note || '';
        r.status = r.paid_amount >= r.amount ? 'paid' : 'part_paid';
        r.receipt_no = r.receipt_no || 'RQ-RCT-' + new Date().toISOString().slice(2, 7).replace('-', '') + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        s('rent', all); return r.receipt_no;
      },
      async overdue() { const all = g('rent', []); let n = 0; all.forEach((r) => { if (r.owner_id === rmMe() && r.status === 'due' && r.due_on < rmToday()) { r.status = 'overdue'; n++; } }); s('rent', all); return n; },
      async expenses() { return mine('exp'); },
      async addExpense(e) { need(+e.amount > 0, 'Enter the amount.'); need(String(e.category || '').trim().length >= 2, 'Enter a category.'); put('exp', e); },
      async maint() { return mine('maint'); },
      async setMaint(id, p) { put('maint', { id, ...p }); },
      async summary(f, t) {
        f = f || rmToday().slice(0, 4) + '-01-01'; t = t || rmToday();
        const rent = mine('rent'); const exp = mine('exp'); const props = mine('props').filter((p) => !p.archived); const ten = mine('tenancies').filter((y) => y.status === 'active');
        const inR = (d) => d && d >= f && d <= t;
        return { from: f, to: t, properties: props.length, tenants: ten.length,
          rent_due_total: rent.filter((r) => ['due', 'part_paid', 'overdue'].includes(r.status)).reduce((a, r) => a + (r.amount - r.paid_amount), 0),
          overdue_total: rent.filter((r) => r.status === 'overdue').reduce((a, r) => a + (r.amount - r.paid_amount), 0),
          overdue_n: rent.filter((r) => r.status === 'overdue').length,
          collected: rent.filter((r) => inR(r.paid_on)).reduce((a, r) => a + r.paid_amount, 0),
          expenses: exp.filter((e) => inR(e.spent_on)).reduce((a, e) => a + +e.amount, 0),
          deposits_held: ten.reduce((a, y) => a + (+y.deposit || 0), 0),
          maintenance_open: mine('maint').filter((m) => ['open', 'in_progress'].includes(m.status)).length,
          leases_ending: ten.filter((y) => y.ends_on && y.ends_on <= new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10)).length,
          by_property: props.map((p) => { const ys = ten.filter((y) => y.property_id === p.id).map((y) => y.id);
            return { ref: p.ref, title: p.title,
              income: rent.filter((r) => ys.includes(r.tenancy_id) && inR(r.paid_on)).reduce((a, r) => a + r.paid_amount, 0),
              expenses: exp.filter((e) => e.property_id === p.id && inR(e.spent_on)).reduce((a, e) => a + +e.amount, 0),
              outstanding: rent.filter((r) => ys.includes(r.tenancy_id) && ['due', 'part_paid', 'overdue'].includes(r.status)).reduce((a, r) => a + (r.amount - r.paid_amount), 0) }; }) };
      },
      async tenantView() { const ys = g('tenancies', []).filter((y) => { const t = g('tenants', []).find((x) => x.id === y.tenant_id); return t && t.user_id === rmMe(); });
        return ys.map((y) => { const p = g('props', []).find((x) => x.id === y.property_id) || {};
          return { tenancy_ref: y.ref, tenancy_id: y.id, property: p.title, address: p.address, city: p.city, rent: y.rent, rent_period: y.rent_period, due_day: y.due_day, deposit: y.deposit, starts_on: y.starts_on, ends_on: y.ends_on, status: y.status, landlord: 'Landlord',
            rent_rows: g('rent', []).filter((r) => r.tenancy_id === y.id).map((r) => ({ id: r.id, period: r.period, due_on: r.due_on, amount: r.amount, paid: r.paid_amount, status: r.status, receipt_no: r.receipt_no, paid_on: r.paid_on })).sort((a, b) => (a.period < b.period ? 1 : -1)),
            maintenance: g('maint', []).filter((m) => m.tenancy_id === y.id).map((m) => ({ ref: m.ref, title: m.title, status: m.status, created_at: m.created_at })) }; }); },
      async tenantMaint(y, title, details, urgency) { need(String(title || '').trim().length >= 3, 'Say briefly what the problem is.');
        const ten = g('tenancies', []).find((x) => x.id === y); need(ten, 'Tenancy not found.');
        const a = g('maint', []); const ref = 'RQ-MNT-' + Math.random().toString(36).slice(2, 10).toUpperCase();
        a.push({ id: uid('m'), ref, property_id: ten.property_id, tenancy_id: y, owner_id: ten.owner_id, raised_by: rmMe(), title, details: details || '', urgency: urgency || 'normal', status: 'open', created_at: new Date().toISOString() }); s('maint', a); return ref; },
      async screenings() { return g('ts', []).filter((c) => c.owner_id === rmMe() || c.tenant_user === rmMe() || db.isAdmin); },
      async tsRequest(tenant, name, phone, email, supplied) { need(String(name || '').trim().length >= 2, 'Enter the tenant\'s name.');
        const a = g('ts', []); const ref = 'RQ-TSV-' + Math.random().toString(36).slice(2, 10).toUpperCase();
        a.unshift({ id: uid('ts'), ref, owner_id: rmMe(), tenant_id: tenant, tenant_user: null, tenant_name: name, tenant_phone: phone || '', tenant_email: email || '', supplied: supplied || {}, verified: {}, consent: false, status: 'awaiting_consent', created_at: new Date().toISOString() }); s('ts', a); return ref; },
      async tsConsent(ref, agree, text) { const a = g('ts', []); const c = a.find((x) => x.ref === ref); need(c, 'Not found.'); c.consent = agree; c.consent_at = new Date().toISOString(); c.consent_text = text || ''; c.status = agree ? 'consented' : 'withdrawn'; s('ts', a); },
      async tsAdmin(ref, status, verified, note) { const a = g('ts', []); const c = a.find((x) => x.ref === ref); need(c, 'Not found.');
        need(!['in_progress', 'completed'].includes(status) || c.consent, 'The tenant has not given consent. Nothing may be verified without it.');
        c.status = status; c.verified = verified || c.verified; c.report_note = note || ''; if (status === 'completed') c.completed_at = new Date().toISOString(); s('ts', a); },
      async lawyers() { return g('lawyers', []).filter((l) => l.status === 'verified' && l.active !== false); },
      async lawyerApply(p) { const a = g('lawyers', []); const mineL = a.find((l) => l.user_id === rmMe());
        need(String(p.name || '').trim().length >= 2, 'Enter your name.');
        if (mineL) Object.assign(mineL, p, { status: mineL.status === 'verified' ? 'verified' : 'pending' }); else a.push({ ...p, id: uid('lw'), user_id: rmMe(), status: 'pending', active: true, created_at: new Date().toISOString() });
        s('lawyers', a); return (mineL || a[a.length - 1]).id; },
      async lawyerView() { const l = g('lawyers', []).find((x) => x.user_id === rmMe()); return { profile: l || null, appointments: l ? g('appts', []).filter((a) => a.lawyer_id === l.id) : [] }; },
      async book(p) { need(String(p.summary || '').trim().length >= 10, 'Describe the matter in a sentence or two.');
        const l = g('lawyers', []).find((x) => x.id === p.lawyer_id);
        if (l) need((l.modes || []).includes(p.mode || 'phone'), 'That consultation type is not offered by this professional.');
        const a = g('appts', []); const ref = 'RQ-LGL-' + Math.random().toString(36).slice(2, 10).toUpperCase();
        a.unshift({ id: uid('ap'), ref, user_id: rmMe(), lawyer_id: p.lawyer_id || null, matter: p.matter || 'other', mode: p.mode || 'phone', summary: p.summary, preferred_at: p.preferred_at || null, duration_min: 30, fee: l ? l.fee : 0, fee_status: 'unpaid', status: 'requested', docs: p.docs || [], created_at: new Date().toISOString() }); s('appts', a); return ref; },
      async myAppts() { return g('appts', []).filter((a) => a.user_id === rmMe()); },
      async updateAppt(ref, status, at, note) { const a = g('appts', []); const x = a.find((y) => y.ref === ref); need(x, 'Not found.'); x.status = status; if (at) x.confirmed_at = at; x.admin_note = note || ''; s('appts', a); },
      async feedback(ref, rating, text) { const a = g('appts', []); const x = a.find((y) => y.ref === ref); need(x && x.status === 'completed', 'You can only rate a consultation you had.'); x.rating = rating; x.feedback = text || ''; s('appts', a); },
      async tax(prov, dist, cat, price, val, filer, on) {
        const rows = g('tax', []).filter((r) => r.active !== false && r.province === (prov || 'Punjab') && (r.district === (dist || '') || r.district === '') && (r.prop_category === (cat || 'any') || r.prop_category === 'any') && r.effective_from <= (on || rmToday()) && (!r.effective_to || r.effective_to >= (on || rmToday())));
        rows.sort((a, b) => (b.district !== '') - (a.district !== '') || (b.prop_category !== 'any') - (a.prop_category !== 'any') || (a.effective_from < b.effective_from ? 1 : -1));
        const r = rows[0]; if (!r) return { ok: false, why: 'RAQBO has not published rates for this province, district and date yet. Use the official government links instead.' };
        const base = r.basis === 'price' ? +price : r.basis === 'valuation' ? +val : Math.max(+price || 0, +val || 0);
        if (!(base > 0)) return { ok: false, why: 'Enter the price or the official valuation.' };
        const pc = (x) => Math.round(base * (+x || 0) / 100);
        const sd = pc(r.stamp_duty_pct), reg = pc(r.registration_pct) + (+r.registration_flat || 0), loc = pc(r.local_fee_pct), oth = pc(r.other_pct);
        const bt = pc(filer ? r.buyer_tax_filer_pct : r.buyer_tax_nonfiler_pct), st = pc(filer ? r.seller_tax_filer_pct : r.seller_tax_nonfiler_pct);
        return { ok: true, basis_amount: base, basis: r.basis, effective_from: r.effective_from, source_note: r.source_note, stamp_duty: sd, registration: reg, local_fee: loc, other: oth, buyer_tax: bt, seller_tax: st, buyer_total: sd + reg + loc + oth + bt, seller_total: st, total: sd + reg + loc + oth + bt + st };
      },
      async saveTax(p) { const a = g('tax', []); if (p.id) { Object.assign(a.find((x) => x.id === p.id), p); } else a.push({ ...p, id: Date.now(), active: true, created_at: new Date().toISOString() });
        s('tax', a); const h = g('taxh', []); h.unshift({ at: new Date().toISOString(), actor_name: (db.session && db.session.name) || 'Admin', action: p.id ? 'changed' : 'added', data: p }); s('taxh', h); return p.id || a[a.length - 1].id; },
      async admin(what) {
        if (what === 'properties') return g('props', []).filter((p) => p.mgmt_status && p.mgmt_status !== 'none');
        if (what === 'screening') return g('ts', []);
        if (what === 'legal') return { lawyers: g('lawyers', []), appointments: g('appts', []) };
        if (what === 'commercial') return db.listings.filter((l) => l.commercialKind || l.propertyType === 'Commercial').map((l) => ({ id: l.id, ref: l.ref, title: l.title, kind: l.commercialKind, purpose: l.purpose, city: l.city, area: l.area, price: l.price, status: l.status, created_at: new Date(l.createdAt).toISOString(), enquiries: 0 }));
        if (what === 'tax') return { rates: g('tax', []), history: g('taxh', []) };
        return { rm_properties: g('props', []).length, rm_managed: g('props', []).filter((p) => p.mgmt_status === 'active').length, rm_requested: g('props', []).filter((p) => p.mgmt_status === 'requested').length,
          tenancies_active: g('tenancies', []).filter((y) => y.status === 'active').length, rent_overdue_n: g('rent', []).filter((r) => r.status === 'overdue').length,
          screening_open: g('ts', []).filter((c) => ['awaiting_consent', 'consented', 'in_progress'].includes(c.status)).length,
          lawyers_pending: g('lawyers', []).filter((l) => l.status === 'pending').length, appointments_open: g('appts', []).filter((a) => ['requested', 'confirmed'].includes(a.status)).length,
          commercial_live: db.listings.filter((l) => l.status === 'published' && (l.commercialKind || l.propertyType === 'Commercial')).length,
          maintenance_open: g('maint', []).filter((m) => ['open', 'in_progress'].includes(m.status)).length };
      },
      async setManaged(id, status, fee) { put('props', { id, mgmt_status: status, managed_by: ['active', 'requested'].includes(status) ? 'raqbo' : 'self', mgmt_fee_pct: fee }); },
      async setLawyer(id, status, note) { const a = g('lawyers', []); const l = a.find((x) => x.id === id); need(l, 'Not found.');
        need(status !== 'verified' || (l.enrolment_no && l.bar_council), 'Record the bar council and enrolment number before verifying.');
        need(!['rejected', 'suspended'].includes(status) || String(note || '').trim().length >= 5, 'Give the reason.');
        l.status = status; l.admin_note = note || ''; s('lawyers', a); },
      async setRoles(roles) { store.set('rm.roles', roles); }
    };
  })();

  // ---------- Loading ----------
  async function rmLoad(force) {
    if (!rmMe()) return rm;
    if (rm.props && !force && Date.now() - rm.at < 25000) return rm;
    try { await RM.overdue().catch(() => {});
      const [props, tenants, tenancies, rent, exp, maint, sum] = await Promise.all([RM.props(), RM.tenants(), RM.tenancies(), RM.rent(), RM.expenses(), RM.maint(), RM.summary()]);
      Object.assign(rm, { props, tenants, tenancies, rent, exp, maint, sum, err: null });
    } catch (err) { rm.err = err.message; rm.props = rm.props || []; rm.tenants = rm.tenants || []; rm.tenancies = rm.tenancies || []; rm.rent = rm.rent || []; rm.exp = rm.exp || []; rm.maint = rm.maint || []; }
    rm.at = Date.now(); return rm;
  }

