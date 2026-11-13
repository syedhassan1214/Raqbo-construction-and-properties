  // =====================================================================
  function openPartnerHow() {
    closeNavMenus();
    const card = openModal('<div class="pn-page"></div>', { wide: true, label: 'How partnership works' });
    card.classList.add('gw-card', 'ax-modal');
    try { if (location.hash !== '#partner-how') history.replaceState(null, '', '#partner-how'); } catch { /* ignore */ }
    const host = $('.pn-page', card);
    const hours = ((pn.pub || {}).settings || {}).lead_accept_hours || 24;
    host.innerHTML = `
      <div class="pn-head"><span class="rail-kicker">${DI(DIC.list, 14)} HOW PARTNERSHIP WORKS</span>
        <h2>From application to your first completed transaction</h2>
        <p class="admin-sub">RAQBO does not appoint every applicant. The steps below are the same for everyone.</p></div>

      <h3 class="pn-h">Becoming a partner</h3>
      <ol class="pn-steps">${PN_STEPS.map(([, t], i) => `<li><span>${i + 1}</span><b>${esc(t)}</b></li>`).join('')}</ol>
      <div class="pn-box"><b>What RAQBO looks at</b><ul>${PN_ASSESS.map(([, t]) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <p class="pn-note">Every approved partner receives a unique RAQBO Partner ID. An approval is not complete until the agreement has been signed — and the partner account only opens once the training is finished.</p>

      <h3 class="pn-h">What the agreement will cover</h3>
      <ol class="pn-16">${PN_AGREEMENT_ITEMS.map(([, t]) => `<li>${esc(t)}</li>`).join('')}</ol>
      <p class="pn-note">Separate standard agreements are prepared for each category, and all are legally reviewed before any appointment.</p>

      <h3 class="pn-h">How a customer reaches you</h3>
      <ol class="pn-steps pn-steps-lead">${PN_LEAD_STEPS.map(([, t], i) => `<li><span>${i + 1}</span><b>${esc(t)}</b></li>`).join('')}<li><span>9</span><b>Commission settlement</b></li></ol>
      <div class="pn-box"><b>How RAQBO decides who gets a customer</b><ul>
        <li>Where the property or customer is</li><li>The kind of service needed</li><li>What the partner is authorised to handle</li>
        <li>Whether the partner is available</li><li>Previous performance</li><li>How much the partner already has open</li>
        <li>Any conflict of interest</li></ul>
        <p class="pn-note">If an assigned partner does not respond within ${esc(hours)} hours, the customer goes back to RAQBO to be given to someone else. RAQBO may also deal with any customer directly.</p></div>

      <h3 class="pn-h">How you are paid</h3>
      <div class="pn-box"><ul>
        <li>Commission is worked out on the service fee, not on the property value.</li>
        <li>Nothing becomes payable until RAQBO has actually received the fee.</li>
        <li>Taxes, refunds and third-party charges are shown as separate deductions.</li>
        <li>Whoever generated the customer is recorded on the file.</li>
        <li>The share is agreed before the work, not after it.</li>
        <li>Payments are made through traceable banking channels only.</li>
        <li>You can download a statement for any period.</li>
        <li>If you disagree with a figure you can query it, and the query is reviewed and answered.</li>
        <li>No partner is entitled to a share merely because a property sits in their area, unless the agreement says so.</li>
      </ul></div>

      <h3 class="pn-h">Training before you start</h3>
      <div class="pn-traingrid">${PN_TRAIN_FALLBACK.map(([, t]) => `<span>${esc(t)}</span>`).join('')}</div>

      <h3 class="pn-h">Using the RAQBO name</h3>
      <div class="pn-box"><ul>
        <li>A full franchise partner may use approved RAQBO office branding.</li>
        <li>An Area Partner uses a limited designation, such as <b>RAQBO Authorised Area Partner — [Area]</b> or <b>RAQBO Partner Network — [City]</b>.</li>
        <li>The designation must reflect the partner&rsquo;s real contractual status.</li>
        <li>RAQBO approves every logo, signboard, social-media advertisement, business card and piece of stationery.</li>
        <li>No applicant may use the RAQBO name before receiving written approval.</li>
      </ul></div>

      <h3 class="pn-h">What a partner may never do</h3>
      <div class="pn-box pn-box-warn"><ul>
        <li>Take property purchase money into a personal account on RAQBO&rsquo;s behalf.</li>
        <li>Collect deposits or promise investments without express lawful authority.</li>
        <li>Run a RAQBO-branded auction or take auction deposits without specific written authority.</li>
        <li>Act as an official auction officer or a government representative.</li>
        <li>Download or pass on RAQBO&rsquo;s customer information.</li>
        <li>Commit RAQBO to anything the agreement does not allow.</li>
      </ul></div>
      <p class="pn-note">${esc(PN_NOTE_MONEY)}</p>
      <div class="pn-cta"><button type="button" class="button button-primary" data-pn="apply">Apply to Become a Partner</button></div>`;
    applyBrandIcons(host);
  }

