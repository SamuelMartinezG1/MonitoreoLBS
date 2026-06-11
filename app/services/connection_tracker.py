# -*- coding: utf-8 -*-
"""
ConnectionTracker — estado de conexión confirmado por dispositivo.

Centraliza lo que antes era un `status='offline'` efímero por ciclo:

  * Histéresis: offline confirmado tras N fallos consecutivos y online tras
    M éxitos (el enlace SIM/ZeroTier del sitio produce blips de segundos que
    no son una desconexión real). Mientras un fallo no se confirma, el
    dispositivo sigue 'online' con link_quality='degraded'.
  * Persistencia: cada transición confirmada se inserta en `ups_event_log`
    con fuente='Portal' y un `code` máquina-a-máquina (CONN_LOST,
    CONN_RESTORED, DISCHARGE_START/END, ALARM_ON/OFF), de modo que /eventos
    y el panel de estado las muestran con fecha y causa.
  * Descargas: detecta transiciones a modo batería (debounce de 2 muestras)
    y lleva el contador total — los UPS de la maqueta no exponen ciclos.
  * Seed: al arrancar consulta el último evento portal por dispositivo para
    no re-emitir CONN_LOST tras un reinicio del contenedor y conservar el
    "sin conexión desde …" original.

Lo comparten el hilo asyncio SNMP y los workers del ThreadPool Modbus:
el dict de estado se protege con un Lock y los INSERT a BD se hacen fuera
del lock (el pool psycopg en autocommit es thread-safe).
"""
import os
import threading
import logging
from datetime import datetime, timezone

from app.base_datos import GestorDB
from app.services import poll_errors

logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc)


def _fmt_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f'{seconds}s'
    minutes, secs = divmod(seconds, 60)
    if minutes < 60:
        return f'{minutes}m {secs}s'
    hours, mins = divmod(minutes, 60)
    return f'{hours}h {mins}m'


