"""
app/routes — Blueprints del portal LBS Monitor.

    - lbs             → vistas del nuevo diseño (login, dashboard, etc.)
    - inventario      → API JSON de inventario y banco de pruebas SNMP
    - monitoreo       → API JSON de monitoreo + autoset
    - diagnostic      → herramientas de diagnóstico (ping, snmpwalk, etc.)
    - zerotier        → gestión y reconocimiento de la red ZeroTier
"""
from .frontend_routes  import lbs_bp
from .inventario_routes import inventario_bp
from .monitoreo_routes  import monitoreo_bp
from .diagnostic_routes import diagnostic_bp
from .zerotier_routes   import zerotier_bp
from .admin_routes      import admin_bp

__all__ = [
    'lbs_bp',
    'inventario_bp',
    'monitoreo_bp',
    'diagnostic_bp',
    'zerotier_bp',
    'admin_bp',
]
