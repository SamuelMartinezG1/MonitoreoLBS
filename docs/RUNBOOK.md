# MonitoreoLBS — Runbook operacional

Procedimientos del día a día. Asume que ya hiciste el deploy
(ver [`DEPLOY.md`](DEPLOY.md)).

---

## 1. Operaciones diarias

### 1.1 Estado del stack

```bash
make ps           # ¿corren los contenedores?
make health       # /health → {"status":"ok"}
make logs         # ¿hay errores en el portal?
make logs-db      # ¿Postgres ok?
```

Indicadores en el dashboard:
- **UPS en línea** = devices con `status='ok'` en el último ciclo.
- **Alarmas activas** = devices con `status='warn'` o `'off'`.
- **Carga total** = suma de `kva * (load/100) * 0.9`.

### 1.2 Refrescar la flota manualmente

El DataLayer del frontend hace polling cada 8 s. Si necesitas un push
inmediato, simplemente recarga la página o, desde la consola del navegador:

```javascript
window.LBS_DATA.refresh()
```

### 1.3 Ver telemetría en vivo de un UPS

1. Sidebar → click sobre el UPS.
2. Se abre `/monitoreo?dev=<id>`.
3. La página suscribe a Socket.IO `/monitor` y muestra los datos cada 2 s.
4. Charts inferiores muestran las últimas 6 h (refresh c/30 s desde
   `/api/ups-history`).

---

## 2. Agregar un sitio nuevo (workflow completo)

### Opción A — Wizard guiado (recomendado)

1. **Diagnóstico → ZeroTier → "Wizard sitio"** (botón arriba a la derecha).
2. Paso 1: verifica que el daemon esté disponible (si no, ejecuta
   `sudo ./scripts/setup_zerotier.sh` en el host).
