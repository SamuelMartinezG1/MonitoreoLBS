# MonitoreoLBS — Arquitectura

Este documento describe cómo está construido el portal: capas, módulos,
flujos de datos y decisiones clave de diseño.

---

## 1. Vista general

```
            ┌──────────────────────────────────────────────────────────────┐
            │                       Cloudflare Tunnel                       │
            │             https://monitor.tu-dominio.com                    │
            └──────────────────────────────┬───────────────────────────────┘
                                           │
                                           ▼
            ┌──────────────────────────────────────────────────────────────┐
            │                  Host Ubuntu Server (host network)            │
            │                                                              │
            │   ┌────────────────────────────────────────────────────┐    │
            │   │   Container `monlbs-portal`  (network_mode: host)   │    │
            │   │                                                    │    │
            │   │   gunicorn -k eventlet -w 1                        │    │
            │   │       │                                            │    │
            │   │       ├── Flask + Flask-Login + Socket.IO          │    │
            │   │       ├── MonitoringService (hilo OS real)         │    │
            │   │       │     • SNMP polling con asyncio.gather       │    │
            │   │       │     • cache de SnmpEngine por device        │    │
            │   │       │     • batch INSERT a ups_metrics            │    │
            │   │       │                                            │    │
            │   │       ├── ModbusMonitor (hilo OS + ThreadPoolExec) │    │
            │   │       │     • 32 workers concurrentes               │    │
            │   │       │                                            │    │
            │   │       └── APScheduler (BackgroundScheduler)        │    │
            │   │             • cleanup cada 60 min                   │    │
            │   └────────────────────────────────────────────────────┘    │
            │                                                              │
            │   ┌──────────────────────────────┐                          │
            │   │ Container `monlbs-db`         │                          │
            │   │ PostgreSQL 15                 │                          │
            │   └──────────────────────────────┘                          │
            │                                                              │
            │   zerotier-one (daemon del host) ◀─ API :9993 + authtoken    │
            │           │                                                  │
            │           └── overlay 10.x.x.x/24                            │
            └───────────────────────────────────┬──────────────────────────┘
                                                │
                                                ▼
                          ┌─────────────────────────────────────┐
                          │  Routers Teltonika (RUT9xx)         │
                          │   • Cliente ZeroTier en la WAN      │
                          │   • LAN 192.168.SITIO.0/24           │
                          └──────────────────────┬──────────────┘
                                                 │
                                                 ▼
                                       UPS (SNMP / Modbus TCP)
```

Decisiones clave:
- **`network_mode: host`** en el portal para que SNMP/Modbus puedan
  alcanzar a los UPS a través de las interfaces ZeroTier del host.
- **`eventlet.monkey_patch(thread=False)`**: socket/time sí se patchean
  (Socket.IO los necesita); `threading` **no** para que el
  `MonitoringService` corra en un hilo OS real y no choque con el loop
  asyncio interno de pysnmp.
- **`-w 1`** worker de gunicorn: Socket.IO exige worker único.

---

## 2. Capas del backend

