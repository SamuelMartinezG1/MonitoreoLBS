// Toolbox.jsx — quick command tray

function Toolbox({ onMode, mode }) {
  const cmds = [
    { id: 'online',  ico: 'lightning-charge-fill', label: 'En línea',  hint: 'Doble conversión' },
    { id: 'battery', ico: 'battery-charging',      label: 'Batería',   hint: 'Forzar respaldo' },
    { id: 'bypass',  ico: 'arrow-right-circle',    label: 'Bypass',    hint: 'Switch estático' },
    { id: 'fault',   ico: 'exclamation-triangle',  label: 'Simular falla', hint: 'Inversor down' },
  ];
  const ops = [
    { ico: 'arrow-clockwise', label: 'Reiniciar' },
    { ico: 'shield-check',    label: 'Self-test' },
    { ico: 'broadcast',       label: 'Ping SNMP' },
    { ico: 'file-earmark-text', label: 'Reporte PDF' },
  ];
  return (
    <section className="toolbox-panel">
      <div className="tb-group">
        <span className="tb-label">SIMULAR ESTADO</span>
        {cmds.map(c => (
          <button
            key={c.id}
            className={"tb-cmd" + (mode === c.id ? ' active' : '')}
            onClick={() => onMode(c.id)}
            title={c.hint}
          >
            <i className={"bi bi-" + c.ico}></i>
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      <div className="tb-divider"></div>
      <div className="tb-group">
        <span className="tb-label">OPERACIONES</span>
        {ops.map((o, i) => (
          <button key={i} className="tb-cmd" title={o.label}>
            <i className={"bi bi-" + o.ico}></i>
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      <div className="tb-spacer"></div>
      <div className="tb-meta">
        <i className="bi bi-shield-lock-fill" style={{ color: 'var(--ok)' }}></i>
        <div>
          <b>SESIÓN PROTEGIDA</b>
          <span>R. Cárdenas · Operador NOC</span>
        </div>
      </div>
    </section>
  );
}

window.Toolbox = Toolbox;
