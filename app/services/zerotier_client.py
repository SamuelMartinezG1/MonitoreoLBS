"""
zerotier_client — habla con el demonio ZeroTier local vía su API HTTP.

ZeroTier expone una API REST en `http://127.0.0.1:9993/` autenticada con
un token compartido (header `X-ZT1-Auth`). Usar la API es más portable que
ejecutar `zerotier-cli` porque no requiere que el usuario del proceso
pertenezca al grupo `zerotier-one` ni tener `sudo`.

Pre-requisitos en el host Ubuntu:

    1. ZeroTier instalado (`curl -s https://install.zerotier.com | sudo bash`).
    2. El demonio corriendo (`systemctl status zerotier-one`).
    3. El authtoken accesible para el proceso del portal. El contenedor
       Docker espera leerlo en alguno de estos lugares (en orden):

        - $ZEROTIER_AUTHTOKEN (variable de entorno con el token directo)
        - $ZEROTIER_AUTHTOKEN_FILE (path al archivo)
        - /etc/lbs/zerotier-token        (legible por el contenedor)
        - /var/lib/zerotier-one/authtoken.secret  (path estándar de Linux)

Comandos del host para preparar el token (una sola vez):

    sudo install -d -m 0755 /etc/lbs
    sudo install -m 0644 /var/lib/zerotier-one/authtoken.secret /etc/lbs/zerotier-token

Luego en docker-compose se monta `/etc/lbs/zerotier-token:/etc/lbs/zerotier-token:ro`.
"""
import os
import json
import socket
import logging
import subprocess
from typing import Any

import requests

logger = logging.getLogger(__name__)

DEFAULT_BASE = os.environ.get('ZEROTIER_API_URL', 'http://127.0.0.1:9993')
TOKEN_LOCATIONS = [
    '/etc/lbs/zerotier-token',
    '/var/lib/zerotier-one/authtoken.secret',
]


class ZeroTierError(RuntimeError):
    """Error genérico del cliente ZeroTier."""


# --------------------------------------------------------------------------- #
# Token loader
# --------------------------------------------------------------------------- #
def _load_token() -> str:
    """Devuelve el authtoken o lanza ZeroTierError."""
    # 1. Variable directa
    tok = os.environ.get('ZEROTIER_AUTHTOKEN')
    if tok:
        return tok.strip()

    # 2. Archivo apuntado por variable
    path = os.environ.get('ZEROTIER_AUTHTOKEN_FILE')
    if path and os.path.isfile(path):
        try:
            with open(path, 'r') as f:
                return f.read().strip()
        except Exception as e:
            logger.warning("No se pudo leer %s: %s", path, e)

    # 3. Ubicaciones por defecto
    for p in TOKEN_LOCATIONS:
        if os.path.isfile(p):
            try:
                with open(p, 'r') as f:
                    return f.read().strip()
            except PermissionError:
                logger.debug("Sin permiso para leer %s", p)
            except Exception as e:
                logger.debug("Error leyendo %s: %s", p, e)

    raise ZeroTierError(
        'authtoken no encontrado. Coloca el token en /etc/lbs/zerotier-token '
        'o define la variable ZEROTIER_AUTHTOKEN. Ver docs/ZEROTIER.md.'
    )


# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #
def _http(method: str, path: str, body: Any = None, timeout: float = 5.0) -> Any:
    """Hace una request a la API local con el token. Devuelve el JSON parseado."""
    token = _load_token()
    url = DEFAULT_BASE.rstrip('/') + path
    headers = {
        'X-ZT1-Auth': token,
        'Accept': 'application/json',
    }
    try:
        resp = requests.request(method, url, json=body, headers=headers, timeout=timeout)
    except requests.exceptions.ConnectionError as e:
        raise ZeroTierError(
            'No se pudo conectar al demonio ZeroTier en {}. '
            '¿Está instalado y corriendo? (systemctl status zerotier-one)'.format(DEFAULT_BASE)
        ) from e
    except Exception as e:
        raise ZeroTierError(f'Error de comunicación con ZeroTier: {e}') from e

    if resp.status_code == 401:
        raise ZeroTierError('authtoken inválido (401). Regenera el token con `zerotier-cli info`.')
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise ZeroTierError(f'HTTP {resp.status_code}: {resp.text[:200]}')

    if resp.text.strip() == '':
        return {}
    try:
        return resp.json()
    except ValueError:
        return resp.text


# --------------------------------------------------------------------------- #
# API pública
# --------------------------------------------------------------------------- #
def is_available() -> bool:
    """True si podemos hablar con el demonio."""
    try:
        _http('GET', '/status', timeout=2.0)
        return True
    except ZeroTierError:
        return False


