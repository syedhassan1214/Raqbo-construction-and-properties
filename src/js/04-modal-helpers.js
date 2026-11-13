  /* =====================================================================
     Modal helpers
     ===================================================================== */
  let lastFocus = null;
  function closeModal() {
    const bd = $('.modal-backdrop'); if (!bd) return;
    $$('video', bd).forEach((v) => v.pause()); bd.dispatchEvent(new Event('modalclose')); bd.remove();
    document.body.classList.remove('modal-open'); if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function openModal(inner, { wide = false, label = 'Dialog', onClose } = {}) {
    closeModal(); lastFocus = document.activeElement;
    const bd = document.createElement('div'); bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal-card ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1"><button type="button" class="modal-close" aria-label="Close">×</button><div class="modal-body">${inner}</div></div>`;
    document.body.append(bd); document.body.classList.add('modal-open');
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) closeModal(); });
    $('.modal-close', bd).addEventListener('click', closeModal);
    if (onClose) bd.addEventListener('modalclose', onClose);
    const card = $('.modal-card', bd); setTimeout(() => card.focus({ preventScroll: true }), 20);
    return card;
  }
  const setBody = (card, html) => { $('.modal-body', card).innerHTML = html; card.scrollTop = 0; };
  const showErrors = (form, errors) => {
    let box = $('.form-error', form); if (!box) { box = document.createElement('div'); box.className = 'form-error'; box.setAttribute('role', 'alert'); box.hidden = true; const sbtn = $('[type=submit]', form); if (sbtn) sbtn.before(box); else form.append(box); }
    $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
    if (!errors.length) { box.hidden = true; return false; }
    errors.forEach(([name]) => { const el = form.elements[name]; if (el && el.setAttribute) el.setAttribute('aria-invalid', 'true'); });
    box.innerHTML = '<b>Please check the following:</b><ul>' + errors.map(([, m]) => `<li>${esc(m)}</li>`).join('') + '</ul>';
    box.hidden = false; box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return true;
  };
  const busy = (btn, text) => { const old = btn.textContent; btn.disabled = true; btn.textContent = text; return () => { btn.disabled = false; btn.textContent = old; }; };
  const successHTML = (title, body, ref, buttons = '') => `<div class="success-panel"><span class="success-mark">✓</span><h2>${esc(title)}</h2>${body}${ref ? `<p>Reference: <span class="ref-code">${esc(ref)}</span></p>` : ''}<div class="button-row">${buttons}<button type="button" class="button button-primary" data-close>Done</button></div></div>`;
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });

