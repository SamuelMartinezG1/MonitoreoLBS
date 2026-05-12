# Integración del nuevo frontend (Claude Design) — LBS Monitor

Fecha: 2026-05-12

Este documento resume la integración del bundle `monitoreo-lbs/` (handoff de
**Claude Design**) con la base PostgreSQL del servicio.

---

## 1. Arquitectura final

```
                 ┌─────────────────────────────────────────────┐
                 │             run_monitor.py (Flask)           │
                 │                                              │
   navegador  →  │  /login  /dashboard  /inventario             │  →  Postgres
                 │  /diagnostico  /monitoreo  (templates Jinja) │
                 │                                              │
                 │  /api/*          (JSON endpoints existentes) │
                 │  /health         (liveness)                  │
                 │  /monitor (Socket.IO, telemetría en vivo)    │
                 │                                              │
                 │  MonitoringService → SNMP + Modbus → PG      │
                 └─────────────────────────────────────────────┘
```

- **React vía CDN (UMD) + Babel standalone**: sin Vite/Webpack. Los `.jsx` se
  sirven como estáticos y el navegador los compila al vuelo. Esto mantiene
  el stack 100% Flask y Docker sin cambios de infraestructura.
- **Diseño pixel-perfect**: estilos y componentes vienen del bundle original.
  Solo se ajustaron rutas a `window.LBS_URLS` para que los enlaces internos
  apunten a las URLs de Flask.

## 2. Cambios realizados

### Nuevos archivos

| Ruta | Propósito |
|------|-----------|
| `app/static/lbs/assets/`        | Logo (de Claude Design). |
| `app/static/lbs/styles/*.css`   | 7 hojas de estilo del diseño. |
| `app/static/lbs/components/*.jsx` | 12 componentes React (Shell, Sidebar, Dashboard, Inventario, Diagnóstico, App SCADA, Charts, UpsDiagram, ValuePanels, Toolbox, MockData, tweaks-panel). |
| `app/templates/lbs/*.html`      | Templates Jinja que reemplazan los HTML del prototipo. |
| `app/auth.py`                   | Flask-Login + bcrypt + tabla `usuarios`. |
| `app/permisos.py`               | Decoradores `permiso_requerido` y `requiere_rol`. |
| `app/routes/frontend_routes.py` | Blueprint `lbs` con todas las páginas (login, dashboard, inventario, diagnostico, monitoreo). |
| `migrations/007_users.sql`      | Tabla `usuarios` (auth local). |

### Archivos modificados

| Ruta | Cambio |
|------|--------|
| `run_monitor.py` | Ahora es el shell completo: registra Flask-Login, blueprints, sirve templates y mantiene `MonitoringService`. |
| `app/routes/__init__.py` | Limpieza: solo se importan los blueprints reales (`lbs`, `inventario`, `monitoreo`, `diagnostic`, `test_snmp`). Se eliminaron los imports a módulos que no existían (`dashboard`, `calculator`, `api`, `management`, `documents`, `guia_rapida`). |
| `app/routes/inventario_routes.py` | Se eliminó el `index()` que servía `inventario.html` — ahora lo sirve `lbs_bp`. Endpoints `/api/inventario/*` intactos. |
| `app/routes/monitoreo_routes.py` | Idem para `/monitoreo`. |
| `app/routes/diagnostic_routes.py` | Idem para `/diagnostico`. |
| `app/routes/test_snmp_routes.py` | Movido de `/snmp-test` a `/legacy/snmp-test` (se conserva el banco de pruebas SNMP heredado). |
| `requirements.txt` | + `Flask-Login>=0.6.3`, `bcrypt>=4.0.1`. |
| `.env.example` | + `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL`. |
| `app/static/lbs/components/Shell.jsx`, `DashboardApp.jsx`, `InventarioApp.jsx` | Los enlaces `*.html` ahora consultan `window.LBS_URLS` (inyectado por Flask). El logo lee de `URLS.assets`. El user-chip ahora cierra sesión. |

### Archivos NO tocados

- `monitoreo-lbs/` (bundle original de Claude Design) se conserva como referencia.
- `app/templates/inventario.html`, `monitoreo.html`, `diagnostico.html`, `snmp_test.html` (templates antiguos) — los nuevos están en `app/templates/lbs/`. Puedes borrarlos cuando confirmes que el nuevo diseño cubre todo.
- Backend SNMP/Modbus/Postgres (`app/services/*`, `app/base_datos.py`) — intacto.

## 3. Primer arranque

```bash
# 1. (Una sola vez) — aplicar la migración 007 si la base ya existía:
psql "$DATABASE_URL" -f migrations/007_users.sql

# 2. Definir admin inicial en .env:
echo "ADMIN_USERNAME=admin"      >> .env
echo "ADMIN_PASSWORD=micontra"   >> .env

# 3. Instalar dependencias nuevas:
pip install Flask-Login bcrypt

# 4. Levantar:
python run_monitor.py
#  → http://127.0.0.1:5000/login
```

Tras el login el usuario `admin` tiene todos los permisos. El bootstrap
crea el usuario **solo si la tabla `usuarios` está vacía** — es idempotente.

## 4. Estado de los datos

> El frontend actualmente renderiza con `window.MOCK` (datos sintéticos del
> handoff). Las URLs de las API reales ya están preparadas en `window.LBS_URLS.api`
> y los endpoints JSON existentes están operativos.

### Pendiente para una segunda iteración (datos reales)

| Página      | Componente JSX            | Endpoint a usar                              |
|-------------|---------------------------|----------------------------------------------|
| Dashboard   | `DashboardApp.jsx`        | nuevo: `GET /api/dashboard/fleet`            |
| Inventario  | `InventarioApp.jsx`       | `GET /api/inventario/topologia`              |
| Diagnóstico | `DiagnosticoApp.jsx`      | `POST /api/diagnostic/ping`, `…/snmp-walk`   |
| Monitoreo   | `App.jsx` + `Sidebar.jsx` | `GET /api/monitoreo/ultimo-estado/<id>`      |

Sustituir `const { SITES, DEVICES, ALARMS } = window.MOCK;` por `useEffect` con
`fetch(window.LBS_URLS.api.devices)` en cada `*App.jsx`. El endpoint
`/api/dashboard/fleet` aún no existe (se construye en la siguiente fase).

## 5. Roles y permisos

- **`admin`**: todos los permisos.
- **`tecnico`**: ejecuta diagnósticos y autoset (`requiere_rol`).
- **`operador`**: solo lectura de SCADA.
- **`viewer`**: solo lectura.

El CSV `permisos` admite combinaciones libres: `scada,inventario,diagnostico,monitoreo,admin`.

## 6. Seguridad

- Contraseñas: `bcrypt` con sal automática.
- Sesiones: cookie HTTPOnly + SameSite=Lax. "Recordar sesión" dura 7 días.
- `next` en login está validado para evitar open redirects (solo URLs relativas).
- Los botones **SSO Microsoft** y **Certificado X.509** del diseño están
  visibles pero deshabilitados hasta que se decida la integración.
