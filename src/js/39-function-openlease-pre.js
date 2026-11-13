  // =====================================================================
  function openLease(pre) {
    const p = pre || {};
    const card = openModal(`<div class="v3e-page"><div class="eyebrow"><span></span> LEGAL &amp; DOCUMENTATION</div><h2>Lease &amp; Rental Agreement Generator</h2>
      <p class="modal-lead">Fill in the terms and RAQBO prepares a properly formatted agreement you can print, sign and keep.</p>
      <form class="modal-form rm-lease" data-rm-lease novalidate>
        <h3>Landlord</h3><div class="form-grid two"><label>Full name<input name="ll_name" required maxlength="120" value="${esc(p.ll_name || (db.session && db.session.name) || '')}"></label><label>CNIC<input name="ll_cnic" maxlength="20" placeholder="xxxxx-xxxxxxx-x"></label><label>Address<input name="ll_addr" maxlength="200"></label><label>Phone<input name="ll_phone" maxlength="40" value="${esc((db.session && db.session.phone) || '')}"></label></div>
        <h3>Tenant</h3><div class="form-grid two"><label>Full name<input name="tn_name" required maxlength="120" value="${esc(p.tn_name || '')}"></label><label>CNIC<input name="tn_cnic" maxlength="20"></label><label>Address<input name="tn_addr" maxlength="200"></label><label>Phone<input name="tn_phone" maxlength="40"></label></div>
        <h3>Property</h3><label>Property address<input name="addr" required maxlength="250" value="${esc(p.addr || '')}"></label>
        <label>Description (rooms, floor, fittings included)<textarea name="desc" rows="2" maxlength="600">${esc(p.desc || '')}</textarea></label>
        <h3>Terms</h3><div class="form-grid two"><label>Monthly rent (PKR)<input name="rent" type="number" min="1" required value="${esc(p.rent || '')}"></label><label>Security deposit (PKR)<input name="deposit" type="number" min="0" value="${esc(p.deposit || '')}"></label>
          <label>Advance rent (months)<input name="advance" type="number" min="0" max="36" value="${esc(p.advance || 0)}"></label><label>Rent due on day<input name="due_day" type="number" min="1" max="28" value="${esc(p.due_day || 5)}"></label>
          <label>Start date<input name="start" type="date" required value="${esc(p.start || '')}"></label><label>Lease length (months)<input name="months" type="number" min="1" max="240" value="${esc(p.months || 12)}"></label>
          <label>Yearly rent increase (%)<input name="esc_pct" type="number" min="0" max="100" step="0.5" value="${esc(p.esc_pct || 10)}"></label>
          <label>Maintenance paid by<select name="maint_by"><option value="tenant">Tenant</option><option value="landlord">Landlord</option><option value="shared">Shared</option></select></label>
          <label>Utility bills paid by<select name="util_by"><option value="tenant">Tenant</option><option value="landlord">Landlord</option><option value="shared">Shared</option></select></label>
          <label>Notice period (months)<input name="notice" type="number" min="0" max="12" value="1"></label></div>
        <label>Renewal conditions<textarea name="renewal" rows="2" maxlength="600">The lease may be renewed by mutual written agreement at least one month before it ends.</textarea></label>
        <label>Termination provisions<textarea name="termination" rows="2" maxlength="600">Either party may end this agreement by giving the notice stated above in writing.</textarea></label>
        <label>Other agreed terms<textarea name="other" rows="3" maxlength="2000" placeholder="Anything else the parties have agreed"></textarea></label>
        <div class="form-error" hidden></div>
        <div class="button-row"><button class="button button-primary" type="submit" data-go="preview">Generate &amp; preview</button><button class="button button-outline" type="submit" data-go="pdf">Download PDF</button><button class="button button-outline" type="submit" data-go="doc">Download editable document</button><button type="button" class="button button-ghost" data-rm="legal" data-matter="lease_tenancy">Request legal review</button></div></form>
      <div class="rm-leaseout" data-rm-leaseout></div>
      <div class="oa-legal"><b>Before you sign</b><p>This agreement is prepared from what you entered. Stamping, registration with the Rent Registrar and the way it must be signed depend on Pakistani law, the type of property and the length of the lease. RAQBO does not confirm that a digitally prepared agreement is legally complete — have it checked and executed properly. In Punjab, tenancies are also to be registered with the police: <a href="${RM_LINKS.trs}" target="_blank" rel="noopener nofollow">Punjab Police Tenant Registration System</a>.</p></div></div>`, { wide: true, label: 'Lease agreement generator' });
    card.classList.add('gw-card');
  }
  function rmLeaseText(d) {
    const end = d.start && d.months ? new Date(new Date(d.start + 'T00:00:00Z').setUTCMonth(new Date(d.start + 'T00:00:00Z').getUTCMonth() + (+d.months))).toISOString().slice(0, 10) : '';
    const money = (n) => (n ? rs(n) : '—');
    const by = { tenant: 'the Tenant', landlord: 'the Landlord', shared: 'the Landlord and the Tenant in equal shares' };
    return { end, html: `<h1>TENANCY AGREEMENT</h1>
<p>This Tenancy Agreement is made on ${esc(rmDay(rmToday()))} between:</p>
<p><b>THE LANDLORD:</b> ${esc(d.ll_name)}${d.ll_cnic ? `, CNIC ${esc(d.ll_cnic)}` : ''}${d.ll_addr ? `, of ${esc(d.ll_addr)}` : ''}${d.ll_phone ? `, telephone ${esc(d.ll_phone)}` : ''}.</p>
<p><b>THE TENANT:</b> ${esc(d.tn_name)}${d.tn_cnic ? `, CNIC ${esc(d.tn_cnic)}` : ''}${d.tn_addr ? `, of ${esc(d.tn_addr)}` : ''}${d.tn_phone ? `, telephone ${esc(d.tn_phone)}` : ''}.</p>
<h2>1. The property</h2><p>The Landlord lets to the Tenant the property at <b>${esc(d.addr)}</b>.${d.desc ? ' ' + esc(d.desc) : ''}</p>
<h2>2. Term</h2><p>The tenancy begins on <b>${esc(rmDay(d.start))}</b> and continues for <b>${esc(d.months)} months</b>${end ? `, ending on <b>${esc(rmDay(end))}</b>` : ''}.</p>
<h2>3. Rent</h2><p>The rent is <b>${esc(money(d.rent))} per month</b>, payable in advance on or before day <b>${esc(d.due_day)}</b> of each month.${+d.advance > 0 ? ` The Tenant has paid <b>${esc(d.advance)} month(s)</b> rent in advance.` : ''}</p>
<h2>4. Security deposit</h2><p>The Tenant has paid a security deposit of <b>${esc(money(d.deposit))}</b>. It is returned when the tenancy ends, after deducting any unpaid rent, unpaid bills and the cost of damage beyond fair wear and tear.</p>
<h2>5. Yearly increase</h2><p>${+d.esc_pct > 0 ? `The rent increases by <b>${esc(d.esc_pct)}%</b> on each anniversary of the start date.` : 'The rent does not increase during the term of this agreement.'}</p>
<h2>6. Maintenance</h2><p>Routine maintenance and minor repairs are the responsibility of ${esc(by[d.maint_by] || 'the Tenant')}. Structural repairs remain the responsibility of the Landlord.</p>
<h2>7. Utilities</h2><p>Electricity, gas, water, internet and other utility bills are paid by ${esc(by[d.util_by] || 'the Tenant')}. Meters are to be read at the start and end of the tenancy.</p>
<h2>8. Use of the property</h2><p>The Tenant will use the property for lawful purposes only, will not sub-let or part with possession without the Landlord's written consent, and will not make structural changes without written consent.</p>
<h2>9. Access</h2><p>The Landlord may inspect the property at reasonable times after giving the Tenant at least 24 hours' notice.</p>
<h2>10. Renewal</h2><p>${esc(d.renewal || 'The lease may be renewed by mutual written agreement.')}</p>
<h2>11. Termination</h2><p>Either party may end this agreement by giving <b>${esc(d.notice || 1)} month(s)</b> written notice. ${esc(d.termination || '')}</p>
${d.other ? `<h2>12. Other agreed terms</h2><p>${esc(d.other).replace(/\n/g, '<br>')}</p>` : ''}
<h2>${d.other ? '13' : '12'}. Registration</h2><p>The parties will comply with any requirement to stamp this agreement, to register it with the Rent Registrar and to register the Tenant with the police where the law requires it.</p>
<div class="sigs"><div><p>__________________________</p><p><b>LANDLORD</b><br>${esc(d.ll_name)}<br>Date: ____________</p></div><div><p>__________________________</p><p><b>TENANT</b><br>${esc(d.tn_name)}<br>Date: ____________</p></div></div>
<div class="sigs"><div><p>__________________________</p><p><b>WITNESS 1</b><br>Name &amp; CNIC: ____________<br>Date: ____________</p></div><div><p>__________________________</p><p><b>WITNESS 2</b><br>Name &amp; CNIC: ____________<br>Date: ____________</p></div></div>
<p class="foot">Prepared using RAQBO's lease agreement generator. RAQBO is not a law firm. Stamping, registration and execution requirements must be checked under the applicable law before this agreement is relied upon.</p>` };
  }
  const RM_LEASE_CSS = `body{font:13.5pt/1.65 Georgia,'Times New Roman',serif;max-width:760px;margin:36px auto;padding:0 26px;color:#111}h1{font-size:19pt;text-align:center;letter-spacing:.06em;margin:0 0 6px}h2{font-size:12.5pt;margin:20px 0 4px;text-transform:uppercase;letter-spacing:.04em}p{margin:6px 0;text-align:justify}.sigs{display:flex;gap:40px;margin-top:40px;page-break-inside:avoid}.sigs div{flex:1}.foot{margin-top:28px;font-size:9.5pt;color:#555;border-top:1px solid #ddd;padding-top:8px;text-align:left}@media print{body{margin:0}button{display:none}}`;
  function rmLeaseOpen(d, mode) {
    const { html } = rmLeaseText(d);
    if (mode === 'doc') {
  const T = (n) => '<' + '/' + n + '>';
      const docHtml = '<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">' + RM_TAG('style') + RM_LEASE_CSS + T('style') + T('head') + '<body>' + html + T('body') + T('html');
      const blob = new Blob([docHtml], { type: 'application/msword' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tenancy-agreement-${(d.tn_name || 'tenant').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.doc`; a.click(); return;
    }
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the agreement.'); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Tenancy agreement</title>${RM_TAG('style')}${RM_LEASE_CSS}${RM_END('style')}${html}<p style="text-align:center"><button onclick="print()">Print / save as PDF</button></p>`);
    w.document.close(); if (mode === 'pdf') setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 600);
  }

