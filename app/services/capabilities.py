# -*- coding: utf-8 -*-
"""
Capacidades por dispositivo: qué campos soporta realmente cada UPS.

El frontend usaba una plantilla única y los campos que un UPS no expone
quedaban como "—"/"N/D" perpetuos. Aquí derivamos un capability set por
dispositivo y el frontend oculta lo que el equipo nunca va a reportar:

  * SNMP: de `_raw_keys` (los OIDs que SÍ respondieron). No sirve el dict
    mapeado porque `_format_data` rellena los ausentes con 0.
  * Modbus INVT: el bloque UPS devuelve siempre 56 registros, así que se
    usan heurísticas sobre los valores (fases por voltaje de la fase B,
    sensor THS solo si reporta algo distinto de 0, bypass si tiene tensión).

El set se persiste en `monitoreo_config.capabilities` (JSONB) cuando cambia,
para que la UI pueda renderizar adaptativo aun con el equipo offline.
"""
import json


class CapsCache:
    """Cache en memoria + persistencia a BD solo cuando el set cambia."""

    def __init__(self, db):
        self._db = db
        self._blobs: dict[int, str] = {}
        self._objs: dict[int, dict] = {}

    def update(self, dev_id: int, caps: dict) -> dict:
        blob = json.dumps(caps, sort_keys=True)
        if self._blobs.get(dev_id) != blob:
            self._blobs[dev_id] = blob
            self._db.actualizar_capacidades(dev_id, caps)
        self._objs[dev_id] = caps
        return caps

    def get(self, dev_id: int):
        return self._objs.get(dev_id)

# OID-key (de los clientes SNMP) → campo lógico que entiende el frontend
_SNMP_FIELD_MAP = {
    # UPS-MIB RFC 1628
    'input_voltage':             'v_in',
    'input_frequency':           'freq_in',
    'input_current':             'i_in',
    'output_voltage':            'v_out',
    'output_frequency':          'freq_out',
    'output_current':            'i_out',
    'output_percent_load':       'load_pct',
    'output_power':              'active_power',
    'output_source':             'power_mode',
    'battery_charge_remaining':  'bat_pct',
    'battery_voltage':           'bat_v',
    'battery_current':           'bat_i',
    'battery_temperature':       'bat_temp',
    'battery_minutes_remaining': 'runtime',
    'battery_status':            'bat_status',
    # INVT complementarios
    'invt_input_voltage':        'v_in',
    'invt_output_voltage':       'v_out',
    'invt_battery_voltage':      'bat_v',
    # Megatec/Voltronic (.935)
    'megatec_input_voltage':     'v_in',
    'megatec_input_freq':        'freq_in',
    'megatec_output_voltage':    'v_out',
    'megatec_output_load':       'load_pct',
    'megatec_batt_voltage':      'bat_v',
    'megatec_batt_capacity':     'bat_pct',
}

# Claves ESTANDARIZADAS (perfil OID custom / clientes sin _raw_keys) → campo
_STD_FIELD_MAP = {
    'input_voltage_l1':  'v_in',
    'input_frequency':   'freq_in',
    'input_current':     'i_in',
    'output_voltage_l1': 'v_out',
    'output_frequency':  'freq_out',
    'output_current_l1': 'i_out',
    'output_load':       'load_pct',
    'output_power':      'active_power',
    'battery_capacity':  'bat_pct',
    'battery_voltage':   'bat_v',
    'battery_current':   'bat_i',
    'temperature':       'bat_temp',
    'battery_runtime':   'runtime',
}

# Campos que el bloque UPS Modbus INVT (56 registros) siempre incluye
_MODBUS_BASE_FIELDS = [
    'v_in', 'freq_in', 'i_in',
    'v_out', 'freq_out', 'i_out',
    'load_pct', 'pf', 'active_power', 'apparent_power',
    'bat_pct', 'bat_v', 'bat_i', 'bat_temp', 'runtime',
    'power_mode', 'bat_status',
]


def from_snmp(data: dict, ups_type: str) -> dict:
    """Capability set desde la respuesta de un cliente SNMP (`_raw_keys`)."""
    raw_keys = data.get('_raw_keys') or []
    if raw_keys:
        fields = {_SNMP_FIELD_MAP[k] for k in raw_keys if k in _SNMP_FIELD_MAP}
    else:
        # Perfil OID custom: no hay _raw_keys; derivar de las claves
        # estandarizadas con valor (si no, la UI ocultaría todo).
        fields = {f for k, f in _STD_FIELD_MAP.items() if data.get(k) is not None}
    if data.get('power_source'):
        fields.add('power_mode')   # Megatec lo deriva del voltaje de entrada
    return {
        'protocol': 'snmp',
        'ups_type': ups_type,
        'phases': int(data.get('_phases') or 1),
        'fields': sorted(fields),
        'has_ambient':  data.get('ambient_temperature') is not None,
        'has_humidity': False,
        'has_cycles':   data.get('battery_cycles') is not None,
        'has_bypass':   False,
        'has_modules':  False,
        'has_battery_current': 'bat_i' in fields,
    }


def from_modbus(data: dict, status_data: dict, mapped: dict, ups_type: str) -> dict:
    """Capability set desde una lectura Modbus INVT exitosa."""
    fields = set(_MODBUS_BASE_FIELDS)

    # Sensor THS: 0.0 plano (o ausente) = sin sensor conectado
    has_ambient = bool(data.get('env_temperature'))
    has_humidity = bool(data.get('env_humidity'))
    has_bypass = bool(data.get('bypass_voltage_a', 0) > 0)
    if has_bypass:
        fields.add('bypass_v')

    phases = int(mapped.get('phases') or 1)
    # phase_config del bloque de estado es más confiable que la heurística
    cfg = (status_data or {}).get('phase_config') or ''
    if cfg.startswith('3'):
        phases = 3
    elif cfg.startswith('1'):
        phases = 1

    return {
        'protocol': 'modbus',
        'ups_type': ups_type,
        'phases': phases,
        'fields': sorted(fields),
        'has_ambient':  has_ambient,
        'has_humidity': has_humidity,
        'has_cycles':   False,      # INVT Modbus no expone ciclos de descarga
        'has_bypass':   has_bypass,
        'has_modules':  bool(data.get('modules')),
        'has_battery_current': True,
    }
