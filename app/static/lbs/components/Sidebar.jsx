// Sidebar.jsx — SCADA device list (alimentado por window.MOCK / DataLayer)

function _buildSidebar() {
  const M = window.MOCK || { SITES: [], DEVICES: [] };
  // Agrupa devices por site real
  const byKey = {};
  (M.SITES || []).forEach(s => {
    byKey[s.id] = {
      id: 's' + (s._raw_id || s.id),
      name: s.name,
      open: true,
      devices: [],
    };
  });
  byKey['__unassigned'] = { id: '__unassigned', name: 'Sin asignar', open: true, devices: [] };
  (M.DEVICES || []).forEach(d => {
    const target = byKey[d.site] ? byKey[d.site] : byKey['__unassigned'];
    target.devices.push({
      id: d._raw_id || d.id,
      name: d.name,
      ip: d.ip,
      status: d.status,
      model: d.model,
      alarm: d.status === 'warn' ? 1 : d.status === 'off' ? 1 : 0,
    });
  });
  // Filtra sitios vacíos del bucket sin-asignar
  return Object.values(byKey).filter(s => s.devices.length > 0 || s.id !== '__unassigned');
}

function Sidebar({ activeId, onSelect }) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const fn = () => setTick(x => x + 1);
    window.addEventListener('lbs:data-refresh', fn);
    return () => window.removeEventListener('lbs:data-refresh', fn);
  }, []);
  const [openMap, setOpenMap] = React.useState({});
  const [q, setQ] = React.useState('');
  // Collapsed con persistencia
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem('lbs.sidebar.collapsed') === '1'; }
    catch (_) { return false; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('lbs.sidebar.collapsed', collapsed ? '1' : '0'); }
    catch (_) {}
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  }, [collapsed]);

  const sites = _buildSidebar().map(s => ({ ...s, open: openMap[s.id] !== undefined ? openMap[s.id] : s.open }));
  const toggle = (id) => setOpenMap(m => ({ ...m, [id]: !(m[id] !== undefined ? m[id] : true) }));

  const totalDevices = sites.reduce((a,b) => a + b.devices.length, 0);
  const totalAlarms  = sites.reduce((a,b) => a + b.devices.reduce((x,y) => x + y.alarm, 0), 0);
  const totalOk      = sites.reduce((a,b) => a + b.devices.filter(d => d.status === 'ok').length, 0);

  const filt = (devs) => q
    ? devs.filter(d => (d.name + d.ip + d.model).toLowerCase().includes(q.toLowerCase()))
    : devs;

  if (collapsed) {
    return (
      <aside className="scada-sidebar scada-sidebar-collapsed">
        <button className="sb-iconbtn sb-expand" title="Expandir sidebar (S)"
                onClick={() => setCollapsed(false)}>
          <i className="bi bi-chevron-double-right"></i>
        </button>
        <div className="sb-collapsed-stats">
          <div title="UPS en línea"><span className="led ok"></span><b>{totalOk}</b></div>
          <div title="UPS totales"><i className="bi bi-cpu"></i><b>{totalDevices}</b></div>
          {totalAlarms > 0 && <div title="Alarmas"><i className="bi bi-exclamation-triangle" style={{color:'#ffb000'}}></i><b>{totalAlarms}</b></div>}
        </div>
      </aside>
    );
  }

  return (
    <aside className="scada-sidebar">
      <div className="sb-section-title">
        <span><i className="bi bi-hdd-rack me-1"></i> DISPOSITIVOS · {totalDevices}</span>
        <div className="actions">
          <button className="sb-iconbtn" title="Buscar (Ctrl+K)" onClick={() => window.LBS_PALETTE && window.LBS_PALETTE.open()}>
            <i className="bi bi-search"></i>
          </button>
          <button className="sb-iconbtn" title="Colapsar (S)" onClick={() => setCollapsed(true)}>
            <i className="bi bi-chevron-double-left"></i>
          </button>
        </div>
      </div>

      <div className="sb-search">
        <i className="bi bi-search"></i>
        <input
          placeholder="Buscar por nombre, IP, modelo…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', marginTop: 4 }}>
        {totalDevices === 0 && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-dim, #98a1bf)', fontSize: 12, lineHeight: 1.6 }}>
            <i className="bi bi-cpu" style={{ fontSize: 24, color: 'var(--text-faint, #5d6786)', display: 'block', marginBottom: 8 }}></i>
            Sin UPS registrados.<br />
            <a href={(window.LBS_URLS && window.LBS_URLS.inventario) || '/inventario'}
               style={{ color: 'var(--accent, #00b4ff)', marginTop: 6, display: 'inline-block', fontSize: 11 }}>
              <i className="bi bi-plus-circle"></i> Agregar el primero
            </a>
          </div>
        )}
        {sites.map(site => {
          const visible = filt(site.devices);
          if (q && visible.length === 0) return null;
          return (
            <div key={site.id} className="sb-site">
              <div
                className="sb-site-head"
                data-open={site.open || !!q}
                onClick={() => toggle(site.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="bi bi-chevron-down chev"></i>
                  <i className="bi bi-geo-alt" style={{ fontSize: 11, color: 'var(--cyan)' }}></i>
                  <span>{site.name}</span>
                </div>
                <span className="count">{visible.length}</span>
              </div>
              {(site.open || q) && visible.map(d => (
                <div
                  key={d.id}
                  className={"sb-device" + (d.id === activeId ? ' active' : '')}
                  onClick={() => onSelect(d)}
                >
                  <span className={"led " + d.status}></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="name">{d.name}</div>
                    <div className="ip">{d.ip} · {d.model}</div>
                  </div>
                  {d.alarm > 0
                    ? <span className="badge alarm">{d.alarm}</span>
                    : d.status === 'off'
                      ? <span className="badge">OFF</span>
                      : <span className="badge">{d.status === 'ok' ? 'OK' : d.status.toUpperCase()}</span>
                  }
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="sb-foot">
        <div className="stat"><span>EN LÍNEA</span><b style={{ color: 'var(--ok)' }}>{totalOk}/{totalDevices}</b></div>
        <div className="stat"><span>ALARMAS</span><b style={{ color: totalAlarms ? 'var(--err)' : 'var(--text-main)' }}>{totalAlarms}</b></div>
        <div className="stat"><span>POLLING</span><b>{(window.LBS_URLS && window.LBS_URLS.poll) || '2s'} · live</b></div>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
