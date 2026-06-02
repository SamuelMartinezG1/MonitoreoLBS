from flask import Blueprint, render_template, request, jsonify, current_app
from flask_login import login_required
from app.permisos import permiso_requerido
import asyncio
import subprocess
import platform

inventario_bp = Blueprint('inventario', __name__)


# NOTE: la vista de /inventario ahora la sirve `lbs_bp` con el nuevo diseño.
# Los endpoints /api/inventario/* continúan funcionando como JSON.


@inventario_bp.route('/api/inventario/sitios', methods=['GET'])
@login_required
@permiso_requerido('scada')
def list_sitios():
    db = current_app.db
    sitios = db.obtener_sitios()
    return jsonify(sitios)


@inventario_bp.route('/api/inventario/sitios', methods=['POST'])
@login_required
@permiso_requerido('scada')
def add_sitio():
    db = current_app.db
    data = request.json
    if not data or 'nombre' not in data or 'numero_sitio' not in data:
        return jsonify({'error': 'nombre y numero_sitio requeridos'}), 400
    success = db.agregar_sitio(data)
    if success:
        return jsonify({'status': 'ok'})
    return jsonify({'error': 'Error agregando sitio'}), 500


@inventario_bp.route('/api/inventario/sitios/<int:sitio_id>', methods=['PUT'])
@login_required
@permiso_requerido('scada')
def update_sitio(sitio_id):
    db = current_app.db
    data = request.json
    if not data:
        return jsonify({'error': 'Datos requeridos'}), 400
    success = db.actualizar_sitio(sitio_id, data)
    if success:
        return jsonify({'status': 'ok'})
    return jsonify({'error': 'Error actualizando sitio'}), 500


@inventario_bp.route('/api/inventario/sitios/<int:sitio_id>', methods=['DELETE'])
@login_required
@permiso_requerido('scada')
def delete_sitio(sitio_id):
    db = current_app.db
    db.eliminar_sitio(sitio_id)
    return jsonify({'status': 'ok'})


@inventario_bp.route('/api/inventario/dispositivos/<int:dev_id>/sitio', methods=['PUT'])
@login_required
@permiso_requerido('scada')
def assign_device_to_sitio(dev_id):
    db = current_app.db
    data = request.json
    sitio_id = data.get('sitio_id') if data else None
    success = db.asignar_dispositivo_sitio(dev_id, sitio_id)
    if success:
        return jsonify({'status': 'ok'})
    return jsonify({'error': 'Error asignando dispositivo'}), 500


@inventario_bp.route('/api/inventario/dispositivos/<int:dev_id>/notas', methods=['PUT'])
@login_required
@permiso_requerido('scada')
def update_device_notes(dev_id):
    db = current_app.db
    data = request.json
    notas = data.get('notas_tecnicas', '') if data else ''
    success = db.actualizar_notas_dispositivo(dev_id, notas)
    if success:
        return jsonify({'status': 'ok'})
    return jsonify({'error': 'Error actualizando notas'}), 500


@inventario_bp.route('/api/inventario/topologia', methods=['GET'])
@login_required
@permiso_requerido('scada')
def get_topologia():
    """Returns full topology: sites with their devices."""
    db = current_app.db
    sitios = db.obtener_sitios()
    all_devices = db.obtener_monitoreo_ups()

    for sitio in sitios:
        sitio['dispositivos'] = [d for d in all_devices if d.get('sitio_id') == sitio['id']]

    unassigned = [d for d in all_devices if not d.get('sitio_id')]

    return jsonify({
        'sitios': sitios,
        'sin_asignar': unassigned
    })


# =========================================================================
# BANCO DE PRUEBAS — Test & OID Profile endpoints
# =========================================================================

@inventario_bp.route('/api/inventario/test-connection', methods=['POST'])
@login_required
@permiso_requerido('scada')
def test_connection():
    """Prueba ping + SNMP basico a un dispositivo."""
    data = request.json
    ip = data.get('ip', '')
    port = int(data.get('port', 161))
    community = data.get('community', 'public')
    version = int(data.get('version', 1))

    if not ip:
        return jsonify({'error': 'IP requerida'}), 400

    results = {'ip': ip, 'ping': False, 'snmp': False, 'snmp_data': None}

    # 1. Ping
    try:
        param = '-n' if platform.system().lower() == 'windows' else '-c'
        cmd = ['ping', param, '2', '-w', '1000', ip]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        results['ping'] = proc.returncode == 0
    except Exception:
        results['ping'] = False

    # 2. SNMP basic test
    try:
        from app.services.protocols.snmp_client import SNMPClient

        async def _test():
            client = SNMPClient(community=community, port=port)
            return await client.get_ups_data(ip)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        snmp_data = loop.run_until_complete(_test())
        loop.close()

        if snmp_data:
            results['snmp'] = True
            results['snmp_data'] = snmp_data
    except Exception as e:
        results['snmp_error'] = str(e)

    return jsonify(results)


