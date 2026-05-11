"""
Servicio mDNS (Bonjour/Zeroconf) para anunciar la app como lbs.local en la red local.

Permite que cualquier dispositivo moderno (Windows 10+, iOS, macOS, Android)
acceda al servidor escribiendo http://lbs.local:5000 sin configurar nada.
"""

import atexit
import logging
import os
import socket
import threading

logger = logging.getLogger(__name__)


def _detectar_ip_local():
    """Detecta la IP local de la maquina en la red (sin enviar datos)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        # Conectar a una IP externa solo para que el OS elija la interfaz correcta
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        logger.warning("No se pudo detectar IP local, usando 127.0.0.1")
        return '127.0.0.1'


class ServicioMDNS(threading.Thread):
    """
    Hilo daemon que registra un servicio mDNS para que los dispositivos
    en la red local puedan resolver lbs.local -> IP del servidor.
    """

    def __init__(self, domain='lbs.local', port=5000, service_name='UPS Manager LBS'):
        super().__init__()
        self.daemon = True
        self.domain = domain
        self.port = port
        self.service_name = service_name
        self._zeroconf = None
        self._service_info = None

    def run(self):
        try:
            from zeroconf import Zeroconf, ServiceInfo
        except ImportError:
            logger.warning(
                "Paquete 'zeroconf' no instalado. "
                "Ejecute: pip install zeroconf>=0.132.0  "
                "La app funciona normal, pero sin descubrimiento mDNS."
            )
            return

        ip_local = _detectar_ip_local()
        ip_bytes = socket.inet_aton(ip_local)

        # El server debe terminar en punto para ser un FQDN valido en mDNS
        server_fqdn = self.domain if self.domain.endswith('.') else f"{self.domain}."

        self._service_info = ServiceInfo(
            type_="_http._tcp.local.",
            name=f"{self.service_name}._http._tcp.local.",
            addresses=[ip_bytes],
            port=self.port,
            server=server_fqdn,
            properties={
                'path': '/',
                'version': '1.0',
            },
        )

        try:
            self._zeroconf = Zeroconf()
            self._zeroconf.register_service(self._service_info)
            logger.info(
                "mDNS activo: %s -> %s (puerto %d)",
                self.domain, ip_local, self.port
            )
            # Registrar limpieza automatica al cerrar la app
            atexit.register(self.detener)
        except Exception as e:
            logger.error("Error registrando servicio mDNS: %s", e)

    def detener(self):
        """Des-registra el servicio mDNS y cierra Zeroconf."""
        if self._zeroconf and self._service_info:
            try:
                self._zeroconf.unregister_service(self._service_info)
                self._zeroconf.close()
                logger.info("Servicio mDNS detenido")
            except Exception as e:
                logger.debug("Error cerrando mDNS: %s", e)
            finally:
                self._zeroconf = None
                self._service_info = None
