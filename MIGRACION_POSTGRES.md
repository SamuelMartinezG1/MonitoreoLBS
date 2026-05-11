# Migración a PostgreSQL puro

Fecha: 2026-05-08

Este documento describe la migración del stack de **PostgreSQL + InfluxDB**
a **PostgreSQL único** y la verificación funcional realizada.

---

## 1. Cambios efectuados

### 1.1 Código
| Archivo | Acción |
|---------|--------|
| `app/services/influx_db.py` | **Eliminado**. |
| `app/services/pg_metrics.py` | **Nuevo**. Reemplazo drop-in: misma firma `write_ups_data`, `query_ups_data`, `close`. Exporta `influx_service` como alias para no tocar el resto del código. |
| `app/services/monitoring_service.py` | Imports cambiados a `from app.services.pg_metrics import influx_service`; mensajes de log actualizados. |
| `app/services/modbus_monitor.py` | Idem. |
| `app/base_datos.py` | Reescrito para usar las **columnas tipadas** reales de las tablas (no JSONB). Ahora coincide 1:1 con el schema. |

### 1.2 Esquema SQL — `migrations/`
| Migración | Contenido |
|-----------|-----------|
| `001_core_schema.sql` | **NUEVO**. `sitios` + `monitoreo_config` (antes vivían en `001_initial_schema.sql` del monolito). |
| `002_oid_profiles.sql` | Mapeos OID personalizados por dispositivo. |
| `003_telemetry_tables.sql` | `ups_telemetry_log` (10 min), `ups_recordings`, `ups_recording_data`. |
| `004_chart_history.sql` | `ups_chart_history` (gráficas). |
| `005_chart_history_extra.sql` | Campos extra (potencias, autonomía). |
| `006_ups_metrics.sql` | **NUEVO**. `ups_metrics` (EAV, reemplaza el bucket de InfluxDB). |

> Las migraciones se aplican automáticamente al primer arranque del
> contenedor `db` porque están montadas en `/docker-entrypoint-initdb.d/`.

### 1.3 Infraestructura
| Archivo | Cambio |
|---------|--------|
| `docker-compose.yml` | Servicio `influxdb` **eliminado**. Volumen `influxdata` **eliminado**. Todas las variables `INFLUXDB_*` **eliminadas**. Nuevo: `METRICS_RETENTION_DAYS`. |
| `requirements.txt` | `influxdb-client==1.43.0` **eliminado**. `reactivex` ya no es necesaria. |
| `.env.example` | Sin variables InfluxDB. Nueva: `METRICS_RETENTION_DAYS`. |
| `Dockerfile` | Sin cambios. |
| `README.md` | Diagrama y tabla de servicios actualizados. |

### 1.4 Tabla nueva — `ups_metrics`
```sql
CREATE TABLE ups_metrics (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id    INTEGER,
    device_name  TEXT,
    ip           TEXT,
    sitio        TEXT,
    ups_type     TEXT,
    metric_name  TEXT             NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL
);
```
Layout EAV (entity-attribute-value), igual que el modelo de tags+fields de
InfluxDB. Permite agregar nuevas métricas sin alterar el esquema.

Si crece mucho, puede convertirse en hypertable de TimescaleDB con:
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('ups_metrics', 'ts');
```

---

## 2. Verificación realizada

Se levantó un contenedor `postgres:15-alpine` efímero con las 6
migraciones montadas y se ejecutaron los métodos reales del servicio.

| # | Método | Resultado |
|---|--------|-----------|
| 1 | `GestorDB.obtener_monitoreo_ups()` | ✅ devuelve UPS con datos del sitio |
| 2 | `GestorDB.insertar_telemetria()` | ✅ inserta en `ups_telemetry_log` |
| 3 | `GestorDB.guardar_punto_historial()` | ✅ inserta en `ups_chart_history` |
| 4 | `pg_metrics.write_ups_data()` (alias `influx_service`) | ✅ inserta 4 métricas en `ups_metrics` |
| 5 | `pg_metrics.query_ups_data(device_id, hours=1)` | ✅ recupera las 4 métricas con timestamp |
| 6 | `GestorDB.limpiar_telemetria_antigua()` | ✅ borra 1 fila |
| 7 | `GestorDB.limpiar_historial_antiguo()` | ✅ borra 1 fila |
| 8 | `GestorDB.obtener_grabacion_activa()` | ✅ devuelve grabación en curso |
| 9 | `GestorDB.insertar_dato_grabacion()` | ✅ inserta en `ups_recording_data` |

Adicional:
- `python3 -m compileall app/ run_monitor.py` → sin errores.
- `yaml.safe_load(docker-compose.yml)` → válido, sin servicio `influxdb`.
- `grep influx_db|influxdb_client app/ run_monitor.py` → cero referencias.
- 8 tablas creadas tras `init`: `sitios`, `monitoreo_config`,
  `ups_oid_profiles`, `ups_telemetry_log`, `ups_recordings`,
  `ups_recording_data`, `ups_chart_history`, `ups_metrics`.

---

## 3. Cómo regenerar el ambiente desde cero

```bash
cd MonitoreoLBS
cp .env.example .env

# Postgres con migraciones automáticas
docker compose up -d db

# Servicio de monitoreo
docker compose up -d monitor

# Verificar
curl -s http://localhost:5000/health
docker compose exec db psql -U guia_app -d guia_instalacion -c "\dt"

# Activar Cloudflare Tunnel (opcional)
docker compose --profile tunnel up -d cloudflared
```

---

## 4. Compatibilidad hacia atrás

Si el resto del proyecto monolítico (LBS-SERVICIO-APP) sigue usando
`from app.services.influx_db import influx_service`, basta con cambiar
**una sola línea** en cada archivo:

```python
# Antes
from app.services.influx_db import influx_service
# Después
from app.services.pg_metrics import influx_service
```

La firma de `write_ups_data(ups_name, ip, data, device_id, sitio, ups_type)`
es idéntica → no hay otros cambios.