@inventario_bp.route('/api/inventario/snmp-walk', methods=['POST'])
@login_required
@permiso_requerido('scada')
def snmp_walk_inventario():
    """SNMP Walk completo desde inventario (reusa logica de diagnostic)."""
    data = request.json
    ip = data.get('ip')
    port = int(data.get('port', 161))
    community = data.get('community', 'public')
    version = int(data.get('version', 1))
    root_oid = data.get('oid', '1.3.6.1.2.1')

    if not ip:
        return jsonify({'error': 'IP requerida'}), 400

    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            next_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity
        )

        async def _walk():
            results = []
            limit = 100
            engine = SnmpEngine()
            auth = CommunityData(community, mpModel=version)
            transport = await UdpTransportTarget.create((ip, port), timeout=2.0, retries=0)
            context = ContextData()
            current_oid = ObjectType(ObjectIdentity(root_oid))

            for _ in range(limit):
                errorIndication, errorStatus, errorIndex, varBinds = await next_cmd(
                    engine, auth, transport, context, current_oid
                )
                if errorIndication or errorStatus or not varBinds:
                    break

                vb = varBinds[0]
                oid_str = str(vb[0])
                val_str = vb[1].prettyPrint()

                # Stop if we left the subtree
                if not oid_str.startswith(root_oid.rstrip('.')):
                    break

                results.append({'oid': oid_str, 'value': val_str, 'type': vb[1].__class__.__name__})
                current_oid = ObjectType(ObjectIdentity(oid_str))

            return results

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        walk_results = loop.run_until_complete(_walk())
        loop.close()

        return jsonify({'success': True, 'results': walk_results, 'count': len(walk_results)})
    except Exception as e:
        current_app.logger.error("inventario snmp-walk: %s", e)
        return jsonify({'success': False, 'error': 'Error interno del servidor'})


@inventario_bp.route('/api/inventario/oid-test', methods=['POST'])
@login_required
@permiso_requerido('scada')
def oid_test():
    """Prueba un OID especifico y aplica factor de conversion."""
    data = request.json
    ip = data.get('ip')
    port = int(data.get('port', 161))
    community = data.get('community', 'public')
    version = int(data.get('version', 1))
    oid_str = data.get('oid', '')
    factor = float(data.get('factor', 1.0))

    if not ip or not oid_str:
        return jsonify({'error': 'IP y OID requeridos'}), 400

    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            get_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity
        )

        async def _get():
            engine = SnmpEngine()
            auth = CommunityData(community, mpModel=version)
            transport = await UdpTransportTarget.create((ip, port), timeout=3.0, retries=1)
            context = ContextData()

            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                engine, auth, transport, context,
                ObjectType(ObjectIdentity(oid_str))
            )

            if errorIndication:
                return {'error': str(errorIndication)}
            if errorStatus:
                return {'error': str(errorStatus.prettyPrint())}

            vb = varBinds[0]
            raw_value = vb[1].prettyPrint()
            data_type = vb[1].__class__.__name__

            # Try to apply factor
            try:
                numeric_val = float(raw_value)
                converted = numeric_val * factor
            except (ValueError, TypeError):
                converted = raw_value

            return {
                'oid': str(vb[0]),
                'raw_value': raw_value,
                'converted_value': converted,
                'data_type': data_type,
                'factor': factor,
            }

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(_get())
        loop.close()

        if 'error' in result:
            return jsonify({'success': False, 'error': result['error']})
        return jsonify({'success': True, **result})
    except Exception as e:
        current_app.logger.error("inventario endpoint: %s", e)
        return jsonify({'success': False, 'error': 'Error interno del servidor'})


@inventario_bp.route('/api/inventario/save-oid-profile', methods=['POST'])
@login_required
@permiso_requerido('scada')
def save_oid_profile():
    """Guarda el mapeo de OIDs para un dispositivo."""
    db = current_app.db
    data = request.json
    device_id = data.get('device_id')
    mappings = data.get('mappings', [])

    if not device_id:
        return jsonify({'error': 'device_id requerido'}), 400

    success = db.guardar_oid_profile(int(device_id), mappings)
    if success:
        return jsonify({'status': 'ok'})
    return jsonify({'error': 'Error guardando perfil OID'}), 500


@inventario_bp.route('/api/inventario/oid-profile/<int:device_id>', methods=['GET'])
@login_required
@permiso_requerido('scada')
def get_oid_profile(device_id):
    """Obtiene el perfil OID guardado para un dispositivo."""
    db = current_app.db
    profile = db.obtener_oid_profile(device_id)
    return jsonify({'device_id': device_id, 'mappings': profile})
