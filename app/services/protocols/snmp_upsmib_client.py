"""
Cliente SNMP optimizado para UPS con UPS-MIB RFC 1628 estándar.
Usa SOLO los OIDs detectados que funcionan en el dispositivo.
Soporta sistemas MONOFÁSICOS y TRIFÁSICOS.
"""

import os
import logging
from typing import Dict, Any
from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
    ObjectType, ObjectIdentity, get_cmd
)

logger = logging.getLogger(__name__)

# Timeouts tolerantes a enlaces lentos/intermitentes (configurables por entorno).
_DEF_TIMEOUT = int(os.environ.get('SNMP_TIMEOUT_S', 5))
_DEF_RETRIES = int(os.environ.get('SNMP_RETRIES', 2))

# OIDs UPS-MIB RFC 1628 (solo los que detectamos que funcionan)
UPS_MIB_OIDS = {
    # Identificación
    'ident_manufacturer': '1.3.6.1.2.1.33.1.1.1.0',
    'ident_model': '1.3.6.1.2.1.33.1.1.2.0',
    'ident_sw_version': '1.3.6.1.2.1.33.1.1.3.0',
    'ident_agent_version': '1.3.6.1.2.1.33.1.1.4.0',
    
    # Batería
    'battery_status': '1.3.6.1.2.1.33.1.2.1.0',
    'battery_seconds_on_battery': '1.3.6.1.2.1.33.1.2.2.0',
    'battery_minutes_remaining': '1.3.6.1.2.1.33.1.2.3.0',
    'battery_charge_remaining': '1.3.6.1.2.1.33.1.2.4.0',
    'battery_voltage': '1.3.6.1.2.1.33.1.2.5.0',
    'battery_current': '1.3.6.1.2.1.33.1.2.6.0',
    'battery_temperature': '1.3.6.1.2.1.33.1.2.7.0',
    
    # Entrada
    'input_line_bads': '1.3.6.1.2.1.33.1.3.1.0',
    'input_num_lines': '1.3.6.1.2.1.33.1.3.2.0',
    'input_frequency': '1.3.6.1.2.1.33.1.3.3.1.2.1',
    'input_voltage': '1.3.6.1.2.1.33.1.3.3.1.3.1',
    'input_current': '1.3.6.1.2.1.33.1.3.3.1.4.1',
    'input_true_power': '1.3.6.1.2.1.33.1.3.3.1.5.1',
    
    # Salida
    'output_source': '1.3.6.1.2.1.33.1.4.1.0',
    'output_frequency': '1.3.6.1.2.1.33.1.4.2.0',
    'output_num_lines': '1.3.6.1.2.1.33.1.4.3.0',
    'output_voltage': '1.3.6.1.2.1.33.1.4.4.1.2.1',
    'output_current': '1.3.6.1.2.1.33.1.4.4.1.3.1',
    'output_power': '1.3.6.1.2.1.33.1.4.4.1.4.1',
    'output_percent_load': '1.3.6.1.2.1.33.1.4.4.1.5.1',
}

# OIDs INVT / INC complementarios (si existen)
INVT_OIDS = {
    'invt_model': '1.3.6.1.4.1.56788.1.1.1.0',
    'invt_serial': '1.3.6.1.4.1.56788.1.1.2.0',
    'invt_input_voltage': '1.3.6.1.4.1.56788.1.3.1.2.1',
    'invt_output_voltage': '1.3.6.1.4.1.56788.1.4.1.2.1',
    'invt_battery_voltage': '1.3.6.1.4.1.56788.1.6.1.0',
    # Ciclos de descarga de batería (EINC-MIB upsDataBattery.cycles .3.5.6).
    # Es el contador de "total de descargas" del equipo cuando está disponible.
    'invt_battery_cycles': '1.3.6.1.4.1.56788.1.1.1.3.5.6.0',
}

# Decodificadores
BATTERY_STATUS_DECODER = {
    1: 'Unknown',
    2: 'Normal',
    3: 'Low',
    4: 'Depleted',
}

OUTPUT_SOURCE_DECODER = {
    1: 'Other',
    2: 'None',
    3: 'Normal',
    4: 'Bypass',
    5: 'Battery',
    6: 'Booster',
    7: 'Reducer',
}


