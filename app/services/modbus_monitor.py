"""
Monitor Modbus TCP para UPS INVT.
Basado en la documentación oficial de protocolos INVT.

Direccionamiento: Dirección Final = Offset del Equipo + ID del Registro
  - Gabinete:  Offset 0,    IDs 0-99
  - UPS:       Offset 100,  IDs 0-3071
  - THS:       Offset 3271, IDs 0-39
  - Water:     Offset 3311, IDs 0-9

Coeficientes: 0.1 para voltajes/corrientes/temp, 0.01 para frecuencia/PF
"""

import os
import threading
import time
import logging
from pymodbus.client import ModbusTcpClient
from app.services.pg_metrics import influx_service
from app.base_datos import GestorDB
from app.extensions import socketio

logger = logging.getLogger(__name__)

# =============================================================================
# MAPA DE REGISTROS INVT (Offset UPS = 100)
# =============================================================================

# Lectura en bloque: registros 100..155 (56 registros)
UPS_BLOCK_START = 100
UPS_BLOCK_COUNT = 56

# IDs relativos al offset 100 (posición en el bloque leído)
REGISTER_MAP = {
    # Bypass (IDs 0-6)
    'bypass_voltage_a':    {'pos': 0,  'coef': 0.1, 'unit': 'V'},
    'bypass_voltage_b':    {'pos': 1,  'coef': 0.1, 'unit': 'V'},
    'bypass_voltage_c':    {'pos': 2,  'coef': 0.1, 'unit': 'V'},
    'bypass_current_a':    {'pos': 3,  'coef': 0.1, 'unit': 'A'},
    'bypass_frequency':    {'pos': 6,  'coef': 0.01, 'unit': 'Hz'},

    # Input (IDs 12-23)
    'input_voltage_a':     {'pos': 12, 'coef': 0.1, 'unit': 'V'},
    'input_voltage_b':     {'pos': 13, 'coef': 0.1, 'unit': 'V'},
    'input_voltage_c':     {'pos': 14, 'coef': 0.1, 'unit': 'V'},
    'input_current_a':     {'pos': 15, 'coef': 0.1, 'unit': 'A'},
    'input_current_b':     {'pos': 16, 'coef': 0.1, 'unit': 'A'},
    'input_current_c':     {'pos': 17, 'coef': 0.1, 'unit': 'A'},
    'input_frequency_a':   {'pos': 18, 'coef': 0.01, 'unit': 'Hz'},
    'input_frequency_b':   {'pos': 19, 'coef': 0.01, 'unit': 'Hz'},
    'input_frequency_c':   {'pos': 20, 'coef': 0.01, 'unit': 'Hz'},
    'input_pf_a':          {'pos': 21, 'coef': 0.01, 'unit': ''},
    'input_pf_b':          {'pos': 22, 'coef': 0.01, 'unit': ''},
    'input_pf_c':          {'pos': 23, 'coef': 0.01, 'unit': ''},

    # Output (IDs 24-47)
    'output_voltage_a':    {'pos': 24, 'coef': 0.1, 'unit': 'V'},
    'output_voltage_b':    {'pos': 25, 'coef': 0.1, 'unit': 'V'},
    'output_voltage_c':    {'pos': 26, 'coef': 0.1, 'unit': 'V'},
    'output_current_a':    {'pos': 27, 'coef': 0.1, 'unit': 'A'},
    'output_current_b':    {'pos': 28, 'coef': 0.1, 'unit': 'A'},
    'output_current_c':    {'pos': 29, 'coef': 0.1, 'unit': 'A'},
    'output_frequency_a':  {'pos': 30, 'coef': 0.01, 'unit': 'Hz'},
    'output_pf_a':         {'pos': 33, 'coef': 0.01, 'unit': ''},
    'output_apparent_a':   {'pos': 36, 'coef': 0.1, 'unit': 'kVA'},
    'output_active_a':     {'pos': 39, 'coef': 0.1, 'unit': 'kW'},
    'load_pct_a':          {'pos': 45, 'coef': 0.1, 'unit': '%'},
    'load_pct_b':          {'pos': 46, 'coef': 0.1, 'unit': '%'},
    'load_pct_c':          {'pos': 47, 'coef': 0.1, 'unit': '%'},

    # Battery (IDs 49-55)
    'battery_temp':        {'pos': 49, 'coef': 0.1, 'unit': '°C'},
    'battery_voltage_pos': {'pos': 50, 'coef': 0.1, 'unit': 'V'},
    'battery_voltage_neg': {'pos': 51, 'coef': 0.1, 'unit': 'V'},
    'battery_current_pos': {'pos': 52, 'coef': 0.1, 'unit': 'A'},
    'battery_current_neg': {'pos': 53, 'coef': 0.1, 'unit': 'A'},
    'battery_remain_time': {'pos': 54, 'coef': 0.1, 'unit': 'min'},
    'battery_capacity':    {'pos': 55, 'coef': 0.1, 'unit': '%'},
}

