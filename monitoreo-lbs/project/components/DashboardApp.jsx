// DashboardApp.jsx — Fleet overview (Tablero global)

const { useState: useStateD, useEffect: useEffectD, useMemo: useMemoD } = React;

function FleetHero({ sites, devices, alarms }) {
  const total   = devices.length;
  const online  = devices.filter(d => d.status === 'ok').length;
  const warn    = devices.filter(d => d.status === 'warn').length;
  const off     = devices.filter(d => d.status === 'off').length;
  const totalKw = devices.reduce((s,d) => s + (d.kva * (d.load/100) * 0.9), 0).toFixed(1);
  const critAlarms = alarms.filter(a => a.lvl === 'err' || a.lvl === 'warn').length;
  return (
    <section className="fleet-hero">
      <div className="fh-title">
        <h1>Tablero · SCADA UPS</h1>
        <div className="sub">FLOTA NACIONAL · {sites.length} SITIOS · {total} EQUIPOS · POLL 2s</div>
      </div>
      <div className="fh-stat ok">
        <label>UPS En línea</label>
        <div className="v">{online}<small>/{total}</small></div>
        <div className="delta up">▲ 100% disponibilidad 24h</div>
      </div>
      <div className={"fh-stat " + (warn ? 'warn' : 'ok')}>
        <label>Alarmas activas</label>
        <div className="v">{critAlarms}</div>
        <div className="delta">{warn} warn · {off} offline</div>
      </div>
      <div className="fh-stat">
        <label>Carga total</label>
        <div className="v">{totalKw}<small>kW</small></div>
        <div className="delta">62% capacidad</div>
      </div>
      <div className="fh-stat">
        <label>Sitios activos</label>
        <div className="v">{sites.length}</div>
        <div className="delta">3 regiones · MX</div>
      </div>
      <div className="fh-stat ok">
        <label>Autonomía mín.</label>
        <div className="v">38<small>min</small></div>
        <div className="delta">MTY-03 · @ carga actual</div>
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
        <a href={"inventario.html?site=" + site.id}>VER EQUIPOS <i className="bi bi-arrow-right"></i></a>
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
        return (
          <div key={d.id} className="top-row">
            <span className="rank">#{i+1}</span>
            <span className="name">{d.name}<small>{d.model} · {d.ip}</small></span>
            <span className={"v " + cls}>{d.load}<small>%</small></span>
            <span className="bar"><i className={cls} style={{ width: d.load + '%' }}></i></span>
            <a href="monitoreo.html"><i className="bi bi-graph-up"></i> ABRIR</a>
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

  const { SITES, DEVICES, ALARMS } = window.MOCK;

  return (
    <div className="app-grid">
      <Header page="dashboard" crumbs={[{label:'Tablero',bold:true}]} deviceName="" />
      <Sidebar activeId="u01" onSelect={() => { window.location.href = 'monitoreo.html'; }} />

      <main className="app-main">
        <div className="page-grid">
          <FleetHero sites={SITES} devices={DEVICES} alarms={ALARMS} />

          <div className="sites-grid">
            {SITES.map(s => <SiteCard key={s.id} site={s} devices={DEVICES} />)}
          </div>

          <div className="panels-row" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
            <section className="eng-panel">
              <div className="eng-head">
                <h3><i className="bi bi-bar-chart-line ico"></i> Equipos con mayor carga</h3>
                <span className="live-badge"><span className="dot"></span> LIVE</span>
              </div>
              <div className="eng-body">
                <TopLoadList devices={DEVICES} />
              </div>
            </section>

            <section className="eng-panel">
              <div className="eng-head">
                <h3><i className="bi bi-bell-fill ico"></i> Eventos recientes</h3>
                <span className="live-badge" style={{ color: 'var(--warn)' }}>{ALARMS.filter(a=>a.lvl!=='info').length} ACTIVAS</span>
              </div>
              <div className="eng-body" style={{ paddingTop: 10 }}>
                <div className="feed">
                  {ALARMS.map((a,i) => <FeedRow key={i} ts={a.ts} lvl={a.lvl} dev={a.dev} msg={{title:a.title,detail:a.detail}} />)}
                </div>
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
