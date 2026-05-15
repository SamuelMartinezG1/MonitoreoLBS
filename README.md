# MonitoreoLBS — Portal SCADA UPS

Plataforma de monitoreo de UPS para múltiples sitios remotos conectados vía
**ZeroTier**. Backend Python (Flask + Socket.IO + SNMP + Modbus + Postgres),
frontend React (sin build, JSX en navegador) y orquestación con Docker
Compose. Diseñado para escalar a **150+ UPS** con polling concurrente,
batch inserts y cleanup programado.

```
   Operador / Técnico  ──▶  Cloudflare Tunnel  ──▶  Portal :5005  ──▶  PostgreSQL :5432
                                                          │
                                                          ▼
                                                  ZeroTier overlay
                                                          │
                                                          ▼
                                              ┌───────────┴───────────┐
                                              ▼                       ▼
                                      Teltonika sitio 1       Teltonika sitio N
                                              │                       │
                                          UPS  UPS  UPS         UPS  UPS  UPS
```

---

## Funcionalidades

| Área | Detalle |
|---|---|
| **Polling SNMP** | INVT (.56788), Megatec / Voltronic (.935), UPS-MIB RFC 1628, perfiles OID custom. asyncio.gather, cliente SNMP cacheado por dispositivo (TTL configurable). |
| **Polling Modbus TCP** | INVT industrial. ThreadPoolExecutor concurrente (32 workers default → ~15 s/ciclo para 150 UPS). |
| **Live SCADA** | Socket.IO `/monitor` con eventos `ups_update` cada 2 s. Diagrama unifilar interactivo (UpsDiagram), charts históricos de 6 h. |
| **Inventario** | CRUD de sitios y UPS. Auto-detección de protocolo + tipo de UPS. |
| **Diagnóstico** | 14 herramientas: ping, port, traceroute, interfaces, SNMP get/walk/autodetect, Modbus test, scan rango, SNMP mass scan, ZeroTier status, ping a routers, network health. |
| **ZeroTier** | Estado del nodo, gestión de networks (join/leave), peers, escaneo de subred, detección de Teltonika, escaneo de LAN del sitio, **wizard de bootstrap** completo. |
| **Banco SNMP / Editor OID** | Por UPS: SNMP walk + tabla de mapeo de OIDs a variables estándar + factor + unidad + prueba en vivo. |
| **Grabaciones** | Inicio/stop por UPS, lista global, visualización inline (chart SVG), export CSV. |
| **Administración** | Gestión de usuarios + permisos por sección (admin only). Cambio de contraseña propio. |
| **Persistencia** | PostgreSQL 15 (`ups_metrics` EAV, `ups_chart_history`, `ups_telemetry_log`, `ups_recordings/recording_data`, `monitoreo_config`, `sitios`, `users`, `user_permissions`, `ups_oid_profiles`). |
| **Operación** | Migraciones idempotentes al arranque, APScheduler para cleanup, Toast notifications globales, empty states. |

---

## Estructura del repo

```
MonitoreoLBS/
├── app/
│   ├── auth.py                   # Flask-Login + bcrypt + helpers CRUD users
│   ├── permisos.py               # decoradores @permiso_requerido @requiere_rol
│   ├── base_datos.py             # GestorDB singleton (psycopg pool lazy)
│   ├── extensions.py             # Socket.IO global
│   ├── routes/
│   │   ├── frontend_routes.py    # vistas Jinja + /api/account/*
│   │   ├── inventario_routes.py  # /api/inventario/* + banco SNMP
│   │   ├── monitoreo_routes.py   # /api/monitoreo/* + grabaciones + CSV
│   │   ├── diagnostic_routes.py  # /api/diagnostic/* (14 herramientas)
│   │   ├── zerotier_routes.py    # /api/zerotier/* (gestión + scan + wizard)
│   │   └── admin_routes.py       # /api/users/* (gestión de cuentas)
│   ├── services/
│   │   ├── monitoring_service.py # loop SNMP (asyncio.gather + cache cliente)
│   │   ├── modbus_monitor.py     # loop Modbus (ThreadPoolExecutor)
│   │   ├── pg_metrics.py         # series de tiempo en Postgres (batch insert)
│   │   ├── zerotier_client.py    # API HTTP local de ZeroTier
│   │   ├── auto_detect.py        # auto-discovery de UPS
│   │   └── protocols/            # SNMPClient, MinimalSNMPClient, UPSMIBClient, SNMPScanner
│   ├── utils/ups_oids.py
│   ├── templates/lbs/            # Jinja: login, dashboard, monitoreo, inventario,
│   │                             #        diagnostico, grabaciones, admin
│   └── static/lbs/
│       ├── components/           # JSX: Shell, Sidebar, MockData (DataLayer),
│       │                         #      Toast, Modals, OIDEditor, ZTWizard,
│       │                         #      DashboardApp, InventarioApp,
│       │                         #      DiagnosticoApp, ZeroTierPanel,
│       │                         #      GrabacionesApp, AdminApp, App (SCADA),
│       │                         #      UpsDiagram, Charts, ValuePanels, Toolbox,
│       │                         #      tweaks-panel
│       └── styles/               # tokens, shell, panels, layout, pages, modals,
│                                 # diagnostico, admin
├── migrations/                   # 001 → 008 + runner.py (transacciones)
├── scripts/
│   ├── backup_db.sh
│   └── setup_zerotier.sh         # prepara authtoken para el contenedor
├── docs/
│   ├── DEPLOY.md                 # guía de despliegue paso a paso
│   ├── ARCHITECTURE.md           # backend + frontend + flujos + diagramas
│   ├── API.md                    # referencia completa de endpoints (curl)
│   ├── RUNBOOK.md                # workflows operativos del día a día
│   ├── USERS.md                  # gestión de usuarios y permisos
│   └── ZEROTIER.md               # setup, troubleshooting, API del daemon
├── run_monitor.py                # entry point (eventlet + Flask + Socket.IO + APScheduler)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── .env.example
└── .gitignore
```