3. Paso 2: captura
   - **Network ID** ZeroTier (16 hex de https://my.zerotier.com).
   - **# de sitio** (entero único, ej. 99).
   - **Nombre** ("CDMX · Vallejo").
   - **Subred LAN** (`192.168.99.0/24`).
   - (Opcional) IPs del router LAN y ZT.
   - SNMP community (default `public`).
4. Paso 3 → "Ejecutar bootstrap". El portal:
   - Une el host a la network ZT.
   - Crea el sitio en BD.
   - Detecta Teltonika.
   - Escanea la LAN.
5. Paso 4: aparece la lista de **UPS candidatos**. Click "Importar" en
   cada uno → entra a la flota → polling automático.

> **No olvides autorizar el nodo** del portal en
> `https://my.zerotier.com/network/<id>` (link directo en la UI).

### Opción B — Manual

```bash
# 1. En el host
sudo zerotier-cli join 8056c2e21c000001

# 2. En el portal: Inventario → NUEVO SITIO
#    numero_sitio = 99, nombre = "...", subred_lan = "192.168.99.0/24"
#    router_ip_zt = "10.216.124.99"

# 3. Diagnóstico → ZeroTier → Detectar Teltonika
#    confirma el modelo del router

# 4. Diagnóstico → ZeroTier → Escanear LAN del sitio
#    click "Importar" en cada UPS detectado
```

---

## 3. Agregar un UPS individual

### Con auto-detección

1. **Inventario → NUEVO UPS**.
2. Captura la IP, click **"Auto-detectar"**.
3. El portal hace ping + SNMP get a OIDs conocidos para inferir:
   protocolo (snmp/modbus), tipo (`megatec_snmp`, `ups_mib_standard`, ...),
   fases, versión SNMP, community.
4. Ajusta el sitio si es necesario. **Crear**.

### Manual

Captura todos los campos en el modal:
- **Protocolo**: SNMP o Modbus TCP.
- Para SNMP: `snmp_port`, `snmp_community`, `snmp_version`
  (`SNMPv1`=0, `SNMPv2c`=1), `ups_type` (ver tabla abajo).
- Para Modbus: `modbus_port` (502), `modbus_unit_id` (1).

| `ups_type` | Cuándo usar |
|---|---|
| `invt_enterprise` | UPS INVT industriales con OIDs .56788 |
| `invt_minimal` | INVT con SNMP limitado |
| `megatec_snmp` | UPS con OIDs Megatec/Voltronic .935 |
| `ups_mib_standard` | UPS-MIB RFC 1628 (monofásico/trifásico) |
| `hybrid` | Combinación UPS-MIB + INVT |

---

## 4. Mapeo OID custom (Banco SNMP)

Útil para UPS no estándar o cuando quieres exponer métricas adicionales.

1. **Inventario → fila del UPS → ícono lista** (Banco SNMP / OID).
2. En el modal:
   - **Paso 1**: elige la rama OID (`UPS-MIB`, `Megatec`, `INVT`, o custom)
     y click **Walk**. Aparecen hasta 100 OIDs con su valor crudo.
   - **Paso 2**: click "+" en cada OID útil para agregarlo al perfil.
     Asigna `variable_name` (standard del frontend o custom), `factor`
     (e.g. 0.1 si vienen en decivolts) y `unit` (`V`, `A`, `%`).
   - Click **Probar** en cada fila para validar el factor en vivo.
3. **Guardar perfil**. A partir del siguiente ciclo, el
   `MonitoringService` usa este perfil custom **en lugar de** los OIDs
   integrados del cliente.

---

## 5. Grabaciones SCADA

### Iniciar una grabación

1. **Grabaciones → NUEVA GRABACIÓN**.
2. Selecciona el UPS y opcionalmente un nombre.
3. **Iniciar**. La grabación captura todas las muestras a partir del
   próximo ciclo de polling (~2 s).

> Solo puede haber **una grabación activa por UPS** al mismo tiempo.

### Detener y exportar

1. **Grabaciones → fila → ícono detener** cuando termines.
2. Para descargar como CSV: ícono **descarga**.
3. Para ver el chart inline: ícono **gráfica**.

### Eliminar

- Solo grabaciones terminadas. Confirmación requerida.

---

## 6. Gestión de usuarios (admin)

Ver [`USERS.md`](USERS.md) para detalle. Resumen:

```
Header → menú de usuario → "Cambiar contraseña"   (todos los usuarios)
Header → "Admin" → tabla de usuarios              (solo rol = admin)
        → "NUEVO USUARIO"                          crear
        → fila → ícono editar                      cambiar rol/permisos
        → fila → restablecer contraseña            (sub-tab del modal)
        → fila → ícono basura                      eliminar
```

---

## 7. Diagnóstico y troubleshooting

### Un UPS aparece offline

1. **Diagnóstico → Ping ICMP** a la IP del UPS. Si falla → problema de
   red (Teltonika caído, ZeroTier desconectado).
2. Si ping OK → **Diagnóstico → SNMP test** con la community correcta.
   Si timeout → SNMP no habilitado en el UPS o community incorrecta.
3. Para SNMP no estándar → **Auto-detectar SNMP** para ver qué versión
   + community responde.

### Toda una sucursal cayó

1. **Diagnóstico → ZeroTier → Peers**. Busca el address del Teltonika
   remoto. Si está `latency: null` o muy alta → la WAN del sitio
   está caída o el Teltonika no se autenticó con ZT.
2. **Diagnóstico → Estado del nodo**. Si el portal está `online: false`
   → revisa la conectividad del host del portal.
3. **Diagnóstico → Ping a todos los routers**. Tabla por sitio.

### El SCADA no actualiza valores

1. Consola del navegador (F12). Errores en `socket.io`?
2. Verificar que `/socket.io/` responde 200:
   ```bash
   curl -I -b $COOKIE "http://127.0.0.1:5005/socket.io/?EIO=4&transport=polling"
   ```
3. `make logs` y busca emits: deberías ver "MonitoringService" cada 2 s.

### Logs

```bash
make logs                                    # portal en vivo
docker compose logs portal --since=1h        # última hora
docker compose logs portal | grep ERROR      # solo errores
docker compose logs portal | grep <ip_ups>   # filtrar por UPS
```

---

## 8. Backup y restore

### Backup manual (Postgres)

```bash
./scripts/backup_db.sh
# Crea backups/lbs_YYYYMMDD_HHMMSS.sql.gz
```

### Restore

```bash
gunzip -c backups/lbs_20260514_120000.sql.gz | \
  docker compose exec -T db psql -U guia_app -d guia_instalacion
```

### Recomendación

Programa un cron en el host:

```cron
0 3 * * * cd /opt/MonitoreoLBS && ./scripts/backup_db.sh
0 4 * * 0 find /opt/MonitoreoLBS/backups -name '*.sql.gz' -mtime +30 -delete
```

---

## 9. Mantenimiento

### Aplicar migraciones nuevas

Si añades un `migrations/00X_loquesea.sql`:

```bash
# Opción A: rebuild + restart (aplica al arrancar)
make rebuild

# Opción B: aplicar sin reiniciar
make migrate
```

### Limpiar datos viejos manualmente

```bash
docker compose exec db psql -U guia_app -d guia_instalacion -c \
  "DELETE FROM ups_metrics WHERE ts < NOW() - INTERVAL '30 days'"
```

(El APScheduler ya lo hace cada hora automáticamente, esto es por si
quieres adelantar.)

### Cambiar retención

Edita `.env`:

```
HISTORY_RETENTION_DAYS=60
METRICS_RETENTION_DAYS=180
```

Reinicia: `make restart`.

---

## 10. Escalado

### De 50 a 150 UPS

Defaults (`.env.example`) ya están afinados. Sólo verifica:

```
MODBUS_POLL_WORKERS=32
METRICS_SAMPLE_INTERVAL_S=30
DB_POOL_MAX=20
```

Y en `postgresql.conf`:

```
max_connections = 40
shared_buffers = 256MB
```

### De 150 a 200 UPS

```
MODBUS_POLL_WORKERS=48
DB_POOL_MAX=24
```

### Más de 300 UPS

- Considerar **TimescaleDB**:
  ```sql
  CREATE EXTENSION timescaledb;
  SELECT create_hypertable('ups_metrics', 'ts');
  ```
- O particionar manualmente:
  ```sql
  -- Crear ups_metrics_v2 PARTITION BY RANGE (ts), migrar datos, swap
  ```
- Aumentar `METRICS_SAMPLE_INTERVAL_S=60` para reducir cardinalidad.

---

## 11. Comandos de emergencia

| Situación | Comando |
|---|---|
| Portal congelado | `make restart` |
| Portal OK pero Postgres mal | `docker compose restart db && make restart` |
| Limpiar todo (¡pierde datos!) | `make nuke && make up` |
| Reset password admin | `docker compose exec db psql -U guia_app -d guia_instalacion -c "DELETE FROM users WHERE username='admin'"; make restart` → relee `ADMIN_PASSWORD` del `.env` |
| Volver a una migración | borrar fila en `schema_migrations` + restart |
| Ver qué UPS está polleando | `make logs \| grep "10.x.x.x"` |
