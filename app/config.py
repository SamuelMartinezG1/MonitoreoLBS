"""
Configuración centralizada — fuente única de defaults.

Objetivo (Q5 de la auditoría): eliminar "números mágicos" dispersos. Las
variables siguen leyéndose de entorno, pero aquí queda documentado el nombre,
el default y el significado de cada una. El código nuevo debe importar desde
aquí; la migración de los call-sites antiguos es deuda técnica gradual para no
introducir regresiones sin pruebas.
"""
import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# --- Polling / muestreo (segundos) --- #
POLL_INTERVAL            = _int('POLL_INTERVAL', 2)
METRICS_SAMPLE_INTERVAL_S = _int('METRICS_SAMPLE_INTERVAL_S', 60)
HISTORY_SAMPLE_INTERVAL_S = _int('HISTORY_SAMPLE_INTERVAL_S', 60)
SNMP_CLIENT_TTL_S        = _int('SNMP_CLIENT_TTL_S', 300)

# --- Retención (días) --- #
HISTORY_RETENTION_DAYS   = _int('HISTORY_RETENTION_DAYS', 7)
METRICS_RETENTION_DAYS   = _int('METRICS_RETENTION_DAYS', 90)

# --- Pools de BD --- #
DB_POOL_MIN              = _int('DB_POOL_MIN', 4)
DB_POOL_MAX              = _int('DB_POOL_MAX', 50)
METRICS_POOL_MAX         = _int('METRICS_POOL_MAX', 10)

# --- Mantenimiento --- #
CLEANUP_INTERVAL_MIN     = _int('CLEANUP_INTERVAL_MIN', 60)
TELEMETRY_RETENTION_MIN  = _int('TELEMETRY_RETENTION_MIN', 10)

# --- Puertos por defecto de protocolos --- #
DEFAULT_SNMP_PORT        = 161
DEFAULT_MODBUS_PORT      = 502

# --- Límites de consulta (defensa de memoria) --- #
MAX_RECORDING_ROWS       = _int('MAX_RECORDING_ROWS', 50000)
MAX_HISTORY_ROWS         = 25000
MAX_TELEMETRY_ROWS       = 20000
