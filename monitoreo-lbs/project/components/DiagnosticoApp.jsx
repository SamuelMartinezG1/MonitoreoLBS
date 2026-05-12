// DiagnosticoApp.jsx — Network/UPS diagnostic tools with terminal output

const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;

const TOOLS = [
  { id:'ping',   label:'Ping',         icon:'bi-broadcast-pin' },
  { id:'trace',  label:'Traceroute',   icon:'bi-diagram-2' },
  { id:'snmp',   label:'SNMP Walk',    icon:'bi-router' },
  { id:'self',   label:'Self-Test UPS',icon:'bi-shield-check' },
  { id:'load',   label:'Battery Load', icon:'bi-battery-charging' },
];

const PRESETS = {
  ping:  [{ name:'host',  label:'Host',  type:'text',   def:'192.168.3.10' },
          { name:'count', label:'Count', type:'number', def:8 },
          { name:'iface', label:'Interface', type:'select', def:'eth0', opts:['eth0','eth1','vlan20'] }],
  trace: [{ name:'host',  label:'Host',  type:'text',   def:'192.168.3.10' },
          { name:'hops',  label:'Max hops', type:'number', def:15 },
          { name:'proto', label:'Protocol', type:'select', def:'ICMP', opts:['ICMP','UDP','TCP'] }],
  snmp:  [{ name:'host',  label:'Host',  type:'text',   def:'192.168.3.10' },
          { name:'comm',  label:'Community', type:'text',  def:'public' },
          { name:'oid',   label:'OID Branch', type:'select', def:'PowerNet-MIB::upsBasic', opts:['PowerNet-MIB::upsBasic','RFC1628::upsOutput','RFC1628::upsBattery','XUPS-MIB::xupsInput'] }],
  self:  [{ name:'host',  label:'Host',  type:'text',   def:'192.168.3.10' },
          { name:'depth', label:'Depth', type:'select', def:'standard', opts:['quick','standard','deep'] }],
  load:  [{ name:'host',  label:'Host',  type:'text',   def:'192.168.3.10' },
          { name:'load',  label:'Load %', type:'number', def:75 },
          { name:'dur',   label:'Duration (s)', type:'number', def:30 }],
};

