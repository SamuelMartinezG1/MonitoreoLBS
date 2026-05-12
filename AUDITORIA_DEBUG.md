# Auditoría funcional y debug — MonitoreoLBS

Fecha: 2026-05-11
Alcance: revisión estática completa de `run_monitor.py`, capa de servicios (SNMP, Modbus, métricas), `GestorDB`, rutas Flask, migraciones SQL, Dockerfile y `docker-compose.yml`.

---

## TL;DR

El **núcleo de polling sí arranca y funciona** (`run_monitor.py` → `MonitoringService` + `ModbusMonitor` + Socket.IO + Postgres). Es lo único que el entrypoint expone, junto con `/health` y `/`.

Todo lo que está bajo `app/routes/` y `app/templates/` **está roto y muerto** en este repo: no se registra, no se puede importar, depende de módulos (`flask_login`, `app.permisos`) y métodos de `GestorDB` que no existen. Si alguien lo intenta cargar, revienta en el import.

Hay además **dos bugs reales en el camino caliente** (uno de pysnmp y uno de Modbus) que recomiendo corregir antes de seguir.

---

## 1. Bugs críticos (rompen funcionalidad en runtime)

### 1.1 `app/routes/__init__.py` importa módulos inexistentes
```python
from . import dashboard, calculator, api, management, documents, guia_rapida
```
Ninguno de esos archivos existe en `app/routes/`. Solo hay `diagnostic_routes.py`, `inventario_routes.py`, `monitoreo_routes.py`, `test_snmp_routes.py`. Un simple `import app.routes` lanza `ModuleNotFoundError`.

Actualmente el daño es contenido porque **`run_monitor.py` nunca importa `app.routes` ni registra blueprints**, pero queda como trampa para cualquiera que intente reactivar el frontend.

### 1.2 Las rutas existentes no son cargables
Los cuatro archivos de rutas dependen de:
- `from flask_login import login_required` — `flask_login` **no está en `requirements.txt`**.
- `from app.permisos import permiso_requerido, requiere_rol` — **no existe** `app/permisos.py`.
- `current_app.db` — `run_monitor.py` solo asigna `app.monitor`, nunca `app.db`.
- Múltiples métodos de `GestorDB` que no existen: `obtener_ultimo_estado`, `calcular_calidad_energia`, `obtener_perfil_horario`, `agregar_monitoreo_ups`, `eliminar_monitoreo_ups`, `obtener_telemetria_reciente`, `obtener_historial_device`, `iniciar_grabacion`, `detener_grabacion`, `obtener_grabaciones`, `eliminar_grabacion`, `obtener_grabacion`, `obtener_datos_grabacion`, `obtener_sitios`, etc.

Conclusión: **las páginas `/monitoreo`, `/inventario`, `/diagnostico`, `/snmp-test` y todas sus APIs están inoperativas**. Los `.html` en `app/templates/` no se sirven nunca.

Recomendación: o bien (a) elimina `app/routes/` y `app/templates/` de este repo (parece pertenecer al monolito `LBS-SERVICIO-APP` y se trajeron por accidente), o bien (b) completa la portabilidad — añade `flask_login`, copia `permisos.py`, agrega los métodos faltantes a `GestorDB`, asigna `app.db = GestorDB()` y registra los blueprints en `create_app`.

### 1.3 `snmp_client.py` usa un import legacy de pysnmp
```python
from pysnmp.hlapi.asyncio import (...)
```
El resto de clientes (`snmp_minimal_client.py`, `snmp_upsmib_client.py`, `_poll_custom_profile` en `monitoring_service.py`) usa la ruta nueva `pysnmp.hlapi.v3arch.asyncio`. Con `pysnmp==7.1.22` ambos paths funcionan en la práctica, pero la API legacy emite `DeprecationWarning` y planea desaparecer. Unificar a `v3arch.asyncio` evita un cambio sorpresa al actualizar.

Adicionalmente este cliente **no se usa por el loop de polling** (el servicio elige entre `MinimalSNMPClient`, `UPSMIBClient` o perfil custom). `SNMPClient` solo aparecería si lo invocara `app/routes/test_snmp_routes.py`, que como vimos no se registra.

