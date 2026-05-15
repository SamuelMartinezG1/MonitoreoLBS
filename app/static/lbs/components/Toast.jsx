// Toast.jsx — sistema de notificaciones globales LBS_TOAST.
//
// Uso (en cualquier JSX):
//   LBS_TOAST.success('UPS guardado');
//   LBS_TOAST.error('Falló la conexión');
//   LBS_TOAST.info('Reintentando…', { sticky: true });
//   LBS_TOAST.warn('SNMP sin respuesta');
//
// Si necesitas borrar un toast persistente:
//   const id = LBS_TOAST.info('procesando…', { sticky: true });
//   LBS_TOAST.dismiss(id);
//
// Requiere que en el HTML exista <div id="lbs-toast-root"></div>; si no
// lo crea automáticamente al cargar.

(function () {
  'use strict';

  if (window.LBS_TOAST) return; // ya cargado

  let _root = null;
  let _seq = 0;

  function _ensureRoot() {
    if (_root && document.body.contains(_root)) return _root;
    let el = document.getElementById('lbs-toast-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lbs-toast-root';
      document.body.appendChild(el);
    }
    _root = el;
    return el;
  }

  function _icon(kind) {
    return {
      success: 'check-circle-fill',
      error:   'x-circle-fill',
      warn:    'exclamation-triangle-fill',
      info:    'info-circle-fill',
    }[kind] || 'info-circle-fill';
  }

  function show(message, opts) {
    opts = opts || {};
    const kind = opts.kind || 'info';
    const sticky = !!opts.sticky;
    const ttl = opts.ttl != null ? opts.ttl : (kind === 'error' ? 8000 : 4500);
    const id = ++_seq;

    const root = _ensureRoot();
    const node = document.createElement('div');
    node.className = 'lbs-toast lbs-toast-' + kind;
    node.dataset.id = id;
    node.innerHTML =
      '<i class="bi bi-' + _icon(kind) + '"></i>' +
      '<div class="lbs-toast-msg"></div>' +
      '<button class="lbs-toast-x" aria-label="cerrar"><i class="bi bi-x"></i></button>';
    node.querySelector('.lbs-toast-msg').textContent = message;
    node.querySelector('.lbs-toast-x').addEventListener('click', () => dismiss(id));
    root.appendChild(node);

    // Animación de entrada (timeout para que el browser pinte 'oculto' primero)
    requestAnimationFrame(() => node.classList.add('lbs-toast-in'));

    if (!sticky) {
      setTimeout(() => dismiss(id), ttl);
    }
    return id;
  }

  function dismiss(id) {
    const root = _ensureRoot();
    const node = root.querySelector('[data-id="' + id + '"]');
    if (!node) return;
    node.classList.remove('lbs-toast-in');
    node.classList.add('lbs-toast-out');
    setTimeout(() => { try { node.remove(); } catch (e) {} }, 200);
  }

  window.LBS_TOAST = {
    show:    (msg, opts) => show(msg, opts),
    info:    (msg, opts) => show(msg, Object.assign({ kind: 'info' },    opts || {})),
    success: (msg, opts) => show(msg, Object.assign({ kind: 'success' }, opts || {})),
    warn:    (msg, opts) => show(msg, Object.assign({ kind: 'warn' },    opts || {})),
    error:   (msg, opts) => show(msg, Object.assign({ kind: 'error' },   opts || {})),
    dismiss,
  };
})();
