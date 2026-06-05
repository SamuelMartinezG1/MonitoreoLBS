# MonitoreoLBS — Referencia de API

Todos los endpoints viven detrás de `Content-Type: application/json` y
requieren la cookie de sesión `lbs_session` (obtenida vía `POST /login`),
excepto los marcados como **público**.

Variables usadas en los ejemplos:

```bash
BASE=http://127.0.0.1:5005
COOKIE=/tmp/lbs.cookie
# Una sola vez para autenticarte y guardar la cookie:
curl -sS -c $COOKIE -X POST -d 'user=admin&pw=tu_password' -o /dev/null $BASE/login
```

---

## Salud y metadata

| Método | Path | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | público | healthcheck ligero `{"status":"ok"}` |
| GET | `/api/info` | público | metadatos del servicio |
| GET | `/health/ui` | público | `{status, auth: bool}` — ligero, para que el front sepa si hay sesión |
| GET | `/api/health/full` | sesión | healthcheck profundo: `db`, `monitor`, `modbus`, `scheduler`, `zerotier`, `metrics`, `devices` + `status: ok\|degraded` |

```bash
curl -sS $BASE/health
# {"service":"lbs-portal","status":"ok"}

curl -sS -b $COOKIE $BASE/api/health/full | jq '{status, db: .db.ok, monitor: .monitor.alive}'
```

---

## Autenticación y cuenta

| Método | Path | Auth | Descripción |
|---|---|---|---|
| GET / POST | `/login` | público | form / valida credenciales |
| GET | `/logout` | sesión | cierra sesión |
| GET | `/api/account/me` | sesión | `{id, username, nombre, rol, initials}` |
| POST | `/api/account/change-password` | sesión | `{old_password, new_password}` |

```bash
curl -sS -b $COOKIE $BASE/api/account/me
# {"id":1,"initials":"AD","nombre":"admin","rol":"admin","username":"admin"}

curl -sS -b $COOKIE -X POST -H 'Content-Type: application/json' \
  -d '{"old_password":"vieja","new_password":"nueva-12345"}' \
  $BASE/api/account/change-password
# {"status":"ok"}
```

---

## Inventario (sitios + dispositivos)

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/api/inventario/topologia` | scada | `{sitios:[{...,dispositivos:[]}], sin_asignar:[]}` |
| GET | `/api/inventario/sitios` | scada | lista de sitios |
| POST | `/api/inventario/sitios` | scada | crea sitio: `{numero_sitio, nombre, subred_lan, router_ip_lan, router_ip_zt, notas}` |
| PUT | `/api/inventario/sitios/<id>` | scada | actualiza sitio |
| DELETE | `/api/inventario/sitios/<id>` | scada | borra sitio (asignación de dispositivos pasa a NULL) |
| PUT | `/api/inventario/dispositivos/<id>/sitio` | scada | `{sitio_id}` |
| PUT | `/api/inventario/dispositivos/<id>/notas` | scada | `{notas_tecnicas}` |

```bash
curl -sS -b $COOKIE $BASE/api/inventario/topologia | jq .
```

---

## Banco SNMP / perfiles OID

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| POST | `/api/inventario/test-connection` | scada | `{ip, port?, community?, version?}` |
| POST | `/api/inventario/snmp-walk` | scada | walk hasta 100 OIDs: `{ip, oid, community?, version?}` |
| POST | `/api/inventario/oid-test` | scada | prueba un OID + factor: `{ip, oid, factor, community?, version?}` |
| GET | `/api/inventario/oid-profile/<device_id>` | scada | perfil OID guardado |
| POST | `/api/inventario/save-oid-profile` | scada | reemplaza perfil: `{device_id, mappings:[{variable_name, oid, factor, unit, description}]}` |

---

## Monitoreo y dispositivos

La columna **Acceso** lista los decoradores reales: `permiso` =
`@permiso_requerido(...)`, `rol` = `@requiere_rol(...)`. Cuando aparecen los
dos, se exigen **ambos** (permiso `scada` **Y** rol `admin`/`tecnico`).

| Método | Path | Acceso | Descripción |
|---|---|---|---|
| GET | `/api/monitoreo/list` | permiso `scada` | lista de UPS activos |
| POST | `/api/monitoreo/add` | permiso `scada` + rol `admin`/`tecnico` | crea UPS |
| DELETE | `/api/monitoreo/delete/<id>` | permiso `scada` + rol `admin`/`tecnico` | borra UPS |
| POST | `/api/autoset/scan` | permiso `scada` + rol `admin`/`tecnico` | auto-detección de un UPS por IP |
| GET | `/api/monitoreo/ultimo-estado/<id>` | permiso `scada` | última lectura conocida (incluye `temperatura_ambiente` y `ciclos_descarga`) |
| GET | `/api/monitoreo/calidad-energia/<id>?horas=24` | permiso `scada` | resumen PQI, sags, swells |
| GET | `/api/monitoreo/perfil-horario/<id>?horas=24` | permiso `scada` | métricas agrupadas por hora |
| GET | `/api/monitoreo/eventos/<id>?limit=500&nivel=` | permiso `scada` | log de eventos NATIVO del UPS: `{status, eventos[], resumen}` |
| POST | `/api/monitoreo/eventos/<id>/refresh` | permiso `scada` + rol `admin`/`tecnico` | colecta el log del UPS bajo demanda (requiere `event_source`): `{status, colectados, insertados}` |
| GET | `/api/telemetry/recent/<id>?minutes=10` | permiso `scada` | buffer circular (últimos N min; incluye `temperatura_ambiente`, `ciclos_descarga`) |
| GET | `/api/ups-history/<id>?horas=6` | permiso `scada` | historial de gráficas |
| GET | `/api/datos/historico?device_id=X&horas=Y&campo=Z` | permiso `scada` | endpoint parametrizable; campo `source` = `postgresql` (fuente activa) \| `influxdb` (fallback legacy) \| `none` |
| GET | `/api/ups-proxy/<id>/...` | permiso `scada` | reverse proxy a la UI web del UPS |

```bash
# Agregar un UPS SNMP
curl -sS -b $COOKIE -X POST -H 'Content-Type: application/json' -d '{
  "ip":"10.216.124.50","nombre":"UPS-NORTE-01","protocolo":"snmp",
  "snmp_port":161,"snmp_community":"public","snmp_version":1,
  "ups_type":"megatec_snmp","fases":1,"sitio_id":3
}' $BASE/api/monitoreo/add

