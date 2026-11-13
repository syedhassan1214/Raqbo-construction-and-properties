  // =====================================================================
  async function pnLoadDash(force) {
    if (!force && pn.dash && Date.now() - pn.dashAt < 20000) return pn.dash;
    try { pn.dash = await PN.dashboard(); pn.dashAt = Date.now(); pn.dashErr = ''; }
    catch (e) { pn.dashErr = e.message; pn.dash = pn.dash || { partner: null }; }
    return pn.dash;
  }

  MY.splice(MY.findIndex((m) => m.id === 'services'), 0,
    { id: 'partner', label: 'RAQBO Partner', icon: 'users',
      show: () => !!db.session,
      count: () => ((pn.dash && pn.dash.leads) || []).filter((l) => l.stage === 'assigned').length || '' });
  setTimeout(() => { if (db.session) pnLoadDash(true).then(() => { if (pf.my.open) renderMy && renderMy(); }, () => { }); }, 3200);

  MY_RENDER.partner = async () => {
    const d = await pnLoadDash(true);
    if (pn.dashErr) return `<div class="admin-empty">${esc(pn.dashErr)}</div>`;
    if (!d || !d.partner) {
      let app = null; try { app = await PN.mine(); } catch { /* ignore */ }
      return `${myHead('RAQBO PARTNER NETWORK', 'Become a RAQBO Partner', 'Your Local Expertise. Our Digital Platform. Shared Growth.')}
        ${app ? `<div class="pn-box"><b>Your application ${esc(app.ref || '')}</b><p>Stage: ${esc((PN_STEPS.find(([k]) => k === app.stage) || [, app.stage])[1])}. ${esc(app.stage_note || '')}</p>
          <div class="pn-cta"><button type="button" class="button button-light" data-pn="apply">See my application</button></div></div>`
          : `<div class="pn-box"><p>You are not a RAQBO partner yet. Partners work with RAQBO in their own city or locality, on property sales, rentals, leasing, verification, auctions and property management.</p>
          <div class="pn-cta"><button type="button" class="button button-primary" data-pn="apply">Apply to become a partner</button>
            <button type="button" class="button button-light" data-pn="opportunities">See the three categories</button>
            <button type="button" class="button button-ghost" data-pn="how">How partnership works</button></div></div>`}`;
    }
    const p = d.partner; const e = d.earnings || {}; const perf = d.performance || {};
    const leads = d.leads || []; const waiting = leads.filter((l) => l.stage === 'assigned');
    const tab = pn.tab || 'leads';
    const kpi = [['Open leads', leads.filter((l) => !['completed', 'lost', 'returned'].includes(l.stage)).length],
      ['Waiting for you', waiting.length], ['Live listings', (d.listings || []).filter((l) => l.status === 'published').length],
      ['Completed', perf.completed || 0], ['Earned', pnMoney(e.earned)], ['Waiting to be paid', pnMoney(e.pending)]];
    const tabs = [['leads', 'My leads'], ['properties', 'My properties'], ['customers', 'My customers'],
      ['transactions', 'My transactions'], ['earnings', 'My earnings'], ['performance', 'My performance'],
      ['territory', 'My territory'], ['training', 'Training'], ['profile', 'My profile']];
    return `${myHead('RAQBO PARTNER', esc(p.display_name), esc(p.designation || (PN_CAT[p.category] || {}).name || ''))}
      ${p.status !== 'active' ? `<p class="oa-alert">${DI(DIC.alert, 15)} Your partner account is <b>${esc(PN_PSTATUS[p.status] || p.status)}</b>.${p.status_note ? ' ' + esc(p.status_note) : ''}${!p.agreement_ok ? ' The agreement has to be executed before your account becomes active.' : ''}${!p.training_done ? ' The required training is not finished yet.' : ''}</p>` : ''}
      ${waiting.length ? `<p class="oa-alert">${DI(DIC.clock, 15)} ${waiting.length} new lead${waiting.length === 1 ? '' : 's'} waiting for you to accept. If you do not answer in time ${waiting.length === 1 ? 'it goes' : 'they go'} back to RAQBO.</p>` : ''}
      <div class="v3x-kpis v3x-kgrid">${kpi.map(([a, b]) => `<div class="v3x-kpi"><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('')}</div>
      <div class="rm-ctabs pn-tabs">${tabs.map(([k, t]) => `<button type="button" data-pn-tab="${k}" class="${tab === k ? 'active' : ''}">${esc(t)}${k === 'leads' && waiting.length ? `<em>${waiting.length}</em>` : ''}</button>`).join('')}</div>
      <div class="pn-tabbody">${pnDashBody(tab, d)}</div>
      <p class="pn-note">${esc(PN_NOTE_MONEY)}</p>`;
  };

  function pnDashBody(tab, d) {
    const p = d.partner; const leads = d.leads || [];
    if (tab === 'territory') {
      const t = d.territories || [];
      return `<h3>My territory</h3>
        ${t.length ? `<div class="pn-terrs">${t.map((x) => `<div class="pn-terr"><b>${esc(x.name)}</b><small>${esc(PN_LEVEL[x.level] || x.level)}${x.city ? ' · ' + esc(x.city) : ''}</small>
          <span class="pn-badge ${x.exclusive ? 'ok' : ''}">${x.exclusive ? 'Exclusive' : 'Non-exclusive'}</span><small>From ${esc(pnDate(x.from))}</small></div>`).join('')}</div>`
          : '<div class="admin-empty">RAQBO has not allocated an area to you yet.</div>'}
        <div class="pn-box"><b>What you are authorised to do</b>
          <div class="pn-pcard-svc">${(p.services || []).length ? (p.services || []).map((k) => `<span>${esc(PN_WORK_NAME[k] || k)}</span>`).join('') : '<span>RAQBO has not set your services yet</span>'}</div>
          <div class="pn-kv"><span>May take money for RAQBO</span><b>${p.may_collect_money ? 'Yes, under written authority' : 'No'}</b></div>
          <div class="pn-kv"><span>May run a RAQBO auction</span><b>${p.may_run_auction ? 'Yes, under written authority' : 'No'}</b></div>
          <div class="pn-kv"><span>Office branding</span><b>${p.office_branding ? 'Approved' : p.branding_approved ? 'Name only, no office branding' : 'Not approved yet'}</b></div></div>
        ${d.agreement ? `<div class="pn-box"><b>Agreement ${esc(d.agreement.ref || '')}</b>
          <div class="pn-kv"><span>Territory</span><b>${esc(d.agreement.territory_text || '—')}</b></div>
          <div class="pn-kv"><span>Exclusivity</span><b>${d.agreement.exclusivity === 'exclusive' ? 'Exclusive' : 'Non-exclusive'}</b></div>
          <div class="pn-kv"><span>Runs to</span><b>${esc(pnDate(d.agreement.ends_on))}</b></div>
          <div class="pn-kv"><span>Share of fee</span><b>${esc(d.agreement.commission_text || '—')}</b></div></div>` : ''}`;
    }
    if (tab === 'properties') {
      const l = d.listings || [];
      return `<h3>My properties</h3>
        <div class="pn-cta"><button type="button" class="button button-primary" data-pn="newlisting">${DI(DIC.plus, 15)} Submit a property</button>
          <button type="button" class="button button-light" data-pn="quicksell">${DI(DIC.alert, 15)} Send an QuickSell opportunity</button></div>
        <p class="pn-note">A property you submit is reviewed by RAQBO like any other. It is not verified merely because a partner sent it, and you must have the owner&rsquo;s authorisation before advertising.</p>
        ${l.length ? `<table class="gw-table"><thead><tr><th>Property</th><th>Where</th><th>Price</th><th>Status</th><th>Advert ends</th></tr></thead><tbody>
          ${l.map((x) => `<tr><td><b>${esc(x.title)}</b><br><small>${esc(x.ref || '')}</small></td><td>${esc([x.area, x.city].filter(Boolean).join(', '))}</td>
            <td>${esc(pnMoney(x.price))}</td><td>${esc(x.status)}</td><td>${esc(pnDate(x.expires))}</td></tr>`).join('')}</tbody></table>`
          : '<div class="admin-empty">You have not submitted a property yet.</div>'}`;
    }
    if (tab === 'customers') {
      const byKind = {};
      leads.forEach((l) => { (byKind[l.kind] = byKind[l.kind] || []).push(l); });
      const label = { buyer: 'Buyers', seller: 'Sellers', landlord: 'Landlords', tenant: 'Tenants', service: 'Service enquiries', commercial: 'Commercial', quicksell: 'QuickSells', auction: 'Auctions', other: 'Other' };
      return `<h3>My customers</h3>
        ${Object.keys(byKind).length ? Object.entries(byKind).map(([k, list]) => `<h4 class="pn-sub">${esc(label[k] || k)} (${list.length})</h4>
          <table class="gw-table"><thead><tr><th>Customer</th><th>Where</th><th>Stage</th><th>Since</th></tr></thead><tbody>
          ${list.map((l) => `<tr><td><b>${esc(l.customer_name || 'Not named')}</b><br><small>${esc(l.ref)}</small></td>
            <td>${esc([l.area, l.city].filter(Boolean).join(', ') || '—')}</td><td>${esc((PN_LEAD_STEPS.find(([s]) => s === l.stage) || [, l.stage])[1])}</td>
            <td>${esc(pnDate(l.created_at))}</td></tr>`).join('')}</tbody></table>`).join('')
          : '<div class="admin-empty">No customers yet. They appear here as RAQBO assigns them, and when you send your own.</div>'}
        <p class="pn-note">You can see only the customers RAQBO has given you or that you brought in yourself. RAQBO&rsquo;s wider customer list is not available to partners, and nothing here can be exported in bulk.</p>`;
    }
    if (tab === 'transactions') {
      const tx = d.transactions || [];
      return `<h3>My transactions</h3>
        ${tx.length ? `<table class="gw-table"><thead><tr><th>Reference</th><th>Service</th><th>Fee received</th><th>Stage</th><th>Completed</th></tr></thead><tbody>
          ${tx.map((x) => `<tr><td><b>${esc(x.ref)}</b><br><small>${esc(x.description || '')}</small></td><td>${esc(x.service || '—')}</td>
            <td>${esc(pnMoney(x.fee_received))}</td><td>${esc(x.stage)}</td><td>${esc(pnDate(x.completed_on))}</td></tr>`).join('')}</tbody></table>`
          : '<div class="admin-empty">No transaction has been recorded against you yet.</div>'}`;
    }
    if (tab === 'earnings') {
      const cm = d.commissions || []; const po = d.payouts || []; const e = d.earnings || {};
      return `<h3>My earnings</h3>
        <div class="v3x-kpis v3x-kgrid">${[['Earned', pnMoney(e.earned)], ['Waiting to be paid', pnMoney(e.pending)], ['Paid to me', pnMoney(e.paid)], ['Being reviewed', pnMoney(e.disputed)]]
          .map(([a, b]) => `<div class="v3x-kpi"><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('')}</div>
        <div class="pn-cta"><form class="pn-stmt" data-pn-form="statement"><label>From<input type="date" name="from" value="${esc(new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10))}"></label>
          <label>To<input type="date" name="to" value="${esc(new Date().toISOString().slice(0, 10))}"></label>
          <button type="submit" class="button button-light">${DI(DIC.download, 15)} Download statement</button></form></div>
        ${cm.length ? `<table class="gw-table"><thead><tr><th>Commission</th><th>Share</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
          ${cm.map((c) => `<tr><td><b>${esc(c.ref)}</b><br><small>on ${esc(pnMoney(c.distributable))} after deductions</small></td>
            <td>${esc(c.rate_pct)}%</td><td><b>${esc(pnMoney(c.amount))}</b></td><td>${esc(c.status)}</td>
            <td>${['pending', 'approved'].includes(c.status) ? `<button type="button" class="button button-ghost" data-pn="dispute" data-k="${esc(c.ref)}">Query this</button>` : ''}</td></tr>`).join('')}</tbody></table>`
          : '<div class="admin-empty">No commission yet. It appears once RAQBO has received the fee on a transaction you worked on.</div>'}
        ${po.length ? `<h4 class="pn-sub">Payments to me</h4><table class="gw-table"><thead><tr><th>Payment</th><th>Period</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>
          ${po.map((o) => `<tr><td>${esc(o.ref)}</td><td>${esc(pnDate(o.period_from))} – ${esc(pnDate(o.period_to))}</td><td>${esc(pnMoney(o.amount))}</td><td>${esc(o.status)}</td><td>${esc(o.reference || '—')}</td></tr>`).join('')}</tbody></table>` : ''}`;
    }
    if (tab === 'performance') {
      const f = d.performance || {};
      const rows = [['Genuine listings submitted', f.listings], ['Live listings', f.listings_live], ['Leads received', f.leads_total],
        ['Leads I brought in', f.leads_generated], ['Leads accepted', f.leads_accepted], ['Leads that went back to RAQBO', f.leads_returned],
        ['Site inspections', f.visits], ['Transactions completed', f.completed], ['Service revenue generated', pnMoney(f.revenue)],
        ['Average time to accept a lead', f.response_hours == null ? '—' : f.response_hours + ' hours'], ['Complaints', f.complaints]];
      return `<h3>My performance</h3>
        <table class="gw-table"><tbody>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td><b>${esc(b == null ? 0 : b)}</b></td></tr>`).join('')}</tbody></table>
        <p class="pn-note">These are counted from real records only — listings, leads, visits and completed transactions. Nothing here is an estimate.</p>`;
    }
    if (tab === 'training') {
      const t = d.training || [];
      const done = t.filter((x) => x.done).length;
      return `<h3>Training</h3>
        <p class="admin-sub">${esc(done)} of ${esc(t.length)} finished.${done < t.length ? ' Your account becomes active once the required topics are done.' : ' All done.'}</p>
        <div class="pn-train">${t.map((x) => `<div class="pn-trainrow ${x.done ? 'done' : ''}">
          <div><b>${esc(x.title)}</b>${x.body ? `<p>${esc(x.body)}</p>` : ''}</div>
          ${x.done ? `<span class="pn-badge ok">${DI(DIC.check, 14)} Done</span>`
            : `<button type="button" class="button button-light" data-pn="train" data-k="${esc(x.code)}">Mark as read</button>`}</div>`).join('')}</div>`;
    }
    if (tab === 'profile') {
      return `<h3>My profile</h3>
        <div class="pn-photo-row">
          ${pnAvatar(p, 72)}
          <div><b>Your photograph</b>
            <p class="pn-note">Shown on your public profile in the RAQBO partner directory.</p>
            <form class="pn-photo-form" data-pn-form="photo">
              <input type="file" name="photo" accept="image/png,image/jpeg,image/webp">
              <button type="submit" class="button button-light">${p.photo_path ? 'Change photograph' : 'Add a photograph'}</button>
              ${p.photo_path ? '<button type="button" class="button button-text" data-pn="photo-clear">Remove</button>' : ''}
            </form></div>
        </div>
        <form class="pn-form" data-pn-form="profile">
          <div class="pn-grid">
            <label>Phone<input name="phone" value="${esc(p.phone || '')}" maxlength="20"></label>
            <label>WhatsApp<input name="whatsapp" value="${esc(p.whatsapp || '')}" maxlength="20"></label>
            <label>Email<input name="email" type="email" value="${esc(p.email || '')}" maxlength="160"></label>
            <label>Office address<input name="office_address" value="${esc(p.office_address || '')}" maxlength="300"></label>
          </div>
          <label>About your business<textarea name="about" rows="3" maxlength="1200">${esc(p.about || '')}</textarea></label>
          <label class="chip-check"><input type="checkbox" name="listed" ${p.listed === false ? '' : 'checked'}> Show me in the public RAQBO partner directory</label>
          <div class="pn-cta"><button type="submit" class="button button-primary">Save</button></div>
        </form>
        <div class="pn-box pn-qrbox"><b>Your QR code</b>
          <p>Anyone can check your current RAQBO status with this code. Put it on your card, your signboard or your office window.</p>
          <div class="pn-qrrow">
            <div class="pn-qr" data-pn-qr="${esc(pnCheckUrl(p.qr_token))}">${DI(DIC.shield, 22)}</div>
            <div>
              <div class="pn-kv"><span>Partner ID</span><b>${esc(p.partner_id)}</b></div>
              <div class="pn-kv"><span>Check link</span><b class="pn-qrlink">${esc(pnCheckUrl(p.qr_token))}</b></div>
              <div class="pn-cta">
                <button type="button" class="button button-light" data-pn="qr" data-k="${esc(p.qr_token || '')}">See what a visitor sees</button>
                <button type="button" class="button button-ghost" data-pn="qr-print" data-k="${esc(p.qr_token || '')}">Print a card</button>
              </div>
            </div>
          </div></div>
        <p class="pn-note">Your category, area, designation and permissions are set by RAQBO and cannot be changed here.</p>`;
    }
    // leads (default)
    const open = leads.filter((l) => !['completed', 'lost'].includes(l.stage));
    const closed = leads.filter((l) => ['completed', 'lost'].includes(l.stage));
    const row = (l) => `<tr>
      <td><b>${esc(l.customer_name || 'Not named')}</b><br><small>${esc(l.ref)} · ${esc(l.kind)}${l.service ? ' · ' + esc(l.service) : ''}</small>
        ${l.customer_note ? `<br><small>${esc(l.customer_note)}</small>` : ''}</td>
      <td>${esc([l.area, l.city].filter(Boolean).join(', ') || '—')}</td>
      <td>${esc((PN_LEAD_STEPS.find(([s]) => s === l.stage) || [, l.stage])[1])}${l.stage === 'assigned' && l.accept_by ? `<br><small>Answer by ${esc(new Date(l.accept_by).toLocaleString('en-GB'))}</small>` : ''}</td>
      <td class="pn-leadacts">
        ${l.stage === 'assigned' ? `<button type="button" class="button button-primary" data-pn="accept" data-k="${esc(l.ref)}">Accept</button>
          <button type="button" class="button button-ghost" data-pn="decline" data-k="${esc(l.ref)}">Decline</button>` : ''}
        ${['accepted', 'contacted', 'site_visit', 'negotiation'].includes(l.stage) ? `<select data-pn-stage="${esc(l.ref)}">
          <option value="">Move to…</option>${[['contacted', 'Contacted the customer'], ['site_visit', 'Site visit done'], ['negotiation', 'In negotiation'], ['completed', 'Transaction completed'], ['lost', 'Did not go ahead']]
            .map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select>` : ''}
      </td></tr>`;
    return `<h3>My leads</h3>
      ${open.length ? `<table class="gw-table"><thead><tr><th>Customer</th><th>Where</th><th>Stage</th><th>Next</th></tr></thead><tbody>${open.map(row).join('')}</tbody></table>`
        : '<div class="admin-empty">Nothing waiting. RAQBO sends customers in your area to you here, and you can bring in your own.</div>'}
      ${closed.length ? `<h4 class="pn-sub">Finished</h4><table class="gw-table"><tbody>${closed.map(row).join('')}</tbody></table>` : ''}
      <p class="pn-note">A lead you do not accept in time goes back to RAQBO to be given to another partner. RAQBO may also deal with any customer directly.</p>`;
  }

