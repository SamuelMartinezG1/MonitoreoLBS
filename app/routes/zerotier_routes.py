"""
zerotier_routes — endpoints para gestionar ZeroTier desde el portal.

Todos los endpoints requieren login + permiso 'herramientas'. Operan vía
`app/services/zerotier_client.py` (API HTTP local del demonio).

Endpoints:

    GET  /api/zerotier/health           → ¿está disponible el demonio?
    GET  /api/zerotier/status           → info del nodo local
    GET  /api/zerotier/networks         → networks a las que está unido
    POST /api/zerotier/join             → unirse: {network_id}
    POST /api/zerotier/leave            → salir:  {network_id}
    GET  /api/zerotier/peers            → peers conocidos
    POST /api/zerotier/scan-network     → escanear subred ZT: {network_id, snmp_community?}
    POST /api/zerotier/discover-teltonika → detectar routers Teltonika en ZT: {network_id, community?}
    POST /api/zerotier/scan-site-lan    → escanear LAN del sitio: {sitio_id, community?}
"""
import asyncio
import ipaddress
import logging

from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required

from app.permisos import permiso_requerido
from app.services import zerotier_client as zt
from app.services.zerotier_client import ZeroTierError

logger = logging.getLogger(__name__)

zerotier_bp = Blueprint('zerotier', __name__)


def _zterror(e: Exception, status: int = 500):
    # ZeroTierError trae mensajes de dominio seguros para el usuario;
    # cualquier otra excepción se loguea y se devuelve genérica para no
    # filtrar internals (S4 de la auditoría).
    logger.error("ZeroTier error: %s", e)
    msg = str(e) if isinstance(e, ZeroTierError) else 'Error interno del servidor'
    return jsonify({'success': False, 'error': msg}), status


# --------------------------------------------------------------------------- #
# Estado del demonio                                                          #
# --------------------------------------------------------------------------- #
@zerotier_bp.route('/api/zerotier/health', methods=['GET'])
@login_required
@permiso_requerido('herramientas')
def zt_health():
    return jsonify({
        'available': zt.is_available(),
        'api_url':   zt.DEFAULT_BASE,
    })


@zerotier_bp.route('/api/zerotier/status', methods=['GET'])
@login_required
@permiso_requerido('herramientas')
def zt_status():
    try:
        return jsonify({'success': True, 'status': zt.status()})
    except ZeroTierError as e:
        return _zterror(e)


# --------------------------------------------------------------------------- #
# Networks                                                                    #
# --------------------------------------------------------------------------- #
@zerotier_bp.route('/api/zerotier/networks', methods=['GET'])
@login_required
@permiso_requerido('herramientas')
def zt_networks():
    try:
        return jsonify({'success': True, 'networks': zt.list_networks()})
    except ZeroTierError as e:
        return _zterror(e)