# Datos históricos: el campo `source` indica de dónde salieron
curl -sS -b $COOKIE "$BASE/api/datos/historico?device_id=5&horas=24&campo=voltaje_entrada" | jq .source
# "postgresql"  ← fuente activa (ups_chart_history). "influxdb" sólo si PG no tiene datos y queda el fallback legacy. "none" si ninguna fuente respondió.

# Log de eventos NATIVO del UPS (cortes, descargas, bypass…)
curl -sS -b $COOKIE "$BASE/api/monitoreo/eventos/5?limit=100" | jq '.eventos[0]'

# Forzar colecta del log (requiere event_source configurado en el equipo)
curl -sS -b $COOKIE -X POST $BASE/api/monitoreo/eventos/5/refresh
# {"status":"ok","colectados":12,"insertados":3}
```

---

## Grabaciones SCADA

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| POST | `/api/recording/start` | scada | `{device_id, nombre?}` — falla si ya hay una activa para el device |
| POST | `/api/recording/stop/<recording_id>` | scada | detiene + cuenta muestras |
| GET | `/api/recording/list?device_id=<id>` | scada | lista (todas o por device) |
| GET | `/api/recording/data/<id>` | scada | datos crudos JSON |
| GET | `/api/recording/<id>/csv` | scada | descarga CSV (columnas incluyen `temperatura_ambiente` y `ciclos_descarga`) |
| DELETE | `/api/recording/<id>` | scada | borra grabación + datos (CASCADE) |

```bash
# Iniciar
curl -sS -b $COOKIE -X POST -H 'Content-Type: application/json' \
  -d '{"device_id":5,"nombre":"prueba-carga"}' \
  $BASE/api/recording/start

# Descargar CSV
curl -sS -b $COOKIE -o muestras.csv $BASE/api/recording/12/csv
```

---

## Diagnóstico (14 herramientas)

Todos requieren permiso `herramientas`. Devuelven `{success, output?, ...}`.

| Método | Path | Body |
|---|---|---|
| POST | `/api/diagnostic/ping` | `{ip}` |
| POST | `/api/diagnostic/port` | `{ip, port}` |
| POST | `/api/diagnostic/snmp` | `{ip, community, port}` — usa SNMPClient INVT |
| POST | `/api/diagnostic/snmp-walk` | `{ip, oid, community, version}` — devuelve `results[]` |
| POST | `/api/diagnostic/snmp-get` | `{ip, oid, community, version}` — devuelve `results[]` |
| POST | `/api/diagnostic/snmp-autodetect` | `{ip}` — devuelve `config{success, version, community, ups_type, oids_working[]}` |
| POST | `/api/diagnostic/snmp-mass-scan` | `{network, start, end, community, port}` — devuelve `dispositivos[]` |
| POST | `/api/diagnostic/modbus` | `{ip, port, slave_id}` |
| POST | `/api/diagnostic/scan` | `{network, start, end}` — devuelve `hosts[]` |
| POST | `/api/diagnostic/route` | `{ip}` — `ip route` |
| GET | `/api/diagnostic/interfaces` | — | `ip addr` |
| POST | `/api/diagnostic/zerotier-status` | `{}` — `zerotier-cli info/listnetworks/listpeers` |
| POST | `/api/diagnostic/ping-all-routers` | `{}` — pinga `router_ip_zt` y `router_ip_lan` de cada sitio |
| POST | `/api/diagnostic/network-health` | `{}` — pinga routers + UPS y consolida |

```bash
curl -sS -b $COOKIE -X POST -H 'Content-Type: application/json' \
  -d '{"ip":"10.216.124.50"}' \
  $BASE/api/diagnostic/snmp-autodetect
