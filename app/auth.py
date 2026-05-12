"""
app/auth.py — Autenticación local con Flask-Login + bcrypt.

Reutiliza las tablas existentes del esquema PostgreSQL:

    - users               (id, username, password_hash, role, created_at)
    - user_permissions    (user_id, seccion, permitido)  ← pivot M:N

No crea tablas. Si ya existe un usuario `admin` lo respeta. Si la tabla
`users` está vacía y se definen las variables `ADMIN_USERNAME` /
`ADMIN_PASSWORD`, crea un usuario admin con todos los permisos.
"""
import os
import logging

from flask_login import LoginManager, UserMixin
import bcrypt

from app.base_datos import GestorDB

logger = logging.getLogger(__name__)
login_manager = LoginManager()
login_manager.login_view = 'lbs.login'
login_manager.login_message = 'Inicia sesión para acceder al panel.'
login_manager.login_message_category = 'warning'


# --------------------------------------------------------------------------- #
# Modelo
# --------------------------------------------------------------------------- #
DEFAULT_SECTIONS = ('scada', 'inventario', 'diagnostico', 'monitoreo', 'herramientas', 'tablero')


class User(UserMixin):
    def __init__(self, row: dict, permisos: set | None = None):
        self.id        = row['id']
        self.username  = row['username']
        self.rol       = row.get('role') or 'user'
        self.nombre    = row.get('username')  # users no tiene 'nombre'; usar username
        self._permisos = set(permisos or set())

    def get_id(self):
        return str(self.id)

    @property
    def is_active(self):
        # users no tiene columna 'activo' → todos activos
        return True

    def has_permission(self, perm: str) -> bool:
        if self.rol == 'admin':
            return True
        return perm.lower() in self._permisos

    @property
    def initials(self) -> str:
        parts = (self.nombre or self.username).split()
        if len(parts) >= 2:
            return (parts[0][0] + parts[1][0]).upper()
        return self.username[:2].upper()


def _load_permisos(conn, user_id: int) -> set:
    cur = conn.cursor()
    cur.execute(
        "SELECT seccion FROM user_permissions WHERE user_id = %s AND permitido = TRUE",
        (user_id,),
    )
    return {r['seccion'].lower() for r in cur.fetchall() if r.get('seccion')}


# --------------------------------------------------------------------------- #
# Loader Flask-Login
# --------------------------------------------------------------------------- #
@login_manager.user_loader
def _load_user(user_id: str):
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM users WHERE id = %s", (int(user_id),))
            row = cur.fetchone()
            if not row:
                return None
            perms = _load_permisos(conn, int(user_id))
            return User(dict(row), perms)
    except Exception as e:
        logger.warning('user_loader: %s', e)
        return None


# --------------------------------------------------------------------------- #
# Helpers de credenciales
# --------------------------------------------------------------------------- #
def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def _check(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


def verify_user(identifier: str, password: str):
    """Valida `username` + contraseña. Devuelve User o None."""
    identifier = (identifier or '').strip()
    if not identifier or not password:
        return None
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM users WHERE username = %s LIMIT 1",
                (identifier,),
            )
            row = cur.fetchone()
            if not row:
                return None
            row = dict(row)
            if not _check(password, row['password_hash']):
                return None
            perms = _load_permisos(conn, row['id'])
            return User(row, perms)
    except Exception as e:
        logger.error('verify_user: %s', e)
        return None


# --------------------------------------------------------------------------- #
# Bootstrap admin
# --------------------------------------------------------------------------- #
def bootstrap_admin() -> bool:
    """Si `users` está vacía, crea un admin con todos los permisos a partir de
    ADMIN_USERNAME / ADMIN_PASSWORD. Idempotente: no toca usuarios existentes.
    """
    user = os.environ.get('ADMIN_USERNAME', 'admin')
    pw   = os.environ.get('ADMIN_PASSWORD', 'admin123')
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) AS n FROM users")
            n = (cur.fetchone() or {}).get('n', 0)
            if n and n > 0:
                return False
            cur.execute(
                "INSERT INTO users (username, password_hash, role) "
                "VALUES (%s, %s, 'admin') RETURNING id",
                (user, _hash(pw)),
            )
            new_id = cur.fetchone()['id']
            for sec in DEFAULT_SECTIONS:
                cur.execute(
                    "INSERT INTO user_permissions (user_id, seccion, permitido) "
                    "VALUES (%s, %s, TRUE)",
                    (new_id, sec),
                )
            logger.warning('AUTH BOOTSTRAP: usuario admin creado (%s).', user)
            return True
    except Exception as e:
        logger.error('bootstrap_admin: %s', e)
        return False
