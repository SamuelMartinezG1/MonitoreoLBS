"""
Rutas de Diagnóstico de Red y UPS
Herramientas integradas para probar conectividad y protocolos
"""

from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required
from app.permisos import permiso_requerido
import asyncio
import socket
import subprocess
import platform
from datetime import datetime

diagnostic_bp = Blueprint('diagnostic', __name__)


# NOTE: la vista de /diagnostico ahora la sirve `lbs_bp` con el nuevo diseño.
# Los endpoints /api/diagnostic/* continúan funcionando como JSON.


@diagnostic_bp.route('/api/diagnostic/ping', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def test_ping():
    """Test de ping a una IP"""
    data = request.json
    ip = data.get('ip', '')
    
    if not ip:
        return jsonify({'error': 'IP requerida'}), 400
    
    try:
        # Determinar comando según OS
        param = '-n' if platform.system().lower() == 'windows' else '-c'
        command = ['ping', param, '4', ip]
        
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=10
        )
        
        output = result.stdout + result.stderr
        success = result.returncode == 0
        
        return jsonify({
            'success': success,
            'output': output,
            'ip': ip
        })
    except subprocess.TimeoutExpired:
        return jsonify({
            'success': False,
            'output': f'Timeout: No se recibió respuesta de {ip} en 10 segundos',
            'ip': ip
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'output': f'Error: {str(e)}',
            'ip': ip
        })


