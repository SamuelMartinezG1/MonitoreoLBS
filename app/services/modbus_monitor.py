"""
Monitor Modbus TCP para UPS INVT (concurrencia con ThreadPoolExecutor).

Direccionamiento (offsets):
  - UPS:   100, IDs 0-3071
  - THS:   3271
  - Water: 3311
  - Mod N: 100 + 111 + (N-1)*96

Coeficientes: 0.1 voltajes/corrientes/temp, 0.01 frecuencia/PF.

A 150 dispositivos el polling secuencial era inviable (>450 s/ciclo). Ahora
cada ciclo dispara los polls en paralelo vía `ThreadPoolExecutor`
(`MODBUS_POLL_WORKERS=32` por defecto → ~5 batches × 3 s = 15 s).

Las métricas de `ups_metrics` se acumulan en un buffer compartido (con
lock) y se flusan **una sola vez** al final del ciclo con
`pg_metrics.write_ups_data_batch`.

El cleanup periódico lo hace APScheduler (en `run_monitor.py`).
"""
import os
import time
import math
import threading
import logging
from concurrent.futures import ThreadPoolExecutor

from pymodbus.client import ModbusTcpClient

from app.services.pg_metrics import influx_service
from app.base_datos import GestorDB
from app.extensions import socketio

logger = logging.getLogger(__name__)

# ============================================================================
# MAPA DE REGISTROS INVT (offset UPS = 100)
# ============================================================================
UPS_BLOCK_START = 100
UPS_BLOCK_COUNT = 56

REGISTER_MAP = {
    # Bypass
    'bypass_voltage_a':    {'pos': 0,  'coef': 0.1,  'unit': 'V'},
    'bypass_voltage_b':    {'pos': 1,  'coef': 0.1,  'unit': 'V'},
    'bypass_voltage_c':    {'pos': 2,  'coef': 0.1,  'unit': 'V'},
    'bypass_current_a':    {'pos': 3,  'coef': 0.1,  'unit': 'A'},
    'bypass_frequency':    {'pos': 6,  'coef': 0.01, 'unit': 'Hz'},
    # Input
    'input_voltage_a':     {'pos': 12, 'coef': 0.1,  'unit': 'V'},
    'input_voltage_b':     {'pos': 13, 'coef': 0.1,  'unit': 'V'},
    'input_voltage_c':     {'pos': 14, 'coef': 0.1,  'unit': 'V'},
    'input_current_a':     {'pos': 15, 'coef': 0.1,  'unit': 'A'},
    'input_current_b':     {'pos': 16, 'coef': 0.1,  'unit': 'A'},
    'input_current_c':     {'pos': 17, 'coef': 0.1,  'unit': 'A'},
    'input_frequency_a':   {'pos': 18, 'coef': 0.01, 'unit': 'Hz'},
    'input_frequency_b':   {'pos': 19, 'coef': 0.01, 'unit': 'Hz'},
    'input_frequency_c':   {'pos': 20, 'coef': 0.01, 'unit': 'Hz'},
    'input_pf_a':          {'pos': 21, 'coef': 0.01, 'unit': ''},
    'input_pf_b':          {'pos': 22, 'coef': 0.01, 'unit': ''},
    'input_pf_c':          {'pos': 23, 'coef': 0.01, 'unit': ''},
    # Output
    'output_voltage_a':    {'pos': 24, 'coef': 0.1,  'unit': 'V'},
    'output_voltage_b':    {'pos': 25, 'coef': 0.1,  'unit': 'V'},
    'output_voltage_c':    {'pos': 26, 'coef': 0.1,  'unit': 'V'},
    'output_current_a':    {'pos': 27, 'coef': 0.1,  'unit': 'A'},
    'output_current_b':    {'pos': 28, 'coef': 0.1,  'unit': 'A'},
    'output_current_c':    {'pos': 29, 'coef': 0.1,  'unit': 'A'},
    'output_frequency_a':  {'pos': 30, 'coef': 0.01, 'unit': 'Hz'},
    'output_pf_a':         {'pos': 33, 'coef': 0.01, 'unit': ''},
    'output_apparent_a':   {'pos': 36, 'coef': 0.1,  'unit': 'kVA'},
    'output_active_a':     {'pos': 39, 'coef': 0.1,  'unit': 'kW'},
    'load_pct_a':          {'pos': 45, 'coef': 0.1,  'unit': '%'},
    'load_pct_b':          {'pos': 46, 'coef': 0.1,  'unit': '%'},
    'load_pct_c':          {'pos': 47, 'coef': 0.1,  'unit': '%'},
    # Battery
    'battery_temp':        {'pos': 49, 'coef': 0.1,  'unit': '°C'},
    'battery_voltage_pos': {'pos': 50, 'coef': 0.1,  'unit': 'V'},
    'battery_voltage_neg': {'pos': 51, 'coef': 0.1,  'unit': 'V'},
    'battery_current_pos': {'pos': 52, 'coef': 0.1,  'unit': 'A'},
    'battery_current_neg': {'pos': 53, 'coef': 0.1,  'unit': 'A'},
    'battery_remain_time': {'pos': 54, 'coef': 0.1,  'unit': 'min'},
    'battery_capacity':    {'pos': 55, 'coef': 0.1,  'unit': '%'},
}