def status() -> dict:
    """Info del nodo local: nodeId, address, version, online…"""
    s = _http('GET', '/status') or {}
    return {
        'address':       s.get('address'),
        'public_id':     s.get('publicIdentity', '').split(':')[0] if s.get('publicIdentity') else None,
        'version':       s.get('version'),
        'online':        bool(s.get('online')),
        'planet_id':     s.get('planetWorldId'),
        'tcp_fallback':  s.get('tcpFallbackActive'),
        'world_revision': s.get('worldRevision'),
        'raw':           s,
    }


def list_networks() -> list:
    """Lista las networks a las que está unido este nodo."""
    raw = _http('GET', '/network') or []
    out = []
    for n in raw:
        out.append({
            'id':           n.get('id'),
            'name':         n.get('name') or '(sin nombre)',
            'status':       n.get('status'),
            'type':         n.get('type'),
            'mac':          n.get('mac'),
            'mtu':          n.get('mtu'),
            'broadcast':    n.get('broadcastEnabled'),
            'bridge':       n.get('bridge'),
            'port_device':  n.get('portDeviceName'),
            'assigned_addresses': n.get('assignedAddresses') or [],
            'routes':       n.get('routes') or [],
            'dns':          n.get('dns') or {},
            'allow_managed': n.get('allowManaged'),
            'allow_global':  n.get('allowGlobal'),
            'allow_default': n.get('allowDefault'),
            'allow_dns':     n.get('allowDNS'),
        })
    return out


def get_network(network_id: str) -> dict | None:
    """Detalle de una network."""
    return _http('GET', f'/network/{network_id}')


def join_network(network_id: str) -> dict:
    """Unirse a una network. Devuelve el estado tras el join."""
    network_id = (network_id or '').strip().lower()
    if not network_id or len(network_id) != 16:
        raise ZeroTierError('El network ID debe tener 16 caracteres hex.')
    return _http('POST', f'/network/{network_id}', body={}) or {}


def leave_network(network_id: str) -> bool:
    """Salir de una network."""
    network_id = (network_id or '').strip().lower()
    if not network_id or len(network_id) != 16:
        raise ZeroTierError('El network ID debe tener 16 caracteres hex.')
    _http('DELETE', f'/network/{network_id}')
    return True


def list_peers(only_authenticated: bool = True) -> list:
    """Peers del nodo local (routers/clientes alcanzables)."""
    raw = _http('GET', '/peer') or []
    out = []
    for p in raw:
        paths = p.get('paths') or []
        active = next((x for x in paths if x.get('active')), paths[0] if paths else {})
        out.append({
            'address':   p.get('address'),
            'role':      p.get('role'),
            'version':   '{}.{}.{}'.format(p.get('versionMajor', 0), p.get('versionMinor', 0), p.get('versionRev', 0)),
            'latency':   p.get('latency'),
            'paths_n':   len(paths),
            'active_addr': active.get('address'),
            'last_recv': active.get('lastReceive'),
        })
    return out


def network_subnets(network_id: str) -> list[str]:
    """Devuelve las subredes asignadas + ruteadas por la network."""
    nw = get_network(network_id) or {}
    subnets = set()
    for r in nw.get('routes') or []:
        if r.get('target'):
            subnets.add(r['target'])
    for ip in nw.get('assignedAddresses') or []:
        # ip viene como '10.216.124.126/24' — extraemos el /24
        if '/' in ip:
            try:
                base, prefix = ip.split('/')
                octets = base.split('.')
                if len(octets) == 4 and prefix == '24':
                    subnets.add(f"{octets[0]}.{octets[1]}.{octets[2]}.0/24")
            except Exception:
                pass
    return sorted(subnets)


# --------------------------------------------------------------------------- #
# Helpers extra: detectar Teltonika por SNMP en la red ZeroTier
# --------------------------------------------------------------------------- #
TELTONIKA_OIDS = [
    '1.3.6.1.2.1.1.1.0',          # sysDescr
    '1.3.6.1.2.1.1.5.0',          # sysName
]


def detect_teltonika_sysdescr(text: str) -> bool:
    """Heurística para detectar un Teltonika a partir de su sysDescr."""
    if not text:
        return False
    s = text.lower()
    return any(k in s for k in ('teltonika', 'rutos', 'rut955', 'rut956', 'rut951', 'trb14', 'rut2', 'rut3'))


def _ping_alive(ip: str, timeout: float = 1.0) -> bool:
    """Verifica alcance con un ping de un paquete."""
    try:
        r = subprocess.run(
            ['ping', '-c', '1', '-W', str(int(max(1, timeout))), ip],
            capture_output=True, timeout=timeout + 1,
        )
        return r.returncode == 0
    except Exception:
        return False
