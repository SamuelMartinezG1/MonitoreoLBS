-- 006_ups_metrics.sql
-- Series de tiempo del monitoreo. Reemplaza al bucket de InfluxDB.
-- Layout EAV (entity-attribute-value) para conservar flexibilidad.
--
-- Si se desea, puede migrarse a hypertable de TimescaleDB con:
--     SELECT create_hypertable('ups_metrics', 'ts');
-- (requiere extensión `timescaledb`).

CREATE TABLE IF NOT EXISTS ups_metrics (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Tags (mismos que enviaba InfluxDB)
    device_id     INTEGER,
    device_name   TEXT,
    ip            TEXT,
    sitio         TEXT,
    ups_type      TEXT,

    -- Métrica
    metric_name   TEXT             NOT NULL,
    metric_value  DOUBLE PRECISION NOT NULL
);

-- Consultas típicas: "últimas N horas de un device" → device_id + ts.
CREATE INDEX IF NOT EXISTS idx_ups_metrics_device_ts
    ON ups_metrics(device_id, ts DESC);

-- Limpieza por retención.
CREATE INDEX IF NOT EXISTS idx_ups_metrics_ts
    ON ups_metrics(ts);

-- Filtros por nombre de métrica (carga, batería, voltajes...).
CREATE INDEX IF NOT EXISTS idx_ups_metrics_name
    ON ups_metrics(metric_name);
