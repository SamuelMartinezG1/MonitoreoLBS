"""
app/auth.py — Autenticación con Flask-Login + bcrypt sobre el esquema
COMPARTIDO `auth.*` de la BD unificada (login común del ecosistema LBS).

Tablas (en el esquema `auth`, compartido por las 3 apps):
    - auth.usuarios        (id UUID, username, password_hash, nombre, activo, …)
    - auth.usuario_roles   (usuario_id, rol_id) → auth.roles (admin/operador/tecnico/lector)
    - auth.permisos        (usuario_id, app, seccion, permitido)  ← permiso fino por app

Este módulo opera SIEMPRE con `app='monitoreo'` en los permisos: un usuario es
compartido entre apps, pero sus permisos de sección son por-app. No crea tablas;
la migración de datos (mon.users → auth.usuarios) la hace el SQL versionado.
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

# Esta app dentro del esquema de permisos compartido.
APP = 'monitoreo'

# Secciones de permiso de ESTA app (igual que antes).
DEFAULT_SECTIONS = ('scada', 'inventario', 'diagnostico', 'monitoreo', 'herramientas', 'tablero')

# Roles: el esquema compartido usa admin/operador/tecnico/lector; el resto del
# código del monitoreo habla admin/tecnico/operador/user. Mapeamos en ambos
# sentidos ('user' ↔ 'lector') y definimos jerarquía para elegir el efectivo.
_ROLE_DB_TO_APP = {'admin': 'admin', 'operador': 'operador', 'tecnico': 'tecnico', 'lector': 'user'}
_ROLE_APP_TO_DB = {'admin': 'admin', 'operador': 'operador', 'tecnico': 'tecnico', 'user': 'lector'}
_ROLE_RANK = {'admin': 3, 'tecnico': 2, 'operador': 1, 'lector': 0}


# --------------------------------------------------------------------------- #
# Modelo
# --------------------------------------------------------------------------- #
class User(UserMixin):
    def __init__(self, row: dict, permisos: set | None = None, rol_app: str = 'user'):
        self.id        = str(row['id'])          # UUID como string
        self.username  = row['username']
        self.rol       = rol_app or 'user'
        self.nombre    = row.get('nombre') or row.get('username')
        self._permisos = set(permisos or set())

    def get_id(self):
        return str(self.id)

    @property
    def is_active(self):
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


def _load_permisos(conn, usuario_id) -> set:
    cur = conn.cursor()
    cur.execute(
        "SELECT seccion FROM auth.permisos "
        " WHERE usuario_id = %s::uuid AND app = %s AND permitido = TRUE",
        (str(usuario_id), APP),
    )
    return {r['seccion'].lower() for r in cur.fetchall() if r.get('seccion')}


def _load_rol_app(conn, usuario_id) -> str:
    """Rol efectivo (etiqueta de app) del usuario: el de mayor jerarquía."""
    cur = conn.cursor()
    cur.execute(
        "SELECT r.nombre FROM auth.usuario_roles ur "
        "  JOIN auth.roles r ON r.id = ur.rol_id "
        " WHERE ur.usuario_id = %s::uuid",
        (str(usuario_id),),
    )
    roles_db = [r['nombre'] for r in cur.fetchall() if r.get('nombre')]
    if not roles_db:
        return 'user'
    best = max(roles_db, key=lambda x: _ROLE_RANK.get(x, 0))
    return _ROLE_DB_TO_APP.get(best, 'user')


# --------------------------------------------------------------------------- #
# Loader Flask-Login
# --------------------------------------------------------------------------- #
@login_manager.user_loader
def _load_user(user_id: str):
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, username, nombre FROM auth.usuarios "
                " WHERE id = %s::uuid AND activo = TRUE",
                (str(user_id),),
            )
            row = cur.fetchone()
            if not row:
                return None
            perms = _load_permisos(conn, user_id)
            rol = _load_rol_app(conn, user_id)
            return User(dict(row), perms, rol)
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


def _set_rol(cur, usuario_id, rol_app: str):
    """Reemplaza el rol del usuario por el indicado (etiqueta de app)."""
    rol_db = _ROLE_APP_TO_DB.get(rol_app, 'lector')
    cur.execute("DELETE FROM auth.usuario_roles WHERE usuario_id = %s::uuid", (str(usuario_id),))
    cur.execute(
        "INSERT INTO auth.usuario_roles (usuario_id, rol_id) "
        "SELECT %s::uuid, id FROM auth.roles WHERE nombre = %s",
        (str(usuario_id), rol_db),
    )


def listar_usuarios():
    """Usuarios CON permiso en esta app (o rol asignado), con sus secciones."""
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT u.id, u.username, u.nombre, u.activo, u.created_at,
                       COALESCE((
                           SELECT r.nombre FROM auth.usuario_roles ur
                             JOIN auth.roles r ON r.id = ur.rol_id
                            WHERE ur.usuario_id = u.id
                            ORDER BY CASE r.nombre
                                WHEN 'admin' THEN 3 WHEN 'tecnico' THEN 2
                                WHEN 'operador' THEN 1 ELSE 0 END DESC
                            LIMIT 1
                       ), 'lector') AS rol_db,
                       COALESCE(
                           json_agg(jsonb_build_object('seccion', p.seccion, 'permitido', TRUE))
                           FILTER (WHERE p.seccion IS NOT NULL), '[]'::json
                       ) AS permisos
                  FROM auth.usuarios u
                  LEFT JOIN auth.permisos p
                    ON p.usuario_id = u.id AND p.app = %s AND p.permitido = TRUE
                 GROUP BY u.id
                 ORDER BY u.username
            """, (APP,))
            rows = []
            for r in cur.fetchall():
                d = dict(r)
                d['id'] = str(d['id'])
                d['role'] = _ROLE_DB_TO_APP.get(d.pop('rol_db', 'lector'), 'user')
                if d.get('created_at'):
                    d['created_at'] = d['created_at'].isoformat()
                rows.append(d)
            return rows
    except Exception as e:
        logger.error("listar_usuarios: %s", e)
        return []


