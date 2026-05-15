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


def listar_usuarios():
    """Devuelve lista de usuarios con sus permisos. Sin password_hash."""
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT u.id, u.username, u.role, u.created_at,
                       COALESCE(
                           json_agg(DISTINCT jsonb_build_object(
                               'seccion',  p.seccion,
                               'permitido', p.permitido
                           )) FILTER (WHERE p.seccion IS NOT NULL),
                           '[]'::json
                       ) AS permisos
                  FROM users u
                  LEFT JOIN user_permissions p
                    ON p.user_id = u.id AND p.permitido = TRUE
                 GROUP BY u.id
                 ORDER BY u.id
            """)
            rows = []
            for r in cur.fetchall():
                d = dict(r)
                if d.get('created_at'):
                    d['created_at'] = d['created_at'].isoformat()
                rows.append(d)
            return rows
    except Exception as e:
        logger.error("listar_usuarios: %s", e)
        return []


def crear_usuario(username: str, password: str, role: str = 'user', permisos: list = None):
    """Crea un usuario nuevo. Devuelve {ok, id} o {error}."""
    username = (username or '').strip()
    if not username or not password:
        return {'error': 'username y password son requeridos'}
    if len(password) < 8:
        return {'error': 'La contraseña debe tener al menos 8 caracteres'}
    if role not in ('admin', 'user', 'tecnico', 'operador'):
        role = 'user'
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM users WHERE username = %s", (username,))
            if cur.fetchone():
                return {'error': 'El nombre de usuario ya existe'}
            cur.execute(
                "INSERT INTO users (username, password_hash, role) "
                "VALUES (%s, %s, %s) RETURNING id",
                (username, _hash(password), role),
            )
            new_id = cur.fetchone()['id']
            # Asignar permisos: si vienen → usar lista; si no → default por rol
            secciones = permisos if permisos is not None else (
                list(DEFAULT_SECTIONS) if role == 'admin'
                else [s for s in DEFAULT_SECTIONS if s != 'scada']
            )
            for sec in secciones:
                cur.execute(
                    "INSERT INTO user_permissions (user_id, seccion, permitido) "
                    "VALUES (%s, %s, TRUE) ON CONFLICT (user_id, seccion) DO NOTHING",
                    (new_id, sec.lower()),
                )
            return {'ok': True, 'id': new_id}
    except Exception as e:
        logger.error("crear_usuario: %s", e)
        return {'error': str(e)}


def actualizar_usuario(user_id: int, datos: dict):
    """Cambia rol o permisos de un usuario. NO toca password (usa
    `cambiar_password_admin` para eso)."""
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            if 'role' in datos and datos['role']:
                cur.execute(
                    "UPDATE users SET role = %s WHERE id = %s",
                    (datos['role'], user_id),
                )
            if 'permisos' in datos and isinstance(datos['permisos'], list):
                # Marca todos en FALSE, luego activa los seleccionados
                cur.execute(
                    "UPDATE user_permissions SET permitido = FALSE WHERE user_id = %s",
                    (user_id,),
                )
                for sec in datos['permisos']:
                    cur.execute(
                        """
                        INSERT INTO user_permissions (user_id, seccion, permitido)
                        VALUES (%s, %s, TRUE)
                        ON CONFLICT (user_id, seccion)
                        DO UPDATE SET permitido = TRUE
                        """,
                        (user_id, str(sec).lower()),
                    )
            return {'ok': True}
    except Exception as e:
        logger.error("actualizar_usuario: %s", e)
        return {'error': str(e)}


def cambiar_password_admin(user_id: int, nueva_password: str):
    """Admin cambia password de otro usuario (sin requerir password actual)."""
    if not nueva_password or len(nueva_password) < 8:
        return {'error': 'Mínimo 8 caracteres'}
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (_hash(nueva_password), user_id),
            )
            return {'ok': True}
    except Exception as e:
        logger.error("cambiar_password_admin: %s", e)
        return {'error': str(e)}


def eliminar_usuario(user_id: int):
    """Borra un usuario. CASCADE limpia sus permisos."""
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
            return {'ok': True}
    except Exception as e:
        logger.error("eliminar_usuario: %s", e)
        return {'error': str(e)}


def change_password(user_id: int, old_password: str, new_password: str):
    """Cambia la contraseña verificando primero la anterior. Devuelve dict
    `{'ok': True}` o `{'error': '...'}`."""
    if not old_password or not new_password:
        return {'error': 'Contraseña actual y nueva son requeridas'}
    if len(new_password) < 8:
        return {'error': 'La nueva contraseña debe tener al menos 8 caracteres'}
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT password_hash FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                return {'error': 'Usuario no encontrado'}
            if not _check(old_password, row['password_hash']):
                return {'error': 'La contraseña actual no coincide'}
            cur.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (_hash(new_password), user_id),
            )
            return {'ok': True}
    except Exception as e:
        logger.error('change_password: %s', e)
        return {'error': str(e)}


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
