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

  const [activeDevice, setActiveDevice] = useState({
    id: 'u1', name: 'UPS-03-01', ip: '192.168.3.10', model: 'EATON 9PX 6kVA',
  });

  const [mode, setMode] = useState('online'); // online | battery | bypass | fault
  const [tick, setTick] = useState(0);

  // Live tick every 2s
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 2000);
    return () => clearInterval(id);
  }, []);

  // Compute current values based on mode + tick
  const values = useMemo(() => {
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

  // Time series for chart — generate once + memo
  const series = useMemo(() => ({
    voltage: genSeries('voltage'),
    load:    genSeries('load'),
    battery: genSeries('battery'),
  }), [activeDevice.id]);

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
