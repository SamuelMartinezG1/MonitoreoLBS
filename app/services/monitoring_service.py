"""
Servicio de monitoreo unificado para UPS.

Orquesta SNMP (asyncio) y Modbus (delegado a `ModbusMonitor` con su propio
ThreadPoolExecutor). Por ciclo:

  1. Lee `monitoreo_config`.
  2. Para cada UPS SNMP, dispara `_check_device` concurrentemente con
     `asyncio.gather` reusando un cliente SNMP cacheado (1 `SnmpEngine`
     por dispositivo, no por ciclo).
  3. Acumula filas para `ups_metrics` en un buffer y las flusha **una vez**
     al final con `pg_metrics.write_ups_data_batch` — un solo executemany
     para todos los UPS del ciclo (clave para 150 dispositivos).
  4. Persiste a `ups_telemetry_log` y `ups_chart_history` con throttle por
     timestamp (no por contador de ciclos), configurable vía
     `METRICS_SAMPLE_INTERVAL_S` y `HISTORY_SAMPLE_INTERVAL_S`.

El cleanup (telemetría / historial / métricas viejas) lo hace APScheduler
desde `run_monitor.py`, no este loop.
"""
import os
import time
import math
import threading
import asyncio
import logging

from app.base_datos import GestorDB
from app.services.modbus_monitor import ModbusMonitor
from app.extensions import socketio

logger = logging.getLogger(__name__)


# ============================================================================
# Cache de clientes SNMP por dispositivo
# ============================================================================
def _client_params_hash(ip, port, community, version, ups_type):
    return (ip, int(port), community, int(version), ups_type)


def _build_snmp_client(params_hash):
    """Instancia el cliente SNMP apropiado según `ups_type`."""
    ip, port, community, version, ups_type = params_hash
    if ups_type in ('ups_mib_standard', 'hybrid'):
        from app.services.protocols.snmp_upsmib_client import UPSMIBClient
        return UPSMIBClient(
            ip_address=ip, community=community, port=port,
            mp_model=version, include_invt=(ups_type == 'hybrid'),
        )
    # Default: Megatec / INVT (OIDs enterprise .935)
    from app.services.protocols.snmp_minimal_client import MinimalSNMPClient
    return MinimalSNMPClient(community=community, port=port, mp_model=version)


