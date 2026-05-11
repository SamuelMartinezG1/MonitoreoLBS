# Auditoría — LBS-SERVICIO-APP-main

Fecha: 2026-05-08
Alcance: revisión completa del proyecto fuente y extracción del subsistema
de **monitoreo de equipos** (lógica Python) hacia un servicio independiente.

---

## 1. Inventario del proyecto original

### Volumetría
- ~50 módulos Python en `app/`
- 20 migraciones SQL en `app/migrations/`
- 40+ scripts de mantenimiento en `scripts/`
- ~15 templates Jinja2 + JS frontend SCADA
- Stack: Flask 3.1, Flask-SocketIO, PostgreSQL 15, InfluxDB 2.7, PySNMP, PyModbus, Eventlet, Gunicorn, Nginx, Docker Compose.

### Dominios funcionales detectados
| Dominio | Carpeta / archivos | ¿Se extrae? |
|--------|---------------------|------------|
| **Monitoreo UPS (SNMP/Modbus)** | `app/services/`, `app/services/protocols/`, `app/utils/ups_oids.py`, `app/socket_events.py` | ✅ SÍ |
| Rutas SCADA (CRUD UPS)          | `app/routes/monitoreo_routes.py` | parcial — ver §3 |
| Diagnóstico de red              | `app/routes/diagnostic_routes.py` | parcial |
| Inventario / sitios / OID profiles | `app/routes/inventario_routes.py` | parcial |
| Reportes PDF                    | `app/routes/reportes_routes.py`, `app/services/pdf_service.py` | ❌ |
| Vales de herramienta            | `app/routes/vales_routes.py` | ❌ |
| Calculadora NOM-001-SEDE        | `app/routes/calculator.py`, `app/calculos.py` | ❌ |
| Auth + permisos                 | `app/routes/auth.py`, `app/permisos.py`, `app/security.py` | ❌ (pero se mantiene puerta para integrarlo) |
| Guía rápida / docs              | `app/routes/guia_rapida.py` | ❌ |
| Tablero / dashboard             | `app/routes/dashboard.py` | ❌ |
| GITI sync                       | `app/services/giti_sync.py`, `app/routes/giti_routes.py` | ❌ |
| Frontend (HTML/CSS/JS)          | `app/templates/`, `app/static/` | ❌ (cliente vive aparte) |

---

## 2. Componentes extraídos (núcleo del monitoreo)

### Servicios (`app/services/`)
| Archivo | Líneas | Función |
|---------|-------|---------|
| `monitoring_service.py` | 381 | Hilo principal: poll SNMP cada N segundos, mapeo de variables, alarmas, persistencia en Postgres + Influx, emisión Socket.IO. |
| `modbus_monitor.py` | 458 | Hilo paralelo: poll Modbus TCP a UPS INVT industriales. |
| `influx_db.py` | 119 | Wrapper de `influxdb-client` para escribir series de tiempo. |
| `auto_detect.py` | 313 | Detección automática del tipo de UPS (Megatec vs UPS-MIB) por OID probing. |
| `mdns_service.py` | 99 | Anuncia el servicio en la LAN vía Zeroconf/Bonjour. |

### Protocolos (`app/services/protocols/`)
| Archivo | Líneas | Función |
|---------|-------|---------|
| `snmp_client.py` | 251 | Cliente SNMP genérico (asyncio + pysnmp 7). |
| `snmp_minimal_client.py` | 175 | Cliente para UPS Megatec/Voltronic/INVT (OIDs `.935`). |
| `snmp_upsmib_client.py` | 226 | Cliente UPS-MIB estándar (RFC 1628), 1-3 fases. |
| `snmp_scanner.py` | 379 | Escaneo masivo de subred + clasificación de equipos. |

### Utilidades (`app/utils/`)
| Archivo | Líneas | Función |
|---------|-------|---------|
| `ups_oids.py` | 289 | Catálogo de OIDs por familia de UPS, factores de conversión. |

### SQL extraído (`migrations/`)
- `009_add_oid_profiles_table.sql` — perfiles OID personalizados.
- `011_telemetry_tables.sql` — `ups_telemetry_log`, `ups_recordings`, `ups_recording_data`.
- `013_chart_history.sql` — `ups_chart_history` (buffer de gráficas).
- `017_chart_history_extra_fields.sql` — campos adicionales.

> ⚠️ **Nota:** las migraciones referencian indirectamente las tablas
> `monitoreo_config` y `sitios`, definidas en `001_initial_schema.sql` y
> `008_add_sitios_table.sql`. **Si despliegas este servicio aislado**, copia
> también esas dos migraciones o crea las tablas mínimas equivalentes.

---

## 3. Lo que NO se extrajo (y por qué)

