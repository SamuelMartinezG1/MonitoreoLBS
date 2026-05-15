"""
Punto de entrada del portal LBS Monitor + servicio de monitoreo.

Esta app única (Flask + Socket.IO) sirve:

  - El nuevo frontend bajo `/`, `/login`, `/dashboard`, `/inventario`,
    `/diagnostico`, `/monitoreo`.
  - Todos los endpoints JSON.
  - El MonitoringService (SNMP) y ModbusMonitor (Modbus TCP) como hilos
    daemon que publican telemetría por Socket.IO en `/monitor`.

Uso:
    python run_monitor.py                          # desarrollo
    gunicorn -k eventlet -w 1 run_monitor:app      # producción
"""
import os
import logging

import eventlet
# NO patcheamos `thread` para que MonitoringService corra en hilo OS real:
# pysnmp.asyncio + eventlet greenlets se pelean por el loop. socket/time/
# select sí se patchean (Socket.IO los necesita).
eventlet.monkey_patch(thread=False)

from flask import Flask, jsonify

from app.extensions import socketio
from app.services.monitoring_service import MonitoringService
from app.base_datos import GestorDB
from app.auth import login_manager, bootstrap_admin
from app.routes import (
    lbs_bp, inventario_bp, monitoreo_bp, diagnostic_bp, zerotier_bp, admin_bp,
)
from migrations.runner import run_migrations

logging.basicConfig(
    level=os.environ.get('LOG_LEVEL', 'INFO'),
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger('lbs-portal')


# --------------------------------------------------------------------------- #
# Cleanup scheduler (APScheduler — corre fuera del loop de polling)            #
# --------------------------------------------------------------------------- #
def _start_cleanup_scheduler(db: GestorDB):
    """Programa el barrido de telemetría / historial / métricas cada hora."""
    from apscheduler.schedulers.background import BackgroundScheduler
    from app.services.pg_metrics import influx_service

    history_days = int(os.environ.get('HISTORY_RETENTION_DAYS', 30))

    def _job():
        try:
            db.limpiar_telemetria_antigua(minutos=10)
            db.limpiar_historial_antiguo(dias=history_days)
            influx_service.cleanup_old()
        except Exception as e:
            logger.warning('cleanup job: %s', e)

    sched = BackgroundScheduler(daemon=True, timezone='UTC')
    sched.add_job(_job, 'interval', minutes=60, id='lbs_cleanup',
                  next_run_time=None, replace_existing=True)
    sched.start()
    logger.info('Cleanup scheduler arrancado (cada 60 min)')
    return sched


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=os.path.join(os.path.dirname(__file__), 'app', 'templates'),
        static_folder=os.path.join(os.path.dirname(__file__), 'app', 'static'),
    )
    app.config['SECRET_KEY']               = os.environ.get('SECRET_KEY', 'change-me')
    app.config['SESSION_COOKIE_HTTPONLY']  = True
    app.config['SESSION_COOKIE_SAMESITE']  = 'Lax'
    app.config['REMEMBER_COOKIE_DURATION'] = 60 * 60 * 24 * 7  # 7 días

    # ---------------- Extensiones ---------------- #
    socketio.init_app(app)
    login_manager.init_app(app)

    # ---------------- Base de datos compartida ---------------- #
    app.db = GestorDB()

    # ---------------- Migraciones idempotentes ---------------- #
    # Aplica todas las migraciones nuevas en cada arranque. Cada SQL corre
    # en su propia transacción; un fallo aborta sin dejar esquema a medias.
    try:
        run_migrations(app.db.pool)
    except Exception as e:
        logger.error('No se pudieron aplicar las migraciones: %s', e)
        raise

    # ---------------- Bootstrap admin (idempotente) ---------------- #
    try:
        if bootstrap_admin():
            logger.warning('Usuario admin inicial creado. CÁMBIALE LA CONTRASEÑA.')
    except Exception as e:
        logger.error('bootstrap_admin: %s', e)

    # ---------------- Blueprints ---------------- #
    app.register_blueprint(lbs_bp)
    app.register_blueprint(inventario_bp)
    app.register_blueprint(monitoreo_bp)
    app.register_blueprint(diagnostic_bp)
    app.register_blueprint(zerotier_bp)
    app.register_blueprint(admin_bp)

    # ---------------- Cache headers para assets ---------------- #
    @app.after_request
    def _cache_headers(resp):
        # Cache de 1 h para assets estáticos (CSS/JSX/imágenes). El HTML y los
        # endpoints API siempre no-store para evitar ver datos stale.
        from flask import request
        path = request.path or ''
        if path.startswith('/static/'):
            resp.headers['Cache-Control'] = 'public, max-age=3600, must-revalidate'
            resp.headers.pop('Pragma', None)
            resp.headers.pop('Expires', None)
        elif path.startswith('/api/'):
            resp.headers['Cache-Control'] = 'no-store, must-revalidate'
        return resp

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

    # ---------------- Cleanup periódico ---------------- #
    app.cleanup_scheduler = _start_cleanup_scheduler(app.db)

    return app


app = create_app()


if __name__ == '__main__':
    host  = os.environ.get('APP_HOST', '0.0.0.0')
    port  = int(os.environ.get('APP_PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    logger.info('Listening on http://%s:%s', host, port)
    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)
