from flask import Blueprint, render_template, request, jsonify, current_app, Response, redirect, url_for
from flask_login import login_required
from app.permisos import permiso_requerido, requiere_rol
import requests
import re
import ipaddress
import logging

logger = logging.getLogger(__name__)

monitoreo_bp = Blueprint('monitoreo', __name__)


# NOTE: la vista de /monitoreo ahora la sirve `lbs_bp` con el nuevo diseño.


# Redirect /analytics → /monitoreo
@monitoreo_bp.route('/analytics')
@login_required
def analytics_redirect():
    return redirect(url_for('lbs.monitoreo'))


# =========================================================================
# AUTO-SET: Detección inteligente de UPS
# =========================================================================

@monitoreo_bp.route('/api/autoset/scan', methods=['POST'])
@login_required
@permiso_requerido('scada')
@requiere_rol('admin', 'tecnico')
def autoset_scan():
    """Escanea un dispositivo UPS y auto-detecta sus parámetros."""
    data = request.json
    if not data or 'ip' not in data:
        return jsonify({'status': 'error', 'mensaje': 'IP requerida'}), 400

    ip = data['ip'].strip()
    if not ip:
        return jsonify({'status': 'error', 'mensaje': 'IP no puede estar vacía'}), 400

    try:
        from app.services.auto_detect import auto_detectar_ups
        db = current_app.db
        resultado = auto_detectar_ups(ip, db=db)

        if resultado.get('protocolo') == 'desconocido':
            if resultado.get('ping'):
                return jsonify({
                    'status': 'parcial',
                    'resultado': resultado,
                    'mensaje': 'El dispositivo responde a ping pero no se detectó protocolo SNMP ni Modbus'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'mensaje': f'No se pudo contactar al dispositivo en {ip}'
                })

        return jsonify({'status': 'ok', 'resultado': resultado})

    except Exception as e:
        logger.error("Error en auto-detección de %s: %s", ip, e)
        return jsonify({'status': 'error', 'mensaje': 'Error interno del servidor'}), 500


# =========================================================================
# ÚLTIMO ESTADO Y HISTORIAL (Fix delay de carga)
# =========================================================================

@monitoreo_bp.route('/api/monitoreo/ultimo-estado/<int:device_id>')
@login_required
@permiso_requerido('scada')
def ultimo_estado(device_id):
    """Retorna los últimos datos conocidos del dispositivo desde la DB."""
    db = current_app.db
    dato = db.obtener_ultimo_estado(device_id)
    if dato:
        return jsonify({'status': 'ok', 'data': dato})
    return jsonify({'status': 'sin_datos', 'data': None})


# =========================================================================
# ANALYTICS DE CALIDAD DE ENERGÍA (integrados en SCADA)
# =========================================================================

@monitoreo_bp.route('/api/monitoreo/calidad-energia/<int:device_id>')
@login_required
@permiso_requerido('scada')
def calidad_energia(device_id):
    """Resumen global de calidad de energía para un dispositivo."""
    horas = request.args.get('horas', 24, type=int)
    if horas > 168:
        horas = 168
    db = current_app.db
    resumen = db.calcular_calidad_energia(device_id, horas)
    return jsonify(resumen)


@monitoreo_bp.route('/api/monitoreo/perfil-horario/<int:device_id>')
@login_required
@permiso_requerido('scada')
def perfil_horario(device_id):
    """Métricas de calidad de energía agrupadas por hora."""
    horas = request.args.get('horas', 24, type=int)
    if horas > 168:
        horas = 168
    db = current_app.db
    datos = db.obtener_perfil_horario(device_id, horas)
    return jsonify(datos)


@monitoreo_bp.route('/api/monitoreo/list', methods=['GET'])
@login_required
@permiso_requerido('scada')
def list_devices():
    db = current_app.db
    devices = db.obtener_monitoreo_ups()
    return jsonify(devices)