# Bloque de estado
STATUS_BLOCK_START = 171
STATUS_BLOCK_COUNT = 25
STATUS_MAP = {
    'power_supply_mode': {'pos': 0,  'values': {0: 'Sin carga', 1: 'En UPS', 2: 'En Bypass'}},
    'battery_status':    {'pos': 1,  'values': {0: 'No conectada', 1: 'Falla', 2: 'Flotacion', 3: 'Carga rapida', 4: 'Descargando'}},
    'maint_breaker':     {'pos': 2,  'values': {0: 'Abierto', 1: 'Cerrado'}},
    'battery_test':      {'pos': 3,  'values': {0: 'Sin test', 1: 'OK', 2: 'Fallido', 3: 'En progreso'}},
    'rectifier_status':  {'pos': 5,  'values': {0: 'Cerrado', 1: 'Arranque suave', 2: 'Normal'}},
    'phase_config':      {'pos': 20, 'values': {0: '3/3', 1: '3/1', 2: '1/1'}},
    'battery_type':      {'pos': 24, 'values': {0: 'VRLA', 1: 'Litio', 2: 'NiCd'}},
}

THS_BLOCK_START   = 3271
THS_BLOCK_COUNT   = 2
WATER_BLOCK_START = 3311
WATER_BLOCK_COUNT = 1
MODULE_BASE   = 211
MODULE_STRIDE = 96
MODULE_PARAMS = {
    'mod_input_voltage_a':   {'rel': 0,  'coef': 0.1, 'unit': 'V'},
    'mod_input_current_a':   {'rel': 3,  'coef': 0.1, 'unit': 'A'},
    'mod_dc_bus_voltage':    {'rel': 12, 'coef': 0.1, 'unit': 'V'},
    'mod_battery_voltage':   {'rel': 14, 'coef': 0.1, 'unit': 'V'},
    'mod_discharge_current': {'rel': 20, 'coef': 0.1, 'unit': 'A'},
    'mod_output_voltage_a':  {'rel': 34, 'coef': 0.1, 'unit': 'V'},
    'mod_inlet_temp':        {'rel': 84, 'coef': 0.1, 'unit': '°C'},
    'mod_outlet_temp':       {'rel': 85, 'coef': 0.1, 'unit': '°C'},
    'mod_scr_temp':          {'rel': 95, 'coef': 0.1, 'unit': '°C'},
}

ALARM_THRESHOLDS = {
    'input_voltage_low':     180.0,
    'input_voltage_high':    260.0,
    'output_voltage_low':    200.0,
    'output_voltage_high':   240.0,
    'battery_capacity_low':  20.0,
    'battery_capacity_warn': 50.0,
    'battery_temp_high':     45.0,
    'load_overload':         90.0,
    'load_warning':          70.0,
    'temp_env_high':         35.0,
    'humidity_high':         80.0,
    'humidity_low':          20.0,
}


# ============================================================================
# Helpers
# ============================================================================
def _safe_read(client, address, count, slave=1):
    """Lectura segura con reintentos."""
    for attempt in range(3):
        try:
            result = client.read_holding_registers(address, count, slave=slave)
            if not result.isError():
                return result.registers
        except Exception as e:
            logger.debug("Intento %d en dir %s: %s", attempt + 1, address, e)
            if attempt < 2:
                time.sleep(0.5)
    return None


def _is_numeric(value) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    return False


_METRIC_KEYS = (
    'voltaje_in_l1', 'voltaje_in_l2', 'voltaje_in_l3',
    'voltaje_out_l1', 'voltaje_out_l2', 'voltaje_out_l3',
    'frecuencia_in', 'frecuencia_out',
    'corriente_out_l1', 'corriente_out_l2', 'corriente_out_l3',
    'carga_pct', 'bateria_pct', 'voltaje_bateria', 'temperatura',
    'power_factor', 'active_power', 'apparent_power', 'battery_remain_time',
)


