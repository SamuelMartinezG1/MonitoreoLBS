// DiagnosticoApp.jsx — Centro de Diagnóstico de Red (todas las herramientas
// cableadas al backend real)
//
// Categorías:
//   CONECTIVIDAD     ping · port · traceroute · interfaces
//   SNMP             snmp-get · snmp-walk · snmp-autodetect · snmp-test
//   MODBUS           modbus-test
//   DESCUBRIMIENTO   ip-scan · snmp-mass-scan
//   RED              zerotier · ping-all-routers · network-health

const { useState: useStateD, useEffect: useEffectD, useRef: useRefD, useMemo: useMemoD } = React;

// ──────────────────────────────────────────────────────────────────────
// Catálogo de herramientas
// ──────────────────────────────────────────────────────────────────────
const TOOLS = {
  // Conectividad
  ping: {
    group: 'CONECTIVIDAD', label: 'Ping ICMP', icon: 'bi-broadcast-pin',
    desc: 'Verifica alcance ICMP a un host (4 paquetes).',
    fields: [{ name: 'ip', label: 'Host / IP', type: 'host', def: '' }],
    endpoint: 'ping',
    payload: v => ({ ip: v.ip }),
    parse: 'text',
  },
  port: {
    group: 'CONECTIVIDAD', label: 'Puerto TCP', icon: 'bi-door-closed',
    desc: 'Prueba si un puerto TCP está abierto.',
    fields: [
      { name: 'ip',   label: 'Host / IP',  type: 'host',   def: '' },
      { name: 'port', label: 'Puerto',     type: 'number', def: 161,
        suggest: [22, 80, 443, 161, 502, 5432, 5005, 3389, 8080] },
    ],
    endpoint: 'port',
    payload: v => ({ ip: v.ip, port: Number(v.port) }),
    parse: 'port',
  },
  route: {
    group: 'CONECTIVIDAD', label: 'Traceroute', icon: 'bi-diagram-2',
    desc: 'Lista saltos hasta el destino.',
    fields: [{ name: 'ip', label: 'Host / IP', type: 'host', def: '' }],
    endpoint: 'route',
    payload: v => ({ ip: v.ip }),
    parse: 'text',
  },
  interfaces: {
    group: 'CONECTIVIDAD', label: 'Interfaces del host', icon: 'bi-hdd-network',
    desc: 'Tabla de interfaces IP del contenedor portal.',
    fields: [],
    endpoint: 'interfaces',
    method: 'GET',
    parse: 'text',
  },

  // SNMP
  'snmp-get': {
    group: 'SNMP', label: 'SNMP Get', icon: 'bi-bullseye',
    desc: 'Lee un OID específico.',
    fields: [
      { name: 'ip',  label: 'Host / IP',  type: 'host', def: '' },
      { name: 'oid', label: 'OID', type: 'text',  def: '1.3.6.1.2.1.1.1.0',
        suggest: ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.33.1.2.4.0', '1.3.6.1.4.1.935.1.1.1.2.2.1.0'] },
      { name: 'community', label: 'Community', type: 'text',  def: 'public' },
      { name: 'version',   label: 'Versión',   type: 'select', def: 1,
        options: [{ v: 0, l: 'SNMPv1' }, { v: 1, l: 'SNMPv2c' }] },
    ],
    endpoint: 'snmp-get',
    payload: v => ({ ip: v.ip, oid: v.oid, community: v.community, version: Number(v.version) }),
    parse: 'snmpget',
  },
  'snmp-walk': {
    group: 'SNMP', label: 'SNMP Walk', icon: 'bi-list-columns',
    desc: 'Recorre una subrama OID (hasta 50 entradas).',
    fields: [
      { name: 'ip',  label: 'Host / IP',  type: 'host', def: '' },
      { name: 'oid', label: 'OID raíz', type: 'text', def: '1.3.6.1.2.1.1',
        suggest: ['1.3.6.1.2.1.1', '1.3.6.1.2.1.33', '1.3.6.1.4.1.935.1.1.1', '1.3.6.1.4.1.56788'] },
      { name: 'community', label: 'Community', type: 'text',   def: 'public' },
      { name: 'version',   label: 'Versión',   type: 'select', def: 1,
        options: [{ v: 0, l: 'SNMPv1' }, { v: 1, l: 'SNMPv2c' }] },
    ],
    endpoint: 'snmp-walk',
    payload: v => ({ ip: v.ip, oid: v.oid, community: v.community, version: Number(v.version) }),
    parse: 'snmpwalk',
  },
  'snmp-autodetect': {
    group: 'SNMP', label: 'Auto-detectar SNMP', icon: 'bi-magic',
    desc: 'Prueba versiones + communities, detecta tipo de UPS y lista OIDs disponibles.',
    fields: [{ name: 'ip', label: 'Host / IP', type: 'host', def: '' }],
    endpoint: 'snmp-autodetect',
    payload: v => ({ ip: v.ip }),
    parse: 'autodetect',
  },
  'snmp': {
    group: 'SNMP', label: 'Test rápido UPS', icon: 'bi-cpu',
    desc: 'Lee los OIDs base del cliente SNMP integrado (INVT/Megatec).',
    fields: [
      { name: 'ip',        label: 'Host / IP',    type: 'host',   def: '' },
      { name: 'community', label: 'Community',    type: 'text',   def: 'public' },
      { name: 'port',      label: 'Puerto SNMP',  type: 'number', def: 161 },
    ],
    endpoint: 'snmp',
    payload: v => ({ ip: v.ip, community: v.community, port: Number(v.port) }),
    parse: 'text',
  },

  // Modbus
  modbus: {
    group: 'MODBUS', label: 'Test Modbus TCP', icon: 'bi-plug',
    desc: 'Verifica conexión y lectura de un registro.',
    fields: [
      { name: 'ip',       label: 'Host / IP',  type: 'host',   def: '' },
      { name: 'port',     label: 'Puerto',     type: 'number', def: 502 },
      { name: 'slave_id', label: 'Slave ID',   type: 'number', def: 1 },
    ],
    endpoint: 'modbus',
    payload: v => ({ ip: v.ip, port: Number(v.port), slave_id: Number(v.slave_id) }),
    parse: 'text',
  },

  // Descubrimiento
  scan: {
    group: 'DESCUBRIMIENTO', label: 'Scan rango IP', icon: 'bi-radar',
    desc: 'Recorre IPs en una /24 buscando hosts ICMP/SNMP/Modbus.',
    fields: [
      { name: 'network', label: 'Red (3 octetos)', type: 'text',   def: '192.168.1' },
      { name: 'start',   label: 'Desde',          type: 'number', def: 1 },
      { name: 'end',     label: 'Hasta',          type: 'number', def: 50 },
    ],
    endpoint: 'scan',
    payload: v => ({ network: v.network, start: Number(v.start), end: Number(v.end) }),
    parse: 'scan',
  },
  'snmp-mass-scan': {
    group: 'DESCUBRIMIENTO', label: 'Scan SNMP masivo', icon: 'bi-search',
    desc: 'Encuentra dispositivos SNMP en un rango.',
    fields: [
      { name: 'network',   label: 'Red (3 octetos)', type: 'text',   def: '192.168.1' },
      { name: 'start',     label: 'Desde',          type: 'number', def: 1 },
      { name: 'end',       label: 'Hasta',          type: 'number', def: 50 },
      { name: 'community', label: 'Community',      type: 'text',   def: 'public' },
      { name: 'port',      label: 'Puerto',         type: 'number', def: 161 },
    ],
    endpoint: 'snmp-mass-scan',
    payload: v => ({ network: v.network, start: Number(v.start), end: Number(v.end),
                     community: v.community, port: Number(v.port) }),
    parse: 'snmpmass',
  },

  // ── ZeroTier (categoría dedicada con flujos operativos) ──
  'zt-status': {
    group: 'ZEROTIER', label: 'Estado del nodo', icon: 'bi-broadcast',
    desc: 'Info del nodo ZeroTier local (ID, versión, online).',
    fields: [],
    api: 'ztStatus',
    parse: 'zt-status',
  },
  'zt-networks': {
    group: 'ZEROTIER', label: 'Mis networks', icon: 'bi-diagram-3',
    desc: 'Lista de networks unidas (IDs, IPs asignadas, rutas) con opción de salir.',
    fields: [],
    api: 'ztNetworks',
    parse: 'zt-networks',
  },
  'zt-join': {
    group: 'ZEROTIER', label: 'Unirse a network', icon: 'bi-box-arrow-in-right',
    desc: 'Conecta el host a una network ZeroTier (16 hex). Recuerda autorizar el nodo en my.zerotier.com.',
    fields: [{ name: 'network_id', label: 'Network ID (16 hex)', type: 'text', def: '' }],
    api: 'ztJoin',
    payload: v => v.network_id,
    parse: 'zt-join',
  },
  'zt-peers': {
    group: 'ZEROTIER', label: 'Peers', icon: 'bi-people',
    desc: 'Otros nodos ZeroTier conocidos por este host (Teltonika, clientes, etc.).',
    fields: [],
    api: 'ztPeers',
    parse: 'zt-peers',
  },
  'zt-scan': {
    group: 'ZEROTIER', label: 'Escanear red ZT', icon: 'bi-radar',
    desc: 'Recorre la subred de una network (ICMP + SNMP) e identifica hosts.',
    fields: [
      { name: 'network_id', label: 'Network ID', type: 'text', def: '' },
      { name: 'community',  label: 'Community SNMP', type: 'text', def: 'public' },
    ],
    api: 'ztScanNet',
    payload: v => [v.network_id, v.community],
    parse: 'zt-scan',
  },
  'zt-find-teltonika': {
    group: 'ZEROTIER', label: 'Detectar Teltonika', icon: 'bi-router',
    desc: 'Localiza routers Teltonika (RUT955/956/etc.) en una network ZeroTier.',
    fields: [
      { name: 'network_id', label: 'Network ID', type: 'text', def: '' },
      { name: 'community',  label: 'Community SNMP', type: 'text', def: 'public' },
    ],
    api: 'ztFindTelt',
    payload: v => [v.network_id, v.community],
    parse: 'zt-find-teltonika',
  },
  'zt-scan-site': {
    group: 'ZEROTIER', label: 'Escanear LAN del sitio', icon: 'bi-geo-alt',
    desc: 'Recorre la subred LAN detrás del Teltonika de un sitio para descubrir UPS.',
    fields: [
      { name: 'sitio_id',  label: 'Sitio', type: 'site-select', def: '' },
      { name: 'community', label: 'Community SNMP', type: 'text', def: 'public' },
    ],
    api: 'ztScanSite',
    payload: v => [v.sitio_id, v.community],
    parse: 'zt-scan-site',
  },

  // Red overlay (legacy: zerotier-status simple del diagnostic)
  'zerotier-status': {
    group: 'RED', label: 'Estado ZeroTier (CLI)', icon: 'bi-globe2',
    desc: 'Info / networks / peers del cliente ZeroTier vía zerotier-cli del host.',
    fields: [],
    endpoint: 'zerotier-status',
    payload: () => ({}),
    parse: 'zerotier',
  },
  'ping-all-routers': {
    group: 'RED', label: 'Ping a todos los routers', icon: 'bi-router',
    desc: 'Ping a los routers de cada sitio (LAN + ZeroTier).',
    fields: [],
    endpoint: 'ping-all-routers',
    payload: () => ({}),
    parse: 'routers',
  },
  'network-health': {
    group: 'RED', label: 'Salud de red completa', icon: 'bi-heart-pulse',
    desc: 'Ping a routers + UPS (estado consolidado).',
    fields: [],
    endpoint: 'network-health',
    payload: () => ({}),
    parse: 'health',
  },
};

const GROUPS = ['CONECTIVIDAD', 'SNMP', 'MODBUS', 'DESCUBRIMIENTO', 'ZEROTIER', 'RED'];

// ──────────────────────────────────────────────────────────────────────
// Helpers de formato
// ──────────────────────────────────────────────────────────────────────
function nowTs() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0').slice(0, 3);
}

