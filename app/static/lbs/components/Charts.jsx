// Charts.jsx — historical voltage/current/load chart

function HistoryChart({ series, phaseMode, hours }) {
  const W = 1100, H = 240;
  const padL = 50, padR = 20, padT = 24, padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const [hover, setHover] = React.useState(null);
  const [view, setView] = React.useState('voltage'); // voltage | load | battery

  const data = series[view] || [];
  // data: array of points {t, v_in, v_in_l2, v_in_l3, v_out, ...}
  // NULL = el equipo estuvo sin conexión en ese punto: se deja HUECO en la
  // línea (antes se dibujaba un 0 falso que desplomaba la gráfica).
  const allVals = [];
  data.forEach(d => {
    Object.keys(d).forEach(k => {
      if (k !== 't' && typeof d[k] === 'number' && isFinite(d[k])) allVals.push(d[k]);
    });
  });
  const empty = data.length === 0 || allVals.length === 0;
  const yMin = Math.min(...allVals);
  const yMax = Math.max(...allVals);
  const yPad = (yMax - yMin) * 0.15 || 1;
  const y0 = yMin - yPad, y1 = yMax + yPad;

  const xFor = i => padL + (i / (data.length - 1)) * innerW;
  const yFor = v => padT + innerH - ((v - y0) / (y1 - y0)) * innerH;

  // Build polylines per series key
  const seriesDefs = {
    voltage: phaseMode === 'three'
      ? [
        { key: 'v_in',     name: 'V. ENT L1', color: 'var(--l1)', stroke: 'var(--l1)' },
        { key: 'v_in_l2',  name: 'V. ENT L2', color: 'var(--l2)', stroke: 'var(--l2)' },
        { key: 'v_in_l3',  name: 'V. ENT L3', color: 'var(--l3)', stroke: 'var(--l3)' },
        { key: 'v_out',    name: 'V. SAL',    color: 'var(--accent)', stroke: 'var(--accent)' },
      ]
      : [
        { key: 'v_in',  name: 'V. ENTRADA', color: 'var(--l1)',     stroke: 'var(--l1)' },
        { key: 'v_out', name: 'V. SALIDA',  color: 'var(--accent)', stroke: 'var(--accent)' },
      ],
    load: [
      { key: 'load_pct', name: 'CARGA %',     color: 'var(--accent)', stroke: 'var(--accent)' },
      { key: 'i_out',    name: 'CORRIENTE A', color: 'var(--ok)',     stroke: 'var(--ok)' },
    ],
    battery: [
      { key: 'bat_pct', name: 'BATERÍA %', color: 'var(--ok)',   stroke: 'var(--ok)' },
      { key: 'temp',    name: 'TEMP °C',   color: 'var(--warn)', stroke: 'var(--warn)' },
    ],
  };
  const lines = seriesDefs[view];

  // Y-axis ticks
  const yTicks = 5;
  const yStep = (y1 - y0) / (yTicks - 1);

  // X-axis ticks (timestamps)
  const xTickEvery = Math.ceil(data.length / 8);

  return (
    <section className="eng-panel chart-panel">
      <div className="eng-head">
        <h3><i className="bi bi-graph-up ico"></i> Histórico · últimas {hours || 6} h</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={"btn " + (view === 'voltage' ? '' : 'ghost')} onClick={() => setView('voltage')}>Voltaje</button>
          <button className={"btn " + (view === 'load'    ? '' : 'ghost')} onClick={() => setView('load')}>Carga / I</button>
          <button className={"btn " + (view === 'battery' ? '' : 'ghost')} onClick={() => setView('battery')}>Batería / T°</button>
          <button className="btn ghost"><i className="bi bi-download ico"></i> CSV</button>
        </div>
      </div>
      <div className="chart-legend">
        {lines.map(l => (
          <span key={l.key} className="leg-item">
            <span className="sw" style={{ background: l.color }}></span>
            {l.name}
          </span>
        ))}
      </div>
      <div className="chart-svg-wrap">
        {empty && (
          <div style={{ height: H * 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.12em' }}>
            SIN DATOS HISTÓRICOS PARA EL PERIODO
          </div>
        )}
        {!empty && (<>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width * W;
            const i = Math.round(((x - padL) / innerW) * (data.length - 1));
            if (i >= 0 && i < data.length) setHover(i);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {/* Y grid + labels */}
          {Array.from({ length: yTicks }).map((_, i) => {
            const v = y0 + yStep * i;
            const y = yFor(v);
            return (
              <g key={i}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} className="grid" />
                <text x={padL - 8} y={y + 3} className="axis" textAnchor="end">{v.toFixed(1)}</text>
              </g>
            );
          })}
          {/* X labels */}
          {data.map((d, i) => i % xTickEvery === 0 && (
            <text key={i} x={xFor(i)} y={H - padB + 14} className="axis" textAnchor="middle">{d.t}</text>
          ))}
          {/* Series lines + areas — la línea se corta en los huecos (NULL) */}
          {lines.map(l => {
            const segs = [];
            let cur = [];
            data.forEach((d, i) => {
              const v = d[l.key];
              if (v == null || !isFinite(v)) {
                if (cur.length) { segs.push(cur); cur = []; }
              } else {
                cur.push([xFor(i), yFor(v)]);
              }
            });
            if (cur.length) segs.push(cur);
            return (
              <g key={l.key}>
                {segs.map((s, si) => {
                  const pts = s.map(p => `${p[0]},${p[1]}`).join(' ');
                  const area = `${s[0][0]},${yFor(y0)} ${pts} ${s[s.length - 1][0]},${yFor(y0)}`;
                  return (
                    <g key={si}>
                      <polygon points={area} fill={l.color} opacity="0.06" />
                      <polyline points={pts} fill="none" stroke={l.stroke} strokeWidth="1.8" />
                    </g>
                  );
                })}
              </g>
            );
          })}
          {/* Hover crosshair */}
          {hover != null && (
            <g>
              <line x1={xFor(hover)} y1={padT} x2={xFor(hover)} y2={H - padB} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
              {lines.map(l => {
                const v = data[hover][l.key];
                if (v == null || !isFinite(v)) return null;
                return <circle key={l.key} cx={xFor(hover)} cy={yFor(v)} r="3.5" fill={l.color} />;
              })}
            </g>
          )}
          {/* Axes */}
          <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="rgba(255,255,255,0.20)" />
          <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.20)" />
        </svg>
        {hover != null && (
          <div className="chart-hover-tip" style={{
            left: `calc(${(xFor(hover) / W) * 100}% + 8px)`,
            top: 36,
          }}>
            <strong>{data[hover].t}</strong>
            {lines.map(l => {
              const v = data[hover][l.key];
              return (
                <div key={l.key}>
                  <span style={{ color: l.color }}>● </span>
                  {l.name}: <b>{(v == null || !isFinite(v)) ? 'sin conexión' : v.toFixed(2)}</b>
                </div>
              );
            })}
          </div>
        )}
        </>)}
      </div>
    </section>
  );
}

window.HistoryChart = HistoryChart;