### 1.4 Modbus — claves del registro de dispositivo equivocadas
En `modbus_monitor.py::_process_device`:
```python
port  = dev.get('port', 502)
slave = dev.get('slave_id', 1)
```
La consulta de `obtener_monitoreo_ups` devuelve `modbus_port` y `modbus_unit_id`, no `port` ni `slave_id`. Resultado: **todos los UPS Modbus se conectan a 502 con slave 1**, ignorando lo que haya en la BD. Si tu setup usa cualquier puerto/unit distinto, no llega tráfico al equipo correcto.

Fix:
```python
port  = dev.get('modbus_port')  or 502
slave = dev.get('modbus_unit_id') or 1
```

### 1.5 `write_ups_data` ignora `device_id`/`sitio`/`ups_type` para Modbus
`modbus_monitor.py` llama `influx_service.write_ups_data(name, ip, data)` sin pasar `device_id`, así que toda la telemetría Modbus se persiste en `ups_metrics` con `device_id=NULL`. Las consultas históricas posteriores (`/api/datos/historico`, `query_ups_data`) filtran por `device_id` y nunca encuentran nada. Pásalo igual que en `monitoring_service.py`:
```python
influx_service.write_ups_data(
    name, ip, data,
    device_id=dev['id'],
    sitio=dev.get('sitio_nombre', ''),
    ups_type=dev.get('ups_type', '')
)
```

---

## 2. Bugs menores / inconsistencias

### 2.1 Defaults de versión SNMP confundidos
- `monitoring_service.py::_check_device`: `snmp_version=None → 1` con comentario "Default SNMPv2c". Correcto: en pysnmp `mpModel=0` es v1 y `mpModel=1` es v2c.
- `MinimalSNMPClient.__init__(..., mp_model=0)`: default v1, mientras `obtener_monitoreo_ups` retorna `snmp_version=1` por schema. El servicio fuerza `int(snmp_version_raw)` al pasarlo, así que el default del cliente nunca se ve, pero es contradictorio leerlo. Considera homogeneizar a v2c en todos lados.

### 2.2 Comentarios de IDs Modbus desalineados con el código
`UPS_BLOCK_START = 100` con `REGISTER_MAP` usando `'pos': 0..55`. Eso es correcto (offset relativo al bloque leído). El comentario "IDs 0-6" / "IDs 12-23" en cambio sugiere direcciones absolutas; sin documentación oficial al lado es fácil confundir y desplazar posiciones. Sugiero renombrar a `'rel_pos'` o agregar un assert al inicio: `assert max(info['pos'] for info in REGISTER_MAP.values()) < UPS_BLOCK_COUNT`.

### 2.3 `monitoring_service._async_poll` filtra por `protocolo == 'snmp'`
... pero el default del `.get` es `'modbus'`. Si alguien deja la columna `protocolo` en `NULL` esperando SNMP (porque el schema dice `DEFAULT 'snmp'`), no se montea en SNMP. El default real es DDL; cualquier insert manual sin valor toma `'snmp'`. Igual, blindar a:
```python
proto = (d.get('protocolo') or 'snmp').lower()
```

### 2.4 `payload` con doble emisión sin namespace
En `monitoring_service.py::_check_device`:
```python
socketio.emit('ups_data',   data,    namespace='/monitor')
...
socketio.emit('ups_update', payload)            # ← namespace default
```
El segundo emit cae al namespace global, no a `/monitor`. El frontend SCADA suscrito a `/monitor` no ve los `ups_update` de SNMP. En cambio en Modbus la emisión también es sin namespace. Decide y unifica: o ambos con `namespace='/monitor'` o ambos sin él.

