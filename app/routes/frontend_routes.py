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

from app.auth import verify_user

lbs_bp = Blueprint('lbs', __name__)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _urls_for_react():
    """URLs que se inyectan en `window.LBS_URLS` para los JSX."""
    return {
        'dashboard':   url_for('lbs.dashboard'),
        'monitoreo':   url_for('lbs.monitoreo'),
        'inventario':  url_for('lbs.inventario'),
        'diagnostico': url_for('lbs.diagnostico'),
        'logout':      url_for('lbs.logout'),
        'assets':      url_for('static', filename='lbs/assets/'),
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


# --------------------------------------------------------------------------- #
# Endpoint de salud "frontend-aware" (útil al desarrollar)
# --------------------------------------------------------------------------- #
@lbs_bp.route('/health/ui')
def health_ui():
    return jsonify({'status': 'ok', 'auth': current_user.is_authenticated})
