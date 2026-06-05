# -*- coding: utf-8 -*-
"""
Auto-detección inteligente de UPS.
Escanea un dispositivo por IP y detecta protocolo, tipo, fases, community, etc.
100% SÍNCRONO — No usa asyncio en ningún punto.
Usa subprocess con snmpget del sistema (paquete snmp instalado en Docker).
"""

import os
import subprocess
import socket
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def extraer_numero_sitio(ip: str) -> int:
    """Extrae el número de sitio de la IP. 192.168.3.10 → 3"""
    partes = ip.split('.')
    if len(partes) == 4 and partes[0] == '192' and partes[1] == '168':
        try:
            return int(partes[2])
        except ValueError:
            return 0
    return 0


def _ping(ip: str, timeout: int = 5) -> bool:
    """Verifica conectividad con ping (síncrono)."""
    try:
        result = subprocess.run(
            ['ping', '-c', '1', '-W', str(timeout), ip],
            capture_output=True, timeout=timeout + 2
        )
        return result.returncode == 0
    except Exception:
        return False


def _snmp_get(ip: str, oid: str, community: str = 'public',
              version: str = '2c', port: int = 161,
              timeout: int = int(os.environ.get('SNMP_TIMEOUT_S', 5))) -> Optional[str]:
    """
    SNMP GET síncrono usando el comando snmpget del sistema.
    Retorna el valor como string o None si falla.
    """
    try:
        cmd = [
            'snmpget', '-v', version, '-c', community,
            '-t', str(timeout), '-r', '1',
            '-Oqv',  # Solo valor, sin OID ni tipo
            f'{ip}:{port}', oid
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 3)
        if result.returncode == 0 and result.stdout.strip():
            val = result.stdout.strip().strip('"')
            # Filtrar respuestas vacías o de error
            if val and 'No Such' not in val and 'noSuch' not in val and 'endOfMib' not in val.lower():
                return val
        return None
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception) as e:
        logger.debug("snmpget fallo para %s OID %s: %s", ip, oid, e)
        return None