### 2.5 `monitoring_service.run()` — `asyncio.run` por ciclo
`_poll_snmp_devices` llama `asyncio.run(self._async_poll())` cada 2 s, lo que crea/destruye un event loop nuevo en cada ciclo. Cada `SnmpEngine` construido dentro del cliente arranca un transport nuevo. Para 1–4 UPS es inocuo; con muchos dispositivos genera GC pressure y posibles `RuntimeError: Event loop is closed`. Considera mantener un loop persistente con `loop.run_until_complete` en un thread dedicado, o pasar a `eventlet`-friendly polling.

### 2.6 `apparent_power` puede dividir por cero en `snmp_upsmib_client.py`
```python
'apparent_power': int(safe_int(raw.get('output_power')) / 0.8) if raw.get('output_power') else 0,
```
Si `output_power` viene como string vacío `""`, `raw.get('output_power')` es truthy y `safe_int` devuelve 0 → división por 0.8 → 0. No crashea pero es código frágil; refactoriza con `safe_int(...)` ya calculado.

### 2.7 `MinimalSNMPClient.safe_float` come comas
`''.join(c for c in str(value) if c.isdigit() or c == '.')` descarta signos y exponentes. Para los OIDs Megatec actuales es OK, pero si un día un dispositivo devuelve `-5` o `1.2e3`, se rompe silenciosamente devolviendo el valor sin signo.

### 2.8 Migraciones desordenadas y `005_chart_history_extra.sql`
`004` crea `ups_chart_history` sin los campos `voltaje_bateria`, `power_mode`, `power_factor`, `active_power`, `apparent_power`, `battery_remain_time`. Los añade `005`. Pero `GestorDB.guardar_punto_historial` los `INSERT`-ea siempre. En una BD recién creada las migraciones corren en orden alfabético gracias al volume mount `:/docker-entrypoint-initdb.d`, así que el `ALTER TABLE` aplica antes de cualquier insert; OK. Cuidado si se carga el dump fuera del init de Postgres.

### 2.9 `Dockerfile` no copia `requirements.txt` antes de instalar (sí lo hace, OK), pero **no instala paquete del directorio**. Está bien para gunicorn directo. Sin embargo el `CMD` referencia `run_monitor:app`, lo que importa `run_monitor.py` que llama `eventlet.monkey_patch()` después de que gunicorn ya cargó eventlet en su worker. Funciona porque `-k eventlet` parchea antes; aun así el monkey_patch duplicado puede generar `AlreadyPatchedWarning`. Mover monkey_patch a la primera línea (antes de cualquier import de stdlib) ya está hecho ✓.

### 2.10 `mdns_service.py` está cargado pero nunca arrancado
No se llama `start()` en ningún `__init__`. Si era para auto-discovery, queda muerto. Borrar o conectar.

---

## 3. Lo que sí funciona (verificado por lectura)

- Conexión a Postgres con `psycopg-pool` y `autocommit=True` ✓.
- Init de migraciones por volumen `/docker-entrypoint-initdb.d` ✓.
- `pysnmp 7.1.22` + `eventlet 0.40.x` + `gunicorn -k eventlet` arranca correctamente ✓.
- Healthcheck `/health` y endpoint raíz ✓.
- Buffer circular de 10 min + historial de gráficas + métricas EAV bien separados ✓.
- Generación de alarmas SNMP y Modbus por umbrales ✓.

---

## 4. Plan de corrección sugerido (en orden)

1. **Decidir qué hacer con `app/routes/` y `app/templates/`** (eliminar vs. portar). Si es servicio headless puro, eliminar y dejar solo `/health` y `/`.
2. **Arreglar Modbus keys** (`modbus_port`, `modbus_unit_id`) — bug 1.4. Cambio de 2 líneas.
3. **Pasar `device_id`/`sitio`/`ups_type` en el write_ups_data de Modbus** — bug 1.5.
4. **Unificar namespace en `socketio.emit('ups_update', ...)`** — bug 2.4.
5. **Unificar pysnmp a `pysnmp.hlapi.v3arch.asyncio`** — bug 1.3.
6. **Limpiar import muerto de `mdns_service`** o conectarlo.
7. (Opcional) Refactor del loop SNMP a event loop persistente.

¿Quieres que aplique los fixes 2-5 directamente en el código?
