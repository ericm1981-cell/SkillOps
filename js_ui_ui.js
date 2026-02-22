/**
 * Toast — Notification system
 */
const Toast = (() => {
  let container;

  function _ensure() {
    if (!container) {
      container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
      }
    }
  }

  function show(msg, type = 'info', duration = 4000) {
    _ensure();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-msg">${msg}</span>`;
    toast.onclick = () => _remove(toast);
    container.appendChild(toast);

    // Limit to 3 visible
    const all = container.querySelectorAll('.toast:not(.removing)');
    if (all.length > 3) _remove(all[0]);

    setTimeout(() => _remove(toast), duration);
    return toast;
  }

  function _remove(el) {
    if (!el || el.classList.contains('removing')) return;
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }

  return { show, success: m => show(m, 'success', 3500), error: m => show(m, 'error', 6000), warn: m => show(m, 'warning', 4500) };
})();

/**
 * Modal — Single modal manager
 */
const Modal = (() => {
  let overlay = null;

  function open({ title, body, footer, maxWidth = '560px', onClose } = {}) {
    close();
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:${maxWidth}">
        <div class="modal-header">
          <span class="modal-title">${title || ''}</span>
          <button class="modal-close" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">${body || ''}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>`;

    overlay.querySelector('.modal-close').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    document.addEventListener('keydown', _escHandler);
    document.body.appendChild(overlay);
    overlay._onClose = onClose;
    return overlay.querySelector('.modal');
  }

  function close() {
    if (overlay) {
      document.removeEventListener('keydown', _escHandler);
      if (overlay._onClose) overlay._onClose();
      overlay.remove();
      overlay = null;
    }
  }

  function _escHandler(e) { if (e.key === 'Escape') close(); }

  function getBody() { return overlay?.querySelector('.modal-body'); }
  function getModal() { return overlay?.querySelector('.modal'); }

  return { open, close, getBody, getModal };
})();

/**
 * Confirm dialog
 */
function confirmDialog(message) {
  return new Promise(resolve => {
    const modal = Modal.open({
      title: t('confirm'),
      body: `<p style="color:var(--text-2);margin-bottom:var(--sp-4)">${message}</p>`,
      footer: `<button class="btn btn-secondary" id="conf-no">${t('cancel')}</button>
               <button class="btn btn-danger" id="conf-yes">${t('yes')}</button>`
    });
    modal.closest('.modal').querySelector('#conf-yes').onclick = () => { Modal.close(); resolve(true); };
    modal.closest('.modal').querySelector('#conf-no').onclick  = () => { Modal.close(); resolve(false); };
  });
}