# Bloque de estado: registros 171..195 (25 registros)
STATUS_BLOCK_START = 171
STATUS_BLOCK_COUNT = 25

STATUS_MAP = {
    'power_supply_mode':    {'pos': 0,  'values': {0: 'Sin carga', 1: 'En UPS', 2: 'En Bypass'}},
    'battery_status':       {'pos': 1,  'values': {0: 'No conectada', 1: 'Falla', 2: 'Flotacion', 3: 'Carga rapida', 4: 'Descargando'}},
    'maint_breaker':        {'pos': 2,  'values': {0: 'Abierto', 1: 'Cerrado'}},
    'battery_test':         {'pos': 3,  'values': {0: 'Sin test', 1: 'OK', 2: 'Fallido', 3: 'En progreso'}},
    'rectifier_status':     {'pos': 5,  'values': {0: 'Cerrado', 1: 'Arranque suave', 2: 'Normal'}},
    'phase_config':         {'pos': 20, 'values': {0: '3/3', 1: '3/1', 2: '1/1'}},
    'battery_type':         {'pos': 24, 'values': {0: 'VRLA', 1: 'Litio', 2: 'NiCd'}},
}

# Sensores ambientales
THS_BLOCK_START = 3271
THS_BLOCK_COUNT = 2

WATER_BLOCK_START = 3311
WATER_BLOCK_COUNT = 1

# Modulos: Dirección = 100 + 111 + (N-1)*96 + ID_Relativo
MODULE_BASE = 211  # 100 + 111
MODULE_STRIDE = 96
MODULE_PARAMS = {
    'mod_input_voltage_a':  {'rel': 0,  'coef': 0.1, 'unit': 'V'},
    'mod_input_current_a':  {'rel': 3,  'coef': 0.1, 'unit': 'A'},
    'mod_dc_bus_voltage':   {'rel': 12, 'coef': 0.1, 'unit': 'V'},
    'mod_battery_voltage':  {'rel': 14, 'coef': 0.1, 'unit': 'V'},
    'mod_discharge_current':{'rel': 20, 'coef': 0.1, 'unit': 'A'},
    'mod_output_voltage_a': {'rel': 34, 'coef': 0.1, 'unit': 'V'},
    'mod_inlet_temp':       {'rel': 84, 'coef': 0.1, 'unit': '°C'},
    'mod_outlet_temp':      {'rel': 85, 'coef': 0.1, 'unit': '°C'},
    'mod_scr_temp':         {'rel': 95, 'coef': 0.1, 'unit': '°C'},
}


# =============================================================================
# UMBRALES DE ALARMA
# =============================================================================
ALARM_THRESHOLDS = {
    'input_voltage_low':    180.0,   # V - voltaje de entrada bajo
    'input_voltage_high':   260.0,   # V - voltaje de entrada alto
    'output_voltage_low':   200.0,   # V - voltaje de salida bajo
    'output_voltage_high':  240.0,   # V - voltaje de salida alto
    'battery_capacity_low': 20.0,    # % - bateria critica
    'battery_capacity_warn':50.0,    # % - bateria baja
    'battery_temp_high':    45.0,    # °C - temperatura bateria alta
    'load_overload':        90.0,    # % - sobrecarga
    'load_warning':         70.0,    # % - carga alta
    'temp_env_high':        35.0,    # °C - temperatura ambiente alta
    'humidity_high':        80.0,    # % - humedad alta
    'humidity_low':         20.0,    # % - humedad baja
}