def _check_alarms(data, status):
    alarms = []
    t = ALARM_THRESHOLDS

    vin = data.get('input_voltage_a', 0)
    if 0 < vin < t['input_voltage_low']:
        alarms.append({'level': 'critical', 'code': 'INPUT_V_LOW', 'msg': f'Voltaje entrada bajo: {vin:.1f}V'})
    elif vin > t['input_voltage_high']:
        alarms.append({'level': 'warning', 'code': 'INPUT_V_HIGH', 'msg': f'Voltaje entrada alto: {vin:.1f}V'})

    vout = data.get('output_voltage_a', 0)
    if 0 < vout < t['output_voltage_low']:
        alarms.append({'level': 'critical', 'code': 'OUTPUT_V_LOW', 'msg': f'Voltaje salida bajo: {vout:.1f}V'})
    elif vout > t['output_voltage_high']:
        alarms.append({'level': 'warning', 'code': 'OUTPUT_V_HIGH', 'msg': f'Voltaje salida alto: {vout:.1f}V'})

    bat_cap = data.get('battery_capacity', 0)
    if 0 < bat_cap < t['battery_capacity_low']:
        alarms.append({'level': 'critical', 'code': 'BAT_CRITICAL', 'msg': f'Bateria critica: {bat_cap:.1f}%'})
    elif 0 < bat_cap < t['battery_capacity_warn']:
        alarms.append({'level': 'warning', 'code': 'BAT_LOW', 'msg': f'Bateria baja: {bat_cap:.1f}%'})

    bat_temp = data.get('battery_temp', 0)
    if bat_temp > t['battery_temp_high']:
        alarms.append({'level': 'critical', 'code': 'BAT_OVERTEMP', 'msg': f'Sobretemperatura bateria: {bat_temp:.1f}°C'})

    load = data.get('load_pct_a', 0)
    if load > t['load_overload']:
        alarms.append({'level': 'critical', 'code': 'OVERLOAD', 'msg': f'Sobrecarga: {load:.1f}%'})
    elif load > t['load_warning']:
        alarms.append({'level': 'warning', 'code': 'LOAD_HIGH', 'msg': f'Carga alta: {load:.1f}%'})

    if status:
        ps_mode = status.get('power_supply_mode_raw', -1)
        bat_stat = status.get('battery_status_raw', -1)
        if bat_stat == 4:
            alarms.append({'level': 'critical', 'code': 'ON_BATTERY', 'msg': 'Operando en bateria - posible corte de luz'})
        elif bat_stat == 1:
            alarms.append({'level': 'critical', 'code': 'BAT_FAIL', 'msg': 'Falla en bateria'})
        if ps_mode == 2:
            alarms.append({'level': 'warning', 'code': 'ON_BYPASS', 'msg': 'Carga alimentada por bypass'})
        elif ps_mode == 0:
            alarms.append({'level': 'info', 'code': 'NO_LOAD', 'msg': 'Sistema sin carga'})

    env_temp = data.get('env_temperature', 0)
    if env_temp > t['temp_env_high']:
        alarms.append({'level': 'warning', 'code': 'ENV_TEMP_HIGH', 'msg': f'Temperatura ambiente alta: {env_temp:.1f}°C'})
    env_hum = data.get('env_humidity', 0)
    if env_hum > t['humidity_high']:
        alarms.append({'level': 'warning', 'code': 'HUMIDITY_HIGH', 'msg': f'Humedad alta: {env_hum:.1f}%'})
    elif 0 < env_hum < t['humidity_low']:
        alarms.append({'level': 'info', 'code': 'HUMIDITY_LOW', 'msg': f'Humedad baja: {env_hum:.1f}%'})

    water_leak = data.get('water_leak_location', 0)
    if water_leak > 0:
        alarms.append({'level': 'critical', 'code': 'WATER_LEAK', 'msg': f'Fuga de agua detectada en zona {water_leak}'})

    return alarms


