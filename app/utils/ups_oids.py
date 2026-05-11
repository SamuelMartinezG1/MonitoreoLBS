"""
Definiciones de OIDs para UPS INC (EINC-MIB).

Este módulo contiene todos los OIDs del MIB propietario de UPS INC
(Enterprise ID: 56788), organizados por grupos funcionales con sus
factores de escala y diccionarios de decodificación.

MIB Version: 1.00 (Enero 2021)
OID Base: .1.3.6.1.4.1.56788.1.1.1

Autor: Sistema de Monitoreo UPS
Fecha: 2026-01-26
"""

# OID Base del fabricante INC
ENTERPRISE_OID = '.1.3.6.1.4.1.56788'
UPS_BASE_OID = '.1.3.6.1.4.1.56788.1.1.1'

# ============================================================================
# GRUPO 1: INFORMACIÓN DEL DISPOSITIVO (upsInfo - OID .1)
# ============================================================================
UPS_INFO_OIDS = {
    'monitor_version': f'{UPS_BASE_OID}.1.1',      # DisplayString
    'company_name': f'{UPS_BASE_OID}.1.2',         # DisplayString
    'model': f'{UPS_BASE_OID}.1.3',                # DisplayString
    'serial_number': f'{UPS_BASE_OID}.1.4',        # DisplayString
    'input_phases': f'{UPS_BASE_OID}.1.5',         # INTEGER (1 o 3)
    'output_phases': f'{UPS_BASE_OID}.1.6',        # INTEGER (1 o 3)
    'battery_count': f'{UPS_BASE_OID}.1.7',        # INTEGER (número de celdas)
    'battery_ah': f'{UPS_BASE_OID}.1.8',           # INTEGER (Ampere-hour)
    'battery_rated_voltage': f'{UPS_BASE_OID}.1.9',  # INTEGER (Voltios)
    'battery_type': f'{UPS_BASE_OID}.1.10',        # INTEGER (0=VRLA, 1=Litio, 2=NiCd)
    'rated_power': f'{UPS_BASE_OID}.1.11',         # INTEGER (VA)
    'rated_input_voltage': f'{UPS_BASE_OID}.1.12', # INTEGER (V)
    'rated_input_frequency': f'{UPS_BASE_OID}.1.13',  # INTEGER (Hz)
    'rated_output_voltage': f'{UPS_BASE_OID}.1.14',  # INTEGER (V)
    'rated_output_frequency': f'{UPS_BASE_OID}.1.15', # INTEGER (Hz)
}

# ============================================================================
# GRUPO 2: ESTADO DEL UPS (upsStatus - OID .2)
# ============================================================================
UPS_STATUS_OIDS = {
    'connected': f'{UPS_BASE_OID}.2.1',            # INTEGER (0=desconectado, 1=conectado)
    'power_source': f'{UPS_BASE_OID}.2.2',         # INTEGER (0=ninguna, 1=UPS, 2=Bypass) **CRÍTICO**
    'battery_status': f'{UPS_BASE_OID}.2.3',       # INTEGER (0-4) **CRÍTICO**
    'maintain_breaker': f'{UPS_BASE_OID}.2.4',     # INTEGER (0=abierto, 1=cerrado)
    'battery_test_result': f'{UPS_BASE_OID}.2.5',  # INTEGER (0=noTest, 1=success, 2=fail, 3=testing)
    'battery_maintain_result': f'{UPS_BASE_OID}.2.6',  # INTEGER
}

# ============================================================================
# GRUPO 3: DATOS BYPASS (upsDataBypass - OID .3.1)
# ============================================================================
UPS_BYPASS_OIDS = {
    'voltage_a': f'{UPS_BASE_OID}.3.1.1',          # INTEGER (Voltios)
    'voltage_b': f'{UPS_BASE_OID}.3.1.2',          # INTEGER (Voltios)
    'voltage_c': f'{UPS_BASE_OID}.3.1.3',          # INTEGER (Voltios)
    'current_a': f'{UPS_BASE_OID}.3.1.4',          # INTEGER (Amperes)
    'current_b': f'{UPS_BASE_OID}.3.1.5',          # INTEGER (Amperes)
    'current_c': f'{UPS_BASE_OID}.3.1.6',          # INTEGER (Amperes)
    'frequency_a': f'{UPS_BASE_OID}.3.1.7',        # INTEGER (Hz x 0.1)
    'frequency_b': f'{UPS_BASE_OID}.3.1.8',        # INTEGER (Hz x 0.1)
    'frequency_c': f'{UPS_BASE_OID}.3.1.9',        # INTEGER (Hz x 0.1)
}