```
┌──────────────────────────────────────────────────────────────────────┐
│  Entry point  (run_monitor.py)                                       │
│     create_app() → migraciones → bootstrap admin → Blueprints        │
│                  → MonitoringService.start() → APScheduler.start()   │
├──────────────────────────────────────────────────────────────────────┤
│  Routes (Flask Blueprints)                                           │
│     lbs_bp          → vistas Jinja + /api/account/*                  │
│     inventario_bp   → /api/inventario/* + banco SNMP                 │
│     monitoreo_bp    → /api/monitoreo/* + grabaciones + CSV           │
│     diagnostic_bp   → /api/diagnostic/* (14 herramientas)            │
│     zerotier_bp     → /api/zerotier/*                                │
│     admin_bp        → /api/users/*                                   │
├──────────────────────────────────────────────────────────────────────┤
│  Services                                                             │
│     monitoring_service.py   ← orquesta SNMP                          │
│     modbus_monitor.py       ← orquesta Modbus                        │
│     pg_metrics.py           ← layer EAV de Postgres (batch insert)   │
│     zerotier_client.py      ← API HTTP del daemon ZT                 │
│     event_log_collector.py  ← log de eventos NATIVO del UPS          │
│     auto_detect.py          ← detecta protocolo/tipo de UPS          │
│     protocols/              ← clientes SNMP por tipo (Minimal,        │
│                                UPSMIB, Enterprise, Scanner)          │
├──────────────────────────────────────────────────────────────────────┤
│  Persistencia                                                         │
│     base_datos.py (GestorDB singleton, pool psycopg lazy)            │
│       → BD unificada `lbs_db_unificada`: base `lbs`, esquema `mon`,  │
│         usuario `mon_app`, 127.0.0.1:5440                            │
│         (search_path = mon,core,auth,public)                         │
│     auth.py       (Flask-Login + bcrypt + CRUD de usuarios)          │
├──────────────────────────────────────────────────────────────────────┤
│  Schema (PostgreSQL, esquema `mon`)                                   │
│     users, user_permissions     ← cuentas + permisos por sección      │
│     sitios, monitoreo_config    ← inventario lógico                   │
│     ups_oid_profiles            ← perfiles OID por UPS                │
│     ups_telemetry_log           ← buffer circular 10 min              │
│     ups_chart_history           ← historial 30 días (chart)           │
│     ups_metrics                 ← series de tiempo EAV 90 días        │
│     ups_recordings              ← grabaciones manuales                │
│     ups_recording_data          ← muestras de grabaciones             │
│     ups_event_log               ← log de eventos NATIVO del UPS       │
│     schema_migrations           ← tracking de migraciones             │
└──────────────────────────────────────────────────────────────────────┘
```

`ups_telemetry_log`, `ups_chart_history` y `ups_recording_data` incluyen
además las columnas **`temperatura_ambiente`** (temp ambiente del gabinete,
distinta de `temperatura` que es la de batería) y **`ciclos_descarga`**
(contador acumulado de descargas del fabricante); son `N/D` si el equipo no
las expone. La fuente activa de **series de tiempo** es Postgres `ups_metrics`
(EAV); **InfluxDB ya NO se escribe** y solo queda como fallback legacy de
lectura en `/api/datos/historico` (ver sección 8).

### Migraciones

`migrations/runner.py` corre cada archivo `.sql` ordenado lexicográfica-
mente dentro de una transacción individual. Si una migración falla, hace
rollback y aborta el resto. La tabla `schema_migrations` rastrea las ya
aplicadas; las nuevas pueden añadirse sin tocar `pgdata`.

| Archivo | Crea |
|---|---|
| `001_core_schema.sql` | `sitios`, `monitoreo_config` |
| `002_oid_profiles.sql` | `ups_oid_profiles` |
| `003_telemetry_tables.sql` | `ups_telemetry_log`, `ups_recordings`, `ups_recording_data` |
| `004_chart_history.sql` | `ups_chart_history` |
| `005_chart_history_extra.sql` | columnas voltaje_bateria, power_mode, etc. |
| `006_ups_metrics.sql` | `ups_metrics` (EAV) |
| `007_users.sql` | `users`, `user_permissions` |
| `008_schema_fixes.sql` | columnas extra de `sitios` + `notas_tecnicas` |
| `009_ambient_temp_discharge_cycles.sql` | columnas `temperatura_ambiente` + `ciclos_descarga` en telemetría/chart/grabaciones |
| `009_recordings_integrity.sql` | constraints de integridad de grabaciones |
| `010_ups_event_log.sql` | `ups_event_log` + columnas `event_source`/`web_*` en `monitoreo_config` |

---

## 3. Capas del frontend

```
React 18 UMD + Babel in-browser (sin build step).
Socket.IO 4.7 cliente (CDN).
Bootstrap-icons (CDN).
```

