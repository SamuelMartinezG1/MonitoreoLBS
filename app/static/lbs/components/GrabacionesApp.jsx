// GrabacionesApp.jsx — Pantalla de grabaciones SCADA: listar, iniciar, detener,
// ver datos en chart y exportar CSV.

const { useState: useStateG, useEffect: useEffectG, useMemo: useMemoG, useRef: useRefG } = React;

function GrabacionesApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#00b4ff';
  useEffectG(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
  }, [accent]);

  // Datos de DataLayer
  const [, setTick] = useStateG(0);
  useEffectG(() => {
    const fn = () => setTick(x => x + 1);
    window.addEventListener('lbs:data-refresh', fn);
    return () => window.removeEventListener('lbs:data-refresh', fn);
  }, []);
  const { DEVICES = [] } = window.MOCK || {};

  const [recordings, setRecordings] = useStateG([]);
  const [loading,    setLoading]    = useStateG(true);
  const [filter,     setFilter]     = useStateG('');
  const [filterDev,  setFilterDev]  = useStateG('');
  const [showNew,    setShowNew]    = useStateG(false);
  const [showData,   setShowData]   = useStateG(null);  // recording que ver

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await window.LBS_API.recList(null);
      setRecordings(Array.isArray(r) ? r : (r.recordings || []));
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffectG(() => { refresh(); /* eslint-disable-next-line */ }, []);
  // Refresca cada 10s para ver muestras nuevas en grabaciones activas
  useEffectG(() => {
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemoG(() => {
    return recordings.filter(r => {
      if (filterDev && String(r.device_id) !== String(filterDev)) return false;
      if (filter) {
        const q = filter.toLowerCase();
        return (r.nombre || '').toLowerCase().includes(q)
            || (r.device_nombre || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [filter, filterDev, recordings]);

  const activeCount = recordings.filter(r => r.activa).length;

  const stopRec = async (rec) => {
    try {
      await window.LBS_API.recStop(rec.id);
      window.LBS_TOAST && window.LBS_TOAST.success('Grabación detenida');
      refresh();
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error('Error: ' + e.message);
    }
  };

  const deleteRec = async (rec) => {
    const ok = await window.LBS_CONFIRM({
      title: 'Eliminar grabación',
      message: `¿Eliminar la grabación "${rec.nombre || '#' + rec.id}"?`,
      hint: 'Se borrarán todas las muestras capturadas. Esta acción no se puede deshacer.',
      confirmText: 'Eliminar', danger: true,
    });
    if (!ok) return;
    try {
      await window.LBS_API.recDelete(rec.id);
      window.LBS_TOAST && window.LBS_TOAST.success('Grabación eliminada');
      refresh();
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error('Error: ' + e.message);
    }
  };

  const downloadCsv = (rec) => {
    const a = document.createElement('a');
    a.href = window.LBS_API.recordingCsvUrl(rec.id);
    a.download = `grabacion-${rec.id}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="app-grid">
      <Header page="grabaciones" crumbs={[{label:'Grabaciones', bold: true}]} deviceName="" />
      <Sidebar activeId="" onSelect={() => { window.location.href = (window.LBS_URLS && window.LBS_URLS.monitoreo) || 'monitoreo.html'; }} />

      <main className="app-main">
        <div className="page-grid">
          <section className="fleet-hero" style={{ gridTemplateColumns: '1.6fr repeat(3, 1fr)' }}>
            <div className="fh-title">
              <h1>Grabaciones SCADA</h1>
              <div className="sub">Capturas de telemetría · {recordings.length} total · {activeCount} activa(s)</div>
            </div>
            <div className="fh-stat"><label>Total</label><div className="v">{recordings.length}</div></div>
            <div className="fh-stat ok"><label>Activas</label><div className="v">{activeCount}</div></div>
            <div className="fh-stat"><label>Dispositivos</label><div className="v">{DEVICES.length}</div></div>
          </section>

          <div className="inv-toolbar">
            <div className="search-input">
              <i className="bi bi-search"></i>
              <input placeholder="Buscar por nombre..." value={filter} onChange={e => setFilter(e.target.value)} />
            </div>
            <select value={filterDev} onChange={e => setFilterDev(e.target.value)} className="grab-select">
              <option value="">— Todos los UPS —</option>
              {DEVICES.map(d => <option key={d.id} value={d._raw_id || d.id}>{d.name} ({d.ip})</option>)}
            </select>
            <button className="btn" onClick={() => setShowNew(true)} disabled={DEVICES.length === 0}>
              <i className="bi bi-record-circle ico"></i> NUEVA GRABACIÓN
            </button>
          </div>

          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th style={{width:40}}>#</th>
                  <th><i className="bi bi-bookmark"></i> Nombre</th>
                  <th><i className="bi bi-cpu"></i> Dispositivo</th>
                  <th><i className="bi bi-play-circle"></i> Inicio</th>
                  <th><i className="bi bi-stop-circle"></i> Fin</th>
                  <th><i className="bi bi-bar-chart"></i> Muestras</th>
                  <th><i className="bi bi-circle-fill"></i> Estado</th>
                  <th style={{width:200}}></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan="8" style={{padding:40,textAlign:'center',color:'var(--text-dim)'}}>Cargando…</td></tr>
                )}
                {!loading && filtered.map(r => (
                  <tr key={r.id}>
                    <td className="mono dim">{r.id}</td>
                    <td><b>{r.nombre || `Sin nombre #${r.id}`}</b></td>
                    <td>{r.device_nombre || '—'} <small style={{color:'var(--text-dim)'}}>· {r.device_ip}</small></td>
                    <td className="mono dim">{r.inicio ? r.inicio.slice(0, 19).replace('T', ' ') : '—'}</td>
                    <td className="mono dim">{r.fin ? r.fin.slice(0, 19).replace('T', ' ') : '—'}</td>
                    <td className="mono">{r.muestras || 0}</td>
                    <td>
                      <span className={"diag-pill " + (r.activa ? 'ok' : '')}>{r.activa ? 'ACTIVA' : 'TERMINADA'}</span>
                    </td>
                    <td>
                      <div className="actions">
                        <button onClick={() => setShowData(r)} title="Ver datos"><i className="bi bi-graph-up"></i></button>
                        <button onClick={() => downloadCsv(r)} title="Descargar CSV"><i className="bi bi-download"></i></button>
                        {r.activa && <button onClick={() => stopRec(r)} title="Detener"><i className="bi bi-stop-fill"></i></button>}
                        {!r.activa && <button onClick={() => deleteRec(r)} title="Eliminar"><i className="bi bi-trash"></i></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan="8" style={{padding:40,textAlign:'center',color:'var(--text-dim)'}}>
                    Sin grabaciones. Crea una nueva para empezar a capturar telemetría.
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

      {showNew && (
        <StartRecordingModal
          devices={DEVICES}
          activeIds={recordings.filter(r => r.activa).map(r => r.device_id)}
          onClose={() => setShowNew(false)}
          onStarted={() => { setShowNew(false); refresh(); }}
        />
      )}
      {showData && (
        <RecordingDataModal
          recording={showData}
          onClose={() => setShowData(null)}
          onDownload={() => downloadCsv(showData)}
        />
      )}
    </div>
  );
}


function StartRecordingModal({ devices, activeIds, onClose, onStarted }) {
  const [busy, setBusy]   = useStateG(false);
  const [err,  setErr]    = useStateG(null);
  const [devId, setDevId] = useStateG(devices[0] ? String(devices[0]._raw_id || devices[0].id) : '');
  const [nombre, setNombre] = useStateG('');

  const start = async () => {
    if (!devId) { setErr('Selecciona un dispositivo'); return; }
    setErr(null); setBusy(true);
    try {
      await window.LBS_API.recStart(Number(devId), nombre || null);
      window.LBS_TOAST && window.LBS_TOAST.success('Grabación iniciada');
      onStarted();
    } catch (e) {
      setErr((e.data && e.data.error) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="lbs-modal-backdrop" onClick={onClose}>
      <div className="lbs-modal" onClick={e => e.stopPropagation()}>
        <div className="lbs-modal-head">
          <h3>Nueva grabación</h3>
          <button className="lbs-modal-x" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        <div className="lbs-modal-body">
          <label className="lbs-field">
            <span className="lbs-field-label">Dispositivo</span>
            <select value={devId} onChange={e => setDevId(e.target.value)}>
              {devices.map(d => {
                const id = d._raw_id || d.id;
                const active = activeIds.includes(id);
                return <option key={id} value={id} disabled={active}>
                  {d.name} ({d.ip}) {active ? '— ya tiene una grabación activa' : ''}
                </option>;
              })}
            </select>
          </label>
          <label className="lbs-field" style={{marginTop:14}}>
            <span className="lbs-field-label">Nombre (opcional)</span>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="ej. pruebas-carga-pico-23-mayo" />
          </label>
        </div>
        <div className="lbs-modal-foot">
          {err && <span className="lbs-modal-err"><i className="bi bi-exclamation-triangle"></i> {err}</span>}
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn" onClick={start} disabled={busy || !devId}>
            {busy ? 'Iniciando…' : 'Iniciar grabación'}
          </button>
        </div>
      </div>
    </div>
  );
}


function RecordingDataModal({ recording, onClose, onDownload }) {
  const [loading, setLoading] = useStateG(true);
  const [rows, setRows] = useStateG([]);

  useEffectG(() => {
    let alive = true;
    window.LBS_API.recData(recording.id).then(r => {
      if (!alive) return;
      setRows(r.datos || []);
      setLoading(false);
    }).catch(() => { if (alive) { setLoading(false); } });
    return () => { alive = false; };
  }, [recording.id]);

  // Pequeño SVG inline para mostrar batería + carga + voltaje a lo largo
  const W = 720, H = 220, padL = 40, padR = 14, padT = 14, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xs = rows.map((_, i) => i);
  const sNum = (k) => rows.map(r => Number(r[k] || 0));

  const drawLine = (vals, color) => {
    if (!vals.length) return '';
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const span = mx - mn || 1;
    return vals.map((v, i) =>
      `${i === 0 ? 'M' : 'L'} ${padL + (i / (vals.length-1 || 1)) * innerW} ${padT + innerH - ((v - mn) / span) * innerH}`
    ).join(' ');
  };

  const series = [
    { name: 'V Entrada', color: '#00b4ff', d: drawLine(sNum('voltaje_in_l1'), '#00b4ff') },
    { name: 'V Salida',  color: '#22e1ff', d: drawLine(sNum('voltaje_out_l1'), '#22e1ff') },
    { name: 'Carga %',   color: '#ffb000', d: drawLine(sNum('carga_pct'),  '#ffb000') },
    { name: 'Batería %', color: '#4ee08a', d: drawLine(sNum('bateria_pct'),'#4ee08a') },
  ];

  return (
    <div className="lbs-modal-backdrop" onClick={onClose}>
      <div className="lbs-modal" onClick={e => e.stopPropagation()} style={{ width: 820, maxWidth: '95vw' }}>
        <div className="lbs-modal-head">
          <h3>Grabación · {recording.nombre || '#' + recording.id}</h3>
          <button className="lbs-modal-x" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        <div className="lbs-modal-body">
          <div className="diag-kv-grid" style={{marginBottom:14}}>
            <div><span>Dispositivo</span><b>{recording.device_nombre || '—'}</b></div>
            <div><span>Muestras</span><b>{rows.length}</b></div>
            <div><span>Inicio</span><b className="mono">{recording.inicio ? recording.inicio.slice(11,19) : '—'}</b></div>
            <div><span>Fin</span><b className="mono">{recording.fin ? recording.fin.slice(11,19) : '—'}</b></div>
          </div>

          {loading ? (
            <div style={{padding:40, textAlign:'center', color:'var(--text-dim)'}}>Cargando…</div>
          ) : rows.length === 0 ? (
            <div style={{padding:40, textAlign:'center', color:'var(--text-dim)'}}>
              Aún no hay muestras. Espera unos segundos y reabre.
            </div>
          ) : (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height: H, background:'#050810', border:'1px solid var(--border)', borderRadius:8 }}>
                {series.map(s => (
                  <path key={s.name} d={s.d} stroke={s.color} strokeWidth="1.6" fill="none" />
                ))}
                <text x={padL} y={H - 4} fill="#5d6786" fontSize="9" fontFamily="JetBrains Mono">0</text>
                <text x={W - padR} y={H - 4} textAnchor="end" fill="#5d6786" fontSize="9" fontFamily="JetBrains Mono">{rows.length} muestras</text>
              </svg>
              <div style={{display:'flex', gap:14, marginTop:10, flexWrap:'wrap', fontSize:11}}>
                {series.map(s => (
                  <span key={s.name} style={{display:'inline-flex', alignItems:'center', gap:6, color:'var(--text-dim)'}}>
                    <span style={{ width:10, height:2, background: s.color, display:'inline-block' }}></span>
                    {s.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="lbs-modal-foot">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          <button className="btn" onClick={onDownload}>
            <i className="bi bi-download"></i> Descargar CSV
          </button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<GrabacionesApp />);
