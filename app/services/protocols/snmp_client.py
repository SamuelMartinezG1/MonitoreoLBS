"""
Cliente SNMP async para UPS INVT.
Usa los OIDs del Enterprise .1.3.6.1.4.1.56788 (INVT).
Compatible con PySNMP 7.x async API.
"""

import logging
import asyncio
from typing import Dict, Any

from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
    ObjectType, ObjectIdentity, get_cmd
)

from app.utils.ups_oids import (
    UPS_BASE_OID, ENTERPRISE_OID,
    UPS_INFO_OIDS, UPS_STATUS_OIDS, UPS_BYPASS_OIDS,
    UPS_INPUT_OIDS, UPS_OUTPUT_OIDS, UPS_LOAD_OIDS,
    UPS_BATTERY_OIDS, SCALE_FACTORS, DECODERS,
    CRITICAL_OIDS,
)

logger = logging.getLogger(__name__)


class SNMPClientError(Exception):
    pass


class SNMPClient:
    def __init__(self, ip_address: str = None, port: int = 161,
                 community: str = 'public', timeout: int = 2, retries: int = 1,
                 mp_model: int = 1):
        """
        Cliente SNMP para UPS.
        
        Args:
            mp_model: 0 para SNMPv1, 1 para SNMPv2c (default: 1)
        """
        self.ip_address = ip_address
        self.community = community
        self.port = port
        self.timeout = timeout
        self.retries = retries
        self.mp_model = mp_model  # 0=v1, 1=v2c
        self.engine = SnmpEngine()

    async def get_ups_data(self, ip_address: str = None) -> Dict[str, Any]:
        """Consulta completa del UPS via SNMP usando OIDs INVT (56788)."""
        target_ip = ip_address or self.ip_address
        if not target_ip:
            return {}

        try:
            # Construir mapa de OIDs a consultar
            oids_map = {}

            # Status (critico - siempre)
            for key, oid in UPS_STATUS_OIDS.items():
                oids_map[f'status_{key}'] = oid

            # Input
            for key, oid in UPS_INPUT_OIDS.items():
                oids_map[f'input_{key}'] = oid

            # Output
            for key, oid in UPS_OUTPUT_OIDS.items():
                oids_map[f'output_{key}'] = oid

            # Load
            for key, oid in UPS_LOAD_OIDS.items():
                oids_map[f'load_{key}'] = oid

            # Battery
            for key, oid in UPS_BATTERY_OIDS.items():
                oids_map[f'battery_{key}'] = oid

            # Bypass
            for key, oid in UPS_BYPASS_OIDS.items():
                oids_map[f'bypass_{key}'] = oid

            # Consulta SNMP
            transport = await UdpTransportTarget.create(
                (target_ip, self.port),
                timeout=self.timeout,
                retries=self.retries
            )
            objetos = [ObjectType(ObjectIdentity(oid)) for oid in oids_map.values()]

            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                self.engine,
                CommunityData(self.community, mpModel=self.mp_model),
                transport,
                ContextData(),
                *objetos
            )

            if errorIndication:
                logger.error(f"Error crítico SNMP en {target_ip}: {errorIndication}")
                return {}

            # noSuchName es NORMAL (OID no existe en este dispositivo)
            # Procesamos los que SÍ exist en
            if errorStatus and str(errorStatus) != 'noSuchName':
                logger.warning(f"Error SNMP en {target_ip}: {errorStatus}")
                # No retornar vacío, procesar lo que se pueda

            # Mapear respuestas (incluso si algunas fallaron)
            keys = list(oids_map.keys())
            oid_list = list(oids_map.values())
            raw_data = {}
            for i, var in enumerate(varBinds):
                value_str = var[1].prettyPrint()
                # Filtrar valores que indican OID no existe
                if 'No Such Object' not in value_str and 'No Such Instance' not in value_str:
                    raw_data[keys[i]] = value_str

            # Formatear y escalar
            data = self._format_data(raw_data, oid_list, keys)

            # Detectar fases por heuristica de valores
            in_phases = 3 if data.get('input_voltage_b', 0) > 50 else 1
            out_phases = 3 if data.get('output_voltage_b', 0) > 50 else 1
            data['_phases_in'] = in_phases
            data['_phases_out'] = out_phases
            data['_phases'] = out_phases

            return data

        except Exception as e:
            logger.exception(f"Fallo critico SNMP {target_ip}: {e}")
            return {}

    def _format_data(self, raw_data: Dict[str, str], oid_list: list, keys: list) -> Dict[str, Any]:
        """Escala valores segun SCALE_FACTORS y decodifica enums."""
        formatted = {}

        for i, (key, val_str) in enumerate(raw_data.items()):
            oid = oid_list[i]
            scale = SCALE_FACTORS.get(oid, None)

            # Intentar convertir a numero
            try:
                num_val = float(val_str)

                if scale:
                    formatted[key] = round(num_val * scale, 2)
                else:
                    formatted[key] = num_val
            except (ValueError, TypeError):
                formatted[key] = val_str

        # Mapear a nombres amigables para el frontend
        result = {}

        # Input
        result['input_voltage_l1'] = formatted.get('input_voltage_a', 0)
        result['input_voltage_l2'] = formatted.get('input_voltage_b', 0)
        result['input_voltage_l3'] = formatted.get('input_voltage_c', 0)
        result['input_frequency'] = formatted.get('input_frequency_a', 0)

        # Output
        result['output_voltage_l1'] = formatted.get('output_voltage_a', 0)
        result['output_voltage_l2'] = formatted.get('output_voltage_b', 0)
        result['output_voltage_l3'] = formatted.get('output_voltage_c', 0)
        result['output_frequency'] = formatted.get('output_frequency_a', 0)
        result['output_current'] = formatted.get('output_current_a', 0)
        result['output_current_l1'] = formatted.get('output_current_a', 0)
        result['output_current_l2'] = formatted.get('output_current_b', 0)
        result['output_current_l3'] = formatted.get('output_current_c', 0)
        result['output_load'] = formatted.get('load_percent_a', 0)
        result['active_power'] = formatted.get('output_active_power_total', 0)
        result['apparent_power'] = formatted.get('output_apparent_power_total', 0)
        result['power_factor'] = formatted.get('output_power_factor_a', 0)

        # Battery
        result['battery_voltage'] = formatted.get('battery_voltage', 0)
        result['battery_current'] = formatted.get('battery_current', 0)
        result['battery_capacity'] = formatted.get('battery_charge_percent', 0)
        result['battery_runtime'] = formatted.get('battery_runtime_remaining', 0)
        result['temperature'] = formatted.get('battery_temperature', 0)

        # Status (decodificar enums) - robusto a errores
        ps_raw = formatted.get('status_power_source', 0)
        try:
            if ps_raw and str(ps_raw) != '0' and 'No Such Object' not in str(ps_raw):
                result['power_source'] = DECODERS['power_source'].get(int(ps_raw), str(ps_raw))
            else:
                result['power_source'] = 'Unknown'
        except (ValueError, TypeError):
            result['power_source'] = str(ps_raw) if ps_raw else 'Unknown'

        bs_raw = formatted.get('status_battery_status', 0)
        try:
            if bs_raw and str(bs_raw) != '0' and 'No Such Object' not in str(bs_raw):
                result['battery_status'] = DECODERS['battery_status'].get(int(bs_raw), str(bs_raw))
            else:
                result['battery_status'] = 'Unknown'
        except (ValueError, TypeError):
            result['battery_status'] = str(bs_raw) if bs_raw else 'Unknown'

        return result

    # --- Metodos de compatibilidad ---

    def test_connection(self):
        """Test de conexion sincrono."""
        try:
            res = asyncio.run(self.get_oid_async(UPS_INFO_OIDS['model']))
            if res:
                return True, "Conexion exitosa"
            else:
                return False, "No se recibio respuesta"
        except Exception as e:
            return False, str(e)

    def get_oid(self, oid):
        """Wrapper sincrono para obtener un OID."""
        return asyncio.run(self.get_oid_async(oid))

    async def get_oid_async(self, oid: str, ip_address: str = None):
        target_ip = ip_address or self.ip_address
        if not target_ip:
            raise SNMPClientError("IP no especificada")

        try:
            transport = await UdpTransportTarget.create(
                (target_ip, self.port),
                timeout=self.timeout,
                retries=self.retries
            )
            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                self.engine,
                CommunityData(self.community, mpModel=self.mp_model),
                transport,
                ContextData(),
                ObjectType(ObjectIdentity(oid))
            )

            if errorIndication:
                raise SNMPClientError(f"Error SNMP: {errorIndication}")
            if errorStatus:
                raise SNMPClientError(f"Error Estado SNMP: {errorStatus.prettyPrint()}")

            return varBinds[0][1].prettyPrint()
        except SNMPClientError:
            raise
        except Exception as e:
            logger.error(f"Error get_oid: {e}")
            return None
