  // =====================================================================
  function openTax(pre) {
    closeNavMenus();
    const card = openModal(`<div class="v3e-page rm-tax"><div class="eyebrow"><span></span> PROPERTY TOOLS</div><h2>Property Stamp Duty &amp; Tax Calculator</h2>
      <p class="modal-lead">Estimate Property Transfer Taxes, Stamp Duty &amp; Registration Costs.</p>
      <div class="rm-official"><h3>${DI(DIC.shield, 17)} Official government sources</h3>
        <p class="form-hint">RAQBO is not a government body. Always confirm the amount payable with the official portal before paying.</p>
        <div class="button-row"><a class="button button-primary" href="${RM_LINKS.stamp}" target="_blank" rel="noopener nofollow" data-rm-track="stamp">Calculate Stamp Duty — Punjab Government Portal</a>
          <a class="button button-outline" href="${RM_LINKS.fbr}" target="_blank" rel="noopener nofollow">View Current Property Tax Rates — FBR</a>
          <a class="button button-ghost" href="${RM_LINKS.stampInfo}" target="_blank" rel="noopener nofollow">e-Stamp guidance</a></div></div>
      <h3>RAQBO estimate</h3>
      <form class="modal-form" data-rm-tax>
        <div class="form-grid two"><label>Province<select name="province">${RM_PROV.map((p) => `<option ${p === (pre && pre.province || 'Punjab') ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
          <label>District / city<input name="district" value="${esc((pre && pre.city) || '')}" placeholder="e.g. Lahore"></label>
          <label>Property category<select name="category"><option value="residential">Residential</option><option value="commercial" ${pre && pre.commercial ? 'selected' : ''}>Commercial</option><option value="industrial">Industrial</option><option value="agricultural">Agricultural</option><option value="any">Any</option></select></label>
          <label>You are the<select name="side"><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="both">Both sides (total)</option></select></label>
          <label>Sale / purchase price (PKR)<input name="price" type="number" min="0" value="${esc((pre && pre.price) || '')}"></label>
          <label>Official valuation (PKR, if known)<input name="valuation" type="number" min="0"></label>
          <label>Tax status<select name="filer"><option value="1">On the active taxpayer list (filer)</option><option value="0">Not on the list (non-filer)</option></select></label>
          <label>Transaction date<input name="on" type="date" value="${esc(rmToday())}"></label></div>
        <label class="check-row"><input type="checkbox" name="overseas"> I am an overseas Pakistani (may change which rates and exemptions apply)</label>
        <div class="form-error" hidden></div>
        <button class="button button-primary modal-submit" type="submit">Estimate the cost</button></form>
      <div data-rm-taxout></div>
      <div class="oa-legal"><b>Important</b><p>${esc(RM_DISCLAIMER)}</p></div></div>`, { wide: true, label: 'Stamp duty & tax calculator' });
    card.classList.add('gw-card');
  }
  function rmTaxOut(host, r, side, overseas) {
    if (!r || !r.ok) { host.innerHTML = `<div class="admin-empty">${esc((r && r.why) || 'Could not work this out.')}<div class="button-row"><a class="button button-outline" href="${RM_LINKS.stamp}" target="_blank" rel="noopener nofollow">Use the official Punjab portal</a></div></div>`; return; }
    const buyer = [['Stamp duty', r.stamp_duty], ['Registration charges', r.registration], ['Transfer / local-government fee', r.local_fee], ['Other charges', r.other], ['Buyer advance income tax', r.buyer_tax]];
    const seller = [['Seller advance income tax', r.seller_tax]];
    const rows = (a) => a.filter((x) => x[1] > 0).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(rs(v))}</td></tr>`).join('') || '<tr><td colspan="2">Nothing recorded for this side.</td></tr>';
    host.innerHTML = `<div class="rm-taxout">
      <p class="rm-basis">Worked out on <b>${esc(rs(r.basis_amount))}</b> (${esc(r.basis === 'higher' ? 'the higher of price and official valuation' : r.basis === 'price' ? 'the price you entered' : 'the official valuation')}) · rates effective from ${esc(rmDay(r.effective_from))}${r.source_note ? ' · ' + esc(r.source_note) : ''}</p>
      <div class="rm-twocol">
        ${side !== 'seller' ? `<div><h4>Buyer pays</h4><table class="gw-table"><tbody>${rows(buyer)}<tr class="rm-total"><td><b>Buyer total</b></td><td><b>${esc(rs(r.buyer_total))}</b></td></tr></tbody></table></div>` : ''}
        ${side !== 'buyer' ? `<div><h4>Seller pays</h4><table class="gw-table"><tbody>${rows(seller)}<tr class="rm-total"><td><b>Seller total</b></td><td><b>${esc(rs(r.seller_total))}</b></td></tr></tbody></table></div>` : ''}</div>
      ${side === 'both' ? `<p class="rm-grand">Estimated total transaction cost: <b>${esc(rs(r.total))}</b></p>` : ''}
      ${overseas ? '<p class="oa-alert">' + DI(DIC.info, 14) + ' Overseas Pakistanis may qualify for different rates or exemptions. Confirm your position with FBR or your tax adviser.</p>' : ''}
      <div class="button-row"><a class="button button-outline" href="${RM_LINKS.stamp}" target="_blank" rel="noopener nofollow">Confirm on the Punjab e-Stamp portal</a><a class="button button-ghost" href="${RM_LINKS.fbr}" target="_blank" rel="noopener nofollow">FBR rate card</a></div></div>`;
  }

