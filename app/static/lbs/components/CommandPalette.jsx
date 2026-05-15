// CommandPalette.jsx — Overlay tipo "Spotlight" con Cmd+K / Ctrl+K.
// Permite saltar a cualquier UPS, sitio o página rápidamente.
//
// Trigger: tecla Cmd+K (macOS) o Ctrl+K (Linux/Windows). También
// `window.LBS_PALETTE.open()` desde cualquier sitio.

(function () {
  'use strict';
  if (window.LBS_PALETTE) return;

  const { useState, useEffect, useMemo, useRef } = React;

  function fuzzyScore(query, text) {
    if (!query) return 1;
    const q = query.toLowerCase();
    const t = String(text || '').toLowerCase();
    if (t.includes(q)) return 2;
    // simple subsecuencia
    let i = 0;
    for (const ch of t) {
      if (ch === q[i]) i++;
      if (i >= q.length) return 1;
    }
    return 0;
  }

  function Palette({ onClose }) {
    const [q, setQ] = useState('');
    const [idx, setIdx] = useState(0);
    const ref = useRef(null);
    const URLS = window.LBS_URLS || {};

    // Datos de la flota
    const MOCK = window.MOCK || { SITES: [], DEVICES: [] };

    const items = useMemo(() => {
      const out = [];
      // Páginas
      const pages = [
        { kind: 'page', label: 'Tablero',     icon: 'bi-speedometer2', href: URLS.dashboard   || '/dashboard' },
        { kind: 'page', label: 'Monitoreo',   icon: 'bi-activity',     href: URLS.monitoreo   || '/monitoreo' },
        { kind: 'page', label: 'Inventario',  icon: 'bi-diagram-3',    href: URLS.inventario  || '/inventario' },
        { kind: 'page', label: 'Diagnóstico', icon: 'bi-tools',        href: URLS.diagnostico || '/diagnostico' },
        { kind: 'page', label: 'Grabaciones', icon: 'bi-record-circle', href: URLS.grabaciones || '/grabaciones' },
      ];
      if ((URLS.user || {}).rol === 'admin') {
        pages.push({ kind: 'page', label: 'Administración', icon: 'bi-shield-lock', href: URLS.admin || '/admin' });
      }
      out.push(...pages);

      // Acciones rápidas
      out.push(
        { kind: 'action', label: 'Cambiar contraseña', icon: 'bi-key',
          run: () => { window.dispatchEvent(new CustomEvent('lbs:open-change-password')); } },
        { kind: 'action', label: 'Cerrar sesión', icon: 'bi-box-arrow-right',
          href: URLS.logout || '/logout' },
        { kind: 'action', label: 'Wizard ZeroTier', icon: 'bi-magic',
          href: (URLS.diagnostico || '/diagnostico') + '?tool=zt-wizard' },
      );

      // Sitios
      (MOCK.SITES || []).forEach(s => {
        out.push({
          kind: 'sitio', label: s.name, hint: `#${s.numero_sitio} · ${s.ups_total} UPS`,
          icon: 'bi-geo-alt', href: (URLS.inventario || '/inventario') + '?site=' + s.id,
        });
      });

      // UPS
      (MOCK.DEVICES || []).forEach(d => {
        out.push({
          kind: 'ups', label: d.name, hint: `${d.ip} · ${d.model || d.ups_type || ''}`,
          icon: 'bi-cpu', status: d.status,
          href: (URLS.monitoreo || '/monitoreo') + '?dev=' + d.id,
        });
      });

      return out;
    }, [JSON.stringify((MOCK.SITES || []).map(s => s.id)), JSON.stringify((MOCK.DEVICES || []).map(d => d.id))]);

    const filtered = useMemo(() => {
      if (!q.trim()) return items.slice(0, 30);
      const scored = items
        .map(it => ({ it, s: Math.max(fuzzyScore(q, it.label), fuzzyScore(q, it.hint || '')) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 30)
        .map(x => x.it);
      return scored;
    }, [q, items]);

    useEffect(() => {
      const onKey = (e) => {
        if (e.key === 'Escape') { onClose(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
        if (e.key === 'Enter') {
          e.preventDefault();
          const sel = filtered[idx];
          if (!sel) return;
          if (sel.run) { sel.run(); onClose(); return; }
          if (sel.href) { window.location.href = sel.href; }
        }
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [filtered, idx, onClose]);

    useEffect(() => { setIdx(0); }, [q]);
    useEffect(() => { ref.current && ref.current.focus(); }, []);

    return (
      <div className="lbs-cp-backdrop" onClick={onClose}>
        <div className="lbs-cp" onClick={e => e.stopPropagation()}>
          <div className="lbs-cp-input">
            <i className="bi bi-search"></i>
            <input
              ref={ref}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar UPS, sitio, página…"
            />
            <kbd>ESC</kbd>
          </div>
          <div className="lbs-cp-list">
            {filtered.length === 0 && (
              <div className="lbs-cp-empty">Sin resultados para "{q}"</div>
            )}
            {filtered.map((it, i) => (
              <button
                key={i}
                className={"lbs-cp-row " + (i === idx ? 'active' : '')}
                onClick={() => {
                  if (it.run) { it.run(); onClose(); return; }
                  if (it.href) window.location.href = it.href;
                }}
                onMouseEnter={() => setIdx(i)}
              >
                <i className={"bi " + it.icon}></i>
                <div className="main">
                  <span className="label">{it.label}</span>
                  {it.hint && <span className="hint">{it.hint}</span>}
                </div>
                <span className={"kind kind-" + it.kind}>{it.kind}</span>
                {it.status && <span className={"led " + it.status} style={{ marginLeft: 8 }}></span>}
              </button>
            ))}
          </div>
          <div className="lbs-cp-foot">
            <span><kbd>↑↓</kbd> navegar</span>
            <span><kbd>↵</kbd> abrir</span>
            <span><kbd>ESC</kbd> cerrar</span>
          </div>
        </div>
      </div>
    );
  }

  let _open = false;
  let _root = null;
  let _container = null;

  function open() {
    if (_open) return;
    _open = true;
    _container = document.createElement('div');
    document.body.appendChild(_container);
    _root = ReactDOM.createRoot(_container);
    const close = () => {
      try { _root.unmount(); _container.remove(); } catch (_) {}
      _open = false; _root = null; _container = null;
    };
    _root.render(<Palette onClose={close} />);
  }

  window.LBS_PALETTE = { open };

  // Hotkey global (después de que el DOM cargue)
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'k') {
      e.preventDefault();
      open();
    }
  });
})();
