# Inventario de pantallas

Las 18 plantillas que hoy compone el sistema. Para el rediseño, prioriza las
marcadas con ★.

| # | Archivo | Sección de la app | Lo que hace | Prioridad |
|---|---------|-------------------|-------------|-----------|
| 1 | `monitoreo.html` | SCADA | Panel principal en tiempo real (ver `BRIEF.md` §4) | ★★★ |
| 2 | `dashboard.html` | Tablero | KPIs globales: total UPS, online/offline, alarmas activas, sitios | ★★ |
| 3 | `inventario.html` | Inventario | Topología de sitios, routers, lista de UPS, perfiles OID, banco de pruebas OID | ★★ |
| 4 | `diagnostico.html` | Herramientas | Ping, SNMP walk, Modbus probe, escaneo de subred, traceroute | ★★ |
| 5 | `base.html` | Layout global | Navbar, dropdown usuario, contenedor de toasts, footer | ★★★ (afecta a todo) |
| 6 | `login.html` | Auth | Login con CSRF | ★ |
| 7 | `cambiar_password.html` | Auth | Cambio forzado de contraseña |  |
| 8 | `inicio.html` | Home tras login | Página de bienvenida con accesos rápidos | ★ |
| 9 | `index.html` | Landing | Probable redirect a login |  |
| 10 | `vales.html` | Vales | Crear/listar vales de herramienta con firma | ★ (móvil) |
| 11 | `vales_historial.html` | Vales | Historial filtrable | ★ |
| 12 | `gestion.html` | Admin | Gestión de cuentas |  |
| 13 | `gestionar_cuentas.html` | Admin | CRUD de usuarios + permisos por sección |  |
| 14 | `generar_checklist.html` | Calculadora | Form de generación de checklist NOM-001-SEDE |  |
| 15 | `guia_rapida.html` | Docs | Cheatsheet operativa | ★ |
| 16 | `carga_masiva.html` | Admin | Importar dispositivos desde CSV |  |
| 17 | `recuperacion_proyectos.html` | Admin | Recuperar proyectos archivados |  |
| 18 | `giti_datos.html` | Integraciones | Sincronización con sistema GITI |  |
| 19 | `snmp_test.html` | Diagnóstico | Banco de pruebas SNMP standalone |  |

---

## Componentes globales (en `base.html`)

- **Navbar** con logo, menú hamburguesa, reloj UTC, badge del usuario, dropdown de cuenta.
- **Toast container** (top-right) — todos los `showToast()` aterrizan aquí.
- **Theme switcher** (parcialmente implementado).
- **CSRF meta tag** — obligatorio en todas las páginas.

---

## Patrones que se repiten en varias páginas

1. **eng-panel** — panel oscuro con header y body.
2. **valor-card** — tarjeta numérica con label arriba, valor grande abajo, unidad pequeña.
3. **gauge circular** — SVG con arco coloreado, valor central, label inferior.
4. **status-pill** — píldora con dot pulsante (verde/rojo/ámbar).
5. **chart en vivo** — Chart.js con `<canvas>` dentro de `eng-panel`.
6. **modal Bootstrap** con header `accent-primary` y body p-4.
7. **botón outline** monoespaciado (font-mono) con tamaño 0.65–0.75 rem.
8. **tabla SCADA** — filas densas, hover azul, números alineados a la derecha.
9. **toolbox flotante** — columna fija a la derecha con botones cuadrados.

Estos 9 patrones, bien sistematizados, cubren el 95 % de las pantallas.
Es la oportunidad principal del rediseño.
