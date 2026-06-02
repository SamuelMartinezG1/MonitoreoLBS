// App.jsx — página SCADA de monitoreo. SOLO datos reales (sin simulación).
//
// Los valores provienen de:
//   · Socket.IO  `ups_update`            → telemetría en vivo del UPS activo
//   · GET /api/monitoreo/ultimo-estado   → última lectura conocida en BD
//   · GET /api/ups-history               → serie histórica para las gráficas
//
// Cuando no llegan datos NO se inventa nada: se muestra «—» / «N/D» y un
// estado claro (SIN DATOS / SIN CONEXIÓN) junto con cuánto tiempo atrás fue
// la última lectura.

const { useState, useEffect, useMemo, useRef } = React;

const DASH = '—';
const ND   = 'N/D';
// Si no llega una lectura nueva en este tiempo, la consideramos vieja (stale).
const STALE_MS = 90000; // 90 s ≈ 3× el intervalo de muestreo (30 s)

// ─── Helpers ────────────────────────────────────────────────────────────────
function _modeFromPowerSource(ps) {
  const s = String(ps || '').toLowerCase();
  if (s.includes('offline'))                          return 'offline';
  if (s.includes('battery') || s.includes('bater') ||
      s.includes('descarg'))                          return 'battery';
  if (s.includes('bypass'))                           return 'bypass';
  if (s.includes('fault') || s.includes('falla'))     return 'fault';
  return 'online';
}

function _fmtAgo(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return DASH;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `hace ${d}d ${h % 24}h`;
}

// Convierte un registro real (de BD o de Socket.IO) al shape que usan los paneles.
function _liveValuesFrom(d) {
  const f = (v, n = 1) => (v == null || isNaN(v)) ? DASH : Number(v).toFixed(n);
  const num = (v) => (v == null || isNaN(v)) ? null : Number(v);

  const bat  = num(d.bateria_pct ?? d.bat);
  const load = num(d.carga_pct   ?? d.load);
  const temp = d.temperatura ?? d.temp;
  const ambT = d.temperatura_ambiente;
  const cyc  = d.ciclos_descarga;
  const remain = d.battery_remain_time;

  return {
    mode: _modeFromPowerSource(d.power_mode),
    mode_label: 'EN LÍNEA',
    v_in:    f(d.voltaje_in_l1 ?? d.v_in, 1),
    v_in_l2: f(d.voltaje_in_l2, 1),
    v_in_l3: f(d.voltaje_in_l3, 1),
    v_out:   f(d.voltaje_out_l1 ?? d.v_out, 1),
    v_out_l2: f(d.voltaje_out_l2, 1),
    v_out_l3: f(d.voltaje_out_l3, 1),
    freq_in:  f(d.frecuencia_in, 2),
    freq_out: f(d.frecuencia_out, 2),
    i_in:  DASH,
    i_out: f(d.corriente_out_l1 ?? d.i_out, 1),
    thd_in: DASH, thd_out: DASH,
    pf: f(d.power_factor, 2),
    eff_rect: DASH, eff_inv: DASH, efficiency: DASH,
    dc_v: DASH, dc_v_rect: DASH, dc_i: DASH,
    bat_v: f(d.voltaje_bateria, 1),
    bat_i: DASH,
    bat_pct:  bat  == null ? DASH : Math.round(bat),
    bat_temp: f(temp, 1),
    load_pct: load == null ? DASH : Math.round(load),
    load_kw:  f(d.active_power, 2),
    load_kva: f(d.apparent_power, 2),
    runtime:  (remain != null && !isNaN(remain) && remain > 0) ? `${Math.round(remain)}m` : DASH,
    temp: f(temp, 1),
    // Siempre presentes (los pidió el operador): valor real o N/D si el equipo no lo expone
    amb_temp:   (ambT == null || isNaN(ambT)) ? ND : Number(ambT).toFixed(1),
    discharges: (cyc  == null || isNaN(cyc))  ? ND : String(Math.round(Number(cyc))),
    amb_humidity: DASH,
    _hasData: true,
  };
}

