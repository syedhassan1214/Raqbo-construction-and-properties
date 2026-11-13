  /* =====================================================================
     RAQBO control room (admin)
     Four sections that answer the questions an administrator actually asks:
       Members            who has listed what, and how much of it
       Possible duplicates  the same property posted twice — review, then remove
       Document status    which papers each advertiser holds, and what is missing
       Contact guard      who tried to take a deal off RAQBO
     ===================================================================== */
  const RQA = { q: '', member: null, tick: 0 };
  const rqaKey = (l) => String(l.ownerId || ('n:' + (l.ownerName || l.advertiser || 'Advertiser')));
  const rqaName = (l) => String(l.ownerName || l.advertiser || 'Advertiser');
  const rqaNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const rqaMoney = (n) => { try { return fmtPrice(n); } catch { return 'PKR ' + Number(n || 0).toLocaleString('en-US'); } };
  const rqaAll = () => db.listings || [];

  function rqaMembers() {
    const map = new Map();
    for (const l of rqaAll()) {
      const k = rqaKey(l);
      let m = map.get(k);
      if (!m) { m = { key: k, name: rqaName(l), role: l.role || '', id: l.ownerId || '', items: [], sale: 0, rent: 0, docs: 0, value: 0 }; map.set(k, m); }
      m.items.push(l);
      if (l.purpose === 'rent') m.rent++; else m.sale++;
      if (l.documents && l.documents.have) m.docs++;
      m.value += Number(l.price) || 0;
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  }

  // Two listings are "the same" when the property they describe is the same:
  // type, city, area, size and price all line up, or the titles match.
  function rqaDupes() {
    const by = new Map();
    for (const l of rqaAll()) {
      const sig = [rqaNorm(l.type), rqaNorm(l.city), rqaNorm(l.area), String(l.size || ''), rqaNorm(l.sizeUnit), Math.round((Number(l.price) || 0) / 10000)].join('|');
      const alt = rqaNorm(l.title).slice(0, 48);
      for (const key of [sig, 't:' + alt]) {
        if (!alt && key.startsWith('t:')) continue;
        let g = by.get(key);
        if (!g) { g = []; by.set(key, g); }
        if (!g.includes(l)) g.push(l);
      }
    }
    const seen = new Set(); const groups = [];
    for (const [key, g] of by) {
      if (g.length < 2) continue;
      const id = g.map((l) => String(l.id)).sort().join(',');
      if (seen.has(id)) continue;
      seen.add(id);
      groups.push({ key, items: g.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))) });
    }
    return groups.sort((a, b) => b.items.length - a.items.length);
  }

  const rqaSearchBox = (ph) => `<div class="rqa-search">${DI('<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path>', 16)}<input type="search" data-rqa-q value="${esc(RQA.q)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}"></div>`;
  const rqaShell = (title, sub, body, search) => `<div class="gwa"><div class="admin-head-row"><div><div class="eyebrow"><span></span> CONTROL ROOM</div><h2>${esc(title)}</h2><p class="admin-sub">${sub}</p></div><button type="button" class="admin-refresh" data-rqa="reload">Refresh</button></div>${search ? rqaSearchBox(search) : ''}${body}</div>`;
  const rqaK = (list) => `<div class="v3x-kpis v3x-kgrid">${list.map(([a, b]) => `<div class="v3x-kpi"><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('')}</div>`;
  const rqaRow = (l) => `<div class="rqa-l"><div class="rqa-l-main"><b>${esc(l.title || 'Untitled')}</b><small>${esc(l.ref || l.id)} · ${esc(l.type || '')} · ${esc([l.area, l.city].filter(Boolean).join(', '))} · ${esc(rqaMoney(l.price))}${l.purpose === 'rent' ? ' / month' : ''}${l.status ? ' · ' + esc(l.status) : ''}</small></div><div class="rqa-l-act"><button type="button" class="button button-outline" data-rqa="open" data-id="${esc(l.id)}">Open</button><button type="button" class="button button-danger" data-rqa="del" data-id="${esc(l.id)}">Delete</button></div></div>`;

  /* ---------------- members ---------------- */
  V3_ADMIN['rq-members'] = () => {
    const q = rqaNorm(RQA.q);
    let list = rqaMembers();
    if (q) list = list.filter((m) => rqaNorm(m.name).includes(q) || m.items.some((l) => rqaNorm(l.title).includes(q) || rqaNorm(l.ref).includes(q) || rqaNorm(l.city).includes(q)));
    const total = rqaAll().length;
    const open = RQA.member && list.find((m) => m.key === RQA.member);
    const body = open
      ? `<div class="rqa-back"><button type="button" class="button button-outline" data-rqa="unpick">${DI('<path d="M15 5l-7 7 7 7"></path>', 15)} All members</button></div>
         <div class="rqa-person"><span class="rqa-av">${esc(String(open.name).trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join(''))}</span><div><b>${esc(open.name)}</b><small>${esc(open.role || 'Advertiser')}${open.id ? ' · ' + esc(String(open.id).slice(0, 8)) : ''}</small></div></div>
         ${rqaK([['Listings', open.items.length], ['For sale', open.sale], ['For rent', open.rent], ['Total asking', rqaMoney(open.value)]])}
         <div class="rqa-list">${open.items.map(rqaRow).join('')}</div>`
      : list.length
        ? `${rqaK([['Members with listings', list.length], ['Listings in total', total], ['Average each', list.length ? (total / list.length).toFixed(1) : '0']])}
           <div class="rqa-grid">${list.map((m) => `<button type="button" class="rqa-card" data-rqa="pick" data-key="${esc(m.key)}">
              <span class="rqa-av">${esc(String(m.name).trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join(''))}</span>
              <span class="rqa-card-txt"><b>${esc(m.name)}</b><i>${esc(m.role || 'Advertiser')}</i></span>
              <span class="rqa-count">${m.items.length}<small>${m.items.length === 1 ? 'listing' : 'listings'}</small></span></button>`).join('')}</div>`
        : '<div class="admin-empty">No listings yet, so there is nobody to show.</div>';
    return rqaShell('Members', 'Everyone who has listed a property, and what they have listed. Open a member to see and review each one.', body, 'Search a member, a listing or a city');
  };

  /* ---------------- possible duplicates ---------------- */
  V3_ADMIN['rq-dupes'] = () => {
    const groups = rqaDupes();
    const extra = groups.reduce((n, g) => n + g.items.length - 1, 0);
    const body = groups.length
      ? `${rqaK([['Groups found', groups.length], ['Listings involved', groups.reduce((n, g) => n + g.items.length, 0)], ['Would be removed', extra]])}
         <p class="rqa-note">${DI('<path d="M12 4l9 16H3z"></path><path d="M12 10v4M12 17h.01"></path>', 14)}<span>These look like the same property posted more than once. Open each one and check before you remove it — the oldest is kept at the top.</span></p>
         ${groups.map((g, i) => `<div class="rqa-dupe"><div class="rqa-dupe-h"><b>Group ${i + 1}</b><small>${g.items.length} listings look the same</small></div>${g.items.map((l, j) => `<div class="rqa-dupe-i ${j === 0 ? 'keep' : ''}">${j === 0 ? '<span class="rqa-keep">Oldest — keep</span>' : '<span class="rqa-dup">Duplicate</span>'}${rqaRow(l)}</div>`).join('')}</div>`).join('')}`
      : '<div class="admin-empty">Nothing looks duplicated right now.</div>';
    return rqaShell('Spam & duplicates', 'The same property advertised twice, found by matching type, place, size and price — and by matching titles.', body);
  };

  /* ---------------- document status ---------------- */
  V3_ADMIN['rq-docs'] = () => {
    const q = rqaNorm(RQA.q);
    let list = rqaAll().filter((l) => l.documents && (l.documents.have || l.documents.missing));
    if (q) list = list.filter((l) => rqaNorm(l.title).includes(q) || rqaNorm(rqaName(l)).includes(q) || rqaNorm(l.ref).includes(q));
    const names = (keys) => (keys || []).map((k) => (typeof docLabel === 'function' ? docLabel(k) : k));
    const body = list.length
      ? `${rqaK([['Listings with a checklist', list.length], ['Nothing missing', list.filter((l) => !(l.documents.missing || []).length).length], ['Needs help', list.filter((l) => (l.documents.missing || []).length).length]])}
         <div class="rqa-list">${list.map((l) => `<div class="rqa-doc">
            <div class="rqa-doc-h"><b>${esc(l.title || 'Untitled')}</b><small>${esc(l.ref || l.id)} · ${esc(rqaName(l))}</small></div>
            <div class="rqa-doc-cols">
              <div><span class="rqa-tag ok">Has ${(l.documents.have || []).length}</span><ul>${names(l.documents.have).map((n) => `<li>${esc(n)}</li>`).join('') || '<li class="none">Nothing ticked</li>'}</ul></div>
              <div><span class="rqa-tag no">Missing ${(l.documents.missing || []).length}</span><ul>${names(l.documents.missing).map((n) => `<li>${esc(n)}</li>`).join('') || '<li class="none">Nothing missing</li>'}</ul></div>
            </div>
            ${(l.documents.missing || []).length ? `<p class="rqa-offer">${DI('<path d="M13 2L4 14h7l-1 8 9-12h-7z"></path>', 14)}<span>Offer this member: document drafting, registry help or RAQBO Verified.</span></p>` : ''}
            <div class="rqa-l-act"><button type="button" class="button button-outline" data-rqa="open" data-id="${esc(l.id)}">Open the listing</button></div>
          </div>`).join('')}</div>`
      : '<div class="admin-empty">No advertiser has filled in the document checklist yet. It appears on the listing form.</div>';
    return rqaShell('Document status', 'What papers each advertiser says they hold, and what is missing — so you know exactly which service to offer them.', body, 'Search a listing or a member');
  };

  /* ---------------- contact guard ---------------- */
  V3_ADMIN['rq-guard'] = () => {
    const log = (typeof window.rqGuardLog === 'function' ? window.rqGuardLog() : []) || [];
    const people = new Set(log.map((x) => x.email || x.who));
    const body = log.length
      ? `${rqaK([['Attempts blocked', log.length], ['People involved', people.size], ['Last one', log[0] ? new Date(log[0].at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—']])}
         <div class="rqa-list">${log.slice(0, 80).map((x) => `<div class="rqa-g">
            <div class="rqa-g-h"><b>${esc(x.who)}</b><small>${esc(x.where)} · ${esc(new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</small></div>
            <div class="rqa-g-hits">${(x.hits || []).map((h) => `<span class="rqa-tag no">${esc(h)}</span>`).join('')}</div>
            <p class="rqa-g-s">${esc(x.sample)}</p></div>`).join('')}</div>
         <div class="rqa-l-act"><button type="button" class="button button-outline" data-rqa="guard-clear">Clear the log</button></div>`
      : '<div class="admin-empty">Nobody has tried to share a phone number, a CNIC or a link. The guard is on.</div>';
    return rqaShell('Contact guard', 'Every attempt to pass a phone number, CNIC, email, link or social handle between members — stopped before it was saved.', body);
  };

  /* ---------------- tabs ---------------- */
  try {
    Object.assign(AX_ICON, { 'rq-members': 'users', 'rq-dupes': 'copy', 'rq-docs': 'doc', 'rq-guard': 'shield' });
    Object.assign(AX_HINT, {
      'rq-members': 'Who listed what, and how much of it',
      'rq-dupes': 'The same property posted twice — review, then remove',
      'rq-docs': 'Papers each member holds, and what is missing',
      'rq-guard': 'Attempts to take a deal off RAQBO'
    });
  } catch { /* icons are cosmetic */ }

  { const base = v3AdminTabs; v3AdminTabs = function () {
      const t = base();
      let dupes = 0, guard = 0;
      try { dupes = rqaDupes().reduce((n, g) => n + g.items.length - 1, 0); } catch { /* ignore */ }
      try { guard = (window.rqGuardLog() || []).length; } catch { /* ignore */ }
      t.push(['#rq', 'CONTROL ROOM'],
        ['rq-members', 'Members & listings', ''],
        ['rq-dupes', 'Spam &amp; duplicates', dupes || ''],
        ['rq-docs', 'Document status', ''],
        ['rq-guard', 'Contact guard', guard || '']);
      return t; }; }

  /* ---------------- actions ---------------- */
  document.addEventListener('input', (e) => {
    const i = e.target.closest('[data-rqa-q]');
    if (!i) return;
    RQA.q = i.value;
    clearTimeout(RQA.t);
    RQA.t = setTimeout(() => {
      const box = $('.ax-body', admin.el || document);
      if (box && V3_ADMIN[admin.tab]) {
        box.innerHTML = V3_ADMIN[admin.tab]();
        const f = $('[data-rqa-q]', box);
        if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch { /* ignore */ } }
      }
    }, 220);
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rqa]');
    if (!b) return;
    e.preventDefault();
    const act = b.dataset.rqa;
    const repaint = () => { const box = $('.ax-body', admin.el || document); if (box && V3_ADMIN[admin.tab]) box.innerHTML = V3_ADMIN[admin.tab](); };
    if (act === 'pick') { RQA.member = b.dataset.key; repaint(); return; }
    if (act === 'unpick') { RQA.member = null; repaint(); return; }
    if (act === 'reload') { try { await backend.reloadListings(); } catch { /* ignore */ } repaint(); return; }
    if (act === 'guard-clear') { if (window.rqGuardClear) window.rqGuardClear(); repaint(); return; }
    if (act === 'open') { const l = rqaAll().find((x) => String(x.id) === String(b.dataset.id)); if (l) { closeAdmin(); openDetails(l.id); } return; }
    if (act === 'del') {
      const l = rqaAll().find((x) => String(x.id) === String(b.dataset.id));
      if (!l) return;
      if (!window.confirm(`Delete "${l.title || l.ref}" permanently?\n\nThis cannot be undone.`)) return;
      const done = busy(b, 'Deleting…');
      try { await backend.deleteListing(l.id); await backend.reloadListings(); toast('Listing deleted.'); }
      catch (err) { toast(err.message); }
      done(); repaint(); try { renderGrid(); } catch { /* ignore */ }
    }
  });
