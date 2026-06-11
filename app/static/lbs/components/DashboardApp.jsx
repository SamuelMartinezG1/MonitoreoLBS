// DashboardApp.jsx — Fleet overview (Tablero global)

const { useState: useStateD, useEffect: useEffectD, useMemo: useMemoD, useRef: useRefD } = React;

// Hook: anima un número desde 0 hasta `target` durante `duration` ms.
function useCountUp(target, duration = 700) {
  const [v, setV] = useStateD(0);
  const startRef = useRefD(null);
  const fromRef  = useRefD(0);
  useEffectD(() => {
    const numeric = Number(target) || 0;
    fromRef.current = v;
    startRef.current = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setV(fromRef.current + (numeric - fromRef.current) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [target, duration]);
  return v;
}

function AnimatedNumber({ value, decimals = 0, suffix }) {
  const v = useCountUp(value);
  return <>{v.toFixed(decimals)}{suffix}</>;
}

function FleetHero({ sites, devices, alarms }) {
  const total   = devices.length;
  const online  = devices.filter(d => d.status === 'ok').length;
  const warn    = devices.filter(d => d.status === 'warn').length;
  const off     = devices.filter(d => d.status === 'off').length;
  const totalKw = devices.reduce((s, d) => s + ((d.kva || 0) * ((d.load || 0)/100) * 0.9), 0);
  const totalKvaCap = devices.reduce((s, d) => s + (d.kva || 0), 0);
  const critAlarms = alarms.filter(a => a.lvl === 'err' || a.lvl === 'warn').length;
  const availPct = total > 0 ? Math.round((online / total) * 100) : 0;
  const capPct   = totalKvaCap > 0 ? Math.round((totalKw / totalKvaCap) * 100) : 0;

  // Autonomía mín: la REAL reportada por los UPS (no estimada). Si ningún
  // equipo reporta autonomía (p.ej. en línea sin descarga) se muestra «—».
  const withRuntime = devices.filter(d => d.status !== 'off' && (d.runtime_min || 0) > 0);
  const worst = withRuntime.length
    ? withRuntime.reduce((a, b) => (a.runtime_min < b.runtime_min) ? a : b)
    : null;
  const minRuntime = worst ? `${Math.round(worst.runtime_min)}m` : '—';

  // Regiones únicas (a partir de las subredes lan)
  const regions = new Set(sites.map(s => s.region).filter(r => r && r !== '—'));

  return (
    <section className="fleet-hero">
      <div className="fh-title">
        <h1>Tablero · SCADA UPS</h1>
        <div className="sub">
          {total === 0 && sites.length === 0
            ? <>FLOTA VACÍA · COMIENZA AGREGANDO UN SITIO Y UN UPS</>
            : <>FLOTA · {sites.length} {sites.length === 1 ? 'SITIO' : 'SITIOS'} · {total} {total === 1 ? 'EQUIPO' : 'EQUIPOS'} · {regions.size || 1} REGIÓN(ES)</>
          }
        </div>
      </div>
      <div className={"fh-stat " + (total === 0 ? '' : online === total ? 'ok' : 'warn')}>
        <label>UPS En línea</label>
        <div className="v"><AnimatedNumber value={online}/><small>/{total}</small></div>
        <div className="delta">
          {total > 0
            ? <>{availPct === 100 ? '▲' : '●'} {availPct}% disponibilidad</>
            : <>sin UPS registrados</>}
        </div>
      </div>
      <div className={"fh-stat " + (critAlarms ? 'warn' : 'ok')}>
        <label>Alarmas activas</label>
        <div className="v"><AnimatedNumber value={critAlarms}/></div>
        <div className="delta">{warn} warn · {off} offline</div>
      </div>
      <div className="fh-stat">
        <label>Carga total</label>
        {/* Sin kVA nominal capturado no se puede estimar kW: «—» en vez de un 0 falso */}
        <div className="v">{totalKvaCap > 0
          ? <><AnimatedNumber value={totalKw} decimals={1}/><small>kW</small></>
          : <>—</>}</div>
        <div className="delta">{totalKvaCap > 0 ? <>{capPct}% de {totalKvaCap.toFixed(0)} kVA</> : <>sin capacidad nominal cargada</>}</div>
      </div>
      <div className="fh-stat">
        <label>Sitios activos</label>
        <div className="v"><AnimatedNumber value={sites.length}/></div>
        <div className="delta">{regions.size ? <>{regions.size} región(es)</> : <>—</>}</div>
      </div>
      <div className={"fh-stat " + (worst && worst.bat < 30 ? 'warn' : '')}>
        <label>Autonomía mín.</label>
        <div className="v">{minRuntime}</div>
        <div className="delta">{worst ? <>{worst.name} · {worst.bat}% bat</> : <>—</>}</div>
      </div>
    </section>
  );
}

function SiteCard({ site, devices }) {
  const siteDevs = devices.filter(d => d.site === site.id);
  const loadPct  = Math.round(site.load_kw / site.cap_kw * 100);
  const cls = site.status === 'err' ? 'err' : site.status === 'warn' ? 'warn' : '';
  const barCls = loadPct > 90 ? 'err' : loadPct > 70 ? 'warn' : '';
  return (
    <article className={"site-card " + cls}>
      <div className="site-head">
        <div>
          <h3>{site.name}</h3>
          <div className="loc"><i className="bi bi-geo-alt-fill"></i> {site.addr} · {site.region}</div>
        </div>
        <span className={"site-pill " + cls}>
          <span className="dot"></span>
          {site.alarms ? `${site.alarms} ALARMA${site.alarms > 1 ? 'S' : ''}` : 'OPERATIVO'}
        </span>
      </div>
      <div className="site-stats">
        <div className="site-stat">
          <label>UPS</label>
          <div className="v">{site.online}<small>/{site.ups_total}</small></div>
        </div>
        <div className="site-stat">
          <label>Carga</label>
          <div className="v">{site.load_kw}<small>kW</small></div>
        </div>
        <div className="site-stat">
          <label>Autonomía</label>
          <div className="v">{site.runtime}</div>
        </div>
      </div>
      <div className="site-bar-wrap">
        <div className="lab"><span>Capacidad usada</span><span>{loadPct}% · {site.cap_kw} kVA</span></div>
        <div className="site-bar"><div className={"fill " + barCls} style={{ width: loadPct + '%' }}></div></div>
      </div>
      <div className="site-foot">
        <div className="ups-strip">
          {site.leds.map((l,i) => <span key={i} className={"led " + l} title={siteDevs[i]?.name}></span>)}
        </div>
        <a href={((window.LBS_URLS && window.LBS_URLS.inventario) || "inventario.html") + "?site=" + site.id}>VER EQUIPOS <i className="bi bi-arrow-right"></i></a>
      </div>
    </article>
  );
}

function FeedRow({ ts, lvl, dev, msg }) {
  const icon = lvl === 'err' ? 'exclamation-triangle-fill' : lvl === 'warn' ? 'exclamation-circle' : 'info-circle';
  return (
    <div className={"feed-row " + lvl}>
      <i className={"bi bi-" + icon}></i>
      <span className="ts">{ts}</span>
      <span className="msg"><b>{msg.title}</b> <span>· {msg.detail}</span></span>
      <span className="dev">{dev}</span>
    </div>
  );
}

function TopLoadList({ devices }) {
  const sorted = [...devices].filter(d => d.status !== 'off').sort((a,b) => b.load - a.load).slice(0,6);
  return (
    <div className="top-list">
      {sorted.map((d,i) => {
        const cls = d.load > 90 ? 'err' : d.load > 75 ? 'warn' : '';
        const alarma = (d.alarmas_activas || [])[0];
        const monUrl = ((window.LBS_URLS && window.LBS_URLS.monitoreo) || "monitoreo.html")
                     + '?dev=' + (d._raw_id || d.id);
        return (
          <div key={d.id} className="top-row">
            <span className="rank">#{i+1}</span>
            <span className="name">
              {d.name}
              {alarma && (
                <i className="bi bi-exclamation-triangle-fill"
                   style={{ color: alarma.level === 'critical' ? 'var(--err)' : 'var(--warn)', marginLeft: 6 }}
                   title={`${alarma.code}: ${alarma.msg || ''}`}></i>
              )}
              <small>{d.model} · {d.ip}{d.temp > 0 ? ` · ${d.temp.toFixed(0)}°C` : ''} · bat {d.bat}%</small>
            </span>
            <span className={"v " + cls}>{d.load}<small>%</small></span>
            <span className="bar"><i className={cls} style={{ width: d.load + '%' }}></i></span>
            <a href={monUrl}><i className="bi bi-graph-up"></i> ABRIR</a>
          </div>
        );
      })}
    </div>
  );
}

function DashboardApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#00b4ff';
  useEffectD(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
  }, [accent]);

  // ── Datos en vivo desde DataLayer (escucha refresh y re-renderiza) ──
  const [, setTick] = useStateD(0);
  useEffectD(() => {
    const onRefresh = () => setTick(x => x + 1);
    window.addEventListener('lbs:data-refresh', onRefresh);
    return () => window.removeEventListener('lbs:data-refresh', onRefresh);
  }, []);

  const { SITES, DEVICES, ALARMS } = window.MOCK;

  return (
    <div className="app-grid">
      <Header page="dashboard" crumbs={[{label:'Tablero',bold:true}]} deviceName="" />
      <Sidebar activeId="u01" onSelect={() => { window.location.href = (window.LBS_URLS && window.LBS_URLS.monitoreo) || 'monitoreo.html'; }} />

      <main className="app-main">
        <div className="page-grid">
          <FleetHero sites={SITES} devices={DEVICES} alarms={ALARMS} />

          {SITES.length === 0 ? (
            <div className="lbs-empty lbs-empty-big">
              <i className="bi bi-geo-alt"></i>
              <h4>Aún no hay sitios registrados</h4>
              <p>Crea el primer sitio desde Inventario o usa el wizard de
              ZeroTier en Diagnóstico para hacer el bootstrap completo
              (join + escaneo + alta automática de UPS).</p>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', justifyContent:'center' }}>
                <a className="btn" href={(window.LBS_URLS && window.LBS_URLS.inventario) || '/inventario'}>
                  <i className="bi bi-plus-circle"></i> Ir a Inventario
                </a>
                <a className="btn ghost" href={(window.LBS_URLS && window.LBS_URLS.diagnostico) || '/diagnostico'}>
                  <i className="bi bi-magic"></i> Wizard ZeroTier
                </a>
              </div>
            </div>
          ) : (
            <div className="sites-grid">
              {SITES.map(s => <SiteCard key={s.id} site={s} devices={DEVICES} />)}
            </div>
          )}

          <div className="panels-row" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
            <section className="eng-panel">
              <div className="eng-head">
                <h3><i className="bi bi-bar-chart-line ico"></i> Equipos con mayor carga</h3>
                {DEVICES.length > 0 && <span className="live-badge"><span className="dot"></span> LIVE</span>}
              </div>
              <div className="eng-body">
                {DEVICES.length > 0
                  ? <TopLoadList devices={DEVICES} />
                  : <div className="lbs-empty-mini">
                      <i className="bi bi-bar-chart"></i>
                      <span>Sin equipos para mostrar.</span>
                    </div>
                }
              </div>
            </section>

            <section className="eng-panel">
              <div className="eng-head">
                <h3><i className="bi bi-bell-fill ico"></i> Eventos recientes</h3>
                {ALARMS.length > 0 && (
                  <span className="live-badge" style={{ color: 'var(--warn)' }}>
                    {ALARMS.filter(a=>a.lvl!=='info').length} ACTIVAS
                  </span>
                )}
              </div>
              <div className="eng-body" style={{ paddingTop: 10 }}>
                {ALARMS.length > 0 ? (
                  <div className="feed">
                    {ALARMS.map((a,i) => <FeedRow key={i} ts={a.ts} lvl={a.lvl} dev={a.dev} msg={{title:a.title,detail:a.detail}} />)}
                  </div>
                ) : (
                  <div className="lbs-empty-mini">
                    <i className="bi bi-check-circle"></i>
                    <span>Todo en orden — sin alarmas activas.</span>
                  </div>
                )}
              </div>
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

ReactDOM.createRoot(document.getElementById('root')).render(<DashboardApp />);
