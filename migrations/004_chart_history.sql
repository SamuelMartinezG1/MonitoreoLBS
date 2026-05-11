-- Migration 013: Historial de graficas para tendencias a largo plazo (retencion 7 dias)
-- Almacena 1 punto cada ~30 segundos por dispositivo UPS

CREATE TABLE IF NOT EXISTS ups_chart_history (
    id              BIGSERIAL PRIMARY KEY,
    device_id       INTEGER NOT NULL REFERENCES monitoreo_config(id) ON DELETE CASCADE,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Voltajes de entrada por fase
    voltaje_in_l1   REAL,
    voltaje_in_l2   REAL,
    voltaje_in_l3   REAL,

    -- Voltajes de salida por fase
    voltaje_out_l1  REAL,
    voltaje_out_l2  REAL,
    voltaje_out_l3  REAL,

    -- Frecuencia
    frecuencia_in   REAL,
    frecuencia_out  REAL,

    -- Corrientes de salida por fase
    corriente_out_l1 REAL,
    corriente_out_l2 REAL,
    corriente_out_l3 REAL,

    -- Carga y bateria
    carga_pct       REAL,
    bateria_pct     REAL,

    -- Temperatura
    temperatura     REAL
);

-- Indice principal: consultas rapidas por device y rango de tiempo
CREATE INDEX IF NOT EXISTS idx_chart_history_device_ts
    ON ups_chart_history(device_id, timestamp DESC);

-- Indice para limpieza eficiente por antiguedad
CREATE INDEX IF NOT EXISTS idx_chart_history_ts
    ON ups_chart_history(timestamp);