# ============================================================================
# GRUPO 4: DATOS ENTRADA (upsDataInput - OID .3.2)
# ============================================================================
UPS_INPUT_OIDS = {
    'voltage_a': f'{UPS_BASE_OID}.3.2.1',          # INTEGER (Voltios) **CRÍTICO**
    'voltage_b': f'{UPS_BASE_OID}.3.2.2',          # INTEGER (Voltios)
    'voltage_c': f'{UPS_BASE_OID}.3.2.3',          # INTEGER (Voltios)
    'current_a': f'{UPS_BASE_OID}.3.2.4',          # INTEGER (Amperes x 0.1)
    'current_b': f'{UPS_BASE_OID}.3.2.5',          # INTEGER (Amperes x 0.1)
    'current_c': f'{UPS_BASE_OID}.3.2.6',          # INTEGER (Amperes x 0.1)
    'active_power_a': f'{UPS_BASE_OID}.3.2.7',     # INTEGER (kW x 0.1)
    'reactive_power_a': f'{UPS_BASE_OID}.3.2.8',   # INTEGER (kVAR x 0.1)
    'apparent_power_a': f'{UPS_BASE_OID}.3.2.9',   # INTEGER (kVA x 0.1)
    'frequency_a': f'{UPS_BASE_OID}.3.2.10',       # INTEGER (Hz x 0.1) **CRÍTICO**
}

# ============================================================================
# GRUPO 5: DATOS SALIDA (upsDataOutput - OID .3.3)
# ============================================================================
UPS_OUTPUT_OIDS = {
    'voltage_a': f'{UPS_BASE_OID}.3.3.1',          # INTEGER (Voltios) **CRÍTICO**
    'voltage_b': f'{UPS_BASE_OID}.3.3.2',          # INTEGER (Voltios)
    'voltage_c': f'{UPS_BASE_OID}.3.3.3',          # INTEGER (Voltios)
    'current_a': f'{UPS_BASE_OID}.3.3.4',          # INTEGER (Amperes x 0.1) **CRÍTICO**
    'current_b': f'{UPS_BASE_OID}.3.3.5',          # INTEGER (Amperes x 0.1)
    'current_c': f'{UPS_BASE_OID}.3.3.6',          # INTEGER (Amperes x 0.1)
    'active_power_a': f'{UPS_BASE_OID}.3.3.7',     # INTEGER (kW x 0.1)
    'reactive_power_a': f'{UPS_BASE_OID}.3.3.8',   # INTEGER (kVAR x 0.1)
    'apparent_power_a': f'{UPS_BASE_OID}.3.3.9',   # INTEGER (kVA x 0.1)
    'frequency_a': f'{UPS_BASE_OID}.3.3.10',       # INTEGER (Hz x 0.1) **CRÍTICO**
    'power_factor_a': f'{UPS_BASE_OID}.3.3.11',    # INTEGER (x 0.01)
    'apparent_power_total': f'{UPS_BASE_OID}.3.3.12',  # INTEGER (kVA x 0.1)
    'active_power_total': f'{UPS_BASE_OID}.3.3.13',    # INTEGER (kW x 0.1) **CRÍTICO**
}

# ============================================================================
# GRUPO 6: DATOS CARGA (upsDataLoad - OID .3.4)
# ============================================================================
UPS_LOAD_OIDS = {
    'percent_a': f'{UPS_BASE_OID}.3.4.1',          # INTEGER (%) **CRÍTICO**
    'percent_b': f'{UPS_BASE_OID}.3.4.2',          # INTEGER (%)
    'percent_c': f'{UPS_BASE_OID}.3.4.3',          # INTEGER (%)
}

