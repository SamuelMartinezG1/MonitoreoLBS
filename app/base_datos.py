"""
GestorDB — Capa de acceso a PostgreSQL para el portal LBS Monitor.

Singleton con un pool psycopg 3 lazy (no abre conexiones al importar). Toda
la app comparte la misma instancia vía `current_app.db` o `GestorDB()`.

Tablas tocadas:
    sitios, monitoreo_config, ups_oid_profiles,
    ups_telemetry_log, ups_recordings, ups_recording_data,
    ups_chart_history, ups_metrics,
    users, user_permissions, schema_migrations
"""
import os
import logging
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Pool — lazy: no abre conexiones hasta el primer uso.                         #
# --------------------------------------------------------------------------- #
class _Pool:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self._pool: ConnectionPool | None = None

    def _ensure(self):
        if self._pool is None:
            self._pool = ConnectionPool(
                conninfo=self.dsn,
                min_size=int(os.environ.get('DB_POOL_MIN', 2)),
                max_size=int(os.environ.get('DB_POOL_MAX', 20)),
                # options=-c timezone=UTC: fuerza UTC en cada sesión para
                # evitar desfases de ±1 día entre NOW() del servidor y el
                # scheduler/consultas (F6 de la auditoría).
                kwargs={
                    'autocommit': True,
                    'row_factory': dict_row,
                    'options': '-c timezone=UTC',
                },
                open=True,
            )
        return self._pool

    @property
    def pool(self) -> ConnectionPool:
        return self._ensure()

    @contextmanager
    def get_connection(self):
        with self._ensure().connection() as conn:
            yield conn

    def get_row_factory(self):
        return dict_row

    def close(self):
        if self._pool is not None:
            self._pool.close()
            self._pool = None


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

    # ====================================================================== #
    # Configuración de dispositivos                                          #
    # ====================================================================== #
    def obtener_monitoreo_ups(self):
        """Lista de UPS habilitados para polling."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT m.*, s.nombre AS sitio_nombre
                      FROM monitoreo_config m
                      LEFT JOIN sitios s ON s.id = m.sitio_id
                     WHERE COALESCE(m.activo, TRUE) = TRUE
                     ORDER BY m.nombre
                    """
                )
                return [dict(r) for r in cur.fetchall()]
        except Exception as e:
            logger.error("obtener_monitoreo_ups: %s", e)
            return []

    def agregar_monitoreo_ups(self, datos):
        """Crea un dispositivo en monitoreo_config."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO monitoreo_config
                        (ip, modbus_port, modbus_unit_id, nombre, protocolo,
                         snmp_community, snmp_port, snmp_version,
                         ups_type, fases, sitio_id, notas_tecnicas, activo)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        datos['ip'],
                        int(datos.get('modbus_port', datos.get('port', 502)) or 502),
                        int(datos.get('modbus_unit_id', datos.get('slave_id', 1)) or 1),
                        datos.get('nombre', 'UPS'),
                        datos.get('protocolo', 'modbus'),
                        datos.get('snmp_community', 'public'),
                        int(datos.get('snmp_port', 161) or 161),
                        int(datos.get('snmp_version', 1) or 1),
                        datos.get('ups_type', 'invt_enterprise'),
                        int(datos['fases']) if datos.get('fases') else None,
                        int(datos['sitio_id']) if datos.get('sitio_id') else None,
                        datos.get('notas_tecnicas'),
                        bool(datos.get('activo', True)),
                    ),
                )
                return True
        except Exception as e:
            logger.error("agregar_monitoreo_ups: %s", e)
            return False

    def eliminar_monitoreo_ups(self, id_device):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM monitoreo_config WHERE id = %s", (id_device,))
                return True
        except Exception as e:
            logger.error("eliminar_monitoreo_ups: %s", e)
            return False

    # ====================================================================== #
    # Log de eventos NATIVO del UPS (ups_event_log)                           #
    # ====================================================================== #
    def insertar_eventos_ups(self, device_id, eventos):
        """Inserta eventos del UPS con dedupe (ON CONFLICT DO NOTHING).
        `eventos`: lista de dicts {ts, fuente, evento, nivel, raw}.
        Devuelve el número de filas realmente insertadas."""
        if not eventos:
            return 0
        insertados = 0
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                for ev in eventos:
                    if not ev.get('evento'):
                        continue
                    cur.execute(
                        """
                        INSERT INTO ups_event_log (device_id, ts, fuente, evento, nivel, raw)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (device_id, ts, evento) DO NOTHING
                        """,
                        (device_id, ev.get('ts'), ev.get('fuente'),
                         ev['evento'], ev.get('nivel', 'info'), ev.get('raw')),
                    )
                    insertados += cur.rowcount or 0
            return insertados
        except Exception as e:
            logger.error("insertar_eventos_ups: %s", e)
            return insertados

    def obtener_eventos_ups(self, device_id, limit=500, nivel=None):
        """Eventos de un UPS, más recientes primero. Filtro opcional por nivel."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                if nivel:
                    cur.execute(
                        """
                        SELECT id, device_id, ts, fuente, evento, nivel, raw, created_at
                          FROM ups_event_log
                         WHERE device_id = %s AND nivel = %s
                         ORDER BY ts DESC NULLS LAST, id DESC
                         LIMIT %s
                        """,
                        (device_id, nivel, limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, device_id, ts, fuente, evento, nivel, raw, created_at
                          FROM ups_event_log
                         WHERE device_id = %s
                         ORDER BY ts DESC NULLS LAST, id DESC
                         LIMIT %s
                        """,
                        (device_id, limit),
                    )
                return [dict(r) for r in cur.fetchall()]
        except Exception as e:
            logger.error("obtener_eventos_ups: %s", e)
            return []

    def resumen_eventos_ups(self, device_id):
        """Conteo por nivel + total de descargas (eventos 'discharg'/'EOD')."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT
                        COUNT(*)                                              AS total,
                        COUNT(*) FILTER (WHERE nivel = 'critical')            AS criticos,
                        COUNT(*) FILTER (WHERE nivel = 'warning')             AS warnings,
                        COUNT(*) FILTER (WHERE evento ILIKE '%%discharg%%')   AS descargas,
                        COUNT(*) FILTER (WHERE evento ILIKE '%%EOD%%')        AS eod,
                        MIN(ts) AS desde, MAX(ts) AS hasta
                      FROM ups_event_log
                     WHERE device_id = %s
                    """,
                    (device_id,),
                )
                row = cur.fetchone()
                return dict(row) if row else {}
        except Exception as e:
            logger.error("resumen_eventos_ups: %s", e)
            return {}

    # ====================================================================== #
    # Sitios                                                                  #
    # ====================================================================== #
    def obtener_sitios(self):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT * FROM sitios ORDER BY numero_sitio NULLS LAST, nombre")
                return [dict(r) for r in cur.fetchall()]
        except Exception as e:
            logger.error("obtener_sitios: %s", e)
            return []

    def agregar_sitio(self, datos):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO sitios
                        (numero_sitio, nombre, subred_lan, router_ip_lan, router_ip_zt,
                         router_node_id, router_firmware, fecha_despliegue, notas)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        int(datos['numero_sitio']),
                        datos['nombre'],
                        datos.get('subred_lan'),
                        datos.get('router_ip_lan'),
                        datos.get('router_ip_zt'),
                        datos.get('router_node_id'),
                        datos.get('router_firmware'),
                        datos.get('fecha_despliegue') or None,
                        datos.get('notas'),
                    ),
                )
                return True
        except Exception as e:
            logger.error("agregar_sitio: %s", e)
            return False

    def actualizar_sitio(self, sitio_id, datos):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    UPDATE sitios SET
                        numero_sitio     = COALESCE(%s, numero_sitio),
                        nombre           = COALESCE(%s, nombre),
                        subred_lan       = %s,
                        router_ip_lan    = %s,
                        router_ip_zt     = %s,
                        router_node_id   = %s,
                        router_firmware  = %s,
                        fecha_despliegue = %s,
                        notas            = %s
                     WHERE id = %s
                    """,
                    (
                        int(datos['numero_sitio']) if datos.get('numero_sitio') else None,
                        datos.get('nombre'),
                        datos.get('subred_lan'),
                        datos.get('router_ip_lan'),
                        datos.get('router_ip_zt'),
                        datos.get('router_node_id'),
                        datos.get('router_firmware'),
                        datos.get('fecha_despliegue') or None,
                        datos.get('notas'),
                        sitio_id,
                    ),
                )
                return True
        except Exception as e:
            logger.error("actualizar_sitio: %s", e)
            return False

    def eliminar_sitio(self, sitio_id):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM sitios WHERE id = %s", (sitio_id,))
                return True
        except Exception as e:
            logger.error("eliminar_sitio: %s", e)
            return False

    def asignar_dispositivo_sitio(self, dev_id, sitio_id):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE monitoreo_config SET sitio_id = %s WHERE id = %s",
                    (sitio_id, dev_id),
                )
                return True
        except Exception as e:
            logger.error("asignar_dispositivo_sitio: %s", e)
            return False

    def actualizar_notas_dispositivo(self, dev_id, notas):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE monitoreo_config SET notas_tecnicas = %s WHERE id = %s",
                    (notas, dev_id),
                )
                return True
        except Exception as e:
            logger.error("actualizar_notas_dispositivo: %s", e)
            return False

    # ====================================================================== #
    # Perfiles OID                                                            #
    # ====================================================================== #
    def obtener_oid_profile(self, device_id: int):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT variable_name, oid, factor, unit, data_type, description "
                    "  FROM ups_oid_profiles WHERE device_id = %s "
                    "  ORDER BY variable_name",
                    (device_id,),
                )
                rows = cur.fetchall()
                return [dict(r) for r in rows] if rows else None
        except Exception as e:
            logger.debug("obtener_oid_profile: %s", e)
            return None

    def guardar_oid_profile(self, device_id: int, mappings: list) -> bool:
        """Reemplaza el perfil completo de OIDs de un dispositivo."""
        try:
            with self.pool.get_connection() as conn:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute(
                            "DELETE FROM ups_oid_profiles WHERE device_id = %s",
                            (device_id,),
                        )
                        for m in (mappings or []):
                            cur.execute(
                                """
                                INSERT INTO ups_oid_profiles
                                    (device_id, variable_name, oid, data_type,
                                     factor, unit, description)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                """,
                                (
                                    device_id,
                                    m['variable_name'],
                                    m['oid'],
                                    m.get('data_type', 'Integer'),
                                    float(m.get('factor', 1.0)),
                                    m.get('unit', ''),
                                    m.get('description', ''),
                                ),
                            )
            return True
        except Exception as e:
            logger.error("guardar_oid_profile: %s", e)
            return False

    # ====================================================================== #
    # Telemetría — buffer circular (10 min)                                  #
    # ====================================================================== #
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
                        power_mode, estado,
                        temperatura_ambiente, ciclos_descarga
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
                        datos.get('ambient_temperature'), datos.get('battery_cycles'),
                    ),
                )
                return True
        except Exception as e:
            logger.debug("insertar_telemetria: %s", e)
            return False

    def obtener_telemetria_reciente(self, device_id, minutos=10):
        """Retorna últimos N minutos del buffer circular."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT * FROM ups_telemetry_log
                     WHERE device_id = %s
                       AND timestamp >= NOW() - make_interval(mins => %s)
                     ORDER BY timestamp ASC
                     LIMIT 20000
                    """,
                    (device_id, minutos),
                )
                rows = [dict(r) for r in cur.fetchall()]
                for row in rows:
                    if row.get('timestamp'):
                        row['timestamp'] = row['timestamp'].isoformat()
                return rows
        except Exception as e:
            logger.debug("obtener_telemetria_reciente: %s", e)
            return []

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

    # ====================================================================== #
    # Historial de gráficas (~30 s por punto)                                #
    # ====================================================================== #
    def obtener_ultimo_estado(self, device_id):
        """Última lectura de ups_chart_history (para evitar delay en UI)."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT voltaje_in_l1, voltaje_in_l2, voltaje_in_l3,
                           voltaje_out_l1, voltaje_out_l2, voltaje_out_l3,
                           frecuencia_in, frecuencia_out,
                           corriente_out_l1, corriente_out_l2, corriente_out_l3,
                           carga_pct, bateria_pct, temperatura,
                           voltaje_bateria, power_mode, power_factor,
                           active_power, apparent_power, battery_remain_time,
                           temperatura_ambiente, ciclos_descarga, timestamp
                      FROM ups_chart_history
                     WHERE device_id = %s
                     ORDER BY timestamp DESC
                     LIMIT 1
                    """,
                    (device_id,),
                )
                row = cur.fetchone()
                if row:
                    r = dict(row)
                    if r.get('timestamp'):
                        r['timestamp'] = r['timestamp'].isoformat()
                    return r
                return None
        except Exception as e:
            logger.debug("obtener_ultimo_estado: %s", e)
            return None

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
                        active_power, apparent_power, battery_remain_time,
                        temperatura_ambiente, ciclos_descarga
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
                        datos.get('ambient_temperature'), datos.get('battery_cycles'),
                    ),
                )
                return True
        except Exception as e:
            logger.error("guardar_punto_historial: %s", e)
            return False

    def obtener_historial_device(self, device_id, horas=6):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT timestamp, voltaje_in_l1, voltaje_in_l2, voltaje_in_l3,
                           voltaje_out_l1, voltaje_out_l2, voltaje_out_l3,
                           frecuencia_in, frecuencia_out, temperatura,
                           corriente_out_l1, corriente_out_l2, corriente_out_l3,
                           carga_pct, bateria_pct,
                           voltaje_bateria, power_mode, power_factor,
                           active_power, apparent_power, battery_remain_time,
                           temperatura_ambiente, ciclos_descarga
                      FROM ups_chart_history
                     WHERE device_id = %s
                       AND timestamp >= NOW() - make_interval(hours => %s)
                     ORDER BY timestamp ASC
                     LIMIT 25000
                    """,
                    (device_id, horas),
                )
                rows = [dict(r) for r in cur.fetchall()]
                for r in rows:
                    if r.get('timestamp'):
                        r['timestamp'] = r['timestamp'].isoformat()
                return rows
        except Exception as e:
            logger.warning("obtener_historial_device: %s", e)
            return []

    def limpiar_historial_antiguo(self, dias: int = 7) -> int:
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

    # ====================================================================== #
    # Analytics — calidad de energía                                          #
    # ====================================================================== #
    def calcular_calidad_energia(self, device_id, horas=24):
        """Calcula métricas globales de calidad de energía."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    WITH global_avg AS (
                        SELECT AVG(voltaje_in_l1) AS avg_global
                          FROM ups_chart_history
                         WHERE device_id = %s
                           AND timestamp > NOW() - make_interval(hours => %s)
                           AND voltaje_in_l1 IS NOT NULL AND voltaje_in_l1 > 0
                    ),
                    stats AS (
                        SELECT
                            AVG(voltaje_in_l1)  AS v_avg,
                            STDDEV(voltaje_in_l1) AS v_stddev,
                            MIN(voltaje_in_l1)  AS v_min,
                            MAX(voltaje_in_l1)  AS v_max,
                            AVG(voltaje_out_l1) AS v_out_avg,
                            AVG(frecuencia_in)  AS f_avg,
                            MIN(frecuencia_in)  AS f_min,
                            MAX(frecuencia_in)  AS f_max,
                            STDDEV(frecuencia_in) AS f_stddev,
                            AVG(carga_pct)      AS load_avg,
                            MIN(carga_pct)      AS load_min,
                            MAX(carga_pct)      AS load_max,
                            AVG(bateria_pct)    AS bat_avg,
                            MIN(bateria_pct)    AS bat_min,
                            AVG(temperatura)    AS temp_avg,
                            MAX(temperatura)    AS temp_max,
                            COUNT(*)            AS total,
                            COUNT(*) FILTER (
                                WHERE voltaje_in_l1 < (SELECT avg_global * 0.90 FROM global_avg)
                                  AND voltaje_in_l1 > 0
                            ) AS sags,
                            COUNT(*) FILTER (
                                WHERE voltaje_in_l1 > (SELECT avg_global * 1.10 FROM global_avg)
                            ) AS swells,
                            COUNT(*) FILTER (WHERE bateria_pct < 50 AND bateria_pct > 0) AS low_battery,
                            COUNT(*) FILTER (WHERE temperatura > 40 AND temperatura > 0)  AS high_temp
                          FROM ups_chart_history
                         WHERE device_id = %s
                           AND timestamp > NOW() - make_interval(hours => %s)
                           AND voltaje_in_l1 IS NOT NULL AND voltaje_in_l1 > 0
                    )
                    SELECT * FROM stats
                    """,
                    (device_id, horas, device_id, horas),
                )
                row = cur.fetchone()
                if not row or not row.get('total'):
                    return {'error': 'Sin datos para el periodo solicitado', 'total': 0}

                r = dict(row)
                v_avg = float(r['v_avg'] or 0)
                v_stddev = float(r['v_stddev'] or 0)
                if v_avg > 0:
                    desviacion_pct = (v_stddev / v_avg) * 100
                    pqi = max(0, min(100, 100 - (desviacion_pct * 10)))
                else:
                    pqi = 0
                f_avg = float(r['f_avg'] or 60)

                return {
                    'total_lecturas': r['total'],
                    'voltaje': {
                        'promedio':        round(v_avg, 1),
                        'min':             round(float(r['v_min'] or 0), 1),
                        'max':             round(float(r['v_max'] or 0), 1),
                        'stddev':          round(v_stddev, 2),
                        'salida_promedio': round(float(r['v_out_avg'] or 0), 1),
                        'pqi':             round(pqi, 1),
                    },
                    'frecuencia': {
                        'promedio': round(f_avg, 2),
                        'min':      round(float(r['f_min'] or 0), 2),
                        'max':      round(float(r['f_max'] or 0), 2),
                        'desviacion_nominal': round(abs(f_avg - 60.0), 3),
                    },
                    'eventos': {
                        'sags':        r['sags'] or 0,
                        'swells':      r['swells'] or 0,
                        'low_battery': r['low_battery'] or 0,
                        'high_temp':   r['high_temp'] or 0,
                    },
                    'bateria': {
                        'promedio': round(float(r['bat_avg'] or 0), 1),
                        'min':      round(float(r['bat_min'] or 0), 1),
                    },
                    'carga': {
                        'promedio': round(float(r['load_avg'] or 0), 1),
                        'min':      round(float(r['load_min'] or 0), 1),
                        'max':      round(float(r['load_max'] or 0), 1),
                    },
                    'temperatura': {
                        'promedio': round(float(r['temp_avg'] or 0), 1),
                        'max':      round(float(r['temp_max'] or 0), 1),
                    },
                }
        except Exception as e:
            logger.error("calcular_calidad_energia: %s", e)
            return {'error': str(e)}

    def obtener_perfil_horario(self, device_id, horas=24):
        """Métricas agrupadas por hora para gráficas de analytics."""
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT DATE_TRUNC('hour', timestamp) AS hora,
                           AVG(voltaje_in_l1)  AS voltaje_in_avg,
                           MIN(voltaje_in_l1)  AS voltaje_in_min,
                           MAX(voltaje_in_l1)  AS voltaje_in_max,
                           AVG(voltaje_out_l1) AS voltaje_out_avg,
                           AVG(frecuencia_in)  AS frecuencia_avg,
                           AVG(carga_pct)      AS carga_avg,
                           AVG(bateria_pct)    AS bateria_avg,
                           AVG(temperatura)    AS temperatura_avg,
                           COUNT(*)            AS lecturas
                      FROM ups_chart_history
                     WHERE device_id = %s
                       AND timestamp > NOW() - make_interval(hours => %s)
                       AND voltaje_in_l1 IS NOT NULL AND voltaje_in_l1 > 0
                     GROUP BY DATE_TRUNC('hour', timestamp)
                     ORDER BY hora ASC
                    """,
                    (device_id, horas),
                )
                rows = []
                for r in cur.fetchall():
                    r = dict(r)
                    if r.get('hora'):
                        r['hora'] = r['hora'].isoformat()
                    for k in ('voltaje_in_avg', 'voltaje_in_min', 'voltaje_in_max',
                              'voltaje_out_avg', 'carga_avg', 'bateria_avg', 'temperatura_avg'):
                        if r.get(k) is not None:
                            r[k] = round(float(r[k]), 1)
                    if r.get('frecuencia_avg') is not None:
                        r['frecuencia_avg'] = round(float(r['frecuencia_avg']), 2)
                    rows.append(r)
                return rows
        except Exception as e:
            logger.error("obtener_perfil_horario: %s", e)
            return []

    # ====================================================================== #
    # Grabaciones manuales                                                    #
    # ====================================================================== #
    def iniciar_grabacion(self, device_id, nombre=None):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                # Garantiza UNA sola grabación activa por dispositivo:
                # cierra cualquier grabación activa previa antes de crear la
                # nueva (evita condiciones de carrera con doble clic / dos
                # peticiones simultáneas). Refuerza el índice único parcial
                # creado en la migración 009.
                cur.execute(
                    """
                    UPDATE ups_recordings
                       SET activa = FALSE, fin = NOW()
                     WHERE device_id = %s AND activa = TRUE
                    """,
                    (device_id,),
                )
                cur.execute(
                    """
                    INSERT INTO ups_recordings (device_id, nombre, activa)
                    VALUES (%s, %s, TRUE)
                    RETURNING id, device_id, nombre, inicio, activa
                    """,
                    (device_id, nombre),
                )
                row = cur.fetchone()
                if row:
                    r = dict(row)
                    if r.get('inicio'):
                        r['inicio'] = r['inicio'].isoformat()
                    return r
                return None
        except Exception as e:
            logger.error("iniciar_grabacion: %s", e)
            return None

    def detener_grabacion(self, recording_id):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                # Conteo separado del UPDATE: con idx_recording_data_rid el
                # COUNT usa índice y no bloquea el UPDATE con un escaneo.
                cur.execute(
                    "SELECT COUNT(*) AS n FROM ups_recording_data "
                    "WHERE recording_id = %s",
                    (recording_id,),
                )
                _c = cur.fetchone()
                muestras = (dict(_c).get('n') if _c else 0) or 0
                cur.execute(
                    """
                    UPDATE ups_recordings
                       SET activa = FALSE,
                           fin = NOW(),
                           muestras = %s
                     WHERE id = %s
                    RETURNING id, device_id, nombre, inicio, fin, muestras, activa
                    """,
                    (muestras, recording_id),
                )
                row = cur.fetchone()
                if row:
                    r = dict(row)
                    if r.get('inicio'):
                        r['inicio'] = r['inicio'].isoformat()
                    if r.get('fin'):
                        r['fin'] = r['fin'].isoformat()
                    return r
                return None
        except Exception as e:
            logger.error("detener_grabacion: %s", e)
            return None

    def obtener_grabaciones(self, device_id=None):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                if device_id:
                    cur.execute(
                        """
                        SELECT r.*, mc.nombre AS device_nombre, mc.ip AS device_ip
                          FROM ups_recordings r
                          JOIN monitoreo_config mc ON r.device_id = mc.id
                         WHERE r.device_id = %s
                         ORDER BY r.inicio DESC
                        """,
                        (device_id,),
                    )
                else:
                    cur.execute(
                        """
                        SELECT r.*, mc.nombre AS device_nombre, mc.ip AS device_ip
                          FROM ups_recordings r
                          JOIN monitoreo_config mc ON r.device_id = mc.id
                         ORDER BY r.inicio DESC
                        """
                    )
                rows = [dict(r) for r in cur.fetchall()]
                for r in rows:
                    if r.get('inicio'):
                        r['inicio'] = r['inicio'].isoformat()
                    if r.get('fin'):
                        r['fin'] = r['fin'].isoformat()
                return rows
        except Exception as e:
            logger.error("obtener_grabaciones: %s", e)
            return []

    def obtener_grabacion(self, recording_id):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT r.*, mc.nombre AS device_nombre, mc.ip AS device_ip
                      FROM ups_recordings r
                      JOIN monitoreo_config mc ON r.device_id = mc.id
                     WHERE r.id = %s
                    """,
                    (recording_id,),
                )
                row = cur.fetchone()
                if row:
                    r = dict(row)
                    if r.get('inicio'):
                        r['inicio'] = r['inicio'].isoformat()
                    if r.get('fin'):
                        r['fin'] = r['fin'].isoformat()
                    return r
                return None
        except Exception as e:
            logger.error("obtener_grabacion: %s", e)
            return None

    def eliminar_grabacion(self, recording_id):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM ups_recordings WHERE id = %s", (recording_id,))
                return True
        except Exception as e:
            logger.error("eliminar_grabacion: %s", e)
            return False

    def obtener_grabacion_activa(self, device_id: int):
        try:
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT * FROM ups_recordings "
                    "WHERE device_id = %s AND activa = TRUE "
                    "ORDER BY inicio DESC LIMIT 1",
                    (device_id,),
                )
                row = cur.fetchone()
                if row:
                    r = dict(row)
                    if r.get('inicio'):
                        r['inicio'] = r['inicio'].isoformat()
                    return r
                return None
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
                        power_mode, estado,
                        temperatura_ambiente, ciclos_descarga
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
                        datos.get('ambient_temperature'), datos.get('battery_cycles'),
                    ),
                )
                return True
        except Exception as e:
            logger.debug("insertar_dato_grabacion: %s", e)
            return False

    def obtener_datos_grabacion(self, recording_id, limite=50000):
        try:
            limite = max(1, min(int(limite), 200000))
            with self.pool.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT * FROM ups_recording_data "
                    "WHERE recording_id = %s ORDER BY timestamp ASC "
                    "LIMIT %s",
                    (recording_id, limite),
                )
                rows = [dict(r) for r in cur.fetchall()]
                if len(rows) >= limite:
                    logger.warning(
                        "obtener_datos_grabacion: grabación %s truncada a %d filas",
                        recording_id, limite,
                    )
                for r in rows:
                    if r.get('timestamp'):
                        r['timestamp'] = r['timestamp'].isoformat()
                return rows
        except Exception as e:
            logger.error("obtener_datos_grabacion: %s", e)
            return []
