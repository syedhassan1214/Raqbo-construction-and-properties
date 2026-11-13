  /* =====================================================================
     Backend 1 — DEMO MODE (this browser only)
     ===================================================================== */
  const localReviewEmit = (listingId) => setTimeout(() => window.dispatchEvent(new CustomEvent('raqbo-reviews', { detail: listingId })), 0);
  const localBackend = {
    mode: 'local',
    async init() {
      const DATA_VERSION = 3; let listings = store.get('listings', null);
      if (!Array.isArray(listings) || store.get('version', 0) !== DATA_VERSION) {
        const own = Array.isArray(listings) ? listings.filter((l) => !l.sample) : [];
        listings = SAMPLES.map((s) => ({ ...s })).concat(own); store.set('listings', listings); store.set('version', DATA_VERSION);
      }
      db.listings = listings; db.favorites = store.get('favorites', []); db.enquiries = store.get('enquiries', []); db.reports = store.get('reports', []);
      db.session = store.get('session', null); db.isAdmin = true; this.ratingSummaries();
    },
    save(k) { if (!store.set(k, db[k])) toast('This browser blocked saving. Changes will be lost when the page closes.'); },
    async reloadListings() {},
    async signUp(name, email, phone, password) {
      const key = email.toLowerCase(); const acc = store.get('accounts', {});
      if (acc[key]) throw new Error('An account with this email already exists. Please sign in.');
      acc[key] = { userId: 'local:' + key, email: key, name, phone: normPhone(phone), verified: true, since: Date.now(), pw: await hashPw(password) };
      store.set('accounts', acc); const { pw, ...sess } = acc[key]; db.session = sess; store.set('session', db.session);
    },
    async signIn(email, password) {
      const key = email.toLowerCase(); const a = store.get('accounts', {})[key];
      if (!a || a.pw !== await hashPw(password)) throw new Error('Incorrect email or password.');
      const { pw, ...sess } = a; db.session = sess; store.set('session', db.session);
    },
    async googleSignIn() { throw new Error('Google sign-in works once the website is connected to Supabase.'); },
    ratingSummaries() {
      const all = store.get('reviews', []); const m = {};
      all.forEach((r) => { (m[r.listingId] = m[r.listingId] || []).push(r.rating); });
      db.ratings = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, count: v.length }]));
    },
    async listReviews(listingId) { return store.get('reviews', []).filter((r) => r.listingId === listingId); },
    async saveReview(listingId, rating, comment, existingId) {
      if (!db.session) throw new Error('Please sign in first.');
      const l = db.listings.find((x) => x.id === listingId); if (!l || l.status !== 'published') throw new Error('You can only review published properties.');
      if (l.ownerId && l.ownerId === db.session.userId) throw new Error('You cannot review your own property.');
      const all = store.get('reviews', []); const now = Date.now();
      const mine = all.find((r) => r.listingId === listingId && r.userId === db.session.userId);
      if (mine) Object.assign(mine, { rating, comment, updatedAt: now, name: db.session.name || 'RAQBO user' });
      else all.push({ id: uid('rev'), listingId, userId: db.session.userId, name: db.session.name || 'RAQBO user', rating, comment, createdAt: now, updatedAt: now });
      store.set('reviews', all); this.ratingSummaries(); localReviewEmit(listingId);
    },
    async deleteReview(id) {
      const all = store.get('reviews', []); const r = all.find((x) => x.id === id); if (!r) return;
      if (!db.session || (r.userId !== db.session.userId && !db.isAdmin)) throw new Error('You can only delete your own review.');
      store.set('reviews', all.filter((x) => x.id !== id)); this.ratingSummaries(); localReviewEmit(r.listingId);
    },
    subscribeReviews(listingId, cb) {
      const onLocal = (e) => { if (e.detail === listingId) cb(); };
      const onStorage = (e) => { if (e.key && /reviews/.test(e.key)) { localBackend.ratingSummaries(); cb(); } };
      window.addEventListener('raqbo-reviews', onLocal); window.addEventListener('storage', onStorage);
      return () => { window.removeEventListener('raqbo-reviews', onLocal); window.removeEventListener('storage', onStorage); };
    },
    async resetPassword(email) {
      const key = email.toLowerCase(); if (!store.get('accounts', {})[key]) throw new Error('No account found with this email.');
      store.set('resetEmail', key); return { demo: true };
    },
    async updatePassword(password) {
      const key = (db.session && db.session.email) || store.get('resetEmail', ''); const acc = store.get('accounts', {});
      if (!acc[key]) throw new Error('This reset link has expired. Please request a new one.');
      acc[key].pw = await hashPw(password); store.set('accounts', acc); store.set('resetEmail', '');
      const { pw, ...sess } = acc[key]; db.session = sess; store.set('session', db.session);
    },
    async completeProfile(name, phone) {
      if (!db.session) throw new Error('Please sign in first.');
      Object.assign(db.session, { name, phone: normPhone(phone), verified: true });
      const acc = store.get('accounts', {}); if (acc[db.session.email]) Object.assign(acc[db.session.email], { name, phone: normPhone(phone), verified: true }); store.set('accounts', acc); store.set('session', db.session);
    },
    async signOut() { db.session = null; store.set('session', null); },
    async toggleFavorite(id) {
      const i = db.favorites.indexOf(id); if (i >= 0) db.favorites.splice(i, 1); else db.favorites.push(id); this.save('favorites'); return i < 0;
    },
    async submitListing(data, files, progress) {
      const refs = { photo: [], video: [] }; let n = 0; const total = files.photo.length + files.video.length;
      for (const kind of ['photo', 'video']) for (const file of files[kind]) {
        progress(`Saving file ${++n} of ${total}…`); const id = uid('m'); await media.put(id, file);
        refs[kind].push({ id, kind, name: file.name, type: file.type, size: file.size });
      }
      const now = Date.now();
      const listing = { ...data, id: uid('L'), ref: refCode('LST'), sample: false, status: 'pending', photos: refs.photo, videos: refs.video, ownerId: db.session.userId, ownerName: db.session.name, ownerPhone: db.session.phone, createdAt: now, publishedAt: null, reviewNote: '' };
      db.listings.push(listing);
      if (!store.set('listings', db.listings)) { db.listings.pop(); await media.remove([...refs.photo, ...refs.video].map((r) => r.id)); throw new Error('This browser could not store the listing (storage may be full or blocked). Try fewer or smaller files.'); }
      return listing;
    },
    async updateListing(id, data, files, removed, progress) {
      const l = byId(id); if (!l || l.ownerId !== db.session.userId) throw new Error('You can only edit your own listings.');
      const refs = { photo: [], video: [] }; let n = 0; const total = files.photo.length + files.video.length;
      for (const kind of ['photo', 'video']) for (const file of files[kind]) {
        progress(`Saving file ${++n} of ${total}…`); const mid = uid('m'); await media.put(mid, file);
        refs[kind].push({ id: mid, kind, name: file.name, type: file.type, size: file.size });
      }
      const gone = new Set(removed.map((r) => r.id));
      await media.remove(removed.filter((r) => !r.src).map((r) => r.id));
      Object.assign(l, data, { status: 'pending', photos: l.photos.filter((m) => !gone.has(m.id)).concat(refs.photo), videos: l.videos.filter((m) => !gone.has(m.id)).concat(refs.video) });
      if (!store.set('listings', db.listings)) throw new Error('This browser could not save the changes.');
      return l;
    },
    async deleteListing(id) {
      const i = db.listings.findIndex((x) => x.id === id); const l = db.listings[i];
      if (!l || l.ownerId !== db.session.userId) throw new Error('You can only delete your own listings.');
      await media.remove([...l.photos, ...l.videos].filter((m) => !m.src).map((m) => m.id));
      db.listings.splice(i, 1); db.favorites = db.favorites.filter((x) => x !== id); this.save('listings'); this.save('favorites');
    },
    async createEnquiry(e) { const ref = e.ref || refCode('ENQ'); db.enquiries.unshift({ ...e, id: uid('e'), ref, status: 'new', createdAt: Date.now() }); if (!store.set('enquiries', db.enquiries)) { db.enquiries.shift(); throw new Error('Could not save your request in this browser.'); } return ref; },
    async createReport(r) { const ref = refCode('RPT'); db.reports.unshift({ ...r, id: uid('r'), ref, status: 'open', createdAt: Date.now() }); this.save('reports'); return ref; },
    async adminSignIn() {},
    async adminLoad() {},
    async setListingStatus(id, status, note) {
      const l = byId(id); if (!l) return; l.status = status; if (note || status !== 'pending') l.reviewNote = note || l.reviewNote; if (status === 'published') l.publishedAt = Date.now(); this.save('listings');
    },
    async setEnquiryStatus(id, status) { const x = db.enquiries.find((e) => e.id === id); if (x) { x.status = status; this.save('enquiries'); } },
    async setReportStatus(id, status) { const x = db.reports.find((e) => e.id === id); if (x) { x.status = status; this.save('reports'); } },
    async reset() {
      await media.clear(); db.listings = SAMPLES.map((x) => ({ ...x })); db.favorites = []; db.enquiries = []; db.reports = [];
      ['listings', 'favorites', 'enquiries', 'reports'].forEach((k) => this.save(k));
    }
  };