def _probar_modbus(ip: str, port: int = 502, timeout: int = 3) -> bool:
    """Intenta conexión Modbus TCP (síncrono)."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((ip, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def _detectar_snmp(ip: str, port: int = 161) -> Dict[str, Any]:
    """
    Prueba comunidades y versiones SNMP de forma síncrona.
    Retorna dict con community, snmp_version, sysdescr o vacío si no responde.
    """
    communities = ['public', 'private', 'community']
    versiones = [('2c', 1), ('1', 0)]  # (nombre_version, mp_model)
    sys_descr_oid = '1.3.6.1.2.1.1.1.0'

    for community in communities:
        for ver_name, mp_model in versiones:
            val = _snmp_get(ip, sys_descr_oid, community, ver_name, port)
            if val:
                return {
                    'community': community,
                    'snmp_version': mp_model,
                    'snmp_version_name': f'v{ver_name}',
                    'sys_descr': val,
                }
    return {}


def _detectar_tipo_ups(ip: str, port: int, community: str, version: str) -> Dict[str, Any]:
    """
    Prueba los árboles OID conocidos para determinar el tipo de UPS.
    Retorna dict con ups_type, modelo, arboles_probados.
    """
    arboles = [
        {
            'nombre': 'UPS-MIB (RFC 1628)',
            'oid_test': '1.3.6.1.2.1.33.1.1.1.0',
            'ups_type': 'ups_mib_standard',
        },
        {
            'nombre': 'Megatec/Fujitsu',
            'oid_test': '1.3.6.1.4.1.935.1.1.1.1.1.1.0',
            'ups_type': 'megatec_snmp',
        },
        {
            'nombre': 'INVT Enterprise (26468)',
            'oid_test': '1.3.6.1.4.1.26468.1.1.1.1.0',
            'ups_type': 'invt_enterprise',
        },
        {
            'nombre': 'INVT Alternativo (56788)',
            'oid_test': '1.3.6.1.4.1.56788.1.1.1.0',
            'ups_type': 'invt_minimal',
        },
    ]

    resultados = []
    for arbol in arboles:
        val = _snmp_get(ip, arbol['oid_test'], community, version, port)
        resultados.append({
            'nombre': arbol['nombre'],
            'oid': arbol['oid_test'],
            'ups_type': arbol['ups_type'],
            'responde': val is not None,
            'valor': val,
        })

    detectado = next((r for r in resultados if r['responde']), None)
    return {
        'ups_type': detectado['ups_type'] if detectado else None,
        'modelo': detectado['valor'] if detectado else None,
        'arboles_probados': resultados,
    }


def _detectar_fases(ip: str, port: int, community: str, version: str, ups_type: str) -> int:
    """Detecta si el UPS es monofásico o trifásico (síncrono)."""
    if ups_type == 'ups_mib_standard':
        val = _snmp_get(ip, '1.3.6.1.2.1.33.1.3.2.0', community, version, port)
        if val:
            try:
                num = int(val)
                if num > 0:
                    return num
            except ValueError:
                pass
        return 1

    elif ups_type == 'megatec_snmp':
        return 1

    elif ups_type in ('invt_enterprise', 'invt_minimal'):
        val_l2 = _snmp_get(ip, '1.3.6.1.2.1.33.1.3.3.1.3.2', community, version, port)
        if val_l2:
            try:
                v = float(val_l2)
                if v > 10:
                    return 3
            except ValueError:
                pass
        return 1

    return 1


def _leer_datos_actuales(ip: str, port: int, community: str, version: str, ups_type: str) -> tuple:
    """Lee los datos actuales del UPS para verificar qué variables están disponibles (síncrono)."""
    datos = {}
    datos_detectados = {}

    if ups_type == 'megatec_snmp':
        oids = {
            'voltaje_entrada': '1.3.6.1.4.1.935.1.1.1.3.2.1.0',
            'voltaje_salida': '1.3.6.1.4.1.935.1.1.1.4.2.1.0',
            'frecuencia': '1.3.6.1.4.1.935.1.1.1.3.2.4.0',
            'bateria': '1.3.6.1.4.1.935.1.1.1.2.2.1.0',
            'carga': '1.3.6.1.4.1.935.1.1.1.4.2.3.0',
        }
    elif ups_type == 'ups_mib_standard':
        oids = {
            'voltaje_entrada': '1.3.6.1.2.1.33.1.3.3.1.3.1',
            'voltaje_salida': '1.3.6.1.2.1.33.1.4.4.1.2.1',
            'frecuencia': '1.3.6.1.2.1.33.1.3.3.1.2.1',
            'bateria': '1.3.6.1.2.1.33.1.2.4.0',
            'carga': '1.3.6.1.2.1.33.1.4.4.1.5.1',
            'temperatura': '1.3.6.1.2.1.33.1.2.7.0',
            'corriente': '1.3.6.1.2.1.33.1.4.4.1.3.1',
        }
    else:
        oids = {
            'voltaje_entrada': '1.3.6.1.2.1.33.1.3.3.1.3.1',
            'voltaje_salida': '1.3.6.1.2.1.33.1.4.4.1.2.1',
            'frecuencia': '1.3.6.1.2.1.33.1.3.3.1.2.1',
            'bateria': '1.3.6.1.2.1.33.1.2.4.0',
            'carga': '1.3.6.1.2.1.33.1.4.4.1.5.1',
            'temperatura': '1.3.6.1.2.1.33.1.2.7.0',
            'corriente': '1.3.6.1.2.1.33.1.4.4.1.3.1',
        }

    for nombre, oid in oids.items():
        val = _snmp_get(ip, oid, community, version, port)
        datos_detectados[nombre] = val is not None
        if val is not None:
            try:
                datos[nombre] = float(val)
            except (ValueError, TypeError):
                datos[nombre] = val

    return datos, datos_detectados


def auto_detectar_ups(ip: str, db=None) -> Dict[str, Any]:
    """
    Escaneo completo de un dispositivo UPS. 100% SÍNCRONO.
    No usa asyncio en ningún punto.
    Retorna diccionario con todos los parámetros detectados.
    """
    resultado = {
        'ip': ip,
        'ping': False,
        'protocolo': 'desconocido',
        'snmp_version': None,
        'snmp_version_name': None,
        'community': None,
        'ups_type': None,
        'fases': None,
        'sitio_numero': extraer_numero_sitio(ip),
        'nombre_sugerido': None,
        'modelo': None,
        'snmp_port': 161,
        'datos_detectados': {},
        'voltaje_actual': None,
        'bateria_actual': None,
        'arboles_probados': [],
    }

    # PASO 1: Ping
    resultado['ping'] = _ping(ip)

    # PASO 2: Probar SNMP (síncrono con subprocess)
    snmp_info = _detectar_snmp(ip)

    if snmp_info:
        resultado['protocolo'] = 'snmp'
        resultado['community'] = snmp_info['community']
        resultado['snmp_version'] = snmp_info['snmp_version']
        resultado['snmp_version_name'] = snmp_info['snmp_version_name']

        # Versión como string para snmpget
        ver_str = '2c' if snmp_info['snmp_version'] == 1 else '1'

        # PASO 3: Detectar tipo de UPS
        tipo_info = _detectar_tipo_ups(ip, 161, snmp_info['community'], ver_str)
        resultado['ups_type'] = tipo_info['ups_type']
        resultado['modelo'] = tipo_info['modelo']
        resultado['arboles_probados'] = tipo_info['arboles_probados']

        if tipo_info['ups_type']:
            # PASO 4: Detectar fases
            resultado['fases'] = _detectar_fases(
                ip, 161, snmp_info['community'], ver_str, tipo_info['ups_type']
            )

            # PASO 5: Leer datos actuales
            datos, datos_detectados = _leer_datos_actuales(
                ip, 161, snmp_info['community'], ver_str, tipo_info['ups_type']
            )
            resultado['datos_detectados'] = datos_detectados

            # Extraer voltaje y batería para preview
            if 'voltaje_entrada' in datos:
                v = datos['voltaje_entrada']
                if tipo_info['ups_type'] == 'megatec_snmp' and isinstance(v, (int, float)) and v > 500:
                    v = v / 10.0
                resultado['voltaje_actual'] = round(v, 1) if isinstance(v, (int, float)) else None
            if 'bateria' in datos:
                b = datos['bateria']
                resultado['bateria_actual'] = round(b, 0) if isinstance(b, (int, float)) else None

    else:
        # PASO 6: Si SNMP no funciona, probar Modbus TCP
        if _probar_modbus(ip):
            resultado['protocolo'] = 'modbus'
            resultado['fases'] = 3

    # El ICMP ping puede fallar dentro del contenedor (sin cap_net_raw) aunque
    # el equipo SÍ responda por SNMP/Modbus. Si detectamos protocolo, está
    # alcanzable: que el indicador de la UI no muestre un falso "Ping ❌".
    if resultado['protocolo'] in ('snmp', 'modbus'):
        resultado['ping'] = True

    # PASO 7: Generar nombre sugerido
    sitio = resultado['sitio_numero']
    secuencia = 1
    if db and sitio > 0:
        try:
            dispositivos = db.obtener_monitoreo_ups()
            existentes = [d for d in dispositivos
                          if d.get('ip', '').startswith(f'192.168.{sitio}.')]
            secuencia = len(existentes) + 1
        except Exception:
            pass

    if sitio > 0:
        resultado['nombre_sugerido'] = f'UPS-{sitio:02d}-{secuencia:02d}'
    else:
        resultado['nombre_sugerido'] = f'UPS-NUEVO-{secuencia:02d}'

    return resultado
