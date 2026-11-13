  // =====================================================================

  /* ---------- 1. Pictures load when they come into view ---------- */
  (() => {
    const show = (el) => {
      const u = el.getAttribute('data-lazy-bg'); if (!u) return;
      el.removeAttribute('data-lazy-bg');
      const img = new Image();
      img.onload = () => { el.style.backgroundImage = `url("${u}")`; el.setAttribute('data-loaded', ''); };
      img.onerror = () => { el.setAttribute('data-missing', ''); };
      img.src = u;
    };
    let obs = null;
    try {
      obs = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { obs.unobserve(e.target); show(e.target); } });
      }, { rootMargin: '500px 0px', threshold: 0 });
    } catch { obs = null; }
    const scan = (root) => {
      const list = (root || document).querySelectorAll('[data-lazy-bg]');
      if (!list.length) return;
      list.forEach((el) => { if (obs) obs.observe(el); else show(el); });
    };
    // Anything added to the page later is picked up automatically.
    try {
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.hasAttribute && n.hasAttribute('data-lazy-bg')) { if (obs) obs.observe(n); else show(n); }
            if (n.querySelectorAll) scan(n);
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch { /* older browser: the scan below still runs */ }
    const kick = () => scan(document);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick); else kick();
    setTimeout(kick, 1200);
  })();

  /* ---------- 2. Tell the browser early which servers we use ---------- */
  (() => {
    try {
      const hosts = ['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
      const su = (typeof CFG === 'object' && CFG && CFG.supabaseUrl) || '';
      if (/^https:\/\//.test(su)) hosts.push(new URL(su).origin);
      const head = document.head; if (!head) return;
      hosts.forEach((h) => {
        if (head.querySelector(`link[rel="preconnect"][href="${h}"]`)) return;
        const l = document.createElement('link'); l.rel = 'preconnect'; l.href = h; l.crossOrigin = '';
        head.appendChild(l);
      });
    } catch { /* not important enough to matter */ }
  })();

  /* ---------- A safety net for the day RAQBO gets busy ---------- */
  // The website loads up to 500 listings in one go and then searches them
  // inside the browser, which is what makes the search instant. If the
  // agency ever passes that number, the oldest listings would quietly stop
  // appearing, so an admin is told once per visit before that can happen.
  setTimeout(() => {
    try {
      if (!db.isAdmin || db.mode !== 'supabase') return;
      const n = (db.listings || []).length;
      if (n >= 480) toast('The website loads ' + n + ' listings at once and the limit is 500. Before you pass it, the search needs to move to the server — tell your developer.');
    } catch { /* never get in the way of the page */ }
  }, 9000);

