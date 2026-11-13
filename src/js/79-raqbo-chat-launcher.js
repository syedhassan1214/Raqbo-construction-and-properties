  /* =====================================================================
     RAQBO chat launcher — the gold bubble at the bottom right.
     Replaces the old WhatsApp float: it opens a small RAQBO panel with the
     things people actually come to ask, and a direct line to the team.
     ===================================================================== */
  const RQF = {};
  const rqIco = (d, s = 18) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const RQ_I = {
    search: rqIco('<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path>'),
    tag: rqIco('<path d="M3 10.5L12 4l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"></path><path d="M9.5 21v-6h5v6"></path>'),
    shield: rqIco('<path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6z"></path><path d="M9 12l2 2 4-4"></path>'),
    truck: rqIco('<path d="M3 7h11v9H3z"></path><path d="M14 10h4l3 3v3h-7z"></path><circle cx="7" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle>'),
    users: rqIco('<circle cx="9" cy="8" r="3"></circle><path d="M3 20a6 6 0 0 1 12 0"></path><path d="M16 8h5M18.5 5.5v5"></path>'),
    chat: rqIco('<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"></path>'),
    lock: rqIco('<rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>', 13),
    x: rqIco('<path d="M6 6l12 12M18 6L6 18"></path>', 17)
  };
  const RQ_OPTS = [
    ['search', 'Find a property', 'Browse everything on RAQBO', 'data-action="all"'],
    ['tag', 'Sell or rent out', 'Advertise your property free', 'data-action="list"'],
    ['shield', 'Verification &amp; legal help', 'Papers checked before you pay', 'data-action="services"'],
    ['truck', 'Construction materials', 'Order from checked suppliers', 'data-action="market"'],
    ['users', 'Become a RAQBO partner', 'Run RAQBO in your own area', 'data-pn="home"']
  ];

  function rqPanel() {
    if (RQF.el) return RQF.el;
    const p = document.createElement('div');
    p.className = 'rq-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Chat with RAQBO');
    p.hidden = true;
    p.innerHTML = `<div class="rq-head">
        <img src="assets/logo-emblem.webp" alt="" width="30" height="26">
        <span><b>RAQBO</b><small>We usually reply the same day</small></span>
        <button type="button" class="rq-x" data-rqchat="close" aria-label="Close">${RQ_I.x}</button>
      </div>
      <div class="rq-body">
        <p class="rq-hi"><b>Assalam o alaikum 👋</b>What would you like help with today?</p>
        <div class="rq-opts">${RQ_OPTS.map(([i, t, s, attr]) => `<button type="button" class="rq-opt" ${attr}>${RQ_I[i]}<span>${t}<i>${s}</i></span></button>`).join('')}</div>
      </div>
      <div class="rq-foot">
        <button type="button" class="button button-primary" data-chat="support">${RQ_I.chat} Message the RAQBO team</button>
        <p class="rq-safe">${RQ_I.lock}<span>Keep every conversation on RAQBO. We never ask for your password, and we never ask you to pay anyone outside the platform.</span></p>
      </div>`;
    document.body.appendChild(p);
    RQF.el = p;
    return p;
  }
  function rqOpen() {
    const p = rqPanel();
    p.hidden = false;
    RQF.open = true;
    const fab = $('.rq-fab');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    const first = $('.rq-opt', p);
    if (first) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch { /* ignore */ } }, 60);
  }
  function rqClose() {
    if (RQF.el) RQF.el.hidden = true;
    RQF.open = false;
    const fab = $('.rq-fab');
    if (fab) fab.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rqchat]');
    if (b) {
      e.preventDefault();
      if (b.dataset.rqchat === 'close') rqClose(); else if (RQF.open) rqClose(); else rqOpen();
      return;
    }
    if (!RQF.open) return;
    // any choice inside the panel does its job, then the panel steps out of the way
    if (RQF.el && RQF.el.contains(e.target)) { if (e.target.closest('.rq-opt,[data-chat]')) setTimeout(rqClose, 10); return; }
    rqClose();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && RQF.open) rqClose(); });
  window.addEventListener('hashchange', () => { if (RQF.open) rqClose(); });
