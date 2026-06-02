"""
Extensiones compartidas del servicio de monitoreo.

Solo se conserva Socket.IO porque el servicio publica telemetría
en tiempo real al frontend (o a un broker) sin depender del resto
de la app Flask original.
"""
import os

from flask_socketio import SocketIO

# Orígenes permitidos para Socket.IO. Por defecto "*" (desarrollo).
# En producción definir SOCKETIO_CORS_ORIGINS con el/los dominios reales,
# separados por coma. Ej: SOCKETIO_CORS_ORIGINS=https://monitoreo.midominio.com
_cors_env = os.environ.get('SOCKETIO_CORS_ORIGINS', '*').strip()
_cors_origins = (
    '*' if _cors_env in ('', '*')
    else [o.strip() for o in _cors_env.split(',') if o.strip()]
)

# async_mode='eventlet' para compatibilidad con gunicorn -k eventlet
socketio = SocketIO(cors_allowed_origins=_cors_origins, async_mode='eventlet')
