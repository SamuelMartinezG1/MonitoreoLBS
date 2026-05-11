"""
Punto de entrada del servicio de monitoreo UPS extraído.

Crea una mini-app Flask + Socket.IO (solo para emitir telemetría)
y lanza el MonitoringService como hilo daemon.

Uso:
    python run_monitor.py                # desarrollo
    gunicorn -k eventlet -w 1 run_monitor:app   # producción
"""
import os
import logging
import eventlet
eventlet.monkey_patch()  # debe ir antes de importar flask/socketio

from flask import Flask, jsonify
from app.extensions import socketio
from app.services.monitoring_service import MonitoringService

logging.basicConfig(
    level=os.environ.get('LOG_LEVEL', 'INFO'),
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger('ups-monitor')


def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'change-me')
    socketio.init_app(app)

    # ---------------- Endpoints de salud / info ---------------- #
    @app.route('/health')
    def health():
        return jsonify({'status': 'ok', 'service': 'ups-monitoring'}), 200

    @app.route('/')
    def root():
        return jsonify({
            'service': 'ups-monitoring',
            'protocols': ['snmp', 'modbus'],
            'health': '/health',
            'socketio_namespace': '/monitor',
        })

    # ---------------- Lanzar el monitor ---------------- #
    monitor = MonitoringService(interval=int(os.environ.get('POLL_INTERVAL', 2)))
    monitor.start()
    app.monitor = monitor
    logger.info('MonitoringService lanzado (SNMP + Modbus)')
    return app


app = create_app()


if __name__ == '__main__':
    host = os.environ.get('APP_HOST', '0.0.0.0')
    port = int(os.environ.get('APP_PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    logger.info('Listening on http://%s:%s', host, port)
    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)