# ============================================================================
# Monitoring service
# ============================================================================
class MonitoringService(threading.Thread):
    def __init__(self, interval=2):
        super().__init__(daemon=True)
        self.interval = max(1, int(interval))
        self.running = True
        self.db = GestorDB()
        self.modbus_monitor = ModbusMonitor()

        # Loop asyncio dedicado de este hilo. Bajo eventlet, varios greenlets
        # comparten el slot de loop por hilo OS — usar asyncio.run() por ciclo
        # falla con "cannot be called from a running event loop". Mantener un
        # loop propio + run_until_complete() lo aísla del resto del proceso.
        self._loop: asyncio.AbstractEventLoop | None = None

        self.ultimo_estado: dict[str, dict] = {}

        # Cache de clientes SNMP: dev_id -> (client, params_hash, created_ts)
        self._snmp_cache: dict[int, tuple] = {}
        self._snmp_ttl = int(os.environ.get('SNMP_CLIENT_TTL_S', 300))

        # Throttling por timestamp (en vez de contador de ciclos)
        self._metrics_interval = int(os.environ.get('METRICS_SAMPLE_INTERVAL_S', 30))
        self._history_interval = int(os.environ.get('HISTORY_SAMPLE_INTERVAL_S', 30))
        self._last_metric_write:  dict[int, float] = {}
        self._last_history_write: dict[int, float] = {}

    # ------------------------------------------------------------------ #
    # Ciclo                                                               #
    # ------------------------------------------------------------------ #
    def run(self):
        logger.info(
            "Iniciando MonitoringService (interval=%ss, metrics=%ss, history=%ss)",
            self.interval, self._metrics_interval, self._history_interval,
        )
        # Loop dedicado del hilo. Lo creamos una sola vez y reusamos por ciclo.
        self._loop = asyncio.new_event_loop()
        self.modbus_monitor.start_background_task()

        try:
            while self.running:
                try:
                    self._loop.run_until_complete(self._async_poll())
                except Exception as e:
                    logger.error("Error en ciclo SNMP: %s", e)
                time.sleep(self.interval)
        finally:
            try:
                self._loop.close()
            except Exception:
                pass

    def stop(self):
        self.running = False
        try:
            self.modbus_monitor.stop()
        except Exception:
            pass

    # ------------------------------------------------------------------ #
    # Loop async                                                          #
    # ------------------------------------------------------------------ #
    async def _async_poll(self):
        try:
            devices = self.db.obtener_monitoreo_ups()
        except Exception as e:
            logger.error("Error leyendo monitoreo_config: %s", e)
            return

        snmp_devices = [d for d in devices if d.get('protocolo') == 'snmp']
        if not snmp_devices:
            return

        # Buffer de métricas acumuladas en este ciclo
        metrics_buffer: list[tuple] = []

        # Lanzar todos los polls concurrentemente
        await asyncio.gather(
            *(self._check_device(dev, metrics_buffer) for dev in snmp_devices),
            return_exceptions=True,
        )

        # Flush único a ups_metrics
        if metrics_buffer:
            try:
                from app.services.pg_metrics import influx_service
                influx_service.write_ups_data_batch(metrics_buffer)
            except Exception as e:
                logger.debug("Error flushing metrics batch: %s", e)

    # ------------------------------------------------------------------ #
    # Por dispositivo                                                     #
    # ------------------------------------------------------------------ #
    def _get_snmp_client(self, dev_id, params_hash):
        """Devuelve un cliente SNMP cacheado o lo crea si caducó / cambió."""
        cached = self._snmp_cache.get(dev_id)
        now = time.monotonic()
        if cached:
            client, h, ts = cached
            if h == params_hash and (now - ts) < self._snmp_ttl:
                return client
        client = _build_snmp_client(params_hash)
        self._snmp_cache[dev_id] = (client, params_hash, now)
        return client

    async def _check_device(self, dev, metrics_buffer):
        ip = dev['ip']
        port = int(dev.get('snmp_port') or 161)
        community = dev.get('snmp_community') or 'public'

        snmp_version_raw = dev.get('snmp_version')
        if snmp_version_raw in (None, ''):
            snmp_version = 1
        else:
            snmp_version = int(snmp_version_raw)

        ups_type = dev.get('ups_type') or 'invt_enterprise'
        dev_id = dev['id']

        data = None
        status = 'offline'
        alarms: list = []
        mapped_data: dict = {}

        try:
            # 1. Perfil OID custom: bypass de los clientes estándar
            oid_profile = self.db.obtener_oid_profile(dev_id)
            if oid_profile:
                data = await self._poll_custom_profile(
                    ip, port, community, snmp_version, oid_profile,
                )
            else:
                params = _client_params_hash(ip, port, community, snmp_version, ups_type)
                client = self._get_snmp_client(dev_id, params)
                data = await client.get_ups_data(ip)

            if data:
                status = 'online'
                data['device_id'] = dev_id
                data['ip'] = ip
                data['nombre'] = dev.get('nombre', 'UPS')
                data['estado'] = 'ONLINE'

                version_name = 'SNMPv1' if snmp_version == 0 else 'SNMPv2c'
                data['snmp_version'] = version_name

                socketio.emit('ups_data', data, namespace='/monitor')

                mapped_data = _map_data_to_frontend(data, ups_type)
                self.ultimo_estado[str(dev_id)] = mapped_data
                alarms = _check_snmp_alarms(mapped_data)
            else:
                # Limpiar estado cacheado para no servir datos viejos al frontend
                self.ultimo_estado.pop(str(dev_id), None)

        except Exception as e:
            logger.error("Error checando %s (%s): %s", ip, dev_id, e)
            self.ultimo_estado.pop(str(dev_id), None)

        # Emit update siempre (online u offline)
        socketio.emit('ups_update', {
            'id':       dev_id,
            'status':   status,
            'ip':       ip,
            'nombre':   dev.get('nombre', 'UPS'),
            'protocol': 'snmp',
            'data':     mapped_data,
            'alarms':   alarms,
        })

        # Persistencia con throttle por timestamp
        now = time.monotonic()
        if status == 'online':
            # Telemetría + ups_metrics (cada METRICS_SAMPLE_INTERVAL_S)
            last_m = self._last_metric_write.get(dev_id, 0.0)
            if now - last_m >= self._metrics_interval:
                self._last_metric_write[dev_id] = now
                try:
                    self.db.insertar_telemetria(dev_id, data)
                    grabacion = self.db.obtener_grabacion_activa(dev_id)
                    if grabacion:
                        self.db.insertar_dato_grabacion(grabacion['id'], data)
                except Exception as e:
                    logger.debug("Persist telemetría %s: %s", ip, e)

                # Encolar para batch insert a ups_metrics
                _accumulate_metric_rows(
                    metrics_buffer, dev_id,
                    dev.get('nombre', 'UPS'), ip,
                    dev.get('sitio_nombre', ''), ups_type,
                    mapped_data,
                )

            # ups_chart_history (cada HISTORY_SAMPLE_INTERVAL_S)
            last_h = self._last_history_write.get(dev_id, 0.0)
            if now - last_h >= self._history_interval:
                self._last_history_write[dev_id] = now
                try:
                    self.db.guardar_punto_historial(dev_id, data)
                except Exception as e:
                    logger.debug("Persist historial %s: %s", ip, e)
        else:
            # Offline: marca status=0 en métricas cada N seg para historial de disponibilidad
            last_m = self._last_metric_write.get(dev_id, 0.0)
            if now - last_m >= self._metrics_interval:
                self._last_metric_write[dev_id] = now
                metrics_buffer.append((
                    dev_id, dev.get('nombre', 'UPS'), ip,
                    dev.get('sitio_nombre', ''), ups_type,
                    'status_code', 0.0,
                ))

    # ------------------------------------------------------------------ #
    # Perfil OID custom                                                   #
    # ------------------------------------------------------------------ #
    async def _poll_custom_profile(self, ip, port, community, snmp_version, oid_profile):
        try:
            from pysnmp.hlapi.v3arch.asyncio import (
                get_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
                ContextData, ObjectType, ObjectIdentity,
            )

            engine = SnmpEngine()
            auth = CommunityData(community, mpModel=snmp_version)
            transport = await UdpTransportTarget.create((ip, port), timeout=3.0, retries=1)
            context = ContextData()

            data: dict = {}
            for mapping in oid_profile:
                try:
                    errInd, errStat, _, varBinds = await get_cmd(
                        engine, auth, transport, context,
                        ObjectType(ObjectIdentity(mapping['oid'])),
                    )
                    if errInd or errStat or not varBinds:
                        continue
                    raw = varBinds[0][1].prettyPrint()
                    factor = float(mapping.get('factor', 1.0))
                    try:
                        data[mapping['variable_name']] = float(raw) * factor
                    except (ValueError, TypeError):
                        data[mapping['variable_name']] = raw
                except Exception as e:
                    logger.debug("Custom OID %s: %s", mapping.get('oid'), e)

            VAR_TO_STD = {
                'voltaje_in_l1':  'input_voltage_l1',
                'voltaje_in_l2':  'input_voltage_l2',
                'voltaje_in_l3':  'input_voltage_l3',
                'voltaje_out_l1': 'output_voltage_l1',
                'voltaje_out_l2': 'output_voltage_l2',
                'voltaje_out_l3': 'output_voltage_l3',
                'bateria_pct':    'battery_capacity',
                'temperatura':    'temperature',
                'carga_pct':      'output_load',
                'frecuencia_in':  'input_frequency',
                'frecuencia_out': 'output_frequency',
                'voltaje_bateria': 'battery_voltage',
            }
            standardized: dict = {}
            for name, val in data.items():
                std = VAR_TO_STD.get(name)
                if std:
                    standardized[std] = val
                standardized[name] = val
            return standardized or None
        except Exception as e:
            logger.error("Custom profile poll %s: %s", ip, e)
            return None


