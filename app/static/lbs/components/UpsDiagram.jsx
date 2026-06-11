// UpsDiagram.jsx — large, refraction-glass UPS flow diagram
function UpsDiagram({ values, mode, phaseMode, showParticles, caps }) {
  const m = mode || 'online';
  const has = (v) => v != null && v !== '—' && v !== 'N/D' && v !== '';

  // DC bus: si el UPS no expone medición separada del DC link, el bus de
  // batería (tensión del banco) es la lectura real disponible.
  const dcBusVal  = has(values.dc_v) ? values.dc_v : (has(values.bat_v) ? values.bat_v : '—');
  const dcBusUnit = has(values.dc_v) ? `V DC · ${values.dc_i || '—'} A` : 'V DC · BUS BATERÍA';

  // Rectificador: el Modbus INVT reporta su estado textual (Normal /
  // Arranque suave / Cerrado); SNMP UPS-MIB no lo expone.
  const rectStatus = values.rect_status || null;

  // Encabezado honesto: nada de "topología 3+1" ni eficiencia inventadas
  const subParts = [
    `FASES ${phaseMode === 'three' ? 'TRIFÁSICAS' : 'MONOFÁSICAS'}`,
    'BANCO DE BATERÍAS',
  ];
  if (caps && caps.has_bypass) subParts.push('BYPASS');
  if (has(values.efficiency)) subParts.push(`EFICIENCIA ${values.efficiency}%`);
  const subText = subParts.join(' · ');

  const nodeCls = (key) => {
    let cls = 'ups-node';
    if (m === 'online') {
      if (['mains','rect','dcbus','inv','out','load'].includes(key))      cls += ' active acc-blue';
      else if (key === 'batt')   cls += ' active acc-green';
      else if (key === 'bypass') cls += ' dimmed';
    } else if (m === 'battery') {
      if (key === 'mains') cls += ' fault';
      else if (key === 'rect') cls += ' dimmed';
      else if (['dcbus','inv','out','load'].includes(key)) cls += ' active acc-orange';
      else if (key === 'batt')   cls += ' active acc-orange';
      else if (key === 'bypass') cls += ' dimmed';
    } else if (m === 'bypass') {
      if (['mains','bypass','out','load'].includes(key)) cls += ' active acc-orange';
      else cls += ' dimmed';
    } else if (m === 'fault') {
      if (key === 'inv') cls += ' fault';
      else cls += ' dimmed';
    }
    return cls;
  };

  const connCls = (key) => {
    if (m === 'online') {
      const map = { 'mains-rect':'flow-blue','rect-dcbus':'flow-blue','dcbus-inv':'flow-blue','inv-out':'flow-blue','out-load':'flow-blue','dcbus-batt':'flow-green','bypass':'' };
      return 'ups-conn ' + (map[key] || '');
    }
    if (m === 'battery') {
      const map = { 'dcbus-inv':'flow-orange','inv-out':'flow-orange','out-load':'flow-orange','dcbus-batt':'flow-orange' };
      return 'ups-conn ' + (map[key] || '');
    }
    if (m === 'bypass') {
      const map = { 'out-load':'flow-orange','bypass':'flow-orange' };
      return 'ups-conn ' + (map[key] || '') + (key === 'bypass' ? ' dashed' : '');
    }
    return 'ups-conn' + (key === 'bypass' ? ' dashed' : '');
  };

  const partCls = (key) => {
    if (!showParticles) return null;
    if (m === 'online' && ['mains-rect','rect-dcbus','dcbus-inv','inv-out','out-load'].includes(key)) return 'ups-flow-particles blue';
    if (m === 'online' && key === 'dcbus-batt') return 'ups-flow-particles green';
    if (m === 'battery' && ['dcbus-inv','inv-out','out-load','dcbus-batt'].includes(key)) return 'ups-flow-particles orange';
    if (m === 'bypass' && ['out-load','bypass'].includes(key)) return 'ups-flow-particles orange';
    return null;
  };

  const statusInfo = {
    online:  { txt: 'EN LÍNEA · DOBLE CONVERSIÓN', cls: 'ok',   tone: 'rgba(37,244,167,0.10)', stroke: 'var(--ok)' },
    battery: { txt: 'EN BATERÍA · RESPALDO',       cls: 'warn', tone: 'rgba(255,176,0,0.10)',  stroke: 'var(--warn)' },
    bypass:  { txt: 'BYPASS ESTÁTICO · MAINS DIRECT', cls: 'warn', tone: 'rgba(255,176,0,0.10)', stroke: 'var(--warn)' },
    fault:   { txt: 'FALLA · INVERSOR',            cls: 'err',  tone: 'rgba(255,58,92,0.10)',  stroke: 'var(--err)' },
    offline: { txt: 'SIN CONEXIÓN · EQUIPO NO RESPONDE', cls: 'err', tone: 'rgba(255,58,92,0.10)', stroke: 'var(--err)' },
    nodata:  { txt: 'SIN DATOS · ESPERANDO MONITOREO',   cls: 'warn', tone: 'rgba(138,138,149,0.10)', stroke: 'var(--text-dim)' },
  }[m] || { txt: 'SIN DATOS', cls: 'warn', tone: 'rgba(138,138,149,0.10)', stroke: 'var(--text-dim)' };

  const batPct  = Math.max(0, Math.min(100, parseFloat(values.bat_pct) || 0));
  const batCls  = batPct <= 20 ? 'err' : batPct <= 50 ? 'warn' : '';
  const loadPct = Math.max(0, Math.min(100, parseFloat(values.load_pct) || 0));
  const arcLen  = 2 * Math.PI * 22;
  const arcOff  = arcLen * (1 - loadPct / 100);
  const loadArcCls = loadPct > 90 ? 'err' : loadPct > 70 ? 'warn' : 'ok';

  // ─── Refraction Glass node ───
  // x,y,w,h, variant (blue/cyan/green/orange/red)
  const Glass = ({ x, y, w, h, v }) => {
    const variant = v || 'blue';
    return (
      <g className={"glass " + variant}>
        {/* main rect with iridescent fill */}
        <rect x={x} y={y} width={w} height={h} rx="18" ry="18"
              className="glass-rect"
              fill={`url(#irid-${variant})`} />
        {/* refraction blob - bottom-right corner */}
        <rect x={x} y={y} width={w} height={h} rx="18" ry="18"
              fill={`url(#refract-${variant})`}
              opacity="0.55"
              pointerEvents="none" />
        {/* top crystalline highlight band */}
        <path d={`M ${x+18} ${y+0.5} 
                  L ${x+w-18} ${y+0.5}
                  Q ${x+w-0.5} ${y+0.5} ${x+w-0.5} ${y+18}
                  L ${x+w-0.5} ${y+h*0.42}
                  Q ${x+w/2} ${y+h*0.30} ${x+0.5} ${y+h*0.42}
                  L ${x+0.5} ${y+18}
                  Q ${x+0.5} ${y+0.5} ${x+18} ${y+0.5} Z`}
              fill="url(#glassShine)"
              opacity="0.9"
              pointerEvents="none" />
        {/* thin top edge */}
        <path d={`M ${x+12} ${y+1} L ${x+w-12} ${y+1}`}
              stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" fill="none" />
        {/* outer glow rect (animated) */}
        <rect x={x} y={y} width={w} height={h} rx="18" ry="18"
              className="glass-glow" fill="none" />
        {/* border */}
        <rect x={x} y={y} width={w} height={h} rx="18" ry="18"
              className="glass-border" fill="none" />
      </g>
    );
  };

  return (
    <section className="ups-diagram-panel">
      <div className="ups-diagram-head">
        <div className="ups-title-wrap">
          <h2>Diagrama de flujo · UPS Online doble conversión</h2>
          <span className="sub">{subText}</span>
        </div>
        <span className={"pill " + statusInfo.cls} style={{ background: statusInfo.tone, borderColor: statusInfo.stroke, color: statusInfo.stroke }}>
          <span className="dot"></span>
          {statusInfo.txt}
        </span>
      </div>

      <div className="ups-svg-wrap">
        <svg viewBox="0 0 1340 560" preserveAspectRatio="xMidYMid meet">
          <defs>
            {/* Iridescent fills per variant */}
            {[
              ['blue',   '0,180,255',   '34,225,255',  '140,90,255'],
              ['cyan',   '34,225,255',  '120,210,255', '0,180,255'],
              ['green',  '37,244,167',  '120,255,200', '34,225,255'],
              ['orange', '255,176,0',   '255,210,80',  '255,90,140'],
              ['red',    '255,58,92',   '255,120,140', '255,40,200'],
            ].map(([name, c1, c2, c3]) => (
              <React.Fragment key={name}>
                <linearGradient id={`irid-${name}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%"   stopColor={`rgba(${c1},0.22)`} />
                  <stop offset="35%"  stopColor={`rgba(${c2},0.16)`} />
                  <stop offset="65%"  stopColor="rgba(10,16,38,0.55)" />
                  <stop offset="100%" stopColor={`rgba(${c3},0.18)`} />
                </linearGradient>
                <radialGradient id={`refract-${name}`} cx="80%" cy="85%" r="65%">
                  <stop offset="0%"   stopColor={`rgba(${c2},0.40)`} />
                  <stop offset="55%"  stopColor={`rgba(${c1},0.12)`} />
                  <stop offset="100%" stopColor={`rgba(${c3},0)`} />
                </radialGradient>
              </React.Fragment>
            ))}

            <linearGradient id="glassShine" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="rgba(255,255,255,0.28)" />
              <stop offset="50%"  stopColor="rgba(255,255,255,0.08)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>

            {/* Flow direction arrowhead */}
            <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
            </marker>
            <marker id="arrow-orange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--warn)" />
            </marker>
            <marker id="arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ok)" />
            </marker>

            <filter id="soft-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.6" />
            </filter>
          </defs>

          {/* ─────── Background guide rails ─────── */}
          <g opacity="0.10" stroke="rgba(140,200,255,0.5)" strokeDasharray="2 8" fill="none">
            <line x1="20" y1="255" x2="1320" y2="255" />
            <line x1="20" y1="445" x2="1320" y2="445" />
          </g>

          {/* ─────── CONNECTIONS at y=255 ─────── */}
          {[
            ['mains-rect', 'M 190 255 L 240 255'],
            ['rect-dcbus', 'M 410 255 L 460 255'],
            ['dcbus-inv',  'M 630 255 L 680 255'],
            ['inv-out',    'M 850 255 L 900 255'],
            ['out-load',   'M 1070 255 L 1120 255'],
          ].map(([k,d]) => (
            <g key={k}>
              <path d={d} className={connCls(k)} />
              {partCls(k) && <path d={d} className={partCls(k)} />}
            </g>
          ))}

          {/* dcbus → battery (down) */}
          <path d="M 545 330 L 545 370" className={connCls('dcbus-batt')} />
          {partCls('dcbus-batt') && <path d="M 545 330 L 545 370" className={partCls('dcbus-batt')} />}

          {/* Bypass route — smooth bezier from MAINS top to OUT top */}
          <path d="M 105 180 C 105 100, 985 100, 985 180" className={connCls('bypass')} />
          {partCls('bypass') && <path d="M 105 180 C 105 100, 985 100, 985 180" className={partCls('bypass')} />}

          {/* Bypass label centered — con tensión real cuando el UPS la reporta */}
          <g transform="translate(545,110)">
            <title>{`Bypass estático${has(values.bypass_v) ? ` · ${values.bypass_v} V` : ''} — ${m === 'bypass' ? 'ACTIVO: la carga se alimenta directo de la red' : 'en espera'}`}</title>
            <rect x="-105" y="-16" width="210" height="32" rx="16"
                  fill={m === 'bypass' ? 'rgba(255,176,0,0.16)' : 'rgba(10,16,38,0.88)'}
                  stroke={m === 'bypass' ? 'var(--warn)' : 'rgba(255,176,0,0.40)'} strokeWidth={m === 'bypass' ? 1.6 : 1} />
            <circle cx="-88" cy="0" r="3.5" fill="var(--warn)"
                    style={{ filter: 'drop-shadow(0 0 4px var(--warn-glow))' }}>
              {m === 'bypass' && <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />}
            </circle>
            <text x="-76" y="4.5" textAnchor="start"
                  style={{ fill: 'var(--warn)', fontFamily: 'var(--font-mono)', fontSize: 12.5, letterSpacing: '0.14em', fontWeight: 700 }}>
              {m === 'bypass' ? 'BYPASS ACTIVO' : 'BYPASS'}{has(values.bypass_v) ? ` · ${values.bypass_v} V` : ' · STATIC SW'}
            </text>
          </g>

          {/* ─────── NODES (170 wide × 150 tall) ─────── */}

          {/* N01 · MAINS */}
          <g className={nodeCls('mains')}>
            <title>{`Red AC de entrada\nTensión: ${values.v_in} V · Frecuencia: ${values.freq_in} Hz${has(values.i_in) ? `\nCorriente: ${values.i_in} A` : ''}${phaseMode === 'three' ? `\nL2: ${values.v_in_l2} V · L3: ${values.v_in_l3} V` : ''}`}</title>
            <Glass x={20} y={180} w={170} h={150} v="blue" />
            <text x="38" y="206" className="n-id">N01 · MAINS</text>
            <text x="105" y="240" className="n-val" textAnchor="middle">{values.v_in}</text>
            <text x="105" y="258" className="n-unit" textAnchor="middle">V · {values.freq_in} HZ</text>
            <g transform="translate(105,288)" className="n-icon">
              <path d="M -16 -7 Q -11 -12 -6 -7 T 4 -7 T 14 -7" />
              <path d="M -16  0 Q -11 -5  -6  0 T  4  0 T 14  0" />
              <path d="M -16  7 Q -11  2  -6  7 T  4  7 T 14  7" />
            </g>
            <text x="105" y="316" className="n-label" textAnchor="middle">RED AC</text>
          </g>

          {/* N02 · RECTIFIER — estado real del Modbus INVT cuando existe */}
          <g className={nodeCls('rect')}>
            <title>{rectStatus
              ? `Rectificador — estado reportado por el UPS: ${rectStatus}`
              : 'Rectificador — este UPS no expone telemetría del rectificador'}</title>
            <Glass x={240} y={180} w={170} h={150} v="blue" />
            <text x="258" y="206" className="n-id">N02 · RECT</text>
            {rectStatus ? (
              <text x="325" y="244" className="n-val small" textAnchor="middle">{rectStatus.toUpperCase()}</text>
            ) : (
              <text x="325" y="240" className="n-val" textAnchor="middle">{has(values.dc_v_rect) ? values.dc_v_rect : '—'}</text>
            )}
            <text x="325" y="258" className="n-unit" textAnchor="middle">{rectStatus ? 'ESTADO' : 'SIN TELEMETRÍA'}</text>
            <g transform="translate(325,288)" className="n-icon">
              <rect x="-16" y="-16" width="32" height="32" rx="3" fill="none" />
              <line x1="-16" y1="16" x2="16" y2="-16" />
              <path d="M -13 -8 Q -10 -13 -7 -8 T -1 -8" fill="none" />
              <line x1="3" y1="7" x2="13" y2="7" strokeWidth="1.8" />
              <line x1="5" y1="11" x2="11" y2="11" strokeDasharray="2 1.6" />
            </g>
            <text x="325" y="316" className="n-label" textAnchor="middle">RECTIFICADOR</text>
          </g>

          {/* N03 · DC BUS — usa la tensión del banco de baterías (la medición
              real disponible del bus DC en estos UPS) */}
          <g className={nodeCls('dcbus')}>
            <title>{`Bus DC\n${has(values.dc_v) ? `Medición directa: ${values.dc_v} V` : `Tensión del banco de baterías: ${values.bat_v} V DC`}${has(values.bat_i) ? `\nCorriente batería: ${values.bat_i} A` : ''}`}</title>
            <Glass x={460} y={180} w={170} h={150} v="cyan" />
            <text x="478" y="206" className="n-id">N03 · DC BUS</text>
            <text x="545" y="240" className="n-val" textAnchor="middle">{dcBusVal}</text>
            <text x="545" y="258" className="n-unit" textAnchor="middle">{dcBusUnit}</text>
            <g transform="translate(545,290)">
              <line x1="-32" y1="-7" x2="32" y2="-7" stroke="rgba(34,225,255,0.95)" strokeWidth="2.4"
                    style={{ filter: 'drop-shadow(0 0 6px var(--cyan-glow))' }} />
              <line x1="-28" y1="0"  x2="28" y2="0"  stroke="rgba(34,225,255,0.55)" strokeWidth="1.6" strokeDasharray="3 2.5" />
              <line x1="-32" y1="7"  x2="32" y2="7"  stroke="rgba(34,225,255,0.95)" strokeWidth="2.4"
                    style={{ filter: 'drop-shadow(0 0 6px var(--cyan-glow))' }} />
            </g>
            <text x="545" y="316" className="n-label" textAnchor="middle">DC BUS · LINK</text>
          </g>

          {/* N04 · INVERTER */}
          <g className={nodeCls('inv')}>
            <title>{`Inversor\nSalida: ${values.v_out} V · ${values.freq_out} Hz${phaseMode === 'three' ? `\nL2: ${values.v_out_l2} V · L3: ${values.v_out_l3} V` : ''}`}</title>
            <Glass x={680} y={180} w={170} h={150} v="blue" />
            <text x="698" y="206" className="n-id">N04 · INV</text>
            <text x="765" y="240" className="n-val" textAnchor="middle">{values.v_out}</text>
            <text x="765" y="258" className="n-unit" textAnchor="middle">V · {values.freq_out} HZ</text>
            <g transform="translate(765,288)" className="n-icon">
              <rect x="-16" y="-16" width="32" height="32" rx="3" fill="none" />
              <line x1="-16" y1="16" x2="16" y2="-16" />
              <line x1="-12" y1="-8" x2="-2" y2="-8" strokeWidth="1.8" />
              <line x1="-10" y1="-12" x2="-4" y2="-12" strokeDasharray="2 1.6" />
              <path d="M 2 8 Q 4 4 7 8 T 13 8" fill="none" />
            </g>
            <text x="765" y="316" className="n-label" textAnchor="middle">INVERSOR</text>
          </g>

          {/* N05 · STATIC SWITCH / OUTPUT */}
          <g className={nodeCls('out')}>
            <title>{`Salida hacia la carga\nTensión: ${values.v_out} V · Corriente: ${values.i_out} A\nCarga: ${Math.round(loadPct)}%${m === 'bypass' ? '\n⚠ Alimentada por BYPASS (red directa, sin respaldo)' : ''}`}</title>
            <Glass x={900} y={180} w={170} h={150} v="blue" />
            <text x="918" y="206" className="n-id">N05 · OUT</text>
            <text x="985" y="240" className="n-val" textAnchor="middle">{values.v_out}</text>
            <text x="985" y="258" className="n-unit" textAnchor="middle">V · {values.i_out || '—'} A</text>
            {/* Load arc gauge inside */}
            <g transform="translate(985,294)">
              <circle cx="0" cy="0" r="22" className="arc-bg" />
              <circle cx="0" cy="0" r="22" className={"arc-fill " + loadArcCls}
                      strokeDasharray={arcLen} strokeDashoffset={arcOff} transform="rotate(-90)" />
              <text x="0" y="4" textAnchor="middle"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, fill: '#fff' }}>
                {Math.round(loadPct)}%
              </text>
            </g>
          </g>

          {/* N06 · LOAD */}
          <g className={nodeCls('load')}>
            <title>{`Carga conectada: ${Math.round(loadPct)}%\nPot. activa: ${values.load_kw} kW · aparente: ${values.load_kva} kVA${has(values.pf) ? `\nFactor de potencia: ${values.pf}` : ''}`}</title>
            <Glass x={1120} y={180} w={170} h={150} v="blue" />
            <text x="1138" y="206" className="n-id">N06 · LOAD</text>
            <text x="1205" y="240" className="n-val" textAnchor="middle">{values.load_kw || '—'}</text>
            <text x="1205" y="258" className="n-unit" textAnchor="middle">kW · {values.load_kva || '—'} kVA</text>
            <g transform="translate(1205,290)" className="n-icon">
              <rect x="-22" y="-16" width="44" height="11" rx="1.4" fill="none" strokeWidth="1.4"/>
              <rect x="-22" y="-3"  width="44" height="11" rx="1.4" fill="none" strokeWidth="1.4"/>
              <rect x="-22" y="10"  width="44" height="11" rx="1.4" fill="none" strokeWidth="1.4"/>
              {/* vent slits */}
              {[-14,-9,-4,1,6,11].map(x => (
                <g key={x}>
                  <line x1={x} y1="-13" x2={x} y2="-7" opacity="0.45" strokeWidth="0.6" />
                  <line x1={x} y1="0"   x2={x} y2="6"  opacity="0.45" strokeWidth="0.6" />
                  <line x1={x} y1="13"  x2={x} y2="19" opacity="0.45" strokeWidth="0.6" />
                </g>
              ))}
              <circle cx="17" cy="-10" r="1.6" fill="var(--ok)" stroke="none">
                <animate attributeName="opacity" values="1;0.3;1" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="17" cy="3"   r="1.6" fill="var(--ok)" stroke="none">
                <animate attributeName="opacity" values="0.3;1;0.3" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="17" cy="16"  r="1.6" fill="var(--ok)" stroke="none">
                <animate attributeName="opacity" values="1;0.3;1" dur="3.0s" repeatCount="indefinite" />
              </circle>
            </g>
            <text x="1205" y="316" className="n-label" textAnchor="middle">CARGA · {Math.round(loadPct)}%</text>
          </g>

          {/* N07 · BATTERY BANK (centered under DC BUS) */}
          <g className={nodeCls('batt')}>
            <title>{`Banco de baterías: ${Math.round(batPct)}%\nTensión: ${values.bat_v} V DC${has(values.bat_i) ? ` · Corriente: ${values.bat_i} A` : ''}${has(values.bat_temp) ? `\nTemperatura: ${values.bat_temp} °C` : ''}${has(values.runtime) ? `\nAutonomía: ${values.runtime}` : ''}${has(values.discharges) ? `\n${values.discharges_label || 'Descargas'}: ${values.discharges}` : ''}`}</title>
            <Glass x={445} y={370} w={200} h={150} v="green" />
            <text x="463" y="396" className="n-id">N07 · BATT BANK</text>
            <g transform="translate(545,432)">
              {[-1,0,1].map(i => (
                <g key={i} transform={`translate(${i*26},0)`}>
                  <rect x="-10" y="-14" width="20" height="28" rx="3"
                        fill="none" stroke="currentColor" strokeWidth="1.4"
                        className="n-icon-stroke" />
                  <rect x="-5" y="-17" width="10" height="3" rx="0.6"
                        fill="currentColor" stroke="none" className="n-icon-stroke" />
                  <rect x="-8" y={14 - (batPct/100)*26} width="16" height={(batPct/100)*26} rx="1"
                        fill="currentColor" opacity="0.55" stroke="none" className="n-icon-stroke"/>
                  <line x1="-3" y1="-10" x2="3" y2="-10" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
                  <line x1="0"  y1="-13" x2="0" y2="-7"  stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
                </g>
              ))}
            </g>
            <text x="545" y="478" className="n-val" textAnchor="middle"
                  style={{ fontSize: 22, fill: batPct <= 20 ? 'var(--err)' : batPct <= 50 ? 'var(--warn)' : 'var(--ok)' }}>
              {Math.round(batPct)}%
            </text>
            <rect x="475" y="487" width="140" height="6" rx="3"
                  fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.06)" />
            <rect x="475" y="487" width={(batPct/100)*140} height="6" rx="3"
                  className={"batt-fill " + batCls} />
            <text x="545" y="510" className="n-label" textAnchor="middle">
              {values.bat_v || '—'} V{has(values.bat_temp) ? ` · ${values.bat_temp}°C` : ''} · {values.runtime || '—'}
            </text>
          </g>
        </svg>
      </div>
    </section>
  );
}

window.UpsDiagram = UpsDiagram;