@monitoreo_bp.route('/api/monitoreo/add', methods=['POST'])
@login_required
@permiso_requerido('scada')
@requiere_rol('admin', 'tecnico')
def add_device():
    db = current_app.db
    data = request.json
    if not data or 'ip' not in data:
        return jsonify({'error': 'Faltan datos (ip requerida)'}), 400

    ip = data['ip'].strip()
    if not ip:
        return jsonify({'error': 'La dirección IP no puede estar vacía'}), 400

    # Validar formato de IP
    try:
        ipaddress.IPv4Address(ip)
    except ValueError:
        return jsonify({'error': f'Dirección IP no válida: {ip}'}), 400

    # Validar IP no duplicada
    dispositivos = db.obtener_monitoreo_ups()
    existente = next((d for d in dispositivos if d.get('ip') == ip), None)
    if existente:
        return jsonify({
            'error': f'Ya existe un dispositivo con IP {ip}: {existente.get("nombre", "?")} (ID {existente["id"]})'
        }), 409

    if 'protocolo' not in data:
        data['protocolo'] = 'modbus'

    success = db.agregar_monitoreo_ups(data)
    if success:
        return jsonify({'status': 'ok'})
    else:
        return jsonify({'error': 'Error agregando dispositivo'}), 500


@monitoreo_bp.route('/api/monitoreo/delete/<int:id_device>', methods=['DELETE'])
@login_required
@permiso_requerido('scada')
@requiere_rol('admin', 'tecnico')
def delete_device(id_device):
    db = current_app.db
    db.eliminar_monitoreo_ups(id_device)
    return jsonify({'status': 'ok'})


@monitoreo_bp.route('/api/ups-proxy/<int:device_id>/', defaults={'path': ''})
@monitoreo_bp.route('/api/ups-proxy/<int:device_id>/<path:path>')
@login_required
@permiso_requerido('scada')
def ups_proxy(device_id, path):
    """Reverse proxy para acceder a la interfaz web del UPS a través de Flask."""
    db = current_app.db
    devices = db.obtener_monitoreo_ups()
    dev = next((d for d in devices if d['id'] == device_id), None)

    if not dev:
        return jsonify({'error': 'Dispositivo no encontrado'}), 404

    target_ip = dev['ip']
    if not target_ip:
        return jsonify({'error': 'IP del dispositivo no configurada'}), 400

    target_url = f"http://{target_ip}/{path}"
    if request.query_string:
        target_url += f"?{request.query_string.decode()}"

    try:
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers={k: v for k, v in request.headers if k.lower() not in ('host', 'cookie', 'referer')},
            data=request.get_data(),
            timeout=15,
            allow_redirects=False,
            verify=False,
        )

        content = resp.content
        content_type = resp.headers.get('Content-Type', 'text/html')

        # Reescribir URLs en respuestas HTML para que pasen por el proxy
        if 'text/html' in content_type:
            try:
                html = content.decode('utf-8', errors='replace')
                proxy_base = f'/api/ups-proxy/{device_id}/'

                # Reemplazar referencias absolutas a la IP del UPS
                html = html.replace(f'http://{target_ip}/', proxy_base)
                html = html.replace(f'https://{target_ip}/', proxy_base)
                html = html.replace(f'//{target_ip}/', proxy_base)

                # Reescribir rutas absolutas (src="/..." href="/...")
                html = re.sub(
                    r'(src|href|action)=(["\'])/(?!/)',
                    rf'\1=\2{proxy_base}',
                    html
                )

                # Inyectar <base> para URLs relativas
                if '<head>' in html:
                    html = html.replace('<head>', f'<head><base href="{proxy_base}">', 1)
                elif '<HEAD>' in html:
                    html = html.replace('<HEAD>', f'<HEAD><base href="{proxy_base}">', 1)

                content = html.encode('utf-8')
            except Exception as e:
                logger.warning('Error reescribiendo URLs del proxy UPS: %s', e)

        excluded = {'transfer-encoding', 'content-encoding', 'content-length', 'connection'}
        headers = [(k, v) for k, v in resp.raw.headers.items() if k.lower() not in excluded]

        return Response(content, status=resp.status_code, headers=headers, content_type=content_type)

    except requests.exceptions.ConnectionError:
        return Response(
            f'''<html><body style="background:#0a0a0f;color:#ff453a;font-family:'JetBrains Mono',monospace;padding:40px;text-align:center;">
            <h2 style="margin-top:60px;">No se pudo conectar al UPS</h2>
            <p style="color:#8a8a95;font-size:14px;">IP: {target_ip}</p>
            <p style="color:#8a8a95;font-size:13px;">Verifique que el UPS tiene interfaz web activa y es accesible via ZeroTier</p>
            <button onclick="history.back()" style="margin-top:24px;padding:10px 32px;background:#0066FF;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Volver</button>
            <button onclick="location.reload()" style="margin-top:24px;margin-left:12px;padding:10px 32px;background:#1a1a2e;color:#f0f0f5;border:1px solid #2a2a3e;border-radius:8px;cursor:pointer;font-size:14px;">Reintentar</button>
            </body></html>''',
            status=502,
            content_type='text/html'
        )
    except requests.exceptions.Timeout:
        return Response(
            f'''<html><body style="background:#0a0a0f;color:#ff9f0a;font-family:'JetBrains Mono',monospace;padding:40px;text-align:center;">
            <h2 style="margin-top:60px;">Timeout conectando al UPS</h2>
            <p style="color:#8a8a95;font-size:14px;">IP: {target_ip} — No respondió en 15 segundos</p>
            <button onclick="location.reload()" style="margin-top:24px;padding:10px 32px;background:#0066FF;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Reintentar</button>
            </body></html>''',
            status=504,
            content_type='text/html'
        )
    except Exception as e:
        logger.error("Error en proxy UPS %s: %s", device_id, e)
        return jsonify({'error': 'Error interno del servidor'}), 500