# ============================================================================
# Helpers (sin estado)
# ============================================================================
def _is_numeric(value) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    return False


# Métricas que enviamos a `ups_metrics` (subconjunto numérico de mapped_data).
_METRIC_KEYS = (
    'voltaje_in_l1', 'voltaje_in_l2', 'voltaje_in_l3',
    'voltaje_out_l1', 'voltaje_out_l2', 'voltaje_out_l3',
    'frecuencia_in', 'frecuencia_out',
    'corriente_out_l1', 'corriente_out_l2', 'corriente_out_l3',
    'carga_pct', 'bateria_pct', 'voltaje_bateria', 'temperatura',
    'power_factor', 'active_power', 'apparent_power', 'battery_remain_time',
)

# Mapeo a los nombres "antiguos" que esperaba InfluxDB / consumidores.
_METRIC_RENAME = {
    'voltaje_in_l1':  'voltaje_entrada',
    'voltaje_in_l2':  'voltaje_entrada_l2',
    'voltaje_in_l3':  'voltaje_entrada_l3',
    'voltaje_out_l1': 'voltaje_salida',
    'voltaje_out_l2': 'voltaje_salida_l2',
    'voltaje_out_l3': 'voltaje_salida_l3',
    'corriente_out_l1': 'corriente_salida_l1',
    'corriente_out_l2': 'corriente_salida_l2',
    'corriente_out_l3': 'corriente_salida_l3',
    'bateria_pct':    'bateria_porcentaje',
    'carga_pct':      'carga_porcentaje',
    'frecuencia_in':  'frecuencia_entrada',
    'frecuencia_out': 'frecuencia_salida',
}


