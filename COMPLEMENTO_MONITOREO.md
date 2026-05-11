# Complemento de monitoreo — lo que faltaba

En la primera extracción (ver `AUDITORIA.md` original) se incluyeron solo
los **servicios** Python de monitoreo (loop SNMP/Modbus, clientes, persistencia
en Postgres). Faltaban las **rutas HTTP**, **plantillas SCADA** y **assets
visuales** que también pertenecen al dominio de monitoreo.

Esto se agregó:

## Rutas (`app/routes/`)
| Archivo | Función |
|---------|---------|
| `monitoreo_routes.py` | Endpoints SCADA: lista de dispositivos, último estado, historial, telemetría reciente, calidad de energía, perfil horario, proxy a la web del UPS, grabaciones. |
| `diagnostic_routes.py` | Herramientas avanzadas: ping, traceroute, SNMP walk, Modbus probe, escaneo de subred, listado de interfaces. |
| `inventario_routes.py` | Topología (sitios + routers), perfiles OID por dispositivo. |
| `test_snmp_routes.py` | Banco de pruebas SNMP standalone. |

## Templates (`app/templates/`)
- `monitoreo.html` — panel SCADA principal (~3000 líneas).
- `diagnostico.html` — consola de diagnóstico de red.
- `inventario.html` — topología + banco de pruebas OID.
- `snmp_test.html` — utilidad de pruebas SNMP rápidas.

## Static (`app/static/`)
- `css/main.css` — sistema de diseño compartido con `lbs-administrativo`.
- `js/main.js`, `animations.js`.
- `js/power-flow.js` — diagrama animado SVG del flujo eléctrico.
- `UPS-Diagrams/` y `UPS-IMGS/` — imágenes y diagramas de UPS específicos.
- `img/` — íconos / clientes.

## Documentación (`docs/`)
- `oids_detectados_192.168.0.100.json` — escaneo SNMP de referencia que
  ayudó a definir los catálogos en `app/utils/ups_oids.py`.

---

> ⚠️ **Aviso:** este servicio sigue siendo *headless* por diseño (Flask + Socket.IO
> emitiendo eventos). Para que las plantillas SCADA rendericen necesitas
> registrar los blueprints en `run_monitor.py`. Si solo quieres el motor de
> monitoreo en background sin UI, déjalo como está.

Ejemplo para activar la UI integrada:

```python
# run_monitor.py — añadir antes de socketio.init_app
from app.routes.monitoreo_routes  import monitoreo_bp
from app.routes.diagnostic_routes import diagnostic_bp
from app.routes.inventario_routes import inventario_bp
app.register_blueprint(monitoreo_bp)
app.register_blueprint(diagnostic_bp)
app.register_blueprint(inventario_bp)
```

Necesitarás también:
- Auth (Flask-Login + bcrypt) — copia mínima desde `lbs-administrativo/`.
- `base.html` — copia desde `lbs-administrativo/app/templates/`.
- Migraciones de `users` y `user_permissions` (vienen en el set completo
  del proyecto original).

Recomendación: si vas a desplegar la UI completa de monitoreo, lo más
limpio es **compartir la base de datos con `lbs-administrativo/`** y dejar
que ese servicio sea el que sirva las páginas de auth. El monitor expone
solo APIs y Socket.IO en /api/monitoreo/* y /socket.io/.
