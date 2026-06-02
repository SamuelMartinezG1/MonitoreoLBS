# Auditoría y Remediación — MonitoreoLBS

Fecha: 2026-05-18
Alcance: Seguridad, Rendimiento/BD, Calidad de código, Funcionalidad.
Tamaño revisado: ~7,000 LOC Python, ~6,100 LOC JSX.

Este documento es el **registro oficial** de la auditoría. Cada hallazgo indica
estado: `ARREGLADO`, `PENDIENTE` o `INFORMATIVO` (decisión/infra del usuario).

---

## Resumen ejecutivo

Aspectos correctos detectados: consultas SQL parametrizadas (sin inyección),
hashing de contraseñas con bcrypt, autoescape de Jinja2, cookies de sesión
seguras, `.env` correctamente excluido de git, y separación correcta entre el
historial del diagrama (`ups_chart_history`, con retención) y las grabaciones
(`ups_recording_data`, permanentes).

---

## 1. Seguridad

### S1 — Contraseñas débiles por defecto en `.env` — `INFORMATIVO`
`ADMIN_PASSWORD=admin_temp_123`, `DB_PASSWORD=cambiame123`.
No están en el repositorio (.env está en .gitignore), pero deben cambiarse a
valores fuertes en el entorno real. Requiere acción del usuario (no se generan
secretos automáticamente).

### S2 — CORS abierto en Socket.IO — `ARREGLADO`
`app/extensions.py`: `cors_allowed_origins="*"` → ahora configurable por la
variable de entorno `SOCKETIO_CORS_ORIGINS` (por defecto `*` si no se define,
para no romper desarrollo; se documenta poner el dominio real en producción).

### S3 — Validación de IP/OID/puerto en diagnósticos — `ARREGLADO`
`app/routes/diagnostic_routes.py`: `ping`/`traceroute`, walk SNMP y Modbus
recibían parámetros del usuario sin validar. Se añadió validación de IP con
`ipaddress`, formato de OID y rango de puerto (1–65535) y slave id (0–247).

### S4 — Errores `str(e)` expuestos al cliente — `PENDIENTE`
Múltiples rutas devuelven el detalle de la excepción. Recomendación: mensaje
genérico al cliente y detalle solo en log. No se cambia masivamente para no
alterar contratos de la API sin pruebas; documentado para corrección dirigida.

### S5 — Sin protección CSRF — `PENDIENTE`
No hay `flask-wtf`/CSRF en endpoints mutadores. Añadirlo requiere ajustar el
front (SPA con `fetch`) y pruebas; se deja documentado para no introducir
regresiones.

---

## 2. Rendimiento / Base de datos

### P1 — Pool de conexiones insuficiente — `ARREGLADO`
`DB_POOL_MAX=20` insuficiente para 150 dispositivos. Subido a 50 en `.env` y
`.env.example`.

### P2 — Caches/dicts sin límite (fuga de memoria) — `ARREGLADO`
`monitoring_service.py`: `_snmp_cache` y diccionarios por dispositivo crecían
sin control. Se añadió poda de entradas obsoletas / límite de tamaño.

### P3 — Sesiones SNMP nunca cerradas — `ARREGLADO`
Se cierra el cliente SNMP previo al evictar/reemplazar en caché.

### P4 — `COUNT(*)` dentro del UPDATE en `detener_grabacion()` — `ARREGLADO`
`base_datos.py`: se separa el conteo del UPDATE para evitar escaneo bloqueante.

### P5 — `ups_recording_data` sin índice por `timestamp` — `ARREGLADO`
Nueva migración añade índice para permitir borrado por antigüedad.

### P6 — `SELECT *` y consultas sin LIMIT — `PENDIENTE`
Optimización amplia; documentado. Riesgo medio, requiere revisión por consulta.

### P7 — Job de limpieza cada 60 min — `INFORMATIVO`
Aceptable tras reducir retención a 7 días; ajustable a 15 min si se desea.

