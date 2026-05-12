// InventarioApp.jsx — Devices table grouped by site

const { useState: useStateI, useEffect: useEffectI, useMemo: useMemoI } = React;

function InventarioApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#00b4ff';
  useEffectI(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
  }, [accent]);

  const { SITES, DEVICES } = window.MOCK;
  const [filter, setFilter] = useStateI('all');
  const [search, setSearch] = useStateI('');

  const counts = useMemoI(() => ({
    all: DEVICES.length,
    ok:  DEVICES.filter(d => d.status === 'ok').length,
    warn:DEVICES.filter(d => d.status === 'warn').length,
    off: DEVICES.filter(d => d.status === 'off').length,
  }), []);

  const filtered = useMemoI(() => {
    return DEVICES.filter(d => {
      if (filter === 'ok'   && d.status !== 'ok')   return false;
      if (filter === 'warn' && d.status !== 'warn') return false;
      if (filter === 'off'  && d.status !== 'off')  return false;
      if (search) {
        const q = search.toLowerCase();
        return d.name.toLowerCase().includes(q) || d.ip.includes(q) || d.model.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filter, search]);

  const grouped = useMemoI(() => {
    const out = {};
    filtered.forEach(d => {
      if (!out[d.site]) out[d.site] = [];
      out[d.site].push(d);
    });
    return out;
  }, [filtered]);

  const statusPill = (s) => {
    if (s === 'ok')   return <span className="pill-status"><span style={{width:6,height:6,borderRadius:3,background:'currentColor',boxShadow:'0 0 6px currentColor'}}></span>EN LÍNEA</span>;
    if (s === 'warn') return <span className="pill-status warn"><span style={{width:6,height:6,borderRadius:3,background:'currentColor',boxShadow:'0 0 6px currentColor'}}></span>ALARMA</span>;
    if (s === 'off')  return <span className="pill-status off">OFFLINE</span>;
    return <span className="pill-status err">FALLA</span>;
  };

  return (
    <div className="app-grid">
      <Header page="inventario" crumbs={[{label:'Inventario',bold:true}]} deviceName="" />
      <Sidebar activeId="" onSelect={() => { window.location.href = 'monitoreo.html'; }} />

      <main className="app-main">
        <div className="page-grid">
          <section className="fleet-hero" style={{ gridTemplateColumns: '1.4fr repeat(4, 1fr)' }}>
            <div className="fh-title">
              <h1>Inventario de equipos</h1>
              <div className="sub">{DEVICES.length} UPS · {SITES.length} SITIOS · ACTUALIZADO 14:25:30 UTC</div>
            </div>
            <div className="fh-stat"><label>Total UPS</label><div className="v">{counts.all}</div><div className="delta">Flota completa</div></div>
            <div className="fh-stat ok"><label>En línea</label><div className="v">{counts.ok}</div><div className="delta up">{Math.round(counts.ok/counts.all*100)}% disponibilidad</div></div>
            <div className="fh-stat warn"><label>Con alarma</label><div className="v">{counts.warn}</div><div className="delta">Atención requerida</div></div>
            <div className="fh-stat err"><label>Offline</label><div className="v">{counts.off}</div><div className="delta">Sin SNMP</div></div>
          </section>

          <div className="inv-toolbar">
            <div className="search-input">
              <i className="bi bi-search"></i>
              <input
                placeholder="Buscar por nombre, IP o modelo..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="inv-pill-group">
              <button className={"inv-pill " + (filter === 'all'  ? 'active' : '')} onClick={() => setFilter('all')}>Todos <span className="count">{counts.all}</span></button>
              <button className={"inv-pill " + (filter === 'ok'   ? 'active' : '')} onClick={() => setFilter('ok')}>En línea <span className="count">{counts.ok}</span></button>
              <button className={"inv-pill " + (filter === 'warn' ? 'active' : '')} onClick={() => setFilter('warn')}>Alarma <span className="count">{counts.warn}</span></button>
              <button className={"inv-pill " + (filter === 'off'  ? 'active' : '')} onClick={() => setFilter('off')}>Offline <span className="count">{counts.off}</span></button>
            </div>
            <button className="btn"><i className="bi bi-download ico"></i> EXPORTAR CSV</button>
            <button className="btn ghost"><i className="bi bi-plus-circle ico"></i> NUEVO UPS</button>
          </div>

          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th><i className="bi bi-cpu"></i>Equipo</th>
                  <th><i className="bi bi-router"></i>IP</th>
                  <th><i className="bi bi-shield-check"></i>Estado</th>
                  <th><i className="bi bi-lightning"></i>V Entrada</th>
                  <th><i className="bi bi-plug"></i>V Salida</th>
                  <th><i className="bi bi-speedometer2"></i>Carga</th>
                  <th><i className="bi bi-battery-charging"></i>Batería</th>
                  <th><i className="bi bi-thermometer-half"></i>Temp</th>
                  <th><i className="bi bi-clock-history"></i>Uptime</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {SITES.map(s => {
                  const rows = grouped[s.id];
                  if (!rows || !rows.length) return null;
                  return (
                    <React.Fragment key={s.id}>
                      <tr className="group-header">
                        <td colSpan="11">
                          <i className="bi bi-geo-alt-fill" style={{ marginRight: 6 }}></i>
                          <b>{s.name}</b> · {s.addr} · {s.region}
                          <span className="badge">{rows.length} equipos</span>
                        </td>
                      </tr>
                      {rows.map(d => {
                        const loadCls = d.load > 90 ? 'err' : d.load > 75 ? 'warn' : '';
                        const batCls  = d.bat < 30 ? 'err' : d.bat < 60 ? 'warn' : '';
                        const tempCls = d.temp > 50 ? 'err' : d.temp > 42 ? 'warn' : '';
                        return (
                          <tr key={d.id}>
                            <td><span className={"led " + d.status}></span></td>
                            <td>
                              <div className="dev-name">{d.name}</div>
                              <div className="dev-model">{d.model} · {d.kva} kVA</div>
                            </td>
                            <td><span style={{color:'var(--cyan)'}}>{d.ip}</span></td>
                            <td>{statusPill(d.status)}</td>
                            <td>{d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <><b style={{color:'var(--text-main)'}}>{d.v_in.toFixed(1)}</b> <small style={{color:'var(--text-dim)'}}>V</small></>}</td>
                            <td>{d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <><b style={{color:'var(--text-main)'}}>{d.v_out.toFixed(1)}</b> <small style={{color:'var(--text-dim)'}}>V</small></>}</td>
                            <td>
                              {d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <>
                                <span className="mini-bar"><i className={loadCls} style={{width:d.load+'%'}}></i></span>
                                <b style={{color: loadCls==='err'?'var(--err)':loadCls==='warn'?'var(--warn)':'var(--text-main)'}}>{d.load}%</b>
                              </>}
                            </td>
                            <td>
                              {d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <>
                                <span className="mini-bar"><i className={batCls} style={{width:d.bat+'%'}}></i></span>
                                <b style={{color: batCls==='err'?'var(--err)':batCls==='warn'?'var(--warn)':'var(--ok)'}}>{d.bat}%</b>
                              </>}
                            </td>
                            <td>{d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <b style={{color: tempCls==='err'?'var(--err)':tempCls==='warn'?'var(--warn)':'var(--text-main)'}}>{d.temp.toFixed(1)} <small style={{color:'var(--text-dim)'}}>°C</small></b>}</td>
                            <td><span style={{color:'var(--text-dim)',fontSize:11}}>{d.uptime}</span></td>
                            <td>
                              <div className="actions">
                                <a href="monitoreo.html" title="Monitorear"><i className="bi bi-graph-up"></i></a>
                                <a href={"diagnostico.html?dev=" + d.id} title="Diagnóstico"><i className="bi bi-tools"></i></a>
                                <button title="Más"><i className="bi bi-three-dots-vertical"></i></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan="11" style={{ padding:'40px',textAlign:'center',color:'var(--text-dim)',fontFamily:'var(--font-mono)',fontSize:11,letterSpacing:'0.16em' }}>
                    SIN RESULTADOS · AJUSTE LOS FILTROS
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Tema">
          <TweakColor label="Acento" value={t.accent} onChange={v => setTweak('accent', v)}
            options={['#00b4ff', '#22e1ff', '#ff3df0', '#25f4a7', '#ffb000']} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<InventarioApp />);