---

## Quickstart

```bash
git clone <repo>.git MonitoreoLBS
cd MonitoreoLBS
cp .env.example .env
$EDITOR .env                          # SECRET_KEY, DB_PASSWORD, ADMIN_PASSWORD

# 1. (opcional) ZeroTier en el host
curl -s https://install.zerotier.com | sudo bash
sudo ./scripts/setup_zerotier.sh      # copia authtoken a /etc/lbs/zerotier-token

# 2. Stack
docker compose up -d                  # db + portal
docker compose --profile tunnel up -d # + Cloudflare Tunnel (opcional)

# 3. Verificar
make health                           # {"status":"ok"}
make logs                             # tail -f del portal
```

Portal: `http://<host>:5005`  (login con `ADMIN_USERNAME` / `ADMIN_PASSWORD`).

> El primer arranque aplica 8 migraciones SQL y crea el usuario admin
> inicial. El log marcará la línea `Usuario admin inicial creado.
> CÁMBIALE LA CONTRASEÑA.` — hazlo desde el menú de usuario en el header.

---

## Documentación

| Archivo | Para |
|---|---|
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Instalación, configuración, Cloudflare Tunnel, scaling |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura interna, módulos, flujos de datos |
| [`docs/API.md`](docs/API.md) | Referencia completa de todos los endpoints REST |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Cómo agregar un sitio, rotar passwords, hacer backup, ver logs, troubleshooting |
| [`docs/USERS.md`](docs/USERS.md) | Gestión de usuarios, roles, permisos por sección |
| [`docs/ZEROTIER.md`](docs/ZEROTIER.md) | Setup ZeroTier en Ubuntu, workflow de sitio nuevo |

---

## Variables de entorno (las más comunes)

| Variable | Default | Para |
|----------|---------|------|
| `SECRET_KEY` | — | clave Flask **obligatoria** |
| `APP_PORT` | `5005` | puerto HTTP del portal |
| `POLL_INTERVAL` | `2` | segundos entre ciclos SNMP |
| `MODBUS_POLL_WORKERS` | `32` | hilos del pool Modbus |
| `METRICS_SAMPLE_INTERVAL_S` | `30` | cada cuánto se persiste a `ups_metrics` |
| `HISTORY_SAMPLE_INTERVAL_S` | `30` | cada cuánto se persiste a `ups_chart_history` |
| `SNMP_CLIENT_TTL_S` | `300` | TTL del cliente SNMP cacheado |
| `HISTORY_RETENTION_DAYS` | `30` | retención de `ups_chart_history` |
| `METRICS_RETENTION_DAYS` | `90` | retención de `ups_metrics` |
| `DB_POOL_MAX` | `20` | máx conexiones del pool principal |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — | bootstrap admin (solo aplica si `users` está vacía) |
| `ZEROTIER_AUTHTOKEN_FILE` | `/etc/lbs/zerotier-token` | path al authtoken |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | token del túnel CF |

Ver `.env.example` para la lista completa.

---

## Dimensionamiento (≥ 50 UPS)

| UPS | Workers Modbus | `METRICS_SAMPLE_INTERVAL_S` | Filas/día `ups_metrics` |
|----:|----:|----:|----:|
| 20  | 16 | 10 | ~2.6 M |
| 50  | 24 | 20 | ~3.2 M |
| 150 | **32 (default)** | **30 (default)** | **~6.5 M** |
| 200 | 48 | 30 | ~8.7 M |
| 300+ | 64 | 60 | considerar TimescaleDB / partitioning |

Postgres recomendado para 150 UPS: `max_connections >= 40`,
`shared_buffers >= 256 MB`, `wal_compression = on`.

---

## Comandos Makefile

```
make up              # docker compose up -d (db + portal)
make up-tunnel       # ... + Cloudflare Tunnel
make logs            # tail logs del portal
make logs-db         # tail logs Postgres
make ps              # status containers
make health          # curl al /health
make shell           # bash dentro del contenedor portal
make psql            # psql interactivo
make migrate         # aplica migraciones sin reiniciar
make rebuild         # build + restart portal
make down            # parar (mantiene volumen pgdata)
make nuke            # parar + BORRAR volumen (¡cuidado!)
make lint            # py_compile + jinja syntax check
```

---

## Licencia / propiedad

© Lemonroy Business Solutions · proyecto interno.
