  /* =====================================================================
     Live features: notification bell + Messages (chat)
     Supabase: notifications / conversations / messages tables (update_9_live.sql)
     Demo mode: stored in this browser so the flow can be tried without a backend
     ===================================================================== */
  const lvMe = () => (db.session && db.session.userId) || null;
  const lvSupabase = (sb) => {
    const q = async (p, msg) => { const { data, error } = await p; if (error) throw new Error(/does not exist|schema cache|relation/i.test(error.message || '') ? 'Messages are being set up. (Admin: run update_9_live.sql in Supabase.)' : (error.message || msg)); return data; };
    return {
      async notifs() { return (await q(sb.from('notifications').select('id, kind, title, body, link, created_at, read_at').order('id', { ascending: false }).limit(30), 'Could not load notifications.')) || []; },
      async markRead(ids) { let u = sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); if (ids) u = u.in('id', ids); await q(u, 'Could not update.'); },
      subNotifs(cb) { const uid = lvMe(); if (!uid) return () => {}; const ch = sb.channel('ntf-' + uid).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + uid }, (p) => cb(p.new)).subscribe(); return () => sb.removeChannel(ch); },
      async convs() {
        const list = (await q(sb.from('conversations').select('*').order('last_message_at', { ascending: false }).limit(60), 'Could not load messages.')) || [];
        const unread = (await q(sb.from('messages').select('conversation_id').is('read_at', null).neq('sender_id', lvMe()).limit(1000), '')) || [];
        const n = {}; unread.forEach((m) => { n[m.conversation_id] = (n[m.conversation_id] || 0) + 1; });
        return list.map((c) => ({ ...c, unread: n[c.id] || 0 }));
      },
      async msgs(cid) { return (await q(sb.from('messages').select('id, conversation_id, sender_id, body, created_at, read_at').eq('conversation_id', cid).order('id', { ascending: true }).limit(300), 'Could not load messages.')) || []; },
      async send(cid, body) { return q(sb.from('messages').insert({ conversation_id: cid, body }).select('id, conversation_id, sender_id, body, created_at, read_at').single(), 'Message not sent.'); },
      async start(t) { if (t.offer) { const { data, error } = await sb.rpc('start_offer_chat', { p_offer: t.offer }); if (error) throw new Error(/does not exist|schema cache|could not find the function/i.test(error.message || '') ? 'Offer chat is being set up. (Admin: run update_35_listing_offers.sql in Supabase.)' : (error.message || 'Could not start the chat.')); return data; } if (t.wanted) return q(sb.rpc('start_wanted_chat', { p_wanted: t.wanted }), 'Could not start the chat.'); return q(sb.rpc('start_conversation', { p_listing: t.listing || null, p_vendor: t.vendor || null, p_order: t.order || null }), 'Could not start the chat.'); },
      async read(cid) { try { await sb.rpc('mark_conversation_read', { p_conv: cid }); await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).eq('link', '#messages/' + cid); } catch { /* ignore */ } },
      subThread(cid, cb) { const ch = sb.channel('msg-' + cid).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + cid }, (p) => cb(p.new)).subscribe(); return () => sb.removeChannel(ch); },
      subInbox(cb) { const ch = sb.channel('inbox-' + (lvMe() || 'x')).on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => cb()).subscribe(); return () => sb.removeChannel(ch); }
    };
  };
  const lvLocal = (() => {
    const KEY = 'live'; const read = () => store.get(KEY, { n: [], c: [], m: [] }); const write = (d) => { store.set(KEY, d); window.dispatchEvent(new Event('raqbo-live')); };
    const now = () => new Date().toISOString(); let seq = Date.now();
    const visible = (c) => { const u = lvMe(); return c.starter_id === u || c.other_id === u || (!c.other_id && db.isAdmin); };
    const notify = (d, user, kind, title, body, link) => { if (!user) return; d.n.unshift({ id: ++seq, user_id: user, kind, title, body: body || '', link: link || '', created_at: now(), read_at: null }); d.n = d.n.slice(0, 300); };
    const admins = () => ['admin'];   // demo admin signs in as "admin"
    const listeners = new Set(); window.addEventListener('raqbo-live', () => listeners.forEach((f) => f())); window.addEventListener('storage', (e) => { if (e.key && e.key.endsWith(KEY)) listeners.forEach((f) => f()); });
    const on = (f) => { listeners.add(f); return () => listeners.delete(f); };
    return {
      notify(user, kind, title, body, link) { const d = read(); notify(d, user, kind, title, body, link); write(d); },
      notifyAdmins(kind, title, body, link) { const d = read(); admins().forEach((a) => notify(d, a, kind, title, body, link)); write(d); },
      async notifs() { const u = db.isAdmin ? 'admin' : lvMe(); return read().n.filter((x) => x.user_id === u || (db.isAdmin && x.user_id === lvMe())).slice(0, 30); },
      async markRead(ids) { const d = read(); const u = db.isAdmin ? 'admin' : lvMe(); d.n.forEach((x) => { if ((x.user_id === u || x.user_id === lvMe()) && !x.read_at && (!ids || ids.includes(x.id))) x.read_at = now(); }); write(d); },
      subNotifs(cb) { let seen = new Set(read().n.map((x) => x.id)); return on(() => { read().n.forEach((x) => { if (!seen.has(x.id)) { seen.add(x.id); if (x.user_id === lvMe() || (db.isAdmin && x.user_id === 'admin')) cb(x); } }); }); },
      async convs() { const d = read(); const u = lvMe(); return d.c.filter(visible).sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)).map((c) => ({ ...c, unread: d.m.filter((m) => m.conversation_id === c.id && m.sender_id !== u && !m.read_at).length })); },
      async msgs(cid) { return read().m.filter((m) => m.conversation_id === cid); },
      async send(cid, body) {
        const d = read(); const c = d.c.find((x) => x.id === cid); if (!c || !visible(c)) throw new Error('Conversation not found.');
        const m = { id: ++seq, conversation_id: cid, sender_id: lvMe(), body: body.trim(), created_at: now(), read_at: null }; d.m.push(m);
        Object.assign(c, { last_message_at: m.created_at, last_preview: m.body.slice(0, 120), last_sender: m.sender_id });
        const fromName = db.isAdmin && !c.other_id && m.sender_id !== c.starter_id ? 'RAQBO team' : (db.session.name || 'RAQBO member'); const target = m.sender_id === c.starter_id ? c.other_id : c.starter_id;
        const link = '#messages/' + cid;
        if (!target) { if (!d.n.some((x) => x.user_id === 'admin' && x.link === link && !x.read_at)) admins().forEach((a) => notify(d, a, 'message', 'New message from ' + fromName, m.body.slice(0, 160), link)); }
        else if (!d.n.some((x) => x.user_id === target && x.link === link && !x.read_at)) notify(d, target, 'message', 'New message from ' + fromName, c.subject + ' — ' + m.body.slice(0, 140), link);
        write(d); return m;
      },
      async start(t) {
        const u = lvMe(); if (!u) throw new Error('Please sign in to send messages.'); const d = read(); let other = null; let subj = 'RAQBO support'; let otherName = 'RAQBO team';
        if (t.offer) {
          const o = store.get('deals.offers', []).find((x) => x.id === t.offer); const l = o && byId(o.listing_id);
          if (!o || !l || !o.buyer_id || !l.ownerId || ![o.buyer_id, l.ownerId].includes(u)) throw new Error('This conversation is not available.');
          if ((l.channel || 'public') !== 'public') throw new Error('Private opportunities are coordinated through RAQBO.');
          if (!['submitted', 'countered', 'accepted'].includes(o.status) || (o.status !== 'accepted' && o.expires_at && Date.parse(o.expires_at) <= Date.now())) throw new Error('This offer is no longer open for a new conversation.');
          let c = d.c.find((x) => x.starter_id === o.buyer_id && x.other_id === l.ownerId && x.listing_id === l.id);
          if (!c) { const accounts = Object.values(store.get('accounts', {})); const buyer = accounts.find((x) => x.userId === o.buyer_id); c = { id: uid('cv'), starter_id: o.buyer_id, other_id: l.ownerId, listing_id: l.id, subject: l.title + (l.ref ? ' · ' + l.ref : ''), starter_name: (buyer && buyer.name) || 'RAQBO member', other_name: l.ownerName || 'Advertiser', last_message_at: now(), last_preview: '', last_sender: null, created_at: now() }; d.c.push(c); write(d); }
          return c.id;
        }
        if (t.listing) { const l = byId(t.listing); if (!l) throw new Error('This property is not available.'); if ((l.channel || 'public') !== 'public') throw new Error('Private opportunities are coordinated through RAQBO.'); other = l.ownerId || null; if (other === u) throw new Error('This is your own listing.'); subj = l.title + (l.ref ? ' · ' + l.ref : ''); otherName = other ? l.ownerName || 'Advertiser' : 'RAQBO team'; }
        else if (t.vendor) { const v = mk.vendor(t.vendor); if (!v) throw new Error('This shop is not available.'); other = v.ownerId || null; if (other === u) throw new Error('This is your own shop.'); subj = v.shop; otherName = other ? v.owner || v.shop : 'RAQBO team'; }
        else if (t.order) { const o = mk.order(t.order); if (!o) throw new Error('Order not found.'); const v = mk.vendor(o.vendorId); other = o.buyerId === u ? (v && v.ownerId) || null : o.buyerId; subj = `Order ${o.ref} · ${v ? v.shop : ''}`; otherName = o.buyerId === u ? (v ? v.shop : 'Vendor') : o.buyerName; }
        else if (t.wanted) { const w = (store.get('growth', {}).wanted || []).find((x) => x.id === t.wanted && x.status === 'published'); if (!w) throw new Error('This request is no longer open.'); other = w.user_id; if (other === u) throw new Error('This is your own request.'); subj = `Property wanted: ${w.property_type} in ${w.city} · ${w.ref}`; otherName = w.poster_name || 'RAQBO member'; }
        const topic = t.listing || t.vendor || t.order || t.wanted || '';
        let c = d.c.find((x) => ((x.starter_id === u && (x.other_id || null) === other) || (t.order && x.starter_id === other && x.other_id === u)) && (x.listing_id || x.vendor_id || x.order_id || x.wanted_id || '') === topic);
        if (!c) { c = { id: uid('cv'), starter_id: u, other_id: other, listing_id: t.listing || null, vendor_id: t.vendor || null, order_id: t.order || null, wanted_id: t.wanted || null, subject: subj, starter_name: db.session.name || 'RAQBO member', other_name: otherName, last_message_at: now(), last_preview: '', last_sender: null, created_at: now() }; d.c.push(c); write(d); }
        return c.id;
      },
      async read(cid) { const d = read(); const u = lvMe(); d.m.forEach((m) => { if (m.conversation_id === cid && m.sender_id !== u && !m.read_at) m.read_at = now(); }); d.n.forEach((x) => { if (x.link === '#messages/' + cid && !x.read_at && (x.user_id === u || (db.isAdmin && x.user_id === 'admin'))) x.read_at = now(); }); write(d); },
      subThread(cid, cb) { let seen = new Set(read().m.filter((m) => m.conversation_id === cid).map((m) => m.id)); return on(() => read().m.forEach((m) => { if (m.conversation_id === cid && !seen.has(m.id)) { seen.add(m.id); cb(m); } })); },
      subInbox(cb) { return on(cb); }
    };
  })();
  const LV = SB ? lvSupabase(SB) : lvLocal;
  // Demo mode: order steps create notifications like the database does
  function lvLocalOrderEvent(o, status, actor) {
    if (SB || !lvLocal) return; const v = mk.data && mk.vendor(o.vendor_id); const ref = o.ref || ''; const link = '#marketplace/order/' + o.id; const first = (o.events || []).length <= 1;
    const tb = first ? (status === 'quote_requested' ? 'Quote request sent' : 'Order placed — pay into RAQBO Protected Payment') : ({ quoted: 'Quote received', awaiting_payment: actor === 'admin' ? 'Payment could not be verified — upload again' : 'Quote accepted — pay into RAQBO Protected Payment', payment_review: 'Payment received — RAQBO is verifying it', paid_escrow: 'Payment confirmed and held by RAQBO', dispatched: 'Your order is on the way', delivered: 'Delivered — please confirm receipt', completed: 'Order completed — thank you', released: 'Order closed — vendor paid', disputed: 'Dispute opened', refunded: 'Refund issued', cancelled: 'Order cancelled' })[status] || 'Order update';
    lvLocal.notify(o.buyer_id, 'order', `${tb} · ${ref}`, '', link);
    const tv = first ? (status === 'quote_requested' ? 'New quote request' : 'New order') : ({ paid_escrow: 'Payment secured — dispatch now', completed: 'Buyer confirmed delivery — payout pending', released: 'Payout released', disputed: 'Buyer opened a dispute', cancelled: actor === 'buyer' ? 'Buyer cancelled the order' : '' })[status];
    if (tv && v && v.ownerId) lvLocal.notify(v.ownerId, 'order', `${tv} · ${ref}`, '', link);
    if (['payment_review', 'disputed', 'completed'].includes(status)) lvLocal.notifyAdmins('order', ({ payment_review: 'Payment screenshot to verify', disputed: 'Dispute to resolve', completed: 'Payout to release' })[status] + ' · ' + ref, '', '#admin');
  }

  const lv = { list: [], unread: 0, msgUnread: 0, open: false, unsub: null, timer: null, inbox: null, conv: null, convs: [], thread: [], threadUnsub: null, inboxUnsub: null, sending: false };
  const relShort = (t) => { const s = (Date.now() - Date.parse(t)) / 1000; if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; if (s < 604800) return Math.floor(s / 86400) + 'd'; return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const KIND_ICON = { order: 'cart', listing: 'home', review: 'star', message: 'chat', system: 'info', alert: 'bell', reward: 'star', deal: 'cart', auction: 'trend', service: 'doc' };
  async function lvRefresh() {
    if (!isComplete()) { lv.list = []; lv.unread = 0; lv.msgUnread = 0; lvBadges(); return; }
    try { lv.list = await LV.notifs(); } catch { lv.list = []; }
    lv.unread = lv.list.filter((n) => !n.read_at).length; lv.msgUnread = lv.list.filter((n) => !n.read_at && n.kind === 'message').length;
    lvBadges(); if (lv.open) lvRenderPanel();
  }
  function lvBadges() {
    $$('[data-bell] .bell-dot').forEach((b) => { b.textContent = lv.unread > 9 ? '9+' : String(lv.unread); b.hidden = !lv.unread; });
    const m = $('[data-nav=messages] .menu-count'); if (m) { m.textContent = String(lv.msgUnread); m.hidden = !lv.msgUnread; }
    const ib = $('.lv-inbox-count'); if (ib) { ib.textContent = String(lv.msgUnread); ib.hidden = !lv.msgUnread; }
  }
  function lvStart() {
    lvStop(); if (!isComplete()) return; lvRefresh();
    try { lv.unsub = LV.subNotifs((n) => { lv.list.unshift(n); lv.list = lv.list.slice(0, 30); lv.unread++; if (n.kind === 'message') lv.msgUnread++; lvBadges(); $$('[data-bell]').forEach((bell) => { bell.classList.remove('ring'); void bell.offsetWidth; bell.classList.add('ring'); });
      if (!(n.kind === 'message' && lv.inbox && !lv.inbox.hidden && lv.conv && n.link === '#messages/' + lv.conv)) toast('🔔 ' + n.title); if (lv.open) lvRenderPanel(); if (lv.inbox && !lv.inbox.hidden) lvLoadConvs(); }); } catch { lv.unsub = null; }
    lv.timer = setInterval(() => { if (!document.hidden) lvRefresh(); }, 90000);
  }
  function lvStop() { if (lv.unsub) { try { lv.unsub(); } catch { /* ignore */ } } lv.unsub = null; clearInterval(lv.timer); }
  function notifPause() { lvStop(); if (lv.threadUnsub) { try { lv.threadUnsub(); } catch { /* ignore */ } lv.threadUnsub = null; } if (lv.inboxUnsub) { try { lv.inboxUnsub(); } catch { /* ignore */ } lv.inboxUnsub = null; } }
  function notifResume() { lvStart(); if (lv.inbox && !lv.inbox.hidden) { lvWatchInbox(); if (lv.conv) lvOpenThread(lv.conv, true); } }
  function lvGo(link) {
    if (!link) return; lvClosePanel();
    let m;
    if ((m = link.match(/^#marketplace\/order\/(.+)$/))) { closeAdmin && admin.el && !admin.el.hidden && closeAdmin(); mkLoad().then(() => openMarket('order', { orderId: m[1] })); }
    else if ((m = link.match(/^#property\/(.+)$/))) { if (byId(m[1])) openDetails(m[1]); else toast('This property is not available yet.'); }
    else if ((m = link.match(/^#messages(?:\/(.+))?$/))) openInbox(m[1]);
    else if (link === '#account') openAccount();
    else if (link === '#admin') openAdmin();
    else if (link === '#admin/verify') openAdmin('verify');
    else gwRoute(link);
  }
  function lvRenderPanel() {
    const p = $('body > .bell-panel'); if (!p) return;
    p.innerHTML = `<div class="bell-head"><b>Notifications</b>${lv.unread ? '<button type="button" class="link-button" data-bell-all>Mark all read</button>' : ''}</div>
      <div class="bell-list">${lv.list.length ? lv.list.map((n) => `<button type="button" class="bell-item ${n.read_at ? '' : 'unread'}" data-ntf="${esc(n.id)}" data-link="${esc(n.link)}"><span class="bell-ico k-${esc(n.kind)}">${DI(DIC[KIND_ICON[n.kind]] || DIC.info, 16)}</span><span class="bell-txt"><b>${esc(n.title)}</b>${n.body ? `<small>${esc(n.body)}</small>` : ''}<em>${esc(relShort(n.created_at))}</em></span></button>`).join('')
        : `<div class="bell-empty">${DI(DIC.bell, 26)}<b>You’re all caught up</b><small>Order updates, approvals, reviews and messages appear here.</small></div>`}</div>
      <button type="button" class="bell-foot" data-bell-inbox>${DI(DIC.chat, 16)} Open messages <span class="lv-inbox-count" ${lv.msgUnread ? '' : 'hidden'}>${lv.msgUnread}</span></button>`;
  }
  function lvPanelEl() { let p = $('body > .bell-panel'); if (!p) { p = document.createElement('div'); p.className = 'bell-panel'; p.hidden = true; p.setAttribute('role', 'region'); p.setAttribute('aria-label', 'Notifications'); document.body.append(p); } return p; }
  function lvOpenPanel(bell) {
    const p = lvPanelEl(); closeNavMenus(); lv.open = true; p.hidden = false; lvRenderPanel();
    const r = bell.getBoundingClientRect(); const w = Math.min(380, innerWidth - 24); p.style.top = (r.bottom + 10) + 'px'; p.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.right - w)) + 'px'; p.style.width = w + 'px';
    $$('[data-bell]').forEach((b) => b.setAttribute('aria-expanded', String(b === bell))); lvRefresh();
  }
  function lvClosePanel() { const p = $('body > .bell-panel'); lv.open = false; if (p) p.hidden = true; $$('[data-bell]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
  window.addEventListener('resize', () => { if (lv.open) lvClosePanel(); });
  document.addEventListener('click', async (e) => {
    const bell = e.target.closest('[data-bell]'); if (bell) { e.stopPropagation(); if (lv.open) lvClosePanel(); else lvOpenPanel(bell); return; }
    const item = e.target.closest('[data-ntf]');
    if (item) { const id = Number(item.dataset.ntf) || item.dataset.ntf; const n = lv.list.find((x) => String(x.id) === String(id)); if (n && !n.read_at) { n.read_at = new Date().toISOString(); lv.unread = Math.max(0, lv.unread - 1); if (n.kind === 'message') lv.msgUnread = Math.max(0, lv.msgUnread - 1); lvBadges(); LV.markRead([n.id]).catch(() => {}); } lvGo(item.dataset.link); return; }
    if (e.target.closest('[data-bell-all]')) { lv.list.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); }); lv.unread = 0; lv.msgUnread = 0; lvBadges(); lvRenderPanel(); LV.markRead(null).catch(() => {}); return; }
    if (e.target.closest('[data-bell-inbox]')) { lvClosePanel(); openInbox(); return; }
    if (lv.open && !e.target.closest('.bell-panel')) lvClosePanel();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lv.open) { e.stopImmediatePropagation(); lvClosePanel(); return; } if (e.key === 'Escape' && lv.inbox && !lv.inbox.hidden && !lv.inbox.contains(e.target) && !$('.modal-backdrop') && !(gate.el && !gate.el.hidden)) { e.stopImmediatePropagation(); if (lv.inbox.classList.contains('show-thread') && matchMedia('(max-width: 760px)').matches) lvBack(); else closeInbox(); } }, true);

  /* ---------- Messages (inbox + thread) ---------- */
  function lvShell() {
    if (lv.inbox) return lv.inbox;
    lv.inbox = document.createElement('div'); lv.inbox.className = 'lv-inbox'; lv.inbox.hidden = true; lv.inbox.setAttribute('role', 'dialog'); lv.inbox.setAttribute('aria-modal', 'true'); lv.inbox.setAttribute('aria-label', 'Messages');
    lv.inbox.innerHTML = `<div class="lv-wrap"><aside class="lv-side"><div class="lv-side-head"><b>${DI(DIC.chat, 18)} Messages</b><button type="button" class="lv-x" data-lv="close" aria-label="Close messages">×</button></div><div class="lv-convs" aria-live="polite"></div>
        <button type="button" class="lv-support" data-lv="support">${DI(DIC.info, 15)} Chat with the RAQBO team</button></aside>
      <section class="lv-main"><div class="lv-thread-empty">${DI(DIC.chat, 34)}<b>Select a conversation</b><small>Message advertisers, shops and the RAQBO team. Replies arrive here instantly.</small></div></section></div>`;
    document.body.append(lv.inbox);
    lv.inbox.addEventListener('click', lvInboxClick); lv.inbox.addEventListener('submit', lvSend);
    lv.inbox.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.lv-compose textarea')) { e.preventDefault(); e.target.form.requestSubmit(); } if (e.key === 'Escape') { e.stopPropagation(); if (lv.inbox.classList.contains('show-thread') && matchMedia('(max-width: 760px)').matches) lvBack(); else closeInbox(); } });
    lv.inbox.addEventListener('input', (e) => { const t = e.target.closest('.lv-compose textarea'); if (t) { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; } });
    return lv.inbox;
  }
  function openInbox(convId) {
    requireSignIn(async () => {
      closeModal(); closeNavMenus(); lvClosePanel(); const el = lvShell(); el.hidden = false; document.body.classList.add('lv-open');
      if (!/^#messages/.test(location.hash)) { try { history.pushState({ lv: 1 }, '', '#messages' + (convId ? '/' + convId : '')); } catch { /* ignore */ } }
      lvWatchInbox(); await lvLoadConvs();
      if (convId) lvOpenThread(convId); else if (!matchMedia('(max-width: 760px)').matches && lv.convs[0]) lvOpenThread(lv.convs[0].id);
      else { const x = $('.lv-x', el); if (x) x.focus({ preventScroll: true }); }
    });
  }
  function closeInbox(opts = {}) {
    if (!lv.inbox || lv.inbox.hidden) return; lv.inbox.hidden = true; document.body.classList.remove('lv-open'); lv.inbox.classList.remove('show-thread');
    if (lv.threadUnsub) { try { lv.threadUnsub(); } catch { /* ignore */ } lv.threadUnsub = null; } if (lv.inboxUnsub) { try { lv.inboxUnsub(); } catch { /* ignore */ } lv.inboxUnsub = null; }
    lv.conv = null; if (!opts.fromHistory && /^#messages/.test(location.hash)) { try { history.pushState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
  }
  function lvWatchInbox() { if (lv.inboxUnsub) return; try { let t; lv.inboxUnsub = LV.subInbox(() => { clearTimeout(t); t = setTimeout(lvLoadConvs, 250); }); } catch { lv.inboxUnsub = null; } }
  const lvOther = (c) => { const me = lvMe(); if (c.starter_id === me) return c.other_id ? c.other_name || 'Advertiser' : 'RAQBO team'; return c.starter_name || 'RAQBO member'; };
  const lvInitials = (n) => String(n || 'R').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  async function lvLoadConvs() {
    const box = lv.inbox && $('.lv-convs', lv.inbox); if (!box) return;
    if (!lv.convs.length) box.innerHTML = '<div class="skeleton" style="height:64px;margin:10px"></div><div class="skeleton" style="height:64px;margin:10px"></div>';
    try { lv.convs = await LV.convs(); } catch (err) { box.innerHTML = `<p class="lv-err">${esc(err.message)}</p>`; return; }
    box.innerHTML = lv.convs.length ? lv.convs.map((c) => { const who = lvOther(c); const support = !c.other_id; return `<button type="button" class="lv-conv ${c.id === lv.conv ? 'active' : ''} ${c.unread ? 'unread' : ''}" data-conv="${esc(c.id)}"><span class="lv-av ${support && c.starter_id === lvMe() ? 'team' : ''}">${esc(lvInitials(who))}</span><span class="lv-conv-txt"><span class="lv-conv-top"><b>${esc(who)}</b><em>${esc(relShort(c.last_message_at))}</em></span><small>${esc(c.subject)}</small><span class="lv-prev">${c.last_sender === lvMe() ? 'You: ' : ''}${esc(c.last_preview || 'No messages yet')}</span></span>${c.unread ? `<span class="lv-unread">${c.unread}</span>` : ''}</button>`; }).join('')
      : `<div class="lv-none"><b>No conversations yet</b><small>Tap <b>Message</b> on a property, shop or order to start one.</small></div>`;
  }
  async function lvOpenThread(cid, quiet) {
    lv.conv = cid; const main = $('.lv-main', lv.inbox); lv.inbox.classList.add('show-thread');
    $$('.lv-conv', lv.inbox).forEach((b) => b.classList.toggle('active', b.dataset.conv === cid));
    try { if (location.hash !== '#messages/' + cid) history.replaceState({ lv: 1 }, '', '#messages/' + cid); } catch { /* ignore */ }
    let c = lv.convs.find((x) => x.id === cid); if (!c) { await lvLoadConvs(); c = lv.convs.find((x) => x.id === cid); }
    if (!c) { main.innerHTML = '<div class="lv-thread-empty"><b>Conversation not found</b></div>'; return; }
    const who = lvOther(c);
    if (!quiet) main.innerHTML = `<header class="lv-thread-head"><button type="button" class="lv-back" data-lv="back" aria-label="Back to conversations">${DI('<path d="m15 18-6-6 6-6"/>', 18)}</button><span class="lv-av">${esc(lvInitials(who))}</span><div><b>${esc(who)}</b><small>${esc(c.subject)}</small></div>${c.listing_id && byId(c.listing_id) ? `<button type="button" class="button button-outline lv-topic" data-lv="topic" data-link="#property/${esc(c.listing_id)}">View property</button>` : c.order_id ? `<button type="button" class="button button-outline lv-topic" data-lv="topic" data-link="#marketplace/order/${esc(c.order_id)}">View order</button>` : ''}</header>
      <div class="lv-msgs" aria-live="polite"><div class="skeleton" style="height:44px;width:60%;margin:14px"></div></div>
      <form class="lv-compose" novalidate><textarea name="body" rows="1" maxlength="2000" placeholder="Write a message…" aria-label="Message"></textarea><button type="submit" class="button button-primary" aria-label="Send">${DI('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>', 18)}</button></form>
      <p class="lv-safe">${DI(DIC.lock || DIC.info, 13)} For your safety, keep payments inside RAQBO Protected Payment and never share OTP codes.</p>`;
    try { lv.thread = await LV.msgs(cid); } catch (err) { $('.lv-msgs', main).innerHTML = `<p class="lv-err">${esc(err.message)}</p>`; return; }
    lvRenderThread(true);
    if (lv.threadUnsub) { try { lv.threadUnsub(); } catch { /* ignore */ } }
    try { lv.threadUnsub = LV.subThread(cid, (m) => { if (lv.conv !== cid) return; if (lv.thread.some((x) => String(x.id) === String(m.id))) return; const tmp = lv.thread.find((x) => x.tmp && x.body === m.body && m.sender_id === lvMe()); if (tmp) Object.assign(tmp, m, { tmp: false }); else lv.thread.push(m); lvRenderThread(true); if (m.sender_id !== lvMe()) LV.read(cid); }); } catch { lv.threadUnsub = null; }
    await LV.read(cid); const cc = lv.convs.find((x) => x.id === cid); if (cc) cc.unread = 0; $$(`.lv-conv[data-conv="${CSS.escape(cid)}"]`, lv.inbox).forEach((b) => { b.classList.remove('unread'); const u = $('.lv-unread', b); if (u) u.remove(); });
    lv.list.forEach((n) => { if (n.link === '#messages/' + cid && !n.read_at) { n.read_at = new Date().toISOString(); lv.unread = Math.max(0, lv.unread - 1); lv.msgUnread = Math.max(0, lv.msgUnread - 1); } }); lvBadges();
    if (!quiet && !matchMedia('(max-width: 760px)').matches) { const t = $('.lv-compose textarea', main); if (t) t.focus({ preventScroll: true }); }
  }
  function lvRenderThread(scroll) {
    const box = $('.lv-msgs', lv.inbox); if (!box) return; const me = lvMe(); let lastDay = '';
    box.innerHTML = lv.thread.length ? lv.thread.map((m) => { const d = new Date(m.created_at); const day = d.toDateString(); const sep = day !== lastDay ? `<div class="lv-day"><span>${esc(day === new Date().toDateString() ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</span></div>` : ''; lastDay = day;
      return `${sep}<div class="lv-msg ${m.sender_id === me ? 'mine' : ''} ${m.tmp ? 'sending' : ''} ${m.failed ? 'failed' : ''}"><p>${esc(m.body).replace(/\n/g, '<br>')}</p><span>${esc(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}${m.sender_id === me ? (m.failed ? ' · not sent' : m.tmp ? ' · sending' : m.read_at ? ' · seen' : ' · sent') : ''}</span></div>`; }).join('')
      : '<div class="lv-hello">Say hello 👋 — ask about availability, price or a viewing time.</div>';
    if (scroll) box.scrollTop = box.scrollHeight;
  }
  async function lvSend(e) {
    e.preventDefault(); const f = e.target.closest('.lv-compose'); if (!f || !lv.conv) return; const t = f.body; const body = t.value.trim(); if (!body) return;
    const cid = lv.conv; const temp = { id: 'tmp-' + Date.now(), conversation_id: cid, sender_id: lvMe(), body, created_at: new Date().toISOString(), tmp: true };
    lv.thread.push(temp); t.value = ''; t.style.height = 'auto'; lvRenderThread(true);   // shows immediately
    try { const m = await LV.send(cid, body); const dup = lv.thread.some((x) => x !== temp && String(x.id) === String(m.id)); if (dup) lv.thread = lv.thread.filter((x) => x !== temp); else Object.assign(temp, m, { tmp: false }); }
    catch (err) { temp.tmp = false; temp.failed = true; toast(err.message); }
    lvRenderThread(true); lvLoadConvs();
  }
  function lvBack() { lv.inbox.classList.remove('show-thread'); lv.conv = null; $$('.lv-conv', lv.inbox).forEach((b) => b.classList.remove('active')); try { history.replaceState({ lv: 1 }, '', '#messages'); } catch { /* ignore */ } }
  async function lvInboxClick(e) {
    const c = e.target.closest('[data-conv]'); if (c) { lvOpenThread(c.dataset.conv); return; }
    const a = e.target.closest('[data-lv]'); if (!a) { if (e.target === lv.inbox) closeInbox(); return; }
    const act = a.dataset.lv;
    if (act === 'close') closeInbox(); else if (act === 'back') lvBack();
    else if (act === 'topic') { const link = a.dataset.link; closeInbox(); lvGo(link); }
    else if (act === 'support') startChat({}, a);
  }
  // Start a chat about a property / shop / order, or with the RAQBO team
  function startChat(topic, btn) {
    requireSignIn(async () => {
      const done = btn ? busy(btn, 'Opening chat…') : () => {};
      try { const cid = await LV.start(topic); done(); if (pp.el && !pp.el.hidden) closeDetails({ fromHistory: true }); if (mk.el && !mk.el.hidden) closeMarket({ fromHistory: true }); openInbox(cid); }
      catch (err) { done(); toast(err.message); }
    });
  }
  window.addEventListener('popstate', () => { if (/^#messages/.test(location.hash)) { const m = location.hash.match(/^#messages\/(.+)$/); if (!lv.inbox || lv.inbox.hidden) openInbox(m && m[1]); else if (m) lvOpenThread(m[1]); else lvBack(); } else closeInbox({ fromHistory: true }); });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-chat]'); if (!b) return; e.preventDefault(); const k = b.dataset.chat; const id = b.dataset.id; startChat(k === 'offer' ? { offer: id } : k === 'listing' ? { listing: id } : k === 'vendor' ? { vendor: id } : k === 'order' ? { order: id } : {}, b); });