def _accumulate_metric_rows(buffer, dev_id, name, ip, sitio, ups_type, mapped):
    """Empuja al buffer las métricas numéricas del dispositivo."""
    for key in _METRIC_KEYS:
        val = mapped.get(key)
        if not _is_numeric(val):
            continue
        metric_name = _METRIC_RENAME.get(key, key)
        buffer.append((dev_id, name, ip, sitio, ups_type, metric_name, float(val)))


def _map_data_to_frontend(data, ups_type):
    """Mapea respuesta SNMP a los nombres que usa el frontend / DB."""
    return {
        # Voltajes entrada
        'voltaje_in_l1': data.get('input_voltage_l1', 0),
        'voltaje_in_l2': data.get('input_voltage_l2', 0),
        'voltaje_in_l3': data.get('input_voltage_l3', 0),
        'frecuencia_in': data.get('input_frequency', 0),
        # Voltajes salida
        'voltaje_out_l1': data.get('output_voltage_l1', 0),
        'voltaje_out_l2': data.get('output_voltage_l2', 0),
        'voltaje_out_l3': data.get('output_voltage_l3', 0),
        'frecuencia_out': data.get('output_frequency', 0),
        # Corrientes salida
        'corriente_out_l1': data.get('output_current_l1', data.get('output_current', 0)),
        'corriente_out_l2': data.get('output_current_l2', 0),
        'corriente_out_l3': data.get('output_current_l3', 0),
        # Potencia
        'power_factor':   data.get('power_factor', 0),
        'active_power':   data.get('active_power', 0),
        'apparent_power': data.get('apparent_power', 0),
        # Carga / batería
        'carga_pct':       data.get('output_load', 0),
        'bateria_pct':     data.get('battery_capacity', 0),
        'voltaje_bateria': data.get('battery_voltage', 0),
        'corriente_bateria': data.get('battery_current', 0),
        'temperatura':     data.get('temperature', 0),
        'battery_remain_time': data.get('battery_runtime', 0),
        # Estado
        'power_mode':     data.get('power_source', ''),
        'battery_status': data.get('battery_status', ''),
        # Meta
        'phases':   data.get('_phases', 1),
        'ups_type': ups_type,
    }


def _check_snmp_alarms(data):
    alarms = []
    vin = data.get('voltaje_in_l1', 0) or 0
    if 0 < vin < 180:
        alarms.append({'level': 'critical', 'code': 'INPUT_V_LOW',
                       'msg': f'Voltaje entrada bajo: {vin:.1f}V'})
    bat = data.get('bateria_pct', 0) or 0
    if 0 < bat < 20:
        alarms.append({'level': 'critical', 'code': 'BAT_CRITICAL',
                       'msg': f'Bateria critica: {bat:.1f}%'})
    elif 0 < bat < 50:
        alarms.append({'level': 'warning', 'code': 'BAT_LOW',
                       'msg': f'Bateria baja: {bat:.1f}%'})
    temp = data.get('temperatura', 0) or 0
    if temp > 45:
        alarms.append({'level': 'critical', 'code': 'BAT_OVERTEMP',
                       'msg': f'Sobretemperatura: {temp:.1f}C'})
    load = data.get('carga_pct', 0) or 0
    if load > 90:
        alarms.append({'level': 'critical', 'code': 'OVERLOAD',
                       'msg': f'Sobrecarga: {load:.1f}%'})
    elif load > 70:
        alarms.append({'level': 'warning', 'code': 'LOAD_HIGH',
                       'msg': f'Carga alta: {load:.1f}%'})
    return alarms
