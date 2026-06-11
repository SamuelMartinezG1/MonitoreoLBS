# -*- coding: utf-8 -*-
"""
Alarmas de CALIDAD DE ENERGÍA en tiempo real.

Complementa las alarmas de umbral duro (INPUT_V_LOW/HIGH, OVERLOAD…) con
indicadores de calidad que ayudan a monitorear la red y el UPS:

  * INPUT_SAG / INPUT_SWELL  — caída / subida sostenida de la tensión de
    entrada respecto al nominal inferido (zona de advertencia más temprana
    que los límites duros).
  * PHASE_IMBALANCE_IN/OUT   — desbalanceo entre fases L1/L2/L3 (solo equipos
    trifásicos).
  * FREQ_DEV_IN / FREQ_DEV_OUT — desviación de la frecuencia respecto a 60 Hz.

Funciones puras: reciben el `mapped_data` del monitor (mismos nombres que ya
produce el SNMP/Modbus) y devuelven alarmas con el formato
`{level, code, msg}` que consume `tracker.report_alarms` (latch + persistencia
ALARM_ON/OFF). Umbrales configurables por entorno.
"""
import os

NOMINAL_FREQ   = float(os.environ.get('PQ_NOMINAL_FREQ', 60.0))
SAG_RATIO      = float(os.environ.get('PQ_SAG_RATIO', 0.90))    # < 90% nominal
SWELL_RATIO    = float(os.environ.get('PQ_SWELL_RATIO', 1.10))  # > 110% nominal
IMBALANCE_WARN = float(os.environ.get('PQ_IMBALANCE_WARN', 0.05))   # 5%
IMBALANCE_CRIT = float(os.environ.get('PQ_IMBALANCE_CRIT', 0.10))   # 10%
FREQ_DEV_WARN  = float(os.environ.get('PQ_FREQ_DEV_WARN', 0.5))   # Hz
FREQ_DEV_CRIT  = float(os.environ.get('PQ_FREQ_DEV_CRIT', 1.5))   # Hz


def _num(v):
    try:
        f = float(v)
        return f if f == f else None  # descarta NaN
    except (TypeError, ValueError):
        return None


def _nominal_voltage(v):
    """Nominal inferido del sistema a partir de una lectura (120/127 vs 220/230)."""
    if v is None or v <= 0:
        return None
    return 120.0 if v < 160 else 220.0


def _imbalance(vals):
    """Máximo desbalanceo relativo entre fases: max(|vx-prom|)/prom.
    Ignora fases sin lectura (None/0). Devuelve None si hay < 2 fases."""
    fases = [x for x in (_num(v) for v in vals) if x and x > 0]
    if len(fases) < 2:
        return None
    prom = sum(fases) / len(fases)
    if prom <= 0:
        return None
    return max(abs(x - prom) for x in fases) / prom


def check_power_quality(mapped: dict, caps: dict | None = None) -> list:
    """Lista de alarmas de calidad de energía para una lectura."""
    alarms = []
    phases = (caps or {}).get('phases', mapped.get('phases', 1)) or 1

    # ── Sag / swell de entrada (sobre L1) ──────────────────────────────────
    vin = _num(mapped.get('voltaje_in_l1'))
    nominal = _nominal_voltage(vin)
    if vin is not None and nominal:
        if vin < SAG_RATIO * nominal:
            alarms.append({'level': 'warning', 'code': 'INPUT_SAG',
                           'msg': f'Caída de tensión de entrada: {vin:.1f}V '
                                  f'({100*vin/nominal:.0f}% del nominal {nominal:.0f}V)'})
        elif vin > SWELL_RATIO * nominal:
            alarms.append({'level': 'warning', 'code': 'INPUT_SWELL',
                           'msg': f'Sobretensión de entrada: {vin:.1f}V '
                                  f'({100*vin/nominal:.0f}% del nominal {nominal:.0f}V)'})

    # ── Desbalanceo de fases (solo trifásico) ──────────────────────────────
    if phases == 3:
        for etiqueta, code, llaves in (
            ('entrada', 'PHASE_IMBALANCE_IN',
             ('voltaje_in_l1', 'voltaje_in_l2', 'voltaje_in_l3')),
            ('salida',  'PHASE_IMBALANCE_OUT',
             ('voltaje_out_l1', 'voltaje_out_l2', 'voltaje_out_l3')),
        ):
            imb = _imbalance([mapped.get(k) for k in llaves])
            if imb is None:
                continue
            if imb > IMBALANCE_CRIT:
                alarms.append({'level': 'critical', 'code': code,
                               'msg': f'Desbalanceo de fases en {etiqueta}: {100*imb:.1f}%'})
            elif imb > IMBALANCE_WARN:
                alarms.append({'level': 'warning', 'code': code,
                               'msg': f'Desbalanceo de fases en {etiqueta}: {100*imb:.1f}%'})

    # ── Desviación de frecuencia ───────────────────────────────────────────
    for etiqueta, code, llave in (
        ('entrada', 'FREQ_DEV_IN',  'frecuencia_in'),
        ('salida',  'FREQ_DEV_OUT', 'frecuencia_out'),
    ):
        f = _num(mapped.get(llave))
        if f is None or f <= 0:
            continue
        dev = abs(f - NOMINAL_FREQ)
        if dev > FREQ_DEV_CRIT:
            alarms.append({'level': 'critical', 'code': code,
                           'msg': f'Frecuencia de {etiqueta} fuera de rango: {f:.2f}Hz'})
        elif dev > FREQ_DEV_WARN:
            alarms.append({'level': 'warning', 'code': code,
                           'msg': f'Desviación de frecuencia en {etiqueta}: {f:.2f}Hz'})

    return alarms
