"""
SNMP Advanced Scanner - Autodetección de Configuración
Prueba diferentes versiones, communities y OIDs automáticamente
"""

import asyncio
import logging
from typing import Dict, List, Tuple, Any, Optional, Callable
from datetime import datetime
from pysnmp.hlapi.asyncio import (
    SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
    ObjectType, ObjectIdentity, get_cmd, next_cmd
)

logger = logging.getLogger(__name__)


class SNMPScanner:
    """
    Escáner avanzado que auto-detecta la configuración SNMP correcta
    """
    
    # OIDs estándar que todos los dispositivos SNMP deberían soportar (MIB-II)
    STANDARD_OIDS = {
        'sysDescr': '1.3.6.1.2.1.1.1.0',       # Descripción del sistema
        'sysObjectID': '1.3.6.1.2.1.1.2.0',    # ID del objeto
        'sysUpTime': '1.3.6.1.2.1.1.3.0',      # Tiempo activo
        'sysContact': '1.3.6.1.2.1.1.4.0',     # Contacto
        'sysName': '1.3.6.1.2.1.1.5.0',        # Nombre
        'system_location': '1.3.6.1.2.1.1.6.0', # Ubicación
    }
    
    # OIDs UPS-MIB RFC 1628 (Estándar para UPS)
    UPS_MIB_OIDS = {
        # Identificación
        'ups_ident_manufacturer': '1.3.6.1.2.1.33.1.1.1.0',
        'ups_ident_model': '1.3.6.1.2.1.33.1.1.2.0',
        'ups_ident_sw_version': '1.3.6.1.2.1.33.1.1.3.0',
        'ups_ident_agent_sw_version': '1.3.6.1.2.1.33.1.1.4.0',
        
        # Batería
        'ups_battery_status': '1.3.6.1.2.1.33.1.2.1.0',
        'ups_seconds_on_battery': '1.3.6.1.2.1.33.1.2.2.0',
        'ups_estimated_minutes_remaining': '1.3.6.1.2.1.33.1.2.3.0',
        'ups_estimated_charge_remaining': '1.3.6.1.2.1.33.1.2.4.0',
        'ups_battery_voltage': '1.3.6.1.2.1.33.1.2.5.0',
        'ups_battery_current': '1.3.6.1.2.1.33.1.2.6.0',
        'ups_battery_temperature': '1.3.6.1.2.1.33.1.2.7.0',
        
        # Entrada
        'ups_input_line_bads': '1.3.6.1.2.1.33.1.3.1.0',
        'ups_input_num_lines': '1.3.6.1.2.1.33.1.3.2.0',
        'ups_input_frequency': '1.3.6.1.2.1.33.1.3.3.1.2.1',
        'ups_input_voltage': '1.3.6.1.2.1.33.1.3.3.1.3.1',
        'ups_input_current': '1.3.6.1.2.1.33.1.3.3.1.4.1',
        'ups_input_true_power': '1.3.6.1.2.1.33.1.3.3.1.5.1',
        
        # Salida
        'ups_output_source': '1.3.6.1.2.1.33.1.4.1.0',
        'ups_output_frequency': '1.3.6.1.2.1.33.1.4.2.0',
        'ups_output_num_lines': '1.3.6.1.2.1.33.1.4.3.0',
        'ups_output_voltage': '1.3.6.1.2.1.33.1.4.4.1.2.1',
        'ups_output_current': '1.3.6.1.2.1.33.1.4.4.1.3.1',
        'ups_output_power': '1.3.6.1.2.1.33.1.4.4.1.4.1',
        'ups_output_percent_load': '1.3.6.1.2.1.33.1.4.4.1.5.1',
    }
    
    # OIDs Enterprise INVT
    INVT_OIDS = {
        'invt_model': '1.3.6.1.4.1.56788.1.1.1.0',
        'invt_serial': '1.3.6.1.4.1.56788.1.1.2.0',
        'invt_input_voltage_a': '1.3.6.1.4.1.56788.1.3.1.2.1',
        'invt_output_voltage_a': '1.3.6.1.4.1.56788.1.4.1.2.1',
        'invt_battery_voltage': '1.3.6.1.4.1.56788.1.6.1.0',
    }
    
    # Community strings comunes
    COMMON_COMMUNITIES = [
        'public',
        'private',
        'admin',
        'snmp',
        'manager',
        'ups',
        'monitor'
    ]
    
    def __init__(self, ip: str, port: int = 161, timeout: int = 3, callback: Optional[Callable] = None):
        self.ip = ip
        self.port = port
        self.timeout = timeout
        self.engine = SnmpEngine()
        self.callback = callback  # Para actualizar UI en tiempo real
        self.results = []
        
    def log_progress(self, message: str, level: str = 'info'):
        """Log con timestamp y envío a callback si está disponible"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        formatted = f"[{timestamp}] {message}"
        
        if level == 'error':
            logger.error(formatted)
        elif level == 'warning':
            logger.warning(formatted)
        else:
            logger.info(formatted)
        
        if self.callback:
            self.callback(formatted, level)
        
        self.results.append({'timestamp': timestamp, 'message': message, 'level': level})
    
    async def auto_detect(self) -> Dict[str, Any]:
        """
        Auto-detecta la mejor configuración SNMP para el dispositivo
        Retorna dict con configuración óptima encontrada
        """
        self.log_progress(f"🔍 Iniciando auto-detección SNMP para {self.ip}", 'info')
        
        best_config = {
            'ip': self.ip,
            'port': self.port,
            'success': False,
            'community': None,
            'version': None,
            'oids_working': [],
            'device_info': {},
            'capabilities': [],
            'error': None
        }
        
        # Paso 1: Probar versiones y communities
        self.log_progress("📡 Paso 1/4: Probando versiones SNMP y community strings...", 'info')
        snmp_versions = [
            (1, 'SNMPv1'),  # mpModel=0
            (1, 'SNMPv2c'), # mpModel=1
        ]
        
        for mpModel, version_name in snmp_versions:
            self.log_progress(f"  → Probando {version_name}...", 'info')
            
            for community in self.COMMON_COMMUNITIES:
                self.log_progress(f"    • Community: '{community}'", 'info')
                
                # Test con OID estándar más básico
                success, value = await self._test_oid(
                    self.STANDARD_OIDS['sysDescr'],
                    community,
                    mpModel
                )
                
                if success:
                    self.log_progress(f"    ✅ ¡ÉXITO! {version_name} con community '{community}'", 'success')
                    best_config['success'] = True
                    best_config['community'] = community
                    best_config['version'] = version_name
                    best_config['mpModel'] = mpModel
                    best_config['device_info']['sysDescr'] = value
                    break
            
            if best_config['success']:
                break
        
        if not best_config['success']:
            self.log_progress("❌ No se pudo establecer comunicación SNMP", 'error')
            best_config['error'] = 'No se encontró versión/community válida'
            return best_config
        
        # Paso 2: Obtener info básica del sistema
        self.log_progress("📋 Paso 2/4: Obteniendo información del sistema...", 'info')
        await self._get_system_info(best_config)
        
        # Paso 3: Detectar tipo de UPS (UPS-MIB vs Enterprise)
        self.log_progress("🔌 Paso 3/4: Detectando tipo de UPS...", 'info')
        await self._detect_ups_type(best_config)
        
        # Paso 4: Escanear OIDs disponibles
        self.log_progress("🗂️  Paso 4/4: Escaneando OIDs disponibles...", 'info')
        await self._scan_available_oids(best_config)
        
        # Resumen
        self.log_progress("="*60, 'info')
        self.log_progress("📊 RESUMEN DE DETECCIÓN:", 'success')
        self.log_progress(f"  Versión SNMP: {best_config['version']}", 'success')
        self.log_progress(f"  Community: {best_config['community']}", 'success')
        self.log_progress(f"  Dispositivo: {best_config['device_info'].get('sysDescr', 'N/A')}", 'success')
        self.log_progress(f"  OIDs funcionando: {len(best_config['oids_working'])}", 'success')
        
        if best_config.get('ups_type'):
            self.log_progress(f"  Tipo UPS: {best_config['ups_type']}", 'success')
        
        self.log_progress("="*60, 'info')
        
        return best_config
    
    async def _test_oid(self, oid: str, community: str, mpModel: int = 1) -> Tuple[bool, Optional[str]]:
        """Prueba un OID específico y retorna (success, value)"""
        try:
            transport = await UdpTransportTarget.create(
                (self.ip, self.port),
                timeout=self.timeout,
                retries=0
            )
            
            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                self.engine,
                CommunityData(community, mpModel=mpModel),
                transport,
                ContextData(),
                ObjectType(ObjectIdentity(oid))
            )
            
            if errorIndication or errorStatus:
                return False, None
            
            value = varBinds[0][1].prettyPrint()
            return True, value
            
        except Exception as e:
            return False, None
    
    async def _get_system_info(self, config: Dict):
        """Obtiene información básica del sistema"""
        for name, oid in self.STANDARD_OIDS.items():
            success, value = await self._test_oid(
                oid,
                config['community'],
                config['mpModel']
            )
            
            if success:
                config['device_info'][name] = value
                self.log_progress(f"  ✅ {name}: {value}", 'info')
                config['oids_working'].append(oid)
    
    async def _detect_ups_type(self, config: Dict):
        """Detecta si es UPS-MIB estándar o Enterprise INVT"""
        # Probar UPS-MIB estándar
        ups_mib_works = 0
        for name, oid in list(self.UPS_MIB_OIDS.items())[:5]:  # Probar primeros 5
            success, value = await self._test_oid(
                oid,
                config['community'],
                config['mpModel']
            )
            
            if success:
                ups_mib_works += 1
                if name not in config['device_info']:
                    config['device_info'][name] = value
                config['oids_working'].append(oid)
        
        # Probar INVT
        invt_works = 0
        for name, oid in self.INVT_OIDS.items():
            success, value = await self._test_oid(
                oid,
                config['community'],
                config['mpModel']
            )
            
            if success:
                invt_works += 1
                if name not in config['device_info']:
                    config['device_info'][name] = value
                config['oids_working'].append(oid)
        
        # Determinar tipo
        if invt_works > 0:
            config['ups_type'] = 'INVT Enterprise'
            config['capabilities'].append('invt_oids')
            self.log_progress(f"  ✅ Detectado: INVT Enterprise ({invt_works} OIDs)", 'success')
        
        if ups_mib_works > 0:
            if config.get('ups_type'):
                config['ups_type'] += ' + UPS-MIB'
            else:
                config['ups_type'] = 'UPS-MIB Estándar'
            config['capabilities'].append('ups_mib')
            self.log_progress(f"  ✅ Detectado: UPS-MIB Estándar ({ups_mib_works} OIDs)", 'success')
        
        if not config.get('ups_type'):
            config['ups_type'] = 'Genérico (MIB-II solamente)'
            self.log_progress("  ⚠️  Solo responde a MIB-II básico", 'warning')
    
    async def _scan_available_oids(self, config: Dict):
        """Escanea todos los OIDs conocidos y reporta cuáles funcionan"""
        all_oids = {**self.UPS_MIB_OIDS, **self.INVT_OIDS}
        
        working = []
        for name, oid in all_oids.items():
            if oid in config['oids_working']:  # Ya lo probamos
                continue
                
            success, value = await self._test_oid(
                oid,
                config['community'],
                config['mpModel']
            )
            
            if success:
                working.append(name)
                config['oids_working'].append(oid)
                if name not in config['device_info']:
                    config['device_info'][name] = value
        
        if working:
            self.log_progress(f"  ✅ {len(working)} OIDs adicionales disponibles", 'info')
    
    async def get_full_data(self, config: Dict) -> Dict[str, Any]:
        """
        Obtiene datos completos del UPS usando la configuración detectada
        """
        if not config.get('success'):
            return {}
        
        data = {}
        
        # Usar OIDs que sabemos que funcionan
        if 'ups_mib' in config.get('capabilities', []):
            # Mapear UPS-MIB a formato genérico
            ups_data = await self._get_ups_mib_data(config)
            data.update(ups_data)
        
        if 'invt_oids' in config.get('capabilities', []):
            # Obtener datos INVT
            invt_data = await self._get_invt_data(config)
            data.update(invt_data)
        
        return data
    
    async def _get_ups_mib_data(self, config: Dict) -> Dict:
        """Obtiene datos usando UPS-MIB estándar"""
        data = {}
        
        for name, oid in self.UPS_MIB_OIDS.items():
            success, value = await self._test_oid(
                oid,
                config['community'],
                config['mpModel']
            )
            
            if success:
                # Mapear a nombres genéricos
                try:
                    num_value = float(value)
                    
                    # Aplicar escalado según UPS-MIB
                    if 'voltage' in name:
                        num_value = num_value / 10  # UPS-MIB usa decisión (1/10)
                    elif 'current' in name:
                        num_value = num_value / 10
                    elif 'frequency' in name:
                        num_value = num_value / 10
                    
                    data[name] = num_value
                except:
                    data[name] = value
        
        return data
    
    async def _get_invt_data(self, config: Dict) -> Dict:
        """Obtiene datos usando OIDs INVT"""
        data = {}
        
        for name, oid in self.INVT_OIDS.items():
            success, value = await self._test_oid(
                oid,
                config['community'],
                config['mpModel']
            )
            
            if success:
                try:
                    data[name] = float(value)
                except:
                    data[name] = value
        
        return data