# =========================================================================
# TELEMETRÍA Y GRABACIONES
# =========================================================================

@monitoreo_bp.route('/api/telemetry/recent/<int:device_id>')
@login_required
@permiso_requerido('scada')
def telemetry_recent(device_id):
    """Retorna últimos N minutos de telemetría para alimentar charts."""
    minutos = request.args.get('minutes', 10, type=int)
    if minutos > 60:
        minutos = 60
    db = current_app.db
    datos = db.obtener_telemetria_reciente(device_id, minutos)
    return jsonify(datos)


@monitoreo_bp.route('/api/ups-history/<int:device_id>')
@login_required
@permiso_requerido('scada')
def ups_history(device_id):
    """Retorna historial de graficas para un dispositivo (hasta 24h)."""
    horas = request.args.get('horas', 6, type=int)
    if horas > 168:
        horas = 168
    db = current_app.db
    datos = db.obtener_historial_device(device_id, horas)
    return jsonify(datos)


@monitoreo_bp.route('/api/datos/historico')
@login_required
@permiso_requerido('scada')
def datos_historico():
    """Endpoint de datos históricos parametrizado para gráficas SCADA y PDF.

    Parámetros:
        device_id (int): ID del dispositivo (requerido)
        horas (int): Periodo en horas (1-720, default 6)
        campo (str): Campo específico a retornar (opcional)

    Campos disponibles: voltaje_entrada, voltaje_salida, bateria_porcentaje,
    carga_porcentaje, temperatura, frecuencia_entrada
    """
    device_id = request.args.get('device_id', type=int)
    horas = request.args.get('horas', 6, type=int)
    campo = request.args.get('campo')

    if not device_id:
        return jsonify({'error': 'device_id es requerido'}), 400

    horas = min(max(horas, 1), 720)

    # Mapeo de nombres amigables a columnas de PostgreSQL
    FIELD_MAP = {
        'voltaje_entrada': 'voltaje_in_l1',
        'voltaje_entrada_l2': 'voltaje_in_l2',
        'voltaje_entrada_l3': 'voltaje_in_l3',
        'voltaje_salida': 'voltaje_out_l1',
        'voltaje_salida_l2': 'voltaje_out_l2',
        'voltaje_salida_l3': 'voltaje_out_l3',
        'corriente_salida_l1': 'corriente_out_l1',
        'corriente_salida_l2': 'corriente_out_l2',
        'corriente_salida_l3': 'corriente_out_l3',
        'bateria_porcentaje': 'bateria_pct',
        'carga_porcentaje': 'carga_pct',
        'temperatura': 'temperatura',
        'frecuencia_entrada': 'frecuencia_in',
        'frecuencia_salida': 'frecuencia_out',
    }

    db = current_app.db

    # Fuente primaria: PostgreSQL ups_chart_history
    try:
        datos_raw = db.obtener_historial_device(device_id, horas) or []
    except Exception as e:
        logger.error('Error consultando historial PG: %s', e)
        datos_raw = []

    if datos_raw:
        if campo and campo in FIELD_MAP:
            pg_field = FIELD_MAP[campo]
            datos = [{
                'timestamp': d.get('timestamp', ''),
                'valor': d.get(pg_field)
            } for d in datos_raw]
        else:
            datos = datos_raw

        return jsonify({
            'device_id': device_id,
            'campo': campo,
            'horas': horas,
            'puntos': len(datos),
            'source': 'postgresql',
            'datos': datos,
        })

    # Fuente secundaria: InfluxDB
    try:
        from app.services.pg_metrics import influx_service
        influx_field = campo if campo else None
        influx_data = influx_service.query_ups_data(str(device_id), horas, influx_field)
        if influx_data:
            return jsonify({
                'device_id': device_id,
                'campo': campo,
                'horas': horas,
                'puntos': len(influx_data),
                'source': 'influxdb',
                'datos': influx_data,
            })
    except Exception as e:
        logger.debug('InfluxDB fallback falló: %s', e)

    # Sin datos de ninguna fuente
    return jsonify({
        'device_id': device_id,
        'campo': campo,
        'horas': horas,
        'puntos': 0,
        'source': 'none',
        'datos': [],
        'mensaje': 'Sin datos para el periodo seleccionado',
    })