@zerotier_bp.route('/api/zerotier/join', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def zt_join():
    data = request.json or {}
    nid = data.get('network_id', '')
    try:
        result = zt.join_network(nid)
        return jsonify({'success': True, 'network': result})
    except ZeroTierError as e:
        return _zterror(e, 400)


@zerotier_bp.route('/api/zerotier/leave', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def zt_leave():
    data = request.json or {}
    nid = data.get('network_id', '')
    try:
        zt.leave_network(nid)
        return jsonify({'success': True})
    except ZeroTierError as e:
        return _zterror(e, 400)


@zerotier_bp.route('/api/zerotier/peers', methods=['GET'])
@login_required
@permiso_requerido('herramientas')
def zt_peers():
    try:
        return jsonify({'success': True, 'peers': zt.list_peers()})
    except ZeroTierError as e:
        return _zterror(e)


# --------------------------------------------------------------------------- #
# Escaneo de subred ZeroTier                                                  #
# --------------------------------------------------------------------------- #
async def _snmp_sysdescr(ip: str, community: str = 'public', timeout: float = 1.5):
    """Hace SNMP get a sysDescr para identificar el dispositivo. Devuelve str o None."""
    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            get_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity,
        )
        engine = SnmpEngine()
        auth = CommunityData(community, mpModel=1)
        transport = await UdpTransportTarget.create((ip, 161), timeout=timeout, retries=0)
        ctx = ContextData()
        errInd, errStat, _, varBinds = await get_cmd(
            engine, auth, transport, ctx,
            ObjectType(ObjectIdentity('1.3.6.1.2.1.1.1.0')),
        )
        if errInd or errStat or not varBinds:
            return None
        return varBinds[0][1].prettyPrint()
    except Exception:
        return None


async def _scan_subnet(cidr: str, community: str, max_hosts: int = 254) -> list:
    """Escanea una /24 (o lo que indique CIDR). Devuelve hosts con info."""
    try:
        net = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        return []

    hosts = [str(h) for h in net.hosts()][:max_hosts]

    async def _probe(ip):
        alive = zt._ping_alive(ip, timeout=1)
        if not alive:
            return None
        descr = await _snmp_sysdescr(ip, community=community)
        is_teltonika = zt.detect_teltonika_sysdescr(descr or '')
        return {
            'ip': ip,
            'alive': True,
            'sysdescr': descr,
            'is_teltonika': is_teltonika,
        }

    results = await asyncio.gather(*[_probe(ip) for ip in hosts])
    return [r for r in results if r is not None]


@zerotier_bp.route('/api/zerotier/scan-network', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def zt_scan_network():
    """Escanea una subred ZeroTier completa: ping + SNMP get para identificar."""
    data = request.json or {}
    nid = (data.get('network_id') or '').strip().lower()
    community = data.get('community', 'public')

    if not nid or len(nid) != 16:
        return jsonify({'success': False, 'error': 'network_id inválido'}), 400

    try:
        subnets = zt.network_subnets(nid)
    except ZeroTierError as e:
        return _zterror(e)

    if not subnets:
        return jsonify({
            'success': False,
            'error': 'La network no tiene subredes asignadas. ¿Estás unido?',
        }), 400

    all_hosts = []
    try:
        loop = asyncio.new_event_loop()
        for subnet in subnets:
            try:
                hosts = loop.run_until_complete(_scan_subnet(subnet, community))
                for h in hosts:
                    h['subnet'] = subnet
                all_hosts.extend(hosts)
            except Exception as e:
                logger.warning("Error escaneando %s: %s", subnet, e)
        loop.close()
    except Exception as e:
        return _zterror(e)

    return jsonify({
        'success': True,
        'network_id': nid,
        'subnets':    subnets,
        'hosts':      all_hosts,
        'teltonikas': [h for h in all_hosts if h.get('is_teltonika')],
        'total':      len(all_hosts),
    })


@zerotier_bp.route('/api/zerotier/discover-teltonika', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def zt_discover_teltonika():
    """Detecta routers Teltonika dentro de la subred ZeroTier especificada."""
    data = request.json or {}
    nid = (data.get('network_id') or '').strip().lower()
    community = data.get('community', 'public')

    if not nid or len(nid) != 16:
        return jsonify({'success': False, 'error': 'network_id inválido'}), 400

    try:
        subnets = zt.network_subnets(nid)
    except ZeroTierError as e:
        return _zterror(e)

    teltonikas = []
    try:
        loop = asyncio.new_event_loop()
        for subnet in subnets:
            try:
                hosts = loop.run_until_complete(_scan_subnet(subnet, community))
                for h in hosts:
                    if h.get('is_teltonika'):
                        h['subnet'] = subnet
                        teltonikas.append(h)
            except Exception as e:
                logger.warning("Error en %s: %s", subnet, e)
        loop.close()
    except Exception as e:
        return _zterror(e)

    return jsonify({
        'success':    True,
        'network_id': nid,
        'subnets':    subnets,
        'teltonikas': teltonikas,
        'count':      len(teltonikas),
    })


# --------------------------------------------------------------------------- #
# Escanear la LAN detrás de un Teltonika (via el sitio en BD)                #
# --------------------------------------------------------------------------- #
@zerotier_bp.route('/api/zerotier/bootstrap-site', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def zt_bootstrap_site():
    """Wizard: dado un network_id + datos del sitio, hace la secuencia completa:

      1. Une el host a la network (idempotente).
      2. Crea el sitio en BD si no existe (por numero_sitio).
      3. Detecta Teltonika en la red ZT.
      4. Escanea la LAN del sitio (subred_lan).
      5. Devuelve UPS candidatos para importar.

    Body:
        {
            network_id, numero_sitio, nombre,
            subred_lan, router_ip_lan?, router_ip_zt?, notas?,
            community?
        }
    """
    data = request.json or {}
    nid = (data.get('network_id') or '').strip().lower()
    numero_sitio = data.get('numero_sitio')
    nombre = (data.get('nombre') or '').strip()
    subred_lan = (data.get('subred_lan') or '').strip()
    community = data.get('community', 'public')

    if not nid or len(nid) != 16:
        return jsonify({'success': False, 'error': 'network_id inválido (16 hex)'}), 400
    if not numero_sitio or not nombre:
        return jsonify({'success': False, 'error': 'numero_sitio y nombre son requeridos'}), 400
    if not subred_lan or '/' not in subred_lan:
        return jsonify({'success': False, 'error': 'subred_lan inválida (formato 192.168.X.0/24)'}), 400

    steps = []

    # 1. Join (idempotente: si ya está unido, la API devuelve OK)
    try:
        zt.join_network(nid)
        steps.append({'step': 'join', 'ok': True, 'msg': f'Unido a network {nid}'})
    except ZeroTierError as e:
        steps.append({'step': 'join', 'ok': False, 'msg': str(e)})
        return jsonify({'success': False, 'steps': steps}), 400

    # 2. Crear sitio si no existe
    db = current_app.db
    sitios = db.obtener_sitios()
    sitio = next((s for s in sitios if s.get('numero_sitio') == int(numero_sitio)), None)
    if not sitio:
        ok = db.agregar_sitio({
            'numero_sitio':  int(numero_sitio),
            'nombre':        nombre,
            'subred_lan':    subred_lan,
            'router_ip_lan': data.get('router_ip_lan'),
            'router_ip_zt':  data.get('router_ip_zt'),
            'notas':         data.get('notas'),
        })
        if not ok:
            steps.append({'step': 'create-site', 'ok': False, 'msg': 'No se pudo crear el sitio'})
            return jsonify({'success': False, 'steps': steps}), 500
        sitios = db.obtener_sitios()
        sitio = next((s for s in sitios if s.get('numero_sitio') == int(numero_sitio)), None)
        steps.append({'step': 'create-site', 'ok': True, 'msg': f'Sitio creado: {nombre} (#{numero_sitio})'})
    else:
        steps.append({'step': 'create-site', 'ok': True, 'msg': 'Sitio ya existía, reutilizando'})

    # 3. Detectar Teltonika
    teltonikas = []
    try:
        loop = asyncio.new_event_loop()
        for subnet in zt.network_subnets(nid):
            try:
                hosts = loop.run_until_complete(_scan_subnet(subnet, community))
                for h in hosts:
                    if h.get('is_teltonika'):
                        h['subnet'] = subnet
                        teltonikas.append(h)
            except Exception as e:
                logger.warning("scan subnet %s: %s", subnet, e)
        loop.close()
        steps.append({
            'step': 'detect-teltonika', 'ok': len(teltonikas) > 0,
            'msg': f'{len(teltonikas)} Teltonika(s) detectado(s)' if teltonikas else 'Sin Teltonika detectado',
        })
    except Exception as e:
        steps.append({'step': 'detect-teltonika', 'ok': False, 'msg': str(e)})

    # 4. Escanear LAN
    hosts = []
    try:
        loop = asyncio.new_event_loop()
        hosts = loop.run_until_complete(_scan_subnet(subred_lan, community))
        loop.close()

        # Marcar registrados
        devices = db.obtener_monitoreo_ups()
        reg = {d['ip']: d for d in devices}
        for h in hosts:
            if h['ip'] in reg:
                h['registered'] = True
                h['device_id']  = reg[h['ip']]['id']
                h['device_name'] = reg[h['ip']]['nombre']
            else:
                h['registered'] = False

        steps.append({
            'step': 'scan-lan', 'ok': True,
            'msg': f'{len(hosts)} dispositivo(s) en la LAN del sitio',
        })
    except Exception as e:
        steps.append({'step': 'scan-lan', 'ok': False, 'msg': str(e)})

    candidates = [h for h in hosts if not h.get('registered')]

    return jsonify({
        'success':    True,
        'steps':      steps,
        'sitio':      sitio,
        'teltonikas': teltonikas,
        'hosts':      hosts,
        'candidates': candidates,
    })


@zerotier_bp.route('/api/zerotier/scan-site-lan', methods=['POST'])
@login_required
@permiso_requerido('herramientas')
def zt_scan_site_lan():
    """Escanea la subred LAN de un sitio (la cual está detrás del Teltonika).

    Body: {sitio_id, community?, snmp_version?}
    """
    data = request.json or {}
    sitio_id = data.get('sitio_id')
    community = data.get('community', 'public')

    if not sitio_id:
        return jsonify({'success': False, 'error': 'sitio_id requerido'}), 400

    db = current_app.db
    sitios = db.obtener_sitios()
    sitio = next((s for s in sitios if s['id'] == int(sitio_id)), None)
    if not sitio:
        return jsonify({'success': False, 'error': 'Sitio no encontrado'}), 404

    subred = sitio.get('subred_lan') or sitio.get('subred')
    if not subred:
        return jsonify({
            'success': False,
            'error': f"El sitio '{sitio.get('nombre')}' no tiene subred_lan configurada",
        }), 400

    # Escanear
    try:
        loop = asyncio.new_event_loop()
        hosts = loop.run_until_complete(_scan_subnet(subred, community))
        loop.close()
    except Exception as e:
        return _zterror(e)

    # Marcar cuáles ya están registrados en monitoreo_config
    devices = db.obtener_monitoreo_ups()
    registered_ips = {d['ip']: d for d in devices}
    for h in hosts:
        if h['ip'] in registered_ips:
            h['registered'] = True
            h['device_id']  = registered_ips[h['ip']]['id']
            h['device_name'] = registered_ips[h['ip']]['nombre']
        else:
            h['registered'] = False

    return jsonify({
        'success': True,
        'sitio':   {'id': sitio['id'], 'nombre': sitio['nombre'], 'numero_sitio': sitio.get('numero_sitio')},
        'subnet':  subred,
        'hosts':   hosts,
        'count':   len(hosts),
        'unregistered': [h for h in hosts if not h.get('registered')],
    })
