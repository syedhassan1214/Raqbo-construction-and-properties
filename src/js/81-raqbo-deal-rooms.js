  /* =====================================================================
     RAQBO — deal rooms
     One conversation between the two sides of a deal, whoever opens it
     first. Used by offers and by auction completions. The buyer or bidder
     keeps the number they were given, so nobody learns a name before
     RAQBO makes the introduction, and the contact guard keeps phone
     numbers, CNICs and links out of the room.
     ===================================================================== */
  // demo mode: write the conversation straight into the live store
  function rqRoomLocal(t) {
    const me = (db.session && db.session.userId) || null;
    if (!me) throw new Error('Please sign in.');
    const d = store.get('live', { n: [], c: [], m: [] });
    const now = () => new Date().toISOString();
    let c = d.c.find((x) => String(x.listing_id || '') === String(t.listing || '')
      && ((x.starter_id === me && x.other_id === t.other) || (x.starter_id === t.other && x.other_id === me)));
    if (!c) {
      c = {
        id: 'cv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        starter_id: me, other_id: t.other, listing_id: t.listing || null,
        vendor_id: null, order_id: null, wanted_id: null,
        subject: String(t.subject || 'RAQBO deal').slice(0, 160),
        starter_name: t.myName || (db.session && db.session.name) || 'RAQBO member',
        other_name: t.otherName || 'RAQBO member',
        last_message_at: now(), last_preview: '', last_sender: null, created_at: now()
      };
      d.c.push(c);
      d.n.unshift({ id: Date.now(), user_id: t.other, kind: 'message', title: t.notifyTitle || 'A message about your deal', body: String(t.subject || '').slice(0, 140), link: '#messages/' + c.id, created_at: now(), read_at: null });
      store.set('live', d);
      window.dispatchEvent(new Event('raqbo-live'));
    }
    return c.id;
  }

  // Open a room and go to it. `rpc` is the Supabase function, `local` builds
  // the demo-mode room. Errors come back in words a member can act on.
  async function rqRoomGo(btn, rpc, args, local, setupNote) {
    const done = btn ? busy(btn, 'Opening…') : () => {};
    try {
      const cid = SB ? (await (async () => { const { data, error } = await SB.rpc(rpc, args); if (error) throw error; return data; })()) : local();
      if (!cid) throw new Error('Could not open the room.');
      done();
      try { if (pf.my.open) closeMy(); } catch { /* ignore */ }
      try { if ($('.modal-backdrop')) closeModal(); } catch { /* ignore */ }
      openInbox(cid);
    } catch (err) {
      done();
      const m = (err && err.message) || '';
      toast(/does not exist|schema cache|could not find the function|relation/i.test(m) ? (setupNote || 'Deal rooms are being set up.') : (m || 'Could not open the room.'));
    }
  }
