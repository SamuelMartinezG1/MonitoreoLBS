"""
app/routes/frontend_routes.py — Blueprint `lbs` que sirve el nuevo diseño.

Cubre:
    GET  /                  → redirige a /dashboard (o /login si no hay sesión)
    GET  /login             → vista de login del nuevo diseño
    POST /login             → valida credenciales y redirige
    GET  /logout            → cierra sesión
    GET  /dashboard         → tablero global (nuevo)
    GET  /inventario        → inventario (reemplaza el actual)
    GET  /diagnostico       → diagnóstico (reemplaza el actual)
    GET  /monitoreo         → SCADA por equipo (reemplaza el actual)

Los endpoints JSON (datos reales) viven en `inventario_routes.py`,
`monitoreo_routes.py`, `diagnostic_routes.py`. Las páginas siguen sirviéndose
con `window.MOCK` hasta que cableemos los endpoints — ver TODO en README.
"""
from flask import (
    Blueprint, render_template, redirect, url_for, request, jsonify, current_app
)
from flask_login import login_required, login_user, logout_user, current_user

from app.auth import verify_user, change_password

lbs_bp = Blueprint('lbs', __name__)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _urls_for_react():
    """URLs que se inyectan en `window.LBS_URLS` para los JSX."""
    import os
    return {
        'dashboard':   url_for('lbs.dashboard'),
        'monitoreo':   url_for('lbs.monitoreo'),
        'inventario':  url_for('lbs.inventario'),
        'diagnostico': url_for('lbs.diagnostico'),
        'grabaciones': url_for('lbs.grabaciones'),
        'admin':       url_for('lbs.admin'),
        'logout':      url_for('lbs.logout'),
        'assets':      url_for('static', filename='lbs/assets/'),
        'poll':        f"{os.environ.get('POLL_INTERVAL', 2)}s",
        'api': {
            # placeholders; los endpoints reales viven en los otros blueprints
            'fleet':     '/api/dashboard/fleet',
            'devices':   '/api/inventario/topologia',
            'monitor':   '/api/monitoreo',
            'diagnose':  '/api/diagnostico',
        },
        'user': {
            'initials': current_user.initials if current_user.is_authenticated else 'LB',
            'name':     current_user.nombre   if current_user.is_authenticated else 'Invitado',
            'rol':      current_user.rol      if current_user.is_authenticated else 'guest',
        },
    }


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
@lbs_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('lbs.dashboard'))

    error = None
    last_user = ''
    if request.method == 'POST':
        last_user = (request.form.get('user') or '').strip()
        pw        = request.form.get('pw') or ''
        remember  = bool(request.form.get('remember'))
        user = verify_user(last_user, pw)
        if user is None:
            error = 'Credenciales inválidas — verifique usuario y contraseña.'
        else:
            login_user(user, remember=remember)
            nxt = request.form.get('next') or request.args.get('next') or url_for('lbs.dashboard')
            # Evitar open redirects: solo aceptamos rutas relativas.
            if not nxt.startswith('/') or nxt.startswith('//'):
                nxt = url_for('lbs.dashboard')
            return redirect(nxt)

    return render_template(
        'lbs/login.html',
        error=error,
        last_user=last_user,
        next_url=request.args.get('next', ''),
    )


@lbs_bp.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('lbs.login'))


# --------------------------------------------------------------------------- #
# Páginas (todas protegidas)
# --------------------------------------------------------------------------- #
@lbs_bp.route('/')
def root():
    if current_user.is_authenticated:
        return redirect(url_for('lbs.dashboard'))
    return redirect(url_for('lbs.login'))


@lbs_bp.route('/dashboard')
@login_required
def dashboard():
    return render_template('lbs/dashboard.html', urls=_urls_for_react())


@lbs_bp.route('/inventario')
@login_required
def inventario():
    return render_template('lbs/inventario.html', urls=_urls_for_react())


@lbs_bp.route('/diagnostico')
@login_required
def diagnostico():
    return render_template('lbs/diagnostico.html', urls=_urls_for_react())


@lbs_bp.route('/monitoreo')
@login_required
def monitoreo():
    device_name = request.args.get('dev', '')
    return render_template(
        'lbs/monitoreo.html',
        urls=_urls_for_react(),
        device_name=device_name,
    )


@lbs_bp.route('/grabaciones')
@login_required
def grabaciones():
    return render_template('lbs/grabaciones.html', urls=_urls_for_react())


