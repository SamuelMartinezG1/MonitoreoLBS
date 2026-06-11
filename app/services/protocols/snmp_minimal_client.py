# -*- coding: utf-8 -*-
"""
Cliente SNMP Minimalista - Solo 5 OIDs que funcionan
Para UPS con soporte SNMP limitado
"""

import os
import logging
from pysnmp.hlapi.v3arch.asyncio import *

logger = logging.getLogger(__name__)

# Timeouts tolerantes a enlaces lentos/intermitentes (p.ej. UPS por SIM/ZeroTier).
# Configurables por entorno; suben a 5 s / 2 reintentos por defecto.
SNMP_TIMEOUT_S = float(os.environ.get('SNMP_TIMEOUT_S', 5))
SNMP_RETRIES   = int(os.environ.get('SNMP_RETRIES', 2))

class MinimalSNMPClient:
    """
    Cliente SNMP minimalista para UPS con soporte limitado.
    Solo consulta los 5 OIDs INVT que realmente funcionan.
    """
    
    # OIDs Megatec / Voltronic (Enterprise .935) detectados en escaneo
    MINIMAL_OIDS = {
        'megatec_model': '1.3.6.1.4.1.935.1.1.1.1.1.1.0',     
        'megatec_version': '1.3.6.1.4.1.935.1.1.1.1.2.1.0',
        'megatec_batt_capacity': '1.3.6.1.4.1.935.1.1.1.2.2.1.0', # 90 -> 90%
        'megatec_batt_voltage': '1.3.6.1.4.1.935.1.1.1.2.2.2.0',  # 1060 -> 106.0V
        'megatec_input_voltage': '1.3.6.1.4.1.935.1.1.1.3.2.1.0', # 1232 -> 123.2V
        'megatec_input_freq': '1.3.6.1.4.1.935.1.1.1.3.2.4.0',    # 600 -> 60.0Hz
        'megatec_output_voltage': '1.3.6.1.4.1.935.1.1.1.4.2.1.0',# 1201 -> 120.1V
        'megatec_output_load': '1.3.6.1.4.1.935.1.1.1.4.2.3.0',   # 0 -> 0%
    }
    
    def __init__(self, community='public', port=161, mp_model=0):
        """
        Args:
            community: SNMP community string (default: 'public')
            port: SNMP port (default: 161)
            mp_model: 0=SNMPv1, 1=SNMPv2c
        """
        self.community = community
        self.port = port
        self.mp_model = mp_model
        self.engine = SnmpEngine()
    
    async def get_ups_data(self, target_ip):
        """
        Consulta los OIDs Megatec disponibles.
        """
        try:
            # Crear objetos SNMP
            objetos = [ObjectType(ObjectIdentity(oid)) for oid in self.MINIMAL_OIDS.values()]
            
            # Crear transporte
            transport = await UdpTransportTarget.create((target_ip, self.port), timeout=SNMP_TIMEOUT_S, retries=SNMP_RETRIES)
            
            # Consultar (SNMPv1 a veces falla con multiples OIDs, pero probemos)
            # Si falla, podemos intentar uno a uno, pero probemos GET normal primero
            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                self.engine,
                CommunityData(self.community, mpModel=self.mp_model),
                transport,
                ContextData(),
                *objetos
            )
            
            # Si hay error, intentar fallback o retornar vacio
            if errorIndication or errorStatus:
                logger.warning(f"Error SNMP agrupado {target_ip}: {errorIndication or errorStatus}. Intentando individual...")
                # Fallback: consultar uno a uno (lento pero seguro en hardware viejo)
                raw_data = {}
                keys = list(self.MINIMAL_OIDS.keys())
                for key, oid in self.MINIMAL_OIDS.items():
                    try:
                        _, errSt, _, vb = await get_cmd(
                             self.engine,
                             CommunityData(self.community, mpModel=self.mp_model),
                             transport,
                             ContextData(),
                             ObjectType(ObjectIdentity(oid))
                        )
                        if not errSt and vb:
                            raw_data[key] = vb[0][1].prettyPrint()
                    except:
                        pass
                
                if raw_data:
                    return self._format_minimal_data(raw_data)
                return {}
            
            # Mapear respuestas agrupadas
            keys = list(self.MINIMAL_OIDS.keys())
            raw_data = {}
            
            for i, var in enumerate(varBinds):
                value_str = var[1].prettyPrint()
                raw_data[keys[i]] = value_str
            
            # Formatear datos
            data = self._format_minimal_data(raw_data)
            
            logger.info(f"✓ UPS Megatec {target_ip}: {data.get('input_voltage_l1', 0)}V In, {data.get('battery_voltage', 0)}V Bat")
            
            return data
            
        except Exception as e:
            logger.error(f"Error consultando UPS {target_ip}: {e}")
            return {}
    
    def _format_minimal_data(self, raw):
        """
        Formatea los valores Megatec (divisores 10).
        """
        def safe_float(value, divisor=1.0):
            try:
                # Limpiar chars no numericos raros
                clean = ''.join(c for c in str(value) if c.isdigit() or c == '.')
                return float(clean) / divisor
            except:
                return 0.0
        
        # OIDs Megatec suelen requerir divisor 10
        input_voltage = safe_float(raw.get('megatec_input_voltage', 0), 10.0)
        output_voltage = safe_float(raw.get('megatec_output_voltage', 0), 10.0)
        battery_voltage = safe_float(raw.get('megatec_batt_voltage', 0), 10.0)
        input_freq = safe_float(raw.get('megatec_input_freq', 0), 10.0)
        batt_capacity = safe_float(raw.get('megatec_batt_capacity', 0), 1.0) # Ya esta en %
        load_pct = safe_float(raw.get('megatec_output_load', 0), 1.0)
        
        data = {
            # === DATOS REALES === 
            'manufacturer': 'Megatec/Voltronic',
            'model': raw.get('megatec_model', 'Unknown'),
            'serial': raw.get('megatec_version', 'N/A'),
            
            # Voltajes (Monofasico L1)
            'input_voltage_l1': input_voltage,
            'input_voltage_l2': 0, 
            'input_voltage_l3': 0,
            'input_voltage': input_voltage,
            
            'output_voltage_l1': output_voltage,
            'output_voltage_l2': 0,
            'output_voltage_l3': 0,
            'output_voltage': output_voltage,
            
            'input_frequency': input_freq,
            'output_frequency': input_freq, # Asumir igual si no hay output freq OID
            
            # Batería
            'battery_voltage': battery_voltage,
            # 'battery_capacity' es el nombre que espera el mapeador del frontend
            # (antes solo se emitía 'bateria_pct' y el % de batería se perdía).
            'battery_capacity': batt_capacity,
            'bateria_pct': batt_capacity,
            'carga_pct': load_pct,
            'output_load': load_pct,

            # Factor de potencia: NO se mide aquí; no lo inventamos (antes 0.9).
            'power_factor': None,
            'current_out_l1': 0, # Se podría calcular con Load + Potencia Nominal si se supiera
            
            'power_source': 'Battery' if input_voltage < 50 else 'Normal',
            
            # Metadatos
            '_phases': 1,  # Es monofásico
            '_ups_type': 'megatec_snmp',
            '_data_quality': 'good_basic', 
        }
        
        return data
    
    def _estimate_power_source(self, input_v, output_v):
        """
        Estima la fuente de energía basándose en voltajes.
        """
        if input_v > 100:
            return 'Normal'  # Hay voltaje de entrada
        elif output_v > 100:
            return 'Battery'  # Salida sin entrada = batería
        else:
            return 'Unknown'