# ============================================================================
# GRUPO 7: DATOS BATERÍA (upsDataBattery - OID .3.5) ⚠️ MÁS CRÍTICO
# ============================================================================
UPS_BATTERY_OIDS = {
    'voltage': f'{UPS_BASE_OID}.3.5.1',            # INTEGER (V x 0.1) 🔴 **CRÍTICO**
    'current': f'{UPS_BASE_OID}.3.5.2',            # INTEGER (A x 0.1) 🔴 **CRÍTICO**
    'charge_percent': f'{UPS_BASE_OID}.3.5.3',     # INTEGER (%) 🔴 **CRÍTICO**
    'runtime_remaining': f'{UPS_BASE_OID}.3.5.4',  # INTEGER (minutos) 🔴 **CRÍTICO**
    'temperature': f'{UPS_BASE_OID}.3.5.5',        # INTEGER (°C) 🔴 **CRÍTICO**
    'cycles': f'{UPS_BASE_OID}.3.5.6',             # INTEGER (número de ciclos)
}

# ============================================================================
# DICCIONARIO UNIFICADO (para acceso fácil por nombre)
# ============================================================================
UPS_OIDS = {
    'info': UPS_INFO_OIDS,
    'status': UPS_STATUS_OIDS,
    'bypass': UPS_BYPASS_OIDS,
    'input': UPS_INPUT_OIDS,
    'output': UPS_OUTPUT_OIDS,
    'load': UPS_LOAD_OIDS,
    'battery': UPS_BATTERY_OIDS,
}

# ============================================================================
# FACTORES DE ESCALA
# ============================================================================
SCALE_FACTORS = {
    # Batería
    f'{UPS_BASE_OID}.3.5.1': 0.1,  # Voltaje batería (V x 0.1)
    f'{UPS_BASE_OID}.3.5.2': 0.1,  # Corriente batería (A x 0.1)
    
    # Entrada
    f'{UPS_BASE_OID}.3.2.4': 0.1,  # Corriente entrada A (A x 0.1)
    f'{UPS_BASE_OID}.3.2.5': 0.1,  # Corriente entrada B
    f'{UPS_BASE_OID}.3.2.6': 0.1,  # Corriente entrada C
    f'{UPS_BASE_OID}.3.2.7': 0.1,  # Potencia activa entrada (kW x 0.1)
    f'{UPS_BASE_OID}.3.2.8': 0.1,  # Potencia reactiva entrada (kVAR x 0.1)
    f'{UPS_BASE_OID}.3.2.9': 0.1,  # Potencia aparente entrada (kVA x 0.1)
    f'{UPS_BASE_OID}.3.2.10': 0.1,  # Frecuencia entrada (Hz x 0.1)
    
    # Salida
    f'{UPS_BASE_OID}.3.3.4': 0.1,  # Corriente salida A (A x 0.1)
    f'{UPS_BASE_OID}.3.3.5': 0.1,  # Corriente salida B
    f'{UPS_BASE_OID}.3.3.6': 0.1,  # Corriente salida C
    f'{UPS_BASE_OID}.3.3.7': 0.1,  # Potencia activa salida (kW x 0.1)
    f'{UPS_BASE_OID}.3.3.8': 0.1,  # Potencia reactiva salida
    f'{UPS_BASE_OID}.3.3.9': 0.1,  # Potencia aparente salida
    f'{UPS_BASE_OID}.3.3.10': 0.1,  # Frecuencia salida (Hz x 0.1)
    f'{UPS_BASE_OID}.3.3.11': 0.01,  # Factor de potencia (x 0.01)
    f'{UPS_BASE_OID}.3.3.12': 0.1,  # Potencia aparente total
    f'{UPS_BASE_OID}.3.3.13': 0.1,  # Potencia activa total
    
    # Bypass
    f'{UPS_BASE_OID}.3.1.7': 0.1,  # Frecuencia bypass A (Hz x 0.1)
    f'{UPS_BASE_OID}.3.1.8': 0.1,  # Frecuencia bypass B
    f'{UPS_BASE_OID}.3.1.9': 0.1,  # Frecuencia bypass C
}

# ============================================================================
# DICCIONARIOS DE DECODIFICACIÓN DE VALORES ENUM
# ============================================================================