@lbs_bp.route('/admin')
@login_required
def admin():
    # Solo admins (la API ya está protegida, pero filtramos también la vista)
    if (current_user.rol or '').lower() != 'admin':
        from flask import abort
        abort(403)
    return render_template('lbs/admin.html', urls=_urls_for_react())


# --------------------------------------------------------------------------- #
# Endpoint de salud "frontend-aware" (útil al desarrollar)
# --------------------------------------------------------------------------- #
@lbs_bp.route('/health/ui')
def health_ui():
    return jsonify({'status': 'ok', 'auth': current_user.is_authenticated})


# --------------------------------------------------------------------------- #
# Cuenta del usuario actual
# --------------------------------------------------------------------------- #
@lbs_bp.route('/api/account/me')
@login_required
def account_me():
    return jsonify({
        'id':       current_user.id,
        'username': current_user.username,
        'nombre':   current_user.nombre,
        'rol':      current_user.rol,
        'initials': current_user.initials,
    })


@lbs_bp.route('/api/health/full')
@login_required
def health_full():
    """Healthcheck profundo: DB + monitor + scheduler + ZT + retención."""
    import time
    out = {
        'db':         {'ok': False, 'latency_ms': None},
        'monitor':    {'ok': False, 'alive': False},
        'modbus':     {'ok': False, 'alive': False, 'workers': None},
        'scheduler':  {'ok': False},
        'zerotier':   {'available': False},
        'metrics':    {'rows': None, 'oldest_ts': None},
        'devices':    {'total': 0, 'online': 0, 'offline': 0, 'warn': 0},
    }

    # DB
    try:
        from app.base_datos import GestorDB
        db = GestorDB()
        t0 = time.monotonic()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        out['db']['ok'] = True
        out['db']['latency_ms'] = round((time.monotonic() - t0) * 1000, 2)
    except Exception as e:
        out['db']['error'] = str(e)

    # Monitor (MonitoringService thread)
    try:
        mon = current_app.monitor
        out['monitor']['alive'] = bool(mon and mon.is_alive())
        out['monitor']['ok']    = out['monitor']['alive']
        out['monitor']['interval_s']        = mon.interval if mon else None
        out['monitor']['metrics_interval_s'] = getattr(mon, '_metrics_interval', None)
        if hasattr(mon, 'modbus_monitor'):
            mm = mon.modbus_monitor
            out['modbus']['alive']   = bool(mm and mm.thread and mm.thread.is_alive())
            out['modbus']['ok']      = out['modbus']['alive']
            out['modbus']['workers'] = getattr(mm, '_workers', None)
    except Exception as e:
        out['monitor']['error'] = str(e)

    # Scheduler
    try:
        sch = getattr(current_app, 'cleanup_scheduler', None)
        if sch:
            out['scheduler']['ok'] = bool(sch.running)
            jobs = sch.get_jobs() if hasattr(sch, 'get_jobs') else []
            out['scheduler']['jobs'] = [j.id for j in jobs]
    except Exception as e:
        out['scheduler']['error'] = str(e)

    # ZeroTier
    try:
        from app.services import zerotier_client as zt
        out['zerotier']['available'] = zt.is_available()
    except Exception as e:
        out['zerotier']['error'] = str(e)

    # Métricas (rows + ts más antigua)
    try:
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM ups_metrics")
            r = cur.fetchone()
            out['metrics']['rows'] = r['n'] if isinstance(r, dict) else r[0]
            oldest = r['oldest'] if isinstance(r, dict) else r[1]
            if oldest:
                out['metrics']['oldest_ts'] = oldest.isoformat()
    except Exception:
        pass

    # Devices summary
    try:
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT COUNT(*) AS total FROM monitoreo_config WHERE COALESCE(activo,TRUE)
            """)
            r = cur.fetchone()
            out['devices']['total'] = r['total'] if isinstance(r, dict) else r[0]
    except Exception:
        pass

    # Status overall
    out['status'] = 'ok' if (out['db']['ok'] and out['monitor']['alive']) else 'degraded'
    return jsonify(out)


@lbs_bp.route('/api/account/change-password', methods=['POST'])
@login_required
def account_change_password():
    data = request.json or {}
    res = change_password(
        current_user.id,
        data.get('old_password', ''),
        data.get('new_password', ''),
    )
    if 'error' in res:
        return jsonify({'error': res['error']}), 400
    return jsonify({'status': 'ok'})