| Componente | Razón |
|-----------|-------|
| Rutas Flask SCADA, vales, reportes, calculadora | Son UI específica de la app monolítica; no son lógica de monitoreo. |
| Sistema de auth (`Flask-Login` + permisos) | Este servicio se diseñó para vivir detrás de Cloudflare Access o detrás del backend principal; no necesita su propia auth. |
| Templates HTML / static / CSS / JS | Pertenecen al frontend; consumirán el servicio vía Socket.IO. |
| `pdf_service.py`, ReportLab, fpdf2, matplotlib | No es monitoreo; son reportes humanos. |

---

## 4. Hallazgos de la auditoría

### 4.1 Aciertos
- Buena separación capa-protocolo (`protocols/`) ↔ orquestador (`monitoring_service.py`).
- Manejo de `asyncio` correcto dentro de hilos (`asyncio.run` por ciclo).
- Buffer circular en Postgres + serie histórica en Influx → patrón sólido.
- Soporte de SNMP v1 y v2c con `mp_model` configurable por dispositivo.

### 4.2 Riesgos / deuda técnica detectada
1. **Imports lazy dentro del loop** (`from app.services.protocols... import` en cada ciclo): evita ciclos pero penaliza performance. Considerar caché de clases.
2. **`snmp_version` mal interpretado**: el código convierte `0→SNMPv1`, `1→SNMPv2c`, pero `mp_model` de pysnmp también usa 0/1. La línea 168 de `monitoring_service.py` (`'SNMPv1' if snmp_version == 0 else 'SNMPv2c'`) está OK pero hay otra (línea 124-126) que cambia el default a `1` cuando llega `None` — comentario dice “SNMPv2c” pero asigna `1` que efectivamente es v2c → consistente, solo confuso.
3. **Sin reintentos exponenciales**: si un UPS no responde durante varios ciclos, sigue intentándose cada `interval`. Convendría backoff por dispositivo offline.
4. **`network_mode: host`** en Docker → necesario para alcanzar la red ZeroTier, pero rompe aislamiento. Documentado en este repo extraído.
5. **`secret_key` por defecto** (`change-me`) en producción. El `.env.example` lo deja claro, pero conviene fail-fast si no se cambia.
6. **`base_datos.py` original (no incluido) tiene >2000 líneas**: en esta extracción se incluyó **una versión mínima** con solo los métodos que el monitor necesita (ver `app/base_datos.py`).
7. **No hay tests del servicio de monitoreo en sí** (los tests originales son de SNMP-sim y UI). Recomendado añadir tests con `pymodbus.mock` y un servidor SNMP simulado.
8. **Migraciones aplicadas “al iniciar”**: el proyecto original usa `app/migrations/runner.py`. En este extract se delega a `/docker-entrypoint-initdb.d/` de Postgres (solo se ejecuta la primera vez). Si vas a evolucionar el esquema, ejecuta `runner.py` desde un job aparte.

### 4.3 Seguridad
- ✅ Comunidades SNMP almacenadas en BD, no en código.
- ⚠️ Sin TLS hacia Postgres/Influx (usa `127.0.0.1`). Aceptable en host único.
- ⚠️ El endpoint `/health` no requiere auth — está bien para healthcheck pero **no expongas el resto del servicio sin un Cloudflare Access Policy** delante.

---

## 5. Preparación entregada

- ✅ **Docker Compose**: `db`, `influxdb`, `monitor`, `cloudflared` (perfil opcional).
- ✅ **Cloudflare Tunnel**: dos modos documentados (token y config-file) + script systemd preexistente.
- ✅ **Git**: `.gitignore` limpio (excluye `.env`, volúmenes, credenciales CF).
- ✅ **Healthcheck HTTP** + healthchecks de Postgres/Influx.
- ✅ **Variables de entorno** centralizadas en `.env.example`.
- ✅ **README** con quick-start, arquitectura y flujo Git.

---

## 6. Próximos pasos sugeridos

1. Copiar `001_initial_schema.sql` y `008_add_sitios_table.sql` a `migrations/` si se desplegará aislado.
2. Añadir un job de migraciones (`migrations/runner.py`) ejecutado vía `docker compose run`.
3. Escribir tests de integración con un simulador SNMP local (existe `tests/simulators/ups_snmp_sim.py` en el proyecto original — portarlo).
4. Configurar **Cloudflare Access** para que `monitor.tudominio.com` requiera SSO antes de exponer el panel.
5. Añadir `prometheus-client` y exportar métricas del propio servicio (ciclos, tiempo de poll, errores por UPS).
6. CI/CD: GitHub Actions con `docker buildx` y push a un registry.

---

*Auditoría generada automáticamente sobre el snapshot del repositorio.*
