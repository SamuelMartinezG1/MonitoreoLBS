// Shell.jsx — top header + utility components

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#00b4ff",
  "panelStyle": "glass",
  "showParticles": true,
  "denseLayout": true,
  "phaseMode": "single"
}/*EDITMODE-END*/;

function Header({ deviceName, page, crumbs }) {
  const URLS = (typeof window !== 'undefined' && window.LBS_URLS) || {};
  const ASSETS = URLS.assets || 'assets/';
  const user = URLS.user || { initials: 'RC', name: 'R. Cárdenas', rol: 'user' };
  const isAdmin = user.rol === 'admin';

  const navItems = [
    { id: 'dashboard',   label: 'Tablero',     ico: 'speedometer2', href: URLS.dashboard    || '/dashboard' },
    { id: 'monitoreo',   label: 'Monitoreo',   ico: 'activity',     href: URLS.monitoreo    || '/monitoreo' },
    { id: 'inventario',  label: 'Inventario',  ico: 'diagram-3',    href: URLS.inventario   || '/inventario' },
    { id: 'diagnostico', label: 'Diagnóstico', ico: 'tools',        href: URLS.diagnostico  || '/diagnostico' },
    { id: 'grabaciones', label: 'Grabaciones', ico: 'record-circle', href: URLS.grabaciones || '/grabaciones' },
  ];
  if (isAdmin) {
    navItems.push({ id: 'admin', label: 'Admin', ico: 'shield-lock', href: URLS.admin || '/admin' });
  }
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
        <img src={ASSETS + 'lbs-logo.svg'} className="brand-logo" alt="LBS" />
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
      <UserMenu user={user} logoutUrl={URLS.logout || '/logout'} />
    </header>
  );
}

function UserMenu({ user, logoutUrl }) {
  const [open, setOpen] = React.useState(false);
  const [pwd, setPwd]   = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    const onOpenPwd = () => setPwd(true);
    window.addEventListener('lbs:open-change-password', onOpenPwd);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('lbs:open-change-password', onOpenPwd);
    };
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="user-chip" onClick={() => setOpen(o => !o)} title="Cuenta"
        style={{ background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px', borderRadius: 8, color: 'inherit' }}>
        <div className="avatar">{user.initials}</div>
        <span>{user.name}</span>
        <i className="bi bi-chevron-down" style={{ fontSize: 10, color: 'var(--text-dim)' }}></i>
      </button>
      {open && (
        <div className="user-menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: 'var(--surface, #14182a)', border: '1px solid var(--border)', borderRadius: 10, minWidth: 220, padding: 6, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: 100 }}>
          <div style={{ padding: '10px 12px 6px', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            {user.rol || 'user'}
          </div>
          <button onClick={() => { setOpen(false); setPwd(true); }}
            style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'transparent', color: 'inherit', border: 0, cursor: 'pointer', fontSize: 13, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="bi bi-key"></i> Cambiar contraseña
          </button>
          <a href={logoutUrl}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', textDecoration: 'none', color: 'var(--err, #ff6363)', fontSize: 13, borderRadius: 6 }}>
            <i className="bi bi-box-arrow-right"></i> Cerrar sesión
          </a>
        </div>
      )}
      {pwd && typeof window.ChangePasswordModal === 'function' && (
        <window.ChangePasswordModal
          onClose={() => setPwd(false)}
          onSaved={() => { setPwd(false); alert('Contraseña actualizada con éxito.'); }}
        />
      )}
    </div>
  );
}

window.Header = Header;
window.TWEAK_DEFAULTS = TWEAK_DEFAULTS;