// Estado «sin datos»: todo en «—», ambiente/descargas en N/D.
function _emptyValues() {
  return {
    mode: 'nodata', mode_label: 'SIN DATOS',
    v_in: DASH, v_in_l2: DASH, v_in_l3: DASH,
    v_out: DASH, v_out_l2: DASH, v_out_l3: DASH,
    freq_in: DASH, freq_out: DASH,
    i_in: DASH, i_out: DASH,
    thd_in: DASH, thd_out: DASH, pf: DASH,
    eff_rect: DASH, eff_inv: DASH, efficiency: DASH,
    dc_v: DASH, dc_v_rect: DASH, dc_i: DASH,
    bat_v: DASH, bat_i: DASH, bat_pct: DASH, bat_temp: DASH,
    load_pct: DASH, load_kw: DASH, load_kva: DASH, runtime: DASH,
    temp: DASH, amb_temp: ND, amb_humidity: DASH, discharges: ND,
    _hasData: false,
  };
}

// ─── Componente principal ────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#0066FF';

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
    document.documentElement.dataset.panel = t.panelStyle || 'glass';
    document.documentElement.dataset.dense = t.denseLayout ? '1' : '0';
  }, [accent, t.panelStyle, t.denseLayout]);

  // Re-render cuando el DataLayer refresca el inventario (window.MOCK)
  const [, setTickGlobal] = useState(0);
  useEffect(() => {
    const fn = () => setTickGlobal(x => x + 1);
    window.addEventListener('lbs:data-refresh', fn);
    return () => window.removeEventListener('lbs:data-refresh', fn);
  }, []);

  // Dispositivo activo (por ?dev=ID, sino el primero del inventario)
  const urlDev = (new URLSearchParams(window.location.search)).get('dev');
  const fleetDevices = (window.MOCK && window.MOCK.DEVICES) || [];
  const firstDevice = fleetDevices[0] || { id: 0, name: 'Sin UPS', ip: DASH, model: DASH, kva: 0 };
  const matched = urlDev ? fleetDevices.find(d => String(d.id) === String(urlDev)) : null;
  const activeDeviceFromFleet = matched || firstDevice;

  const [activeDevice, setActiveDevice] = useState(activeDeviceFromFleet);
  useEffect(() => {
    if (!activeDevice.id && activeDeviceFromFleet.id) setActiveDevice(activeDeviceFromFleet);
  }, [activeDeviceFromFleet.id]);

  // ── Estado de datos en vivo ──
  const [liveData, setLiveData]       = useState(null);
  const [conn, setConn]               = useState('nodata');  // nodata | online | offline
  const [lastUpdateAt, setLastUpdate] = useState(null);
  const [alarmsLive, setAlarmsLive]   = useState([]);
  const [series, setSeries]           = useState({ voltage: [], load: [], battery: [] });
  const [eventLog, setEventLog]       = useState([]);

  // Reloj para recalcular «hace X» y la antigüedad (stale)
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // ── Suscripción a datos del UPS activo (carga inicial + Socket.IO) ──
  useEffect(() => {
    if (!activeDevice.id) { setConn('nodata'); setLiveData(null); return; }
    let cancelled = false;

    // Limpia estado al cambiar de equipo
    setLiveData(null); setAlarmsLive([]); setLastUpdate(null);
    setSeries({ voltage: [], load: [], battery: [] });

    // 1. Último estado conocido en BD
    if (window.LBS_API) {
      window.LBS_API.getUltimoEstado(activeDevice.id).then(r => {
        if (cancelled) return;
        if (r && r.data) {
          setLiveData(r.data);
          const ts = r.data.timestamp ? Date.parse(r.data.timestamp) : Date.now();
          setLastUpdate(ts);
          setConn((Date.now() - ts) > STALE_MS ? 'offline' : 'online');
        } else {
          setConn('nodata');
        }
      }).catch(() => { if (!cancelled) setConn('nodata'); });
    }

    // 2. Socket.IO en vivo (ups_update se emite en namespace default y /monitor)
    if (!window.io) return () => { cancelled = true; };
    const handle = (payload) => {
      if (cancelled || !payload || String(payload.id) !== String(activeDevice.id)) return;
      const hasData = payload.status === 'online' &&
                      payload.data && Object.keys(payload.data).length > 0;
      if (hasData) {
        setLiveData(payload.data);
        setLastUpdate(Date.now());
        setConn('online');
        setAlarmsLive(Array.isArray(payload.alarms) ? payload.alarms : []);
      } else if (payload.status === 'offline') {
        setConn('offline');
        setAlarmsLive(Array.isArray(payload.alarms) ? payload.alarms : []);
      }
    };
    const sockMon = window.io('/monitor', { transports: ['websocket', 'polling'] });
    sockMon.on('ups_update', handle);
    const sockDefault = window.io({ transports: ['websocket', 'polling'] });
    sockDefault.on('ups_update', handle);
    return () => { cancelled = true; sockMon.close(); sockDefault.close(); };
  }, [activeDevice.id]);

  // ── Histórico real para las gráficas (refresca cada 30 s) ──
  useEffect(() => {
    if (!activeDevice.id || !window.LBS_API) return;
    let cancelled = false;
    const fmt = ts => {
      try { const d = new Date(ts); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
      catch (_) { return ''; }
    };
    const load = () => {
      window.LBS_API.getHistorial(activeDevice.id, 6).then(rows => {
        if (cancelled || !Array.isArray(rows)) return;
        setSeries({
          voltage: rows.map(r => ({ t: fmt(r.timestamp), v_in: +r.voltaje_in_l1||0, v_in_l2: +r.voltaje_in_l2||0, v_in_l3: +r.voltaje_in_l3||0, v_out: +r.voltaje_out_l1||0 })),
          load:    rows.map(r => ({ t: fmt(r.timestamp), load_pct: +r.carga_pct||0, i_out: +r.corriente_out_l1||0 })),
          battery: rows.map(r => ({ t: fmt(r.timestamp), bat_pct: +r.bateria_pct||0, temp: +r.temperatura||0 })),
        });
      }).catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeDevice.id]);

  // ── Antigüedad / estado derivado ──
  const ageMs   = lastUpdateAt ? (nowTick - lastUpdateAt) : null;
  const isStale = conn === 'online' && ageMs != null && ageMs > STALE_MS;
  const statusKind = conn === 'nodata' ? 'nodata'
                   : (conn === 'offline' || isStale) ? 'offline'
                   : (liveData ? _modeFromPowerSource(liveData.power_mode) : 'nodata');
  const ageText = statusKind === 'nodata'
                ? 'Sin datos'
                : (lastUpdateAt ? _fmtAgo(nowTick - lastUpdateAt) : DASH);

  // Log de estado REAL: registra transiciones de estado del equipo
  const prevStatusRef = useRef(null);
  useEffect(() => { prevStatusRef.current = null; setEventLog([]); }, [activeDevice.id]);
  useEffect(() => {
    if (prevStatusRef.current === statusKind) return;
    const first = prevStatusRef.current === null;
    prevStatusRef.current = statusKind;
    if (first && statusKind === 'nodata') return; // evita ruido en el arranque
    const M = {
      online:  ['info', 'Equipo en línea · recibiendo datos SNMP'],
      battery: ['warn', 'Operando en batería (respaldo)'],
      bypass:  ['warn', 'Bypass estático activo'],
      fault:   ['err',  'Falla reportada por el equipo'],
      offline: ['err',  'Sin conexión · el equipo no responde'],
      nodata:  ['warn', 'Sin datos de monitoreo para este equipo'],
    };
    const [lvl, msg] = M[statusKind] || ['info', 'Estado actualizado'];
    const ts = new Date().toLocaleTimeString('es-MX', { hour12: false });
    setEventLog(p => [{ ts, lvl, msg }, ...p].slice(0, 14));
  }, [statusKind]);

  // Valores a mostrar: reales si hay lectura, si no «—»/«N/D»
  const values = useMemo(() => liveData ? _liveValuesFrom(liveData) : _emptyValues(), [liveData]);
  const hasData = values._hasData;

  // Alarmas reales emitidas por el backend
  const alarms = useMemo(() => (alarmsLive || []).map(a => ({
    ts: new Date().toLocaleTimeString('es-MX', { hour12: false }),
    lvl: a.level === 'critical' ? 'err' : a.level === 'warning' ? 'warn' : 'info',
    title: a.code || 'Alarma',
    detail: a.msg || '',
  })), [alarmsLive]);

  const phaseMode = t.phaseMode || 'single';

  // Etiquetas de estado
  const statusLabel = {
    online: 'EN LÍNEA', battery: 'BATERÍA', bypass: 'BYPASS',
    fault: 'FALLA', offline: 'SIN CONEXIÓN', nodata: 'SIN DATOS',
  }[statusKind] || 'SIN DATOS';
  const statusSub = {
    online: 'Doble conversión · Estable',
    battery: 'Operando con respaldo',
    bypass: 'Switch estático activo',
    fault: 'Inversor offline',
    offline: `Última lectura ${ageText}`,
    nodata: 'Esperando monitoreo',
  }[statusKind] || 'Esperando monitoreo';
  const ringCls = (statusKind === 'fault' || statusKind === 'offline') ? 'err'
                : statusKind === 'online' ? '' : 'warn';

  // Render de un valor con sufijo, respetando «—»/«N/D»
  const stat = (v, unit) => (v === DASH || v === ND || v == null)
    ? <>{v == null ? DASH : v}</>
    : <>{v}<small>{unit}</small></>;

  return (
    <div className="app-grid">
      <Header deviceName={activeDevice.name} page="monitoreo" crumbs={[{label:'Monitoreo'},{label:activeDevice.name,bold:true}]} />
      <Sidebar activeId={activeDevice.id} onSelect={setActiveDevice} />

      <main className="app-main">
        <section className="telemetry-hero" style={{ ['--stagger']: 0 }}>
          <div className="th-id">
            <div className="mark"><i className="bi bi-cpu"></i></div>
            <div>
              <h1>{activeDevice.name}</h1>
              <div className="meta">
                <span><i className="bi bi-router"></i> {activeDevice.ip}</span>
                <span><i className="bi bi-hdd"></i> {activeDevice.model}</span>
                <span><i className="bi bi-clock-history"></i> Última lectura: {ageText}</span>
              </div>
            </div>
          </div>
          <div className="th-status">
            <span className={"ring " + ringCls}></span>
            <div className="label">
              {statusLabel}
              <small>{statusSub}</small>
            </div>
          </div>
          <div className="th-stat brand">
            <label>V. Salida</label>
            <div className="v">{stat(values.v_out, 'V')}</div>
          </div>
          <div className={"th-stat " + (!hasData ? '' : values.load_pct > 90 ? 'err' : values.load_pct > 70 ? 'warn' : 'ok')}>
            <label>Carga</label>
            <div className="v">{stat(values.load_pct, '%')}</div>
          </div>
          <div className={"th-stat " + (!hasData ? '' : values.bat_pct < 20 ? 'err' : values.bat_pct < 50 ? 'warn' : 'ok')}>
            <label>Batería</label>
            <div className="v">{stat(values.bat_pct, '%')}</div>
          </div>
          <div className="th-stat">
            <label>Temp. ambiente</label>
            <div className="v">{stat(values.amb_temp, '°C')}</div>
          </div>
          <div className="th-stat">
            <label>Descargas</label>
            <div className="v">{stat(values.discharges, 'ciclos')}</div>
          </div>
          <div className="th-stat">
            <label>Autonomía</label>
            <div className="v">{values.runtime}</div>
          </div>
        </section>

        <div className="trio-row" style={{ ['--stagger']: 1 }}>
          <InputStackPanel values={values} phaseMode={phaseMode} />
          <UpsDiagram
            values={values}
            mode={statusKind}
            phaseMode={phaseMode}
            showParticles={t.showParticles !== false && hasData}
          />
          <OutputStackPanel values={values} phaseMode={phaseMode} alarms={alarms} />
        </div>

        <div className="panels-row" style={{ ['--stagger']: 2, gridTemplateColumns: '1.7fr 1fr' }}>
          <HistoryChart series={series} phaseMode={phaseMode} />
          <LoadAnalysisPanel values={values} />
        </div>

        <div className="panels-row" style={{ ['--stagger']: 3 }}>
          <StatusLogPanel log={eventLog} />
          <Toolbox status={statusKind} statusLabel={statusLabel} device={activeDevice} ageText={ageText} />
        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Tema">
          <TweakColor
            label="Acento"
            value={t.accent}
            onChange={v => setTweak('accent', v)}
            options={['#00b4ff', '#22e1ff', '#ff3df0', '#25f4a7', '#ffb000']}
          />
          <TweakRadio
            label="Panel"
            value={t.panelStyle}
            onChange={v => setTweak('panelStyle', v)}
            options={['glass', 'solid']}
          />
        </TweakSection>
        <TweakSection label="Diagrama">
          <TweakToggle
            label="Partículas"
            value={t.showParticles !== false}
            onChange={v => setTweak('showParticles', v)}
          />
          <TweakRadio
            label="Fases"
            value={t.phaseMode}
            onChange={v => setTweak('phaseMode', v)}
            options={['single', 'three']}
          />
        </TweakSection>
        <TweakSection label="Layout">
          <TweakToggle
            label="Densa"
            value={!!t.denseLayout}
            onChange={v => setTweak('denseLayout', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
