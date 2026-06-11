-- 012_auth_compartido.sql
-- Migra el login del monitoreo al esquema COMPARTIDO auth.* (login común LBS).
-- Copia mon.users -> auth.usuarios, mon.user_permissions -> auth.permisos
-- (app='monitoreo') y mapea roles a auth.usuario_roles. Idempotente.
-- mon.users NO se borra (queda como respaldo). Solo DML (mon_app puede correrla).

-- 1. Usuarios (conserva el hash bcrypt; respeta los ya existentes del seed/otras apps)
INSERT INTO auth.usuarios (username, password_hash, nombre, activo, origen_app, origen_id)
SELECT u.username, u.password_hash, u.username, TRUE, 'monitoreo', u.id::text
  FROM mon.users u
 ON CONFLICT (username) DO NOTHING;

-- 2. Permisos de monitoreo (join por username -> uuid)
INSERT INTO auth.permisos (usuario_id, app, seccion, permitido)
SELECT au.id, 'monitoreo', up.seccion, up.permitido
  FROM mon.user_permissions up
  JOIN mon.users mu      ON mu.id = up.user_id
  JOIN auth.usuarios au  ON au.username = mu.username
 ON CONFLICT (usuario_id, app, seccion) DO NOTHING;

-- 3. Roles (mapea mon.role -> auth.role: admin/tecnico/operador/lector)
INSERT INTO auth.usuario_roles (usuario_id, rol_id)
SELECT au.id, r.id
  FROM mon.users mu
  JOIN auth.usuarios au ON au.username = mu.username
  JOIN auth.roles r ON r.nombre = CASE mu.role
        WHEN 'admin'    THEN 'admin'
        WHEN 'tecnico'  THEN 'tecnico'
        WHEN 'operador' THEN 'operador'
        ELSE 'lector' END
 ON CONFLICT (usuario_id, rol_id) DO NOTHING;

-- 4. Garantizar que el admin compartido tenga acceso a monitoreo (rol + secciones),
--    así no se pierde el acceso al consolidar con el 'admin' del seed.
INSERT INTO auth.usuario_roles (usuario_id, rol_id)
SELECT au.id, r.id FROM auth.usuarios au JOIN auth.roles r ON r.nombre = 'admin'
 WHERE au.username = 'admin'
 ON CONFLICT (usuario_id, rol_id) DO NOTHING;

INSERT INTO auth.permisos (usuario_id, app, seccion, permitido)
SELECT au.id, 'monitoreo', s.seccion, TRUE
  FROM auth.usuarios au
  CROSS JOIN (VALUES ('scada'),('inventario'),('diagnostico'),
                     ('monitoreo'),('herramientas'),('tablero')) AS s(seccion)
 WHERE au.username = 'admin'
 ON CONFLICT (usuario_id, app, seccion) DO NOTHING;