@diagnostic_bp.route('/api/diagnostic/port', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def test_port():
    """Test de conectividad a un puerto específico"""
    data = request.json
    ip = data.get('ip', '')
    port = data.get('port', 0)
    
    if not ip or not port:
        return jsonify({'error': 'IP y puerto requeridos'}), 400
    
    try:
        # Crear socket con timeout
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        
        start_time = datetime.now()
        result = sock.connect_ex((ip, int(port)))
        end_time = datetime.now()
        
        sock.close()
        
        elapsed_ms = (end_time - start_time).total_seconds() * 1000
        
        if result == 0:
            return jsonify({
                'success': True,
                'output': f'✅ Puerto {port} ABIERTO en {ip}\nTiempo de respuesta: {elapsed_ms:.2f}ms',
                'ip': ip,
                'port': port,
                'open': True,
                'elapsed_ms': round(elapsed_ms, 2)
            })
        else:
            return jsonify({
                'success': False,
                'output': f'❌ Puerto {port} CERRADO o FILTRADO en {ip}\nError code: {result}',
                'ip': ip,
                'port': port,
                'open': False
            })
            
    except socket.timeout:
        return jsonify({
            'success': False,
            'output': f'⏱️ Timeout: Puerto {port} no responde en {ip}',
            'ip': ip,
            'port': port,
            'open': False
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'output': f'❌ Error: {str(e)}',
            'ip': ip,
            'port': port
        })


@diagnostic_bp.route('/api/diagnostic/snmp', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def test_snmp():
    """Test de conexión SNMP"""
    data = request.json
    ip = data.get('ip', '')
    community = data.get('community', 'public')
    port = data.get('port', 161)
    
    if not ip:
        return jsonify({'error': 'IP requerida'}), 400
    
    try:
        # Importar el cliente SNMP
        from app.services.protocols.snmp_client import SNMPClient
        
        async def run_test():
            client = SNMPClient(community=community, port=int(port))
            return await client.get_ups_data(ip)
        
        # Ejecutar test async
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(run_test())
        loop.close()
        
        if result:
            # Formatear resultado para mostrar
            output_lines = [
                f'✅ CONEXIÓN SNMP EXITOSA a {ip}:{port}',
                f'Community: {community}',
                '',
                '📊 Datos obtenidos:',
                '─' * 50
            ]
            
            # Agrupar por categorías
            categories = {
                'Entrada': ['input_voltage', 'input_frequency'],
                'Salida': ['output_voltage', 'output_current', 'output_load', 'output_frequency'],
                'Batería': ['battery_voltage', 'battery_capacity', 'battery_status', 'battery_runtime'],
                'Potencia': ['active_power', 'apparent_power', 'power_factor'],
                'Estado': ['power_source', 'temperature']
            }
            
            for category, keys in categories.items():
                found_data = False
                for key in keys:
                    # Buscar con sufijos L1, L2, L3
                    for suffix in ['', '_l1', '_l2', '_l3']:
                        full_key = f'{key}{suffix}'
                        if full_key in result and result[full_key] is not None:
                            if not found_data:
                                output_lines.append(f'\n{category}:')
                                found_data = True
                            output_lines.append(f'  {full_key:25s}: {result[full_key]}')
            
            return jsonify({
                'success': True,
                'output': '\n'.join(output_lines),
                'data': result,
                'ip': ip,
                'port': port,
                'community': community
            })
        else:
            return jsonify({
                'success': False,
                'output': f'❌ Sin respuesta SNMP de {ip}:{port}\n\nPosibles causas:\n- SNMP no habilitado en el dispositivo\n- Community string incorrecta (probaste: {community})\n- Puerto bloqueado por firewall\n- Dispositivo no alcanzable',
                'ip': ip,
                'port': port,
                'community': community
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'output': f'❌ Error en prueba SNMP:\n{str(e)}\n\nVerifica:\n- Módulo pysnmp instalado\n- IP correcta\n- Firewall no bloqueando puerto {port}',
            'ip': ip,
            'port': port
        })


@diagnostic_bp.route('/api/diagnostic/modbus', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def test_modbus():
    """Test de conexión Modbus TCP"""
    data = request.json
    ip = data.get('ip', '')
    port = data.get('port', 502)
    slave_id = data.get('slave_id', 1)
    
    if not ip:
        return jsonify({'error': 'IP requerida'}), 400
    
    try:
        from pymodbus.client import ModbusTcpClient
        
        output_lines = [
            f'🔍 Probando conexión Modbus TCP...',
            f'IP: {ip}:{port}',
            f'Slave ID: {slave_id}',
            ''
        ]
        
        # Crear cliente Modbus
        client = ModbusTcpClient(ip, port=int(port), timeout=3)
        
        # Intentar conexión
        connection = client.connect()
        
        if connection:
            output_lines.append(f'✅ Conexión Modbus establecida!')
            
            # Intentar leer algunos registros de prueba
            try:
                # Leer registro 0 (común en muchos dispositivos)
                result = client.read_holding_registers(0, 1, slave=int(slave_id))
                
                if not result.isError():
                    output_lines.append(f'✅ Lectura de registro exitosa')
                    output_lines.append(f'   Registro 0: {result.registers[0]}')
                else:
                    output_lines.append(f'⚠️  Registro no disponible (normal si no existe)')
                    
            except Exception as e:
                output_lines.append(f'⚠️  No se pudieron leer registros: {e}')
            
            client.close()
            
            output_lines.extend([
                '',
                '✅ El dispositivo responde a Modbus TCP',
                'Ahora necesitas:',
                '1. Configurar los registros correctos del UPS',
                '2. Verificar el Slave ID correcto'
            ])
            
            return jsonify({
                'success': True,
                'output': '\n'.join(output_lines),
                'ip': ip,
                'port': port,
                'slave_id': slave_id
            })
        else:
            output_lines.extend([
                f'❌ No se pudo conectar via Modbus TCP',
                '',
                'Posibles causas:',
                '- Puerto Modbus no habilitado en el UPS',
                '- Puerto bloqueado por firewall',
                '- IP o Puerto incorrectos',
                f'- Slave ID incorrecto (probaste: {slave_id})'
            ])
            
            return jsonify({
                'success': False,
                'output': '\n'.join(output_lines),
                'ip': ip,
                'port': port,
                'slave_id': slave_id
            })
            
    except ImportError:
        return jsonify({
            'success': False,
            'output': '❌ Error: Módulo pymodbus no instalado\n\nInstala con: pip install pymodbus',
            'ip': ip
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'output': f'❌ Error en prueba Modbus:\n{str(e)}',
            'ip': ip,
            'port': port
        })


@diagnostic_bp.route('/api/diagnostic/scan', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def scan_ip_range():
    """Escaneo rápido de IPs en un rango"""
    data = request.json
    network = data.get('network', '192.168.0')  # ej: 192.168.0
    start = data.get('start', 1)
    end = data.get('end', 254)
    
    try:
        output_lines = [
            f'🔍 Escaneando red {network}.{start}-{end}...',
            f'Buscando hosts activos y puertos comunes (502, 161)',
            ''
        ]
        
        hosts_found = []
        
        # Escaneo simple de ping
        for i in range(int(start), min(int(end) + 1, 255)):
            ip = f'{network}.{i}'
            
            # Ping simple
            param = '-n' if platform.system().lower() == 'windows' else '-c'
            command = ['ping', param, '1', '-w', '500', ip]
            
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=1
                )
                
                if result.returncode == 0:
                    output_lines.append(f'✅ {ip} - ACTIVO')
                    
                    # Probar puertos comunes
                    ports_info = []
                    for port in [502, 161, 80]:
                        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        sock.settimeout(0.5)
                        if sock.connect_ex((ip, port)) == 0:
                            port_name = {502: 'Modbus', 161: 'SNMP', 80: 'HTTP'}.get(port, str(port))
                            ports_info.append(f'{port_name}:{port}')
                        sock.close()
                    
                    if ports_info:
                        output_lines.append(f'   Puertos abiertos: {", ".join(ports_info)}')
                        
                    hosts_found.append({
                        'ip': ip,
                        'ports': ports_info
                    })
                    
            except (subprocess.TimeoutExpired, Exception):
                continue
        
        output_lines.extend([
            '',
            f'─' * 50,
            f'Total de hosts encontrados: {len(hosts_found)}'
        ])
        
        return jsonify({
            'success': True,
            'output': '\n'.join(output_lines),
            'hosts': hosts_found
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'output': f'❌ Error en escaneo: {str(e)}'
        })


@diagnostic_bp.route('/api/diagnostic/route', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def test_route():
    """Muestra la tabla de rutas del sistema"""
    try:
        if platform.system().lower() == 'windows':
            command = ['route', 'print']
        else:
            command = ['ip', 'route']
            
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=5
        )
        
        return jsonify({
            'success': True,
            'output': result.stdout + result.stderr
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'output': f'❌ Error obteniendo rutas: {str(e)}'
        })


@diagnostic_bp.route('/api/diagnostic/interfaces', methods=['GET'])
@login_required
@permiso_requerido('herramientas')
def get_interfaces():
    """Lista las interfaces de red del sistema"""
    try:
        if platform.system().lower() == 'windows':
            command = ['ipconfig', '/all']
        else:
            command = ['ip', 'addr']
            
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=5
        )
        
        return jsonify({
            'success': True,
            'output': result.stdout + result.stderr
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'output': f'❌ Error obteniendo interfaces: {str(e)}'
        })


@diagnostic_bp.route('/api/diagnostic/snmp-autodetect', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def snmp_autodetect():
    """
    Auto-detecta la mejor configuración SNMP para un UPS
    Prueba diferentes versiones, communities y OIDs
    """
    data = request.json
    ip = data.get('ip', '')
    
    if not ip:
        return jsonify({'error': 'IP requerida'}), 400
    
    try:
        from app.services.protocols.snmp_scanner import SNMPScanner
        
        # Crear scanner
        scanner = SNMPScanner(ip=ip, port=161, timeout=3)
        
        async def run_detection():
            return await scanner.auto_detect()
        
        # Ejecutar detección
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        config = loop.run_until_complete(run_detection())
        loop.close()
        
        # Formatear resultados para la terminal
        output_lines = []
        for log_entry in scanner.results:
            ts = log_entry['timestamp']
            msg = log_entry['message']
            output_lines.append(f"[{ts}] {msg}")
        
        return jsonify({
            'success': config.get('success', False),
            'output': '\n'.join(output_lines),
            'config': config,
            'ip': ip
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'output': f'❌ Error en auto-detección SNMP:\n{str(e)}',
            'ip': ip
        })


@diagnostic_bp.route('/api/diagnostic/snmp-walk', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def snmp_walk():
    """SNMP Walk (GetNext) hasta 50 OIDs. Async interno, wrapped sync."""
    data = request.json
    ip = data.get('ip')
    port = int(data.get('port', 161))
    community = data.get('community', 'public')
    version = int(data.get('version', 0))
    root_oid_str = data.get('oid', '1.3.6.1.2.1')

    if not ip:
        return jsonify({'success': False, 'error': 'IP requerida'}), 400

    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            next_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity,
        )

        async def _walk():
            results = []
            limit = 50
            engine = SnmpEngine()
            auth = CommunityData(community, mpModel=version)
            transport = await UdpTransportTarget.create((ip, port), timeout=2.0, retries=0)
            context = ContextData()
            current_oid = ObjectType(ObjectIdentity(root_oid_str))

            for _ in range(limit):
                errInd, errStat, _, varBinds = await next_cmd(
                    engine, auth, transport, context, current_oid
                )
                if errInd:
                    return {'success': False, 'error': f"Error de conexion: {errInd}"}
                if errStat:
                    if str(errStat) == 'noSuchName':
                        break
                    return {'success': False, 'error': f"Error SNMP: {errStat.prettyPrint()}"}
                if not varBinds:
                    break
                vb = varBinds[0]
                oid_str = str(vb[0])
                if not oid_str.startswith(root_oid_str.rstrip('.')):
                    break
                results.append({'oid': oid_str, 'value': vb[1].prettyPrint()})
                current_oid = ObjectType(ObjectIdentity(oid_str))

            return {
                'success': True,
                'results': results,
                'count': len(results),
                'limit_reached': len(results) >= limit,
            }

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        out = loop.run_until_complete(_walk())
        loop.close()
        return jsonify(out)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@diagnostic_bp.route('/api/diagnostic/snmp-get', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def snmp_get():
    """GET de un OID. Async interno, wrapped sync (Flask no awaita coroutines)."""
    data = request.json
    ip = data.get('ip')
    port = int(data.get('port', 161))
    community = data.get('community', 'public')
    version = int(data.get('version', 0))
    oid_str = data.get('oid', '')

    if not ip or not oid_str:
        return jsonify({'success': False, 'error': 'IP y OID requeridos'}), 400

    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            get_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity,
        )

        async def _get():
            engine = SnmpEngine()
            auth = CommunityData(community, mpModel=version)
            transport = await UdpTransportTarget.create((ip, port), timeout=3.0, retries=1)
            context = ContextData()
            errInd, errStat, _, varBinds = await get_cmd(
                engine, auth, transport, context,
                ObjectType(ObjectIdentity(oid_str)),
            )
            if errInd:
                return {'success': False, 'error': str(errInd)}
            if errStat:
                return {'success': False, 'error': str(errStat.prettyPrint())}
            results = [{
                'oid':   str(vb[0]),
                'value': vb[1].prettyPrint(),
                'type':  vb[1].__class__.__name__,
            } for vb in varBinds]
            return {'success': True, 'results': results}

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        out = loop.run_until_complete(_get())
        loop.close()
        return jsonify(out)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@diagnostic_bp.route('/api/diagnostic/ping-all-routers', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def ping_all_routers():
    """Ping a todos los routers registrados en la tabla sitios"""
    try:
        from app.base_datos import GestorDB
        db = GestorDB()
        sitios = db.obtener_sitios()

        resultados = []
        param = '-n' if platform.system().lower() == 'windows' else '-c'

        for sitio in sitios:
            ip_zt = sitio.get('router_ip_zt', '')
            ip_lan = sitio.get('router_ip_lan', '')
            nombre = sitio.get('nombre', f"Sitio {sitio.get('numero_sitio', '?')}")

            for label, ip in [('ZeroTier', ip_zt), ('LAN', ip_lan)]:
                if not ip:
                    continue
                try:
                    command = ['ping', param, '1', '-w', '1000', ip]
                    result = subprocess.run(command, capture_output=True, text=True, timeout=3)
                    success = result.returncode == 0
                    resultados.append({
                        'sitio': nombre,
                        'tipo': label,
                        'ip': ip,
                        'online': success,
                        'output': result.stdout[:200] if success else 'timeout'
                    })
                except Exception:
                    resultados.append({
                        'sitio': nombre,
                        'tipo': label,
                        'ip': ip,
                        'online': False,
                        'output': 'error'
                    })

        online = sum(1 for r in resultados if r['online'])
        return jsonify({
            'success': True,
            'resultados': resultados,
            'total': len(resultados),
            'online': online,
            'offline': len(resultados) - online
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@diagnostic_bp.route('/api/diagnostic/snmp-mass-scan', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def snmp_mass_scan():
    """Escaneo SNMP masivo en un rango de IPs buscando dispositivos SNMP"""
    data = request.json
    network = data.get('network', '192.168.0')
    start = int(data.get('start', 1))
    end = int(data.get('end', 254))
    community = data.get('community', 'public')
    port = int(data.get('port', 161))

    if end - start > 254:
        return jsonify({'error': 'Rango máximo: 254 IPs'}), 400

    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            get_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity
        )

        async def scan_ip(ip_addr):
            try:
                engine = SnmpEngine()
                auth = CommunityData(community, mpModel=0)
                transport = await UdpTransportTarget.create(
                    (ip_addr, port), timeout=1.5, retries=0
                )
                context = ContextData()
                oid = ObjectType(ObjectIdentity('1.3.6.1.2.1.1.1.0'))
                errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                    engine, auth, transport, context, oid
                )
                if not errorIndication and not errorStatus and varBinds:
                    return {
                        'ip': ip_addr,
                        'descripcion': varBinds[0][1].prettyPrint(),
                        'snmp': True
                    }
            except Exception:
                pass
            return None

        async def run_scan():
            tareas = []
            for i in range(start, min(end + 1, 255)):
                ip_addr = f'{network}.{i}'
                tareas.append(scan_ip(ip_addr))
            resultados = await asyncio.gather(*tareas)
            return [r for r in resultados if r is not None]

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        dispositivos = loop.run_until_complete(run_scan())
        loop.close()

        return jsonify({
            'success': True,
            'dispositivos': dispositivos,
            'total_escaneados': min(end + 1, 255) - start,
            'total_encontrados': len(dispositivos)
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@diagnostic_bp.route('/api/diagnostic/zerotier-status', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def zerotier_status():
    """Estado de ZeroTier si está disponible"""
    resultado = {'disponible': False, 'info': None, 'networks': None, 'peers': None}

    try:
        info = subprocess.run(
            ['zerotier-cli', 'info'],
            capture_output=True, text=True, timeout=5
        )
        if info.returncode == 0:
            resultado['disponible'] = True
            resultado['info'] = info.stdout.strip()

            nets = subprocess.run(
                ['zerotier-cli', 'listnetworks'],
                capture_output=True, text=True, timeout=5
            )
            if nets.returncode == 0:
                resultado['networks'] = nets.stdout.strip()

            peers = subprocess.run(
                ['zerotier-cli', 'listpeers'],
                capture_output=True, text=True, timeout=5
            )
            if peers.returncode == 0:
                resultado['peers'] = peers.stdout.strip()

        return jsonify({'success': True, **resultado})

    except FileNotFoundError:
        return jsonify({
            'success': True,
            'disponible': False,
            'output': 'zerotier-cli no encontrado en el sistema'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@diagnostic_bp.route('/api/diagnostic/network-health', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def network_health():
    """Scan completo de salud de red: routers + UPS"""
    try:
        from app.base_datos import GestorDB
        db = GestorDB()
        sitios = db.obtener_sitios()
        dispositivos = db.obtener_monitoreo_ups()

        resultados = []
        param = '-n' if platform.system().lower() == 'windows' else '-c'

        for sitio in sitios:
            ip = sitio.get('router_ip_zt', '') or sitio.get('router_ip_lan', '')
            nombre = sitio.get('nombre', f"Sitio {sitio.get('numero_sitio', '?')}")
            if not ip:
                continue
            try:
                start_time = datetime.now()
                cmd = ['ping', param, '1', '-w', '1000', ip]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
                elapsed = (datetime.now() - start_time).total_seconds() * 1000
                resultados.append({
                    'nombre': f"Router {nombre}",
                    'ip': ip,
                    'tipo': 'Router',
                    'ping': result.returncode == 0,
                    'ping_ms': round(elapsed) if result.returncode == 0 else None,
                    'snmp': None,
                    'estado': 'ONLINE' if result.returncode == 0 else 'OFFLINE'
                })
            except Exception:
                resultados.append({
                    'nombre': f"Router {nombre}",
                    'ip': ip,
                    'tipo': 'Router',
                    'ping': False,
                    'ping_ms': None,
                    'snmp': None,
                    'estado': 'OFFLINE'
                })

        for dev in dispositivos:
            ip = dev.get('ip', '')
            nombre = dev.get('nombre', ip)
            if not ip:
                continue
            ping_ok = False
            ping_ms = None
            try:
                start_time = datetime.now()
                cmd = ['ping', param, '1', '-w', '1000', ip]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
                elapsed = (datetime.now() - start_time).total_seconds() * 1000
                ping_ok = result.returncode == 0
                ping_ms = round(elapsed) if ping_ok else None
            except Exception:
                pass

            snmp_ok = None
            if ping_ok and dev.get('protocolo') == 'snmp':
                try:
                    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    sock.settimeout(1)
                    snmp_port = int(dev.get('snmp_port', 161))
                    sock.connect((ip, snmp_port))
                    sock.close()
                    snmp_ok = True
                except Exception:
                    snmp_ok = False

            estado = 'ONLINE' if ping_ok else 'OFFLINE'
            if ping_ok and snmp_ok is False:
                estado = 'DEGRADADO'

            resultados.append({
                'nombre': nombre,
                'ip': ip,
                'tipo': 'UPS',
                'ping': ping_ok,
                'ping_ms': ping_ms,
                'snmp': snmp_ok,
                'estado': estado
            })

        online = sum(1 for r in resultados if r['estado'] == 'ONLINE')
        degradado = sum(1 for r in resultados if r['estado'] == 'DEGRADADO')
        offline = sum(1 for r in resultados if r['estado'] == 'OFFLINE')

        return jsonify({
            'success': True,
            'resultados': resultados,
            'resumen': {
                'total': len(resultados),
                'online': online,
                'degradado': degradado,
                'offline': offline
            }
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
