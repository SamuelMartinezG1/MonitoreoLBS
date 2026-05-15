// App.jsx — wires up the SCADA monitoring page

const { useState, useEffect, useMemo, useRef } = React;

// ─── Synthetic time-series generators ────────────────────────────────────────
function genSeries(view, n = 96) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const hh = String(Math.floor(i / 4)).padStart(2,'0');
    const mm = String((i % 4) * 15).padStart(2,'0');
    const t = `${hh}:${mm}`;
    if (view === 'voltage') {
      arr.push({
        t,
        v_in:    121 + Math.sin(i * 0.18) * 1.4 + (Math.random() - 0.5) * 0.6,
        v_in_l2: 122 + Math.sin(i * 0.18 + 2.1) * 1.4 + (Math.random() - 0.5) * 0.6,
        v_in_l3: 121.5 + Math.sin(i * 0.18 + 4.2) * 1.4 + (Math.random() - 0.5) * 0.6,
        v_out:  120 + Math.sin(i * 0.30) * 0.4 + (Math.random() - 0.5) * 0.2,
      });
    } else if (view === 'load') {
      const base = 62 + Math.sin(i * 0.1) * 8 + Math.cos(i * 0.04) * 4;
      arr.push({
        t,
        load_pct: base + (Math.random() - 0.5) * 2,
        i_out:    18 + Math.sin(i * 0.1) * 2.4 + (Math.random() - 0.5) * 0.4,
      });
    } else {
      const bat = 95 - Math.sin(i * 0.08) * 4 + (Math.random() - 0.5) * 0.6;
      arr.push({
        t,
        bat_pct: Math.max(0, Math.min(100, bat)),
        temp:    34 + Math.sin(i * 0.12) * 3 + (Math.random() - 0.5) * 0.6,
      });
    }
  }
  return arr;
}

const SPARK_LEN = 24;
function spark(base, amp, jitter = 0.4) {
  return Array.from({ length: SPARK_LEN }).map((_, i) =>
    base + Math.sin(i / 2.4) * amp + (Math.random() - 0.5) * jitter
  );
}

// ─── Helpers para datos reales ──────────────────────────────────────────────
function _modeFromPowerSource(ps) {
  const s = String(ps || '').toLowerCase();
  if (s.includes('battery') || s.includes('bater')) return 'battery';
  if (s.includes('bypass')) return 'bypass';
  if (s.includes('fault') || s.includes('falla')) return 'fault';
  return 'online';
}

function _liveValuesFrom(d) {
  // d puede venir de Socket.IO ups_update.data o de /api/monitoreo/ultimo-estado
  const f = (v, n = 1) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(n);
  const vin   = d.voltaje_in_l1  ?? d.v_in   ?? 0;
  const vout  = d.voltaje_out_l1 ?? d.v_out  ?? 0;
  const load  = d.carga_pct       ?? d.load   ?? 0;
  const bat   = d.bateria_pct     ?? d.bat    ?? 0;
  const temp  = d.temperatura     ?? d.temp   ?? 0;
  const fIn   = d.frecuencia_in   ?? d.freq_in  ?? 60;
  const fOut  = d.frecuencia_out  ?? d.freq_out ?? 60;
  const iOut1 = d.corriente_out_l1 ?? d.i_out  ?? 0;
  const batV  = d.voltaje_bateria  ?? d.bat_v  ?? 0;
  const remain = d.battery_remain_time ?? 0;
  return {
    mode_label: 'EN LÍNEA',
    v_in:    f(vin, 1),
    v_in_l2: f(d.voltaje_in_l2 ?? 0, 1),
    v_in_l3: f(d.voltaje_in_l3 ?? 0, 1),
    v_out:   f(vout, 1),
    v_out_l2: f(d.voltaje_out_l2 ?? 0, 1),
    v_out_l3: f(d.voltaje_out_l3 ?? 0, 1),
    freq_in:  f(fIn, 2),
    freq_out: f(fOut, 2),
    i_in:  '—',
    i_out: f(iOut1, 1),
    thd_in: '—', thd_out: '—',
    pf: f(d.power_factor ?? 0.99, 2),
    eff_rect: '—', eff_inv: '—', efficiency: '—',
    dc_v: '—', dc_v_rect: '—', dc_i: '—',
    bat_v: f(batV, 1),
    bat_i: '—',
    bat_pct: Math.round(Number(bat) || 0),
    bat_temp: f(temp, 1),
    load_pct: Math.round(Number(load) || 0),
    load_kw:  f(d.active_power ?? 0, 2),
    load_kva: f(d.apparent_power ?? 0, 2),
    runtime:  remain ? `${Math.round(remain)}m` : '—',
    temp: f(temp, 1),
    amb_temp: '—', amb_humidity: '—',
  };
}

