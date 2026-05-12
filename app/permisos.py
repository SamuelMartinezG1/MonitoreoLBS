"""
app/permisos.py — Decoradores de control de acceso para el portal LBS.

Provee dos decoradores usados por los blueprints de rutas:

    @permiso_requerido('scada')        # exige que el usuario tenga el permiso 'scada'
    @requiere_rol('admin', 'tecnico')  # exige que el rol del usuario esté en la lista

Ambos se apoyan en Flask-Login: si el usuario no está autenticado, redirigen al
login; si está autenticado pero no tiene permiso, devuelven 403.
"""
from functools import wraps
from flask import abort, redirect, url_for, request
from flask_login import current_user


def _redirect_login():
    """Redirige al login conservando la URL solicitada en `?next=`."""
    try:
        login_url = url_for('lbs.login', next=request.url)
    except Exception:
        login_url = '/login'
    return redirect(login_url)


def permiso_requerido(permiso: str):
    """Exige que `permiso` esté en la lista de permisos del usuario."""
    def deco(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not current_user.is_authenticated:
                return _redirect_login()
            if not current_user.has_permission(permiso):
                abort(403)
            return view(*args, **kwargs)
        return wrapper
    return deco


def requiere_rol(*roles):
    """Exige que `current_user.rol` esté en la lista de roles permitidos."""
    def deco(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not current_user.is_authenticated:
                return _redirect_login()
            if current_user.rol not in roles and current_user.rol != 'admin':
                abort(403)
            return view(*args, **kwargs)
        return wrapper
    return deco
