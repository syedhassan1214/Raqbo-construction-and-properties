  /* =====================================================================
     Shared in-memory state (filled by the active backend)
     ===================================================================== */
  const db = { listings: [], favorites: [], enquiries: [], reports: [], session: null, isAdmin: false, loaded: false };
  const byId = (id) => db.listings.find((l) => l.id === id);

  /* ---------- Browser storage helpers ---------- */
  const PREFIX = 'raqbo.demo.';
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(PREFIX + k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); return true; } catch { return false; } }
  };

  /* ---------- Browser media storage (IndexedDB) — demo mode only ---------- */
  const media = (() => {
    const mem = new Map(); const urls = new Map(); let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      try { const r = indexedDB.open('raqbo-demo-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); }
    }));
    const run = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('files', mode); const req = fn(t.objectStore('files')); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
    return {
      async put(id, blob) { try { await run('readwrite', (s) => s.put(blob, id)); } catch { mem.set(id, blob); } },
      async get(id) { if (mem.has(id)) return mem.get(id); try { return await run('readonly', (s) => s.get(id)); } catch { return null; } },
      async url(id) { if (urls.has(id)) return urls.get(id); const b = await this.get(id); if (!b) return null; const u = URL.createObjectURL(b); urls.set(id, u); return u; },
      async remove(ids) { for (const id of ids) { mem.delete(id); try { await run('readwrite', (s) => s.delete(id)); } catch { /* ignore */ } } },
      async clear() { mem.clear(); urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); try { await run('readwrite', (s) => s.clear()); } catch { /* ignore */ } }
    };
  })();
  /* Photo compression before upload: large phone photos (3–10 MB) become ~200–400 KB.
     Keeps the original if the browser can't decode it or if the result isn't smaller. */
  let webpOK = null;
  const canWebp = () => { if (webpOK === null) { try { webpOK = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { webpOK = false; } } return webpOK; };
  async function shrinkImage(file, maxDim = 1600, quality = 0.82, forceType = '') {
    if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '')) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 400 * 1024) { bmp.close && bmp.close(); return file; }
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
      const type = forceType || (canWebp() ? 'image/webp' : 'image/jpeg');
      const blob = await new Promise((res) => c.toBlob(res, type, quality));
      if (!blob || blob.size >= file.size) return file;
      const name = (file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + (type === 'image/webp' ? '.webp' : '.jpg');
      return new File([blob], name, { type, lastModified: Date.now() });
    } catch { return file; }
  }
  const THUMB = '.thumb.jpg';   // JPEG so WhatsApp / Facebook link previews can show it
  const mediaAttr = (ref, bg) => {
    if (!ref) return '';
    if (ref.src) return bg ? `data-lazy-bg="${esc(ref.thumb || ref.src)}"` : `src="${esc(ref.src)}"`;
    return `data-media-id="${esc(ref.id)}"${bg ? ' data-bg' : ''}`;
  };
  const hydrate = (root) => $$('[data-media-id]', root).forEach(async (el) => {
    const u = await media.url(el.dataset.mediaId);
    if (!u) { el.setAttribute('data-missing', ''); return; }
    if (el.hasAttribute('data-bg')) el.style.backgroundImage = `url("${u}")`; else el.src = u;
  });

  /* ---------- Sample listings for demo mode ---------- */
  const U = (id) => ({ kind: 'photo', name: 'Sample photo', src: `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1400&q=80` });
  const DAY = 864e5; const BASE = Date.UTC(2026, 9, 28);
  const SAMPLES = [
    { title: 'Contemporary family home', area: 'DHA Phase 6', city: 'Lahore', purpose: 'sale', type: 'House', role: 'Owner', advertiser: 'Hamza R.', size: 1, sizeUnit: 'Kanal', price: 78500000, beds: 5, baths: 6, photos: ['1600596542815-ffad4c1539a9', '1600210492486-724fe5c67fb0', '1600607687939-ce8a6c25118c'], description: 'A light-filled 1 Kanal home on a quiet, wide street. Double-height entrance, open kitchen with family lounge, five en-suite bedrooms and a basement with a home theatre.\nServant quarter, solar back-up and covered parking for three cars. Close to schools, parks and Phase 6 commercial.' },
    { title: 'Sunlit apartment with a view', area: 'Gulberg III', city: 'Lahore', purpose: 'sale', type: 'Apartment', role: 'Owner', advertiser: 'Sana M.', size: 1650, sizeUnit: 'sq ft', price: 32500000, beds: 3, baths: 3, photos: ['1600607687939-ce8a6c25118c', '1502672260266-1c1ef2d93688'], description: 'Twelfth-floor corner apartment with floor-to-ceiling windows facing the city. Three bedrooms, fitted kitchen, back-up generator, lift and 24/7 security. One reserved parking space.' },
    { title: 'A calm corner to call home', area: 'Bahria Enclave', city: 'Islamabad', purpose: 'sale', type: 'House', role: 'Agent', advertiser: 'Capital Realty (agent)', size: 10, sizeUnit: 'Marla', price: 42500000, beds: 4, baths: 4, photos: ['1600047509807-ba8f99d2cdde', '1600585154340-be6161a56a0c'], description: 'Corner 10 Marla house with Margalla views, a front lawn and a rooftop terrace. Four bedrooms, drawing and dining, and a separate TV lounge. Gas, water and electricity connected.' },
    { title: 'Furnished two-bed apartment', area: 'Johar Town', city: 'Lahore', purpose: 'rent', type: 'Apartment', role: 'Owner', advertiser: 'Usman K.', size: 1100, sizeUnit: 'sq ft', price: 85000, beds: 2, baths: 2, photos: ['1502672260266-1c1ef2d93688', '1522708323590-d24dbb6b0267'], description: 'Fully furnished apartment close to Emporium Mall and the Expo Centre. Air-conditioned, fibre internet ready, lift and parking. Suitable for a small family or working professionals.' },
    { title: 'Upper portion near the park', area: 'Model Town', city: 'Lahore', purpose: 'rent', type: 'House', role: 'Authorized representative', advertiser: 'Ali H. (on behalf of owner)', size: 1, sizeUnit: 'Kanal', price: 160000, beds: 3, baths: 3, photos: ['1600585154340-be6161a56a0c', '1600210492486-724fe5c67fb0'], description: 'Separate-entrance upper portion of a 1 Kanal house in a leafy block of Model Town. Three bedrooms with attached baths, lounge, kitchen and a private terrace.' },
    { title: 'Residential plot in a developed block', area: 'DHA Phase 9 Prism', city: 'Lahore', purpose: 'sale', type: 'Plot', role: 'Owner', advertiser: 'Faisal T.', size: 1, sizeUnit: 'Kanal', price: 39000000, beds: 0, baths: 0, photos: ['1500382017468-9049fed747ef'], description: 'Possession-ready 1 Kanal plot near the main boulevard. Utilities available in the block; boundary walls on both neighbouring plots. Ideal for building a family home.' },
    { title: 'Agricultural land on Raiwind Road', area: 'Raiwind Road', city: 'Lahore', purpose: 'sale', type: 'Plot', role: 'Agent', advertiser: 'Green Acre Estates (agent)', size: 8, sizeUnit: 'Kanal', price: 96000000, beds: 0, baths: 0, photos: ['1500382017468-9049fed747ef'], description: 'Eight Kanal of level agricultural land with road frontage, tube-well and electricity connection nearby. Suitable for a farmhouse or orchard.' },
    { title: 'Open-plan office floor', area: 'Blue Area', city: 'Islamabad', purpose: 'rent', type: 'Commercial', role: 'Agent', advertiser: 'Capital Realty (agent)', size: 3200, sizeUnit: 'sq ft', price: 650000, beds: 0, baths: 2, photos: ['1497366216548-37526070297c', '1486406146926-c627a92ad1ab'], description: 'Full office floor in a well-managed building on Jinnah Avenue. Central air-conditioning, generator back-up, two washrooms, a pantry and basement parking.' },
    { title: 'Retail shop on a main boulevard', area: 'MM Alam Road, Gulberg', city: 'Lahore', purpose: 'sale', type: 'Commercial', role: 'Owner', advertiser: 'Nadia S.', size: 450, sizeUnit: 'sq ft', price: 125000000, beds: 0, baths: 1, photos: ['1441986300917-64674bd600d8'], description: 'Ground-floor retail unit with a glass frontage on one of Lahore’s busiest shopping streets. Currently vacant; suitable for a boutique, café or showroom.' }
  ].map((s, i) => ({
    ...s, id: 'sample-' + (i + 1), sample: true, status: 'published', photos: s.photos.map(U), videos: [],
    ownerName: s.advertiser, ownerPhone: '+92 300 00000' + String(10 + i), ownerId: null, createdAt: BASE - i * DAY, publishedAt: BASE - i * DAY, reviewNote: ''
  }));