```
┌──────────────────────────────────────────────────────────────────┐
│  Templates Jinja (uno por página)                                │
│     dashboard.html  →  DashboardApp                              │
│     inventario.html →  InventarioApp                             │
│     diagnostico.html→  DiagnosticoApp (+ ZeroTierPanel)          │
│     monitoreo.html  →  App (SCADA)                               │
│     grabaciones.html→  GrabacionesApp                            │
│     eventos.html    →  EventosApp (log de eventos nativo del UPS)│
│     admin.html      →  AdminApp                                  │
│     login.html      →  formulario clásico                        │
├──────────────────────────────────────────────────────────────────┤
│  Componentes compartidos                                          │
│     Shell.jsx       → Header + UserMenu (cambiar contraseña)     │
│     Sidebar.jsx     → lista de UPS agrupada por sitio (live)     │
│     MockData.jsx    → DataLayer real: polling /api/inventario,   │
│                       hidrata `window.MOCK` + emite              │
│                       `lbs:data-refresh`. Expone window.LBS_API. │
│     Modals.jsx      → AddDevice, AddSite, ChangePassword         │
│     Toast.jsx       → window.LBS_TOAST.success/error/info/warn   │
│     OIDEditor.jsx   → modal banco SNMP + walk + mapeo            │
│     ZTWizard.jsx    → wizard 4-step bootstrap de sitio           │
│     ZeroTierPanel.jsx → render especializado por sub-herramienta │
│     tweaks-panel.jsx → panel cosmético (acento, layout)          │
├──────────────────────────────────────────────────────────────────┤
│  Componentes del SCADA                                            │
│     App.jsx          → orquestación + Socket.IO `/monitor`        │
│     UpsDiagram.jsx   → diagrama unifilar interactivo (SVG)        │
│     ValuePanels.jsx  → InputStackPanel, OutputStackPanel,         │
│                        LoadAnalysisPanel, StatusLogPanel          │
│     Charts.jsx       → HistoryChart (voltage/load/battery)        │
│     Toolbox.jsx      → selector de modo (online/battery/...)      │
└──────────────────────────────────────────────────────────────────┘
```

### DataLayer (window.MOCK + LBS_API)

> **`window.MOCK` ya NO son fixtures sintéticos: contiene datos REALES.**
> El nombre es histórico. `MockData.jsx` hidrata `window.MOCK` con lo que
> devuelven los endpoints reales (vía `window.LBS_API`). Sin datos del equipo,
> los campos quedan en `'—'` / `'N/D'`, nunca con valores inventados.

El componente `MockData.jsx` es el **core del front**:

1. Al cargar la página hace `GET /api/inventario/topologia`.
2. Para cada UPS, en paralelo, `GET /api/monitoreo/ultimo-estado/<id>`.
3. Mapea la respuesta al shape `window.MOCK = { SITES, DEVICES, ALARMS }`.
4. Dispara `window.dispatchEvent(new CustomEvent('lbs:data-refresh'))`.
5. `setInterval(refresh, 8000)` — polling continuo.

Las pantallas (`Dashboard/Inventario/Diagnostico/Grabaciones`) escuchan
el evento y disparan re-render. **El SCADA usa Socket.IO** además del
DataLayer para tener datos cada 2 s.

### Socket.IO

```
Server (Flask-SocketIO eventlet)
   namespace '/'         → 'ups_update' (cada ciclo del MonitoringService)
   namespace '/monitor'  → 'ups_data'   (cuando un UPS responde con datos crudos)

Cliente (App.jsx)
   io('/monitor', ...)  → escucha 'ups_update' + 'ups_data'
   io('/',        ...)  → escucha 'ups_update' default
```

---

## 4. Flujo de datos: poll → DB → live → UI

