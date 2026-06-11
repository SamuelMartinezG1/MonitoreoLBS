// EventosApp.jsx — Log de eventos NATIVO del UPS (cortes, descargas, bypass, EOD…).
// Selecciona un UPS en el sidebar y muestra su historial desde
// /api/monitoreo/eventos/<id>, con resumen y filtros.

const { useState: useStateE, useEffect: useEffectE, useMemo: useMemoE } = React;

function _lvlStyle(n) {
  if (n === 'critical') return { background: '#3a0d14', color: '#ff6b81', border: '1px solid #ff3d5e55' };
  if (n === 'warning')  return { background: '#3a2c0a', color: '#ffb000', border: '1px solid #ffb00055' };
  return { background: '#0c2233', color: '#46b6ff', border: '1px solid #2a6f9e55' };
}
const _fmtTs = (ts) => ts ? String(ts).slice(0, 19).replace('T', ' ') : '—';

// Eventos nativos con el reloj del UPS desajustado (p.ej. fechas de 2016):
// la fecha NO se corrige (es la que registró el equipo) pero se marca con ⚠
// y el tooltip muestra cuándo se colectó realmente.
const _clockSkewed = (e) => {
  if (!e || !e.ts || e.fuente === 'Portal') return false;
  const year = parseInt(String(e.ts).slice(0, 4), 10);
  return Number.isFinite(year) && year < 2020;
};

// Fecha mostrada: eventos del Portal (ts UTC con zona) en hora local;
// eventos nativos crudos tal como los registró el UPS.
const _fmtTsSmart = (e) => {
  if (!e || !e.ts) return '—';
  if (e.fuente === 'Portal') {
    try {
      return new Date(e.ts).toLocaleString('es-MX', { hour12: false });
    } catch (_) { /* cae al formato crudo */ }
  }
  return _fmtTs(e.ts);
};

function EventosApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#00b4ff';
  useEffectE(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
  }, [accent]);

  // Re-render cuando DataLayer (window.MOCK) carga/actualiza
  const [, setTick] = useStateE(0);
  useEffectE(() => {
    const fn = () => setTick(x => x + 1);
    window.addEventListener('lbs:data-refresh', fn);
    return () => window.removeEventListener('lbs:data-refresh', fn);
  }, []);
  const { DEVICES = [] } = window.MOCK || {};

  const [selected, setSelected] = useStateE(null);
  const [eventos,  setEventos]  = useStateE([]);
  const [resumen,  setResumen]  = useStateE({});
  const [loading,  setLoading]  = useStateE(false);
  const [busy,     setBusy]     = useStateE(false);
  const [nivel,    setNivel]    = useStateE('');
  const [fuente,   setFuente]   = useStateE('');   // '' | 'portal' | 'ups'
  const [filter,   setFilter]   = useStateE('');

  // Auto-selecciona el primer UPS cuando llega la lista
  useEffectE(() => {
    if (!selected && DEVICES.length) setSelected(DEVICES[0]);
    // eslint-disable-next-line
  }, [DEVICES.length]);

  const devId = selected ? (selected._raw_id || selected.id) : null;

  const loadEvents = async (id, src) => {
    if (!id) return;
    setLoading(true);
    try {
      const q = src || fuente;
      const res = await fetch(`/api/monitoreo/eventos/${id}?limit=1000${q ? '&fuente=' + q : ''}`,
                              { credentials: 'same-origin' });
      const j = await res.json();
      setEventos(Array.isArray(j.eventos) ? j.eventos : []);
      setResumen(j.resumen || {});
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error('Error cargando eventos: ' + e.message);
      setEventos([]); setResumen({});
    } finally {
      setLoading(false);
    }
  };

  useEffectE(() => { loadEvents(devId); /* eslint-disable-next-line */ }, [devId, fuente]);

  const refrescar = async () => {
    if (!devId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/monitoreo/eventos/${devId}/refresh`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const j = await res.json();
      if (j.status === 'ok') {
        window.LBS_TOAST && window.LBS_TOAST.success(`Colectados ${j.colectados} · nuevos ${j.insertados}`);
        loadEvents(devId);
      } else {
        window.LBS_TOAST && window.LBS_TOAST.error(j.mensaje || 'No se pudo refrescar');
      }
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error('Sin alcance al UPS: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemoE(() => {
    return eventos.filter(e => {
      if (nivel && e.nivel !== nivel) return false;
      if (filter) {
        const q = filter.toLowerCase();
        return (e.evento || '').toLowerCase().includes(q)
            || (e.fuente || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [eventos, nivel, filter]);

  const exportCsv = () => {
    const head = ['fecha', 'fuente', 'evento', 'nivel', 'codigo', 'colectado'];
    const lines = [head.join(',')].concat(filtered.map(e =>
      [_fmtTs(e.ts), e.fuente || '', '"' + (e.evento || '').replace(/"/g, '""') + '"',
       e.nivel || '', e.code || '', _fmtTs(e.created_at)].join(',')
    ));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eventos-${(selected && selected.name) || devId}.csv`.replace(/\s+/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <div className="app-grid">
      <Header page="eventos" crumbs={[{ label: 'Log de eventos', bold: true }]}
              deviceName={selected ? selected.name : ''} />
      <Sidebar activeId={devId || ''} onSelect={(d) => setSelected(d)} />

      <main className="app-main">
        <div className="page-grid">
          <section className="fleet-hero" style={{ gridTemplateColumns: '1.6fr repeat(6, 1fr)' }}>
            <div className="fh-title">
              <h1>Log de eventos</h1>
              <div className="sub">
                {selected
                  ? <>{selected.name} · {selected.ip}
                      {resumen.desde && <> · {_fmtTs(resumen.desde)} → {_fmtTs(resumen.hasta)}</>}</>
                  : 'Selecciona un UPS en el panel izquierdo'}
              </div>
            </div>
            <div className="fh-stat"><label>Total</label><div className="v">{resumen.total || 0}</div></div>
            <div className="fh-stat" style={{ color: '#ff6b81' }}><label>Críticos</label><div className="v">{resumen.criticos || 0}</div></div>
            <div className="fh-stat" style={{ color: '#ffb000' }}><label>Warnings</label><div className="v">{resumen.warnings || 0}</div></div>
            <div className="fh-stat"><label>Descargas (UPS)</label><div className="v">{resumen.descargas || 0}</div></div>
            <div className="fh-stat"><label>Descargas (portal)</label><div className="v">{resumen.descargas_portal || 0}</div></div>
            <div className="fh-stat" style={{ color: '#ff6b81' }}><label>Desconexiones</label><div className="v">{resumen.desconexiones || 0}</div></div>
          </section>

          <div className="inv-toolbar">
            <div className="search-input">
              <i className="bi bi-search"></i>
              <input placeholder="Buscar evento o fuente..." value={filter} onChange={e => setFilter(e.target.value)} />
            </div>
            <select value={nivel} onChange={e => setNivel(e.target.value)} className="grab-select">
              <option value="">— Todos los niveles —</option>
              <option value="critical">Críticos</option>
              <option value="warning">Warnings</option>
              <option value="info">Info</option>
            </select>
            <select value={fuente} onChange={e => setFuente(e.target.value)} className="grab-select"
                    title="Portal: eventos generados por el monitoreo (conexión, descargas, alarmas). UPS: log nativo del equipo.">
              <option value="">— Todas las fuentes —</option>
              <option value="portal">Portal (conexión/alarmas)</option>
              <option value="ups">UPS (log nativo)</option>
            </select>
            <button className="btn ghost" onClick={() => loadEvents(devId)} disabled={!devId || loading}>
              <i className="bi bi-arrow-clockwise ico"></i> RECARGAR
            </button>
            <button className="btn ghost" onClick={exportCsv} disabled={!filtered.length}>
              <i className="bi bi-download ico"></i> CSV
            </button>
            <button className="btn" onClick={refrescar} disabled={!devId || busy}
                    title="Colecta nuevos eventos directamente del UPS (requiere alcance de red)">
              <i className="bi bi-cloud-download ico"></i> {busy ? 'COLECTANDO…' : 'COLECTAR DEL UPS'}
            </button>
          </div>

          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th style={{ width: 170 }}><i className="bi bi-clock"></i> Fecha/hora</th>
                  <th style={{ width: 130 }}><i className="bi bi-hdd"></i> Fuente</th>
                  <th><i className="bi bi-card-text"></i> Evento</th>
                  <th style={{ width: 110 }}><i className="bi bi-flag"></i> Nivel</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan="4" style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>Cargando…</td></tr>
                )}
                {!loading && filtered.map(e => (
                  <tr key={e.id}>
                    <td className="mono dim">
                      {_fmtTsSmart(e)}
                      {_clockSkewed(e) && (
                        <i className="bi bi-exclamation-triangle-fill"
                           style={{ color: '#ffb000', marginLeft: 6, cursor: 'help' }}
                           title={`Reloj del UPS desajustado — fecha registrada por el equipo. Colectado: ${_fmtTs(e.created_at)}`}></i>
                      )}
                    </td>
                    <td>{e.fuente || '—'}</td>
                    <td>
                      <b>{e.evento}</b>
                      {e.code && (
                        <span className="diag-pill" style={{
                          marginLeft: 8, padding: '1px 6px', fontSize: 10, borderRadius: 4,
                          background: '#101826', color: '#8fa3bd', border: '1px solid #2a3a5255',
                        }}>{e.code}</span>
                      )}
                    </td>
                    <td><span className="diag-pill" style={_lvlStyle(e.nivel)}>{(e.nivel || 'info').toUpperCase()}</span></td>
                  </tr>
                ))}
                {!loading && !devId && (
                  <tr><td colSpan="4" style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
                    Selecciona un UPS en el panel izquierdo para ver su log de eventos.
                  </td></tr>
                )}
                {!loading && devId && filtered.length === 0 && (
                  <tr><td colSpan="4" style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
                    Sin eventos para este UPS / filtro. Usa “COLECTAR DEL UPS” para traerlos (requiere alcance de red).
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

ReactDOM.createRoot(document.getElementById('root')).render(<EventosApp />);