def crear_usuario(username: str, password: str, role: str = 'user', permisos: list = None):
    """Crea (o vincula) un usuario y le da permisos en ESTA app. Si el username
    ya existe en el esquema compartido (creado por otra app), solo le añade el
    rol y los permisos de monitoreo en vez de fallar."""
    username = (username or '').strip()
    if not username or not password:
        return {'error': 'username y password son requeridos'}
    if len(password) < 8:
        return {'error': 'La contraseña debe tener al menos 8 caracteres'}
    if role not in ('admin', 'user', 'tecnico', 'operador'):
        role = 'user'
    secciones = permisos if permisos is not None else (
        list(DEFAULT_SECTIONS) if role == 'admin'
        else [s for s in DEFAULT_SECTIONS if s != 'scada']
    )
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM auth.usuarios WHERE username = %s", (username,))
            existing = cur.fetchone()
            if existing:
                uid = existing['id']
                # Ya existe (otra app): no pisamos su contraseña; solo permisos/rol.
            else:
                cur.execute(
                    "INSERT INTO auth.usuarios (username, password_hash, nombre, origen_app) "
                    "VALUES (%s, %s, %s, %s) RETURNING id",
                    (username, _hash(password), username, APP),
                )
                uid = cur.fetchone()['id']
            _set_rol(cur, uid, role)
            for sec in secciones:
                cur.execute(
                    "INSERT INTO auth.permisos (usuario_id, app, seccion, permitido) "
                    "VALUES (%s::uuid, %s, %s, TRUE) "
                    "ON CONFLICT (usuario_id, app, seccion) DO UPDATE SET permitido = TRUE",
                    (str(uid), APP, sec.lower()),
                )
            return {'ok': True, 'id': str(uid)}
    except Exception as e:
        logger.error("crear_usuario: %s", e)
        return {'error': str(e)}


def actualizar_usuario(user_id, datos: dict):
    """Cambia rol o permisos (de esta app) de un usuario."""
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            if datos.get('role'):
                _set_rol(cur, user_id, datos['role'])
            if 'permisos' in datos and isinstance(datos['permisos'], list):
                cur.execute(
                    "UPDATE auth.permisos SET permitido = FALSE "
                    " WHERE usuario_id = %s::uuid AND app = %s",
                    (str(user_id), APP),
                )
                for sec in datos['permisos']:
                    cur.execute(
                        "INSERT INTO auth.permisos (usuario_id, app, seccion, permitido) "
                        "VALUES (%s::uuid, %s, %s, TRUE) "
                        "ON CONFLICT (usuario_id, app, seccion) DO UPDATE SET permitido = TRUE",
                        (str(user_id), APP, str(sec).lower()),
                    )
            return {'ok': True}
    except Exception as e:
        logger.error("actualizar_usuario: %s", e)
        return {'error': str(e)}


def cambiar_password_admin(user_id, nueva_password: str):
    if not nueva_password or len(nueva_password) < 8:
        return {'error': 'Mínimo 8 caracteres'}
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE auth.usuarios SET password_hash = %s WHERE id = %s::uuid",
                (_hash(nueva_password), str(user_id)),
            )
            return {'ok': True}
    except Exception as e:
        logger.error("cambiar_password_admin: %s", e)
        return {'error': str(e)}