function buildOutput(tool, params) {
  const ts = () => {
    const d = new Date();
    return d.toTimeString().slice(0,8) + '.' + String(d.getMilliseconds()).padStart(3,'0').slice(0,3);
  };
  const lines = [];
  const push = (msg, cls, ts_) => lines.push({ ts: ts_ === undefined ? ts() : ts_, msg, cls });

  if (tool === 'ping') {
    push(`$ ping ${params.host} -c ${params.count} -I ${params.iface}`, 'cmd');
    push(`PING ${params.host} (${params.host}) 56(84) bytes of data.`, 'dim');
    const n = Math.min(parseInt(params.count)||8, 12);
    let total = 0, lossCount = 0;
    for (let i = 0; i < n; i++) {
      const lost = Math.random() < 0.05;
      if (lost) { push(`request timeout for icmp_seq=${i}`, 'warn'); lossCount++; continue; }
      const rtt = (0.8 + Math.random()*2.6).toFixed(2);
      total += parseFloat(rtt);
      push(`64 bytes from ${params.host}: icmp_seq=${i} ttl=64 time=${rtt} ms`, '');
    }
    push('', '');
    push(`--- ${params.host} ping statistics ---`, 'dim');
    push(`${n} packets transmitted, ${n-lossCount} received, ${((lossCount/n)*100).toFixed(1)}% packet loss`, lossCount?'warn':'ok');
    const avg = (total/(n-lossCount)).toFixed(2);
    push(`rtt min/avg/max = 0.84/${avg}/3.40 ms`, 'ok');
  }

  if (tool === 'trace') {
    push(`$ traceroute -m ${params.hops} -P ${params.proto} ${params.host}`, 'cmd');
    push(`traceroute to ${params.host}, ${params.hops} hops max`, 'dim');
    const hops = [
      ['10.0.0.1',    'gw-core-01',     '0.42'],
      ['10.0.1.1',    'sw-dist-03',     '0.81'],
      ['10.0.20.1',   'sw-access-vallejo', '1.24'],
      [params.host,   'ups-03-01.lan',  '1.86'],
    ];
    hops.forEach((h, i) => push(` ${i+1}  ${h[1].padEnd(24)} (${h[0].padEnd(14)})  ${h[2]} ms  ${(parseFloat(h[2])+0.04).toFixed(2)} ms  ${(parseFloat(h[2])+0.08).toFixed(2)} ms`, ''));
    push(`✓ destination reached in ${hops.length} hops`, 'ok');
  }

  if (tool === 'snmp') {
    push(`$ snmpwalk -v2c -c ${params.comm} ${params.host} ${params.oid}`, 'cmd');
    const branch = params.oid;
    const rows = branch.includes('Battery') ? [
      ['upsBatteryStatus.0',          'INTEGER',  'batteryNormal(2)'],
      ['upsSecondsOnBattery.0',       'INTEGER',  '0 seconds'],
      ['upsEstimatedMinutesRemaining.0','INTEGER','42 minutes'],
      ['upsEstimatedChargeRemaining.0','INTEGER', '96 percent'],
      ['upsBatteryVoltage.0',         'INTEGER',  '274 (0.1 Volts DC)'],
      ['upsBatteryTemperature.0',     'INTEGER',  '28 degrees Celsius'],
    ] : branch.includes('Output') ? [
      ['upsOutputSource.0',           'INTEGER',  'normal(3)'],
      ['upsOutputFrequency.0',        'INTEGER',  '600 (0.1 Hertz)'],
      ['upsOutputNumLines.0',         'INTEGER',  '3'],
      ['upsOutputVoltage.1',          'INTEGER',  '1204 (0.1 RMS Volts)'],
      ['upsOutputVoltage.2',          'INTEGER',  '1198 (0.1 RMS Volts)'],
      ['upsOutputVoltage.3',          'INTEGER',  '1202 (0.1 RMS Volts)'],
      ['upsOutputPower.1',            'INTEGER',  '2840 Watts'],
      ['upsOutputPercentLoad.1',      'INTEGER',  '72'],
    ] : branch.includes('Input') ? [
      ['xupsInputFrequency.0',        'INTEGER',  '601 (0.1 Hertz)'],
      ['xupsInputNumPhases.0',        'INTEGER',  '3'],
      ['xupsInputVoltage.1',          'INTEGER',  '124 RMS Volts'],
      ['xupsInputVoltage.2',          'INTEGER',  '122 RMS Volts'],
      ['xupsInputVoltage.3',          'INTEGER',  '123 RMS Volts'],
      ['xupsInputCurrent.1',          'INTEGER',  '14 RMS Amps'],
    ] : [
      ['upsBasicIdentModel.0',        'STRING',   '"EATON 9PX 6kVA"'],
      ['upsBasicIdentName.0',         'STRING',   '"UPS-03-01"'],
      ['upsBasicBatteryStatus.0',     'INTEGER',  'batteryNormal(2)'],
      ['upsBasicOutputStatus.0',      'INTEGER',  'onLine(2)'],
      ['upsBasicSystemInternalTemperature.0','INTEGER','34'],
    ];
    rows.forEach(r => push(`${branch}.${r[0].padEnd(34)} = ${r[1].padEnd(10)} ${r[2]}`, ''));
    push('', '');
    push(`✓ Walk completed — ${rows.length} variables retrieved`, 'ok');
  }

  if (tool === 'self') {
    push(`$ ups-cli selftest --host ${params.host} --depth ${params.depth}`, 'cmd');
    push(`Connecting to ${params.host}:161 via SNMPv2c...`, 'dim');
    push(`Connected. Identifying device...`, 'dim');
    push(`  → EATON 9PX 6kVA  ·  FW 02.14.0008  ·  S/N PX-2204-08812`, '');
    push(``, '');
    push(`Starting ${params.depth} self-test sequence...`, 'cmd');
    const tests = [
      ['Communication link',           'pass'],
      ['Input voltage range',          'pass'],
      ['Output voltage regulation',    'pass'],
      ['Output frequency',             'pass'],
      ['Battery presence',             'pass'],
      ['Battery voltage under load',   'pass'],
      ['Inverter switch (15 s)',       'pass'],
      ['Transfer time',                'pass'],
      ['Internal fans',                'pass'],
      ['Temperature sensors',          'warn'],
      ['Bypass circuit',               'pass'],
    ];
    tests.forEach(t => {
      const ok = t[1] === 'pass';
      const tag = ok ? '[ PASS ]' : t[1] === 'warn' ? '[ WARN ]' : '[ FAIL ]';
      const extra = t[1] === 'warn' ? '  — Sensor T2 reading 48.6°C (umbral 50°C)' : '';
      push(`  ${tag}  ${t[0]}${extra}`, ok ? 'ok' : t[1] === 'warn' ? 'warn' : 'err');
    });
    push(``, '');
    push(`SELF-TEST COMPLETE  —  10 PASS  ·  1 WARN  ·  0 FAIL`, 'ok');
    push(`Recommendation: schedule maintenance — temperature sensor T2 trending high`, 'warn');
  }

  if (tool === 'load') {
    push(`$ ups-cli battery-load --host ${params.host} --load ${params.load}% --duration ${params.dur}s`, 'cmd');
    push(`WARNING: this test transfers load to battery for ${params.dur} seconds`, 'warn');
    push(`Initiating transfer at ${ts()}`, 'dim');
    const ticks = Math.min(parseInt(params.dur)||30, 10);
    for (let i = 0; i < ticks; i++) {
      const v = (272 - i*0.3).toFixed(1);
      const a = (parseFloat(params.load)/8 + Math.random()*0.4).toFixed(1);
      const t = (28.2 + i*0.15).toFixed(1);
      push(`  t+${String(i*3).padStart(2,'0')}s  V=${v}Vdc  I=${a}A  T=${t}°C  load=${params.load}%`, '');
    }
    push(``, '');
    push(`Restoring mains... transfer time = 4.2 ms`, 'dim');
    push(`✓ Battery test PASSED  —  voltage held above 268 Vdc throughout`, 'ok');
    push(`Battery capacity estimate: 96% of nameplate (24.0 min @ ${params.load}% load)`, 'ok');
  }

  return lines;
}

function DiagnosticoApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#00b4ff';
  useEffectD(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
  }, [accent]);

  const { DEVICES } = window.MOCK;
  const params = new URLSearchParams(window.location.search);
  const initialDev = params.get('dev') || 'u01';
  const [devId, setDevId] = useStateD(initialDev);
  const device = DEVICES.find(d => d.id === devId) || DEVICES[0];

  const [tool, setTool] = useStateD('ping');
  const fields = PRESETS[tool];

  const initVals = () => {
    const obj = {};
    PRESETS[tool].forEach(f => { obj[f.name] = f.name === 'host' ? device.ip : f.def; });
    return obj;
  };
  const [vals, setVals] = useStateD(initVals);
  useEffectD(() => { setVals(initVals()); /* eslint-disable-next-line */ }, [tool, devId]);

  const [running, setRunning] = useStateD(false);
  const [output, setOutput] = useStateD([
    { ts: '14:25:30.812', msg: '$ session opened — lbs-monitor diagnostic terminal v3.2', cls: 'cmd' },
    { ts: '14:25:30.815', msg: 'Connected to ' + device.name + '  (' + device.ip + ')', cls: 'dim' },
    { ts: '14:25:30.820', msg: 'Ready. Select a tool, set parameters, click EJECUTAR.', cls: '' },
  ]);
  const termRef = useRefD(null);
  const [streamIdx, setStreamIdx] = useStateD(0);

  useEffectD(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [output, streamIdx]);

  const run = () => {
    if (running) return;
    setRunning(true);
    const lines = buildOutput(tool, vals);
    setOutput(prev => [...prev, { ts: new Date().toTimeString().slice(0,8) + '.000', msg: '─── Ejecutando ' + tool.toUpperCase() + ' ───', cls: 'cmd' }]);
    let i = 0;
    const tick = () => {
      if (i >= lines.length) {
        setRunning(false);
        return;
      }
      setOutput(prev => [...prev, lines[i]]);
      i++;
      setStreamIdx(x => x + 1);
      setTimeout(tick, 60 + Math.random()*70);
    };
    setTimeout(tick, 250);
  };

  const clear = () => {
    setOutput([{ ts: new Date().toTimeString().slice(0,8) + '.000', msg: '$ clear', cls: 'cmd' }]);
  };

  const quickActions = [
    { name: 'Reiniciar UPS remotamente', desc: 'Envía REBOOT vía SNMP set', icon: 'bi-arrow-clockwise' },
    { name: 'Apagar salida programada', desc: 'shutdown -h después de 60 s', icon: 'bi-power' },
    { name: 'Calibrar batería',          desc: 'Calibración profunda · 4-6 h', icon: 'bi-battery-full' },
    { name: 'Limpiar log de eventos',    desc: 'Borra historial interno',     icon: 'bi-eraser' },
    { name: 'Exportar configuración',    desc: 'Backup .json del firmware',   icon: 'bi-download' },
    { name: 'Actualizar firmware',       desc: 'Versión 02.14.0008 disponible', icon: 'bi-cloud-arrow-up' },
  ];

  return (
    <div className="app-grid">
      <Header page="diagnostico" crumbs={[{label:'Diagnóstico'},{label:device.name,bold:true}]} deviceName={device.name} />
      <Sidebar activeId={device.id} onSelect={id => { setDevId(id); }} />

      <main className="app-main">
        <div className="page-grid">
          <section className="fleet-hero" style={{ gridTemplateColumns: '1.6fr repeat(4, 1fr)' }}>
            <div className="fh-title">
              <h1>Diagnóstico · {device.name}</h1>
              <div className="sub">{device.model} · {device.ip} · {device.kva} kVA</div>
            </div>
            <div className={"fh-stat " + (device.status === 'ok' ? 'ok' : device.status === 'warn' ? 'warn' : 'err')}>
              <label>Estado</label>
              <div className="v" style={{ fontSize: 16, letterSpacing: '0.10em' }}>
                {device.status === 'ok' ? 'EN LÍNEA' : device.status === 'warn' ? 'ALARMA' : 'OFFLINE'}
              </div>
              <div className="delta">{device.uptime}</div>
            </div>
            <div className="fh-stat"><label>Carga</label><div className="v">{device.load}<small>%</small></div><div className="delta">de {device.kva} kVA</div></div>
            <div className="fh-stat ok"><label>Batería</label><div className="v">{device.bat}<small>%</small></div><div className="delta up">{Math.round(device.bat/2.4)} min</div></div>
            <div className="fh-stat"><label>Temp interna</label><div className="v">{device.temp.toFixed(1)}<small>°C</small></div><div className="delta">Sensor T1</div></div>
          </section>

          <div className="diag-layout">
            <aside className="diag-aside">
              <section className="eng-panel">
                <div className="eng-head">
                  <span className="dot"></span>
                  <h2>Identidad del equipo</h2>
                  <span className="hdr-mono">SNMP · v2c</span>
                </div>
                <div className="eng-body" style={{ padding: '14px 16px' }}>
                  <div className="diag-result">
                    <div className="mini-block acc-cyan">
                      <div className="mini-head"><span><i className="bi bi-tag"></i>MODELO</span></div>
                      <div className="id-val lg">{device.model}<small>{device.kva} kVA · {device.topology || 'Online doble conversión'}</small></div>
                    </div>
                    <div className="mini-block acc-blue">
                      <div className="mini-head"><span><i className="bi bi-router"></i>RED</span></div>
                      <div className="id-val lg cyan">{device.ip}<small>SNMP v2c · puerto 161</small></div>
                    </div>
                    <div className="mini-block">
                      <div className="mini-head"><span><i className="bi bi-cpu"></i>FIRMWARE</span></div>
                      <div className="id-val">02.14.0008<small>Build 2024-09-12</small></div>
                    </div>
                    <div className="mini-block">
                      <div className="mini-head"><span><i className="bi bi-upc"></i>SERIE</span></div>
                      <div className="id-val">PX-2204-08812<small>Lote 2204</small></div>
                    </div>
                    <div className="mini-block">
                      <div className="mini-head"><span><i className="bi bi-calendar-event"></i>INSTALACIÓN</span></div>
                      <div className="id-val">2024-03-18<small>Sitio · {device.site || 'CDMX-01'}</small></div>
                    </div>
                    <div className="mini-block">
                      <div className="mini-head"><span><i className="bi bi-clock-history"></i>UPTIME</span></div>
                      <div className="id-val">{device.uptime}<small>Último reinicio · 14/09</small></div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="eng-panel">
                <div className="eng-head">
                  <span className="dot warn"></span>
                  <h2>Acciones rápidas</h2>
                  <span className="hdr-mono">REQUIERE 2FA</span>
                </div>
                <div className="eng-body" style={{ padding: '12px 14px' }}>
                  <div className="diag-action-list">
                    {quickActions.map((a, i) => (
                      <button key={i} className="diag-action">
                        <i className={"bi " + a.icon}></i>
                        <div style={{ flex: 1 }}>
                          <div className="name">{a.name}</div>
                          <div className="desc">{a.desc}</div>
                        </div>
                        <i className="bi bi-chevron-right" style={{ color: 'var(--text-dim)' }}></i>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </aside>

            <section className="diag-tools">
              <section className="eng-panel">
                <div className="eng-head">
                  <span className="dot"></span>
                  <h2>Herramientas</h2>
                  <span className="hdr-mono">Console v3.2</span>
                </div>
                <div className="eng-body" style={{ padding: '14px 16px', gap: 12, display: 'flex', flexDirection: 'column' }}>
                  <div className="tool-tabs">
                    {TOOLS.map(t_ => (
                      <button key={t_.id} className={"tool-tab " + (tool === t_.id ? 'active' : '')} onClick={() => setTool(t_.id)}>
                        <i className={"bi " + t_.icon}></i>{t_.label}
                      </button>
                    ))}
                  </div>
                  <div className="tool-form">
                    {fields.map(f => (
                      <div key={f.name} className="tool-field">
                        <label>{f.label}</label>
                        {f.type === 'select' ? (
                          <select value={vals[f.name] || f.def} onChange={e => setVals({...vals, [f.name]: e.target.value})}>
                            {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            type={f.type}
                            value={vals[f.name] === undefined ? f.def : vals[f.name]}
                            onChange={e => setVals({...vals, [f.name]: e.target.value})}
                          />
                        )}
                      </div>
                    ))}
                    <button className="tool-run" onClick={run} disabled={running}>
                      <i className={"bi " + (running ? 'bi-arrow-repeat' : 'bi-play-fill')}></i>
                      {running ? 'Ejecutando' : 'Ejecutar'}
                    </button>
                  </div>
                </div>
              </section>

              <section className="eng-panel">
                <div className="eng-head">
                  <span className="dot ok"></span>
                  <h2>Terminal</h2>
                  <span className="hdr-mono">{device.name.toLowerCase()}@diag:~$</span>
                  <button onClick={clear} style={{ marginLeft: 'auto', background:'transparent', border:'1px solid var(--border)', color:'var(--text-dim)', padding:'4px 10px', borderRadius:6, fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.16em', cursor:'pointer' }}>
                    <i className="bi bi-eraser" style={{ marginRight: 5 }}></i>CLEAR
                  </button>
                </div>
                <div className="eng-body" style={{ padding: 0 }}>
                  <div className="terminal" ref={termRef} style={{ border: 'none', borderRadius: 0 }}>
                    {output.map((l, i) => (
                      <div className="ln" key={i}>
                        <span className="ts">{l.ts}</span>
                        <span className={"msg " + (l.cls || '')}>{l.msg || '\u00A0'}</span>
                      </div>
                    ))}
                    {!running && <div className="ln"><span className="ts">{new Date().toTimeString().slice(0,8) + '.000'}</span><span className="msg cmd">$ <span className="cursor"></span></span></div>}
                    {running && <div className="ln"><span className="ts"></span><span className="msg dim">… streaming output</span></div>}
                  </div>
                </div>
              </section>
            </section>
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

ReactDOM.createRoot(document.getElementById('root')).render(<DiagnosticoApp />);
