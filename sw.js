// RAQBO service worker — makes the site installable and quick to open.
// Pages: network first (always fresh), falls back to the saved copy when offline.
// Logos/icons/fonts: served from the phone's cache. Supabase data is never cached here.
const V = 'raqbo-v1';
const CORE = ['/', '/content.js', '/manifest.webmanifest', '/assets/logo-emblem.webp', '/assets/logo-full.webp', '/assets/favicon.png', '/assets/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) {   // fonts and libraries from CDNs: cache first
    if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(u.host)) e.respondWith(caches.open(V).then(async (c) => (await c.match(r)) || fetch(r).then((res) => { if (res.ok || res.type === 'opaque') c.put(r, res.clone()); return res; })));
    return;
  }
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/_vercel/')) return;
  if (r.mode === 'navigate' || u.pathname === '/' || u.pathname.endsWith('.html') || u.pathname === '/content.js') {
    e.respondWith(fetch(r).then((res) => { if (res.ok) caches.open(V).then((c) => c.put(r.mode === 'navigate' ? '/' : r, res.clone())); return res; }).catch(() => caches.match(r.mode === 'navigate' ? '/' : r).then((m) => m || caches.match('/'))));
    return;
  }
  if (/^\/(assets|icons|images)\//.test(u.pathname)) e.respondWith(caches.open(V).then(async (c) => (await c.match(r)) || fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; })));
});
