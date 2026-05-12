// Sidebar.jsx — SCADA device list

const SIDEBAR_SITES = [
  { id: 's1', name: 'CDMX · Vallejo', open: true, devices: [
    { id: 'u1', name: 'UPS-03-01', ip: '192.168.3.10',  status: 'ok',   model: 'EATON 9PX 6kVA', alarm: 0 },
    { id: 'u2', name: 'UPS-03-02', ip: '192.168.3.11',  status: 'ok',   model: 'EATON 9PX 6kVA', alarm: 0 },
    { id: 'u3', name: 'UPS-03-03', ip: '192.168.3.12',  status: 'warn', model: 'APC SRT 5kVA',   alarm: 1 },
  ]},
  { id: 's2', name: 'Querétaro · El Marqués', open: true, devices: [
    { id: 'u4', name: 'UPS-08-A',  ip: '10.20.4.42',    status: 'ok',   model: 'TRIPP-LITE 3kVA', alarm: 0 },
    { id: 'u5', name: 'UPS-08-B',  ip: '10.20.4.43',    status: 'err',  model: 'TRIPP-LITE 3kVA', alarm: 2 },
    { id: 'u6', name: 'UPS-08-C',  ip: '10.20.4.44',    status: 'off',  model: 'TRIPP-LITE 3kVA', alarm: 0 },
  ]},
  { id: 's3', name: 'Guadalajara · Zapopan', open: false, devices: [
    { id: 'u7', name: 'UPS-12-01', ip: '172.16.5.100',  status: 'ok',   model: 'EATON 9PX 10kVA', alarm: 0 },
    { id: 'u8', name: 'UPS-12-02', ip: '172.16.5.101',  status: 'ok',   model: 'EATON 9PX 10kVA', alarm: 0 },
  ]},
  { id: 's4', name: 'Monterrey · Apodaca', open: false, devices: [
    { id: 'u9', name: 'UPS-21-01', ip: '10.30.7.20',    status: 'ok',   model: 'APC SRT 8kVA',    alarm: 0 },
  ]},
];

function Sidebar({ activeId, onSelect }) {
  const [sites, setSites] = React.useState(SIDEBAR_SITES);
  const [q, setQ] = React.useState('');

  const toggle = (id) => setSites(s => s.map(x => x.id === id ? { ...x, open: !x.open } : x));

  const totalDevices = sites.reduce((a,b) => a + b.devices.length, 0);
  const totalAlarms  = sites.reduce((a,b) => a + b.devices.reduce((x,y) => x + y.alarm, 0), 0);
  const totalOk      = sites.reduce((a,b) => a + b.devices.filter(d => d.status === 'ok').length, 0);

  const filt = (devs) => q
    ? devs.filter(d => (d.name + d.ip + d.model).toLowerCase().includes(q.toLowerCase()))
    : devs;

  return (
    <aside className="scada-sidebar">
      <div className="sb-section-title">
        <span><i className="bi bi-hdd-rack me-1"></i> DISPOSITIVOS · {totalDevices}</span>
        <div className="actions">
          <button className="sb-iconbtn" title="Diagnóstico"><i className="bi bi-tools"></i></button>
          <button className="sb-iconbtn" title="Nuevo UPS"><i className="bi bi-plus-lg"></i></button>
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
        <div className="stat"><span>POLLING</span><b>2s · SNMP</b></div>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
window.SITES_DATA = SIDEBAR_SITES;
