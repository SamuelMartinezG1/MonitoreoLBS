# MonitoreoLBS — Usuarios y permisos

---

## Modelo

Cada cuenta tiene **un rol** + **un set de permisos por sección**.

### Roles

| Rol | Bypass de permisos | Acceso a `/admin` |
|---|---|---|
| `admin` | ✓ todos los permisos garantizados | ✓ |
| `tecnico` | no | no |
| `operador` | no | no |
| `user` | no (default) | no |

El rol `admin` ignora el sistema de permisos: tiene acceso completo a
todas las secciones. Los demás roles requieren permisos explícitos.

### Secciones (permisos)

Definidas en `app/auth.py:DEFAULT_SECTIONS`. **Solo dos secciones son
permisos ACTIVOS**, es decir, las únicas que aparecen en un decorador
`@permiso_requerido(...)` y que realmente controlan acceso a endpoints:

| Sección | Estado | Endpoints que protege |
|---|---|---|
| `scada` | **activo** | `/api/inventario/*`, `/api/monitoreo/*`, `/api/recording/*` |
| `herramientas` | **activo** | `/api/diagnostic/*`, `/api/zerotier/*` |
| `inventario` | histórico/alias | ninguno (no protege endpoints) |
| `monitoreo` | histórico/alias | ninguno (no protege endpoints) |
| `diagnostico` | histórico/alias | ninguno (no protege endpoints) |
| `tablero` | histórico/alias | ninguno (no protege endpoints) |

> Las secciones `inventario`, `monitoreo`, `diagnostico` y `tablero` son
> aliases por compatibilidad histórica: se **almacenan** en BD (tabla
> `user_permissions`) y se muestran en la UI, pero **no** están asociadas a
> ningún decorador, así que no restringen ningún endpoint. Para conceder o
> negar acceso real solo importan `scada` y `herramientas`. (Verificable con
> `grep -rn permiso_requerido app/routes/`.)

---

## Bootstrap inicial

Al primer arranque, si `users` está vacía:

```bash
ADMIN_USERNAME=admin            # desde .env
ADMIN_PASSWORD=cambiame_al_primer_login
ADMIN_EMAIL=admin@lbs.com.mx
```

Se crea el usuario admin con **todos los permisos**. Los logs marcan:

```
AUTH BOOTSTRAP: usuario admin creado (admin).
Usuario admin inicial creado. CÁMBIALE LA CONTRASEÑA.
```

**Cambia la contraseña inmediatamente** (header → menú de usuario →
"Cambiar contraseña") o desde la API:

```bash
curl -sS -b $COOKIE -X POST -H 'Content-Type: application/json' \
  -d '{"old_password":"cambiame_al_primer_login","new_password":"una-larga"}' \
  $BASE/api/account/change-password
```

---

## Operaciones (desde la UI, rol admin)

### Crear un usuario nuevo

1. Header → **Admin** → **NUEVO USUARIO**.
2. Captura username, password (≥ 8 chars), rol.
3. Marca las secciones permitidas (checkboxes).
4. **Crear**.

Por defecto un `user` recibe acceso a todo **excepto `scada`**, un
`admin` recibe todo. Puedes ajustar a mano antes de crear.

### Editar permisos

1. Admin → tabla → fila → ícono **editar** (lápiz).
2. Tab **Datos**: cambia rol y/o secciones (checkboxes).
3. **Guardar**.

### Restablecer contraseña (sin saber la vieja)

1. Admin → tabla → fila → ícono **editar**.
2. Tab **Restablecer contraseña**.
3. Captura nueva contraseña (≥ 8 chars) → **Restablecer**.

El usuario podrá entrar inmediatamente con la nueva contraseña.

### Eliminar usuario

- Admin → tabla → fila → ícono **basura** (papelera).
- Confirmación requerida.
- **No puedes eliminarte a ti mismo** (el backend rechaza la operación).

---

## API (rol admin requerido)

| Método | Path | Body |
|---|---|---|
| GET | `/api/users` | — |
| GET | `/api/users/sections` | — |
| POST | `/api/users` | `{username, password, role?, permisos?:[]}` |
| PUT | `/api/users/<id>` | `{role?, permisos?:[]}` |
| POST | `/api/users/<id>/password` | `{new_password}` |
| DELETE | `/api/users/<id>` | — |

Ejemplo completo: crear un técnico de campo con acceso a SCADA + las
herramientas de diagnóstico. El acceso real lo dan `scada` y
`herramientas`; los demás valores (`monitoreo`, `tablero`) se guardan pero
no controlan endpoints:

```bash
curl -sS -b $COOKIE -X POST -H 'Content-Type: application/json' -d '{
  "username":"campo.cdmx",
  "password":"3se5L9pH-2024",
  "role":"tecnico",
  "permisos":["scada","monitoreo","herramientas","tablero"]
}' $BASE/api/users
# {"id":2,"status":"ok"}
```

Luego, si la persona deja de tener acceso a las herramientas, basta con
quitar `herramientas` del set:

```bash
curl -sS -b $COOKIE -X PUT -H 'Content-Type: application/json' -d '{
  "permisos":["scada","monitoreo","tablero"]
}' $BASE/api/users/2
```

---

## Esquema de BD

```sql
-- migrations/007_users.sql
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(80)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,  -- bcrypt
    role          VARCHAR(20)  NOT NULL DEFAULT 'user',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE user_permissions (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seccion   VARCHAR(50) NOT NULL,
    permitido BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_user_seccion UNIQUE (user_id, seccion)
);
```

---

## Patrones de uso recomendados

### Equipo pequeño (1-5 personas)

Solo admins. Crear cuentas separadas para auditar quién hace qué (cada
acción queda en logs del portal).

### Equipo NOC con técnicos de campo

| Rol | Permisos típicos |
|---|---|
| 1 `admin` | todos (suele ser CTO o líder de infra) |
| 2-3 `tecnico` | `scada`, `herramientas` (+ `monitoreo` como etiqueta) |
| N `operador` | solo `scada` |

Los técnicos pueden ejecutar diagnósticos (`herramientas`) y agregar UPS al
inventario (`scada`). Los operadores solo ven el SCADA + alarmas (`scada`).
Recuerda que el control de acceso efectivo lo dan `scada` y `herramientas`.

### Equipo multi-cliente

El acceso a la flota y al inventario va por `scada`; el diagnóstico y
ZeroTier van por `herramientas`. Las secciones `tablero` e `inventario`
hoy son solo etiquetas (no bloquean nada): quítale `scada` a quien no deba
modificar la flota.

---

## Seguridad

- Contraseñas hashed con **bcrypt** (`bcrypt.gensalt()` + `checkpw`).
- Sesiones via **Flask-Login** con cookie HttpOnly + SameSite=Lax,
  duración 7 días con `remember-me`.
- Pre-flight de cualquier endpoint admin: `@login_required +
  @requiere_rol('admin')`.
- El endpoint de cambio de contraseña **valida la actual** antes de
  cambiar (excepto `cambiar_password_admin` que solo lo puede invocar
  un admin sobre otro usuario).
- El bootstrap admin **no sobreescribe** un admin existente: solo aplica
  si `SELECT COUNT(*) FROM users = 0`.

### Recomendaciones operativas

- Rota la `SECRET_KEY` del `.env` cada 6 meses (invalida sesiones).
- Auditoría: revisa los logs del portal por `AUTH BOOTSTRAP`,
  `user_loader: ...` y peticiones `403` para detectar intentos.
- En producción, expon el portal **solo** vía Cloudflare Tunnel (no
  abras el puerto al internet).
