// Shell.jsx — top header + utility components

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#00b4ff",
  "panelStyle": "glass",
  "showParticles": true,
  "denseLayout": true,
  "phaseMode": "single"
}/*EDITMODE-END*/;

function Header({ deviceName, page, crumbs }) {
  const navItems = [
    { id: 'dashboard',  label: 'Tablero',     ico: 'speedometer2', href: 'dashboard.html' },
    { id: 'monitoreo',  label: 'Monitoreo',   ico: 'activity',     href: 'monitoreo.html' },
    { id: 'inventario', label: 'Inventario',  ico: 'diagram-3',    href: 'inventario.html' },
    { id: 'diagnostico',label: 'Diagnóstico', ico: 'tools',        href: 'diagnostico.html' },
  ];
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = (n) => String(n).padStart(2, '0');
  const utc = `${fmt(now.getUTCHours())}:${fmt(now.getUTCMinutes())}:${fmt(now.getUTCSeconds())}`;
  const local = `${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}`;
  const date = now.toISOString().slice(0,10);
  return (
    <header className="app-header">
      <div className="brand">
        <img src="assets/lbs-logo.svg" className="brand-logo" alt="LBS" />
        <div className="brand-meta">
          <strong>SERVICIO</strong>
          <span>SCADA · UPS</span>
        </div>
      </div>
      <div className="crumb">
        {(crumbs || [{ label: 'Monitoreo' }, { label: deviceName, bold: true }]).map((c, i, arr) => (
          <React.Fragment key={i}>
            {c.bold ? <b>{c.label}</b> : <span>{c.label}</span>}
            {i < arr.length - 1 && <i className="bi bi-chevron-right" style={{ fontSize: 9 }}></i>}
          </React.Fragment>
        ))}
      </div>
      <div className="header-spacer"></div>
      <nav className="header-tools">
        {navItems.map(n => (
          <a key={n.id} href={n.href} className={"btn " + (page === n.id ? '' : 'ghost')}>
            <i className={"bi bi-" + n.ico + " ico"}></i> {n.label}
          </a>
        ))}
      </nav>
      <div className="utc-clock">
        <b>{utc} UTC</b>
        <span>{date} · {local} LOCAL</span>
      </div>
      <div className="user-chip">
        <div className="avatar">RC</div>
        <span>R. Cárdenas</span>
        <i className="bi bi-chevron-down" style={{ fontSize: 10, color: 'var(--text-dim)' }}></i>
      </div>
    </header>
  );
}

window.Header = Header;
window.TWEAK_DEFAULTS = TWEAK_DEFAULTS;
