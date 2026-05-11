"""
Extensiones compartidas del servicio de monitoreo.

Solo se conserva Socket.IO porque el servicio publica telemetría
en tiempo real al frontend (o a un broker) sin depender del resto
de la app Flask original.
"""
from flask_socketio import SocketIO

# async_mode='eventlet' para compatibilidad con gunicorn -k eventlet
socketio = SocketIO(cors_allowed_origins="*", async_mode='eventlet')
