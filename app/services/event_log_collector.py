"""
Colector del LOG DE EVENTOS NATIVO del UPS.

A diferencia de las alarmas que el portal calcula por umbral (`_check_snmp_alarms`),
esto trae el **historial de eventos que el propio UPS registra** (cortes de red,
descargas, bypass, EOD, batería baja, etc.).

Fuentes soportadas (columna `monitoreo_config.event_source`):

  * 'php_almhistory' → tarjeta web PHP (UPS trifásico). Login en /views/login.php y
                       paginado de POST /action/alm_history_act.php.
  * 'netagent_xml'   → tarjeta NetAgent/Megatec. GET /EventLog.xml.

El colector corre fuera del loop de polling rápido (lo dispara APScheduler cada N
minutos, o el endpoint /api/monitoreo/eventos/<id>/refresh bajo demanda). Depende de
que el host alcance la IP del UPS (ZeroTier). Si no hay alcance, falla en silencio y
no rompe nada.
"""
import re
import html as _html
import logging
import datetime as _dt

import requests

logger = logging.getLogger(__name__)

# Palabras clave → nivel de severidad.
_CRIT = ('eod', 'fault', 'overload', 'short', 'volt low', 'batt low',
         'battery low', 'battery is low', 'depleted', 'shutdown', 'emergency',
         'over temp', 'overtemp', 'power fail', 'utility fail', 'ac fail',
         'on battery')
_WARN = ('bypass', 'discharg', 'power off', 'no load', 'test fail',
         'communication lost', 'comm lost', 'warning', 'abnor', 'fail', 'freq')


def classify_level(evento: str, css_class: str = '') -> str:
    """Deriva info|warning|critical del texto del evento (y la clase CSS si la hay)."""
    c = (css_class or '').lower()
    if 'red' in c:
        return 'critical'
    if 'yellow' in c or 'orange' in c:
        return 'warning'
    e = (evento or '').lower()
    if any(k in e for k in _CRIT):
        return 'critical'
    if any(k in e for k in _WARN):
        return 'warning'
    return 'info'


def _parse_dt(s: str):
    """Parsea fechas tipo '2016/11/17 12:44:26' o '2026-06-04 18:41:37'."""
    s = (s or '').strip()
    for fmt in ('%Y/%m/%d %H:%M:%S', '%Y-%m-%d %H:%M:%S',
                '%Y/%m/%d %H:%M', '%d/%m/%Y %H:%M:%S'):
        try:
            return _dt.datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _parse_rfc822(s: str):
    """Parsea el <pubDate> RFC-822 del feed RSS ('Wed, 25 Feb 2026 19:16:57 +0000').
    Devuelve datetime naive (descartamos tz: el UPS reporta su hora local como +0000)."""
    s = (s or '').strip()
    for fmt in ('%a, %d %b %Y %H:%M:%S %z', '%a, %d %b %Y %H:%M:%S'):
        try:
            return _dt.datetime.strptime(s, fmt).replace(tzinfo=None)
        except ValueError:
            continue
    return None


# --------------------------------------------------------------------------- #
# Fuente: tarjeta PHP (alm_history)                                            #
# --------------------------------------------------------------------------- #
def collect_php_almhistory(ip, port=80, user='admin', password='', max_pages=60,
                           timeout=8):
    """Login + paginado del History Record de la tarjeta web PHP. Devuelve lista
    de dicts {ts, fuente, evento, nivel, raw}."""
    base = f"http://{ip}:{port}"
    s = requests.Session()
    s.get(f"{base}/views/login.php", timeout=timeout)
    s.post(f"{base}/views/login.php",
           data={'usern': user, 'psw': password, 'subBt': 'Login'},
           timeout=timeout)

    row_re = re.compile(r'<tr[^>]*class="([^"]*)"[^>]*>(.*?)</tr>', re.S | re.I)
    td_re = re.compile(r'<td>(.*?)</td>', re.S | re.I)
    out, seen = [], set()
    for pg in range(1, max_pages + 1):
        r = s.post(f"{base}/action/alm_history_act.php",
                   data={'mode': 'page', 'cpg': pg, 'inf': ''},
                   headers={'X-Requested-With': 'XMLHttpRequest'}, timeout=timeout)
        try:
            tbl = r.json().get('almTbl', '')
        except Exception:
            break
        if not tbl:
            break
        page_rows = 0
        for css, body in row_re.findall(tbl):
            tds = [re.sub(r'<[^>]*>', '', c).replace('&nbsp;', ' ').strip()
                   for c in td_re.findall(body)]
            if len(tds) < 4:
                continue
            fuente, evento, fecha = tds[1], tds[2], tds[3]
            key = (fecha, evento)
            if key in seen:
                continue
            seen.add(key)
            page_rows += 1
            out.append({
                'ts': _parse_dt(fecha),
                'fuente': fuente,
                'evento': evento,
                'nivel': classify_level(evento, css),
                'raw': ' | '.join(tds),
            })
        if page_rows == 0:
            break
    return out


