"""
pg_metrics — reemplazo de `influx_db.py`.

Persiste series de tiempo del monitoreo en PostgreSQL (tabla `ups_metrics`,
layout EAV) y conserva la **misma interfaz pública** que la clase original
(`write_ups_data`, `query_ups_data`, `close`). Agrega `write_ups_data_batch`
para que el orquestador haga un único INSERT por ciclo en lugar de uno por
dispositivo (más rápido para 150 UPS).

Esquema (ver `migrations/006_ups_metrics.sql`):

    ups_metrics(id, ts, device_id, device_name, ip, sitio, ups_type,
                metric_name, metric_value)
"""
import os
import time
import math
import logging
from contextlib import contextmanager

from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)


def _is_numeric(value) -> bool:
    """True si value es int/float finito (excluye bool, NaN, inf)."""
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    return False


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
    # Circuit breaker                                                     #
    # ------------------------------------------------------------------ #
    def connect(self) -> bool:
        if time.time() - self.last_error_time < self.backoff_duration:
            return False
        try:
            self.pool = ConnectionPool(
                conninfo=self.dsn,
                min_size=1,
                max_size=int(os.environ.get('METRICS_POOL_MAX', 10)),
                kwargs={'autocommit': True, 'options': '-c timezone=UTC'},
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
        # Garantiza pool válido o aborta. Sin este guard, un fallo previo
        # dejaría `self.pool=None` y el `with self.pool.connection()` crashearía.
        if not self.pool and not self.connect():
            raise RuntimeError("pg_metrics: pool no disponible (en backoff)")
        with self.pool.connection() as c:
            yield c

    # ------------------------------------------------------------------ #
    # Escritura individual — firma idéntica a InfluxDBService             #
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
        rows = []
        for key, value in (data_dict or {}).items():
            if _is_numeric(value):
                rows.append((
                    device_id, ups_name, ip, sitio, ups_type, key, float(value),
                ))
        return self._insert_rows(rows)

    # ------------------------------------------------------------------ #
    # Escritura en lote — usar desde el orquestador (1 INSERT por ciclo)  #
    # ------------------------------------------------------------------ #
    def write_ups_data_batch(self, rows) -> bool:
        """Inserta múltiples tuplas en un solo executemany.

        `rows`: iterable de tuplas (device_id, device_name, ip, sitio,
        ups_type, metric_name, metric_value). El llamador es responsable de
        haber filtrado valores no numéricos.
        """
        rows = list(rows or [])
        return self._insert_rows(rows)

    def _insert_rows(self, rows) -> bool:
        if time.time() - self.last_error_time < self.backoff_duration:
            return False
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
        try:
            with self._conn() as conn:
                with conn.cursor() as cur:
                    sql = (
                        "SELECT ts, metric_name, metric_value "
                        "  FROM ups_metrics "
                        " WHERE device_id = %s "
                        "   AND ts >= NOW() - make_interval(hours => %s) "
                    )
                    params = [device_id, hours]
                    if field:
                        sql += "   AND metric_name = %s "
                        params.append(field)
                    sql += " ORDER BY ts ASC"
                    cur.execute(sql, params)
                    return [
                        {
                            'timestamp': r[0].isoformat(),
                            'campo':     r[1],
                            'valor':     float(r[2]) if r[2] is not None else None,
                        }
                        for r in cur.fetchall()
                    ]
        except Exception as e:
            logger.error("Error consultando ups_metrics: %s", e)
            self.last_error_time = time.time()
            return None

    # ------------------------------------------------------------------ #
    # Mantenimiento (llamado por APScheduler en run_monitor.py)           #
    # ------------------------------------------------------------------ #
    def cleanup_old(self) -> int:
        try:
            with self._conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM ups_metrics "
                        "WHERE ts < NOW() - make_interval(days => %s)",
                        (self.retention_days,),
                    )
                    deleted = cur.rowcount or 0
                    if deleted:
                        logger.info("Limpieza ups_metrics: %d filas", deleted)
                    return deleted
        except Exception as e:
            logger.warning("cleanup_old ups_metrics: %s", e)
            return 0

    def close(self):
        if self.pool:
            self.pool.close()
            self.pool = None


# Singleton + alias semántico (código histórico importa `influx_service`).
influx_service = PgMetricsService()
pg_metrics = influx_service
