  /* =====================================================================
     Backend 2 — SUPABASE (real database, storage and phone sign-in)
     ===================================================================== */
  const BUCKET = 'listing-media';
  const LISTING_COLS = 'id, ref, owner_id, advertiser_name, title, description, purpose, property_type, advertiser_role, city, area, size, size_unit, price, bedrooms, bathrooms, status, review_note, is_sample, created_at, published_at, listing_media(id, kind, path, external_url, file_name, size_bytes, sort_order)';
  const safeName = (n) => String(n || 'file').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(-60) || 'file';
  const sbErr = (error, fallback) => {
    const m = (error && (error.message || error.error_description)) || fallback || 'Something went wrong.';
    if (/fetch|network/i.test(m)) return 'Could not reach the server. Check your internet connection and try again.';
    return m;
  };
  /* ---------- Sign-in (Supabase Auth: email + password, and Google) ---------- */
  const AUTH_ERRORS = [
    [/invalid login credentials/i, 'Incorrect email or password.'],
    [/already registered|already been registered|user already exists/i, 'An account with this email already exists. Please sign in instead.'],
    [/email not confirmed/i, 'This email is not confirmed yet. (Admin: in Supabase → Authentication → Sign In / Providers → Email, turn OFF “Confirm email”.)'],
    [/password.*(at least|should be|characters)|weak password/i, 'Please use a stronger password (at least 8 characters).'],
    [/signups? not allowed|signup.*disabled/i, 'New sign-ups are switched off. (Admin: allow new users in Supabase → Authentication → Sign In / Providers.)'],
    [/provider is not enabled|unsupported provider/i, 'Google sign-in is not enabled yet. (Admin: turn on Google in Supabase → Authentication.)'],
    [/captcha/i, 'Security check required. (Admin: turn OFF captcha in Supabase → Authentication → Attack Protection.)'],
    [/error sending|smtp|email.*send/i, 'Supabase tried to send an email. (Admin: turn OFF “Confirm email” in Supabase → Authentication → Sign In / Providers → Email.)'],
    [/rate limit|too many/i, 'Too many attempts. Please wait a minute and try again.'],
    [/invalid.*email|unable to validate email/i, 'Please enter a valid email address.']
  ];
  const authErr = (error, fallback) => { const m = (error && error.message) || fallback || 'Something went wrong.'; const hit = AUTH_ERRORS.find(([re]) => re.test(m)); return hit ? hit[1] : sbErr(error, fallback); };
  function supabaseAuth(sb) {
    const toUser = (u) => { if (!u) return null; const meta = u.user_metadata || {}; return { id: u.id, email: u.email || '', createdAt: u.created_at, name: meta.full_name || meta.name || '', photo: meta.avatar_url || meta.picture || '' }; };
    return {
      async current() { const { data } = await sb.auth.getSession(); return toUser(data.session && data.session.user); },
      async signUp(name, email, password) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw new Error(authErr(error, 'Could not create the account.'));
        if (!data.session) {
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('An account with this email already exists. Please sign in instead.');
          throw new Error('Account created, but email confirmation is switched on. (Admin: in Supabase → Authentication → Sign In / Providers → Email, turn OFF “Confirm email”.)');
        }
        return toUser(data.user);
      },
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(authErr(error, 'Could not sign in.'));
        return toUser(data.user);
      },
      async googleSignIn() {
        const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
        if (error) throw new Error(authErr(error, 'Could not start Google sign-in.'));
      },
      async completeProfile(name, phone) {
        const { error } = await sb.rpc('complete_profile', { p_full_name: name, p_phone: phone });
        if (error) throw new Error(authErr(error, 'Could not save your details.'));
      },
      async signInEmail(email, password) { return this.signIn(email, password); },
      async resetPassword(email) {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) {
          const m = error.message || '';
          if (/error sending|smtp|email.*send/i.test(m)) throw new Error('The reset email could not be sent. (Admin: set up custom SMTP in Supabase → Authentication → Emails → SMTP Settings.)');
          if (/rate limit|too many|seconds/i.test(m)) throw new Error('Too many reset emails. Please wait a few minutes and try again.');
          throw new Error(authErr(error, 'Could not send the reset link.'));
        }
      },
      async updatePassword(password) {
        const { data, error } = await sb.auth.updateUser({ password });
        if (error) throw new Error(/session|jwt|expired|missing/i.test(error.message || '') ? 'This reset link has expired. Please request a new one.' : authErr(error, 'Could not change the password.'));
        return toUser(data.user);
      },
      async signOut() { await sb.auth.signOut(); }
    };
  }
  const URL_TTL = 7 * 24 * 3600;   // photo links last 7 days
  const lsJSON = (key, max) => ({
    read() { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && (!max || Date.now() - (v.t || 0) < max) ? v.d : null; } catch { return null; } },
    write(d) { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { try { localStorage.removeItem(key); } catch { /* ignore */ } } }
  });
  const listCache = lsJSON('raqbo-listings-v1', 3 * 24 * 3600e3);
  const urlCache = (() => { const c = lsJSON('raqbo-photo-links-v1'); return { read: () => c.read() || {}, write: (m) => { const now = Date.now(); const keep = Object.entries(m).filter(([, v]) => v.e > now).slice(-4000); c.write(Object.fromEntries(keep)); } }; })();
  function makeSupabaseBackend(sb, auth) {
    const signUrls = async (rows) => {
      const paths = rows.flatMap((r) => {
        const ms = (r.listing_media || []).filter((m) => m.path); const cover = ms.filter((m) => m.kind === 'photo').sort((a, b) => a.sort_order - b.sort_order)[0];
        return ms.map((m) => m.path).concat(cover ? [cover.path + THUMB] : []);   // small cover picture for the property cards
      });
      const map = new Map(); if (!paths.length) return map;
      // Re-use photo links from earlier visits (same link = the browser and CDN can serve the photo from cache)
      const cache = urlCache.read(); const now = Date.now(); const need = [];
      paths.forEach((p) => { const c = cache[p]; if (c && c.e > now + 3600e3) { if (c.u) map.set(p, c.u); } else need.push(p); });
      for (let i = 0; i < need.length; i += 400) {
        const part = need.slice(i, i + 400);
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(part, URL_TTL);
        if (!error && data) data.forEach((d) => { if (d.signedUrl) map.set(d.path, d.signedUrl); cache[d.path] = { u: d.signedUrl || '', e: now + (d.signedUrl ? URL_TTL * 1000 : 6 * 3600e3) }; });
      }
      if (need.length) urlCache.write(cache);
      return map;
    };
    const signedFrom = (rows) => { const cache = urlCache.read(); const map = new Map(); rows.forEach((r) => (r.listing_media || []).forEach((m) => { [m.path, m.path + THUMB].forEach((p) => { const c = p && cache[p]; if (c && c.u && c.e > Date.now()) map.set(p, c.u); }); })); return map; };
    const toListing = (r, urls) => {
      const m = (r.listing_media || []).slice().sort((a, b) => a.sort_order - b.sort_order)
        .map((x) => ({ id: x.id, kind: x.kind, name: x.file_name || '', size: x.size_bytes || 0, path: x.path || '', src: x.external_url || urls.get(x.path) || '', thumb: x.path ? urls.get(x.path + THUMB) || '' : '' }))
        .filter((x) => x.src);
      return {
        id: r.id, ref: r.ref, sample: r.is_sample, status: r.status, title: r.title, description: r.description, purpose: r.purpose, type: r.property_type, role: r.advertiser_role,
        city: r.city, area: r.area, size: Number(r.size), sizeUnit: r.size_unit, price: Number(r.price), beds: r.bedrooms || 0, baths: r.bathrooms || 0,
        ownerId: r.owner_id, ownerName: (r.owner && r.owner.full_name) || r.advertiser_name || 'Advertiser', ownerPhone: r.owner && r.owner.phone ? normPhone(r.owner.phone) || r.owner.phone : '',
        createdAt: Date.parse(r.created_at), publishedAt: r.published_at ? Date.parse(r.published_at) : null, reviewNote: r.review_note || '', lat: r.lat != null ? Number(r.lat) : null, lng: r.lng != null ? Number(r.lng) : null,
        photos: m.filter((x) => x.kind === 'photo'), videos: m.filter((x) => x.kind === 'video'), ...coreMap(r), ...mfMap(r)
      };
    };
    let currentUser = null;
    const loadProfile = async (user) => {
      if (!user) { currentUser = null; db.session = null; db.isAdmin = false; return; }
      currentUser = user;
      const { data } = await sb.from('profiles').select('full_name, email, phone, verified, role, created_at').eq('id', user.id).maybeSingle();
      db.session = { userId: user.id, name: (data && data.full_name) || user.name || '', email: (data && data.email) || user.email || '', phone: data && data.phone ? normPhone(data.phone) || data.phone : '', verified: !!(data && data.verified), since: Date.parse((data && data.created_at) || user.createdAt) || Date.now(), photo: /^https:\/\//.test(user.photo || '') ? user.photo : '' };
      db.isAdmin = !!data && data.role === 'admin';
    };
    const loadFavorites = async () => {
      const local = store.get('liveFavorites', []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      if (!db.session) { db.favorites = local; return; }
      if (local.length) { await sb.from('favorites').upsert(local.map((listing_id) => ({ listing_id })), { onConflict: 'user_id,listing_id', ignoreDuplicates: true }); store.set('liveFavorites', []); }
      const { data } = await sb.from('favorites').select('listing_id'); db.favorites = (data || []).map((f) => f.listing_id);
    };
    const api = {
      mode: 'supabase', client: sb,
      // Instant start: show the listings from the last visit while fresh ones load
      warm() { const rows = listCache.read(); if (!rows || !rows.length) return false; const urls = signedFrom(rows); db.listings = rows.map((r) => toListing(r, urls)); return true; },
      async init() {
        await loadProfile(await auth.current());
        await Promise.all([this.reloadListings(), loadFavorites()]);
      },
      async reloadListings() {
        let cols0 = db.noGeo ? LISTING_COLS : LISTING_COLS.replace('published_at,', 'published_at, lat, lng,'); if (!db.noExt) cols0 = cols0.replace('review_note,', 'review_note, sale_mode, channel, raqbo_role, raqbo_role_note, covered_area, covered_unit, possession, utilities, approved_plan, encumbrance,'); if (!db.noExt && !db.noV18) cols0 = cols0.replace('review_note,', 'review_note, landmarks, availability, marla_sqft, confirmed_at, prev_price, price_changed_at,');
        const cols = mfCols(cols0) + (db.isAdmin ? ', owner:profiles!listings_owner_id_fkey(full_name, phone)' : '');
        let { data, error } = await sb.from('listings').select(cols).order('created_at', { ascending: false }).limit(500);
        if (error && mfColsFail(error)) return this.reloadListings();   // run update_27 / update_32
        if (error && !db.noV18 && /landmarks|availability|marla_sqft|confirmed_at|prev_price|price_changed_at/i.test(error.message || '')) { db.noV18 = true; return this.reloadListings(); }   // run update_18_listings.sql
        if (error && !db.noExt && /sale_mode|channel|raqbo_role|covered_|possession|utilities|approved_plan|encumbrance/i.test(error.message || '')) { db.noExt = true; return this.reloadListings(); }   // run update_13_core.sql
        if (error && !db.noGeo && /lat|lng|column/i.test(error.message || '')) { db.noGeo = true; return this.reloadListings(); }   // map pins not set up yet (run update_9_live.sql)
        if (error) throw new Error(sbErr(error, 'Could not load listings.'));
        const urls = await signUrls(data); db.listings = data.map((r) => toListing(r, urls));
        if (!db.isAdmin) listCache.write(data.filter((r) => r.status === 'published').slice(0, 250));
        await this.ratingSummaries();
      },
      async ratingSummaries() {
        const { data, error } = await sb.from('listing_rating_summary').select('listing_id, avg_rating, review_count');
        if (error) { db.ratings = {}; db.reviewsUnavailable = /does not exist|schema cache|relation/i.test(error.message || ''); return; }
        db.reviewsUnavailable = false;
        db.ratings = Object.fromEntries((data || []).map((r) => [r.listing_id, { avg: Number(r.avg_rating), count: r.review_count }]));
      },
      async listReviews(listingId) {
        const { data, error } = await sb.from('reviews').select('id, listing_id, user_id, rating, comment, reviewer_name, created_at, updated_at').eq('listing_id', listingId).order('created_at', { ascending: false }).limit(200);
        if (error) throw new Error(sbErr(error, 'Could not load reviews.'));
        return (data || []).map((r) => ({ id: r.id, listingId: r.listing_id, userId: r.user_id, rating: r.rating, comment: r.comment, name: r.reviewer_name, createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at || r.created_at) }));
      },
      async saveReview(listingId, rating, comment, existingId) {
        const q = existingId ? sb.from('reviews').update({ rating, comment }).eq('id', existingId) : sb.from('reviews').insert({ listing_id: listingId, rating, comment });
        const { error } = await q;
        if (error) {
          const m = error.message || '';
          if (/duplicate|unique/i.test(m)) throw new Error('You have already reviewed this property. Edit your review instead.');
          if (/row-level security/i.test(m)) throw new Error('Please finish your account (add your mobile number) before writing a review.');
          throw new Error(sbErr(error, 'Could not save your review.'));
        }
      },
      async deleteReview(id) {
        const { error } = await sb.from('reviews').delete().eq('id', id);
        if (error) throw new Error(sbErr(error, 'Could not delete the review.'));
      },
      subscribeReviews(listingId, cb) {
        const ch = sb.channel('reviews-' + listingId)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: 'listing_id=eq.' + listingId }, cb)
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reviews' }, cb)
          .subscribe();
        return () => { sb.removeChannel(ch); };
      },
      async signUp(name, email, phone, password) {
        const u = await auth.signUp(name, email, password);
        await auth.completeProfile(name, e164(phone));
        await loadProfile(u); await Promise.all([this.reloadListings(), loadFavorites()]);
      },
      async signIn(email, password) {
        const u = await auth.signIn(email, password);
        await loadProfile(u); await Promise.all([this.reloadListings(), loadFavorites()]);
      },
      async googleSignIn() { await auth.googleSignIn(); },
      async resetPassword(email) { await auth.resetPassword(email); return { sent: true }; },
      async updatePassword(password) { const u = await auth.updatePassword(password); await loadProfile(u); await Promise.all([this.reloadListings(), loadFavorites()]); },
      async completeProfile(name, phone) { await auth.completeProfile(name, e164(phone)); await loadProfile(currentUser); },
      async signOut() { await auth.signOut(); db.session = null; db.isAdmin = false; db.enquiries = []; db.reports = []; await Promise.all([this.reloadListings(), loadFavorites()]); },
      async toggleFavorite(id) {
        const on = !db.favorites.includes(id);
        if (!db.session) { if (on) db.favorites.push(id); else db.favorites.splice(db.favorites.indexOf(id), 1); store.set('liveFavorites', db.favorites); return on; }
        const { error } = on ? await sb.from('favorites').insert({ listing_id: id }) : await sb.from('favorites').delete().eq('listing_id', id);
        if (error) throw new Error(sbErr(error, 'Could not update favorites.'));
        if (on) db.favorites.push(id); else db.favorites.splice(db.favorites.indexOf(id), 1); return on;
      },
      async submitListing(data, files, progress) {
        progress('Creating listing…');
        const row = { title: data.title, description: data.description, purpose: data.purpose, property_type: data.type, advertiser_role: data.role, city: data.city, area: data.area, size: data.size, size_unit: data.sizeUnit, price: data.price, bedrooms: data.beds, bathrooms: data.baths, owner_id: db.session.userId, status: 'pending', ...(db.noGeo ? {} : { lat: data.lat ?? null, lng: data.lng ?? null }), ...coreRow(data) };
        const { data: created, error } = await sb.from('listings').insert(row).select('id, ref').single();
        if (error) throw new Error(sbErr(error, 'Could not create the listing.'));
        const uploaded = []; const mediaRows = []; let n = 0; const total = files.photo.length + files.video.length;
        try {
          for (const kind of ['photo', 'video']) for (const file of files[kind]) {
            progress(`Uploading file ${++n} of ${total}…`);
            const path = `${db.session.userId}/${created.id}/${n}-${Date.now().toString(36)}-${safeName(file.name)}`;
            const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'), upsert: false });
            if (upErr) throw new Error(`Upload failed for ${file.name}: ${sbErr(upErr)}`);
            if (kind === 'photo') { try { const th = await shrinkImage(file, 720, 0.78, 'image/jpeg'); if (th !== file) { const r = await sb.storage.from(BUCKET).upload(path + THUMB, th, { contentType: th.type, upsert: false }); if (!r.error) uploaded.push(path + THUMB); } } catch { /* card falls back to the full photo */ } }
            uploaded.push(path); mediaRows.push({ listing_id: created.id, kind, path, file_name: file.name.slice(0, 255), mime_type: file.type, size_bytes: file.size, sort_order: n });
          }
          progress('Saving…');
          const { error: mErr } = await sb.from('listing_media').insert(mediaRows); if (mErr) throw new Error(sbErr(mErr, 'Could not save media.'));
        } catch (err) {
          if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded);
          await sb.from('listings').delete().eq('id', created.id); throw err;
        }
        await this.reloadListings(); return byId(created.id) || { ...data, ref: created.ref, photos: files.photo, videos: files.video };
      },
      async updateListing(id, data, files, removed, progress) {
        progress('Saving changes…');
        const row = { title: data.title, description: data.description, purpose: data.purpose, property_type: data.type, advertiser_role: data.role, city: data.city, area: data.area, size: data.size, size_unit: data.sizeUnit, price: data.price, bedrooms: data.beds, bathrooms: data.baths, ...(db.noGeo ? {} : { lat: data.lat ?? null, lng: data.lng ?? null }), ...coreRow(data) };
        const { data: upd, error } = await sb.from('listings').update(row).eq('id', id).select('id');
        if (error || !upd || !upd.length) throw new Error(sbErr(error, 'You can only edit your own listings.'));
        if (removed.length) {
          const { error: dErr } = await sb.from('listing_media').delete().in('id', removed.map((r) => r.id));
          if (dErr) throw new Error(sbErr(dErr, 'Could not remove the old photos.'));
          const paths = removed.map((r) => r.path).filter(Boolean).flatMap((x) => [x, x + THUMB]); if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        }
        const uploaded = []; const mediaRows = []; let n = 0; const total = files.photo.length + files.video.length; const base = Math.floor(Date.now() / 1000);
        try {
          for (const kind of ['photo', 'video']) for (const file of files[kind]) {
            progress(`Uploading file ${++n} of ${total}…`);
            const path = `${db.session.userId}/${id}/${n}-${Date.now().toString(36)}-${safeName(file.name)}`;
            const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'), upsert: false });
            if (upErr) throw new Error(`Upload failed for ${file.name}: ${sbErr(upErr)}`);
            if (kind === 'photo') { try { const th = await shrinkImage(file, 720, 0.78, 'image/jpeg'); if (th !== file) { const r = await sb.storage.from(BUCKET).upload(path + THUMB, th, { contentType: th.type, upsert: false }); if (!r.error) uploaded.push(path + THUMB); } } catch { /* card falls back to the full photo */ } }
            uploaded.push(path); mediaRows.push({ listing_id: id, kind, path, file_name: file.name.slice(0, 255), mime_type: file.type, size_bytes: file.size, sort_order: base + n });
          }
          if (mediaRows.length) { const { error: mErr } = await sb.from('listing_media').insert(mediaRows); if (mErr) throw new Error(sbErr(mErr, 'Could not save media.')); }
        } catch (err) { if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded); await this.reloadListings(); throw err; }
        await this.reloadListings(); return byId(id);
      },
      async deleteListing(id) {
        const l = byId(id); const paths = l ? [...l.photos, ...l.videos].map((m) => m.path).filter(Boolean).flatMap((x) => [x, x + THUMB]) : [];
        const { data, error } = await sb.from('listings').delete().eq('id', id).select('id');
        if (error || !data || !data.length) throw new Error(sbErr(error, 'Could not delete this listing.'));
        if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        db.favorites = db.favorites.filter((x) => x !== id); await this.reloadListings();
      },
      async createEnquiry(e) {
        const ref = e.ref || refCode('ENQ');
        const row = { ref, service: e.service, name: e.name, phone: e.phone, email: e.email || null, city: e.city, property_ref: e.property || null, message: e.message, preferred_contact: e.via };
        let { error } = await sb.from('enquiries').insert(e.details && Object.keys(e.details).length ? { ...row, details: e.details } : row);
        if (error && /details|schema cache/i.test(error.message || '')) ({ error } = await sb.from('enquiries').insert(row));
        if (error) throw new Error(sbErr(error, 'Could not send the enquiry.')); return ref;
      },
      async createReport(r) {
        const ref = refCode('RPT');
        const { error } = await sb.from('reports').insert({ ref, listing_id: r.listingId, reason: r.reason, details: r.details || null, reporter_name: r.reporterName || null, reporter_phone: r.reporterPhone || null });
        if (error) throw new Error(sbErr(error, 'Could not send the report.')); return ref;
      },
      async adminSignIn(email, password) {
        const u = await auth.signInEmail(email, password);
        await loadProfile(u);
        if (!db.isAdmin) { await this.signOut(); throw new Error('This account does not have admin access yet. Give it the admin role in Supabase (see SETUP step 4), then sign in again.'); }
        await loadFavorites();
      },
      async adminLoad() {
        if (!db.isAdmin) return;
        const [, enq, rep] = await Promise.all([
          this.reloadListings(),
          sb.from('enquiries').select('*').order('created_at', { ascending: false }).limit(500),
          sb.from('reports').select('*, listing:listings(title)').order('created_at', { ascending: false }).limit(500)
        ]);
        if (enq.error || rep.error) throw new Error(sbErr(enq.error || rep.error, 'Could not load admin data.'));
        db.enquiries = enq.data.map((e) => ({ id: e.id, ref: e.ref, service: e.service, name: e.name, phone: e.phone, email: e.email || '', city: e.city || '', property: e.property_ref || '', message: e.message, via: e.preferred_contact || '', status: e.status, clientNote: e.client_note || '', details: e.details || {}, quoteAmount: e.quote_amount || null, quoteNote: e.quote_note || '', quoteValidUntil: e.quote_valid_until || null, quoteStatus: e.quote_status || '', createdAt: Date.parse(e.created_at) }));
        db.reports = rep.data.map((r) => ({ id: r.id, ref: r.ref, listingId: r.listing_id, listingTitle: (r.listing && r.listing.title) || 'Listing', reason: r.reason, details: r.details || '', reporterName: r.reporter_name || '', reporterPhone: r.reporter_phone || '', status: r.status, createdAt: Date.parse(r.created_at) }));
      },
      async setListingStatus(id, status, note) {
        const patch = { status }; if (note || status !== 'pending') patch.review_note = note || null;
        const { data, error } = await sb.from('listings').update(patch).eq('id', id).select('id');
        if (error || !data || !data.length) throw new Error(sbErr(error, 'Not permitted. Sign in again as an admin.'));
        await this.reloadListings();
      },
      async setEnquiryStatus(id, status) {
        const { error } = await sb.from('enquiries').update({ status }).eq('id', id); if (error) throw new Error(sbErr(error));
        const x = db.enquiries.find((e) => e.id === id); if (x) x.status = status;
      },
      async setReportStatus(id, status) {
        const { error } = await sb.from('reports').update({ status }).eq('id', id); if (error) throw new Error(sbErr(error));
        const x = db.reports.find((e) => e.id === id); if (x) x.status = status;
      }
    };
    return api;
  }

  /* ---------- Choose backend ---------- */
  const CFG = window.RAQBO_CONFIG || {};
  let recoveryMode = /(^|[#&])type=recovery(&|$)/.test(location.hash);
  let backend = localBackend; let backendWarning = ''; let SB = null;
  if (CFG.supabaseUrl && CFG.supabaseAnonKey) {
    if (!(window.supabase && window.supabase.createClient)) backendWarning = 'Could not load the Supabase library (check your internet connection). Running in browser-only demo mode.';
    else {
      const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); SB = sb;
      backend = makeSupabaseBackend(sb, supabaseAuth(sb));
      sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; if (db.loaded) setTimeout(() => showGate('newpass'), 0); } });
    }
  }
  const LIVE = backend.mode === 'supabase';

  /* ---------- Spam protection: Cloudflare Turnstile (only when a site key is set) ---------- */
  const captcha = (() => {
    const key = String(CFG.turnstileSiteKey || '').trim(); let loader = null;
    const load = () => loader || (loader = new Promise((resolve, reject) => {
      if (window.turnstile) { resolve(); return; }
      const sc = document.createElement('script'); sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true;
      sc.onload = () => resolve(); sc.onerror = () => { loader = null; reject(new Error('Could not load the security check. Check your connection and refresh the page.')); };
      document.head.append(sc);
    }));
    const off = { get: async () => undefined, reset() {} };
    return {
      get enabled() { return !!key && LIVE; },
      mount(el) {
        if (!key || !LIVE || !el) return off;
        const st = { token: '', id: null };
        const ready = load().then(() => { st.id = window.turnstile.render(el, { sitekey: key, theme: 'light', size: 'flexible', callback: (t) => { st.token = t; }, 'expired-callback': () => { st.token = ''; }, 'error-callback': () => { st.token = ''; } }); });
        return {
          async get() { await ready; if (!st.token) throw new Error('Please complete the security check above the button.'); return st.token; },
          reset() { st.token = ''; try { if (st.id !== null) window.turnstile.reset(st.id); } catch { /* ignore */ } }
        };
      }
    };
  })();
  const CAPTCHA_BOX = () => (captcha.enabled ? '<div class="captcha-box" data-captcha></div>' : '');

  /* ---------- WhatsApp ---------- */
  const WA_NUMBER = String(CFG.whatsappNumber || '923001223344').replace(/\D/g, '');
  const waLink = (text) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;
  const openWhatsApp = (url) => { const w = window.open(url, '_blank'); if (w) { try { w.opener = null; } catch { /* ignore */ } } return !!w; };
  const waMessage = (title, rows, body) => [`*${title}*`, ...rows.filter(([, v]) => v).map(([k, v]) => `*${k}:* ${v}`), body ? `\n*Message:*\n${body}` : '', '\n— Sent from raqbo.pk'].filter(Boolean).join('\n');
  const LOGO_SRC = ($('.brand-logo') || {}).src || '';
  const BRAND_HTML = (label) => `${LOGO_SRC ? `<img class="brand-logo" src="${esc(LOGO_SRC)}" alt="">` : ''}<span class="brand-word">RAQBO<small>${esc(label)}</small></span>`;