```
┌─────────────────┐
│ Teltonika+UPS   │ (SNMP/Modbus)
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ MonitoringService._async_poll()                                     │
│                                                                     │
│ asyncio.gather(_check_device(d) for d in snmp_devices)              │
│      │                                                              │
│      ├── poll vía cliente cacheado (UPSMIBClient / MinimalSNMPClient)│
│      ├── socketio.emit('ups_data', data, namespace='/monitor')      │
│      ├── socketio.emit('ups_update', payload)                       │
│      ├── if (now - last_metric > METRICS_SAMPLE_INTERVAL_S):        │
│      │      db.insertar_telemetria(...)                              │
│      │      buffer_rows ← [(device_id, metric, value), ...]          │
│      ├── if (now - last_history > HISTORY_SAMPLE_INTERVAL_S):       │
│      │      db.guardar_punto_historial(...)                          │
│      │                                                              │
│      └── (end of gather)                                            │
│ pg_metrics.write_ups_data_batch(buffer_rows)  ◀── 1 executemany     │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                  PostgreSQL: ups_metrics, ups_chart_history,
                              ups_telemetry_log, ups_recording_data
                                │
                                ▼
                  Socket.IO emit  →  Cliente App.jsx
                                       │
                                       ├── setLiveData(payload.data)
                                       ├── re-render ValuePanels, UpsDiagram
                                       └── (charts hist se refrescan c/30s)
```

---

## 5. Concurrencia y escalabilidad

### Modbus (loop principal)

```python
with ThreadPoolExecutor(max_workers=MODBUS_POLL_WORKERS) as pool:
    futures = [pool.submit(_process_device, d, buffer, lock) for d in devs]
    for fut in futures: fut.result(timeout=deadline)
```

A 150 UPS / 32 workers ≈ 5 batches × ~3 s = **~15 s/ciclo**.

### SNMP (loop principal)

```python
loop = asyncio.new_event_loop()  # un solo loop por hilo
while running:
    loop.run_until_complete(asyncio.gather(*[_check(d) for d in snmp_devs]))
```

Cliente SNMP **cacheado por `dev_id`** (hash de ip+port+community+ver+type)
con TTL `SNMP_CLIENT_TTL_S` (300 s). Sin esto, cada ciclo crea un nuevo
`SnmpEngine` (caro) y leakea sockets.

### Batch INSERT

`pg_metrics.write_ups_data_batch(rows)` hace **un solo `executemany`**
para los 150 UPS × 15 métricas = 2 250 filas por ciclo. Mucho más rápido
que 150 INSERTs separados.

### Pool de conexiones

- `DB_POOL_MAX=20` (principal: HTTP + servicios)
- `METRICS_POOL_MAX=10` (escrituras de series de tiempo)
- Postgres `max_connections >= 40` recomendado.

### Cleanup

`APScheduler.BackgroundScheduler` corre cada **60 min**:
- `db.limpiar_telemetria_antigua(10)` → borra > 10 min de `ups_telemetry_log`
- `db.limpiar_historial_antiguo(HISTORY_RETENTION_DAYS)` → 30 d default
- `pg_metrics.cleanup_old()` → 90 d default sobre `ups_metrics`

El mismo scheduler corre un segundo job (`lbs_event_log`, cada
`EVENT_LOG_INTERVAL_MIN` = 15 min default) que invoca
`event_log_collector.collect_all(db)` (ver sección 5b).

El loop principal **no** hace cleanup: pollea limpio sin pausas largas.

---

### 5b. Log de eventos NATIVO del UPS

Independiente de las alarmas que el portal calcula por umbral, esta feature
trae el **historial de eventos que el propio UPS registra** (cortes de red,
descargas, bypass, EOD, etc.):

- **Tabla** `ups_event_log` (dedupe por `device_id + ts + evento`).
- **Origen por equipo**: columna `event_source` de `monitoreo_config`
  (`php_almhistory` = tarjeta web PHP, `netagent_xml` = NetAgent/Megatec,
  `NULL`/`''` = sin colector), con credenciales `web_user`/`web_pass`/`web_port`.
- **Colector** `app/services/event_log_collector.py`: `collect_all(db)` lo corre
  el scheduler; `collect_device(dev)` lo dispara el endpoint de refresh.
- **Endpoints**: `GET /api/monitoreo/eventos/<id>` (lista + resumen) y
  `POST /api/monitoreo/eventos/<id>/refresh` (colecta bajo demanda).
- **UI**: página `/eventos` (`EventosApp`) y panel embebido `UpsEventsPanel`
  dentro del SCADA de Monitoreo.

---

## 6. Seguridad

- **Auth**: Flask-Login con cookies HttpOnly + SameSite Lax + bcrypt.
- **RBAC**: 6 secciones (`scada`, `inventario`, `diagnostico`,
  `monitoreo`, `herramientas`, `tablero`). Rol `admin` bypassa.
