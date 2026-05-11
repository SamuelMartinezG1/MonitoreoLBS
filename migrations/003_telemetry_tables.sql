-- Migración 011: Tablas de telemetría y grabación

-- Buffer circular de telemetría (últimos 10 minutos)
CREATE TABLE IF NOT EXISTS ups_telemetry_log (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES monitoreo_config(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voltaje_in_l1 REAL,
    voltaje_in_l2 REAL,
    voltaje_in_l3 REAL,
    voltaje_out_l1 REAL,
    voltaje_out_l2 REAL,
    voltaje_out_l3 REAL,
    frecuencia_in REAL,
    frecuencia_out REAL,
    corriente_out_l1 REAL,
    corriente_out_l2 REAL,
    corriente_out_l3 REAL,
    carga_pct REAL,
    bateria_pct REAL,
    voltaje_bateria REAL,
    temperatura REAL,
    power_mode TEXT,
    estado TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts
    ON ups_telemetry_log(device_id, timestamp DESC);

-- Sesiones de grabación
CREATE TABLE IF NOT EXISTS ups_recordings (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES monitoreo_config(id) ON DELETE CASCADE,
    nombre TEXT,
    inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fin TIMESTAMPTZ,
    muestras INTEGER DEFAULT 0,
    activa BOOLEAN DEFAULT TRUE
);

-- Datos de grabación (retención permanente)
CREATE TABLE IF NOT EXISTS ups_recording_data (
    id BIGSERIAL PRIMARY KEY,
    recording_id INTEGER NOT NULL REFERENCES ups_recordings(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voltaje_in_l1 REAL,
    voltaje_in_l2 REAL,
    voltaje_in_l3 REAL,
    voltaje_out_l1 REAL,
    voltaje_out_l2 REAL,
    voltaje_out_l3 REAL,
    frecuencia_in REAL,
    frecuencia_out REAL,
    corriente_out_l1 REAL,
    corriente_out_l2 REAL,
    corriente_out_l3 REAL,
    carga_pct REAL,
    bateria_pct REAL,
    voltaje_bateria REAL,
    temperatura REAL,
    power_mode TEXT,
    estado TEXT
);

CREATE INDEX IF NOT EXISTS idx_recording_data_rid
    ON ups_recording_data(recording_id, timestamp);
