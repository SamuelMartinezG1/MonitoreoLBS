"""
Punto de entrada del portal LBS Monitor + servicio de monitoreo.

Esta app única (Flask + Socket.IO) sirve:

  - El nuevo frontend (diseño de Claude Design) bajo `/`, `/login`, `/dashboard`,
    `/inventario`, `/diagnostico`, `/monitoreo`.
  - Todos los endpoints JSON heredados de la base PostgreSQL.
  - El MonitoringService (SNMP + Modbus) como hilo daemon que publica
    telemetría por Socket.IO en el namespace `/monitor`.

Uso:
    python run_monitor.py                          # desarrollo
    gunicorn -k eventlet -w 1 run_monitor:app      # producción
"""
import os
import logging

import eventlet
eventlet.monkey_patch()  # antes de importar flask/socketio

from flask import Flask, jsonify

from app.extensions import socketio
from app.services.monitoring_service import MonitoringService
from app.base_datos import GestorDB
from app.auth import login_manager, bootstrap_admin
from app.routes import (
    lbs_bp, inventario_bp, monitoreo_bp, diagnostic_bp, test_snmp_bp,
)

logging.basicConfig(
    level=os.environ.get('LOG_LEVEL', 'INFO'),
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger('lbs-portal')


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=os.path.join(os.path.dirname(__file__), 'app', 'templates'),
        static_folder=os.path.join(os.path.dirname(__file__), 'app', 'static'),
    )
    app.config['SECRET_KEY']              = os.environ.get('SECRET_KEY', 'change-me')
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['REMEMBER_COOKIE_DURATION'] = 60 * 60 * 24 * 7  # 7 días

    # ---------------- Extensiones ---------------- #
    socketio.init_app(app)
    login_manager.init_app(app)

    # ---------------- Base de datos compartida ---------------- #
    app.db = GestorDB()

    # ---------------- Bootstrap admin (idempotente) ---------------- #
    try:
        if bootstrap_admin():
            logger.warning('Usuario admin inicial creado. CÁMBIALE LA CONTRASEÑA.')
    except Exception as e:
        logger.warning('No se pudo verificar bootstrap admin (¿migración 007 aplicada?): %s', e)

    # ---------------- Blueprints ---------------- #
    app.register_blueprint(lbs_bp)
    app.register_blueprint(inventario_bp)
    app.register_blueprint(monitoreo_bp)
    app.register_blueprint(diagnostic_bp)
    app.register_blueprint(test_snmp_bp)

    # ---------------- Endpoints técnicos ---------------- #
    @app.route('/health')
    def health():
        return jsonify({'status': 'ok', 'service': 'lbs-portal'}), 200

    @app.route('/api/info')
    def info():
        return jsonify({
            'service':            'lbs-portal',
            'frontend':           'claude-design v3.2.4',
            'protocols':          ['snmp', 'modbus'],
            'socketio_namespace': '/monitor',
        })

    # ---------------- Monitor SNMP/Modbus ---------------- #
    monitor = MonitoringService(interval=int(os.environ.get('POLL_INTERVAL', 2)))
    monitor.start()
    app.monitor = monitor
    logger.info('MonitoringService lanzado (SNMP + Modbus)')

    return app


app = create_app()


if __name__ == '__main__':
    host  = os.environ.get('APP_HOST', '0.0.0.0')
    port  = int(os.environ.get('APP_PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    logger.info('Listening on http://%s:%s', host, port)
    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)
