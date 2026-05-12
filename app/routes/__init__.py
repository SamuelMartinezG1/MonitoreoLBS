"""
app/routes — Blueprints del portal LBS Monitor.

Tras la migración a PostgreSQL + nuevo diseño de Claude Design, los únicos
blueprints reales son:

    - lbs             → vistas del nuevo diseño (login, dashboard, etc.)
    - inventario      → API JSON de inventario y banco de pruebas SNMP
    - monitoreo       → API JSON de monitoreo + autoset
    - diagnostic      → herramientas de diagnóstico (ping, snmpwalk, etc.)
    - test_snmp       → vista legacy del banco de pruebas (a migrar)

Los antiguos imports a `dashboard`, `calculator`, `api`, `management`,
`documents`, `guia_rapida` fueron eliminados — esos módulos no existen en
este servicio (vivían en el monolito original).
"""
from .frontend_routes  import lbs_bp
from .inventario_routes import inventario_bp
from .monitoreo_routes  import monitoreo_bp
from .diagnostic_routes import diagnostic_bp
from .test_snmp_routes  import test_snmp_bp

__all__ = [
    'lbs_bp',
    'inventario_bp',
    'monitoreo_bp',
    'diagnostic_bp',
    'test_snmp_bp',
]
