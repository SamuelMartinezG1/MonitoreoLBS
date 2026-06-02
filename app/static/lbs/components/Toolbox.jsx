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
            <span>{ageText || '—'}</span>
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
      </div>
    </section>
  );
}

window.Toolbox = Toolbox;
