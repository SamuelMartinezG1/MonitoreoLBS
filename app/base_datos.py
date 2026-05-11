"""
GestorDB — Capa de acceso a PostgreSQL para el servicio de monitoreo.

Versión adaptada del `app/base_datos.py` original (LBS-SERVICIO-APP) que
mantiene EXACTAMENTE las firmas usadas por:

    - app/services/monitoring_service.py
    - app/services/modbus_monitor.py
    - app/services/pg_metrics.py        (reemplazo de InfluxDB)

Únicas tablas tocadas:
    monitoreo_config, sitios, ups_oid_profiles,
    ups_telemetry_log, ups_recordings, ups_recording_data,
    ups_chart_history, ups_metrics
"""
import os
import logging
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Pool                                                                         #
# --------------------------------------------------------------------------- #
class _Pool:
    def __init__(self, dsn: str):
        self.pool = ConnectionPool(
            conninfo=dsn,
            min_size=1,
            max_size=int(os.environ.get('DB_POOL_MAX', 10)),
            kwargs={'autocommit': True, 'row_factory': dict_row},
            open=True,
        )

    @contextmanager
    def get_connection(self):
        with self.pool.connection() as conn:
            yield conn

    def get_row_factory(self):
        return dict_row

    def close(self):
        self.pool.close()


