// InventarioApp.jsx — Devices table grouped by site

const { useState: useStateI, useEffect: useEffectI, useMemo: useMemoI } = React;

function InventarioApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#00b4ff';
  useEffectI(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
  }, [accent]);

  // Datos en vivo desde DataLayer
  const [, setTick] = useStateI(0);
  useEffectI(() => {
    const onRefresh = () => setTick(x => x + 1);
    window.addEventListener('lbs:data-refresh', onRefresh);
    return () => window.removeEventListener('lbs:data-refresh', onRefresh);
  }, []);

  const { SITES, DEVICES } = window.MOCK;
  const [filter, setFilter] = useStateI('all');
  const [search, setSearch] = useStateI('');

  // Modales
  const [showAddDev,  setShowAddDev]  = useStateI(false);
  const [showAddSite, setShowAddSite] = useStateI(false);
  const [oidEditing,  setOidEditing]  = useStateI(null);  // device para editar OID profile

  const counts = useMemoI(() => ({
    all: DEVICES.length,
    ok:  DEVICES.filter(d => d.status === 'ok').length,
    warn:DEVICES.filter(d => d.status === 'warn').length,
    off: DEVICES.filter(d => d.status === 'off').length,
  }), [DEVICES]);

  const filtered = useMemoI(() => {
    return DEVICES.filter(d => {
      if (filter === 'ok'   && d.status !== 'ok')   return false;
      if (filter === 'warn' && d.status !== 'warn') return false;
      if (filter === 'off'  && d.status !== 'off')  return false;
      if (search) {
        const q = search.toLowerCase();
        return d.name.toLowerCase().includes(q) || d.ip.includes(q) || (d.model || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [filter, search, DEVICES]);

  const grouped = useMemoI(() => {
    const out = {};
    filtered.forEach(d => {
      if (!out[d.site]) out[d.site] = [];
      out[d.site].push(d);
    });
    return out;
  }, [filtered]);

  // Acciones CRUD
  const deleteDevice = async (id) => {
    const dev = DEVICES.find(d => (d._raw_id || d.id) === id) || {};
    const ok = await window.LBS_CONFIRM({
      title: 'Eliminar dispositivo',
      message: `¿Eliminar el UPS "${dev.name || '#' + id}" (${dev.ip || ''}) de la flota?`,
      hint: 'El monitor dejará de poll-earlo. Su histórico de métricas se mantiene 90 días.',
      confirmText: 'Eliminar', danger: true,
    });
    if (!ok) return;
    try {
      await window.LBS_API.deleteDevice(id);
      window.LBS_TOAST && window.LBS_TOAST.success(`${dev.name || 'Dispositivo'} eliminado`);
      window.LBS_DATA.refresh();
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error('Error: ' + e.message);
    }
  };

  const statusPill = (s) => {
    if (s === 'ok')   return <span className="pill-status"><span style={{width:6,height:6,borderRadius:3,background:'currentColor',boxShadow:'0 0 6px currentColor'}}></span>EN LÍNEA</span>;
    if (s === 'warn') return <span className="pill-status warn"><span style={{width:6,height:6,borderRadius:3,background:'currentColor',boxShadow:'0 0 6px currentColor'}}></span>ALARMA</span>;
    if (s === 'off')  return <span className="pill-status off">OFFLINE</span>;
    return <span className="pill-status err">FALLA</span>;
  };

  return (
    <div className="app-grid">
      <Header page="inventario" crumbs={[{label:'Inventario',bold:true}]} deviceName="" />
      <Sidebar activeId="" onSelect={() => { window.location.href = (window.LBS_URLS && window.LBS_URLS.monitoreo) || 'monitoreo.html'; }} />

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
            <button className="btn" onClick={() => setShowAddSite(true)}><i className="bi bi-geo-alt ico"></i> NUEVO SITIO</button>
            <button className="btn ghost" onClick={() => setShowAddDev(true)}><i className="bi bi-plus-circle ico"></i> NUEVO UPS</button>
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
                            <td data-label="Estado"><span className={"led " + d.status}></span></td>
                            <td data-label="Equipo">
                              <div className="dev-name">{d.name}</div>
                              <div className="dev-model">{d.model} · {d.kva} kVA</div>
                            </td>
                            <td data-label="IP"><span style={{color:'var(--cyan)'}}>{d.ip}</span></td>
                            <td data-label="Estado">{statusPill(d.status)}</td>
                            <td data-label="V Entrada">{d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <><b style={{color:'var(--text-main)'}}>{d.v_in.toFixed(1)}</b> <small style={{color:'var(--text-dim)'}}>V</small></>}</td>
                            <td data-label="V Salida">{d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <><b style={{color:'var(--text-main)'}}>{d.v_out.toFixed(1)}</b> <small style={{color:'var(--text-dim)'}}>V</small></>}</td>
                            <td data-label="Carga">
                              {d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <>
                                <span className="mini-bar"><i className={loadCls} style={{width:d.load+'%'}}></i></span>
                                <b style={{color: loadCls==='err'?'var(--err)':loadCls==='warn'?'var(--warn)':'var(--text-main)'}}>{d.load}%</b>
                              </>}
                            </td>
                            <td data-label="Batería">
                              {d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <>
                                <span className="mini-bar"><i className={batCls} style={{width:d.bat+'%'}}></i></span>
                                <b style={{color: batCls==='err'?'var(--err)':batCls==='warn'?'var(--warn)':'var(--ok)'}}>{d.bat}%</b>
                              </>}
                            </td>
                            <td data-label="Temp">{d.status==='off' ? <span style={{color:'var(--text-faint)'}}>—</span> : <b style={{color: tempCls==='err'?'var(--err)':tempCls==='warn'?'var(--warn)':'var(--text-main)'}}>{d.temp.toFixed(1)} <small style={{color:'var(--text-dim)'}}>°C</small></b>}</td>
                            <td data-label="Uptime"><span style={{color:'var(--text-dim)',fontSize:11}}>{d.uptime}</span></td>
                            <td data-label="Acciones">
                              <div className="actions">
                                <a href={((window.LBS_URLS && window.LBS_URLS.monitoreo) || "monitoreo.html") + "?dev=" + d.id} title="Monitorear"><i className="bi bi-graph-up"></i></a>
                                <a href={((window.LBS_URLS && window.LBS_URLS.diagnostico) || "diagnostico.html") + "?dev=" + d.id} title="Diagnóstico"><i className="bi bi-tools"></i></a>
                                {d.protocolo === 'snmp' && (
                                  <button title="Banco SNMP / OID" onClick={() => setOidEditing({ id: d._raw_id || d.id, name: d.name, ip: d.ip, snmp_community: d.snmp_community, snmp_version: d.snmp_version })}>
                                    <i className="bi bi-list-columns"></i>
                                  </button>
                                )}
                                <button title="Eliminar" onClick={() => deleteDevice(d._raw_id || d.id)}><i className="bi bi-trash"></i></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan="11" style={{ padding: 0 }}>
                    <div className="lbs-empty" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
                      <i className="bi bi-hdd-stack"></i>
                      {DEVICES.length === 0 ? <>
                        <h4>No hay UPS en la flota</h4>
                        <p>Agrega el primer UPS — el portal empezará a poll-earlo automáticamente. Si tienes routers Teltonika con UPS detrás, usa el wizard de ZeroTier en Diagnóstico.</p>
                        <div style={{display:'flex', gap:10, flexWrap:'wrap', justifyContent:'center'}}>
                          <button className="btn" onClick={() => setShowAddDev(true)}><i className="bi bi-plus-circle"></i> Nuevo UPS</button>
                          <button className="btn ghost" onClick={() => setShowAddSite(true)}><i className="bi bi-geo-alt"></i> Nuevo sitio</button>
                        </div>
                      </> : <>
                        <h4>Sin resultados</h4>
                        <p>Ajusta el buscador o los filtros para encontrar UPS.</p>
                      </>}
                    </div>
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

      {showAddDev  && <AddDeviceModal sitios={SITES} onClose={() => setShowAddDev(false)}  onSaved={() => { setShowAddDev(false);  window.LBS_DATA.refresh(); window.LBS_TOAST && window.LBS_TOAST.success('UPS agregado a la flota'); }} />}
      {showAddSite && <AddSiteModal               onClose={() => setShowAddSite(false)} onSaved={() => { setShowAddSite(false); window.LBS_DATA.refresh(); window.LBS_TOAST && window.LBS_TOAST.success('Sitio creado'); }} />}
      {oidEditing && window.OIDEditor && (
        <window.OIDEditor
          device={oidEditing}
          onClose={() => setOidEditing(null)}
          onSaved={() => { setOidEditing(null); window.LBS_DATA && window.LBS_DATA.refresh(); }}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<InventarioApp />);