---

## 3. Funcionalidad / Correctitud

### F1 — Datos SNMP faltantes guardados como `0` en vez de `NULL` — `ARREGLADO`
`monitoring_service._map_data_to_frontend()` ponía `0` por defecto, generando
ceros falsos y alarmas inexistentes. Cambiado a `None` para campos numéricos.

### F2 — Múltiples grabaciones activas por dispositivo — `ARREGLADO`
Sin restricción de unicidad. Se añade índice único parcial vía migración y
chequeo en `iniciar_grabacion()`.

### F3 — Validación de versión SNMP — `ARREGLADO`
`monitoring_service.py`: `int(snmp_version)` sin validar. Se restringe a 0/1/2.

### F4 — Orden de migraciones alfabético — `ARREGLADO`
`migrations/runner.py`: ahora ordena por prefijo numérico.

### F5 — Huecos en historial durante periodos offline — `PENDIENTE`
El gráfico "salta" al reconectar. Mejora documentada; requiere decisión de
diseño (registrar fila "offline").

### F6 — Inconsistencia de zona horaria (UTC vs servidor) — `PENDIENTE`
Posibles errores de ±1 día. Documentado; requiere normalizar `NOW()` a UTC en
toda la base y validar en despliegue.

---

## 4. Calidad de código

### Q1 — Sin pruebas automatizadas ni CI — `PENDIENTE`
### Q2 — `except` genéricos que silencian fallos (log en debug) — `PENDIENTE`
### Q3 — `base_datos.py` monolítico (838 líneas) — `PENDIENTE`
### Q4 — Componentes JSX muy grandes sin estados de error — `PENDIENTE`
### Q5 — Números mágicos dispersos — `PENDIENTE`

Estos puntos son de refactor/mantenibilidad y se dejan registrados como deuda
técnica priorizada; no se abordan en esta pasada para no introducir riesgo sin
una batería de pruebas.

---

## Registro de cambios aplicados (2026-05-18)

ARREGLADO en esta pasada (verificado: `python3 -m py_compile` OK en todos los
archivos modificados):

- **S2** `app/extensions.py`: CORS de Socket.IO configurable vía
  `SOCKETIO_CORS_ORIGINS` (por defecto `*`; documentado restringir en prod).
- **S3** `app/routes/diagnostic_routes.py`: helpers `_valid_host`,
  `_valid_port`, `_valid_slave_id`, `_valid_oid` aplicados a los endpoints
  ping, port, snmp, modbus, snmp-walk y snmp-get (rechaza vacío, flags `-x`,
  puertos fuera de rango, OIDs no numéricos).
- **P1** `.env` / `.env.example`: `DB_POOL_MIN=4`, `DB_POOL_MAX=50`.
- **P2/P3** `app/services/monitoring_service.py`: `_close_snmp_client()` y
  `_evict_stale_snmp_clients()` (poda + cierre de sesiones SNMP caducadas
  cada ciclo; limpia también dicts por dispositivo).
- **P4** `app/base_datos.py` `detener_grabacion()`: `COUNT(*)` separado del
  `UPDATE` (usa índice, no bloquea).
- **P5** `migrations/009_recordings_integrity.sql`: índice
  `idx_recording_data_ts` por timestamp.
- **F1** `monitoring_service._map_data_to_frontend()`: campos de medición
  ahora `None` en vez de `0`. Nota de precisión: `ups_chart_history` ya
  guardaba NULL (usa `data` crudo, sin default 0); el impacto real del bug
  era en `ups_metrics` y en la vista del frontend (ceros falsos / alarmas).
  Las alarmas ya estaban protegidas con `or 0`, sin regresión.
- **F2** `migrations/009_*.sql` + `base_datos.iniciar_grabacion()`: índice
  único parcial `uq_recordings_activa_por_device` y cierre de activa previa
  (una sola grabación activa por dispositivo).