class ConnectionTracker:
    def __init__(self, db=None):
        self._lock = threading.Lock()
        self._devices: dict[int, dict] = {}
        self._db = db or GestorDB()
        self._offline_confirm = int(os.environ.get('OFFLINE_CONFIRM_FAILS', 3))
        self._online_confirm  = int(os.environ.get('ONLINE_CONFIRM_OKS', 2))
        self._alarm_on_cycles  = int(os.environ.get('ALARM_CONFIRM_CYCLES', 3))
        self._alarm_off_cycles = int(os.environ.get('ALARM_CLEAR_CYCLES', 5))
        self._discharge_confirm = int(os.environ.get('DISCHARGE_CONFIRM_SAMPLES', 2))
        # Salud de batería: avisar si la autonomía de arranque cae por debajo de
        # este ratio del promedio de descargas previas (0.70 = 30% peor).
        self._battery_health_ratio = float(os.environ.get('BATTERY_HEALTH_RATIO', 0.70))

    # ------------------------------------------------------------------ #
    # Estado interno                                                      #
    # ------------------------------------------------------------------ #
    def _blank_state(self) -> dict:
        return {
            'status': 'unknown', 'since': None,
            'reason': None, 'detail': '',
            'fail_count': 0, 'ok_count': 0,
            'on_battery': False, 'battery_since': None,
            'battery_pending': 0,
            'alarm_latch': {},          # code -> {active,on,off,level,msg}
            'discharge_count': 0,
            'discharge_runtimes': [],   # autonomías de arranque (salud batería)
        }

    def _ensure(self, dev_id: int) -> dict:
        """Devuelve el estado del device, sembrándolo desde BD la 1.ª vez."""
        with self._lock:
            st = self._devices.get(dev_id)
        if st is not None:
            return st

        seeded = self._blank_state()
        try:
            last_conn = self._db.obtener_ultimo_evento_portal(
                dev_id, ('CONN_LOST', 'CONN_RESTORED'))
            if last_conn and last_conn.get('code') == 'CONN_LOST':
                seeded['status'] = 'offline'
                seeded['since'] = last_conn.get('ts') or _now()
                raw = last_conn.get('raw') or ''
                code, _, detail = raw.partition(': ')
                if code in poll_errors.REASON_LABELS:
                    seeded['reason'] = code
                    seeded['detail'] = detail
                seeded['fail_count'] = self._offline_confirm

            last_dis = self._db.obtener_ultimo_evento_portal(
                dev_id, ('DISCHARGE_START', 'DISCHARGE_END'))
            if last_dis and last_dis.get('code') == 'DISCHARGE_START':
                seeded['on_battery'] = True
                seeded['battery_since'] = last_dis.get('ts') or _now()

            seeded['discharge_count'] = self._db.contar_descargas_portal(dev_id)
        except Exception as e:
            logger.debug("seed tracker dev %s: %s", dev_id, e)

        with self._lock:
            # Otro hilo pudo sembrarlo mientras consultábamos: el suyo gana.
            return self._devices.setdefault(dev_id, seeded)

    def _persist(self, dev_id, name, code, evento, nivel, raw=None, ts=None):
        try:
            self._db.insertar_evento_portal(
                dev_id, code, evento, nivel=nivel, raw=raw, ts=ts)
        except Exception as e:
            logger.error("evento portal %s/%s: %s", name, code, e)

    # ------------------------------------------------------------------ #
    # API pública (thread-safe)                                           #
    # ------------------------------------------------------------------ #
    def report_success(self, dev_id: int, name: str) -> dict:
        st = self._ensure(dev_id)
        event = None
        with self._lock:
            st['fail_count'] = 0
            st['ok_count'] += 1
            if st['status'] == 'offline':
                if st['ok_count'] >= self._online_confirm:
                    downtime = ''
                    if st['since']:
                        downtime = _fmt_duration(
                            (_now() - st['since']).total_seconds())
                    event = ('CONN_RESTORED',
                             f'Conexión restablecida'
                             + (f' (estuvo {downtime} sin conexión)' if downtime else ''),
                             'info', None)
                    st.update(status='online', since=_now(),
                              reason=None, detail='')
            elif st['status'] == 'unknown':
                # Primer poll exitoso tras arrancar: online sin evento.
                st.update(status='online', since=_now(), reason=None, detail='')
            public = self._public_state(st)
        if event:
            self._persist(dev_id, name, event[0], event[1], event[2], event[3])
            logger.info("UPS %s reconectado", name)
        return public

    def report_failure(self, dev_id: int, name: str, code: str, detail: str = '') -> dict:
        st = self._ensure(dev_id)
        event = None
        with self._lock:
            st['ok_count'] = 0
            st['fail_count'] += 1
            if st['status'] == 'offline':
                # Sigue caído: actualizar causa si cambió (p.ej. TIMEOUT →
                # HOST_UNREACHABLE) sin re-emitir evento ni mover `since`.
                st['reason'] = code
                st['detail'] = detail
            elif st['fail_count'] >= self._offline_confirm:
                label = poll_errors.reason_label(code)
                event = ('CONN_LOST',
                         f'Conexión perdida — {label}',
                         'critical', f'{code}: {detail}')
                st.update(status='offline', since=_now(),
                          reason=code, detail=detail)
            else:
                # Aún sin confirmar: conservar la causa para mostrar "degraded"
                st['reason'] = code
                st['detail'] = detail
            public = self._public_state(st)
        if event:
            self._persist(dev_id, name, event[0], event[1], event[2], event[3])
            logger.warning("UPS %s sin conexión: %s (%s)", name, code, detail)
        return public

    def report_power_state(self, dev_id: int, name: str, on_battery: bool,
                           runtime_min=None):
        """Detección de descargas con debounce de N muestras consecutivas.
        `runtime_min` (autonomía estimada al iniciar la descarga) alimenta la
        tendencia de SALUD de batería: si cae respecto a descargas previas,
        emite un evento BATTERY_HEALTH."""
        st = self._ensure(dev_id)
        events = []
        with self._lock:
            if on_battery == st['on_battery']:
                st['battery_pending'] = 0
            else:
                st['battery_pending'] += 1
                if st['battery_pending'] >= self._discharge_confirm:
                    st['battery_pending'] = 0
                    st['on_battery'] = on_battery
                    if on_battery:
                        st['battery_since'] = _now()
                        st['discharge_count'] += 1
                        events.append(('DISCHARGE_START',
                                       'Descarga de batería iniciada — UPS operando en batería',
                                       'warning', None))
                        # Tendencia de salud: comparar la autonomía de arranque
                        # con el promedio de descargas previas.
                        try:
                            rt = float(runtime_min) if runtime_min is not None else None
                        except (TypeError, ValueError):
                            rt = None
                        if rt is not None and rt > 0:
                            prev = st['discharge_runtimes']
                            if len(prev) >= 2:
                                avg = sum(prev) / len(prev)
                                if avg > 0 and rt < self._battery_health_ratio * avg:
                                    events.append((
                                        'BATTERY_HEALTH',
                                        f'Salud de batería: autonomía de arranque '
                                        f'{rt:.0f} min, {100*rt/avg:.0f}% del promedio '
                                        f'previo ({avg:.0f} min) — posible degradación',
                                        'warning',
                                        f'runtime={rt};avg={avg:.1f}'))
                            prev.append(rt)
                            del prev[:-10]  # conservar las últimas 10
                    else:
                        dur = ''
                        if st['battery_since']:
                            dur = _fmt_duration(
                                (_now() - st['battery_since']).total_seconds())
                        st['battery_since'] = None
                        events.append(('DISCHARGE_END',
                                       'Descarga de batería finalizada'
                                       + (f' (duración {dur})' if dur else ''),
                                       'info', None))
        for ev in events:
            self._persist(dev_id, name, ev[0], ev[1], ev[2], ev[3])
            logger.warning("UPS %s: %s", name, ev[1])

    def report_alarms(self, dev_id: int, name: str, alarms: list):
        """Latch de alarmas de umbral: ALARM_ON tras N ciclos consecutivos,
        ALARM_OFF tras M ciclos limpios. Llamar SOLO con poll exitoso."""
        st = self._ensure(dev_id)
        events = []
        current = {a['code']: a for a in (alarms or []) if a.get('code')}
        with self._lock:
            latch = st['alarm_latch']
            for code, alarm in current.items():
                entry = latch.setdefault(
                    code, {'active': False, 'on': 0, 'off': 0,
                           'level': alarm.get('level', 'warning'), 'msg': ''})
                entry['on'] += 1
                entry['off'] = 0
                entry['level'] = alarm.get('level', entry['level'])
                entry['msg'] = alarm.get('msg', '')
                if not entry['active'] and entry['on'] >= self._alarm_on_cycles:
                    entry['active'] = True
                    events.append(('ALARM_ON',
                                   f"Alarma activada: {code} — {entry['msg']}",
                                   entry['level'], None))
            for code, entry in list(latch.items()):
                if code in current:
                    continue
                entry['on'] = 0
                entry['off'] += 1
                if entry['active'] and entry['off'] >= self._alarm_off_cycles:
                    entry['active'] = False
                    events.append(('ALARM_OFF',
                                   f'Alarma liberada: {code}',
                                   'info', None))
                if not entry['active'] and entry['off'] > self._alarm_off_cycles:
                    latch.pop(code, None)
        for ev in events:
            self._persist(dev_id, name, ev[0], ev[1], ev[2], ev[3])

    # ------------------------------------------------------------------ #
    # Lectura                                                             #
    # ------------------------------------------------------------------ #
    def _public_state(self, st: dict) -> dict:
        """Estado embebible en ups_update / APIs. Llamar con el lock tomado
        (o sobre un dict ya consistente)."""
        offline = st['status'] == 'offline'
        degraded = st['status'] == 'online' and st['fail_count'] > 0
        return {
            'status': st['status'],
            'since': st['since'].isoformat() if st['since'] else None,
            'offline_reason': st['reason'] if (offline or degraded) else None,
            'offline_reason_label': poll_errors.reason_label(st['reason'])
                                    if (offline or degraded) and st['reason'] else None,
            'offline_since': st['since'].isoformat() if offline and st['since'] else None,
            'last_error': st['detail'] or None,
            'link_quality': 'degraded' if degraded else 'ok',
            'on_battery': st['on_battery'],
        }

    def get_state(self, dev_id: int) -> dict:
        st = self._ensure(dev_id)
        with self._lock:
            return self._public_state(st)

    def get_discharge_count(self, dev_id: int) -> int:
        st = self._ensure(dev_id)
        with self._lock:
            return st['discharge_count']

    def get_active_alarms(self, dev_id: int) -> list:
        st = self._ensure(dev_id)
        with self._lock:
            return [
                {'code': code, 'level': e['level'], 'msg': e['msg']}
                for code, e in st['alarm_latch'].items() if e['active']
            ]

    def get_fleet_state(self) -> dict:
        with self._lock:
            ids = list(self._devices.keys())
        return {dev_id: self.get_state(dev_id) for dev_id in ids}


# Singleton compartido por los dos monitores y las rutas Flask.
tracker = ConnectionTracker()
