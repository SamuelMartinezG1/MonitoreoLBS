# MonitoreoLBS — Despliegue

Guía completa para desplegar el portal en Ubuntu Server.

> Para operaciones del día a día, ver [`RUNBOOK.md`](RUNBOOK.md).
> Para gestión de usuarios, ver [`USERS.md`](USERS.md).
> Para integración ZeroTier, ver [`ZEROTIER.md`](ZEROTIER.md).

---

## Pre-requisitos en el host

| Paquete | Para |
|---|---|
| Docker 24+ | runtime de contenedores |
| Docker Compose v2 | orquestación |
| `zerotier-one` (opcional) | red overlay hacia los Teltonika |
| `cloudflared` (opcional) | túnel HTTPS público |

```bash
# Docker (Ubuntu 22.04+)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# Verificar
docker --version
docker compose version
```

---

## 1. Preparar el repositorio

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone <repo-url> MonitoreoLBS
sudo chown -R $USER:$USER MonitoreoLBS
cd MonitoreoLBS
```

---

## 2. Variables de entorno

```bash
cp .env.example .env

# Generar SECRET_KEY robusta
python3 -c "import secrets; print(secrets.token_urlsafe(48))"

$EDITOR .env
```

Mínimo de producción:

```dotenv
PROJECT_NAME=monlbs                  # prefijo de contenedores y volúmenes
SECRET_KEY=<48-bytes-random>
APP_PORT=5005
DB_USER=guia_app
DB_PASSWORD=<contraseña-fuerte>
DB_NAME=guia_instalacion
DB_EXTERNAL_PORT=5435
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<password-inicial-fuerte>  # cambiala tras el primer login
CLOUDFLARE_TUNNEL_TOKEN=<opcional>
```

> **Nunca commitees `.env`.** Está en `.gitignore` por defecto.

---

## 3. (Opcional) Setup ZeroTier

Si vas a gestionar los sitios remotos vía ZeroTier (recomendado):

```bash
# Instalar el daemon
curl -s https://install.zerotier.com | sudo bash
sudo systemctl enable --now zerotier-one

# Preparar el authtoken para el contenedor
sudo ./scripts/setup_zerotier.sh
```

El script copia `/var/lib/zerotier-one/authtoken.secret` a
`/etc/lbs/zerotier-token` (lectura para el contenedor) e imprime el
**Node ID** del host. Anota ese ID — lo necesitarás para autorizar el
nodo en https://my.zerotier.com.

Ver [`ZEROTIER.md`](ZEROTIER.md) para detalle.

---

## 4. Levantar el stack

```bash
make build              # construye lbs/portal:latest (2-3 min)
make up                 # arranca db + portal
make logs               # tail
```

### Verificación post-arranque

```bash
make health             # {"status":"ok"}
make ps                 # ambos contenedores en "healthy"
```

Los logs del primer arranque deberían mostrar:

```
migrations.runner: Aplicando migración: 001_core_schema.sql
migrations.runner: Aplicando migración: 002_oid_profiles.sql
...
migrations.runner: Aplicando migración: 008_schema_fixes.sql
migrations.runner: Se aplicaron 8 migración(es)
app.auth: AUTH BOOTSTRAP: usuario admin creado (admin).
lbs-portal: Usuario admin inicial creado. CÁMBIALE LA CONTRASEÑA.
app.services.monitoring_service: Iniciando MonitoringService (interval=2s, ...)
app.services.modbus_monitor: ModbusMonitor iniciado (workers=32, cycle=2s, ...)
lbs-portal: Cleanup scheduler arrancado (cada 60 min)
[INFO] Listening at: http://0.0.0.0:5005
```

Login inicial: `http://<host>:5005/login` con `admin` / `<ADMIN_PASSWORD>`.
**Cámbiala** desde el menú de usuario en el header.

---

## 5. Exponer al internet con Cloudflare Tunnel

1. https://one.dash.cloudflare.com → **Zero Trust → Networks → Tunnels**.
2. Crea un tunnel; copia el token.
3. En `.env`:
   ```dotenv
   CLOUDFLARE_TUNNEL_TOKEN=<token>
   ```
4. En el tunnel: **Public Hostname** → `monitor.tudominio.com` →
   `http://localhost:5005`.
5. Levanta el perfil con tunnel:
   ```bash
   make up-tunnel
   ```

Cloudflare termina TLS y maneja DNS. **No abras el puerto 5005 al
internet** — déjalo en `127.0.0.1` y accede solo vía el túnel.

### Túnel con WebSocket (Socket.IO)

Activa **WebSocket support** en la configuración del túnel
(Settings → Network → "WebSocket" ON). Sin esto el SCADA cae a HTTP
polling pero queda lento.

---

## 6. Topología de red

El portal corre con `network_mode: host` para alcanzar UPS por SNMP/Modbus
en la LAN o vía ZeroTier. Implicaciones:

- El puerto `APP_PORT` queda expuesto en **todas** las interfaces del host.
- El healthcheck consulta `http://127.0.0.1:5005/health`.
- Postgres se accede como `127.0.0.1:DB_EXTERNAL_PORT` desde el portal.

Para producción se recomienda:

