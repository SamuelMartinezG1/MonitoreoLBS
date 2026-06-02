-- Migration 009: Integridad y rendimiento de grabaciones
--
-- 1. Garantiza una sola grabación activa por dispositivo (F2 de la auditoría).
-- 2. Índice por timestamp en ups_recording_data para permitir consultas /
--    borrado por antigüedad sin escaneo completo (P5 de la auditoría).

-- Paso 1: cerrar duplicados activos preexistentes, conservando la más reciente
-- (de lo contrario el índice único parcial fallaría al crearse).
UPDATE ups_recordings r
   SET activa = FALSE,
       fin = COALESCE(r.fin, NOW())
 WHERE r.activa = TRUE
   AND r.id <> (
        SELECT r2.id
          FROM ups_recordings r2
         WHERE r2.device_id = r.device_id
           AND r2.activa = TRUE
         ORDER BY r2.inicio DESC, r2.id DESC
         LIMIT 1
   );

-- Paso 2: índice único parcial — máximo una fila activa por device_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recordings_activa_por_device
    ON ups_recordings(device_id)
 WHERE activa = TRUE;

-- Paso 3: índice por antigüedad para retención / mantenimiento.
CREATE INDEX IF NOT EXISTS idx_recording_data_ts
    ON ups_recording_data(timestamp);