def _safe_read(client, address, count, slave=1):
    """Lectura segura con reintentos."""
    for attempt in range(3):
        try:
            result = client.read_holding_registers(address, count, slave=slave)
            if not result.isError():
                return result.registers
        except Exception as e:
            logger.warning(f"Intento {attempt+1} fallido en dir {address}: {e}")
            if attempt < 2:
                time.sleep(0.5)
    return None


def _check_alarms(data, status):
    """Genera lista de alarmas activas basado en datos y umbrales."""
    alarms = []
    t = ALARM_THRESHOLDS

    # Alarmas de voltaje de entrada
    vin = data.get('input_voltage_a', 0)
    if 0 < vin < t['input_voltage_low']:
        alarms.append({'level': 'critical', 'code': 'INPUT_V_LOW', 'msg': f'Voltaje entrada bajo: {vin:.1f}V'})
    elif vin > t['input_voltage_high']:
        alarms.append({'level': 'warning', 'code': 'INPUT_V_HIGH', 'msg': f'Voltaje entrada alto: {vin:.1f}V'})

    # Alarmas de voltaje de salida
    vout = data.get('output_voltage_a', 0)
    if 0 < vout < t['output_voltage_low']:
        alarms.append({'level': 'critical', 'code': 'OUTPUT_V_LOW', 'msg': f'Voltaje salida bajo: {vout:.1f}V'})
    elif vout > t['output_voltage_high']:
        alarms.append({'level': 'warning', 'code': 'OUTPUT_V_HIGH', 'msg': f'Voltaje salida alto: {vout:.1f}V'})

    # Alarmas de bateria
    bat_cap = data.get('battery_capacity', 0)
    if 0 < bat_cap < t['battery_capacity_low']:
        alarms.append({'level': 'critical', 'code': 'BAT_CRITICAL', 'msg': f'Bateria critica: {bat_cap:.1f}%'})
    elif 0 < bat_cap < t['battery_capacity_warn']:
        alarms.append({'level': 'warning', 'code': 'BAT_LOW', 'msg': f'Bateria baja: {bat_cap:.1f}%'})

    bat_temp = data.get('battery_temp', 0)
    if bat_temp > t['battery_temp_high']:
        alarms.append({'level': 'critical', 'code': 'BAT_OVERTEMP', 'msg': f'Sobretemperatura bateria: {bat_temp:.1f}°C'})

    # Alarmas de carga
    load = data.get('load_pct_a', 0)
    if load > t['load_overload']:
        alarms.append({'level': 'critical', 'code': 'OVERLOAD', 'msg': f'Sobrecarga: {load:.1f}%'})
    elif load > t['load_warning']:
        alarms.append({'level': 'warning', 'code': 'LOAD_HIGH', 'msg': f'Carga alta: {load:.1f}%'})

    # Alarmas de estado
    if status:
        ps_mode = status.get('power_supply_mode_raw', -1)
        bat_stat = status.get('battery_status_raw', -1)

        if bat_stat == 4:  # Descargando
            alarms.append({'level': 'critical', 'code': 'ON_BATTERY', 'msg': 'Operando en bateria - posible corte de luz'})
        elif bat_stat == 1:  # Falla
            alarms.append({'level': 'critical', 'code': 'BAT_FAIL', 'msg': 'Falla en bateria'})

        if ps_mode == 2:  # Bypass
            alarms.append({'level': 'warning', 'code': 'ON_BYPASS', 'msg': 'Carga alimentada por bypass'})
        elif ps_mode == 0:  # Sin carga
            alarms.append({'level': 'info', 'code': 'NO_LOAD', 'msg': 'Sistema sin carga'})

    # Alarmas ambientales
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