@monitoreo_bp.route('/api/recording/start', methods=['POST'])
@login_required
@permiso_requerido('scada')
def recording_start():
    """Inicia grabación para un dispositivo."""
    data = request.json
    device_id = data.get('device_id')
    nombre = data.get('nombre')

    if not device_id:
        return jsonify({'error': 'device_id requerido'}), 400

    db = current_app.db

    # Verificar que no haya grabación activa
    activa = db.obtener_grabacion_activa(device_id)
    if activa:
        return jsonify({'error': 'Ya hay una grabación activa', 'recording': activa}), 409

    grabacion = db.iniciar_grabacion(device_id, nombre)
    if grabacion:
        return jsonify({'status': 'ok', 'recording': grabacion})
    return jsonify({'error': 'Error iniciando grabación'}), 500


@monitoreo_bp.route('/api/recording/stop/<int:recording_id>', methods=['POST'])
@login_required
@permiso_requerido('scada')
def recording_stop(recording_id):
    """Detiene una grabación."""
    db = current_app.db
    grabacion = db.detener_grabacion(recording_id)
    if grabacion:
        return jsonify({'status': 'ok', 'recording': grabacion})
    return jsonify({'error': 'Grabación no encontrada'}), 404


@monitoreo_bp.route('/api/recording/list')
@login_required
@permiso_requerido('scada')
def recording_list():
    """Lista grabaciones, opcionalmente por dispositivo."""
    device_id = request.args.get('device_id', type=int)
    db = current_app.db
    grabaciones = db.obtener_grabaciones(device_id)
    return jsonify(grabaciones)


@monitoreo_bp.route('/api/recording/<int:recording_id>', methods=['DELETE'])
@login_required
@permiso_requerido('scada')
def recording_delete(recording_id):
    """Elimina una grabación y sus datos."""
    db = current_app.db
    if db.eliminar_grabacion(recording_id):
        return jsonify({'status': 'ok'})
    return jsonify({'error': 'Error eliminando grabación'}), 500