// ─── Main component ──────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#0066FF';

  // Apply accent CSS var live
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
    document.documentElement.dataset.panel = t.panelStyle || 'glass';
    document.documentElement.dataset.dense = t.denseLayout ? '1' : '0';
  }, [accent, t.panelStyle, t.denseLayout]);

  // ── Datos en vivo desde DataLayer ──
  const [, setTickGlobal] = useState(0);
  useEffect(() => {
    const fn = () => setTickGlobal(x => x + 1);
    window.addEventListener('lbs:data-refresh', fn);
    return () => window.removeEventListener('lbs:data-refresh', fn);
  }, []);

  // Selecciona dispositivo activo (por query ?dev=ID, sino primero disponible)
  const urlDev = (new URLSearchParams(window.location.search)).get('dev');
  const fleetDevices = (window.MOCK && window.MOCK.DEVICES) || [];
  const firstDevice = fleetDevices[0] || { id: 0, name: 'Sin UPS', ip: '—', model: '—', kva: 0 };
  const matched = urlDev ? fleetDevices.find(d => String(d.id) === String(urlDev)) : null;
  const activeDeviceFromFleet = matched || firstDevice;

  const [activeDevice, setActiveDevice] = useState(activeDeviceFromFleet);
  // Sincroniza activeDevice si el fleet cambia y aún no hay selección manual
  useEffect(() => {
    if (!activeDevice.id && activeDeviceFromFleet.id) {
      setActiveDevice(activeDeviceFromFleet);
    }
  }, [activeDeviceFromFleet.id]);

  const [mode, setMode] = useState('online'); // online | battery | bypass | fault | demo
  const [tick, setTick] = useState(0);

  // Live tick — sólo para sparklines cosméticas
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 2000);
    return () => clearInterval(id);
  }, []);

  // ── Socket.IO: datos en vivo del UPS activo ──
  const [liveData, setLiveData] = useState(null);
  useEffect(() => {
    if (!activeDevice.id || !window.io) return;
    // Carga inicial: último estado conocido
    if (window.LBS_API) {
      window.LBS_API.getUltimoEstado(activeDevice.id).then(r => {
        if (r && r.data) setLiveData(r.data);
      }).catch(() => {});
    }
    // Conecta al namespace /monitor
    const sock = window.io('/monitor', { transports: ['websocket', 'polling'] });
    const onUpdate = (payload) => {
      if (!payload || String(payload.id) !== String(activeDevice.id)) return;
      if (payload.data) setLiveData(payload.data);
      if (payload.status === 'offline') setMode('fault');
      else if (payload.data && payload.data.power_mode) setMode(_modeFromPowerSource(payload.data.power_mode));
    };
    sock.on('ups_update', onUpdate);
    // ups_update se emite en namespace default, no /monitor — escuchamos en ambos
    const sockDefault = window.io({ transports: ['websocket', 'polling'] });
    sockDefault.on('ups_update', onUpdate);
    return () => { sock.close(); sockDefault.close(); };
  }, [activeDevice.id]);

  // Compute current values based on mode + tick
  const values = useMemo(() => {
    // Si tenemos datos reales por Socket.IO o por la API, usarlos
    if (liveData) return _liveValuesFrom(liveData);

    // Fallback: simulación cosmética cuando aún no llegan datos
    const j = (a) => a + (Math.random() - 0.5) * 0.6;
    const baseOnline = {
      mode: 'online', mode_label: 'LÍNEA',
      v_in: j(122.4).toFixed(1),
      v_in_l2: j(121.8).toFixed(1),
      v_in_l3: j(122.6).toFixed(1),
      v_out: j(120.0).toFixed(1),
      v_out_l2: j(120.0).toFixed(1),
      v_out_l3: j(120.1).toFixed(1),
      freq_in: j(60.01).toFixed(2),
      freq_out: '60.00',
      i_in: j(14.2).toFixed(1),
      i_out: j(18.4).toFixed(1),
      thd_in: j(2.4).toFixed(1),
      thd_out: '1.2',
      pf: '0.99',
      eff_rect: '97.8',
      eff_inv: '96.4',
      efficiency: '94.6',
      dc_v: j(432.4).toFixed(1),
      dc_v_rect: j(432.4).toFixed(1),
      dc_i: j(24.8).toFixed(1),
      bat_v: '54.6',
      bat_i: '0.8',
      bat_pct: 96,
      bat_temp: j(28.4).toFixed(1),
      load_pct: Math.round(j(75.2)),
      load_kw:  j(4.32).toFixed(2),
      load_kva: j(4.51).toFixed(2),
      runtime: '38m 12s',
      temp: j(34.2).toFixed(1),
      amb_temp: j(24.6).toFixed(1),
      amb_humidity: '52',
    };
    if (mode === 'battery') {
      return {
        ...baseOnline,
        mode: 'battery', mode_label: 'BATERÍA',
        v_in: '0.0', i_in: '0.0', freq_in: '—',
        bat_pct: Math.max(20, 96 - tick * 0.3),
        bat_i: j(54.2).toFixed(1),
        runtime: `${Math.max(2, Math.round(38 - tick * 0.2))}m`,
      };
    }
    if (mode === 'bypass') {
      return {
        ...baseOnline,
        mode: 'bypass', mode_label: 'BYPASS',
        eff_inv: '0.0', dc_i: '0.0',
      };
    }
    if (mode === 'fault') {
      return {
        ...baseOnline,
        mode: 'fault', mode_label: 'FALLA',
        v_out: '0.0', freq_out: '—', load_pct: 0, eff_inv: '0.0',
      };
    }
    return baseOnline;
  }, [mode, tick]);

  // Sparkline data
  const sparks = useMemo(() => ({
    spark_v_in:  spark(122, 2.2),
    spark_v_out: spark(120, 0.6),
    spark_bat:   spark(96, 0.6, 0.1),
    spark_load:  spark(75, 6),
    spark_temp:  spark(34, 1.4),
  }), [tick]);

  const valuesWithSpark = { ...values, ...sparks, bat_pct: Math.round(values.bat_pct), load_pct: Math.round(values.load_pct) };

  // Alarms list
  const alarms = useMemo(() => {
    const list = [];
    if (mode === 'battery') list.push({ ts: '14:24:18', lvl: 'warn', title: 'Pérdida de red', detail: 'Se detectó interrupción en línea AC. Operando con respaldo.' });
    if (mode === 'bypass')  list.push({ ts: '14:25:02', lvl: 'warn', title: 'Bypass estático activo', detail: 'Carga conectada directamente a la red por mantenimiento.' });
    if (mode === 'fault')   list.push({ ts: '14:25:30', lvl: 'err', title: 'Falla del inversor', detail: 'Sobre-temperatura IGBT. Carga en bypass automático.' });
    if (parseFloat(values.temp) > 40) list.push({ ts: '14:23:54', lvl: 'warn', title: 'Temperatura elevada', detail: 'Módulo de potencia a 41°C — verificar ventilación.' });
    return list;
  }, [mode, values.temp]);

  // Status log (in-page)
  const log = useMemo(() => {
    const base = [
      { ts: '14:25:30', lvl: 'info', msg: `Polling SNMP OK · ${activeDevice.ip} · ${(Math.random()*30+12).toFixed(0)}ms` },
      { ts: '14:25:08', lvl: 'info', msg: `Lectura batería ${Math.round(values.bat_pct)}% · ${values.bat_v}V` },
      { ts: '14:24:18', lvl: mode === 'online' ? 'info' : 'warn', msg: mode === 'online' ? 'Modo en línea estable' : `Cambio de modo → ${values.mode_label}` },
      { ts: '14:22:08', lvl: 'info', msg: 'Self-test programado completado · 0 fallas' },
      { ts: '14:14:22', lvl: 'info', msg: 'Sincronización de reloj NTP · drift -0.04s' },
      { ts: '14:01:00', lvl: 'info', msg: 'Sesión iniciada · usuario rcardenas (NOC)' },
      { ts: '13:48:45', lvl: 'warn', msg: 'THD entrada 3.1% (bajo umbral 5%)' },
      { ts: '13:30:00', lvl: 'info', msg: 'Reporte horario archivado · 482 KB' },
    ];
    return base;
  }, [mode, activeDevice.ip, values.bat_pct, values.bat_v, values.mode_label]);

  // Time series for chart — datos REALES desde ups_chart_history (fallback sintético)
  const [series, setSeries] = useState({
    voltage: genSeries('voltage'),
    load:    genSeries('load'),
    battery: genSeries('battery'),
  });

  useEffect(() => {
    if (!activeDevice.id || !window.LBS_API) return;
    let cancelled = false;
    window.LBS_API.getHistorial(activeDevice.id, 6).then(rows => {
      if (cancelled) return;
      if (!Array.isArray(rows) || rows.length === 0) return;  // mantén el fallback
      const fmt = ts => {
        try { const d = new Date(ts); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
        catch (_) { return ''; }
      };
      const real = {
        voltage: rows.map(r => ({
          t:       fmt(r.timestamp),
          v_in:    Number(r.voltaje_in_l1  || 0),
          v_in_l2: Number(r.voltaje_in_l2  || 0),
          v_in_l3: Number(r.voltaje_in_l3  || 0),
          v_out:   Number(r.voltaje_out_l1 || 0),
        })),
        load: rows.map(r => ({
          t:        fmt(r.timestamp),
          load_pct: Number(r.carga_pct || 0),
          i_out:    Number(r.corriente_out_l1 || 0),
        })),
        battery: rows.map(r => ({
          t:       fmt(r.timestamp),
          bat_pct: Number(r.bateria_pct || 0),
          temp:    Number(r.temperatura || 0),
        })),
      };
      setSeries(real);
    }).catch(() => {});
    // Refresca histórico cada 30s
    const id = setInterval(() => {
      window.LBS_API.getHistorial(activeDevice.id, 6).then(rows => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const fmt = ts => { try { const d = new Date(ts); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; } catch (_) { return ''; } };
        setSeries({
          voltage: rows.map(r => ({ t: fmt(r.timestamp), v_in: +r.voltaje_in_l1||0, v_in_l2: +r.voltaje_in_l2||0, v_in_l3: +r.voltaje_in_l3||0, v_out: +r.voltaje_out_l1||0 })),
          load:    rows.map(r => ({ t: fmt(r.timestamp), load_pct: +r.carga_pct||0, i_out: +r.corriente_out_l1||0 })),
          battery: rows.map(r => ({ t: fmt(r.timestamp), bat_pct: +r.bateria_pct||0, temp: +r.temperatura||0 })),
        });
      }).catch(() => {});
    }, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeDevice.id]);

  const phaseMode = t.phaseMode || 'single';

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
                <span><i className="bi bi-geo-alt"></i> CDMX · Vallejo · Sala B-3</span>
                <span><i className="bi bi-router"></i> {activeDevice.ip}</span>
                <span><i className="bi bi-hdd"></i> {activeDevice.model}</span>
                <span><i className="bi bi-clock-history"></i> Uptime 142d 04h 18m</span>
              </div>
            </div>
          </div>
          <div className="th-status">
            <span className={"ring " + (mode === 'fault' ? 'err' : mode === 'online' ? '' : 'warn')}></span>
            <div className="label">
              {mode === 'online' ? 'EN LÍNEA' : mode === 'battery' ? 'BATERÍA' : mode === 'bypass' ? 'BYPASS' : 'FALLA'}
              <small>{mode === 'online' ? 'Doble conversión · Estable' : mode === 'battery' ? 'Operando con respaldo' : mode === 'bypass' ? 'Switch estático activo' : 'Inversor offline'}</small>
            </div>
          </div>
          <div className="th-stat brand">
            <label>V. Salida</label>
            <div className="v">{valuesWithSpark.v_out}<small>V</small></div>
          </div>
          <div className={"th-stat " + (valuesWithSpark.load_pct > 90 ? 'err' : valuesWithSpark.load_pct > 70 ? 'warn' : 'ok')}>
            <label>Carga</label>
            <div className="v">{valuesWithSpark.load_pct}<small>%</small></div>
          </div>
          <div className={"th-stat " + (valuesWithSpark.bat_pct < 20 ? 'err' : valuesWithSpark.bat_pct < 50 ? 'warn' : 'ok')}>
            <label>Batería</label>
            <div className="v">{valuesWithSpark.bat_pct}<small>%</small></div>
          </div>
          <div className="th-stat">
            <label>Autonomía</label>
            <div className="v">{valuesWithSpark.runtime}</div>
          </div>
        </section>

        <div className="trio-row" style={{ ['--stagger']: 1 }}>
          <InputStackPanel values={valuesWithSpark} phaseMode={phaseMode} />
          <UpsDiagram
            values={valuesWithSpark}
            mode={mode}
            phaseMode={phaseMode}
            showParticles={t.showParticles !== false}
          />
          <OutputStackPanel values={valuesWithSpark} phaseMode={phaseMode} alarms={alarms} />
        </div>

        <div className="panels-row" style={{ ['--stagger']: 2, gridTemplateColumns: '1.7fr 1fr' }}>
          <HistoryChart series={series} phaseMode={phaseMode} />
          <LoadAnalysisPanel values={valuesWithSpark} />
        </div>

        <div className="panels-row" style={{ ['--stagger']: 3 }}>
          <StatusLogPanel log={log} />
          <Toolbox mode={mode} onMode={setMode} />
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
