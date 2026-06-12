// MockData.jsx — capa de datos REAL (alias mantenido por compatibilidad).
//
// Antes contenía fixtures sintéticos en `window.MOCK`. Ahora popula el mismo
// shape pero consultando la API real:
//
//   /api/inventario/topologia → SITES + DEVICES (mapeados)
//   /api/monitoreo/list       → DEVICES con telemetría (cuando aplica)
//
// Conserva `window.MOCK = { SITES, DEVICES, ALARMS }` para no romper a los
// componentes existentes (DashboardApp, InventarioApp, DiagnosticoApp). Las
// ALARMS se derivan en cliente desde los UPS con `status != 'ok'`.
//
// Exporta también `window.LBS_API` con helpers de CRUD para los modals.

(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────
  // Estado por defecto (mientras carga la primera respuesta)
  // ──────────────────────────────────────────────────────────────────────
  window.MOCK = {
    SITES: [],
    DEVICES: [],
    ALARMS: [],
    _loaded: false,
    _error: null,
  };

  // ──────────────────────────────────────────────────────────────────────
  // Helpers HTTP
  // ──────────────────────────────────────────────────────────────────────
  async function _json(method, url, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    let data = null;
    try { data = await resp.json(); } catch (_) { /* sin cuerpo */ }
    if (!resp.ok) {
      const err = new Error((data && data.error) || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.LBS_API = {
    // ── Topología / inventario ─────────────────────────────────────────
    getTopologia:        ()           => _json('GET',    '/api/inventario/topologia'),
    getSitios:           ()           => _json('GET',    '/api/inventario/sitios'),
    addSitio:            (data)       => _json('POST',   '/api/inventario/sitios', data),
    updateSitio:         (id, data)   => _json('PUT',    `/api/inventario/sitios/${id}`, data),
    deleteSitio:         (id)         => _json('DELETE', `/api/inventario/sitios/${id}`),
    assignDeviceToSitio: (devId, sId) => _json('PUT',    `/api/inventario/dispositivos/${devId}/sitio`, { sitio_id: sId }),
    updateDeviceNotes:   (devId, txt) => _json('PUT',    `/api/inventario/dispositivos/${devId}/notas`, { notas_tecnicas: txt }),

    // ── Dispositivos ───────────────────────────────────────────────────
    listDevices:    ()        => _json('GET',    '/api/monitoreo/list'),
    addDevice:      (data)    => _json('POST',   '/api/monitoreo/add', data),
    deleteDevice:   (id)      => _json('DELETE', `/api/monitoreo/delete/${id}`),
    autosetScan:    (ip)      => _json('POST',   '/api/autoset/scan', { ip }),

    // ── Telemetría / historial / analytics ─────────────────────────────
    getUltimoEstado:   (id)              => _json('GET', `/api/monitoreo/ultimo-estado/${id}`),
    getEstadoFlota:    ()                => _json('GET', '/api/monitoreo/estado-flota'),
    controlUps:        (id, action, params) => _json('POST', `/api/monitoreo/${id}/control`, { action, params }),
    getTelemetria:     (id, mins = 10)   => _json('GET', `/api/telemetry/recent/${id}?minutes=${mins}`),
    getHistorial:      (id, horas = 6)   => _json('GET', `/api/ups-history/${id}?horas=${horas}`),
    getCalidadEnergia: (id, horas = 24)  => _json('GET', `/api/monitoreo/calidad-energia/${id}?horas=${horas}`),
    getPerfilHorario:  (id, horas = 24)  => _json('GET', `/api/monitoreo/perfil-horario/${id}?horas=${horas}`),
    getHistoricoStats: ()                => _json('GET', '/api/monitoreo/historico-stats'),
    getDatos:          (id, horas, campo) => {
      const q = new URLSearchParams({ device_id: id, horas: horas || 6 });
      if (campo) q.set('campo', campo);
      return _json('GET', `/api/datos/historico?${q}`);
    },

    // ── Grabaciones ────────────────────────────────────────────────────
    recStart:  (devId, nombre) => _json('POST',   '/api/recording/start', { device_id: devId, nombre }),
    recStop:   (recId)         => _json('POST',   `/api/recording/stop/${recId}`),
    recList:   (devId)         => _json('GET',    devId ? `/api/recording/list?device_id=${devId}` : '/api/recording/list'),
    recDelete: (recId)         => _json('DELETE', `/api/recording/${recId}`),
    recData:   (recId)         => _json('GET',    `/api/recording/data/${recId}`),

    // ── Banco SNMP / OID profiles ──────────────────────────────────────
    testConn:       (data) => _json('POST', '/api/inventario/test-connection', data),
    snmpWalk:       (data) => _json('POST', '/api/inventario/snmp-walk', data),
    snmpOidTest:    (data) => _json('POST', '/api/inventario/oid-test', data),
    saveOidProfile: (data) => _json('POST', '/api/inventario/save-oid-profile', data),
    getOidProfile:  (id)   => _json('GET',  `/api/inventario/oid-profile/${id}`),

    // ── Diagnóstico ────────────────────────────────────────────────────
    diag: (tool, params) => _json('POST', `/api/diagnostic/${tool}`, params || {}),

    // ── ZeroTier ───────────────────────────────────────────────────────
    ztHealth:    ()                => _json('GET',  '/api/zerotier/health'),
    ztStatus:    ()                => _json('GET',  '/api/zerotier/status'),
    ztNetworks:  ()                => _json('GET',  '/api/zerotier/networks'),
    ztPeers:     ()                => _json('GET',  '/api/zerotier/peers'),
    ztJoin:      (nid)             => _json('POST', '/api/zerotier/join',  { network_id: nid }),
    ztLeave:     (nid)             => _json('POST', '/api/zerotier/leave', { network_id: nid }),
    ztScanNet:   (nid, community)  => _json('POST', '/api/zerotier/scan-network',
                                              { network_id: nid, community: community || 'public' }),
    ztFindTelt:  (nid, community)  => _json('POST', '/api/zerotier/discover-teltonika',
                                              { network_id: nid, community: community || 'public' }),
    ztScanSite:  (sitioId, community) => _json('POST', '/api/zerotier/scan-site-lan',
                                              { sitio_id: Number(sitioId), community: community || 'public' }),

    // ── Cuenta ─────────────────────────────────────────────────────────
    me:             ()              => _json('GET',  '/api/account/me'),
    changePassword: (oldp, newp)    => _json('POST', '/api/account/change-password',
                                             { old_password: oldp, new_password: newp }),

    // ── Admin: gestión de usuarios ─────────────────────────────────────
    usersList:        ()             => _json('GET',    '/api/users'),
    usersSections:    ()             => _json('GET',    '/api/users/sections'),
    usersCreate:      (data)         => _json('POST',   '/api/users', data),
    usersUpdate:      (id, data)     => _json('PUT',    `/api/users/${id}`, data),
    usersSetPassword: (id, newPwd)   => _json('POST',   `/api/users/${id}/password`, { new_password: newPwd }),
    usersDelete:      (id)           => _json('DELETE', `/api/users/${id}`),

    // ── ZeroTier wizard ────────────────────────────────────────────────
    ztBootstrap: (data) => _json('POST', '/api/zerotier/bootstrap-site', data),

    // ── CSV / export ───────────────────────────────────────────────────
    recordingCsvUrl: (recId) => `/api/recording/${recId}/csv`,
  };

  // ──────────────────────────────────────────────────────────────────────
  // Mapeo BD → shape del MockData
  // ──────────────────────────────────────────────────────────────────────
  function _statusFromDevice(d) {
    if (!d.activo) return 'off';
    // Estado de conexión CONFIRMADO por el backend (tracker con histéresis).
    const f = d._flota;
    if (f && f.connection) {
      const conn = f.connection;
      if (conn.status === 'offline' || conn.status === 'unknown') return 'off';
      if ((f.alarmas_activas || []).length) return 'warn';
      if (conn.link_quality === 'degraded') return 'warn';
      return 'ok';
    }
    // Fallback heurístico (estado-flota no disponible)
    const last = d._last || {};
    const carga = last.carga_pct;
    const bat = last.bateria_pct;
    if ((bat !== undefined && bat > 0 && bat < 50) || (carga !== undefined && carga > 85)) return 'warn';
    return 'ok';
  }

  function _slugify(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function _mapDevice(d) {
    const last = d._last || {};
    const siteSlug = d.sitio_nombre ? _slugify(d.sitio_nombre) : 'sin-sitio';
    return {
      id:      d.id,
      _raw_id: d.id,
      site:    siteSlug,
      sitio_id: d.sitio_id,
      name:    d.nombre || `UPS-${d.id}`,
      ip:      d.ip,
      model:   d.ups_type || '—',
      kva:     d.kva || 0,
      v_in:    Number(last.voltaje_in_l1 || 0),
      v_out:   Number(last.voltaje_out_l1 || 0),
      load:    Number(last.carga_pct || 0),
      bat:     Number(last.bateria_pct || 0),
      temp:    Number(last.temperatura || 0),
      status:  _statusFromDevice(d),
      uptime:  d.updated_at ? '—' : '—',
      connection:       (d._flota || {}).connection || null,
      alarmas_activas:  (d._flota || {}).alarmas_activas || [],
      descargas_portal: (d._flota || {}).descargas_portal,
      capabilities:     (d._flota || {}).capabilities || null,
      power_mode:       (d._flota || {}).power_mode,
      runtime_min:      Number((d._flota || {}).battery_remain_time) || 0,
      controllable:     !!(d._flota || {}).controllable,
      protocolo: d.protocolo,
      ups_type:  d.ups_type,
      fases:     d.fases,
      snmp_port: d.snmp_port,
      snmp_community: d.snmp_community,
      snmp_version:   d.snmp_version,
      modbus_port:    d.modbus_port,
      modbus_unit_id: d.modbus_unit_id,
      activo: d.activo,
      notas_tecnicas: d.notas_tecnicas,
    };
  }

  function _mapSite(s, devices) {
    const slug = _slugify(s.nombre);
    const inSite = devices.filter(d => d.sitio_id === s.id);
    const online = inSite.filter(d => _statusFromDevice(d) !== 'off').length;
    const alarms = inSite.filter(d => _statusFromDevice(d) === 'warn').length;
    const totalLoad = inSite.reduce((a, d) => a + Number((d._last || {}).carga_pct || 0), 0);
    const totalKva = inSite.reduce((a, d) => a + Number(d.kva || 0), 0);
    const leds = inSite.slice(0, 8).map(d => _statusFromDevice(d));
    const status = leds.includes('off') ? 'warn' : (leds.includes('warn') ? 'warn' : 'ok');
    return {
      id:        slug,
      _raw_id:   s.id,
      name:      s.nombre,
      region:    s.subred_lan || '—',
      addr:      s.notas || s.router_ip_lan || '—',
      ups_total: inSite.length,
      online,
      alarms,
      load_kw:   Math.round(totalLoad * 10) / 10,
      cap_kw:    Math.max(totalKva, 1),
      runtime:   '—',
      leds:      leds.length ? leds : ['off'],
      status,
      numero_sitio: s.numero_sitio,
      router_ip_lan: s.router_ip_lan,
      router_ip_zt:  s.router_ip_zt,
      subred_lan:    s.subred_lan,
      notas:         s.notas,
    };
  }

  function _deriveAlarms(devices) {
    // Alarmas REALES del backend: desconexión con causa + alarmas de umbral
    // confirmadas por el tracker (antes se inventaban en cliente).
    const out = [];
    devices.forEach(d => {
      const f = d._flota || {};
      const conn = f.connection || {};
      const site = _slugify(d.sitio_nombre || '');
      if (conn.status === 'offline') {
        out.push({
          ts: conn.offline_since
            ? new Date(conn.offline_since).toLocaleString('es-MX', { hour12: false })
            : new Date().toLocaleTimeString('es-MX', { hour12: false }),
          lvl: 'err',
          dev: d.nombre, site,
          title: 'UPS sin conexión',
          detail: conn.offline_reason_label || 'Sin respuesta del protocolo',
        });
      } else if (conn.link_quality === 'degraded') {
        out.push({
          ts: new Date().toLocaleTimeString('es-MX', { hour12: false }),
          lvl: 'warn',
          dev: d.nombre, site,
          title: 'Enlace inestable',
          detail: conn.offline_reason_label || 'Fallas intermitentes de lectura',
        });
      }
      (f.alarmas_activas || []).forEach(a => {
        out.push({
          ts: new Date().toLocaleTimeString('es-MX', { hour12: false }),
          lvl: a.level === 'critical' ? 'err' : 'warn',
          dev: d.nombre, site,
          title: a.code, detail: a.msg || '',
        });
      });
    });
    return out.slice(0, 50);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Fetcher principal
  // ──────────────────────────────────────────────────────────────────────
  async function refresh() {
    try {
      // 1. topología (sitios) + estado de flota (1 llamada para todos los UPS)
      const [topo, flota] = await Promise.all([
        window.LBS_API.getTopologia(),
        window.LBS_API.getEstadoFlota().catch(() => null),
      ]);
      const sitios = topo.sitios || [];
      const sinAsignar = topo.sin_asignar || [];
      const devicesRaw = [
        ...sitios.flatMap(s => (s.dispositivos || []).map(d => ({ ...d, sitio_id: s.id, sitio_nombre: s.nombre }))),
        ...sinAsignar.map(d => ({ ...d, sitio_id: null, sitio_nombre: null })),
      ];

      // 2. estado por dispositivo desde estado-flota (conexión confirmada,
      //    alarmas activas, capacidades). Fallback: fan-out a ultimo-estado.
      if (flota && Array.isArray(flota.devices)) {
        const flotaById = Object.fromEntries(flota.devices.map(f => [f.id, f]));
        devicesRaw.forEach(d => {
          d._flota = flotaById[d.id] || null;
          d._last = d._flota;
        });
      } else {
        const enrichments = await Promise.all(devicesRaw.map(async d => {
          try {
            const r = await window.LBS_API.getUltimoEstado(d.id);
            return { id: d.id, last: r && r.data ? r.data : null, conn: r && r.connection };
          } catch (_) {
            return { id: d.id, last: null, conn: null };
          }
        }));
        const byId = Object.fromEntries(enrichments.map(e => [e.id, e]));
        devicesRaw.forEach(d => {
          const e = byId[d.id] || {};
          d._last = e.last;
          d._flota = e.conn ? { connection: e.conn } : null;
        });
      }

      // 3. construir MOCK con shape esperado
      const SITES   = sitios.map(s => _mapSite(s, devicesRaw));
      const DEVICES = devicesRaw.map(_mapDevice);
      const ALARMS  = _deriveAlarms(devicesRaw);

      window.MOCK = { SITES, DEVICES, ALARMS, _loaded: true, _error: null };
      window.dispatchEvent(new CustomEvent('lbs:data-refresh', { detail: window.MOCK }));
    } catch (e) {
      console.error('LBS DataLayer refresh fail:', e);
      window.MOCK._error = e.message;
      window.dispatchEvent(new CustomEvent('lbs:data-error', { detail: e }));
    }
  }

  // Boot: primera carga + polling cada 8s
  window.LBS_DATA = { refresh };
  refresh();
  setInterval(refresh, 8000);

  // ────────────────────────────────────────────────────────────────────
  // Socket.IO global: cuando un UPS cambia de estado (offline↔online o
  // gana alarma crítica), mostramos un toast.
  // ────────────────────────────────────────────────────────────────────
  if (window.io) {
    const sock = window.io({ transports: ['websocket', 'polling'], reconnection: true });
    const lastStatus = {};  // dev_id → status anterior
    sock.on('ups_update', (payload) => {
      if (!payload || payload.id == null) return;
      const id   = String(payload.id);
      const prev = lastStatus[id];
      const cur  = payload.status;
      lastStatus[id] = cur;

      if (!window.LBS_TOAST) return;
      // Solo notificar cambios (no el primer estado)
      if (prev === undefined) return;
      if (prev === cur)       return;

      const name = payload.nombre || payload.name || `UPS ${id}`;
      if (cur === 'offline' || cur === 'off') {
        // Con histéresis en el backend, esto solo dispara en offline CONFIRMADO
        const conn = payload.connection || {};
        const reason = conn.offline_reason_label;
        window.LBS_TOAST.error(
          `${name} se desconectó${reason ? ' — ' + reason : ''}`, { ttl: 9000 });
      } else if (prev === 'offline' || prev === 'off') {
        window.LBS_TOAST.success(`${name} de vuelta en línea`);
      }

      // Alarmas críticas nuevas
      const alarms = payload.alarms || [];
      const critical = alarms.filter(a => a.level === 'critical');
      if (critical.length && prev !== 'critical') {
        const a = critical[0];
        window.LBS_TOAST.warn(`${name}: ${a.msg || a.code}`, { ttl: 8000 });
      }
    });
  }
})();
