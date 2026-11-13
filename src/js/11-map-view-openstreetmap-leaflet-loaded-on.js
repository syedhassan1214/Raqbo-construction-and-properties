  /* =====================================================================
     Map view (OpenStreetMap + Leaflet, loaded only when a map is opened)
     ===================================================================== */
  const CITY_LL = { lahore: [31.5204, 74.3587], karachi: [24.8607, 67.0011], islamabad: [33.6844, 73.0479], rawalpindi: [33.5651, 73.0169], faisalabad: [31.4504, 73.135], multan: [30.1575, 71.5249],
    peshawar: [34.0151, 71.5249], quetta: [30.1798, 66.975], gujranwala: [32.1877, 74.1945], sialkot: [32.4945, 74.5229], hyderabad: [25.396, 68.3578], bahawalpur: [29.3956, 71.6836], sargodha: [32.0836, 72.6711],
    abbottabad: [34.1688, 73.2215], murree: [33.9062, 73.3903], gwadar: [25.1216, 62.3254], sheikhupura: [31.7167, 73.985], kasur: [31.1187, 74.4636], sahiwal: [30.6682, 73.1114], 'dera ghazi khan': [30.0561, 70.6348] };
  const cityLL = (c) => CITY_LL[String(c || '').trim().toLowerCase()] || null;
  let leafletP = null;
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.append(css);
      const js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; js.onload = () => res(window.L); js.onerror = () => { leafletP = null; rej(new Error('The map could not load. Check your internet connection.')); }; document.head.append(js);
    });
    return leafletP;
  }
  const tiles = (L, m) => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(m);
  const shortPrice = (n) => { n = Number(n) || 0; if (n >= 1e7) return (Math.round(n / 1e5) / 100) + ' Cr'; if (n >= 1e5) return (Math.round(n / 1e3) / 100) + ' L'; return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n); };

  // ----- Results: Grid ⇄ Map
  const mv = { on: false, map: null, layer: null, el: null };
  function mapToggleHTML() { return `<div class="view-switch" role="group" aria-label="View"><button type="button" data-view-mode="grid" class="${mv.on ? '' : 'active'}">${DI(DIC.grid, 15)} List</button><button type="button" data-view-mode="map" class="${mv.on ? 'active' : ''}">${DI(DIC.pin, 15)} Map</button></div>`; }
  function placeToggle() { const c = $('.results-controls'); if (!c || $('.view-switch', c)) return; c.insertAdjacentHTML('afterbegin', mapToggleHTML()); }
  async function showMap(on) {
    mv.on = on; $$('.view-switch [data-view-mode]').forEach((b) => b.classList.toggle('active', (b.dataset.viewMode === 'map') === on));
    if (!mv.el) { mv.el = document.createElement('div'); mv.el.className = 'results-map'; mv.el.innerHTML = '<div class="results-map-canvas"></div><p class="results-map-note"></p>'; grid.after(mv.el); }
    grid.hidden = on; mv.el.hidden = !on; const more = $('[data-more]'); if (more) more.hidden = on;
    if (!on) return;
    try { const L = await loadLeaflet(); if (!mv.map) { mv.map = L.map($('.results-map-canvas', mv.el), { scrollWheelZoom: false, zoomControl: true }).setView([30.4, 70.5], 5); tiles(L, mv.map); mv.layer = L.layerGroup().addTo(mv.map); } setTimeout(() => { mv.map.invalidateSize(); drawMap(); }, 30); }
    catch (err) { $('.results-map-canvas', mv.el).innerHTML = `<div class="empty-results"><span>!</span><h3>Map unavailable</h3><p>${esc(err.message)}</p></div>`; }
  }
  function drawMap() {
    if (!mv.on || !mv.map || !window.L) return; const L = window.L; mv.layer.clearLayers();
    const list = filtered(); const pins = []; const byCity = {};
    list.forEach((l) => { if (l.lat != null && l.lng != null) pins.push(l); else { const ll = cityLL(l.city); if (ll) (byCity[l.city] = byCity[l.city] || { ll, items: [] }).items.push(l); } });
    const bounds = [];
    pins.forEach((l) => {
      const icon = L.divIcon({ className: 'pin-price', html: `<span>${esc(shortPrice(l.price))}${l.purpose === 'rent' ? '/mo' : ''}</span>`, iconSize: null });
      const m = L.marker([+l.lat, +l.lng], { icon, title: l.title }).addTo(mv.layer); bounds.push([+l.lat, +l.lng]);
      m.bindPopup(() => { const d = document.createElement('div'); d.className = 'map-pop'; d.innerHTML = `<span class="map-pop-img" ${mediaAttr(l.photos[0], true)}></span><b>${esc(l.title)}</b><small>${esc(l.area)}, ${esc(l.city)}</small><strong>${esc(fmtPrice(l.price))}${l.purpose === 'rent' ? ' / month' : ''}</strong><button type="button" class="button button-primary" data-map-open="${esc(l.id)}">View property</button>`; hydrate(d); return d; }, { minWidth: 220, maxWidth: 260 });
    });
    Object.entries(byCity).forEach(([city, g]) => {
      const n = g.items.length; const icon = L.divIcon({ className: 'pin-city', html: `<span><b>${n}</b> in ${esc(city)}</span>`, iconSize: null });
      L.marker(g.ll, { icon, title: `${n} properties in ${city}` }).addTo(mv.layer).bindPopup(() => { const d = document.createElement('div'); d.className = 'map-pop'; d.innerHTML = `<b>${n} ${n === 1 ? 'property' : 'properties'} in ${esc(city)}</b><small>Exact location not pinned by the advertiser.</small><button type="button" class="button button-primary" data-map-city="${esc(city)}">Show them in the list</button>`; return d; });
      bounds.push(g.ll);
    });
    $('.results-map-note', mv.el).textContent = list.length ? `${pins.length} pinned on the map${Object.keys(byCity).length ? ` · ${list.length - pins.length} shown by city (no exact pin yet)` : ''}` : 'No properties match these filters.';
    if (bounds.length) mv.map.fitBounds(bounds, { padding: [40, 40], maxZoom: bounds.length === 1 ? 14 : 13 });
  }
  document.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view-mode]'); if (v) { showMap(v.dataset.viewMode === 'map'); try { localStorage.setItem('raqbo-view', v.dataset.viewMode); } catch { /* ignore */ } return; }
    const o = e.target.closest('[data-map-open]'); if (o) { openDetails(o.dataset.mapOpen); return; }
    const c = e.target.closest('[data-map-city]'); if (c) { loc.value = c.dataset.mapCity; showMap(false); renderGrid(); scrollToResults(); }
  });

  // ----- Listing form: optional exact pin
  function pinPickerHTML(l) {
    const has = l && l.lat != null && l.lng != null;
    return `<div class="pin-pick" data-pin-pick><div class="pin-pick-head"><span>${DI(DIC.pin, 16)} <b>Exact location on the map</b> <small>(optional — helps buyers find it)</small></span><button type="button" class="button button-outline" data-pin-open>${has ? 'Change pin' : 'Drop a pin'}</button></div>
      <input type="hidden" name="lat" value="${has ? esc(l.lat) : ''}"><input type="hidden" name="lng" value="${has ? esc(l.lng) : ''}">
      <p class="form-hint" data-pin-status>${has ? `Pinned at ${(+l.lat).toFixed(5)}, ${(+l.lng).toFixed(5)}` : 'Not pinned — the property will be shown by city on the map.'}</p>
      <div class="pin-pick-map" hidden></div></div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pin-open]'); if (!b) { const clr = e.target.closest('[data-pin-clear]'); if (clr) { const w = clr.closest('[data-pin-pick]'); w.querySelector('[name=lat]').value = ''; w.querySelector('[name=lng]').value = ''; $('[data-pin-status]', w).textContent = 'Not pinned — the property will be shown by city on the map.'; if (w._marker) { w._marker.remove(); w._marker = null; } } return; }
    const w = b.closest('[data-pin-pick]'); const box = $('.pin-pick-map', w); box.hidden = false; b.hidden = true;
    try {
      const L = await loadLeaflet(); if (w._map) return;
      const f = w.closest('form'); const lat = parseFloat(f.lat.value); const lng = parseFloat(f.lng.value);
      const start = !isNaN(lat) ? [lat, lng] : cityLL(f.city && f.city.value) || [30.4, 70.5];
      const m = L.map(box, { scrollWheelZoom: true }).setView(start, !isNaN(lat) ? 16 : cityLL(f.city && f.city.value) ? 12 : 5); tiles(L, m); w._map = m;
      const set = (ll) => { if (ll.lat < 23.5 || ll.lat > 37.2 || ll.lng < 60.8 || ll.lng > 77.9) { toast('Please choose a location inside Pakistan.'); return; } f.lat.value = ll.lat.toFixed(6); f.lng.value = ll.lng.toFixed(6); if (w._marker) w._marker.setLatLng(ll); else w._marker = L.marker(ll, { draggable: true }).addTo(m).on('dragend', (ev) => set(ev.target.getLatLng())); $('[data-pin-status]', w).innerHTML = `Pinned at ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)} · <button type="button" class="link-button" data-pin-clear>Remove pin</button>`; };
      if (!isNaN(lat)) set({ lat, lng });
      m.on('click', (ev) => set(ev.latlng)); $('[data-pin-status]', w).insertAdjacentHTML('beforeend', ' Tap the map where the property is; drag the pin to adjust.');
      setTimeout(() => m.invalidateSize(), 60);
    } catch (err) { box.innerHTML = `<p class="form-hint">${esc(err.message)}</p>`; }
  });