@monitoreo_bp.route('/api/recording/data/<int:recording_id>')
@login_required
@permiso_requerido('scada')
def recording_data(recording_id):
    """Retorna todos los datos de una grabación."""
    db = current_app.db
    datos = db.obtener_datos_grabacion(recording_id)
    grabacion = db.obtener_grabacion(recording_id)
    return jsonify({
        'recording': grabacion,
        'datos': datos,
        'total': len(datos)
    })


@monitoreo_bp.route('/api/recording/<int:recording_id>/csv')
@login_required
@permiso_requerido('scada')
def recording_csv(recording_id):
    """Descarga una grabación como CSV."""
    import csv
    import io
    db = current_app.db
    grabacion = db.obtener_grabacion(recording_id)
    if not grabacion:
        return jsonify({'error': 'Grabación no encontrada'}), 404
    datos = db.obtener_datos_grabacion(recording_id)

    cols = [
        'timestamp',
        'voltaje_in_l1', 'voltaje_in_l2', 'voltaje_in_l3',
        'voltaje_out_l1', 'voltaje_out_l2', 'voltaje_out_l3',
        'frecuencia_in', 'frecuencia_out',
        'corriente_out_l1', 'corriente_out_l2', 'corriente_out_l3',
        'carga_pct', 'bateria_pct', 'voltaje_bateria', 'temperatura',
        'temperatura_ambiente', 'ciclos_descarga',
        'power_mode', 'estado',
    ]

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in datos:
        w.writerow([r.get(c, '') for c in cols])

    name = f"grabacion-{recording_id}-{grabacion.get('nombre', 'sin-nombre')}.csv".replace(' ', '_')
    return Response(
        buf.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{name}"'},
    )


# =========================================================================
# LOG DE EVENTOS NATIVO DEL UPS (ups_event_log)
# =========================================================================
@monitoreo_bp.route('/api/monitoreo/eventos/<int:device_id>', methods=['GET'])
@login_required
@permiso_requerido('scada')
def listar_eventos_ups(device_id):
    """Historial de eventos que el propio UPS registra (cortes, descargas, bypass…)."""
    db = current_app.db
    try:
        limit = min(int(request.args.get('limit', 500)), 2000)
    except (TypeError, ValueError):
        limit = 500
    nivel = request.args.get('nivel') or None
    eventos = db.obtener_eventos_ups(device_id, limit=limit, nivel=nivel)
    for e in eventos:
        if e.get('ts'):
            e['ts'] = e['ts'].isoformat()
        if e.get('created_at'):
            e['created_at'] = e['created_at'].isoformat()
    resumen = db.resumen_eventos_ups(device_id)
    for k in ('desde', 'hasta'):
        if resumen.get(k):
            resumen[k] = resumen[k].isoformat()
    return jsonify({'status': 'ok', 'eventos': eventos, 'resumen': resumen})


@monitoreo_bp.route('/api/monitoreo/eventos/<int:device_id>/refresh', methods=['POST'])
@login_required
@permiso_requerido('scada')
@requiere_rol('admin', 'tecnico')
def refrescar_eventos_ups(device_id):
    """Dispara la colecta del log de eventos del UPS bajo demanda (requiere alcance)."""
    db = current_app.db
    dev = next((d for d in db.obtener_monitoreo_ups() if d.get('id') == device_id), None)
    if not dev:
        return jsonify({'status': 'error', 'mensaje': 'Dispositivo no encontrado'}), 404
    if not (dev.get('event_source') or '').strip():
        return jsonify({'status': 'error',
                        'mensaje': 'El dispositivo no tiene event_source configurado'}), 400
    from app.services.event_log_collector import collect_device
    eventos = collect_device(dev)
    n = db.insertar_eventos_ups(device_id, eventos) if eventos else 0
    return jsonify({'status': 'ok', 'colectados': len(eventos), 'insertados': n})
