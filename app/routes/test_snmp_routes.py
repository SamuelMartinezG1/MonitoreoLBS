"""
Rutas Flask para pruebas de conexión SNMP.
Proporciona endpoints para probar conectividad SNMP con dispositivos UPS.

Autor: Sistema de Monitoreo UPS
Fecha: 2026-01-27
"""

from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required
import logging

from app.services.protocols.snmp_client import SNMPClient, SNMPClientError
from app.utils.ups_oids import UPS_OIDS, SCALE_FACTORS, DECODERS

logger = logging.getLogger(__name__)

test_snmp_bp = Blueprint('test_snmp', __name__)


@test_snmp_bp.route('/snmp-test')
@login_required
def snmp_test_page():
    """Renderiza la página de prueba SNMP."""
    return render_template('snmp_test.html')


@test_snmp_bp.route('/api/snmp/test', methods=['POST'])
@login_required
def test_snmp_connection():
    """
    Prueba la conectividad SNMP con un dispositivo UPS.
    
    Espera JSON:
    {
        "ip": "192.168.1.100",
        "port": 161,
        "community": "public"
    }
    
    Retorna:
    {
        "status": "success" | "error",
        "connected": true | false,
        "device_info": {...},
        "battery_data": {...},
        "error": "mensaje de error"
    }
    """
    try:
        data = request.get_json()
        
        # Validar entrada
        if not data or 'ip' not in data:
            return jsonify({
                'status': 'error',
                'error': 'IP address es requerida'
            }), 400
        
        ip = data['ip']
        port = int(data.get('port', 161))
        community = data.get('community', 'public')
        
        logger.info(f"Probando conexión SNMP a {ip}:{port}")
        
        # Crear cliente SNMP
        client = SNMPClient(ip, port, community, timeout=5, retries=2)
        
        # Test de conectividad básica
        success, message = client.test_connection()
        
        if not success:
            return jsonify({
                'status': 'error',
                'connected': False,
                'error': message
            })
        
        # Leer información del dispositivo
        device_info = {}
        info_oids = UPS_OIDS['info']
        
        try:
            device_info['model'] = client.get_oid(info_oids['model'])
            device_info['serial_number'] = client.get_oid(info_oids['serial_number'])
            device_info['company_name'] = client.get_oid(info_oids['company_name'])
            device_info['rated_power'] = client.get_oid(info_oids['rated_power'])
        except Exception as e:
            logger.warning(f"Error leyendo info del dispositivo: {e}")
        
        # Leer datos de batería (críticos)
        battery_data = {}
        battery_oids = UPS_OIDS['battery']
        
        try:
            # Voltaje batería (con escala)
            voltage_raw = client.get_oid(battery_oids['voltage'])
            if voltage_raw:
                voltage = float(voltage_raw) * 0.1  # Factor de escala
                battery_data['voltage'] = f"{voltage:.1f}"
                battery_data['voltage_unit'] = "V"
            
            # Carga batería
            charge = client.get_oid(battery_oids['charge_percent'])
            if charge:
                battery_data['charge_percent'] = charge
            
            # Temperatura
            temp = client.get_oid(battery_oids['temperature'])
            if temp:
                battery_data['temperature'] = temp
                battery_data['temperature_unit'] = "°C"
            
            # Tiempo restante
            runtime = client.get_oid(battery_oids['runtime_remaining'])
            if runtime:
                battery_data['runtime_remaining'] = runtime
                battery_data['runtime_unit'] = "min"
                
        except Exception as e:
            logger.warning(f"Error leyendo datos de batería: {e}")
        
        # Leer estado
        status_data = {}
        status_oids = UPS_OIDS['status']
        
        try:
            power_source_raw = client.get_oid(status_oids['power_source'])
            if power_source_raw:
                power_source_int = int(power_source_raw)
                status_data['power_source'] = DECODERS['power_source'].get(
                    power_source_int, 
                    f"Desconocido ({power_source_int})"
                )
            
            battery_status_raw = client.get_oid(status_oids['battery_status'])
            if battery_status_raw:
                battery_status_int = int(battery_status_raw)
                status_data['battery_status'] = DECODERS['battery_status'].get(
                    battery_status_int,
                    f"Desconocido ({battery_status_int})"
                )
        except Exception as e:
            logger.warning(f"Error leyendo estado: {e}")
        
        # Leer entrada/salida
        electrical_data = {}
        
        try:
            input_oids = UPS_OIDS['input']
            output_oids = UPS_OIDS['output']
            
            input_voltage = client.get_oid(input_oids['voltage_a'])
            if input_voltage:
                electrical_data['input_voltage'] = input_voltage
            
            output_voltage = client.get_oid(output_oids['voltage_a'])
            if output_voltage:
                electrical_data['output_voltage'] = output_voltage
            
            # Potencia activa total (con escala)
            power_raw = client.get_oid(output_oids['active_power_total'])
            if power_raw:
                power = float(power_raw) * 0.1  # kW
                electrical_data['active_power'] = f"{power:.1f}"
                electrical_data['power_unit'] = "kW"
        except Exception as e:
            logger.warning(f"Error leyendo datos eléctricos: {e}")
        
        return jsonify({
            'status': 'success',
            'connected': True,
            'message': message,
            'device_info': device_info,
            'battery_data': battery_data,
            'status_data': status_data,
            'electrical_data': electrical_data
        })
        
    except SNMPClientError as e:
        logger.error(f"Error SNMP: {e}")
        return jsonify({
            'status': 'error',
            'connected': False,
            'error': str(e)
        }), 500
        
    except Exception as e:
        logger.exception(f"Error inesperado en test SNMP: {e}")
        return jsonify({
            'status': 'error',
            'connected': False,
            'error': f'Error inesperado: {str(e)}'
        }), 500


@test_snmp_bp.route('/api/snmp/query-oid', methods=['POST'])
@login_required
def query_custom_oid():
    """
    Consulta un OID personalizado.
    
    Espera JSON:
    {
        "ip": "192.168.1.100",
        "port": 161,
        "community": "public",
        "oid": ".1.3.6.1.4.1.56788.1.1.1.1.3.0"
    }
    
    Retorna:
    {
        "status": "success" | "error",
        "oid": "...",
        "value": "..."
    }
    """
    try:
        data = request.get_json()
        
        if not data or 'ip' not in data or 'oid' not in data:
            return jsonify({
                'status': 'error',
                'error': 'IP y OID son requeridos'
            }), 400
        
        ip = data['ip']
        port = int(data.get('port', 161))
        community = data.get('community', 'public')
        oid = data['oid']
        
        # Asegurar que el OID comience con punto
        if not oid.startswith('.'):
            oid = '.' + oid
        
        logger.info(f"Consultando OID {oid} en {ip}:{port}")
        
        client = SNMPClient(ip, port, community, timeout=5, retries=2)
        value = client.get_oid(oid)
        
        if value is not None:
            return jsonify({
                'status': 'success',
                'oid': oid,
                'value': str(value)
            })
        else:
            return jsonify({
                'status': 'error',
                'error': 'No se recibió respuesta del OID'
            }), 404
            
    except SNMPClientError as e:
        logger.error(f"Error consultando OID: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500
        
    except Exception as e:
        logger.exception(f"Error inesperado consultando OID: {e}")
        return jsonify({
            'status': 'error',
            'error': f'Error inesperado: {str(e)}'
        }), 500