class UPSMIBClient:
    """Cliente SNMP para UPS-MIB estándar (monofásico/trifásico)."""
    
    def __init__(self, ip_address: str, port: int = 161,
                 community: str = 'public', timeout: int = None,
                 retries: int = None, mp_model: int = 1,
                 include_invt: bool = True):
        """
        Args:
            mp_model: 0 para SNMPv1, 1 para SNMPv2c
            include_invt: Si True, intenta leer OIDs INVT adicionales
        """
        self.ip_address = ip_address
        self.community = community
        self.port = port
        self.timeout = _DEF_TIMEOUT if timeout is None else timeout
        self.retries = _DEF_RETRIES if retries is None else retries
        self.mp_model = mp_model
        self.include_invt = include_invt
        self.engine = SnmpEngine()
    
    async def get_ups_data(self, ip_address: str = None) -> Dict[str, Any]:
        """Consulta datos del UPS usando UPS-MIB estándar."""
        target_ip = ip_address or self.ip_address
        if not target_ip:
            return {}
        
        try:
            # Construir lista de OIDs a consultar
            oids_to_query = dict(UPS_MIB_OIDS)
            if self.include_invt:
                oids_to_query.update(INVT_OIDS)
            
            # Crear objetos SNMP
            transport = await UdpTransportTarget.create(
                (target_ip, self.port),
                timeout=self.timeout,
                retries=self.retries
            )
            
            objects = [ObjectType(ObjectIdentity(oid)) for oid in oids_to_query.values()]
            
            # Consulta SNMP
            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                self.engine,
                CommunityData(self.community, mpModel=self.mp_model),
                transport,
                ContextData(),
                *objects
            )
            
            if errorIndication:
                logger.error(f"Error crítico SNMP en {target_ip}: {errorIndication}")
                return {}
            
            # Mapear respuestas (tolerante a OIDs faltantes)
            keys = list(oids_to_query.keys())
            raw_data = {}
            for i, var in enumerate(varBinds):
                value_str = var[1].prettyPrint()
                # Solo guardar si el valor es válido
                if 'No Such Object' not in value_str and 'No Such Instance' not in value_str:
                    raw_data[keys[i]] = value_str
            
            # Formatear datos
            return self._format_data(raw_data)
            
        except Exception as e:
            logger.error(f"Error en UPSMIBClient para {target_ip}: {e}")
            return {}
    
    def _format_data(self, raw: Dict[str, str]) -> Dict[str, Any]:
        """Convierte valores SNMP a formato del dashboard."""
        
        def safe_float(value, divisor=1.0):
            """Conversión segura a float."""
            try:
                return float(value) / divisor
            except (ValueError, TypeError):
                return 0.0
        
        def safe_int(value):
            """Conversión segura a int."""
            try:
                return int(value)
            except (ValueError, TypeError):
                return 0
        
        # Determinar número de fases
        num_lines = safe_int(raw.get('input_num_lines', 1))
        phases = num_lines if num_lines > 0 else 1
        
        # Formatear datos (compatible con dashboard trifásico)
        data = {
            # Metadata
            '_phases': phases,
            '_ups_type': 'ups_mib_standard',
            
            # Identificación
            'manufacturer': raw.get('ident_manufacturer', ''),
            'model': raw.get('ident_model', raw.get('invt_model', '')),
            'serial': raw.get('invt_serial', ''),
            'sw_version': raw.get('ident_sw_version', ''),
            
            # Batería
            'battery_status': BATTERY_STATUS_DECODER.get(safe_int(raw.get('battery_status')), 'Unknown'),
            'battery_capacity': safe_int(raw.get('battery_charge_remaining')),
            'battery_voltage': safe_float(raw.get('battery_voltage'), 10.0),  # En décimas de volt
            'battery_current': safe_float(raw.get('battery_current'), 10.0),  # En décimas de amp
            'battery_temperature': safe_int(raw.get('battery_temperature')),
            'battery_runtime': safe_int(raw.get('battery_minutes_remaining')),
            'seconds_on_battery': safe_int(raw.get('battery_seconds_on_battery')),
            
            # Entrada (monofásica = solo L1)
            'input_voltage_l1': safe_float(raw.get('input_voltage', raw.get('invt_input_voltage', 0))),
            'input_voltage_l2': 0,  # No aplica en monofásico
            'input_voltage_l3': 0,  # No aplica en monofásico
            'input_frequency': safe_float(raw.get('input_frequency'), 10.0),  # En décimas de Hz
            'input_current': safe_float(raw.get('input_current'), 10.0),
            'input_power': safe_int(raw.get('input_true_power')),
            
            # Salida (monofásica = solo L1)
            'output_source': OUTPUT_SOURCE_DECODER.get(safe_int(raw.get('output_source')), 'Unknown'),
            'power_source': OUTPUT_SOURCE_DECODER.get(safe_int(raw.get('output_source')), 'Unknown'),
            'output_voltage_l1': safe_float(raw.get('output_voltage', raw.get('invt_output_voltage', 0))),
            'output_voltage_l2': 0,  # No aplica en monofásico
            'output_voltage_l3': 0,  # No aplica en monofásico
            'output_frequency': safe_float(raw.get('output_frequency'), 10.0),
            'output_current': safe_float(raw.get('output_current'), 10.0),
            'output_current_l1': safe_float(raw.get('output_current'), 10.0),
            'output_current_l2': 0,
            'output_current_l3': 0,
            'output_power': safe_int(raw.get('output_power')),
            'output_load': safe_int(raw.get('output_percent_load')),
            
            # Factor de potencia y potencias (estimados si no disponibles)
            'power_factor': 0.8,  # Estimado
            'active_power': safe_int(raw.get('output_power')),
            'apparent_power': int(safe_int(raw.get('output_power')) / 0.8) if raw.get('output_power') else 0,
            
            # Estado general
            'temperature': safe_int(raw.get('battery_temperature')),

            # Temperatura ambiente: el UPS-MIB estándar (RFC 1628) no define un
            # OID de temperatura ambiental, así que queda None salvo que se
            # provea vía perfil OID personalizado (variable 'temperatura_ambiente').
            'ambient_temperature': None,
            # Total de ciclos de descarga de batería (contador del fabricante).
            'battery_cycles': safe_int(raw['invt_battery_cycles'])
                              if raw.get('invt_battery_cycles') is not None else None,
        }
        
        logger.info(f"✅ UPS-MIB {self.ip_address}: {data.get('output_voltage_l1')}V, "
                   f"{data.get('battery_capacity')}% batería, {phases} fase(s)")
        
        return data
