"""
Servicio de monitoreo unificado para UPS INVT.
Orquesta SNMP y Modbus segun la configuracion de cada dispositivo.
"""

import os
import threading
import time
import asyncio
import logging
from app.base_datos import GestorDB
from app.services.protocols.snmp_client import SNMPClient
from app.services.modbus_monitor import ModbusMonitor
from app.extensions import socketio

logger = logging.getLogger(__name__)


class MonitoringService(threading.Thread):
    def __init__(self, interval=2):
        super().__init__()
        self.interval = interval
        self.running = True
        self.db = GestorDB()
        self.daemon = True
        self.modbus_monitor = ModbusMonitor()
        self.ultimo_estado = {}
        self._cycle_count = 0
        self._telemetry_interval = 3  # Persistir cada 3 ciclos (~6 seg)
        self._cleanup_interval = 30   # Limpiar cada 30 ciclos (~60 seg)
        self._history_interval = 15   # Guardar historial graficas cada 15 ciclos (~30 seg)
        self._history_cleanup_interval = 1800  # Limpiar historial antiguo cada ~1 hora
        self._history_retention_days = int(os.environ.get('HISTORY_RETENTION_DAYS', 30))

    def run(self):
        logger.info("Iniciando servicio de monitoreo unificado (SNMP + Modbus)...")
        # Iniciar monitor Modbus en su propio hilo
        self.modbus_monitor.start_background_task()

        # Este hilo maneja SNMP
        while self.running:
            try:
                self._poll_snmp_devices()
            except Exception as e:
                logger.error(f"Error en ciclo de monitoreo SNMP: {e}")

            self._cycle_count += 1

            # Limpiar telemetría antigua cada ~60 seg
            if self._cycle_count % self._cleanup_interval == 0:
                try:
                    self.db.limpiar_telemetria_antigua(10)
                except Exception:
                    pass

            # Guardar historial de graficas cada ~30 seg
            if self._cycle_count % self._history_interval == 0 and self.ultimo_estado:
                try:
                    for dev_id_str, estado in self.ultimo_estado.items():
                        if estado:
                            raw_data = {
                                'input_voltage_l1': estado.get('voltaje_in_l1', 0),
                                'input_voltage_l2': estado.get('voltaje_in_l2', 0),
                                'input_voltage_l3': estado.get('voltaje_in_l3', 0),
                                'output_voltage_l1': estado.get('voltaje_out_l1', 0),
                                'output_voltage_l2': estado.get('voltaje_out_l2', 0),
                                'output_voltage_l3': estado.get('voltaje_out_l3', 0),
                                'input_frequency': estado.get('frecuencia_in', 0),
                                'output_frequency': estado.get('frecuencia_out', 0),
                                'output_current_l1': estado.get('corriente_out_l1', 0),
                                'output_current_l2': estado.get('corriente_out_l2', 0),
                                'output_current_l3': estado.get('corriente_out_l3', 0),
                                'output_load': estado.get('carga_pct', 0),
                                'battery_capacity': estado.get('bateria_pct', 0),
                                'temperature': estado.get('temperatura', 0),
                            }
                            self.db.guardar_punto_historial(int(dev_id_str), raw_data)
                except Exception as e:
                    logger.error("Error guardando historial de graficas: %s", e)

            # Limpiar historial antiguo cada ~1 hora
            if self._cycle_count % self._history_cleanup_interval == 0:
                try:
                    self.db.limpiar_historial_antiguo(self._history_retention_days)
                except Exception as e:
                    logger.error("Error limpiando historial antiguo: %s", e)

            time.sleep(self.interval)

    def stop(self):
        self.running = False
        self.modbus_monitor.stop()

    def _poll_snmp_devices(self):
        try:
            asyncio.run(self._async_poll())
        except Exception as e:
            logger.error(f"Error ejecutando poll async SNMP: {e}")

    async def _async_poll(self):
        try:
            devices = self.db.obtener_monitoreo_ups()
        except Exception as e:
            logger.error(f"Error leyendo DB: {e}")
            return

        # Filtrar solo dispositivos SNMP
        snmp_devices = [d for d in devices if d.get('protocolo', 'modbus') == 'snmp']

        tasks = []
        for dev in snmp_devices:
            tasks.append(self._check_device(dev))

        if tasks:
            await asyncio.gather(*tasks)

    async def _check_device(self, dev):
        ip = dev['ip']
        port = dev.get('snmp_port', 161) or 161
        community = dev.get('snmp_community', 'public') or 'public'
        # Manejo robusto de snmp_version (puede ser None, str, o int)
        snmp_version_raw = dev.get('snmp_version')
        if snmp_version_raw is None or snmp_version_raw == '':
            snmp_version = 1  # Default SNMPv2c
        else:
            snmp_version = int(snmp_version_raw)

        # Tipo de UPS (nuevo)
        ups_type = dev.get('ups_type', 'invt_enterprise')
        dev_id = dev['id']

        try:
            # Verificar si hay perfil OID personalizado
            oid_profile = self.db.obtener_oid_profile(dev_id)

            if oid_profile:
                # Usar perfil personalizado — hacer GET de cada OID
                data = await self._poll_custom_profile(ip, port, community, snmp_version, oid_profile)
                logger.info(f"Usando perfil OID personalizado para {ip} ({len(oid_profile)} variables)")
            elif ups_type in ('ups_mib_standard', 'hybrid'):
                # Usar cliente UPS-MIB para monofásicos o híbridos
                from app.services.protocols.snmp_upsmib_client import UPSMIBClient
                client = UPSMIBClient(
                    ip_address=ip,
                    community=community,
                    port=port,
                    mp_model=int(snmp_version),  # Asegurar que sea int
                    include_invt=(ups_type == 'hybrid')
                )
                logger.info(f"Usando UPSMIBClient para {ip} (tipo: {ups_type})")
                data = await client.get_ups_data(ip)
            else:
                # Usar cliente MINIMAL para Megatec/INVT (OIDs enterprise .935)
                # Cubre ups_type: invt_enterprise, invt_minimal, megatec_snmp
                from app.services.protocols.snmp_minimal_client import MinimalSNMPClient
                client = MinimalSNMPClient(community=community, port=port, mp_model=int(snmp_version))
                logger.info(f"Usando MinimalSNMPClient para {ip} (tipo: {ups_type}, OIDs Megatec .935)")
                data = await client.get_ups_data(ip)

            if data:
                status = 'online'  # Estado online si hay datos
                data['device_id'] = dev_id
                data['ip'] = ip
                data['nombre'] = dev.get('nombre', 'UPS')
                data['estado'] = 'ONLINE'

                # Agregar info de versión SNMP
                version_name = 'SNMPv1' if snmp_version == 0 else 'SNMPv2c'
                data['snmp_version'] = version_name

                socketio.emit('ups_data', data, namespace='/monitor')
                logger.info(f"✅ {ip} ({version_name}): {data.get('input_voltage_l1', 0)}V entrada, {data.get('battery_capacity', 0)}% batería")

                # Original logic for mapped_data and alarms, adapted to use the 'data' dictionary
                mapped_data = {
                    # Voltajes de entrada por fase
                    'voltaje_in_l1': data.get('input_voltage_l1', 0),
                    'voltaje_in_l2': data.get('input_voltage_l2', 0),
                    'voltaje_in_l3': data.get('input_voltage_l3', 0),
                    'frecuencia_in': data.get('input_frequency', 0),
                    # Voltajes de salida por fase
                    'voltaje_out_l1': data.get('output_voltage_l1', 0),
                    'voltaje_out_l2': data.get('output_voltage_l2', 0),
                    'voltaje_out_l3': data.get('output_voltage_l3', 0),
                    'frecuencia_out': data.get('output_frequency', 0),
                    # Corrientes por fase
                    'corriente_out_l1': data.get('output_current_l1', data.get('output_current', 0)),
                    'corriente_out_l2': data.get('output_current_l2', 0),
                    'corriente_out_l3': data.get('output_current_l3', 0),
                    # Potencia
                    'power_factor': data.get('power_factor', 0),
                    'active_power': data.get('active_power', 0),
                    'apparent_power': data.get('apparent_power', 0),
                    # Carga
                    'carga_pct': data.get('output_load', 0),
                    # Bateria
                    'bateria_pct': data.get('battery_capacity', 0),
                    'voltaje_bateria': data.get('battery_voltage', 0),
                    'corriente_bateria': data.get('battery_current', 0),
                    'temperatura': data.get('temperature', 0),
                    'battery_remain_time': data.get('battery_runtime', 0),
                    # Estado
                    'power_mode': data.get('power_source', ''),
                    'battery_status': data.get('battery_status', ''),
                    # Metadatos
                    'phases': data.get('_phases', 1),
                    'ups_type': ups_type,
                }
                # Guardar estado actual para acceso directo (PDFs, API)
                self.ultimo_estado[str(dev_id)] = mapped_data

                # Generar alarmas SNMP
                alarms = self._check_snmp_alarms(mapped_data)
            else:
                status = 'offline'
                mapped_data = {}
                alarms = []
                # Limpiar estado stale para evitar persistir datos viejos
                self.ultimo_estado.pop(str(dev_id), None)

                # Registrar status offline en PostgreSQL (ups_metrics) para historial de disponibilidad
                if self._cycle_count % self._telemetry_interval == 0:
                    try:
                        from app.services.pg_metrics import influx_service
                        influx_service.write_ups_data(
                            dev.get('nombre', 'UPS'), ip,
                            {'status_code': 0},
                            device_id=dev_id,
                            sitio=dev.get('sitio_nombre', ''),
                            ups_type=ups_type
                        )
                    except Exception:
                        pass

            payload = {
                'id': dev_id,
                'status': status,
                'ip': ip,
                'nombre': dev['nombre'],
                'protocol': 'snmp',
                'data': mapped_data,
                'alarms': alarms,
            }

            socketio.emit('ups_update', payload)

            # Persistir telemetría cada N ciclos
            if status == 'online' and self._cycle_count % self._telemetry_interval == 0:
                try:
                    self.db.insertar_telemetria(dev_id, data)
                    # Verificar si hay grabación activa
                    grabacion = self.db.obtener_grabacion_activa(dev_id)
                    if grabacion:
                        self.db.insertar_dato_grabacion(grabacion['id'], data)
                except Exception as te:
                    logger.debug(f"Error persistiendo telemetría para {ip}: {te}")

                # Escribir también a pg_metrics (Postgres)
                try:
                    from app.services.pg_metrics import influx_service
                    influx_data = {
                        'voltaje_entrada': mapped_data.get('voltaje_in_l1', 0),
                        'voltaje_entrada_l2': mapped_data.get('voltaje_in_l2', 0),
                        'voltaje_entrada_l3': mapped_data.get('voltaje_in_l3', 0),
                        'voltaje_salida': mapped_data.get('voltaje_out_l1', 0),
                        'voltaje_salida_l2': mapped_data.get('voltaje_out_l2', 0),
                        'voltaje_salida_l3': mapped_data.get('voltaje_out_l3', 0),
                        'corriente_salida_l1': mapped_data.get('corriente_out_l1', 0),
                        'corriente_salida_l2': mapped_data.get('corriente_out_l2', 0),
                        'corriente_salida_l3': mapped_data.get('corriente_out_l3', 0),
                        'bateria_porcentaje': mapped_data.get('bateria_pct', 0),
                        'carga_porcentaje': mapped_data.get('carga_pct', 0),
                        'temperatura': mapped_data.get('temperatura', 0),
                        'frecuencia_entrada': mapped_data.get('frecuencia_in', 0),
                        'frecuencia_salida': mapped_data.get('frecuencia_out', 0),
                    }
                    influx_service.write_ups_data(
                        dev.get('nombre', 'UPS'), ip, influx_data,
                        device_id=dev_id,
                        sitio=dev.get('sitio_nombre', ''),
                        ups_type=ups_type
                    )
                    logger.info(f"[MONITOR] Guardando datos device_id={dev_id} en PostgreSQL (ups_metrics)")
                except Exception as ie:
                    logger.debug(f"Error pg_metrics para {ip}: {ie}")

        except Exception as e:
            logger.error(f"Error checking SNMP device {ip}: {e}")
            # Limpiar estado stale en caso de error
            self.ultimo_estado.pop(str(dev_id), None)

    async def _poll_custom_profile(self, ip, port, community, snmp_version, oid_profile):
        """Consulta un dispositivo usando un perfil OID personalizado."""
        try:
            from pysnmp.hlapi.v3arch.asyncio import (
                get_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
                ContextData, ObjectType, ObjectIdentity
            )

            engine = SnmpEngine()
            auth = CommunityData(community, mpModel=snmp_version)
            transport = await UdpTransportTarget.create((ip, port), timeout=3.0, retries=1)
            context = ContextData()

            data = {}
            for mapping in oid_profile:
                try:
                    errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                        engine, auth, transport, context,
                        ObjectType(ObjectIdentity(mapping['oid']))
                    )

                    if errorIndication or errorStatus or not varBinds:
                        continue

                    raw_value = varBinds[0][1].prettyPrint()
                    factor = float(mapping.get('factor', 1.0))

                    try:
                        numeric_val = float(raw_value)
                        data[mapping['variable_name']] = numeric_val * factor
                    except (ValueError, TypeError):
                        data[mapping['variable_name']] = raw_value

                except Exception as e:
                    logger.debug(f"Error leyendo OID {mapping['oid']}: {e}")

            # Map custom variable names to standard fields for compatibility
            VARIABLE_TO_STANDARD = {
                'voltaje_in_l1': 'input_voltage_l1',
                'voltaje_in_l2': 'input_voltage_l2',
                'voltaje_in_l3': 'input_voltage_l3',
                'voltaje_out_l1': 'output_voltage_l1',
                'voltaje_out_l2': 'output_voltage_l2',
                'voltaje_out_l3': 'output_voltage_l3',
                'bateria_pct': 'battery_capacity',
                'temperatura': 'temperature',
                'carga_pct': 'output_load',
                'frecuencia_in': 'input_frequency',
                'frecuencia_out': 'output_frequency',
                'voltaje_bateria': 'battery_voltage',
            }

            standardized = {}
            for var_name, value in data.items():
                std_name = VARIABLE_TO_STANDARD.get(var_name)
                if std_name:
                    standardized[std_name] = value
                standardized[var_name] = value

            return standardized if standardized else None

        except Exception as e:
            logger.error(f"Error en poll custom profile para {ip}: {e}")
            return None

    def _check_snmp_alarms(self, data):
        """Genera alarmas basadas en datos SNMP."""
        alarms = []

        vin = data.get('voltaje_in_l1', 0)
        if 0 < vin < 180:
            alarms.append({'level': 'critical', 'code': 'INPUT_V_LOW', 'msg': f'Voltaje entrada bajo: {vin:.1f}V'})

        bat = data.get('bateria_pct', 0)
        if 0 < bat < 20:
            alarms.append({'level': 'critical', 'code': 'BAT_CRITICAL', 'msg': f'Bateria critica: {bat:.1f}%'})
        elif 0 < bat < 50:
            alarms.append({'level': 'warning', 'code': 'BAT_LOW', 'msg': f'Bateria baja: {bat:.1f}%'})

        temp = data.get('temperatura', 0)
        if temp > 45:
            alarms.append({'level': 'critical', 'code': 'BAT_OVERTEMP', 'msg': f'Sobretemperatura: {temp:.1f}C'})

        load = data.get('carga_pct', 0)
        if load > 90:
            alarms.append({'level': 'critical', 'code': 'OVERLOAD', 'msg': f'Sobrecarga: {load:.1f}%'})
        elif load > 70:
            alarms.append({'level': 'warning', 'code': 'LOAD_HIGH', 'msg': f'Carga alta: {load:.1f}%'})

        return alarms
