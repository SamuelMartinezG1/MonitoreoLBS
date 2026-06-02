// ValuePanels.jsx — KPI cards, gauges, environment

function Sparkline({ data, color }) {
  const w = 120, h = 22;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h - ((v - min)/span) * h}`).join(' ');
  const area = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon className="area" points={area} />
      <polyline points={pts} fill="none" stroke={color || 'currentColor'} strokeWidth="1.5" />
    </svg>
  );
}

function KpiCard({ label, value, unit, ico, tone, spark }) {
  return (
    <div className={"kpi-card " + (tone || '')}>
      <div className="kpi-label">
        <span>{label}</span>
        {ico && <i className={"bi bi-" + ico + " ico"}></i>}
      </div>
      <div className={"kpi-value " + (tone || '')}>
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {spark && <Sparkline data={spark} />}
    </div>
  );
}

function Gauge({ value, max, unit, label, tone }) {
  const pct = Math.max(0, Math.min(1, (value || 0) / (max || 100)));
  const r = 46, c = 2 * Math.PI * r;
  const fillLen = c * 0.75 * pct;       // 270deg sweep
  const trackLen = c * 0.75;
  return (
    <div className="gauge-card">
      <div className={"gauge " + (tone || 'info')}>
        <svg viewBox="0 0 110 110">
          <circle cx="55" cy="55" r={r} className="track"
            strokeDasharray={`${trackLen} ${c}`} strokeDashoffset={c * 0.125} />
          <circle cx="55" cy="55" r={r} className="fill"
            strokeDasharray={`${fillLen} ${c}`} strokeDashoffset={c * 0.125} />
          {/* tick marks */}
          <g className="ticks">
            {Array.from({length: 9}).map((_, i) => {
              const a = (-225 + i * (270/8)) * Math.PI/180;
              const x1 = 55 + Math.cos(a) * (r + 6);
              const y1 = 55 + Math.sin(a) * (r + 6);
              const x2 = 55 + Math.cos(a) * (r + 10);
              const y2 = 55 + Math.sin(a) * (r + 10);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
            })}
          </g>
        </svg>
        <div className="center">
          <span className="v">{value}</span>
          <span className="u">{unit}</span>
        </div>
      </div>
      <div className="gauge-label">{label}</div>
    </div>
  );
}

function ValuesPanel({ values, phaseMode }) {
  return (
    <section className="eng-panel">
      <div className="eng-head">
        <h3><i className="bi bi-lightning-charge ico"></i> Valores en tiempo real</h3>
        <span className="live-badge"><span className="dot"></span> 2 s · LIVE</span>
      </div>
      <div className="eng-body">
        <div className="kpi-grid">
          <KpiCard label="V. Entrada" value={values.v_in}  unit="V (AC)" ico="lightning-charge" tone="l1" spark={values.spark_v_in} />
          <KpiCard label="Batería"    value={values.bat_pct + '%'} unit="" ico="battery-charging" tone={values.bat_pct < 20 ? 'err' : values.bat_pct < 50 ? 'warn' : 'ok'} spark={values.spark_bat} />
          <KpiCard label="Carga"      value={values.load_pct + '%'} unit="" ico="speedometer2" tone={values.load_pct > 90 ? 'err' : values.load_pct > 70 ? 'warn' : 'ok'} spark={values.spark_load} />
          <KpiCard label="Temperatura" value={values.temp} unit="°C" ico="thermometer-half" tone={values.temp > 50 ? 'err' : values.temp > 40 ? 'warn' : 'ok'} spark={values.spark_temp} />
          <KpiCard label="V. Salida"  value={values.v_out} unit="V (AC)" ico="plug" tone="l1" spark={values.spark_v_out} />
          <KpiCard label="Frecuencia" value={values.freq_in} unit="Hz" ico="activity" />
          <KpiCard label="Corriente"  value={values.i_out} unit="A" ico="lightning" />
          <KpiCard label="Modo"       value={values.mode_label} unit="" ico="power" tone={values.mode === 'online' ? 'ok' : 'warn'} />
        </div>

        {phaseMode === 'three' && (
          <div className="kpi-grid" style={{ marginTop: 10 }}>
            <KpiCard label="V. Entrada L2" value={values.v_in_l2} unit="V" tone="l2" />
            <KpiCard label="V. Entrada L3" value={values.v_in_l3} unit="V" tone="l3" />
            <KpiCard label="V. Salida L2"  value={values.v_out_l2} unit="V" tone="l2" />
            <KpiCard label="V. Salida L3"  value={values.v_out_l3} unit="V" tone="l3" />
          </div>
        )}

        <div className="gauge-row">
          <Gauge value={values.v_in}    max={140}  unit="V"  label="V. Entrada" tone="info" />
          <Gauge value={values.bat_pct} max={100} unit="%"  label="Batería"    tone={values.bat_pct < 20 ? 'err' : values.bat_pct < 50 ? 'warn' : 'ok'} />
          <Gauge value={values.load_pct} max={100} unit="%"  label="Carga"      tone={values.load_pct > 90 ? 'err' : values.load_pct > 70 ? 'warn' : 'info'} />
          <Gauge value={values.temp}    max={70}  unit="°C" label="Temperatura" tone={values.temp > 50 ? 'err' : values.temp > 40 ? 'warn' : 'ok'} />
        </div>
      </div>
    </section>
  );
}

function LoadAnalysisPanel({ values }) {
  // Donut: potencia aparente usada vs capacidad
  const cap = 6.0; // kVA capacity
  const used = parseFloat(values.load_kva) || 0;
  const pct = Math.min(1, used / cap);
  const r = 48, c = 2 * Math.PI * r;
  const off = c * (1 - pct);
  return (
    <section className="eng-panel">
      <div className="eng-head">
        <h3><i className="bi bi-pie-chart ico"></i> Análisis de carga</h3>
      </div>
      <div className="eng-body">
        <div className="donut-wrap">
          <div className="donut">
            <svg viewBox="0 0 130 130">
              <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
              <circle cx="65" cy="65" r={r} fill="none"
                stroke="var(--accent)" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={off}
                style={{ filter: 'drop-shadow(0 0 6px var(--accent-glow))' }}
              />
            </svg>
            <div className="center">
              <b>{Math.round(pct*100)}%</b>
              <span>USADO</span>
            </div>
          </div>
          <div className="kv-grid" style={{ flex: 1 }}>
            <div className="kv">
              <label>FACTOR DE POTENCIA</label>
              <div className="val">{values.pf}</div>
            </div>
            <div className="kv">
              <label>POT. ACTIVA</label>
              <div className="val">{values.load_kw}{values.load_kw !== '—' && <small>kW</small>}</div>
            </div>
            <div className="kv">
              <label>POT. APARENTE</label>
              <div className="val">{values.load_kva}{values.load_kva !== '—' && <small>kVA</small>}</div>
            </div>
            <div className="kv">
              <label>AUTONOMÍA EST.</label>
              <div className="val">{values.runtime}{values.runtime !== '—' && <small>@ carga</small>}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EnvironmentPanel({ values, alarms }) {
  return (
    <section className="eng-panel">
      <div className="eng-head">
        <h3><i className="bi bi-thermometer-half ico"></i> Ambiente y alarmas</h3>
        <span className="live-badge" style={{ color: alarms.length ? 'var(--warn)' : 'var(--text-dim)' }}>
          {alarms.length ? `${alarms.length} ACTIVAS` : 'SIN INCIDENTES'}
        </span>
      </div>
      <div className="eng-body">
        <div className="kv-grid" style={{ marginBottom: 10 }}>
          <div className="kv">
            <label>TEMP. AMBIENTE</label>
            <div className="val">{values.amb_temp}<small>°C</small></div>
          </div>
          <div className="kv">
            <label>HUMEDAD</label>
            <div className="val">{values.amb_humidity}<small>% RH</small></div>
          </div>
          <div className="kv">
            <label>TEMP. UPS</label>
            <div className="val">{values.temp}<small>°C</small></div>
          </div>
          <div className="kv">
            <label>TEMP. BATERÍA</label>
            <div className="val">{values.bat_temp}<small>°C</small></div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alarms.length === 0 && (
            <div style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.10em' }}>
              SIN ALARMAS ACTIVAS
            </div>
          )}
          {alarms.map((a, i) => (
            <div key={i} className={"alarm-row " + a.lvl}>
              <span className="ts">{a.ts}</span>
              <div className="msg"><b>{a.title}</b><p>{a.detail}</p></div>
              <button className="btn ghost" style={{ padding: '4px 8px' }}>VER</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusLogPanel({ log }) {
  return (
    <section className="eng-panel">
      <div className="eng-head">
        <h3><i className="bi bi-activity ico"></i> Log de estado</h3>
        <button className="btn ghost"><i className="bi bi-trash ico"></i> Limpiar</button>
      </div>
      <div className="eng-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <div className="log">
          {(!log || log.length === 0) && (
            <div style={{ padding: '14px 12px', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.10em' }}>
              SIN EVENTOS REGISTRADOS
            </div>
          )}
          {(log || []).map((l, i) => (
            <div key={i} className="log-line">
              <span className="ts">{l.ts}</span>
              <span className={"lvl " + l.lvl}>{l.lvl.toUpperCase()}</span>
              <span className="msg">{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── 3-column flanks ────────────────────────────────── */
function MiniRow({ label, value, unit, tone, ico }) {
  const v = (value === undefined || value === null || value === '') ? '—' : value;
  const showUnit = unit && v !== '—' && v !== 'N/D';
  return (
    <div className={"mini-row " + (tone || '')}>
      <span className="mini-label">{ico && <i className={"bi bi-" + ico}></i>}{label}</span>
      <span className="mini-val">{v}{showUnit && <small>{unit}</small>}</span>
    </div>
  );
}

function MiniBlock({ title, ico, accent, children, badge }) {
  return (
    <div className={"mini-block " + (accent || '')}>
      <div className="mini-head">
        <span><i className={"bi bi-" + ico}></i> {title}</span>
        {badge && <em>{badge}</em>}
      </div>
      <div className="mini-body">{children}</div>
    </div>
  );
}

function InputStackPanel({ values, phaseMode }) {
  return (
    <section className="eng-panel stack-panel">
      <div className="eng-head">
        <h3><i className="bi bi-arrow-right-circle ico"></i> Entrada · Rectificador</h3>
        <span className="live-badge"><span className="dot"></span> LIVE</span>
      </div>
      <div className="eng-body stack-body">
        <MiniBlock title="Línea AC" ico="lightning-charge" accent="acc-blue" badge={values.mode === 'battery' ? 'OFF' : 'OK'}>
          {phaseMode === 'three' ? (
            <>
              <MiniRow label="V · L1" value={values.v_in}    unit="V" tone="l1" />
              <MiniRow label="V · L2" value={values.v_in_l2} unit="V" tone="l2" />
              <MiniRow label="V · L3" value={values.v_in_l3} unit="V" tone="l3" />
            </>
          ) : (
            <MiniRow label="Tensión" value={values.v_in} unit="V" />
          )}
          <MiniRow label="Corriente" value={values.i_in}   unit="A" />
          <MiniRow label="Frecuencia" value={values.freq_in} unit="Hz" />
          <MiniRow label="THD entrada" value={values.thd_in} unit="%" />
        </MiniBlock>

        <MiniBlock title="Rectificador" ico="cpu" accent="acc-cyan" badge={values.eff_rect === '—' ? '—' : values.eff_rect + '%'}>
          <MiniRow label="DC bus" value={values.dc_v_rect} unit="V DC" />
          <MiniRow label="DC corriente" value={values.dc_i} unit="A" />
          <MiniRow label="Eficiencia" value={values.eff_rect} unit="%" tone="ok" />
        </MiniBlock>

        <MiniBlock title="Batería" ico="battery-charging" accent={values.bat_pct < 20 ? 'acc-red' : values.bat_pct < 50 ? 'acc-orange' : 'acc-green'} badge={values.bat_pct + '%'}>
          <div className="batt-bar">
            <div className={"batt-bar-fill " + (values.bat_pct < 20 ? 'err' : values.bat_pct < 50 ? 'warn' : 'ok')} style={{ width: values.bat_pct + '%' }}></div>
          </div>
          <MiniRow label="Tensión bus" value={values.bat_v}    unit="V DC" />
          <MiniRow label="Corriente"   value={values.bat_i}    unit="A" />
          <MiniRow label="Temperatura" value={values.bat_temp} unit="°C" />
          <MiniRow label="Autonomía"   value={values.runtime}  unit="" tone="ok" />
        </MiniBlock>
      </div>
    </section>
  );
}

function OutputStackPanel({ values, phaseMode, alarms }) {
  return (
    <section className="eng-panel stack-panel">
      <div className="eng-head">
        <h3><i className="bi bi-arrow-left-circle ico"></i> Salida · Carga</h3>
        <span className="live-badge" style={{ color: alarms.length ? 'var(--warn)' : 'var(--ok)' }}>
          <span className="dot" style={{ background: alarms.length ? 'var(--warn)' : 'var(--ok)' }}></span>
          {alarms.length ? `${alarms.length} ALARMAS` : 'OK'}
        </span>
      </div>
      <div className="eng-body stack-body">
        <MiniBlock title="Inversor" ico="diagram-3" accent="acc-blue" badge={values.eff_inv === '—' ? '—' : values.eff_inv + '%'}>
          {phaseMode === 'three' ? (
            <>
              <MiniRow label="V · L1" value={values.v_out}    unit="V" tone="l1" />
              <MiniRow label="V · L2" value={values.v_out_l2} unit="V" tone="l2" />
              <MiniRow label="V · L3" value={values.v_out_l3} unit="V" tone="l3" />
            </>
          ) : (
            <MiniRow label="Tensión" value={values.v_out} unit="V" />
          )}
          <MiniRow label="Frecuencia"  value={values.freq_out} unit="Hz" />
          <MiniRow label="THD salida"  value={values.thd_out}  unit="%" tone="ok" />
          <MiniRow label="Eficiencia"  value={values.eff_inv}  unit="%" tone="ok" />
        </MiniBlock>

        <MiniBlock title="Carga" ico="speedometer2" accent={values.load_pct > 90 ? 'acc-red' : values.load_pct > 70 ? 'acc-orange' : 'acc-green'} badge={values.load_pct + '%'}>
          <div className="batt-bar">
            <div className={"batt-bar-fill " + (values.load_pct > 90 ? 'err' : values.load_pct > 70 ? 'warn' : 'ok')} style={{ width: values.load_pct + '%' }}></div>
          </div>
          <MiniRow label="Pot. activa"   value={values.load_kw}  unit="kW" />
          <MiniRow label="Pot. aparente" value={values.load_kva} unit="kVA" />
          <MiniRow label="Corriente"     value={values.i_out}    unit="A" />
          <MiniRow label="Factor pot."   value={values.pf}       unit="" tone="ok" />
        </MiniBlock>

        <MiniBlock title="Ambiente y batería" ico="thermometer-half" accent="acc-cyan">
          <MiniRow label="Temp. ambiente"  value={values.amb_temp}   unit="°C" />
          <MiniRow label="Total descargas" value={values.discharges} unit="ciclos" />
          <MiniRow label="Temp. batería"   value={values.bat_temp}   unit="°C" />
        </MiniBlock>
      </div>
    </section>
  );
}

window.ValuesPanel = ValuesPanel;
window.LoadAnalysisPanel = LoadAnalysisPanel;
window.EnvironmentPanel = EnvironmentPanel;
window.StatusLogPanel = StatusLogPanel;
window.InputStackPanel = InputStackPanel;
window.OutputStackPanel = OutputStackPanel;