# --------------------------------------------------------------------------- #
# GestorDB                                                                     #
# --------------------------------------------------------------------------- #
class GestorDB:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            dsn = os.environ.get(
                'DATABASE_URL',
                'postgresql://guia_app:cambiame123@127.0.0.1:5432/guia_instalacion',
            )
            cls._instance.pool = _Pool(dsn)
        return cls._instance

    # ------------------------------------------------------------------ #
    # Configuración de dispositivos                                       #
    # ------------------------------------------------------------------ #
    def obtener_monitoreo_ups(self):
        """Lista de UPS habilitados para polling."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT m.id, m.nombre, m.ip, m.protocolo,
                           m.snmp_port, m.snmp_community, m.snmp_version,
                           m.modbus_port, m.modbus_unit_id,
                           m.ups_type, m.fases,
                           s.nombre AS sitio_nombre
                      FROM monitoreo_config m
                      LEFT JOIN sitios s ON s.id = m.sitio_id
                     WHERE COALESCE(m.activo, TRUE) = TRUE
                    """
                )
                return [dict(r) for r in cur.fetchall()]
        except Exception as e:
            logger.error("obtener_monitoreo_ups: %s", e)
            return []

    def obtener_oid_profile(self, device_id: int):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT variable_name, oid, factor, unit "
                    "  FROM ups_oid_profiles WHERE device_id = %s",
                    (device_id,),
                )
                rows = cur.fetchall()
                return [dict(r) for r in rows] if rows else None
        except Exception as e:
            logger.debug("obtener_oid_profile: %s", e)
            return None

    # ------------------------------------------------------------------ #
    # Telemetría — buffer circular (10 min)                              #
    # ------------------------------------------------------------------ #
    def insertar_telemetria(self, device_id: int, datos: dict) -> bool:
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO ups_telemetry_log (
                        device_id,
                        voltaje_in_l1, voltaje_in_l2, voltaje_in_l3,
                        voltaje_out_l1, voltaje_out_l2, voltaje_out_l3,
                        frecuencia_in, frecuencia_out,
                        corriente_out_l1, corriente_out_l2, corriente_out_l3,
                        carga_pct, bateria_pct, voltaje_bateria, temperatura,
                        power_mode, estado
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        device_id,
                        datos.get('input_voltage_l1'), datos.get('input_voltage_l2'), datos.get('input_voltage_l3'),
                        datos.get('output_voltage_l1'), datos.get('output_voltage_l2'), datos.get('output_voltage_l3'),
                        datos.get('input_frequency'), datos.get('output_frequency'),
                        datos.get('output_current_l1'), datos.get('output_current_l2'), datos.get('output_current_l3'),
                        datos.get('output_load'), datos.get('battery_capacity'), datos.get('battery_voltage'),
                        datos.get('temperature'),
                        datos.get('power_source'), datos.get('estado', 'online'),
                    ),
                )
                return True
        except Exception as e:
            logger.debug("insertar_telemetria: %s", e)
            return False

    def limpiar_telemetria_antigua(self, minutos: int = 10) -> int:
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "DELETE FROM ups_telemetry_log "
                    "WHERE timestamp < NOW() - make_interval(mins => %s)",
                    (minutos,),
                )
                return cur.rowcount or 0
        except Exception as e:
            logger.debug("limpiar_telemetria_antigua: %s", e)
            return 0

    # ------------------------------------------------------------------ #
    # Historial de gráficas (~30 s por punto)                            #
    # ------------------------------------------------------------------ #
    def guardar_punto_historial(self, device_id: int, datos: dict) -> bool:
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO ups_chart_history (
                        device_id,
                        voltaje_in_l1, voltaje_in_l2, voltaje_in_l3,
                        voltaje_out_l1, voltaje_out_l2, voltaje_out_l3,
                        frecuencia_in, frecuencia_out,
                        corriente_out_l1, corriente_out_l2, corriente_out_l3,
                        carga_pct, bateria_pct, temperatura,
                        voltaje_bateria, power_mode, power_factor,
                        active_power, apparent_power, battery_remain_time
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        device_id,
                        datos.get('input_voltage_l1'), datos.get('input_voltage_l2'), datos.get('input_voltage_l3'),
                        datos.get('output_voltage_l1'), datos.get('output_voltage_l2'), datos.get('output_voltage_l3'),
                        datos.get('input_frequency'), datos.get('output_frequency'),
                        datos.get('output_current_l1'), datos.get('output_current_l2'), datos.get('output_current_l3'),
                        datos.get('output_load'), datos.get('battery_capacity'), datos.get('temperature'),
                        datos.get('battery_voltage'), datos.get('power_source'), datos.get('power_factor'),
                        datos.get('active_power'), datos.get('apparent_power'), datos.get('battery_runtime'),
                    ),
                )
                return True
        except Exception as e:
            logger.error("guardar_punto_historial: %s", e)
            return False

    def limpiar_historial_antiguo(self, dias: int = 30) -> int:
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "DELETE FROM ups_chart_history "
                    "WHERE timestamp < NOW() - make_interval(days => %s)",
                    (dias,),
                )
                deleted = cur.rowcount or 0
                if deleted:
                    logger.info("Limpieza historial: %d filas", deleted)
                return deleted
        except Exception as e:
            logger.warning("limpiar_historial_antiguo: %s", e)
            return 0

    # ------------------------------------------------------------------ #
    # Grabaciones manuales                                                #
    # ------------------------------------------------------------------ #
    def obtener_grabacion_activa(self, device_id: int):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT id FROM ups_recordings "
                    "WHERE device_id = %s AND activa = TRUE "
                    "ORDER BY id DESC LIMIT 1",
                    (device_id,),
                )
                row = cur.fetchone()
                return dict(row) if row else None
        except Exception as e:
            logger.debug("obtener_grabacion_activa: %s", e)
            return None

    def insertar_dato_grabacion(self, recording_id: int, datos: dict) -> bool:
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO ups_recording_data (
                        recording_id,
                        voltaje_in_l1, voltaje_in_l2, voltaje_in_l3,
                        voltaje_out_l1, voltaje_out_l2, voltaje_out_l3,
                        frecuencia_in, frecuencia_out,
                        corriente_out_l1, corriente_out_l2, corriente_out_l3,
                        carga_pct, bateria_pct, voltaje_bateria, temperatura,
                        power_mode, estado
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        recording_id,
                        datos.get('input_voltage_l1'), datos.get('input_voltage_l2'), datos.get('input_voltage_l3'),
                        datos.get('output_voltage_l1'), datos.get('output_voltage_l2'), datos.get('output_voltage_l3'),
                        datos.get('input_frequency'), datos.get('output_frequency'),
                        datos.get('output_current_l1'), datos.get('output_current_l2'), datos.get('output_current_l3'),
                        datos.get('output_load'), datos.get('battery_capacity'), datos.get('battery_voltage'),
                        datos.get('temperature'),
                        datos.get('power_source'), datos.get('estado', 'online'),
                    ),
                )
                return True
        except Exception as e:
            logger.debug("insertar_dato_grabacion: %s", e)
            return False
