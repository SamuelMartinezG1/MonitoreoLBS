-- 011_portal_events_capabilities.sql
-- Eventos generados por el PORTAL en ups_event_log (fuente='Portal') y
-- capacidades por dispositivo para render adaptativo del frontend.
--
-- ups_event_log.code: código máquina-a-máquina para contar/filtrar eventos
-- del portal sin depender del texto:
--   CONN_LOST / CONN_RESTORED       → transiciones de conectividad (con causa)
--   DISCHARGE_START / DISCHARGE_END → descargas de batería detectadas
--   ALARM_ON / ALARM_OFF            → activación/limpieza de alarmas de umbral
-- NULL en los eventos nativos colectados del UPS.
--
-- monitoreo_config.capabilities: último set de capacidades detectado
-- (fases, campos soportados, sensores) — permite que la UI se adapte a cada
-- UPS aun cuando el equipo está offline.
-- Idempotente.

ALTER TABLE ups_event_log ADD COLUMN IF NOT EXISTS code TEXT;

CREATE INDEX IF NOT EXISTS ix_ups_event_log_dev_code
    ON ups_event_log (device_id, code) WHERE code IS NOT NULL;

ALTER TABLE monitoreo_config ADD COLUMN IF NOT EXISTS capabilities JSONB;
