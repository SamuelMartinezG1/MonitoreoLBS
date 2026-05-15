// Onboarding.jsx — Overlay de bienvenida que se muestra cuando:
//   - el usuario es admin
//   - la flota está vacía (0 sitios y 0 dispositivos)
//   - NO se ha cerrado anteriormente (localStorage lbs.onboarding.dismissed)
//
// Es informativo, no bloquea — solo guía al admin a hacer el primer flujo.

(function () {
  'use strict';
  if (window.LBSOnboarding) return;

  const { useState, useEffect } = React;

  function Onboarding({ onClose }) {
    useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const URLS = window.LBS_URLS || {};
    const dismiss = () => {
      try { localStorage.setItem('lbs.onboarding.dismissed', '1'); } catch(_){}
      onClose();
    };

    return (
      <div className="lbs-onboard-back" onClick={dismiss}>
        <div className="lbs-onboard" onClick={e => e.stopPropagation()}>
          <button className="lbs-onboard-x" onClick={dismiss}><i className="bi bi-x-lg"></i></button>

          <div className="lbs-onboard-hero">
            <div className="badge">⚡ Bienvenido</div>
            <h1>Comenzando con LBS Monitor</h1>
            <p>Tu instancia está corriendo limpia. Estos son los 3 pasos para
            tener tu primer UPS poll-eándose en menos de 5 minutos.</p>
          </div>

          <div className="lbs-onboard-steps">
            <div className="lbs-onboard-step">
              <div className="num">1</div>
              <div>
                <h3>Activa ZeroTier (opcional)</h3>
                <p>Si tus UPS están detrás de routers Teltonika remotos, ejecuta
                <code>sudo ./scripts/setup_zerotier.sh</code> en el host para
                que el portal pueda gestionar las redes overlay.</p>
                <a className="step-link" href={(URLS.diagnostico || '/diagnostico')}>
                  Ir a Diagnóstico → ZeroTier <i className="bi bi-arrow-right"></i>
                </a>
              </div>
            </div>

            <div className="lbs-onboard-step">
              <div className="num">2</div>
              <div>
                <h3>Crea tu primer sitio</h3>
                <p>Define dónde están físicamente los UPS: la subred LAN del
                cliente, IPs de routers, notas operativas. Si usas ZeroTier,
                el <b>wizard</b> hace este paso automáticamente.</p>
                <a className="step-link" href={(URLS.inventario || '/inventario')}>
                  Ir a Inventario <i className="bi bi-arrow-right"></i>
                </a>
              </div>
            </div>

            <div className="lbs-onboard-step">
              <div className="num">3</div>
              <div>
                <h3>Agrega un UPS</h3>
                <p>Captura una IP y usa <b>"Auto-detectar"</b> para que el
                portal infiera protocolo (SNMP/Modbus), tipo y community.
                A partir del siguiente ciclo (~2 s) verás telemetría en
                el SCADA.</p>
                <a className="step-link" href={(URLS.inventario || '/inventario')}>
                  Nuevo UPS <i className="bi bi-arrow-right"></i>
                </a>
              </div>
            </div>
          </div>

          <div className="lbs-onboard-footer">
            <div className="dim">
              💡 <b>Pro tip:</b> usa <kbd>Ctrl</kbd>+<kbd>K</kbd> para abrir
              búsqueda global en cualquier momento.
            </div>
            <button className="btn" onClick={dismiss}>
              Empezar <i className="bi bi-arrow-right"></i>
            </button>
          </div>
        </div>
      </div>
    );
  }

  let _shown = false;
  let _root = null;
  let _container = null;

  function maybeShow() {
    if (_shown) return;
    try {
      if (localStorage.getItem('lbs.onboarding.dismissed') === '1') return;
    } catch (_) {}
    const user = (window.LBS_URLS || {}).user || {};
    if (user.rol !== 'admin') return;
    const MOCK = window.MOCK || { SITES: [], DEVICES: [] };
    if (!MOCK._loaded) return;
    if ((MOCK.SITES || []).length > 0 || (MOCK.DEVICES || []).length > 0) return;

    _shown = true;
    _container = document.createElement('div');
    document.body.appendChild(_container);
    _root = ReactDOM.createRoot(_container);
    const close = () => {
      try { _root.unmount(); _container.remove(); } catch (_) {}
      _shown = false; _root = null; _container = null;
    };
    _root.render(<Onboarding onClose={close} />);
  }

  // Intentar mostrar tras cada refresh del DataLayer
  window.addEventListener('lbs:data-refresh', maybeShow);
  // y al cargar
  setTimeout(maybeShow, 1500);

  window.LBSOnboarding = { maybeShow };
})();
