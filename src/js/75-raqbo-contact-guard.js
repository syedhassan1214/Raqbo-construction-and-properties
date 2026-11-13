  /* =====================================================================
     RAQBO contact guard
     Best-effort browser warnings for contact details in selected forms.
     This can be bypassed and the logs remain in the current browser.
     ===================================================================== */
  const RQG_KEY = 'raqbo.guard.log';
  const RQG_MAX = 300;

  // Separators are stripped first, so "0 3 0 0 - 1 2 2 3 3 4 4" is read the
  // same as the number itself.
  const rqgFlat = (s) => String(s || '').replace(/[\s._\-()[\]|*·•,]+/g, '');
  const RQG_WORDS = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', double: '', triple: '' };
  const rqgWords = (s) => String(s || '').toLowerCase().replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple)\b/g, (m) => RQG_WORDS[m]);

  const RQG_RULES = [
    ['a CNIC number', (t, f) => /\b\d{5}[\s.-]?\d{7}[\s.-]?\d\b/.test(t) || /\d{13}/.test(f)],
    ['a phone number', (t, f) => /(?:\+?92|\b0)[\s.-]?3\d{2}[\s.-]?\d{7}\b/.test(t) || /(?:\+?92|0)?3\d{9}/.test(f) || /\b\d{10,}\b/.test(f)],
    ['an email address', (t) => /[A-Za-z0-9._%+-]{2,}\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[A-Za-z0-9.-]{2,}\s*(?:\.|\sdot\s)\s*[A-Za-z]{2,}/.test(t)],
    ['a link', (t) => /\b(?:https?:\/\/|www\.)\S{2,}/i.test(t) || /\b[a-z0-9-]+\.(?:com|net|org|pk|co|io|me)\b/i.test(t)],
    ['a messaging app', (t) => /\b(?:whats\s*app|wa\.me|telegram|t\.me|viber|signal\s*app|snapchat|insta(?:gram)?|facebook|fb\.com|messenger|skype|botim)\b/i.test(t)],
    ['a social handle', (t) => /(?:^|\s)@[A-Za-z0-9._]{3,}/.test(t)]
  ];

  // Returns the list of things found. Empty list means the text is fine.
  function rqgFind(text) {
    const t = String(text || '');
    if (!t.trim()) return [];
    const f = rqgFlat(rqgWords(t));
    const hits = [];
    for (const [label, test] of RQG_RULES) { try { if (test(t, f) && !hits.includes(label)) hits.push(label); } catch { /* ignore */ } }
    return hits;
  }

  function rqgLog(where, text, hits) {
    try {
      const list = JSON.parse(localStorage.getItem(RQG_KEY) || '[]');
      list.unshift({
        at: new Date().toISOString(),
        where,
        hits,
        who: (db.session && (db.session.name || db.session.email)) || 'Signed-out visitor',
        email: (db.session && db.session.email) || '',
        sample: String(text || '').slice(0, 160)
      });
      localStorage.setItem(RQG_KEY, JSON.stringify(list.slice(0, RQG_MAX)));
    } catch { /* storage full or blocked — the block itself still happened */ }
  }
  // used by the admin panel, and by the build's own tests
  window.rqGuardFind = rqgFind;
  window.rqGuardLog = () => { try { return JSON.parse(localStorage.getItem(RQG_KEY) || '[]'); } catch { return []; } };
  window.rqGuardClear = () => { try { localStorage.removeItem(RQG_KEY); } catch { /* ignore */ } };

  const rqgList = (hits) => hits.length === 1 ? hits[0] : hits.slice(0, -1).join(', ') + ' and ' + hits[hits.length - 1];

  // Throws a readable error when the text carries contact details.
  function rqgCheck(where, text) {
    if (db.isAdmin) return;                       // RAQBO's own team is not restricted
    const hits = rqgFind(text);
    if (!hits.length) return;
    rqgLog(where, text, hits);
    throw new Error(`That looks like ${rqgList(hits)}. For your own safety, RAQBO keeps every conversation and every deal on the platform — please take it out and send again.`);
  }
  // Checks only the free-text fields of an object, never the contact fields a
  // member fills in for RAQBO itself.
  const RQG_TEXT_KEYS = ['message', 'body', 'details', 'note', 'notes', 'description', 'title', 'comment', 'text', 'reason'];
  function rqgCheckObject(where, obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of RQG_TEXT_KEYS) if (obj[k]) rqgCheck(where, obj[k]);
  }

  /* ---------- wrap the places where text is saved ---------- */
  function rqgWrap(owner, method, where, pick) {
    if (!owner || typeof owner[method] !== 'function' || owner[method].rqg) return;
    const base = owner[method].bind(owner);
    const fn = async function (...args) { pick(args, where); return base(...args); };
    fn.rqg = true;
    owner[method] = fn;
  }

  try { rqgWrap(LV, 'send', 'Chat message', (a, w) => rqgCheck(w, a[1])); } catch { /* ignore */ }
  try { rqgWrap(GW, 'postWanted', 'Wanted post', (a, w) => rqgCheckObject(w, a[0])); } catch { /* ignore */ }
  try {
    rqgWrap(backend, 'createEnquiry', 'Enquiry', (a, w) => rqgCheckObject(w, a[0]));
    rqgWrap(backend, 'submitListing', 'New listing', (a, w) => rqgCheckObject(w, a[0]));
    rqgWrap(backend, 'updateListing', 'Listing edit', (a, w) => rqgCheckObject(w, a[1] || a[0]));
    rqgWrap(backend, 'saveReview', 'Review', (a, w) => rqgCheck(w, a[2]));
  } catch { /* ignore */ }

  /* ---------- tell people before they hit send ---------- */
  // A quiet line under the chat box, and a live warning as they type.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || t.name !== 'body' || !t.closest || !t.closest('.lv-compose')) return;
    const form = t.closest('.lv-compose');
    let warn = $('.rqg-warn', form);
    const hits = rqgFind(t.value);
    if (!hits.length) { if (warn) warn.remove(); return; }
    if (!warn) {
      warn = document.createElement('p');
      warn.className = 'rqg-warn';
      form.appendChild(warn);
    }
    warn.textContent = `Please take out ${rqgList(hits)} — RAQBO keeps every deal on the platform.`;
  });
