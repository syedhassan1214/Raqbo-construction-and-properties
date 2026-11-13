  /* =====================================================================
     RAQBO control room (admin)
     Four sections that answer the questions an administrator actually asks:
       Members            who has listed what, and how much of it
       Possible duplicates  the same property posted twice — review, then remove
       Document status    which papers each advertiser holds, and what is missing
       Contact guard      who tried to take a deal off RAQBO
     ===================================================================== */
  const RQA = { q: '', member: null, review: null, tick: 0 };
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
  function rqaModerationActions(l) {
    return `<div class="rqa-l-act"><button type="button" class="button button-outline" data-rqa="review" data-id="${esc(l.id)}">Review</button><button type="button" class="button button-outline" data-rqa="edit" data-id="${esc(l.id)}">Edit</button><button type="button" class="button button-outline" data-rqa="note" data-id="${esc(l.id)}">Send note</button><button type="button" class="button button-danger" data-rqa="moderate-delete" data-id="${esc(l.id)}">Delete</button></div>`;
  }
  async function rqaPerform(id, action, data) {
    const l = byId(id);
    if (!l) throw new Error('This listing is no longer available.');
    if (SB) {
      const { data: result, error } = await SB.rpc('admin_moderate_listing', { p_listing: id, p_action: action, p_data: data });
      if (error) throw new Error(error.message || 'The moderation action failed.');
      let warning = '';
      if (action === 'delete' && result && result.paths && result.paths.length) {
        const paths = result.paths.flatMap((path) => [path, path + THUMB]);
        try {
          const { error: storageError } = await SB.storage.from(BUCKET).remove(paths);
          if (storageError) warning = 'Listing deleted, but media cleanup failed: ' + storageError.message;
        } catch (err) { warning = 'Listing deleted, but media cleanup failed: ' + err.message; }
      }
      try { await backend.adminLoad(); }
      catch (err) { throw new Error('Action completed, but the dashboard could not refresh: ' + err.message); }
      return warning;
    }
    if (action === 'edit') {
      const previous = { ...l };
      Object.assign(l, data);
      if (!store.set('listings', db.listings)) { Object.assign(l, previous); throw new Error('Could not save this listing in the demo browser.'); }
    } else if (action === 'note') {
      if (!l.ownerId) throw new Error('This listing has no advertiser account to notify.');
      const previous = l.reviewNote; l.reviewNote = data.note;
      if (!store.set('listings', db.listings)) { l.reviewNote = previous; throw new Error('Could not save this note in the demo browser.'); }
      const previousIds = new Set(store.get('live', { n: [] }).n.map((n) => n.id));
      lvLocal.notify(l.ownerId, 'listing', 'A note about your listing', data.note.slice(0, 400), '#my/properties');
      if (!store.get('live', { n: [] }).n.some((n) => !previousIds.has(n.id) && n.user_id === l.ownerId && n.body === data.note.slice(0, 400))) throw new Error('Note saved, but the notification could not be stored in this browser.');
    } else if (action === 'delete') {
      const index = db.listings.indexOf(l);
      db.listings.splice(index, 1);
      if (!store.set('listings', db.listings)) { db.listings.splice(index, 0, l); throw new Error('Could not delete this listing in the demo browser.'); }
      db.reports = db.reports.filter((r) => r.listingId !== id);
      if (!store.set('reports', db.reports)) throw new Error('Listing deleted, but reports could not be updated in this browser.');
      db.favorites = db.favorites.filter((x) => x !== id);
      if (!store.set('favorites', db.favorites)) throw new Error('Listing deleted, but favorites could not be updated in this browser.');
      try { await media.remove([...l.photos, ...l.videos].filter((m) => !m.src).map((m) => m.id)); }
      catch (err) { throw new Error('Listing deleted, but media cleanup failed: ' + err.message); }
    } else throw new Error('Unknown moderation action.');
    return '';
  }
  function rqaModerationForm(l, action) {
    const editing = action === 'edit';
    const card = openModal(`<div class="eyebrow"><span></span> PROPERTY MODERATION</div><h2>${editing ? 'Edit listing' : 'Send a note to the advertiser'}</h2><p class="modal-lead">${esc(l.title)} · ${esc(l.ref || l.id)}</p>
      <form class="modal-form" data-rqa-form>
        ${editing ? `<label>Title<input name="title" minlength="5" maxlength="80" required value="${esc(l.title)}"></label>
          <label>Description<textarea name="description" minlength="20" maxlength="2000" required>${esc(l.description)}</textarea></label>
          <div class="modal-form-row"><label>City<input name="city" maxlength="60" required value="${esc(l.city)}"></label><label>Area<input name="area" maxlength="120" required value="${esc(l.area)}"></label></div>
          <div class="modal-form-row"><label>Size<input name="size" type="number" min="0.01" step="any" required value="${esc(l.size)}"></label><label>Size unit<select name="sizeUnit">${['Marla', 'Kanal', 'sq ft', 'sq yd', 'Acre'].map((v) => `<option ${v === l.sizeUnit ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
          <label>Price (PKR)<input name="price" type="number" min="1" step="1" required value="${esc(l.price)}"></label>
          <p class="form-hint">This edits the text, location, size and price. Photos and other details are not changed.</p>` : '<label>Note<textarea name="note" maxlength="1000" required></textarea></label><p class="form-hint">The advertiser receives this note in an in-app notification.</p>'}
        <div class="form-error" hidden></div><button type="submit" class="button button-primary">${editing ? 'Save changes' : 'Send note'}</button>
      </form>`, { label: editing ? 'Edit listing' : 'Send note' });
    const form = $('[data-rqa-form]', card);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = (name) => form.elements[name].value.trim();
      const data = editing ? { title: value('title'), description: value('description'), city: value('city'), area: value('area'), size: Number(value('size')), sizeUnit: value('sizeUnit'), price: Number(value('price')) } : { note: value('note') };
      const errors = [];
      if (editing) {
        if (data.title.length < 5) errors.push(['title', 'Title must contain at least 5 characters.']);
        if (data.description.length < 20) errors.push(['description', 'Description must contain at least 20 characters.']);
        if (!data.city || !data.area) errors.push(['city', 'City and area are required.']);
        if (!Number.isFinite(data.size) || data.size <= 0) errors.push(['size', 'Enter a valid size.']);
        if (!Number.isSafeInteger(data.price) || data.price <= 0) errors.push(['price', 'Enter a valid whole-rupee price.']);
      } else if (!data.note) errors.push(['note', 'Enter a note.']);
      if (showErrors(form, errors)) return;
      const done = busy($('[type=submit]', form), editing ? 'Saving…' : 'Sending…');
      try {
        await rqaPerform(l.id, action, data);
        closeModal(); renderAdmin(); renderGrid();
        toast(editing ? 'Listing updated.' : 'Note sent to the advertiser.');
      } catch (err) { done(); showErrors(form, [[editing ? 'title' : 'note', err.message || 'The action failed.']]); }
    });
  }

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
  { const base = V3_ADMIN.duplicates; V3_ADMIN.duplicates = () => {
    const groups = rqaDupes();
    const reports = db.reports.filter((r) => r.status === 'open' && ['Suspicious activity', 'Duplicate listing'].includes(r.reason));
    const titleGroups = groups.length ? groups.map((g) => `<div class="rqa-dupe"><div class="rqa-dupe-h"><b>${g.key.startsWith('t:') ? 'Similar title' : 'Matching property details'}</b><small>${g.items.length} listings</small></div>${g.items.map((l) => `<div class="rqa-dupe-i"><b>${esc(l.title || 'Untitled')}</b><small> · ${esc(l.ref || l.id)} · ${esc([l.area, l.city].filter(Boolean).join(', '))} · ${esc(rqaName(l))}</small>${rqaModerationActions(l)}</div>`).join('')}</div>`).join('') : '<div class="admin-empty sm">No matching titles or property details found.</div>';
    const reported = reports.length ? reports.map((r) => { const l = byId(r.listingId); return `<article class="rqa-dupe" data-report="${esc(r.id)}"><div class="rqa-dupe-i"><b>${esc(r.reason)}</b> · ${esc(r.listingTitle || 'Listing')}<p>${esc(r.details || 'No details provided.')}</p><small>${esc(r.ref)} · ${esc(fmtDate(r.createdAt))}</small>${l ? rqaModerationActions(l) : '<p>Listing no longer available.</p>'}<div class="admin-actions"><button type="button" data-admin-act="report-close">Mark report reviewed</button></div></div></article>`; }).join('') : '<div class="admin-empty sm">No open suspicious-activity or duplicate reports.</div>';
    const listing = RQA.review && byId(RQA.review);
    const review = listing ? `<section class="gwa-sec" data-rqa-review><h3>Review listing</h3>${adminListingCard(listing)}<button type="button" class="button button-outline" data-rqa="close-review">Close review</button></section>` : '';
    return base().replace('<div class="gwa">', `<div class="gwa">${review}`).replace(/<\/div>\s*$/, '') + `<section class="gwa-sec"><h3>Matching titles or property details</h3><p class="admin-sub">Matches are only possible duplicates. Check each property before taking action.</p>${titleGroups}</section><section class="gwa-sec"><h3>Reported suspicious or duplicate listings</h3>${reported}</section></div>`;
  }; }

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
      : '<div class="admin-empty">No attempts recorded in this browser.</div>';
    return rqaShell('Contact guard', 'Best-effort checks in this browser only. This log does not include other users or devices and the checks can be bypassed.', body);
  };

  /* ---------------- tabs ---------------- */
  try {
    Object.assign(AX_ICON, { 'rq-members': 'users', 'rq-docs': 'doc', 'rq-guard': 'shield' });
    Object.assign(AX_HINT, {
      'rq-members': 'Who listed what, and how much of it',
      'rq-docs': 'Papers each member holds, and what is missing',
      'rq-guard': 'Contact attempts recorded in this browser'
    });
  } catch { /* icons are cosmetic */ }

  { const base = v3AdminTabs; v3AdminTabs = function () {
      const t = base();
      let guard = 0;
      try { guard = (window.rqGuardLog() || []).length; } catch { /* ignore */ }
      t.push(['#rq', 'CONTROL ROOM'],
        ['rq-members', 'Members & listings', ''],
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
    if (act === 'close-review') { RQA.review = null; renderAdmin(); return; }
    if (act === 'open') { const l = rqaAll().find((x) => String(x.id) === String(b.dataset.id)); if (l) { closeAdmin(); openDetails(l.id); } return; }
    if (['review', 'edit', 'note', 'moderate-delete'].includes(act)) {
      const l = byId(b.dataset.id);
      if (!l) { toast('This listing is no longer available. Refresh and try again.'); return; }
      if (act === 'review') { RQA.review = l.id; renderAdmin(); const section = $('[data-rqa-review]', admin.el); if (section) section.scrollIntoView({ block: 'start' }); return; }
      if (act === 'edit' || act === 'note') { rqaModerationForm(l, act); return; }
      if (!window.confirm(`Permanently delete "${l.title || l.ref}"?\n\nRelated listing records may also be removed. This cannot be undone.`)) return;
      const done = busy(b, 'Deleting…');
      try { const warning = await rqaPerform(l.id, 'delete', {}); renderAdmin(); renderGrid(); toast(warning || 'Listing deleted.'); }
      catch (err) { done(); toast(err.message || 'Could not delete the listing.'); }
      return;
    }
    if (act === 'del') {
      const l = rqaAll().find((x) => String(x.id) === String(b.dataset.id));
      if (!l) return;
      if (!window.confirm(`Permanently delete "${l.title || l.ref}"?\n\nRelated listing records may also be removed. This cannot be undone.`)) return;
      const done = busy(b, 'Deleting…');
      try { const warning = await rqaPerform(l.id, 'delete', {}); renderAdmin(); renderGrid(); toast(warning || 'Listing deleted.'); }
      catch (err) { done(); toast(err.message || 'Could not delete the listing.'); }
    }
  });