class ModbusMonitor:
    def __init__(self):
        self.running = False
        self.db = GestorDB()
        self.thread = None
        # Contadores para polling diferenciado
        self._cycle_count = 0
        # Historial de gráficas: guardar cada 15 ciclos (~30 seg)
        self._history_interval = 15
        self._history_cleanup_interval = 1800  # Limpiar cada ~1 hora
        self._history_retention_days = int(os.environ.get('HISTORY_RETENTION_DAYS', 30))
        # Cache del último estado por dispositivo para historial
        self._ultimo_estado = {}

    def start_background_task(self):
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._monitor_loop, daemon=True)
            self.thread.start()
            logger.info("Servicio de Monitoreo Modbus INVT Iniciado")

    def stop(self):
        self.running = False

    def _monitor_loop(self):
        while self.running:
            try:
                devices = self.db.obtener_monitoreo_ups()
                modbus_devices = [d for d in devices if d.get('protocolo', 'modbus') == 'modbus']

                for dev in modbus_devices:
                    if not self.running:
                        break
                    self._process_device(dev)
                    time.sleep(0.1)  # Yield entre dispositivos

            except Exception as e:
                logger.error(f"Error en ciclo de monitoreo Modbus: {e}")

            self._cycle_count += 1

            # Guardar historial de gráficas cada ~30 seg para TODOS los dispositivos Modbus
            if self._cycle_count % self._history_interval == 0 and self._ultimo_estado:
                for dev_id_str, estado in self._ultimo_estado.items():
                    if estado:
                        try:
                            raw_data = {
                                'input_voltage_l1': estado.get('voltaje_in_l1', 0),
                                'input_voltage_l2': estado.get('voltaje_in_l2', 0),
                                'input_voltage_l3': estado.get('voltaje_in_l3', 0),
                                'output_voltage_l1': estado.get('voltaje_out_l1', 0),
                                'output_voltage_l2': estado.get('voltaje_out_l2', 0),
                                'output_voltage_l3': estado.get('voltaje_out_l3', 0),
                                'input_frequency': estado.get('frecuencia_in', 0),
                                'output_frequency': estado.get('frecuencia_out', 0),
                                'output_current_l1': estado.get('corriente_out_l1', 0),
                                'output_current_l2': estado.get('corriente_out_l2', 0),
                                'output_current_l3': estado.get('corriente_out_l3', 0),
                                'output_load': estado.get('carga_pct', 0),
                                'battery_capacity': estado.get('bateria_pct', 0),
                                'temperature': estado.get('temperatura', 0),
                            }
                            self.db.guardar_punto_historial(int(dev_id_str), raw_data)
                        except Exception as e:
                            logger.error("Error guardando historial Modbus device %s: %s", dev_id_str, e)

            # Limpiar historial antiguo cada ~1 hora
            if self._cycle_count % self._history_cleanup_interval == 0:
                try:
                    self.db.limpiar_historial_antiguo(self._history_retention_days)
                except Exception as e:
                    logger.error("Error limpiando historial antiguo Modbus: %s", e)

            time.sleep(2)  # Polling base: 2 segundos

    def _process_device(self, dev):
        ip = dev['ip']
        port = dev.get('port', 502)
        slave = dev.get('slave_id', 1)
        name = dev.get('nombre', 'UPS')

        client = ModbusTcpClient(ip, port=port, timeout=5)
        try:
            connected = client.connect()
        except Exception:
            connected = False

        data = {}
        status_data = {}
        alarms = []
        device_status = 'offline'

        if connected:
            try:
                # === BLOQUE 1: Parametros electricos (cada 2s) ===
                regs = _safe_read(client, UPS_BLOCK_START, UPS_BLOCK_COUNT, slave)
                if regs:
                    device_status = 'online'
                    for key, info in REGISTER_MAP.items():
                        pos = info['pos']
                        if pos < len(regs):
                            data[key] = round(regs[pos] * info['coef'], 2)

                # === BLOQUE 2: Estados (cada 5s ~ cada 2-3 ciclos) ===
                if self._cycle_count % 3 == 0:
                    status_regs = _safe_read(client, STATUS_BLOCK_START, STATUS_BLOCK_COUNT, slave)
                    if status_regs:
                        for key, info in STATUS_MAP.items():
                            pos = info['pos']
                            if pos < len(status_regs):
                                raw_val = status_regs[pos]
                                status_data[f'{key}_raw'] = raw_val
                                status_data[key] = info['values'].get(raw_val, f'Desconocido({raw_val})')

                # === BLOQUE 3: Sensores ambientales (cada 30s ~ cada 15 ciclos) ===
                if self._cycle_count % 15 == 0:
                    ths_regs = _safe_read(client, THS_BLOCK_START, THS_BLOCK_COUNT, slave)
                    if ths_regs:
                        data['env_temperature'] = round(ths_regs[0] * 0.1, 1)
                        data['env_humidity'] = round(ths_regs[1] * 0.1, 1)

                    water_regs = _safe_read(client, WATER_BLOCK_START, WATER_BLOCK_COUNT, slave)
                    if water_regs:
                        data['water_leak_location'] = water_regs[0]

                # === BLOQUE 4: Modulos (cada 10s ~ cada 5 ciclos, max 4 modulos) ===
                if self._cycle_count % 5 == 0:
                    modules_data = []
                    for mod_num in range(1, 5):  # Hasta 4 modulos
                        mod_base = MODULE_BASE + (mod_num - 1) * MODULE_STRIDE
                        # Intentar leer solo el primer registro para ver si el modulo existe
                        test_reg = _safe_read(client, mod_base, 1, slave)
                        if test_reg is None or test_reg[0] == 0:
                            break  # No hay mas modulos

                        mod_data = {'module_number': mod_num}
                        for key, info in MODULE_PARAMS.items():
                            reg = _safe_read(client, mod_base + info['rel'], 1, slave)
                            if reg:
                                mod_data[key] = round(reg[0] * info['coef'], 2)
                        modules_data.append(mod_data)

                    if modules_data:
                        data['modules'] = modules_data

                # === Detectar alarmas ===
                alarms = _check_alarms(data, status_data)

                # === Escribir a PostgreSQL ===
                influx_service.write_ups_data(name, ip, data)

            except Exception as e:
                logger.error(f"Error lectura Modbus {ip}: {e}")
            finally:
                client.close()

        # Mapear datos al formato del frontend
        mapped = self._map_to_frontend(data, status_data)

        # Guardar último estado para historial de gráficas
        if device_status == 'online' and mapped:
            self._ultimo_estado[str(dev['id'])] = mapped
        elif device_status == 'offline':
            self._ultimo_estado.pop(str(dev['id']), None)

        payload = {
            'id': dev['id'],
            'ip': ip,
            'name': name,
            'status': device_status,
            'protocol': 'modbus',
            'data': mapped,
            'status_data': status_data,
            'alarms': alarms,
            'timestamp': time.time()
        }
        socketio.emit('ups_update', payload)

    def _map_to_frontend(self, data, status_data):
        """Mapea datos crudos al formato esperado por el frontend."""
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
            'power_factor': data.get('output_pf_a', 0),
            'active_power': data.get('output_active_a', 0),
            'apparent_power': data.get('output_apparent_a', 0),

            # Carga
            'carga_pct': data.get('load_pct_a', 0),

            # Bateria
            'bateria_pct': data.get('battery_capacity', 0),
            'voltaje_bateria': data.get('battery_voltage_pos', 0),
            'corriente_bateria': data.get('battery_current_pos', 0),
            'temperatura': data.get('battery_temp', 0),
            'battery_remain_time': data.get('battery_remain_time', 0),

            # Bypass
            'bypass_voltage_a': data.get('bypass_voltage_a', 0),
            'bypass_voltage_b': data.get('bypass_voltage_b', 0),
            'bypass_voltage_c': data.get('bypass_voltage_c', 0),

            # Ambiental
            'env_temperature': data.get('env_temperature', 0),
            'env_humidity': data.get('env_humidity', 0),
            'water_leak': data.get('water_leak_location', 0),

            # Estado
            'power_mode': status_data.get('power_supply_mode', ''),
            'battery_status': status_data.get('battery_status', ''),
            'rectifier_status': status_data.get('rectifier_status', ''),
            'phase_config': status_data.get('phase_config', ''),

            # Modulos
            'modules': data.get('modules', []),

            # Metadatos
            'phases': 3 if data.get('input_voltage_b', 0) > 50 else 1,
        }


monitor_service = ModbusMonitor()
