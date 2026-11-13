  /* =====================================================================
     Urdu / English switch (main public pages: header, search, listings,
     services, footer, sign-in). Advertiser text is shown as written.
     Add or fix translations in src/i18n/ur.js.
     ===================================================================== */
  let UR = Object.create(null); let UR_RX = [];
  const i18n = { lang: 'en', orig: new Map(), obs: null, busy: false };
  const SKIP = 'script,style,textarea,.au,.mk,.admin-overlay,.lv-msgs,.lv-convs,.lv-thread-head,.property-card h3,.property-location,.pp-title,.pp-desc,.pp-loc,.rv-item p,.rv-top b,[data-no-i18n]';
  function urOf(s) { if (UR[s]) return UR[s]; for (const [rx, to] of UR_RX) { if (rx.test(s)) { const r = s.replace(rx, to); if (r !== s) return r; } } return null; }
  function translate(root) {
    if (i18n.lang !== 'ur' || !root) return; i18n.busy = true;
    const w = document.createTreeWalker(root.nodeType === 3 ? root.parentNode : root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      const raw = n.nodeValue; const s = raw.trim(); if (!s || s.length > 700) continue;
      const pe = n.parentElement; if (!pe || pe.closest(SKIP)) continue;
      const u = urOf(s); if (!u) continue;
      if (!i18n.orig.has(n)) i18n.orig.set(n, raw); n.nodeValue = raw.replace(s, u);
      if (pe.childNodes.length === 1) { pe.setAttribute('dir', 'rtl'); pe.classList.add('ur'); } else pe.classList.add('ur');
    }
    // whole headings / paragraphs now in Urdu read right-to-left as one line
    $$('h1,h2,h3,p,li,label>span', root.nodeType === 1 ? root : document.body).forEach((blk) => { if (blk.closest(SKIP) || !blk.querySelector('.ur') && !blk.classList.contains('ur')) return; const txt = blk.innerText.replace(/RAQBO|PKR|Cr|Lakh|[\d\s.,:·•%/+≈()–-]/g, ''); if (txt && !/[A-Za-z]/.test(txt)) { blk.setAttribute('dir', 'rtl'); blk.classList.add('ur-blk'); } });
    $$('[placeholder]', root.nodeType === 1 ? root : document).forEach((el) => { const p = el.getAttribute('data-ph-en') || el.getAttribute('placeholder'); const u = { 'City, area or society — e.g. Lahore, DHA': 'شہر، علاقہ یا سوسائٹی — مثلاً لاہور، ڈی ایچ اے', 'Write a message…': 'پیغام لکھیں…' }[p] || UR[p]; if (u) { el.setAttribute('data-ph-en', p); el.setAttribute('placeholder', u); } });
    i18n.busy = false;
  }
  function untranslate() {
    $$('.ur-blk').forEach((b) => { b.removeAttribute('dir'); b.classList.remove('ur-blk'); });
    i18n.orig.forEach((raw, n) => { if (n.isConnected) { n.nodeValue = raw; const pe = n.parentElement; if (pe) { pe.classList.remove('ur'); if (pe.getAttribute('dir') === 'rtl') pe.removeAttribute('dir'); } } }); i18n.orig.clear();
    $$('[data-ph-en]').forEach((el) => { el.setAttribute('placeholder', el.getAttribute('data-ph-en')); el.removeAttribute('data-ph-en'); });
  }
  let urLoaded = false; let urLoading = null; let urAttempts = 0; let langRequest = 0;
  async function setLang(lang, quiet) {
    const request = ++langRequest;
    if (lang === 'ur' && !urLoaded) {
      $$('[data-lang-toggle]').forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
      try {
        if (!urLoading) urLoading = import('__RAQBO_UR_ASSET__' + (urAttempts ? '?retry=' + urAttempts : ''));
        const data = await urLoading;
        UR = data.UR; UR_RX = data.UR_RX; urLoaded = true;
      } catch (err) {
        urAttempts++; urLoading = null;
        console.error('Could not load Urdu translations:', err);
        toast('Urdu could not be loaded. Please check your connection and try again.');
        return;
      } finally {
        $$('[data-lang-toggle]').forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); });
      }
      if (request !== langRequest) return;
    }
    i18n.lang = lang === 'ur' ? 'ur' : 'en'; document.documentElement.lang = i18n.lang === 'ur' ? 'ur' : 'en'; document.body.classList.toggle('lang-ur', i18n.lang === 'ur');
    try { localStorage.setItem('raqbo-lang', i18n.lang); } catch { /* ignore */ }
    $$('[data-lang-toggle]').forEach((b) => { b.textContent = i18n.lang === 'ur' ? 'English' : 'اردو'; b.setAttribute('aria-label', i18n.lang === 'ur' ? 'Switch to English' : 'اردو میں دیکھیں'); b.setAttribute('lang', i18n.lang === 'ur' ? 'en' : 'ur'); });
    if (i18n.lang === 'ur') {
      if (!$('#ur-font')) { const l = document.createElement('link'); l.id = 'ur-font'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600;700&display=swap'; document.head.append(l); }
      translate(document.body);
      if (!i18n.obs) { let t; const pending = new Set(); i18n.obs = new MutationObserver((ms) => { if (i18n.busy) return; ms.forEach((m) => m.addedNodes.forEach((a) => pending.add(a))); clearTimeout(t); t = setTimeout(() => { pending.forEach((a) => { if (a.isConnected) translate(a.nodeType === 1 ? a : a.parentNode); }); pending.clear(); }, 30); }); }
      i18n.obs.observe(document.body, { childList: true, subtree: true });
      if (!quiet) toast('اردو منتخب ہو گئی — کچھ حصے انگریزی میں ہی رہیں گے۔');
    } else { if (i18n.obs) i18n.obs.disconnect(); untranslate(); if (!quiet) toast('Switched to English.'); }
  }
  function placeLangToggle() {
    const row = $('.announcement-contact') || $('.nav-row .container'); if (!row || $('[data-lang-toggle]', row)) return;
    row.insertAdjacentHTML('beforeend', '<button type="button" class="lang-btn" data-lang-toggle data-no-i18n lang="ur" aria-label="اردو میں دیکھیں">اردو</button>');
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-lang-toggle]')) setLang(i18n.lang === 'ur' ? 'en' : 'ur'); });

