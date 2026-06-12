// Toolbox.jsx — panel lateral de estado real del equipo (solo lectura).
// Antes forzaba estados simulados (batería/bypass/falla). Ahora refleja el
// estado real reportado por el equipo y ofrece accesos directos reales.

function Toolbox({ status, statusLabel, device, ageText }) {
  const STATE = {
    online:  { ico: 'lightning-charge-fill', cls: 'ok',   txt: 'EN LÍNEA' },
    battery: { ico: 'battery-charging',      cls: 'warn', txt: 'BATERÍA' },
    bypass:  { ico: 'arrow-right-circle',    cls: 'warn', txt: 'BYPASS' },
    fault:   { ico: 'exclamation-triangle',  cls: 'err',  txt: 'FALLA' },
    offline: { ico: 'plug',                  cls: 'err',  txt: 'SIN CONEXIÓN' },
    nodata:  { ico: 'hourglass-split',       cls: 'warn', txt: 'SIN DATOS' },
  }[status] || { ico: 'hourglass-split', cls: 'warn', txt: 'SIN DATOS' };

  const dev = device || {};
  const proxyUrl = dev.id ? `/api/ups-proxy/${dev.id}/` : null;
  const [busy, setBusy] = React.useState(false);

  // Control SEGURO del UPS (solo equipos NetAgent: dev.controllable). Cada
  // acción confirma y registra auditoría en el backend.
  const runControl = async (action, params, confirmMsg) => {
    if (busy || !dev.id) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const r = await window.LBS_API.controlUps(dev.id, action, params || {});
      window.LBS_TOAST && window.LBS_TOAST.success(r.detail || 'Acción enviada al UPS');
    } catch (e) {
      const msg = (e && e.data && e.data.mensaje) || e.message || 'Error de control';
      window.LBS_TOAST && window.LBS_TOAST.error(msg, { ttl: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="toolbox-panel">
      <div className="tb-group">
        <span className="tb-label">ESTADO ACTUAL</span>
        <div className={"tb-cmd active " + STATE.cls} style={{ cursor: 'default' }} title="Estado reportado por el equipo">
          <i className={"bi bi-" + STATE.ico}></i>
          <span>{statusLabel || STATE.txt}</span>
        </div>
        <div className="tb-meta" style={{ marginTop: 8 }}>
          <i className="bi bi-clock-history" style={{ color: 'var(--text-dim)' }}></i>
          <div>
            <b>ÚLTIMA LECTURA</b>
            <span className="age-text">{ageText || '—'}</span>
          </div>
        </div>
      </div>

      <div className="tb-divider"></div>

      <div className="tb-group">
        <span className="tb-label">EQUIPO</span>
        <div className="tb-meta">
          <i className="bi bi-router" style={{ color: 'var(--text-dim)' }}></i>
          <div><b>IP</b><span>{dev.ip || '—'}</span></div>
        </div>
        <div className="tb-meta">
          <i className="bi bi-hdd" style={{ color: 'var(--text-dim)' }}></i>
          <div><b>MODELO</b><span>{dev.model || '—'}</span></div>
        </div>
        {proxyUrl && (
          <a className="tb-cmd" href={proxyUrl} target="_blank" rel="noopener" title="Abrir la interfaz web del UPS">
            <i className="bi bi-box-arrow-up-right"></i>
            <span>Abrir panel del UPS</span>
          </a>
        )}
        {dev.id && (
          <a className="tb-cmd" href={`/monitoreo/reporte/${dev.id}`} target="_blank" rel="noopener"
             title="Hoja de estado imprimible con membrete LBS (Imprimir → Guardar PDF)">
            <i className="bi bi-file-earmark-text"></i>
            <span>Reporte de estado (PDF)</span>
          </a>
        )}
      </div>

      <div className="tb-divider"></div>

      <div className="tb-group">
        <span className="tb-label">CONTROL</span>
        {dev.controllable ? (
          <>
            <button className="tb-cmd" disabled={busy}
                    onClick={() => runControl('battery_test', { mode: 'quick' },
                      '¿Iniciar una prueba de batería rápida (10 s) en el UPS?')}
                    title="Prueba de batería de 10 segundos">
              <i className="bi bi-battery-charging"></i>
              <span>Probar batería (rápida)</span>
            </button>
            <button className="tb-cmd" disabled={busy}
                    onClick={() => {
                      const m = window.prompt('Duración de la prueba de batería (minutos, 1-99):', '5');
                      if (m == null) return;
                      const minutes = Math.max(1, Math.min(99, parseInt(m, 10) || 5));
                      runControl('battery_test', { mode: 'minutes', minutes },
                        `¿Iniciar una prueba de batería de ${minutes} min? El UPS pasará a batería durante la prueba.`);
                    }}
                    title="Prueba de batería de N minutos (el UPS opera en batería)">
              <i className="bi bi-hourglass-split"></i>
              <span>Probar batería (N min)…</span>
            </button>
            <button className="tb-cmd" disabled={busy}
                    onClick={() => runControl('cancel_test', {}, '¿Cancelar la prueba de batería en curso?')}
                    title="Cancelar una prueba de batería en curso">
              <i className="bi bi-x-octagon"></i>
              <span>Cancelar prueba</span>
            </button>
            <button className="tb-cmd" disabled={busy}
                    onClick={() => runControl('buzzer', {}, '¿Alternar (silenciar/activar) el zumbador del UPS?')}
                    title="Silenciar o activar el zumbador del UPS">
              <i className="bi bi-volume-mute"></i>
              <span>Silenciar/activar buzzer</span>
            </button>
            <div className="tb-meta" style={{ marginTop: 6 }}>
              <i className="bi bi-shield-check" style={{ color: 'var(--ok)' }}></i>
              <div><b>SEGURO</b><span>Solo prueba y buzzer · queda en eventos</span></div>
            </div>
          </>
        ) : (
          <div className="tb-meta">
            <i className="bi bi-slash-circle" style={{ color: 'var(--text-dim)' }}></i>
            <div><b>NO DISPONIBLE</b><span>Este equipo no expone control remoto</span></div>
          </div>
        )}
      </div>
    </section>
  );
}

window.Toolbox = Toolbox;
