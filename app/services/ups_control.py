# -*- coding: utf-8 -*-
"""
Control SEGURO del UPS desde el portal.

Alcance deliberadamente acotado a acciones de BAJO RIESGO sobre el UPS A
(tarjeta NetAgent/Megatec, vía su formulario web `Control.cgi`):

  * battery_test  — prueba de batería (rápida / N minutos / hasta batería baja)
  * cancel_test   — cancelar una prueba en curso
  * buzzer        — alternar el zumbador (On/Off)

NO se exponen apagado, sleep ni reboot (riesgo operativo). El UPS B (INVT
Modbus) no tiene mapa de control documentado: devuelve no-soportado.

El driver NetAgent reusa el patrón de sesión HTTP de `event_log_collector`:
GET de `Control.htm` para capturar el token CSRF y las cookies, y POST a
`Control.cgi` con el campo `$remote` correspondiente.
"""
import re
import logging

import requests

logger = logging.getLogger(__name__)

# Acciones permitidas (whitelist). Cualquier otra cosa se rechaza.
#   $remote: 0=test 10s, 1=deep test N min, 2=test hasta batería baja,
#            3=cancelar, 8=buzzer on/off.  (4/5/6/7 = apagar/sleep/wake/reboot
#            quedan EXCLUIDOS a propósito.)
_NETAGENT_REMOTE = {
    'battery_test:quick':     ('0', {}),
    'battery_test:until_low': ('2', {}),
    'cancel_test':            ('3', {}),
    'buzzer':                 ('8', {}),
}

_CSRF_RE = re.compile(r'name=\$csrftokenCONTROL\s+value="([^"]*)"', re.I)


class ControlError(Exception):
    pass


class ControlNotSupported(Exception):
    pass


def _netagent_post(ip, port, fields, user='', password='', timeout=10):
    """GET Control.htm (token CSRF + cookies) y POST a Control.cgi."""
    base = f"http://{ip}:{port}"
    s = requests.Session()
    # Algunas tarjetas piden login; si está configurado, intentarlo (no rompe
    # si la tarjeta no tiene auth: el POST de login es ignorado).
    if user:
        try:
            s.post(f"{base}/views/login.php",
                   data={'usern': user, 'psw': password, 'subBt': 'Login'},
                   timeout=timeout)
        except requests.RequestException:
            pass
    r = s.get(f"{base}/Control.htm", timeout=timeout)
    m = _CSRF_RE.search(r.text)
    data = {'$remote': fields['$remote'], 'Submit': 'Apply'}
    if m:
        data['$csrftokenCONTROL'] = m.group(1)
    data.update({k: v for k, v in fields.items() if k != '$remote'})
    resp = s.post(f"{base}/Control.cgi", data=data, timeout=timeout)
    if resp.status_code >= 400:
        raise ControlError(f'La tarjeta respondió HTTP {resp.status_code}')
    return True


def ejecutar_control(dev: dict, action: str, params: dict | None = None) -> dict:
    """Ejecuta una acción de control sobre el dispositivo.

    `dev` es la fila de monitoreo_config. Devuelve {ok, detail} o lanza
    ControlError / ControlNotSupported.
    """
    params = params or {}
    src = (dev.get('event_source') or '').strip()
    # Solo NetAgent (UPS A) soporta control por ahora.
    if src != 'netagent_xml':
        raise ControlNotSupported(
            'Control no disponible para este equipo (requiere tarjeta NetAgent). '
            'El UPS Modbus no tiene mapa de control documentado.')

    ip = dev['ip']
    port = int(dev.get('web_port') or 80)
    user = dev.get('web_user') or ''
    pw = dev.get('web_pass') or ''

    if action == 'battery_test':
        mode = (params.get('mode') or 'quick').lower()
        if mode == 'minutes':
            try:
                minutes = int(params.get('minutes', 10))
            except (TypeError, ValueError):
                minutes = 10
            minutes = max(1, min(99, minutes))
            fields = {'$remote': '1', '$dp_batt_tst_min': str(minutes)}
            detail = f'Prueba de batería de {minutes} min'
        elif mode == 'until_low':
            fields = {'$remote': '2'}
            detail = 'Prueba de batería hasta nivel bajo'
        else:  # quick
            fields = {'$remote': '0'}
            detail = 'Prueba de batería rápida (10 s)'
    elif action == 'cancel_test':
        fields = {'$remote': '3'}
        detail = 'Cancelar prueba de batería'
    elif action == 'buzzer':
        fields = {'$remote': '8'}
        detail = 'Alternar zumbador (On/Off)'
    else:
        raise ControlNotSupported(f'Acción no permitida: {action}')

    try:
        _netagent_post(ip, port, fields, user=user, password=pw)
    except requests.RequestException as e:
        raise ControlError(f'Sin alcance a la tarjeta del UPS: {e}') from e
    return {'ok': True, 'detail': detail}
