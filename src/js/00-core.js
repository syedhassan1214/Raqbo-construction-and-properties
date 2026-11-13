
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const refCode = (p) => 'RQ-' + p + '-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 4).toUpperCase();
  const fmtDate = (t) => { try { return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(t); } };
  const fmtDay = (t) => { try { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const trimNum = (x) => String(Math.round(x * 100) / 100);
  const fmtPrice = (n) => { n = Number(n) || 0; if (n >= 1e7) return 'PKR ' + trimNum(n / 1e7) + ' Cr'; if (n >= 1e5) return 'PKR ' + trimNum(n / 1e5) + ' Lakh'; return 'PKR ' + n.toLocaleString('en-US'); };
  const fmtSize = (l) => `${Number(l.size).toLocaleString('en-US')} ${l.sizeUnit}`;
  const phoneDigits = (v) => { const d = String(v || '').replace(/[\s\-()]/g, ''); const m = d.match(/^(?:\+92|0092|92|0)?(3\d{9})$/); return m ? m[1] : null; };
  const normPhone = (v) => { const m = phoneDigits(v); return m ? '+92 ' + m.slice(0, 3) + ' ' + m.slice(3) : null; };
  const e164 = (v) => { const m = phoneDigits(v); return m ? '+92' + m : null; };
  const maskPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? '+92 3•• ••• ••' + d.slice(-2) : 'hidden'; };
  const hashPw = async (pw) => { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('raqbo-demo:' + pw)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); } catch { return 'plain:' + pw; } };
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const ICON = {
    pin: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>',
    bed: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"></path><path d="M3 14h18"></path><path d="M5 10V6h5v4"></path><path d="M14 10V6h5v4"></path><path d="M3 18v2"></path><path d="M21 18v2"></path></svg>',
    bath: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6 7.5 4.5a2 2 0 0 0-3 2.5L6 9"></path><path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2Z"></path><path d="M7 19v2"></path><path d="M17 19v2"></path></svg>',
    area: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M9 4v3"></path><path d="M15 4v3"></path><path d="M4 9h3"></path><path d="M4 15h3"></path><path d="M20 9h-3"></path><path d="M20 15h-3"></path><path d="M9 20v-3"></path><path d="M15 20v-3"></path></svg>',
    share: '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"></path></svg>',
    heart: '<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 8.6c0 4.7-8.8 10-8.8 10s-8.8-5.3-8.8-10a4.7 4.7 0 0 1 8.8-2.4 4.7 4.7 0 0 1 8.8 2.4Z"></path></svg>',
    arrow: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg>'
  };

  const toast = (message) => {
    let node = $('.preview-toast');
    if (!node) { node = document.createElement('div'); node.className = 'preview-toast'; node.setAttribute('role', 'status'); document.body.append(node); }
    node.textContent = message; node.classList.add('visible'); clearTimeout(node.timer); node.timer = setTimeout(() => node.classList.remove('visible'), 4000);
  };