# Tipo de batería (upsInfoBatteryType)
BATTERY_TYPE = {
    0: 'VRLA',      # Valve Regulated Lead Acid
    1: 'Litio',     # Lithium-ion
    2: 'NiCd',      # Nickel-Cadmium
}

# Estado de conexión (upsStatusConnected)
CONNECTION_STATUS = {
    0: 'Desconectado',
    1: 'Conectado',
}

# Fuente de alimentación (upsStatusLoadOnSource) **CRÍTICO**
POWER_SOURCE = {
    0: 'Ninguna',
    1: 'UPS Normal',
    2: 'Bypass',
}

# Estado de batería (upsStatusBatteryStatus) **CRÍTICO**
BATTERY_STATUS = {
    0: 'No Conectada',
    1: 'No Operativa',
    2: 'Carga Flotante',  # Normal, batería cargada
    3: 'Carga Rápida',    # Boost charge
    4: 'Descargando',     # En uso, fallo de red **ALARMA**
}

# Estado de breaker de mantenimiento
MAINTAIN_BREAKER_STATUS = {
    0: 'Abierto',
    1: 'Cerrado',
}

# Resultado de test de batería
BATTERY_TEST_RESULT = {
    0: 'Sin Test',
    1: 'Exitoso',
    2: 'Fallido',
    3: 'En Progreso',
}

# Resultado de mantenimiento de batería
BATTERY_MAINTAIN_RESULT = {
    0: 'Sin Mantenimiento',
    1: 'Exitoso',
    2: 'Fallido',
    3: 'En Progreso',
}

# ============================================================================
# DICCIONARIO UNIFICADO DE DECODIFICACIÓN
# ============================================================================
DECODERS = {
    'battery_type': BATTERY_TYPE,
    'connection_status': CONNECTION_STATUS,
    'power_source': POWER_SOURCE,
    'battery_status': BATTERY_STATUS,
    'maintain_breaker': MAINTAIN_BREAKER_STATUS,
    'battery_test_result': BATTERY_TEST_RESULT,
    'battery_maintain_result': BATTERY_MAINTAIN_RESULT,
}

# ============================================================================
# LISTA DE OIDs CRÍTICOS (para monitoreo prioritario)
# ============================================================================
CRITICAL_OIDS = [
    UPS_STATUS_OIDS['power_source'],       # Fuente de alimentación
    UPS_STATUS_OIDS['battery_status'],     # Estado de batería
    UPS_BATTERY_OIDS['voltage'],           # Voltaje batería
    UPS_BATTERY_OIDS['current'],           # Corriente batería
    UPS_BATTERY_OIDS['charge_percent'],    # % Carga batería
    UPS_BATTERY_OIDS['runtime_remaining'], # Autonomía
    UPS_BATTERY_OIDS['temperature'],       # Temperatura batería
    UPS_INPUT_OIDS['voltage_a'],           # Voltaje entrada
    UPS_INPUT_OIDS['frequency_a'],         # Frecuencia entrada
    UPS_OUTPUT_OIDS['voltage_a'],          # Voltaje salida
    UPS_OUTPUT_OIDS['current_a'],          # Corriente salida
    UPS_OUTPUT_OIDS['frequency_a'],        # Frecuencia salida
    UPS_OUTPUT_OIDS['active_power_total'], # Potencia total
    UPS_LOAD_OIDS['percent_a'],            # % Carga
]

# ============================================================================
# FUNCIÓN HELPER PARA OBTENER TODOS LOS OIDs DE UN GRUPO
# ============================================================================
def get_group_oids(group_name: str) -> dict:
    """
    Retorna todos los OIDs de un grupo específico.
    
    Args:
        group_name: Nombre del grupo ('info', 'status', 'battery', etc.)
    
    Returns:
        Diccionario {nombre: oid} del grupo solicitado
    
    Example:
        >>> battery_oids = get_group_oids('battery')
        >>> print(battery_oids['voltage'])
    """
    return UPS_OIDS.get(group_name, {})


def get_all_oids_flat() -> list:
    """
    Retorna una lista plana de todos los OIDs definidos.
    
    Returns:
        Lista de strings con todos los OIDs
    """
    all_oids = []
    for group in UPS_OIDS.values():
        all_oids.extend(group.values())
    return all_oids
