-- 010_ups_event_log.sql
-- Log de eventos NATIVO del UPS (no las alarmas calculadas por umbral del portal,
-- sino el historial de eventos/alarmas que el propio UPS registra: cortes de red,
-- descargas, bypass, EOD, etc.).
--
-- Origen por equipo (columnas nuevas en monitoreo_config):
--   * event_source: cómo se obtiene el log del UPS:
--        'php_almhistory' → tarjeta web PHP (POST /action/alm_history_act.php)
--        'netagent_xml'   → tarjeta NetAgent/Megatec (GET /EventLog.xml)
--        NULL / ''        → sin colector de eventos
--   * web_user / web_pass / web_port → credenciales de la web del UPS (para el colector).
-- Idempotente.

ALTER TABLE monitoreo_config ADD COLUMN IF NOT EXISTS event_source TEXT;
ALTER TABLE monitoreo_config ADD COLUMN IF NOT EXISTS web_user     TEXT;
ALTER TABLE monitoreo_config ADD COLUMN IF NOT EXISTS web_pass     TEXT;
ALTER TABLE monitoreo_config ADD COLUMN IF NOT EXISTS web_port     INTEGER DEFAULT 80;

CREATE TABLE IF NOT EXISTS ups_event_log (
    id          BIGSERIAL PRIMARY KEY,
    device_id   INTEGER REFERENCES monitoreo_config(id) ON DELETE CASCADE,
    ts          TIMESTAMPTZ,                 -- marca de tiempo del evento (reloj del UPS)
    fuente      TEXT,                        -- p.ej. '1#UPS', 'System'
    evento      TEXT NOT NULL,               -- texto del evento
    nivel       TEXT NOT NULL DEFAULT 'info',-- info | warning | critical
    raw         TEXT,                        -- línea/fila cruda original
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Dedupe: el mismo evento (equipo + ts + texto) no se inserta dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ups_event_log_dedupe
    ON ups_event_log (device_id, ts, evento);

CREATE INDEX IF NOT EXISTS ix_ups_event_log_dev_ts
    ON ups_event_log (device_id, ts DESC);
