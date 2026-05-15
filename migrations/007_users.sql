-- 007_users.sql
-- Autenticación local (Flask-Login + bcrypt) y control de acceso por sección.
-- Idempotente.

-- ---------------------------------------------------------------- --
-- Usuarios                                                          --
-- ---------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(80)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'user',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------- --
-- Permisos por sección (pivot M:N usuario <-> sección)              --
-- Secciones esperadas por app/auth.py:DEFAULT_SECTIONS:             --
--   scada, inventario, diagnostico, monitoreo, herramientas, tablero
-- ---------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS user_permissions (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seccion    VARCHAR(50) NOT NULL,
    permitido  BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_user_seccion UNIQUE (user_id, seccion)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user
    ON user_permissions(user_id);

-- NOTA: el usuario admin inicial NO se siembra aquí. Lo crea
-- `app.auth.bootstrap_admin()` desde ADMIN_USERNAME / ADMIN_PASSWORD
-- del .env, solo si la tabla `users` está vacía.