# ============================================================================
# ModbusMonitor
# ============================================================================
class ModbusMonitor:
    def __init__(self):
        self.running = False
        self.db = GestorDB()
        self.thread = None

        # Concurrencia: parametrizable por env (default 32 workers).
        self._workers = int(os.environ.get('MODBUS_POLL_WORKERS', 32))
        self._executor: ThreadPoolExecutor | None = None

        # Intervalos por dispositivo (no contador de ciclos globales).
        self._metrics_interval = int(os.environ.get('METRICS_SAMPLE_INTERVAL_S', 30))
        self._history_interval = int(os.environ.get('HISTORY_SAMPLE_INTERVAL_S', 30))
        self._last_metric_write:  dict[int, float] = {}
        self._last_history_write: dict[int, float] = {}

        # Ciclo del loop principal (en segundos)
        self._cycle_sleep = int(os.environ.get('MODBUS_POLL_INTERVAL', 2))

        # Submuestreo de bloques caros (status / sensores / módulos): segundos
        self._status_interval = int(os.environ.get('MODBUS_STATUS_INTERVAL_S',     6))
        self._env_interval    = int(os.environ.get('MODBUS_ENV_INTERVAL_S',       30))
        self._mod_interval    = int(os.environ.get('MODBUS_MODULES_INTERVAL_S',   10))
        self._last_status_read:  dict[int, float] = {}
        self._last_env_read:     dict[int, float] = {}
        self._last_modules_read: dict[int, float] = {}

        # Cache del último estado por dispositivo (para historial periódico)
        self._ultimo_estado: dict[str, dict] = {}

    # ------------------------------------------------------------------ #
    # Vida del thread                                                     #
    # ------------------------------------------------------------------ #
    def start_background_task(self):
        if self.running:
            return
        self.running = True
        self._executor = ThreadPoolExecutor(
            max_workers=self._workers,
            thread_name_prefix='modbus-poll',
        )
        self.thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.thread.start()
        logger.info(
            "ModbusMonitor iniciado (workers=%d, cycle=%ss, metrics=%ss)",
            self._workers, self._cycle_sleep, self._metrics_interval,
        )

    def stop(self):
        self.running = False
        if self._executor:
            self._executor.shutdown(wait=False, cancel_futures=True)
            self._executor = None

    # ------------------------------------------------------------------ #
    # Loop principal                                                      #
    # ------------------------------------------------------------------ #
    def _monitor_loop(self):
        while self.running:
            cycle_start = time.monotonic()
            metrics_buffer: list[tuple] = []
            buffer_lock = threading.Lock()

            try:
                devices = self.db.obtener_monitoreo_ups()
                modbus_devices = [d for d in devices if d.get('protocolo') == 'modbus']

                if modbus_devices and self._executor is not None:
                    futures = [
                        self._executor.submit(self._process_device, dev, metrics_buffer, buffer_lock)
                        for dev in modbus_devices
                    ]
                    # Esperamos pero acotamos: si un device cuelga, no traba al ciclo.
                    deadline = cycle_start + max(self._cycle_sleep * 4, 20)
                    for fut in futures:
                        remaining = max(0.1, deadline - time.monotonic())
                        try:
                            fut.result(timeout=remaining)
                        except Exception as e:
                            logger.debug("Modbus device future error: %s", e)
            except Exception as e:
                logger.error("Error obteniendo dispositivos Modbus: %s", e)

            # Flush único de métricas
            if metrics_buffer:
                try:
                    influx_service.write_ups_data_batch(metrics_buffer)
                except Exception as e:
                    logger.debug("Modbus metrics batch flush: %s", e)

            # Historial periódico desde cache
            self._maybe_write_history()

            # Dormir lo que falte del ciclo
            elapsed = time.monotonic() - cycle_start
            sleep_for = max(0.5, self._cycle_sleep - elapsed)
            time.sleep(sleep_for)

    def _maybe_write_history(self):
        now = time.monotonic()
        for dev_id_str, estado in list(self._ultimo_estado.items()):
            if not estado:
                continue
            dev_id = int(dev_id_str)
            last = self._last_history_write.get(dev_id, 0.0)
            if now - last < self._history_interval:
                continue
            self._last_history_write[dev_id] = now
            try:
                raw = {
                    'input_voltage_l1': estado.get('voltaje_in_l1', 0),
                    'input_voltage_l2': estado.get('voltaje_in_l2', 0),
                    'input_voltage_l3': estado.get('voltaje_in_l3', 0),
                    'output_voltage_l1': estado.get('voltaje_out_l1', 0),
                    'output_voltage_l2': estado.get('voltaje_out_l2', 0),
                    'output_voltage_l3': estado.get('voltaje_out_l3', 0),
                    'input_frequency':  estado.get('frecuencia_in', 0),
                    'output_frequency': estado.get('frecuencia_out', 0),
                    'output_current_l1': estado.get('corriente_out_l1', 0),
                    'output_current_l2': estado.get('corriente_out_l2', 0),
                    'output_current_l3': estado.get('corriente_out_l3', 0),
                    'output_load':      estado.get('carga_pct', 0),
                    'battery_capacity': estado.get('bateria_pct', 0),
                    'temperature':      estado.get('temperatura', 0),
                    'battery_voltage':  estado.get('voltaje_bateria', 0),
                    'power_factor':     estado.get('power_factor', 0),
                    'active_power':     estado.get('active_power', 0),
                    'apparent_power':   estado.get('apparent_power', 0),
                    'battery_runtime':  estado.get('battery_remain_time', 0),
                }
                self.db.guardar_punto_historial(dev_id, raw)
            except Exception as e:
                logger.debug("History Modbus dev %s: %s", dev_id, e)

    # ------------------------------------------------------------------ #
    # Por dispositivo (corre en pool worker)                              #
    # ------------------------------------------------------------------ #
    def _process_device(self, dev, metrics_buffer, buffer_lock):
        dev_id = dev['id']
        ip = dev['ip']
        # FIX: usar los nombres reales de columna (no `port`/`slave_id` legacy)
        port  = int(dev.get('modbus_port',    502) or 502)
        slave = int(dev.get('modbus_unit_id', 1)   or 1)
        name  = dev.get('nombre', 'UPS')
        ups_type = dev.get('ups_type', 'invt_enterprise')
        sitio = dev.get('sitio_nombre', '')

        client = ModbusTcpClient(ip, port=port, timeout=5)
        try:
            try:
                connected = client.connect()
            except Exception:
                connected = False

            data: dict = {}
            status_data: dict = {}
            alarms: list = []
            device_status = 'offline'
            now = time.monotonic()

            if connected:
                try:
                    # 1. Parámetros eléctricos (cada ciclo)
                    regs = _safe_read(client, UPS_BLOCK_START, UPS_BLOCK_COUNT, slave)
                    if regs:
                        device_status = 'online'
                        for key, info in REGISTER_MAP.items():
                            pos = info['pos']
                            if pos < len(regs):
                                data[key] = round(regs[pos] * info['coef'], 2)

                    # 2. Estados (cada N seg)
                    if now - self._last_status_read.get(dev_id, 0) >= self._status_interval:
                        self._last_status_read[dev_id] = now
                        status_regs = _safe_read(client, STATUS_BLOCK_START, STATUS_BLOCK_COUNT, slave)
                        if status_regs:
                            for key, info in STATUS_MAP.items():
                                pos = info['pos']
                                if pos < len(status_regs):
                                    raw_val = status_regs[pos]
                                    status_data[f'{key}_raw'] = raw_val
                                    status_data[key] = info['values'].get(raw_val, f'Desconocido({raw_val})')

                    # 3. Sensores ambientales (cada N seg)
                    if now - self._last_env_read.get(dev_id, 0) >= self._env_interval:
                        self._last_env_read[dev_id] = now
                        ths = _safe_read(client, THS_BLOCK_START, THS_BLOCK_COUNT, slave)
                        if ths:
                            data['env_temperature'] = round(ths[0] * 0.1, 1)
                            data['env_humidity']    = round(ths[1] * 0.1, 1)
                        water = _safe_read(client, WATER_BLOCK_START, WATER_BLOCK_COUNT, slave)
                        if water:
                            data['water_leak_location'] = water[0]

                    # 4. Módulos (cada N seg, máx 4)
                    if now - self._last_modules_read.get(dev_id, 0) >= self._mod_interval:
                        self._last_modules_read[dev_id] = now
                        modules_data = []
                        for mod_num in range(1, 5):
                            mod_base = MODULE_BASE + (mod_num - 1) * MODULE_STRIDE
                            test_reg = _safe_read(client, mod_base, 1, slave)
                            if test_reg is None or test_reg[0] == 0:
                                break
                            mod_data = {'module_number': mod_num}
                            for key, info in MODULE_PARAMS.items():
                                reg = _safe_read(client, mod_base + info['rel'], 1, slave)
                                if reg:
                                    mod_data[key] = round(reg[0] * info['coef'], 2)
                            modules_data.append(mod_data)
                        if modules_data:
                            data['modules'] = modules_data

                    alarms = _check_alarms(data, status_data)

                except Exception as e:
                    logger.error("Error lectura Modbus %s: %s", ip, e)
            mapped = self._map_to_frontend(data, status_data)
        finally:
            try:
                client.close()
            except Exception:
                pass

        # Actualizar cache para historial periódico
        if device_status == 'online' and mapped:
            self._ultimo_estado[str(dev_id)] = mapped
        elif device_status == 'offline':
            self._ultimo_estado.pop(str(dev_id), None)

        # Emitir update por Socket.IO
        try:
            socketio.emit('ups_update', {
                'id':          dev_id,
                'ip':          ip,
                'name':        name,
                'status':      device_status,
                'protocol':    'modbus',
                'data':        mapped,
                'status_data': status_data,
                'alarms':      alarms,
                'timestamp':   time.time(),
            })
        except Exception as e:
            logger.debug("socketio.emit Modbus dev %s: %s", dev_id, e)

        # Encolar métricas (con lock — múltiples workers escriben)
        if device_status == 'online' and mapped:
            now = time.monotonic()
            last_m = self._last_metric_write.get(dev_id, 0.0)
            if now - last_m >= self._metrics_interval:
                self._last_metric_write[dev_id] = now
                # Persistir con los MISMOS nombres de métrica que el path SNMP
                # (voltaje_salida, bateria_porcentaje, carga_porcentaje,
                # frecuencia_entrada/salida…). Sin esto, UPS Modbus guardaban
                # voltaje_out_l1/bateria_pct/carga_pct y el SCADA —que lee los
                # nombres estilo-SNMP— no mostraba su telemetría.
                # Import diferido: monitoring_service ya importa ModbusMonitor
                # de este módulo, así que un import top-level sería circular.
                from app.services.monitoring_service import _METRIC_RENAME
                rows = []
                for key in _METRIC_KEYS:
                    val = mapped.get(key)
                    if _is_numeric(val):
                        metric_name = _METRIC_RENAME.get(key, key)
                        rows.append((dev_id, name, ip, sitio, ups_type, metric_name, float(val)))
                if rows:
                    with buffer_lock:
                        metrics_buffer.extend(rows)

    # ------------------------------------------------------------------ #
    def _map_to_frontend(self, data, status_data):
        return {
            # Entrada
            'voltaje_in_l1': data.get('input_voltage_a', 0),
            'voltaje_in_l2': data.get('input_voltage_b', 0),
            'voltaje_in_l3': data.get('input_voltage_c', 0),
            'frecuencia_in': data.get('input_frequency_a', 0),
            # Salida
            'voltaje_out_l1': data.get('output_voltage_a', 0),
            'voltaje_out_l2': data.get('output_voltage_b', 0),
            'voltaje_out_l3': data.get('output_voltage_c', 0),
            'frecuencia_out': data.get('output_frequency_a', 0),
            # Corrientes salida
            'corriente_out_l1': data.get('output_current_a', 0),
            'corriente_out_l2': data.get('output_current_b', 0),
            'corriente_out_l3': data.get('output_current_c', 0),
            # Potencia
            'power_factor':   data.get('output_pf_a', 0),
            'active_power':   data.get('output_active_a', 0),
            'apparent_power': data.get('output_apparent_a', 0),
            # Carga
            'carga_pct': data.get('load_pct_a', 0),
            # Batería
            'bateria_pct':       data.get('battery_capacity', 0),
            'voltaje_bateria':   data.get('battery_voltage_pos', 0),
            'corriente_bateria': data.get('battery_current_pos', 0),
            'temperatura':       data.get('battery_temp', 0),
            'battery_remain_time': data.get('battery_remain_time', 0),
            # Bypass
            'bypass_voltage_a': data.get('bypass_voltage_a', 0),
            'bypass_voltage_b': data.get('bypass_voltage_b', 0),
            'bypass_voltage_c': data.get('bypass_voltage_c', 0),
            # Ambiental
            'env_temperature': data.get('env_temperature', 0),
            'env_humidity':    data.get('env_humidity', 0),
            'water_leak':      data.get('water_leak_location', 0),
            # Estado
            'power_mode':      status_data.get('power_supply_mode', ''),
            'battery_status':  status_data.get('battery_status', ''),
            'rectifier_status': status_data.get('rectifier_status', ''),
            'phase_config':    status_data.get('phase_config', ''),
            # Módulos
            'modules': data.get('modules', []),
            # Meta
            'phases': 3 if data.get('input_voltage_b', 0) > 50 else 1,
        }


monitor_service = ModbusMonitor()