# --------------------------------------------------------------------------- #
# Fuente: NetAgent / Megatec (EventLog.xml)                                    #
# --------------------------------------------------------------------------- #
_NA_DT   = re.compile(r'Date\s*/?\s*Time\s*:\s*'
                      r'(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)', re.I)
_NA_STAT = re.compile(r'Status\s*:\s*(.+)', re.I | re.S)
_NA_META = re.compile(r'^\s*(?:Date\s*/?\s*Time|IP|System\s*(?:Name|Contact|Location))'
                      r'\s*:', re.I)


def collect_netagent_xml(ip, port=80, timeout=8, **_):
    """Descarga y parsea /EventLog.xml de una tarjeta NetAgent/Megatec.

    El feed es RSS 2.0; cada <item> trae un <description> con campos separados
    por <br> (HTML-escapados como &lt;br&gt;):

        Date/Time: 2026/02/25 19:16:57<br>IP: 192.168.4.10 <br>System Name: ...
        <br>System Location: My Office <br>Status:  The UPS is entering Bypass Mode.

    y un <pubDate> RFC-822 que usamos como respaldo de la fecha.
    Devuelve lista de dicts {ts, fuente, evento, nivel, raw}.
    """
    base = f"http://{ip}:{port}"
    r = requests.get(f"{base}/EventLog.xml", timeout=timeout)
    text = r.text
    out = []
    for block in re.findall(r'<item\b[^>]*>(.*?)</item>', text, re.S | re.I):
        dm = re.search(r'<description>(.*?)</description>', block, re.S | re.I)
        if not dm:
            continue
        desc = _html.unescape(dm.group(1)).strip()
        # Separar campos por <br>; el último suele ser "Status: <evento>".
        campos = [c.strip() for c in re.split(r'<br\s*/?>', desc, flags=re.I) if c.strip()]
        joined = ' | '.join(campos)

        # Fecha: del propio texto (Date/Time); si no, del <pubDate>.
        ts = None
        mdt = _NA_DT.search(desc)
        if mdt:
            ts = _parse_dt(mdt.group(1))
        if ts is None:
            pm = re.search(r'<pubDate>(.*?)</pubDate>', block, re.S | re.I)
            if pm:
                ts = _parse_rfc822(pm.group(1))

        # Evento: el campo Status; si no, la última línea que no sea metadata.
        evento = ''
        for c in reversed(campos):
            ms = _NA_STAT.search(c)
            if ms:
                evento = ms.group(1).strip()
                break
            if not _NA_META.match(c):
                evento = c
                break
        if not evento:
            continue

        out.append({
            'ts': ts,
            'fuente': 'NetAgent',
            'evento': evento,
            'nivel': classify_level(evento),
            'raw': joined,
        })
    return out


_FETCHERS = {
    'php_almhistory': collect_php_almhistory,
    'netagent_xml':   collect_netagent_xml,
}


def collect_device(dev: dict):
    """Colecta eventos de un dispositivo de monitoreo_config. `dev` debe traer
    ip, event_source y (para PHP) web_user/web_pass/web_port."""
    src = (dev.get('event_source') or '').strip()
    fetcher = _FETCHERS.get(src)
    if not fetcher:
        return []
    try:
        return fetcher(
            dev['ip'],
            port=int(dev.get('web_port') or 80),
            user=dev.get('web_user') or 'admin',
            password=dev.get('web_pass') or '',
        )
    except requests.RequestException as e:
        logger.info("event_log_collector: %s sin alcance (%s)", dev.get('ip'), e)
        return []
    except Exception as e:
        logger.warning("event_log_collector %s: %s", dev.get('ip'), e)
        return []


def collect_all(db):
    """Recorre los UPS con event_source y persiste sus eventos (dedupe en BD).
    Devuelve {device_id: nº insertados}."""
    res = {}
    try:
        devices = db.obtener_monitoreo_ups()
    except Exception as e:
        logger.error("event_log_collector: obtener dispositivos: %s", e)
        return res
    for dev in devices:
        if not (dev.get('event_source') or '').strip():
            continue
        eventos = collect_device(dev)
        if eventos:
            n = db.insertar_eventos_ups(dev['id'], eventos)
            res[dev['id']] = n
            logger.info("event_log_collector: %s +%d eventos", dev.get('ip'), n)
    return res
