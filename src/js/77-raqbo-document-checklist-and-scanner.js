  /* =====================================================================
     RAQBO documents
     1. A checklist on every listing: the advertiser ticks the papers they
        actually have. What is there and what is missing both reach the
        admin, so RAQBO knows exactly which service to offer that person.
     2. A camera scanner: a photo of a document is straightened up, the
        shadow is taken out and the paper is turned clean white, the way a
        document scanner app does it, before it is attached.
     ===================================================================== */
  const RQ_DOCS = [
    ['registry', 'Registry / Sale deed', 'The main ownership document'],
    ['fard', 'Fard Malkiat', 'Latest ownership record from the revenue office'],
    ['intiqal', 'Mutation (Intiqal)', 'Transfer entered in the revenue record'],
    ['allotment', 'Allotment or Transfer letter', 'For society and authority plots'],
    ['plan', 'Approved building plan', 'Sanctioned by the development authority'],
    ['noc', 'NOC from the society or authority', ''],
    ['dues', 'Dues and tax clearance receipt', ''],
    ['possession', 'Possession certificate', ''],
    ['cnic', 'CNIC of the owner', ''],
    ['succession', 'Succession certificate', 'Only where the property is inherited']
  ];
  const RQD = { pending: null, scans: {} };
  const docLabel = (k) => (RQ_DOCS.find((d) => d[0] === k) || [k, k])[1];
  const docIc = (d, s = 16) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const DOC_IC = {
    folder: docIc('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>', 20),
    cam: docIc('<path d="M3 8a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><circle cx="12" cy="13" r="3.6"></circle>'),
    lib: docIc('<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="8.5" cy="10" r="1.6"></circle><path d="M21 16l-5-5-5.5 5.5L8 14l-5 5"></path>'),
    pdf: docIc('<path d="M4 19V5a1 1 0 0 1 1-1h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"></path><path d="M8 13h8M8 16h5"></path>', 15),
    lock: docIc('<rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>', 14),
    x: docIc('<path d="M6 6l12 12M18 6L6 18"></path>', 13)
  };

  /* ---------------- the scanner ---------------- */
  // Grey → take the shadow out by dividing by a blurred copy of itself →
  // stretch what is left → crop to the paper. Same idea as a scanner app.
  function rqEnhance(canvas) {
    const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const grey = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) grey[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

    // background estimate: shrink hard, then read back bilinearly
    const bw = Math.max(1, Math.round(w / 24)), bh = Math.max(1, Math.round(h / 24));
    const bg = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const x0 = Math.floor(bx * w / bw), x1 = Math.min(w, Math.floor((bx + 1) * w / bw));
        const y0 = Math.floor(by * h / bh), y1 = Math.min(h, Math.floor((by + 1) * h / bh));
        let max = 0;
        for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const v = grey[y * w + x]; if (v > max) max = v; }
        bg[by * bw + bx] = max || 1;
      }
    }
    const bgAt = (x, y) => {
      const fx = Math.min(bw - 1, x * bw / w), fy = Math.min(bh - 1, y * bh / h);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const a = bg[y0 * bw + x0], b = bg[y0 * bw + x1], c = bg[y1 * bw + x0], e = bg[y1 * bw + x1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
    };

    let minV = 255, maxV = 0;
    const flat = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const v = Math.min(255, (grey[p] / (bgAt(x, y) || 1)) * 255);
      flat[p] = v; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const lo = minV + (maxV - minV) * 0.12, span = Math.max(1, (maxV - minV) * 0.74);
    // ink mask, used for the crop
    let top = h, left = w, right = 0, bottom = 0, ink = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = ((flat[p] - lo) / span) * 255;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      flat[p] = v;
      if (v < 110) { ink++; if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x; }
    }
    for (let p = 0, i = 0; p < w * h; p++, i += 4) { const v = flat[p]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);

    // crop to the paper when there is clearly something on it
    if (ink > w * h * 0.0015 && right > left + w * 0.2 && bottom > top + h * 0.2) {
      const padX = Math.round(w * 0.02), padY = Math.round(h * 0.02);
      const cx = Math.max(0, left - padX), cy = Math.max(0, top - padY);
      const cw = Math.min(w - cx, right - left + padX * 2), ch = Math.min(h - cy, bottom - top + padY * 2);
      const out = document.createElement('canvas');
      out.width = cw; out.height = ch;
      out.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
      return out;
    }
    return canvas;
  }

  // file (image) -> cleaned-up JPEG data URL. PDFs are passed through.
  function rqScanFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('No file chosen.')); return; }
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || '')) { resolve({ pdf: true, name: file.name, size: file.size }); return; }
      if (!/^image\//.test(file.type)) { reject(new Error('Please choose a photo or a PDF.')); return; }
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        try {
          const max = 1700, scale = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.width * scale));
          c.height = Math.max(1, Math.round(im.height * scale));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          const done = rqEnhance(c);
          URL.revokeObjectURL(url);
          resolve({ dataUrl: done.toDataURL('image/jpeg', 0.86), width: done.width, height: done.height, name: file.name });
        } catch (err) { URL.revokeObjectURL(url); reject(new Error('Could not read that picture. Try again in better light.')); }
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that picture.')); };
      im.src = url;
    });
  }
  window.rqScanFile = rqScanFile;

  /* ---------------- the checklist on the listing form ---------------- */
  function docFieldset() {
    const wrap = document.createElement('div');
    wrap.className = 'doc-block';
    wrap.innerHTML = `
      <div class="doc-head">
        <div class="doc-head-row">
          <span class="doc-head-ic">${DOC_IC.folder}</span>
          <span class="doc-head-txt"><b>Which papers do you have?</b><span>Tick what you hold today. Only RAQBO sees this — we use it to tell you exactly what is missing and help you get it.</span></span>
        </div>
        <div class="doc-progress"><div class="doc-bar"><i style="width:0%"></i></div><span class="doc-count">0 of ${RQ_DOCS.length}</span></div>
      </div>
      <div class="doc-list">${RQ_DOCS.map(([k, t, s]) => `
        <div class="doc-item" data-doc="${esc(k)}">
          <label class="doc-row">
            <input type="checkbox" name="rqdoc" value="${esc(k)}">
            <span class="doc-text"><b>${esc(t)}</b>${s ? `<i>${esc(s)}</i>` : ''}</span>
          </label>
          <div class="doc-actions">
            <span class="doc-act-label">Attach a copy</span>
            <button type="button" class="doc-act" data-rqscan="${esc(k)}" data-src="cam">${DOC_IC.cam}<span>Camera</span></button>
            <button type="button" class="doc-act" data-rqscan="${esc(k)}" data-src="lib">${DOC_IC.lib}<span>Gallery or PDF</span></button>
          </div>
        </div>`).join('')}</div>
      <p class="doc-foot">${DOC_IC.lock}<span>A photo is tidied up automatically — the shadow comes out and the paper turns clean white. Copies stay private for RAQBO's review and never appear on the listing.</span></p>
      <input type="file" class="doc-f-cam" accept="image/*" capture="environment" hidden>
      <input type="file" class="doc-f-lib" accept="image/*,application/pdf" hidden>`;
    return wrap;
  }

  function docInject() {
    const form = $('.modal form') || $('form.listing-form') || $('.modal-card form');
    if (!form || $('.doc-block', form)) return;
    const btn = $('.modal-submit', form);
    const block = docFieldset();
    if (btn && btn.parentNode) btn.parentNode.insertBefore(block, btn); else form.appendChild(block);
  }

  // open the listing form, then add the checklist to it
  try {
    const baseOpen = openListingForm;
    openListingForm = function (...a) {
      const r = baseOpen.apply(this, a);
      setTimeout(docInject, 40); setTimeout(docInject, 240);
      return r;
    };
  } catch { /* the checklist is optional */ }

  // remember the ticks the moment the form is sent
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f || !f.querySelector || !f.querySelector('.doc-block')) return;
    const have = [...f.querySelectorAll('input[name="rqdoc"]:checked')].map((i) => i.value);
    const missing = RQ_DOCS.map((d) => d[0]).filter((k) => !have.includes(k));
    RQD.pending = { have, missing, scanned: Object.keys(RQD.scans), at: new Date().toISOString() };
  }, true);

  // attach them to the listing as it is saved
  try {
    const baseSubmit = backend.submitListing.bind(backend);
    backend.submitListing = async function (data, ...rest) {
      if (RQD.pending && data && typeof data === 'object') { data.documents = RQD.pending; RQD.pending = null; RQD.scans = {}; }
      return baseSubmit(data, ...rest);
    };
  } catch { /* ignore */ }

  /* ---------------- ticking a paper opens its two ways in ---------------- */
  function docSync(block) {
    if (!block) return;
    const items = $$('.doc-item', block);
    let n = 0;
    items.forEach((it) => {
      const on = !!$('input[name="rqdoc"]', it).checked;
      it.classList.toggle('on', on);
      if (on) n++;
    });
    const bar = $('.doc-bar i', block);
    const count = $('.doc-count', block);
    if (bar) bar.style.width = Math.round((n / items.length) * 100) + '%';
    if (count) count.textContent = `${n} of ${items.length}`;
    block.classList.toggle('some', n > 0);
  }
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || t.name !== 'rqdoc') return;
    docSync(t.closest('.doc-block'));
  });

  /* ---------------- camera, gallery and PDF ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rqscan]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const block = b.closest('.doc-block');
    const input = block && $(b.dataset.src === 'cam' ? '.doc-f-cam' : '.doc-f-lib', block);
    if (!input) return;
    const item = b.closest('.doc-item');
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      item.classList.add('busy');
      try {
        const out = await rqScanFile(file);
        RQD.scans[b.dataset.rqscan] = out.pdf ? { pdf: true, name: out.name } : { dataUrl: out.dataUrl };
        const tick = $('input[name="rqdoc"]', item);
        if (tick && !tick.checked) { tick.checked = true; }
        docPreview(item, b.dataset.rqscan, out);
        docSync(block);
        toast(out.pdf ? 'PDF attached for RAQBO’s review.' : 'Photo cleaned up and attached.');
      } catch (err) { toast(err.message); }
      item.classList.remove('busy');
    };
    input.click();
  });

  function docPreview(item, key, out) {
    if (!item) return;
    let p = $('.doc-prev', item);
    if (!p) { p = document.createElement('div'); p.className = 'doc-prev'; item.appendChild(p); }
    p.innerHTML = out.pdf
      ? `<span class="doc-prev-ic">${DOC_IC.pdf}</span><span class="doc-prev-txt"><b>${esc(out.name || 'document.pdf')}</b><i>PDF attached</i></span><button type="button" class="doc-prev-x" data-rqdrop="${esc(key)}" aria-label="Remove">${DOC_IC.x}</button>`
      : `<img src="${out.dataUrl}" alt="Scanned ${esc(docLabel(key))}"><span class="doc-prev-txt"><b>${esc(docLabel(key))}</b><i>Scanned &middot; shadow removed</i></span><button type="button" class="doc-prev-x" data-rqdrop="${esc(key)}" aria-label="Remove">${DOC_IC.x}</button>`;
  }
  document.addEventListener('click', (e) => {
    const x = e.target.closest('[data-rqdrop]');
    if (!x) return;
    e.preventDefault();
    delete RQD.scans[x.dataset.rqdrop];
    const p = x.closest('.doc-prev'); if (p) p.remove();
  });
