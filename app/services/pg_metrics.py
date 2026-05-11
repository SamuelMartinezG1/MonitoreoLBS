"""
pg_metrics — reemplazo directo de `influx_db.py`.

Persiste series de tiempo del monitoreo en PostgreSQL (tabla `ups_metrics`)
en lugar de InfluxDB. Mantiene la **misma interfaz pública** que la clase
original (`write_ups_data`, `query_ups_data`, `close`) y exporta el singleton
`influx_service` para que `monitoring_service.py` y `modbus_monitor.py` no
necesiten cambios — basta con redirigir la importación.

Esquema esperado (ver `migrations/006_ups_metrics.sql`):

    CREATE TABLE ups_metrics (
        id            BIGSERIAL PRIMARY KEY,
        ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        device_id     INTEGER,
        device_name   TEXT,
        ip            TEXT,
        sitio         TEXT,
        ups_type      TEXT,
        metric_name   TEXT NOT NULL,
        metric_value  DOUBLE PRECISION NOT NULL
    );

Es un layout EAV (entity-attribute-value) para conservar la flexibilidad que
daba InfluxDB sin necesidad de re-migrar el esquema cada vez que se agrega
una métrica nueva.
"""
import os
import time
import logging
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)


class PgMetricsService:
    """API compatible con InfluxDBService pero respaldada por PostgreSQL."""

    def __init__(self):
        self.dsn = os.environ.get(
            'DATABASE_URL',
            'postgresql://guia_app:cambiame123@127.0.0.1:5432/guia_instalacion',
        )
        self.pool: ConnectionPool | None = None
        self.last_error_time = 0
        self.backoff_duration = 60  # segundos
        self.retention_days = int(os.environ.get('METRICS_RETENTION_DAYS', 90))

    # ------------------------------------------------------------------ #
    # Conexión / circuit breaker                                          #
    # ------------------------------------------------------------------ #
    def connect(self) -> bool:
        if time.time() - self.last_error_time < self.backoff_duration:
            return False
        try:
            self.pool = ConnectionPool(
                conninfo=self.dsn,
                min_size=1,
                max_size=int(os.environ.get('METRICS_POOL_MAX', 5)),
                kwargs={'autocommit': True},
                open=True,
            )
            logger.info("Conectado a PostgreSQL (pg_metrics)")
            self.last_error_time = 0
            return True
        except Exception as e:
            logger.error("Error conectando a PostgreSQL (pg_metrics): %s", e)
            self.last_error_time = time.time()
            return False

    @contextmanager
    def _conn(self):
        if not self.pool:
            self.connect()
        with self.pool.connection() as c:
            yield c

    # ------------------------------------------------------------------ #
    # Escritura — firma idéntica a InfluxDBService.write_ups_data         #
    # ------------------------------------------------------------------ #
    def write_ups_data(
        self,
        ups_name: str,
        ip: str,
        data_dict: dict,
        device_id=None,
        sitio=None,
        ups_type=None,
    ) -> bool:
        if time.time() - self.last_error_time < self.backoff_duration:
            return False
        if not self.pool and not self.connect():
            return False

        rows = []
        for key, value in (data_dict or {}).items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                rows.append((
                    device_id, ups_name, ip, sitio, ups_type, key, float(value),
                ))

        if not rows:
            return True

        try:
            with self._conn() as conn:
                with conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO ups_metrics
                            (device_id, device_name, ip, sitio, ups_type,
                             metric_name, metric_value)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        rows,
                    )
            return True
        except Exception as e:
            logger.error("Error escribiendo a ups_metrics: %s", e)
            self.last_error_time = time.time()
            self.pool = None
            return False

    # ------------------------------------------------------------------ #
    # Consulta histórica                                                  #
    # ------------------------------------------------------------------ #
    def query_ups_data(self, device_id, hours: int = 6, field: str | None = None):
        if time.time() - self.last_error_time < self.backoff_duration:
            return None
        if not self.pool and not self.connect():
            return None

        try:
            with self._conn() as conn:
                with conn.cursor() as cur:
                    sql = (
                        "SELECT ts, metric_name, metric_value "
                        "FROM ups_metrics "
                        "WHERE device_id = %s "
                        "  AND ts >= NOW() - make_interval(hours => %s) "
                    )
                    params = [device_id, hours]
                    if field:
                        sql += "  AND metric_name = %s "
                        params.append(field)
                    sql += "ORDER BY ts ASC"
                    cur.execute(sql, params)
                    return [
                        {
                            'timestamp': r[0].isoformat(),
                            'campo': r[1],
                            'valor': float(r[2]) if r[2] is not None else None,
                        }
                        for r in cur.fetchall()
                    ]
        except Exception as e:
            logger.error("Error consultando ups_metrics: %s", e)
            self.last_error_time = time.time()
            return None

    # ------------------------------------------------------------------ #
    # Mantenimiento                                                       #
    # ------------------------------------------------------------------ #
    def cleanup_old(self) -> int:
        if not self.pool and not self.connect():
            return 0
        try:
            with self._conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM ups_metrics "
                        "WHERE ts < NOW() - make_interval(days => %s)",
                        (self.retention_days,),
                    )
                    return cur.rowcount or 0
        except Exception as e:
            logger.warning("cleanup_old ups_metrics: %s", e)
            return 0

    def close(self):
        if self.pool:
            self.pool.close()
            self.pool = None


# Singleton — el código existente importa `influx_service`, mantenemos el
# alias para no tocar las rutas de monitoreo.
influx_service = PgMetricsService()
pg_metrics = influx_service  # alias semántico