```bash
# Bloquear acceso directo al puerto desde fuera del host
sudo ufw deny 5005/tcp
sudo ufw deny 5435/tcp
sudo ufw allow ssh
sudo ufw enable
```

(El tráfico al portal entra por el Cloudflare Tunnel, no por puerto
expuesto.)

---

## 7. Base de datos

### Migraciones

Las migraciones SQL viven en `migrations/`. **Se aplican automática-
mente en cada arranque** vía `migrations/runner.py`, que usa la tabla
`schema_migrations` para tracking. Es seguro re-arrancar — solo
aplican las pendientes.

| Archivo | Tablas que toca |
|---|---|
| `001_core_schema.sql` | sitios, monitoreo_config |
| `002_oid_profiles.sql` | ups_oid_profiles |
| `003_telemetry_tables.sql` | ups_telemetry_log, ups_recordings, ups_recording_data |
| `004_chart_history.sql` | ups_chart_history |
| `005_chart_history_extra.sql` | columnas extra del historial |
| `006_ups_metrics.sql` | ups_metrics (EAV) |
| `007_users.sql` | users, user_permissions |
| `008_schema_fixes.sql` | columnas extra de sitios + monitoreo_config |

Para añadir una migración nueva:

```bash
# 1. Crear migrations/009_loquesea.sql
$EDITOR migrations/009_xxx.sql

# 2. Aplicar sin reiniciar
make migrate
```

### Apuntar a una BD externa

Si ya tienes Postgres en otra parte, comenta el servicio `db` en
`docker-compose.yml` y rellena `DATABASE_URL`:

```dotenv
DATABASE_URL=postgresql://guia_app:xxx@db.lbs.lan:5432/guia_instalacion
```

---

## 8. Actualizaciones

```bash
# 1. Pull del repo
git pull

# 2. Rebuild + restart del portal (preserva pgdata)
make rebuild

# 3. (si hay migraciones nuevas) aplicarlas en caliente
make migrate
```

Para **rollback rápido**, fijar un TAG en `.env`:

```dotenv
PORTAL_IMAGE=registry.tu-dominio.com/lbs/portal:v1.0.0
```

y `docker compose pull portal && make up`.

---

## 9. Backups

### Backup manual

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U $DB_USER -d $DB_NAME --clean --create \
  | gzip > backups/lbs-$(date +%F-%H%M).sql.gz
```

### Backup automatizado (cron en el host)

```cron
# /etc/cron.d/monitoreolbs-backup
0 3 * * *  ubuntu  cd /opt/MonitoreoLBS && ./scripts/backup_db.sh
0 4 * * 0  ubuntu  find /opt/MonitoreoLBS/backups -name '*.sql.gz' -mtime +30 -delete
```

### Restore

```bash
gunzip -c backups/lbs-2026-05-14-0300.sql.gz \
  | docker compose exec -T db psql -U $DB_USER -d postgres
```

> El restore es destructivo (usa `--clean --create`).

---

## 10. Operación diaria

Ver [`RUNBOOK.md`](RUNBOOK.md). Cheat sheet:

```
make ps          # estado
make logs        # logs portal
make logs-db     # logs Postgres
make restart     # reinicia portal (no la BD)
make psql        # psql interactivo
make health      # /health
make shell       # bash dentro del contenedor
```

---

## 11. Troubleshooting

| Síntoma | Diagnóstico |
|---|---|
| Portal no arranca | `make logs` → busca `SECRET_KEY required` o `migración X falló` |
| `health` devuelve 502 | `docker compose ps` → ¿`portal` healthy? `db` healthy? |
| No se ven UPS en sidebar | login OK pero sin permisos `scada`? probar `GET /api/inventario/topologia` |
| SNMP no llega a UPS | `make shell` → `snmpwalk -v2c -c public 10.x.x.x` |
| ZeroTier no disponible | `GET /api/zerotier/health` → si `available:false`, re-ejecutar `setup_zerotier.sh` |
| Conflicto de puertos | cambia `APP_PORT` y `DB_EXTERNAL_PORT` en `.env`, `make restart` |
| Socket.IO timeouts | bajo CF tunnel: activa "WebSocket" en la configuración del túnel |
| BD llena | revisa `HISTORY_RETENTION_DAYS` y `METRICS_RETENTION_DAYS` |

---

## 12. Checklist pre-producción

- [ ] `.env` con `SECRET_KEY` único de 48+ bytes
- [ ] `ADMIN_PASSWORD` cambiada tras el primer login
- [ ] `setup_zerotier.sh` ejecutado y nodo autorizado en my.zerotier.com
- [ ] Cron de backup configurado con retención
- [ ] Cloudflare Tunnel activo con `Public Hostname` mapeado
- [ ] WebSocket habilitado en CF (para SCADA)
- [ ] `make ps` muestra ambos contenedores `(healthy)`
- [ ] `make logs` sin errores recurrentes (≥ 5 min sin tráfico)
- [ ] Firewall bloquea `5005/tcp` y `5435/tcp` desde fuera del host
- [ ] DNS interno o público apunta al host correcto
- [ ] Usuarios técnicos / operadores creados con permisos correctos
- [ ] Al menos un sitio + un UPS de prueba registrados
- [ ] El portal recibe `ups_update` por Socket.IO (verificable en consola del navegador)
