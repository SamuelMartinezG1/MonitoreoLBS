# Integración ZeroTier

MonitoreoLBS gestiona ZeroTier (red overlay que conecta el portal con las
oficinas remotas a través de los routers Teltonika) desde la pantalla de
**Diagnóstico → ZeroTier**. Esta guía explica el setup en Ubuntu Server.

---

## 1. Instalar ZeroTier en el host

```bash
curl -s https://install.zerotier.com | sudo bash
```

Verificar:

```bash
systemctl status zerotier-one
zerotier-cli info        # debería imprimir el node ID local
```

---

## 2. Habilitar acceso del portal al daemon

El contenedor del portal corre como un usuario sin privilegios (uid 1000),
por lo que **no puede** leer `/var/lib/zerotier-one/authtoken.secret`
directamente. Hay que exponerlo en una ruta legible:

```bash
sudo /opt/MonitoreoLBS/scripts/setup_zerotier.sh
```

El script:

1. Verifica que `zerotier-one` esté corriendo.
2. Copia el authtoken a `/etc/lbs/zerotier-token` con permisos `0644`.
3. Imprime tu node ID local + las networks actualmente unidas.

`docker-compose.yml` ya monta `/etc/lbs/zerotier-token` (read-only) al
contenedor. No hay que tocar nada más.

---

## 3. Re-iniciar el portal

```bash
docker compose up -d portal
```

Verificar:

```bash
curl -s -b $COOKIE http://127.0.0.1:5005/api/zerotier/health
# {"available": true, "api_url": "http://127.0.0.1:9993"}
```

---

## 4. Operación desde el portal

Diagnóstico → **ZeroTier** ofrece:

| Acción | Detalle |
|---|---|
| **Estado del nodo** | node ID, versión, online/offline, planet world |
| **Mis networks** | tabla con cada network unida (id, nombre, IPs asignadas, rutas, estado). Botón **Salir** por red. |
| **Unirse** | input para pegar un network ID nuevo. El portal hace `POST /network/<id>` al daemon. Después necesitas **autorizar** este nodo en https://my.zerotier.com/network/<id>. |
| **Peers** | otros nodos que el cliente local conoce (incluye los Teltonika remotos cuando estén UP). |
| **Escanear red ZT** | dada una network, recorre su /24 con ping + SNMP-get a `sysDescr` para identificar cada host alcanzable. |
| **Detectar Teltonika** | misma idea pero filtra hosts cuyo `sysDescr` matchea `Teltonika / RutOS / RUT955 / RUT956 / RUT951`. |
| **Escanear LAN del sitio** | dado un sitio con `subred_lan` configurada, recorre su /24 detrás del Teltonika. Marca cuáles IPs ya están registradas en `monitoreo_config`. Las no registradas se pueden importar a la flota. |

---

## 5. Workflow típico: agregar un sitio nuevo

1. **En el host**: `sudo zerotier-cli join <network_id>` (o desde el portal).
2. **En my.zerotier.com**: autorizar el nodo Teltonika (router del sitio).
3. **Portal → Inventario → NUEVO SITIO**: registrar el sitio con
   `numero_sitio`, `nombre`, `subred_lan` (la /24 detrás del Teltonika),
   `router_ip_zt` (la IP del Teltonika dentro de la network ZT).
4. **Portal → Diagnóstico → ZeroTier → Detectar Teltonika** (sobre la
   network ZT). Confirma que el Teltonika responde y captura su modelo.
5. **Portal → Diagnóstico → ZeroTier → Escanear LAN del sitio**. Encuentra
   los UPS detrás del Teltonika. Marca los no registrados.
6. **Importar UPS** desde el modal del scan, o registrar manualmente vía
   *Inventario → NUEVO UPS* con la IP detectada.
7. El **MonitoringService** empieza a poll-ear el UPS en el próximo ciclo
   (2 s); aparece en el dashboard y SCADA.

---

## 6. Troubleshooting

| Síntoma | Solución |
|---|---|
| `/api/zerotier/health → available: false` | El authtoken no es legible. Re-corre `setup_zerotier.sh` y reinicia el portal. |
| `authtoken inválido (401)` | El token cambió (re-instalación de ZT). Re-corre `setup_zerotier.sh`. |
| `No se pudo conectar al demonio ZeroTier` | `systemctl status zerotier-one` y revisa logs en `journalctl -u zerotier-one`. |
| Network unida pero `status: REQUESTING_CONFIGURATION` | Falta autorización en https://my.zerotier.com. |
| `scan-network` no devuelve hosts | El contenedor necesita `iputils-ping` y conectividad ICMP sobre ZT. Verifica con `docker exec lbs-portal ping <ip-zt-conocida>`. |
| Teltonika no responde SNMP | Habilita SNMP en el RutOS: System → Administration → SNMP → community `public` v2c. |

---

## 7. API HTTP

Los endpoints del portal son **wrappers** de la API local del daemon. Si
necesitas debug bajo nivel:

```bash
TOKEN=$(sudo cat /var/lib/zerotier-one/authtoken.secret)
curl -H "X-ZT1-Auth: $TOKEN" http://127.0.0.1:9993/status
curl -H "X-ZT1-Auth: $TOKEN" http://127.0.0.1:9993/network
curl -H "X-ZT1-Auth: $TOKEN" http://127.0.0.1:9993/peer
```

Endpoints del portal (todos `Content-Type: application/json`):

| Método | Path | Body |
|---|---|---|
| GET   | `/api/zerotier/health` | — |
| GET   | `/api/zerotier/status` | — |
| GET   | `/api/zerotier/networks` | — |
| POST  | `/api/zerotier/join` | `{"network_id": "..."}` |
| POST  | `/api/zerotier/leave` | `{"network_id": "..."}` |
| GET   | `/api/zerotier/peers` | — |
| POST  | `/api/zerotier/scan-network` | `{"network_id": "...", "community": "public"}` |
| POST  | `/api/zerotier/discover-teltonika` | `{"network_id": "...", "community": "public"}` |
| POST  | `/api/zerotier/scan-site-lan` | `{"sitio_id": 1, "community": "public"}` |