```

---

## ZeroTier

Requieren permiso `herramientas`. El daemon debe estar disponible
(`/api/zerotier/health → available: true`).

| Método | Path | Body / Descripción |
|---|---|---|
| GET | `/api/zerotier/health` | `{available, api_url}` — comprueba el daemon |
| GET | `/api/zerotier/status` | info del nodo (node ID, versión, online) |
| GET | `/api/zerotier/networks` | networks unidas + rutas + IPs asignadas |
| POST | `/api/zerotier/join` | `{network_id}` — unirse |
| POST | `/api/zerotier/leave` | `{network_id}` — salir |
| GET | `/api/zerotier/peers` | peers del cliente local |
| POST | `/api/zerotier/scan-network` | `{network_id, community?}` — ping + SNMP en la subred ZT |
| POST | `/api/zerotier/discover-teltonika` | `{network_id, community?}` — filtra Teltonika por sysDescr |
| POST | `/api/zerotier/scan-site-lan` | `{sitio_id, community?}` — escanea la `subred_lan` del sitio |
| POST | `/api/zerotier/bootstrap-site` | wizard: `{network_id, numero_sitio, nombre, subred_lan, router_ip_lan?, router_ip_zt?, notas?, community?}` |

```bash
# Wizard: une, crea sitio, detecta Teltonika, escanea LAN — todo en una llamada
curl -sS -b $COOKIE -X POST -H 'Content-Type: application/json' -d '{
  "network_id": "8056c2e21c000001",
  "numero_sitio": 99,
  "nombre": "CDMX · Vallejo",
  "subred_lan": "192.168.99.0/24",
  "router_ip_zt": "10.216.124.99",
  "community": "public"
}' $BASE/api/zerotier/bootstrap-site
```

---

## Administración (usuarios y permisos)

Todos requieren rol `admin`.

| Método | Path | Body / Descripción |
|---|---|---|
| GET | `/api/users` | `{users:[{id, username, role, created_at, permisos:[{seccion, permitido}]}]}` |
| GET | `/api/users/sections` | `{sections:[...], roles:[...]}` para los selects de la UI |
| POST | `/api/users` | crea: `{username, password, role?, permisos?:[..]}` |
| PUT | `/api/users/<id>` | actualiza rol/permisos: `{role?, permisos?}` |
| POST | `/api/users/<id>/password` | restablece (admin): `{new_password}` |
| DELETE | `/api/users/<id>` | borra (no permite auto-eliminación) |

```bash
# Crear un técnico con acceso a SCADA + Inventario + Herramientas
curl -sS -b $COOKIE -X POST -H 'Content-Type: application/json' -d '{
  "username":"jdoe",
  "password":"contrasena-segura",
  "role":"tecnico",
  "permisos":["scada","inventario","herramientas","monitoreo","tablero"]
}' $BASE/api/users
```

---

## Códigos de respuesta comunes

| Código | Significado |
|---|---|
| 200 | OK |
| 302 | redirect (e.g. `GET /` autenticado → `/dashboard`) |
| 400 | datos inválidos (cuerpo malformado, campos requeridos faltantes) |
| 401 | no autenticado (sesión expirada o nunca iniciada) |
| 403 | autenticado pero sin permiso |
| 404 | recurso inexistente |
| 409 | conflicto (e.g. IP duplicada, grabación ya activa) |
| 500 | error de servidor (revisar `make logs`) |

---

## Socket.IO

```javascript
const sock = io('/monitor', { transports: ['websocket', 'polling'] });
sock.on('ups_data',   data    => { ... });   // datos crudos SNMP
sock.on('ups_update', payload => { ... });   // estado consolidado

const def = io('/', { transports: ['websocket', 'polling'] });
def.on('ups_update', payload => { ... });   // emitido también en namespace default
```

`payload` shape:

```json
{
  "id": 5,
  "status": "online",
  "ip": "10.216.124.50",
  "nombre": "UPS-NORTE-01",
  "protocol": "snmp",
  "data": { "voltaje_in_l1": 122.4, "bateria_pct": 96, "...": "..." },
  "alarms": [{ "level": "warning", "code": "BAT_LOW", "msg": "..." }]
}
```

---

## Convenciones

- **Tiempos**: ISO 8601 con timezone UTC (e.g. `2026-05-13T19:01:57.738Z`).
- **IDs**: enteros (BIGSERIAL en `ups_telemetry_log` y `ups_recording_data`).
- **OIDs**: strings sin prefijo (`1.3.6.1.2.1.1.1.0` — sin punto inicial).
- **Subredes**: notación CIDR `192.168.99.0/24`.
- **Network ID ZeroTier**: 16 caracteres hex en minúsculas.