def eliminar_usuario(user_id):
    """Quita al usuario de ESTA app (sus permisos de monitoreo). No borra el
    usuario compartido si tiene permisos en otras apps; solo lo desvincula."""
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM auth.permisos WHERE usuario_id = %s::uuid AND app = %s",
                (str(user_id), APP),
            )
            # Si ya no tiene permisos en ninguna app, eliminar el usuario y su rol.
            cur.execute(
                "SELECT COUNT(*) AS n FROM auth.permisos WHERE usuario_id = %s::uuid",
                (str(user_id),),
            )
            if (cur.fetchone() or {}).get('n', 0) == 0:
                cur.execute("DELETE FROM auth.usuarios WHERE id = %s::uuid", (str(user_id),))
            return {'ok': True}
    except Exception as e:
        logger.error("eliminar_usuario: %s", e)
        return {'error': str(e)}


def change_password(user_id, old_password: str, new_password: str):
    if not old_password or not new_password:
        return {'error': 'Contraseña actual y nueva son requeridas'}
    if len(new_password) < 8:
        return {'error': 'La nueva contraseña debe tener al menos 8 caracteres'}
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT password_hash FROM auth.usuarios WHERE id = %s::uuid",
                        (str(user_id),))
            row = cur.fetchone()
            if not row:
                return {'error': 'Usuario no encontrado'}
            if not _check(old_password, row['password_hash']):
                return {'error': 'La contraseña actual no coincide'}
            cur.execute(
                "UPDATE auth.usuarios SET password_hash = %s WHERE id = %s::uuid",
                (_hash(new_password), str(user_id)),
            )
            return {'ok': True}
    except Exception as e:
        logger.error('change_password: %s', e)
        return {'error': str(e)}


def verify_user(identifier: str, password: str):
    """Valida username + contraseña contra auth.usuarios. Devuelve User o None."""
    identifier = (identifier or '').strip()
    if not identifier or not password:
        return None
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, username, password_hash, nombre FROM auth.usuarios "
                " WHERE username = %s AND activo = TRUE LIMIT 1",
                (identifier,),
            )
            row = cur.fetchone()
            if not row:
                return None
            row = dict(row)
            if not _check(password, row['password_hash']):
                return None
            perms = _load_permisos(conn, row['id'])
            rol = _load_rol_app(conn, row['id'])
            return User(row, perms, rol)
    except Exception as e:
        logger.error('verify_user: %s', e)
        return None


# --------------------------------------------------------------------------- #
# Bootstrap admin
# --------------------------------------------------------------------------- #
def bootstrap_admin() -> bool:
    """Garantiza un admin del monitoreo. Si NINGÚN usuario tiene permisos en
    esta app, crea/vincula `ADMIN_USERNAME` con rol admin y todos los permisos.
    Idempotente: no toca usuarios existentes con acceso."""
    user = os.environ.get('ADMIN_USERNAME', 'admin')
    pw   = os.environ.get('ADMIN_PASSWORD', 'admin123')
    try:
        db = GestorDB()
        with db.pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT COUNT(*) AS n FROM auth.permisos WHERE app = %s AND permitido = TRUE",
                (APP,),
            )
            if (cur.fetchone() or {}).get('n', 0) > 0:
                return False
            # Reusar el usuario compartido si ya existe (p.ej. del seed).
            cur.execute("SELECT id FROM auth.usuarios WHERE username = %s", (user,))
            existing = cur.fetchone()
            if existing:
                uid = existing['id']
                cur.execute("UPDATE auth.usuarios SET password_hash = %s WHERE id = %s::uuid",
                            (_hash(pw), str(uid)))
            else:
                cur.execute(
                    "INSERT INTO auth.usuarios (username, password_hash, nombre, origen_app) "
                    "VALUES (%s, %s, %s, %s) RETURNING id",
                    (user, _hash(pw), 'Administrador', APP),
                )
                uid = cur.fetchone()['id']
            _set_rol(cur, uid, 'admin')
            for sec in DEFAULT_SECTIONS:
                cur.execute(
                    "INSERT INTO auth.permisos (usuario_id, app, seccion, permitido) "
                    "VALUES (%s::uuid, %s, %s, TRUE) "
                    "ON CONFLICT (usuario_id, app, seccion) DO UPDATE SET permitido = TRUE",
                    (str(uid), APP, sec),
                )
            logger.warning('AUTH BOOTSTRAP: admin de monitoreo asegurado (%s).', user)
            return True
    except Exception as e:
        logger.error('bootstrap_admin: %s', e)
        return False