- **Decoradores**: `@permiso_requerido('seccion')` y `@requiere_rol(...)`.
- **Endpoint /admin**: protegido a doble nivel (vista + API).
- **Bootstrap admin**: solo aplica si `users` está vacía. Las claves
  iniciales DEBEN cambiarse en el primer login.
- **SQL injection**: psycopg con parámetros (`%s`), nunca f-strings.
- **CORS**: `cors_allowed_origins="*"` en Socket.IO (corre detrás del túnel).

---

## 7. ZeroTier — cómo el portal habla con el daemon

```
Portal (contenedor)               Daemon ZeroTier (host)
       │                                  │
       │  HTTP localhost:9993              │
       │  X-ZT1-Auth: <authtoken>          │
       ├─────────────────────────────────▶ │
       │                                  │
       │  GET /status         JSON         │
       │  GET /network        JSON         │
       │  POST /network/<id>  (join)       │
       │  DELETE /network/<id> (leave)     │
       │  GET /peer           JSON         │
       │  (...)                           │
```

El authtoken vive en `/var/lib/zerotier-one/authtoken.secret`. Como ese
archivo solo lo lee root o el grupo `zerotier-one`, el script
`setup_zerotier.sh` lo copia a `/etc/lbs/zerotier-token` con permisos
`0644`. `docker-compose.yml` monta esa ruta read-only al contenedor.

Sobre el HTTP del daemon, el cliente Python (`app/services/zerotier_client.py`)
implementa los métodos:

| Método público | Endpoint del daemon |
|---|---|
| `status()` | `GET /status` |
| `list_networks()` | `GET /network` |
| `get_network(id)` | `GET /network/<id>` |
| `join_network(id)` | `POST /network/<id>` |
| `leave_network(id)` | `DELETE /network/<id>` |
| `list_peers()` | `GET /peer` |
| `network_subnets(id)` | parseo local de `assignedAddresses + routes` |
| `detect_teltonika_sysdescr(text)` | heurística regex |

---

## 8. Decisiones que rechazamos

| Idea | Razón del descarte |
|---|---|
| Bundler frontend (Vite/esbuild) | El proyecto cabe en JSX vía Babel y simplifica el deploy. Internet en el server hace viable el CDN. |
| InfluxDB para series de tiempo | Se reemplazó por Postgres EAV (`ups_metrics`) para tener una sola BD. 90 d × 150 UPS ≈ 600 M filas — Postgres aguanta con índices. **Ya NO se escribe a InfluxDB**; solo queda como fallback legacy de lectura en `/api/datos/historico` (`source: "influxdb"`). |
| `zerotier-cli` exec en cada request | API HTTP local es más rápida, idempotente y no requiere usuario en el grupo `zerotier-one`. |
| WebSocket binario propio | Socket.IO ya está y maneja reconexión + fallback transparente. |
| Background workers (Celery) | El polling es CPU-light, asyncio.gather alcanza. APScheduler para cleanups. |

---

## 9. Cómo agregar una funcionalidad nueva

1. **Endpoint**: agregar la ruta en el blueprint apropiado en `app/routes/`.
2. **Permiso**: decorador `@permiso_requerido` + `@login_required`.
3. **Cliente JS**: agregar el método al objeto `window.LBS_API` en
   `app/static/lbs/components/MockData.jsx`.
4. **UI**: consumir desde un componente. Para errores, `LBS_TOAST.error(e.message)`.
5. **Doc**: agregar la fila correspondiente a `docs/API.md`.
6. **Test**: smoke con `curl` desde `make shell`.

Para una pantalla nueva completa:

1. Componente JSX en `app/static/lbs/components/MiApp.jsx`.
2. Template `app/templates/lbs/mi-pagina.html` (copiar de `admin.html`).
3. Ruta Flask en `app/routes/frontend_routes.py`.
4. Link en `app/static/lbs/components/Shell.jsx` (`navItems`).
5. Inyectar la URL en `_urls_for_react()`.
