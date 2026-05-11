# UPS Monitoring Service

Servicio independiente para **monitoreo de equipos UPS** vía SNMP y Modbus TCP.
Extraído del proyecto `LBS-SERVICIO-APP` para poder desplegarse de forma
autónoma con Docker Compose y exponerse al exterior con Cloudflare Tunnel.

---

## ¿Qué hace?

- Hace **polling cíclico** (2 s por defecto) a todos los UPS configurados en la BD.
- Soporta tres familias de equipos:
  - **Megatec / Voltronic / INVT** (OIDs enterprise `.935`) → `MinimalSNMPClient`.
  - **UPS-MIB estándar (RFC 1628)** → `UPSMIBClient` (mono y trifásicos).
  - **Modbus TCP** → `ModbusMonitor` (INVT industrial).
- Persiste telemetría reciente en PostgreSQL (buffer circular de 10 min).
- Persiste series de tiempo en **PostgreSQL** (tabla `ups_metrics`, layout EAV) — antes era InfluxDB; ahora todo el almacenamiento es Postgres.
- Emite eventos `ups_data` y `ups_update` por **Socket.IO** (`namespace=/monitor`).
- Genera **alarmas** automáticas (voltaje bajo, batería crítica, sobrecarga, sobretemperatura).
- Soporta **perfiles OID personalizados por dispositivo** (tabla `ups_oid_profiles`).

---

## Arquitectura de despliegue

```
┌──────────────┐  https://monitor.tudominio.com
│   Internet   │ ─────────────────────────────────────────┐
└──────────────┘                                          │
                                                          ▼
                                          ┌────────────────────────┐
                                          │  Cloudflare Tunnel     │
                                          │   (cloudflared)        │
                                          └───────────┬────────────┘
                                                      │  HTTP/WebSocket
                                                      ▼
┌──────────────────────────────────────────────────────────────────┐
│  Host Linux (red ZeroTier 10.216.124.0/24)                       │
│                                                                  │
│   ┌─────────────────┐  ┌────────────────────────────────────┐   │
│   │ ups-monitor     │  │ PostgreSQL 15                      │   │
│   │ (Flask+SocketIO)│  │  • monitoreo_config / sitios       │   │
│   │ SNMP + Modbus   │  │  • ups_telemetry_log (10 min)      │   │
│   │                 │  │  • ups_chart_history (~30 días)    │   │
│   │                 │  │  • ups_metrics (series de tiempo)  │   │
│   └────────┬────────┘  └────────────────────────────────────┘   │
└────────────┼─────────────────────────────────────────────────────┘
             │ pysnmp / pymodbus
             ▼
   ┌───────────────────┐
   │ UPS por sitio     │  192.168.SITIO.10  (vía RUT956 ZeroTier)
   └───────────────────┘
```

---

## Estructura del repo

```
ups-monitoring-extracted/
├── app/
│   ├── extensions.py             # Socket.IO global
│   ├── base_datos.py             # GestorDB (Postgres pool)
│   ├── services/
│   │   ├── monitoring_service.py # Loop principal SNMP
│   │   ├── modbus_monitor.py     # Loop Modbus TCP
│   │   ├── pg_metrics.py         # Series de tiempo en Postgres (reemplaza InfluxDB)
│   │   ├── auto_detect.py        # Auto-discovery de UPS
│   │   ├── mdns_service.py       # Anuncio Zeroconf en LAN
│   │   └── protocols/
│   │       ├── snmp_client.py
│   │       ├── snmp_minimal_client.py    # Megatec/INVT/Voltronic
│   │       ├── snmp_upsmib_client.py     # UPS-MIB estándar
│   │       └── snmp_scanner.py
│   └── utils/ups_oids.py         # Catálogo de OIDs
├── migrations/                   # SQL (telemetría, perfiles OID, historial)
├── cloudflared/
│   └── config.example.yml        # Túnel modo "config-file"
├── scripts/
│   ├── setup_cloudflared.sh      # Instala cloudflared como systemd
│   ├── try_cloudflare.sh         # Quick-tunnel para pruebas
│   └── backup_db.sh
├── run_monitor.py                # Punto de entrada
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── AUDITORIA.md                  # Resultado de la auditoría
```

---

## Puesta en marcha

```bash
# 1. Clonar
git clone <tu-repo>.git ups-monitor
cd ups-monitor

# 2. Configurar
cp .env.example .env
$EDITOR .env

# 3. Levantar la pila base (Postgres + servicio)
docker compose up -d db monitor

# 4. (Opcional) Activar Cloudflare Tunnel
docker compose --profile tunnel up -d cloudflared

# 5. Logs
docker compose logs -f monitor
```

El servicio queda disponible en:

- `http://<host>:5000/health`        → healthcheck
- `http://<host>:5000/`               → metadatos
- `ws://<host>:5000/socket.io`        → eventos `ups_data` / `ups_update` en `/monitor`

---

## Cloudflare Tunnel — dos modos

### A) Token (recomendado, plug-and-play)
1. Crea el túnel en `https://one.dash.cloudflare.com/` → **Zero Trust → Networks → Tunnels**.
2. Agrega un **Public Hostname** apuntando a `http://localhost:5000`.
3. Copia el token al campo `CLOUDFLARE_TUNNEL_TOKEN` del `.env`.
4. `docker compose --profile tunnel up -d cloudflared`.

### B) Config file
Útil si manejas tú el `cert.pem` y los credenciales JSON. Renombra
`cloudflared/config.example.yml` → `config.yml`, ajusta el ID y monta
la carpeta en el contenedor.

### C) Quick tunnel (solo demos)
```bash
bash scripts/try_cloudflare.sh 5000
```
Genera un subdominio `*.trycloudflare.com` temporal sin cuenta.

---

## Git — flujo recomendado

```bash
git init
git branch -M main
git add .
git commit -m "feat: extracción inicial del servicio de monitoreo UPS"
git remote add origin git@github.com:lemonroy/ups-monitor.git
git push -u origin main
```

Ramas sugeridas:
- `main` → producción
- `develop` → integración
- `feature/<nombre>` → nuevas funcionalidades
- `hotfix/<nombre>` → correcciones urgentes

---

## Variables de entorno

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `DATABASE_URL` | postgres local | DSN de PostgreSQL |
| `SECRET_KEY` | — | clave Flask |
| `APP_PORT` | `5000` | puerto HTTP |
| `POLL_INTERVAL` | `2` | segundos entre ciclos SNMP |
| `LOG_LEVEL` | `INFO` | nivel de logging |
| `HISTORY_RETENTION_DAYS` | `30` | días que conserva `ups_chart_history` |
| `METRICS_RETENTION_DAYS` | `90` | días que conserva `ups_metrics` |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | token del túnel CF |

---

## Eventos Socket.IO publicados

| Evento | Namespace | Payload | Cuándo |
|--------|-----------|---------|--------|
| `ups_data`   | `/monitor` | dict crudo SNMP | cuando un UPS responde |
| `ups_update` | (default)  | `{id, status, data, alarms}` | cada ciclo, online/offline |

---

## Auditoría

Ver [`AUDITORIA.md`](AUDITORIA.md) para el resumen completo del análisis del
proyecto original y qué se incluyó (y qué se dejó fuera) en esta extracción.

---

© Lemonroy Business Solutions · Proyecto interno
