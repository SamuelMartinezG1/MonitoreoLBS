-- 009_ambient_temp_discharge_cycles.sql
-- Campos que el portal debe mostrar SIEMPRE en monitoreo:
--   * temperatura_ambiente → temperatura ambiente del equipo/gabinete (si el
--     UPS la expone vía SNMP o un OID personalizado). Distinta de `temperatura`,
--     que es la temperatura de batería.
--   * ciclos_descarga      → total de ciclos de descarga de la batería que ha
--     tenido el equipo (contador acumulado del fabricante).
-- Idempotente.

ALTER TABLE ups_chart_history  ADD COLUMN IF NOT EXISTS temperatura_ambiente REAL;
ALTER TABLE ups_chart_history  ADD COLUMN IF NOT EXISTS ciclos_descarga      INTEGER;

-- También en el buffer de telemetría y en las grabaciones, para que los
-- reportes/CSV conserven estos campos.
ALTER TABLE ups_telemetry_log  ADD COLUMN IF NOT EXISTS temperatura_ambiente REAL;
ALTER TABLE ups_telemetry_log  ADD COLUMN IF NOT EXISTS ciclos_descarga      INTEGER;

ALTER TABLE ups_recording_data ADD COLUMN IF NOT EXISTS temperatura_ambiente REAL;
ALTER TABLE ups_recording_data ADD COLUMN IF NOT EXISTS ciclos_descarga      INTEGER;