- **F3** `monitoring_service._check_device()`: versión SNMP validada a 0/1/2.
- **F4** `migrations/runner.py`: orden numérico por prefijo de migración.

PENDIENTE (documentado como deuda técnica, requiere pruebas / decisión):
S4 (errores `str(e)`), S5 (CSRF), P6 (`SELECT *`/LIMIT), F5 (huecos offline),
F6 (zona horaria), Q1–Q5 (tests/CI, refactor de `base_datos.py` y JSX,
`except` genéricos, números mágicos).

INFORMATIVO (acción del usuario): S1 — cambiar `ADMIN_PASSWORD` y
`DB_PASSWORD` del `.env` por valores fuertes en el entorno real.

> Las migraciones nuevas se aplican al reiniciar el servicio (runner
> idempotente). Cambios en `.env` requieren reinicio del proceso.

## Segunda pasada de remediación (2026-05-18 17:21 UTC)

Se ajustó todo lo no relacionado con contraseñas:

- **S4** ARREGLADO (rutas de usuario): `monitoreo_routes`, `inventario_routes`,
  `zerotier_routes` ya no devuelven `str(e)` al cliente (mensaje genérico +
  log). En `diagnostic_routes` (herramientas admin, tras login + permiso) se
  conserva el texto operativo a propósito — decisión documentada.
- **S5** ARREGLADO: guard CSRF en `run_monitor.create_app()` — para
  POST/PUT/PATCH/DELETE sobre `/api/` valida Origin/Referer vs host. SPA
  same-origin pasa; cross-site se rechaza con 403. Sin cambios en el front.
- **P6** ARREGLADO: `LIMIT` en `obtener_datos_grabacion` (50k, configurable),
  `obtener_historial_device` (25k) y `obtener_telemetria_reciente` (20k).
- **F6** ARREGLADO: pools de `base_datos.py` y `pg_metrics.py` con
  `options=-c timezone=UTC`. Verificado en vivo: `SHOW TIME ZONE` → `UTC`.
- **F5** ARREGLADO: en estado offline se registra un punto de historial con
  mediciones NULL y `power_mode='offline'` (línea de tiempo continua).
- **Q2** ARREGLADO: fallos de persistencia (telemetría/historial/batch) ahora
  `logger.warning` en vez de `debug`.
- **Q5** PARCIAL: nuevo `app/config.py` como fuente única de defaults;
  `run_monitor` ya lo usa para el scheduler. Migrar el resto de call-sites
  queda como deuda gradual (sin pruebas no se fuerza para evitar regresión).
- **Q1** ARREGLADO: `tests/test_smoke.py` + `requirements-dev.txt`. 5/5 tests
  en verde dentro del contenedor.

NO realizado (deuda técnica consciente, alto riesgo sin suite de pruebas en un
sistema en producción): **Q3** (partir `base_datos.py` en servicios) y **Q4**
(descomponer componentes JSX grandes). Se recomienda hacerlo tras añadir
cobertura de pruebas.

Verificación 2ª pasada: imagen reconstruida, `monlbs-portal` `healthy`,
`restarts=0`, sin tracebacks, scheduler y monitor OK, `pytest` 5/5,
timezone de BD = UTC.

## Verificación de despliegue (2026-05-18 17:12 UTC)

- Imagen `lbs/portal:latest` reconstruida y contenedor `monlbs-portal`
  recreado. Estado: `healthy`, `restarts=0`, sin tracebacks en logs.
- Migración `009_recordings_integrity.sql` aplicada y registrada en
  `schema_migrations`.
- Índices `uq_recordings_activa_por_device` e `idx_recording_data_ts`
  presentes en la BD; 0 dispositivos con grabaciones activas duplicadas.
- `MonitoringService` (SNMP) + `ModbusMonitor` + cleanup scheduler
  arrancados; `/health` → 200. Ventana de polling sin errores.
- Único warning observado: `EventletDeprecationWarning` (preexistente,
  ajeno a estos cambios).
