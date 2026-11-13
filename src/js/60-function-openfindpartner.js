  // =====================================================================
  function openFindPartner() {
    closeNavMenus(); if (pf.my.open) closeMy();
    const card = openModal('<div class="pn-page"></div>', { wide: true, label: 'Find a RAQBO Partner' });
    card.classList.add('gw-card', 'ax-modal');
    try { if (location.hash !== '#find-partner') history.replaceState(null, '', '#find-partner'); } catch { /* ignore */ }
    pnPaintDirectory(card); pnLoadDirectory(card);
  }
  async function pnLoadDirectory(card) {
    try { pn.dir = await PN.directory(pn.dirQ); } catch { pn.dir = []; }
    pnPaintDirectory(card);
  }
  function pnPaintDirectory(card) {
    const host = $('.pn-page', card || document); if (!host) return;
    const q = pn.dirQ; const list = pn.dir;
    host.innerHTML = `
      <div class="pn-head"><span class="rail-kicker">${DI(DIC.pin, 14)} PARTNER DIRECTORY</span>
        <h2>Find a RAQBO Partner Near You</h2>
        <p class="admin-sub">Every partner below is appointed by RAQBO. Check anyone&rsquo;s current status before you deal with them — a suspended or terminated partner does not appear here at all.</p></div>
      <form class="pn-dirq" data-pn-form="dir">
        <input name="province" placeholder="Province" value="${esc(q.province)}">
        <input name="city" placeholder="City" value="${esc(q.city)}">
        <input name="area" placeholder="Area or society" value="${esc(q.area)}">
        <select name="service"><option value="">Any service</option>${PN_WORK.map(([k, t]) => `<option value="${k}" ${k === q.service ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <input name="q" placeholder="Partner name or ID" value="${esc(q.q)}">
        <button type="submit" class="button button-primary">${DI(DIC.search, 15)} Search</button>
        <button type="button" class="button button-light" data-pn="dir-clear">Clear</button>
      </form>
      ${list === null ? '<div class="admin-empty">Looking…</div>' : list.length === 0
        ? '<div class="admin-empty">No RAQBO partner matches that search yet. RAQBO is appointing partners area by area — you can always deal with RAQBO directly.</div>'
        : `<div class="pn-dir">${list.map((p) => pnPartnerCard(p)).join('')}</div>`}
      <div class="pn-box"><b>Checking a partner you have met</b>
        <p>Every RAQBO partner has a QR code on their card or signboard. Scan it, or type their partner number below, and this page will tell you their status today.</p>
        <form class="pn-check" data-pn-form="check"><input name="code" placeholder="Partner ID or QR code" maxlength="40"><button type="submit" class="button button-light">Check</button></form>
        ${pn.check ? pnCheckResult(pn.check) : ''}</div>`;
    applyBrandIcons(host);
  }
  // A partner's photograph lives in a public bucket, so visitors who are not
  // signed in can see it too.
  const pnPhotoUrl = (path) => {
    if (!path) return '';
    if (/^https?:/.test(path)) return path;
    const base = (typeof CFG === 'object' && CFG && CFG.supabaseUrl) || '';
    return base ? base.replace(/\/$/, '') + '/storage/v1/object/public/partner-photos/' + path.split('/').map(encodeURIComponent).join('/') : '';
  };
  const pnSafeName = (n) => String(n || 'file').toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-50);
  // Puts one file in a bucket under the signed-in person's own folder and
  // hands back the stored path. Returns '' when there is no database behind
  // the page (the demo), so the form still works.
  async function pnUpload(file, bucket) {
    if (!SB || !file) return '';
    const path = `${pnMe()}/${Date.now().toString(36)}-${pnSafeName(file.name)}`;
    const { error } = await SB.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw new Error('That file could not be uploaded: ' + error.message);
    return path;
  }
  // ---- The partner's QR code ----
  // The code simply points a phone camera at RAQBO's own check page, which
  // reads the partner's status out of the database at the moment it is
  // scanned. Nothing about the partner is stored inside the code itself, so
  // a printed card can never say "active" after RAQBO has suspended someone.
  const pnCheckUrl = (token) => location.origin + (location.pathname || '/') + '#partner-check=' + (token || '');

  function pnPaintQr(root) {
    const boxes = (root || document).querySelectorAll('[data-pn-qr]');
    boxes.forEach((box) => {
      const url = box.getAttribute('data-pn-qr'); if (!url || box.dataset.pnQrDone) return;
      box.dataset.pnQrDone = '1';
      if (typeof vrQrInto === 'function') vrQrInto(box, url);
      else box.innerHTML = `<small>Check at<br><b>${esc(url.replace(/^https?:\/\//, ''))}</b></small>`;
    });
  }
  try {
    const mo = new MutationObserver(() => pnPaintQr(document));
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch { /* the direct calls below still run */ }
  setTimeout(() => pnPaintQr(document), 800);

  // A card the partner can print and keep on a desk or window
  // Tags are built at run time so the finished page can never contain a
  // literal script tag inside a string, which would confuse the browser.
  const PN_T = (n) => '<' + '/' + n + '>';
  const PN_O = (n, a) => '<' + n + (a ? ' ' + a : '') + '>';
  function pnQrCard(p) {
    const url = pnCheckUrl(p.qr_token);
    const w = window.open('', '_blank', 'width=520,height=700');
    if (!w) { toast('Allow pop-ups for this site to print the card.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.display_name || 'RAQBO partner')} — RAQBO</title>
      ${PN_O('style')}body{margin:0;font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#16120a;background:#fff}
      .c{width:340px;margin:28px auto;padding:24px;border:1px solid #e6ddc8;border-radius:16px;text-align:center}
      .lg{display:block;margin:0 auto 10px}
      h1{margin:0 0 2px;font-size:19px;letter-spacing:.02em}
      .d{margin:0 0 14px;color:#6b665c;font-size:13px}
      .q{width:180px;height:180px;margin:0 auto 12px}
      .q img{width:100%;height:100%}
      .id{font-weight:700;letter-spacing:.06em}
      .n{margin-top:12px;color:#6b665c;font-size:11.5px;line-height:1.45}
      @media print{body{background:#fff}.c{border:0}}${PN_T('style')}${PN_T('head')}<body>
      <div class="c">${(typeof RAQBO_MARK === 'object' && RAQBO_MARK) ? `<img class="lg" src="${RAQBO_MARK.url}" alt="RAQBO" width="46" height="${Math.round(46 * RAQBO_MARK.h / RAQBO_MARK.w)}">` : ''}<h1>${esc(p.display_name || '')}</h1>
      <p class="d">${esc(p.designation || '')}</p>
      <div class="q" id="q"></div>
      <div class="id">${esc(p.partner_id || '')}</div>
      <p class="n">Scan to check this partner's current status on RAQBO's own website. The status is read live, so this card cannot show a partner as active after RAQBO has ended the arrangement.</p>
      <p class="n">${esc(url.replace(/^https?:\/\//, ''))}</p>${PN_T('div')}
      ${PN_O('script', 'src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" integrity="sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU" crossorigin="anonymous"')}${PN_T('script')}
      ${PN_O('script')}new QRCode(document.getElementById('q'), { text: ${JSON.stringify(url)}, width: 180, height: 180 }); setTimeout(() => window.print(), 600);${PN_T('script')}
      ${PN_T('body')}${PN_T('html')}`);
    w.document.close();
  }

  const pnInitials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  const pnAvatar = (p, size) => {
    const u = pnPhotoUrl(p.photo_path);
    return u ? `<img class="pn-avatar" src="${esc(u)}" width="${size || 44}" height="${size || 44}" alt="" loading="lazy" decoding="async">`
      : `<span class="pn-avatar pn-avatar-txt" aria-hidden="true">${esc(pnInitials(p.display_name))}</span>`;
  };
  // The rating is only ever shown when real customers have given one.
  const pnStars = (r) => {
    if (!r || !r.count || r.average == null) return '';
    const n = Math.round(Number(r.average));
    return `<span class="pn-stars" title="${esc(r.average)} out of 5 from ${esc(r.count)} customer${r.count === 1 ? '' : 's'}">${'\u2605'.repeat(n)}${'\u2606'.repeat(Math.max(0, 5 - n))}<em>${esc(r.average)} (${esc(r.count)})</em></span>`;
  };

  function pnPartnerCard(p) {
    const cat = PN_CAT[p.category] || {};
    return `<article class="pn-pcard">
      <div class="pn-pcard-top">
        ${p.photo_path ? pnAvatar(p, 44) : `<span class="pn-cat-ic">${DI(DIC[cat.icon || 'user'], 20)}</span>`}
        <div><b>${esc(p.display_name)}</b><small>${esc(p.designation || cat.name || '')}</small>${pnStars(p.rating)}</div>
        <span class="pn-badge ${p.verified ? 'ok' : ''}">${p.verified ? 'Verified partner' : esc(PN_PSTATUS[p.status] || p.status)}</span>
      </div>
      <div class="pn-pcard-facts">
        <span>${DI(DIC.pin, 13)} ${esc([p.city, p.province].filter(Boolean).join(', ') || 'Area not listed')}</span>
        <span>${DI(DIC.grid, 13)} ${esc(PN_BIZ[p.business_type] || '')}</span>
        <span>${DI(DIC.shield, 13)} ${esc(p.partner_id)}</span>
      </div>
      ${(p.territories || []).length ? `<div class="pn-pcard-terr">${(p.territories || []).map((t) => `<em>${esc(t.name)}</em>`).join('')}</div>` : ''}
      ${(p.services || []).length ? `<div class="pn-pcard-svc">${(p.services || []).slice(0, 6).map((k) => `<span>${esc(PN_WORK_NAME[k] || k)}</span>`).join('')}</div>` : ''}
      ${p.office_address ? `<p class="pn-pcard-addr">${esc(p.office_address)}</p>` : ''}
      <div class="pn-pcard-foot">
        ${p.phone ? `<a class="button button-light" href="tel:${esc(p.phone)}">${DI(DIC.phone, 15)} Call</a>` : ''}
        ${p.whatsapp ? `<a class="button button-whatsapp" href="https://wa.me/${esc(String(p.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">${DI(DIC.chat, 15)} WhatsApp</a>` : ''}
        <button type="button" class="button button-ghost" data-pn="appt" data-k="${esc(p.partner_id)}">${DI(DIC.clock, 15)} Request a meeting</button>
        <button type="button" class="button button-ghost" data-pn="qr" data-k="${esc(p.qr_token || '')}">${DI(DIC.shield, 15)} Check status</button>
      </div>
    </article>`;
  }
  function pnCheckResult(r) {
    if (!r.found) return '<div class="pn-chk bad"><b>No RAQBO partner found for that code.</b><p>If someone is using the RAQBO name and does not appear here, please tell RAQBO before you deal with them.</p></div>';
    return `<div class="pn-chk ${r.active ? 'ok' : 'bad'}">
      <b>${esc(r.name)} — ${r.active ? 'an active RAQBO partner' : 'NOT currently an active RAQBO partner'}</b>
      <div class="pn-kv"><span>Partner ID</span><b>${esc(r.partner_id)}</b></div>
      <div class="pn-kv"><span>Category</span><b>${esc((PN_CAT[r.category] || {}).name || r.category)}</b></div>
      <div class="pn-kv"><span>Designation</span><b>${esc(r.designation || '—')}</b></div>
      <div class="pn-kv"><span>Status today</span><b>${esc(PN_PSTATUS[r.status] || r.status)}</b></div>
      <div class="pn-kv"><span>Areas</span><b>${esc((r.territories || []).join(', ') || '—')}</b></div>
      <div class="pn-kv"><span>May take money for RAQBO</span><b>${r.may_collect_money ? 'Yes, with written authority' : 'No — never pay this partner on RAQBO’s behalf'}</b></div>
      <div class="pn-kv"><span>RAQBO office branding</span><b>${r.office_branding ? 'Approved' : 'Not approved'}</b></div>
      <small>Checked ${esc(new Date(r.checked_at || Date.now()).toLocaleString('en-GB'))}</small>
    </div>`;
  }
  async function pnCheck(code) {
    try { pn.check = await PN.verify(String(code || '').trim()); }
    catch { pn.check = { found: false }; }
    const card = $('.pn-page'); if (card) pnPaintDirectory(card.closest('.gw-card') || card.parentElement);
  }

