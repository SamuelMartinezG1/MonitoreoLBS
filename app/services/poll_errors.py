# -*- coding: utf-8 -*-
"""
Taxonomía de fallas de polling (SNMP / Modbus).

Antes una falla de lectura terminaba en un `status='offline'` genérico y la
causa real (timeout, sin ruta, puerto cerrado…) se quedaba en el log de
pymodbus/pysnmp. Estos códigos viajan en `PollFailure` desde los clientes
hasta el ConnectionTracker, que los persiste en `ups_event_log` y los expone
al frontend como `offline_reason` / `offline_reason_label`.
"""
import errno
import socket

TIMEOUT          = 'TIMEOUT'
HOST_UNREACHABLE = 'HOST_UNREACHABLE'
NET_UNREACHABLE  = 'NET_UNREACHABLE'
CONN_REFUSED     = 'CONN_REFUSED'
PROTOCOL_ERROR   = 'PROTOCOL_ERROR'
DNS_ERROR        = 'DNS_ERROR'
NO_DATA          = 'NO_DATA'
UNKNOWN          = 'UNKNOWN'

# Nota: en SNMP (UDP) una community equivocada NO devuelve error: el agente
# simplemente no responde y se manifiesta como TIMEOUT. De ahí el matiz del label.
REASON_LABELS = {
    TIMEOUT:          'Sin respuesta (timeout) — enlace lento, equipo apagado o community SNMP incorrecta',
    HOST_UNREACHABLE: 'Host inalcanzable — enlace al sitio caído (SIM/ruta)',
    NET_UNREACHABLE:  'Red inalcanzable — sin ruta (ZeroTier caído)',
    CONN_REFUSED:     'Conexión rechazada — el equipo responde pero el puerto/servicio está cerrado',
    PROTOCOL_ERROR:   'Error de protocolo — el equipo responde pero los datos son inválidos',
    DNS_ERROR:        'No se pudo resolver el nombre del equipo',
    NO_DATA:          'El equipo respondió sin ningún valor válido',
    UNKNOWN:          'Error desconocido',
}


def reason_label(code: str) -> str:
    return REASON_LABELS.get(code, REASON_LABELS[UNKNOWN])


class PollFailure(Exception):
    """Falla de lectura con causa clasificada. `detail` es el error crudo."""

    def __init__(self, code: str, detail: str = ''):
        self.code = code if code in REASON_LABELS else UNKNOWN
        self.detail = detail
        super().__init__(f'{self.code}: {detail}')

    @property
    def label(self) -> str:
        return reason_label(self.code)


_ERRNO_MAP = {
    errno.EHOSTUNREACH: HOST_UNREACHABLE,  # 113
    errno.ENETUNREACH:  NET_UNREACHABLE,   # 101
    errno.ECONNREFUSED: CONN_REFUSED,      # 111
    errno.ETIMEDOUT:    TIMEOUT,           # 110
    errno.EHOSTDOWN:    HOST_UNREACHABLE,  # 112
}


def classify_oserror(e: OSError) -> str:
    if isinstance(e, socket.gaierror):
        return DNS_ERROR
    if isinstance(e, (TimeoutError, socket.timeout)):
        return TIMEOUT
    code = _ERRNO_MAP.get(e.errno)
    if code:
        return code
    # ConnectionRefusedError puede llegar sin errno en algunos paths
    if isinstance(e, ConnectionRefusedError):
        return CONN_REFUSED
    return UNKNOWN


def classify_exception(e: Exception) -> tuple:
    """(code, detail) para cualquier excepción de un poll."""
    if isinstance(e, PollFailure):
        return e.code, e.detail
    if isinstance(e, OSError):  # incluye TimeoutError y socket.gaierror
        return classify_oserror(e), str(e)
    # pysnmp suele empaquetar el timeout en errorIndication (no excepción),
    # pero algunos transportes lo lanzan como texto.
    text = str(e).lower()
    if 'timed out' in text or 'timeout' in text:
        return TIMEOUT, str(e)
    return UNKNOWN, str(e)
