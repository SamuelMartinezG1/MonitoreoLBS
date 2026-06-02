"""
Tests de humo mínimos (Q1 de la auditoría).

No requieren BD ni red: validan funciones puras y defaults de configuración.
Ejecutar con:  pip install -r requirements-dev.txt && pytest -q
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


def test_config_defaults():
    from app import config
    assert config.HISTORY_RETENTION_DAYS == 7
    assert config.DB_POOL_MAX >= 50
    assert config.DEFAULT_SNMP_PORT == 161
    assert config.DEFAULT_MODBUS_PORT == 502
    assert config.MAX_RECORDING_ROWS > 0


def test_valid_host():
    from app.routes.diagnostic_routes import _valid_host
    assert _valid_host('192.168.1.10') == '192.168.1.10'
    assert _valid_host('ups-1.local') == 'ups-1.local'
    assert _valid_host('') is None
    assert _valid_host('-rf /tmp') is None          # rechaza flags
    assert _valid_host('a; rm -rf /') is None        # rechaza inyección


def test_valid_port():
    from app.routes.diagnostic_routes import _valid_port
    assert _valid_port(161) == 161
    assert _valid_port(0) is None
    assert _valid_port(70000) is None
    assert _valid_port('abc', default=502) == 502


def test_valid_oid():
    from app.routes.diagnostic_routes import _valid_oid
    assert _valid_oid('1.3.6.1.2.1') == '1.3.6.1.2.1'
    assert _valid_oid('.1.3.6.1') == '.1.3.6.1'
    assert _valid_oid('1.3.x.1') is None
    assert _valid_oid('') is None


def test_valid_slave_id():
    from app.routes.diagnostic_routes import _valid_slave_id
    assert _valid_slave_id(1) == 1
    assert _valid_slave_id(247) == 247
    assert _valid_slave_id(999) == 1   # fuera de rango -> default
