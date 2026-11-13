  /* =====================================================================
     Member location on sign-up (city + area), with "Use my location"
     Supabase: update_16_location.sql (falls back to the city-only setting)
     ===================================================================== */
  const LOC_CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Gujranwala', 'Sialkot', 'Quetta', 'Hyderabad', 'Bahawalpur', 'Sargodha', 'Abbottabad', 'Sahiwal', 'Sheikhupura', 'Gujrat', 'Rahim Yar Khan', 'Mardan', 'Okara'];
  function locFields(s) {
    const c = (s && s.city) || ''; const known = !c || LOC_CITIES.includes(c);
    return `<fieldset class="loc-f"><legend>${DI(DIC.pin, 14)} Your location <button type="button" class="loc-gps" data-loc-gps>${DI('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>', 14)} Use my location</button></legend>
      <div class="modal-form-row"><label>City<select name="city" autocomplete="address-level2"><option value="">Choose city</option>${LOC_CITIES.map((x) => `<option ${x === c ? 'selected' : ''}>${x}</option>`).join('')}<option value="Other" ${!known ? 'selected' : ''}>Other city…</option></select></label>
      <label>Area / society (optional)<input name="area" maxlength="80" autocomplete="address-level3" placeholder="e.g. DHA Phase 6" value="${esc((s && s.area) || '')}"></label></div>
      <label class="loc-other" ${known ? 'hidden' : ''}>Your city<input name="cityOther" maxlength="60" value="${known ? '' : esc(c)}"></label>
      <small class="loc-why">Helps us show properties, offers and services near you. Not shown publicly.</small></fieldset>`;
  }
  async function saveLocation(city, area) {
    city = String(city || '').trim().slice(0, 60); area = String(area || '').trim().slice(0, 80); if (!city || !db.session) return;
    Object.assign(db.session, { city, area });
    if (!SB) { const acc = store.get('accounts', {}); const a = acc[db.session.email]; if (a) Object.assign(a, { city, area }); store.set('accounts', acc); store.set('session', db.session); return; }
    try { const { error } = await SB.rpc('set_my_location', { p_city: city, p_area: area }); if (!error) return; } catch { /* fall back */ }
    try { await SB.rpc('set_member_details', { p_type: (gw.me && gw.me.member_type) || '', p_city: city }); } catch { /* location is optional */ }
  }
  document.addEventListener('change', (e) => { const s = e.target.closest('.loc-f [name=city]'); if (s) { const o = $('.loc-other', s.closest('.loc-f')); o.hidden = s.value !== 'Other'; if (!o.hidden) $('input', o).focus(); } });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-loc-gps]'); if (!b) return; e.preventDefault();
    const f = b.closest('.loc-f'); if (!navigator.geolocation) { toast('Location is not available on this device.'); return; }
    const old = b.innerHTML; b.disabled = true; b.textContent = 'Finding…'; const done = () => { b.disabled = false; b.innerHTML = old; };
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=en&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`, { headers: { Accept: 'application/json' } });
        const j = await r.json(); const a = j.address || {};
        const city = a.city || a.town || a.county || a.state_district || ''; const area = a.suburb || a.neighbourhood || a.quarter || a.residential || a.village || '';
        const sel = $('[name=city]', f); const hit = LOC_CITIES.find((x) => city.toLowerCase().includes(x.toLowerCase()));
        if (hit) sel.value = hit; else if (city) { sel.value = 'Other'; $('.loc-other', f).hidden = false; $('[name=cityOther]', f).value = city.replace(/ (City )?District$/i, ''); }
        if (area) $('[name=area]', f).value = area;
        done(); toast(city ? `Location found: ${[area, hit || city].filter(Boolean).join(', ')}` : 'Could not read your city — please choose it.');
      } catch { done(); toast('Could not look up your location — please choose your city.'); }
    }, () => { done(); toast('Location permission was not given — please choose your city.'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });

