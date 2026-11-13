  /* =====================================================================
     Admin panel polish: icons, smart badges, breadcrumbs, welcome header,
     quick actions and a Ctrl+K command palette
     ===================================================================== */
  const AX_ICON = { overview: 'grid', pending: 'clock', published: 'home', rejected: 'x', enquiries: 'doc', reports: 'alert', verify: 'shield', 'mk-payments': 'bank', 'mk-disputes': 'scale', 'mk-vendors': 'store', 'mk-buyers': 'user', 'mk-orders': 'cart', growth: 'star', urgent: 'alert', investors: 'trend', auctions: 'gavel', reconcile: 'bank', business: 'edit', team: 'user', audit: 'list' };
  const AX_QUEUE = new Set(['pending', 'enquiries', 'reports', 'verify', 'mk-payments', 'mk-disputes', 'mk-vendors', 'mk-orders', 'growth', 'urgent', 'investors', 'auctions']);
  const AX_HINT = { overview: 'Live figures and what needs attention', pending: 'Approve or reject new listings', published: 'Live listings, roles and features', rejected: 'Listings sent back to owners', enquiries: 'Verification, legal and other service requests', reports: 'Listings reported by visitors', verify: 'Document checks and CNIC checks', 'mk-payments': 'Check payment proofs', 'mk-disputes': 'Order disputes', 'mk-vendors': 'Approve suppliers', 'mk-buyers': 'Material buyers', 'mk-orders': 'All material orders', growth: 'Rewards, referrals and campaign settings', urgent: 'QuickSell requests and offers', investors: 'Investor approvals', auctions: 'Schedules, bidders, bids and results', reconcile: 'Match payments to the bank statement', business: 'Fees, commissions and switches', team: 'Admins and permissions', audit: 'Permanent record of sensitive actions' };
  const axIcon = (k, s = 17) => DI(DIC[AX_ICON[k]] || GI[AX_ICON[k]] || DIC.info, s);
  function axSidebarItem(k, label, n) {
    const hot = AX_QUEUE.has(k) && Number(n) > 0;
    return `<button type="button" class="${admin.tab === k ? 'active' : ''}" data-tab="${k}" title="${esc(AX_HINT[k] || label)}"><span class="ax-ico">${axIcon(k)}</span><span class="ax-lbl">${esc(label)}</span>${n !== '' && Number(n) > 0 ? `<span class="admin-count ${hot ? 'hot' : ''}">${esc(n)}</span>` : ''}</button>`;
  }
  function axGroupOf(tabs, k) { let g = ''; for (const [key, label] of tabs) { if (key.startsWith('#')) g = label; else if (key === k) return [g, label]; } return ['', '']; }
  function axCrumbs(tabs) { const [g, label] = axGroupOf(tabs, admin.tab); return `<div class="ax-crumbs"><span>Admin</span>${g ? `<i>›</i><span>${esc(g.charAt(0) + g.slice(1).toLowerCase())}</span>` : ''}<i>›</i><b>${esc(label)}</b></div>`; }
  function axGreeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function axHero(tabs) {
    if (admin.tab !== 'overview') return '';
    const nm = (db.session && db.session.name || 'Admin').split(' ')[0];
    const q = tabs.filter(([k, , n]) => !k.startsWith('#') && AX_QUEUE.has(k) && Number(n) > 0);
    const total = q.reduce((s, [, , n]) => s + Number(n), 0);
    const qa = [['pending', 'Review listings'], ['verify', 'Verification'], ['mk-payments', 'Verify payments'], ['urgent', 'QuickSell'], ['auctions', 'Auctions'], ['reconcile', 'Bank statement']];
    return `<section class="ax-hero"><div class="ax-hero-txt"><small>${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</small><h1>${axGreeting()}, ${esc(nm)}</h1><p>${total ? `You have <b>${total}</b> item${total === 1 ? '' : 's'} waiting across ${q.length} section${q.length === 1 ? '' : 's'}.` : 'Everything is up to date. Nice work.'}</p></div>
      <div class="ax-quick">${qa.filter(([k]) => tabs.some(([t]) => t === k)).map(([k, t]) => { const n = (tabs.find(([x]) => x === k) || [])[2]; return `<button type="button" data-tab="${k}"><span>${axIcon(k, 18)}</span><b>${esc(t)}</b>${Number(n) > 0 ? `<em>${esc(n)}</em>` : ''}</button>`; }).join('')}</div></section>`;
  }
  // ---------- Command palette (Ctrl+K) ----------
  var axp = { el: null, items: [], i: 0, tabs: [] };
  function axPaletteOpen() {
    if (!admin.el || admin.el.hidden) return;
    if (!axp.el) { axp.el = document.createElement('div'); axp.el.className = 'ax-pal-back'; axp.el.innerHTML = `<div class="ax-pal" role="dialog" aria-label="Quick jump"><div class="ax-pal-in">${DI(DIC.search || DIC.info, 18)}<input type="search" placeholder="Jump to a section or search listings by title or reference…" aria-label="Search admin"><kbd>Esc</kbd></div><div class="ax-pal-list" role="listbox"></div><div class="ax-pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span></div></div>`; document.body.append(axp.el);
      axp.el.addEventListener('click', (e) => { if (e.target === axp.el) axPaletteClose(); const it = e.target.closest('[data-axp]'); if (it) axRun(+it.dataset.axp); });
      $('input', axp.el).addEventListener('input', axPaint); $('input', axp.el).addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { axp.i = Math.min(axp.items.length - 1, axp.i + 1); axHi(); e.preventDefault(); } else if (e.key === 'ArrowUp') { axp.i = Math.max(0, axp.i - 1); axHi(); e.preventDefault(); } else if (e.key === 'Enter') { axRun(axp.i); e.preventDefault(); } else if (e.key === 'Escape') axPaletteClose(); }); }
    axp.el.hidden = false; const i = $('input', axp.el); i.value = ''; axPaint(); setTimeout(() => i.focus(), 0);
  }
  function axPaletteClose() { if (axp.el) axp.el.hidden = true; }
  function axPaint() {
    const q = $('input', axp.el).value.trim().toLowerCase();
    const sec = axp.tabs.filter(([k]) => !k.startsWith('#')).map(([k, label, n]) => ({ kind: 'tab', k, label, sub: AX_HINT[k] || '', n }));
    const act = [{ kind: 'act', k: 'site', label: 'Back to the website', sub: 'Close the admin panel' }, { kind: 'act', k: 'refresh', label: 'Refresh data', sub: 'Reload everything from the database' }];
    let items = [...sec, ...act].filter((x) => !q || (x.label + ' ' + x.sub).toLowerCase().includes(q));
    if (q.length >= 2) items = items.concat(db.listings.filter((l) => ((l.title || '') + ' ' + (l.ref || '') + ' ' + (l.area || '') + ' ' + (l.ownerName || '')).toLowerCase().includes(q)).slice(0, 8).map((l) => ({ kind: 'listing', k: l.id, label: l.title, sub: `${l.ref || ''} · ${l.area}, ${l.city} · ${l.status}` })));
    axp.items = items; axp.i = 0;
    $('.ax-pal-list', axp.el).innerHTML = items.length ? items.map((x, i) => `<button type="button" role="option" data-axp="${i}" class="${i === 0 ? 'on' : ''}"><span class="ax-pal-ic">${x.kind === 'tab' ? axIcon(x.k, 16) : x.kind === 'listing' ? DI(DIC.home, 16) : DI(DIC.arrow || DIC.info, 16)}</span><span><b>${esc(x.label)}</b><small>${esc(x.sub)}</small></span>${Number(x.n) > 0 ? `<em>${esc(x.n)}</em>` : ''}<i>${x.kind === 'listing' ? 'Listing' : x.kind === 'tab' ? 'Section' : 'Action'}</i></button>`).join('') : '<p class="ax-pal-none">No matches.</p>';
  }
  function axHi() { $$('[data-axp]', axp.el).forEach((b, i) => b.classList.toggle('on', i === axp.i)); const on = $('[data-axp].on', axp.el); if (on) on.scrollIntoView({ block: 'nearest' }); }
  function axRun(i) {
    const x = axp.items[i]; if (!x) return; axPaletteClose();
    if (x.kind === 'tab') { admin.tab = x.k; renderAdmin(); admin.el.scrollTop = 0; }
    else if (x.kind === 'listing') openDetails(x.k);
    else if (x.k === 'site') closeAdmin(); else if (x.k === 'refresh') { if (LIVE) adminReload(); else renderAdmin(); toast('Refreshed.'); }
  }
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && admin.el && !admin.el.hidden) { e.preventDefault(); if (axp.el && !axp.el.hidden) axPaletteClose(); else axPaletteOpen(); } });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-ax-pal]')) axPaletteOpen(); });