function tagFromMsg(msg) {
  const s = String(msg || '');
  if (/✅|success|✓|exitos|abierto|alive|ONLINE|received/i.test(s)) return 'ok';
  if (/⚠|warn|timeout|degradado/i.test(s)) return 'warn';
  if (/❌|error|fail|cerrado|FILTRADO|OFFLINE|unreachable|loss/i.test(s)) return 'err';
  if (/^\$\s|>>>|^→/.test(s)) return 'cmd';
  return '';
}

function textToLines(text) {
  if (!text) return [];
  return String(text).split('\n').map(line => ({
    msg: line,
    cls: tagFromMsg(line),
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Sub-componente: render estructurado de resultados
// ──────────────────────────────────────────────────────────────────────
function ResultsView({ parse, resp }) {
  if (!resp) return null;

  // Tabla de hosts encontrados (scan)
  if (parse === 'scan') {
    const hosts = resp.hosts || [];
    const alive = hosts.filter(h => (h.ports || []).length > 0 || h.alive);
    if (alive.length === 0) return null;
    return (
      <div className="diag-result-block">
        <h4>HOSTS DETECTADOS · {alive.length}/{hosts.length}</h4>
        <table className="diag-table">
          <thead><tr><th>IP</th><th>Puertos abiertos</th></tr></thead>
          <tbody>
            {alive.map(h => (
              <tr key={h.ip}>
                <td className="mono cyan">{h.ip}</td>
                <td>{(h.ports || []).map(p => <span key={p} className="diag-port-badge">{p}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // SNMP mass scan: dispositivos con sysDescr
  if (parse === 'snmpmass') {
    const ds = resp.dispositivos || [];
    if (!ds.length) return null;
    return (
      <div className="diag-result-block">
        <h4>DISPOSITIVOS SNMP · {resp.total_encontrados}/{resp.total_escaneados}</h4>
        <table className="diag-table">
          <thead><tr><th>IP</th><th>sysDescr</th></tr></thead>
          <tbody>
            {ds.map(d => (
              <tr key={d.ip}>
                <td className="mono cyan">{d.ip}</td>
                <td>{d.descripcion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // SNMP walk: OIDs + valores
  if (parse === 'snmpwalk') {
    const rs = resp.results || [];
    if (!rs.length) return null;
    return (
      <div className="diag-result-block">
        <h4>OIDs ENCONTRADOS · {resp.count}{resp.limit_reached ? ' (límite alcanzado)' : ''}</h4>
        <table className="diag-table">
          <thead><tr><th style={{width:'45%'}}>OID</th><th>Valor</th></tr></thead>
          <tbody>
            {rs.map((r, i) => (
              <tr key={i}>
                <td className="mono cyan">{r.oid}</td>
                <td className="mono">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // SNMP get
  if (parse === 'snmpget') {
    const rs = resp.results || [];
    if (!rs.length) return null;
    return (
      <div className="diag-result-block">
        <h4>VALORES</h4>
        <table className="diag-table">
          <thead><tr><th>OID</th><th>Tipo</th><th>Valor</th></tr></thead>
          <tbody>
            {rs.map((r, i) => (
              <tr key={i}>
                <td className="mono cyan">{r.oid}</td>
                <td className="mono dim">{r.type}</td>
                <td className="mono"><b>{r.value}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // SNMP autodetect: resumen + OIDs detectados
  if (parse === 'autodetect') {
    const c = resp.config || {};
    if (!c.success) return null;
    return (
      <div className="diag-result-block">
        <h4>CONFIGURACIÓN DETECTADA</h4>
        <div className="diag-kv-grid">
          <div><span>Versión SNMP</span><b>{c.version}</b></div>
          <div><span>Community</span><b className="cyan">{c.community}</b></div>
          <div><span>Tipo UPS</span><b>{c.ups_type || '—'}</b></div>
          <div><span>OIDs funcionando</span><b>{(c.oids_working || []).length}</b></div>
        </div>
        {c.device_info && Object.keys(c.device_info).length > 0 && (
          <details style={{marginTop:12}}>
            <summary style={{cursor:'pointer',fontSize:11,letterSpacing:'0.12em',color:'var(--text-dim)'}}>
              VER {Object.keys(c.device_info).length} ATRIBUTOS DETECTADOS
            </summary>
            <table className="diag-table" style={{marginTop:8}}>
              <tbody>
                {Object.entries(c.device_info).map(([k, v]) => (
                  <tr key={k}><td className="mono dim">{k}</td><td className="mono">{String(v).slice(0, 120)}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    );
  }

  // Ping a routers
  if (parse === 'routers') {
    const rs = resp.resultados || [];
    if (!rs.length) return null;
    return (
      <div className="diag-result-block">
        <h4>ROUTERS · {resp.online} online / {resp.offline} offline</h4>
        <table className="diag-table">
          <thead><tr><th>Sitio</th><th>Tipo</th><th>IP</th><th>Estado</th></tr></thead>
          <tbody>
            {rs.map((r, i) => (
              <tr key={i}>
                <td>{r.sitio}</td>
                <td className="dim">{r.tipo}</td>
                <td className="mono cyan">{r.ip}</td>
                <td><span className={"diag-pill " + (r.online ? 'ok' : 'err')}>{r.online ? 'ONLINE' : 'OFFLINE'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Salud de red
  if (parse === 'health') {
    const rs = resp.resultados || [];
    const res = resp.resumen || {};
    if (!rs.length) return null;
    return (
      <div className="diag-result-block">
        <h4>SALUD DE RED · {res.online} online · {res.degradado} degradado · {res.offline} offline (total {res.total})</h4>
        <table className="diag-table">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>IP</th><th>Ping</th><th>SNMP</th><th>Estado</th></tr></thead>
          <tbody>
            {rs.map((r, i) => (
              <tr key={i}>
                <td>{r.nombre}</td>
                <td className="dim">{r.tipo}</td>
                <td className="mono cyan">{r.ip}</td>
                <td>{r.ping ? <span className="diag-pill ok">{r.ping_ms || 0} ms</span> : <span className="diag-pill err">—</span>}</td>
                <td>{r.snmp === null ? <span className="dim">—</span> : r.snmp ? <span className="diag-pill ok">OK</span> : <span className="diag-pill err">NO</span>}</td>
                <td><span className={"diag-pill " + (r.estado === 'ONLINE' ? 'ok' : r.estado === 'DEGRADADO' ? 'warn' : 'err')}>{r.estado}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ZeroTier
  if (parse === 'zerotier') {
    if (!resp.disponible) return null;
    return (
      <div className="diag-result-block">
        <h4>ZEROTIER</h4>
        {resp.info && <pre className="diag-pre">{resp.info}</pre>}
        {resp.networks && (<>
          <h5>NETWORKS</h5>
          <pre className="diag-pre">{resp.networks}</pre>
        </>)}
        {resp.peers && (<>
          <h5>PEERS</h5>
          <pre className="diag-pre">{resp.peers.split('\n').slice(0, 20).join('\n')}{resp.peers.split('\n').length > 20 ? '\n…' : ''}</pre>
        </>)}
      </div>
    );
  }

  // Puerto
  if (parse === 'port' && resp.success) {
    return (
      <div className="diag-result-block">
        <div className="diag-kv-grid">
          <div><span>Puerto</span><b>{resp.port}</b></div>
          <div><span>Estado</span><b className={resp.open ? 'ok-text' : 'err-text'}>{resp.open ? 'ABIERTO' : 'CERRADO'}</b></div>
          <div><span>Latencia</span><b>{resp.elapsed_ms ? resp.elapsed_ms + ' ms' : '—'}</b></div>
        </div>
      </div>
    );
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────────────────
function DiagnosticoApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#00b4ff';
  useEffectD(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
  }, [accent]);

  // ── Datos en vivo desde DataLayer ──
  const [, setTick] = useStateD(0);
  useEffectD(() => {
    const fn = () => setTick(x => x + 1);
    window.addEventListener('lbs:data-refresh', fn);
    return () => window.removeEventListener('lbs:data-refresh', fn);
  }, []);

  const { DEVICES = [], SITES = [] } = window.MOCK || {};

  // Importar UPS detectado por scan-site-lan → abre modal pre-llenado
  const [importPrefill, setImportPrefill] = useStateD(null);
  useEffectD(() => {
    const onImport = (e) => setImportPrefill(e.detail || null);
    window.addEventListener('lbs:import-device', onImport);
    return () => window.removeEventListener('lbs:import-device', onImport);
  }, []);

  // Wizard ZT
  const [showWizard, setShowWizard] = useStateD(false);

  // ── Selección de herramienta ──
  const params = new URLSearchParams(window.location.search);
  const urlDev = params.get('dev');
  const [toolId, setToolId] = useStateD('ping');
  const tool = TOOLS[toolId];

  // Form values
  const initVals = useMemoD(() => {
    const obj = {};
    (tool.fields || []).forEach(f => { obj[f.name] = f.def !== undefined ? f.def : ''; });
    if (urlDev) {
      const d = DEVICES.find(x => String(x._raw_id || x.id) === String(urlDev));
      if (d && obj.ip !== undefined) obj.ip = d.ip;
    }
    return obj;
  }, [toolId]);
  const [vals, setVals] = useStateD(initVals);
  useEffectD(() => setVals(initVals), [toolId]);

  // Output (líneas) + estructurado
  const [output, setOutput] = useStateD([
    { ts: nowTs(), msg: '$ Centro de diagnóstico LBS · lista para operar', cls: 'cmd' },
    { ts: nowTs(), msg: 'Selecciona una herramienta en el panel izquierdo, ajusta parámetros y ejecuta.', cls: 'dim' },
  ]);
  const [structured, setStructured] = useStateD(null);
  const [running,    setRunning]    = useStateD(false);
  const [history,    setHistory]    = useStateD([]); // {tool, ts, ok, summary}

  const termRef = useRefD(null);
  useEffectD(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [output.length]);

  // ── Ejecutar ──
  const appendLines = (lines, baseCls) => {
    if (!lines.length) return;
    setOutput(prev => [...prev, ...lines.map(l => ({
      ts: nowTs(),
      msg: typeof l === 'string' ? l : l.msg,
      cls: typeof l === 'string' ? (baseCls || '') : (l.cls || baseCls || ''),
    }))]);
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    setStructured(null);
    setOutput(prev => [...prev,
      { ts: nowTs(), msg: '─── ' + tool.label + ' ───', cls: 'cmd' },
      { ts: nowTs(), msg: '$ ejecutando con ' + JSON.stringify(vals), cls: 'cmd' },
    ]);

    try {
      let resp;
      // Variante 1: tool tiene `api` → llamar a window.LBS_API.<api>(...)
      if (tool.api) {
        const args = tool.payload ? tool.payload(vals) : undefined;
        const fn = window.LBS_API[tool.api];
        if (!fn) throw new Error('API ' + tool.api + ' no disponible');
        if (Array.isArray(args))      resp = await fn(...args);
        else if (args !== undefined)  resp = await fn(args);
        else                          resp = await fn();
      } else {
        // Variante 2: tool del diagnostic clásico
        const url = tool.endpoint;
        const body = tool.payload ? tool.payload(vals) : {};
        if (tool.method === 'GET') {
          resp = await fetch(`/api/diagnostic/${url}`, { credentials: 'same-origin' }).then(r => r.json());
        } else {
          resp = await window.LBS_API.diag(url, body);
        }
      }

      const ok = resp.success !== false;
      // Texto plano si el endpoint lo trae
      if (resp.output) appendLines(textToLines(resp.output));
      if (resp.error) appendLines(['ERROR: ' + resp.error], 'err');
      // Estructurado
      setStructured({ parse: tool.parse, resp });
      // Resumen final
      appendLines([(ok ? '✓ ' : '✗ ') + tool.label + ' terminó'], ok ? 'ok' : 'warn');

      // Historial
      setHistory(prev => [{
        tool: toolId, label: tool.label,
        ts: new Date().toLocaleTimeString('es-MX', { hour12: false }),
        ok, summary: _summary(tool.parse, resp),
        vals: { ...vals },
      }, ...prev].slice(0, 20));
    } catch (e) {
      appendLines(['ERROR: ' + e.message], 'err');
    } finally {
      setRunning(false);
    }
  };

  const clear = () => {
    setOutput([{ ts: nowTs(), msg: '$ clear', cls: 'cmd' }]);
    setStructured(null);
  };

  const copyOutput = () => {
    const text = output.map(l => `[${l.ts}] ${l.msg}`).join('\n');
    navigator.clipboard.writeText(text).then(
      () => appendLines(['📋 Output copiado al portapapeles'], 'dim'),
      () => appendLines(['No se pudo copiar al portapapeles'], 'warn')
    );
  };

  const downloadOutput = () => {
    const text = output.map(l => `[${l.ts}] ${l.msg}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `diag-${toolId}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const ipSuggestions = useMemoD(
    () => Array.from(new Set(DEVICES.map(d => d.ip).filter(Boolean))).slice(0, 12),
    [DEVICES],
  );

  // ── Render ──
  return (
    <div className="app-grid">
      <Header page="diagnostico" crumbs={[{label:'Diagnóstico',bold:true}]} deviceName="" />
      <Sidebar activeId="" onSelect={() => { window.location.href = (window.LBS_URLS && window.LBS_URLS.monitoreo) || 'monitoreo.html'; }} />

      <main className="app-main">
        <div className="diag-grid">

          {/* ──── Panel izquierdo: herramientas ──── */}
          <aside className="diag-sidebar">
            <div className="diag-sb-head">
              <i className="bi bi-tools"></i> Herramientas
            </div>
            {GROUPS.map(g => (
              <div key={g} className="diag-sb-group">
                <div className="diag-sb-group-title">{g}</div>
                {Object.entries(TOOLS).filter(([_, c]) => c.group === g).map(([id, c]) => (
                  <button
                    key={id}
                    className={"diag-sb-tool" + (toolId === id ? ' active' : '')}
                    onClick={() => setToolId(id)}
                  >
                    <i className={"bi " + c.icon}></i>
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>

          {/* ──── Panel central: form + terminal + resultados ──── */}
          <section className="diag-main">

            {/* Cabecera */}
            <div className="diag-tool-head">
              <div>
                <h2><i className={"bi " + tool.icon}></i> {tool.label}</h2>
                <div className="dim">{tool.desc}</div>
              </div>
              <div className="diag-actions">
                {tool.group === 'ZEROTIER' && (
                  <button className="btn" onClick={() => setShowWizard(true)} title="Wizard bootstrap de sitio">
                    <i className="bi bi-magic"></i> Wizard sitio
                  </button>
                )}
                <button className="btn ghost" onClick={clear} disabled={running}>
                  <i className="bi bi-eraser"></i> Limpiar
                </button>
                <button className="btn ghost" onClick={copyOutput} title="Copiar al portapapeles">
                  <i className="bi bi-clipboard"></i>
                </button>
                <button className="btn ghost" onClick={downloadOutput} title="Descargar log">
                  <i className="bi bi-download"></i>
                </button>
                <button className="btn" onClick={run} disabled={running}>
                  {running
                    ? <><i className="bi bi-arrow-repeat spin"></i> Ejecutando…</>
                    : <><i className="bi bi-play-fill"></i> Ejecutar</>}
                </button>
              </div>
            </div>

            {/* Formulario */}
            {tool.fields && tool.fields.length > 0 && (
              <div className="diag-form">
                {tool.fields.map(f => (
                  <div key={f.name} className="diag-field">
                    <label>{f.label}</label>
                    {f.type === 'select' ? (
                      <select value={vals[f.name]} onChange={e => setVals(v => ({ ...v, [f.name]: e.target.value }))}>
                        {(f.options || []).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    ) : f.type === 'site-select' ? (
                      <select value={vals[f.name] || ''} onChange={e => setVals(v => ({ ...v, [f.name]: e.target.value }))}>
                        <option value="">— elegir sitio —</option>
                        {SITES.map(s => <option key={s._raw_id || s.id} value={s._raw_id || s.id}>{s.name} ({s.numero_sitio})</option>)}
                      </select>
                    ) : (
                      <input
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={vals[f.name] || ''}
                        onChange={e => setVals(v => ({ ...v, [f.name]: e.target.value }))}
                        placeholder={f.def != null ? String(f.def) : ''}
                        list={f.type === 'host' ? 'diag-ips' : (f.suggest ? `diag-${f.name}-list` : undefined)}
                      />
                    )}
                    {f.suggest && (
                      <datalist id={`diag-${f.name}-list`}>
                        {f.suggest.map(s => <option key={s} value={s} />)}
                      </datalist>
                    )}
                  </div>
                ))}
                <datalist id="diag-ips">
                  {ipSuggestions.map(ip => <option key={ip} value={ip} />)}
                </datalist>
              </div>
            )}

            {/* Terminal */}
            <div className="diag-terminal" ref={termRef}>
              {output.map((l, i) => (
                <div key={i} className={"diag-line " + (l.cls || '')}>
                  <span className="ts">{l.ts}</span>
                  <span className="msg">{l.msg}</span>
                </div>
              ))}
            </div>

            {/* Resultados estructurados */}
            <ResultsView parse={structured && structured.parse} resp={structured && structured.resp} />

            {/* Panel especializado de ZeroTier */}
            {structured && typeof structured.parse === 'string' && structured.parse.startsWith('zt-') && window.ZeroTierPanel && (
              <window.ZeroTierPanel
                subtool={structured.parse.replace('zt-', '')}
                vals={vals}
                setVals={setVals}
                run={run}
                lastResp={structured.resp}
                sitios={SITES}
              />
            )}
          </section>

          {/* ──── Panel derecho: contexto + historial ──── */}
          <aside className="diag-right">
            <div className="diag-ctx">
              <h3><i className="bi bi-broadcast"></i> Flota</h3>
              <div className="diag-ctx-row"><span>UPS totales</span><b>{DEVICES.length}</b></div>
              <div className="diag-ctx-row"><span>En línea</span><b className="ok-text">{DEVICES.filter(d => d.status === 'ok').length}</b></div>
              <div className="diag-ctx-row"><span>Con alarma</span><b className="warn-text">{DEVICES.filter(d => d.status === 'warn').length}</b></div>
              <div className="diag-ctx-row"><span>Offline</span><b className="err-text">{DEVICES.filter(d => d.status === 'off').length}</b></div>
            </div>

            <div className="diag-ctx">
              <h3><i className="bi bi-bookmark-star"></i> Atajos por UPS</h3>
              <div className="diag-shortcuts">
                {DEVICES.slice(0, 10).map(d => (
                  <button key={d.id} className="diag-shortcut" onClick={() => {
                    setVals(v => ({ ...v, ip: d.ip }));
                  }}>
                    <span className={"led " + d.status}></span>
                    <div>
                      <div className="name">{d.name}</div>
                      <div className="ip">{d.ip}</div>
                    </div>
                  </button>
                ))}
                {DEVICES.length === 0 && <div className="dim">Sin UPS registrados</div>}
              </div>
            </div>

            <div className="diag-ctx">
              <h3><i className="bi bi-clock-history"></i> Historial</h3>
              {history.length === 0 && <div className="dim">— Sin ejecuciones aún —</div>}
              <div className="diag-history">
                {history.map((h, i) => (
                  <div key={i} className={"diag-hist-row " + (h.ok ? 'ok' : 'err')}>
                    <span className="ts">{h.ts}</span>
                    <button className="lbl" onClick={() => { setToolId(h.tool); setVals(h.vals); }} title="Repetir">
                      {h.label}
                    </button>
                    <span className="sum dim">{h.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Tema">
          <TweakColor label="Acento" value={t.accent} onChange={v => setTweak('accent', v)}
            options={['#00b4ff', '#22e1ff', '#ff3df0', '#25f4a7', '#ffb000']} />
        </TweakSection>
      </TweaksPanel>

      {importPrefill && typeof window.AddDeviceModal === 'function' && (
        <window.AddDeviceModal
          sitios={SITES}
          prefill={importPrefill}
          onClose={() => setImportPrefill(null)}
          onSaved={() => {
            setImportPrefill(null);
            window.LBS_DATA && window.LBS_DATA.refresh();
            window.LBS_TOAST && window.LBS_TOAST.success('UPS importado a la flota');
            appendLines(['✓ UPS importado a la flota'], 'ok');
          }}
        />
      )}
      {showWizard && typeof window.ZTWizard === 'function' && (
        <window.ZTWizard
          onClose={() => setShowWizard(false)}
          onFinished={() => {
            window.LBS_DATA && window.LBS_DATA.refresh();
            window.LBS_TOAST && window.LBS_TOAST.success('Bootstrap completado');
          }}
        />
      )}
    </div>
  );
}

function _summary(parse, resp) {
  if (!resp) return '';
  if (parse === 'scan')     return `${(resp.hosts||[]).filter(h => (h.ports||[]).length).length} hosts`;
  if (parse === 'snmpmass') return `${resp.total_encontrados||0} encontrados`;
  if (parse === 'snmpwalk') return `${(resp.results||[]).length} OIDs`;
  if (parse === 'autodetect') return resp.config && resp.config.success ? `${resp.config.version} · ${resp.config.community}` : 'sin respuesta';
  if (parse === 'routers')  return `${resp.online||0} OK / ${resp.offline||0} OFF`;
  if (parse === 'health')   return resp.resumen ? `${resp.resumen.online} OK · ${resp.resumen.offline} OFF` : '';
  if (parse === 'port')     return resp.open ? 'abierto' : 'cerrado';
  if (parse === 'zerotier') return resp.disponible ? 'conectado' : 'no instalado';
  return resp.success === false ? 'fallo' : 'ok';
}

ReactDOM.createRoot(document.getElementById('root')).render(<DiagnosticoApp />);
