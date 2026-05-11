-- Migration 017: Campos adicionales en ups_chart_history para reportes completos
-- Agrega voltaje_bateria, power_mode, power_factor, potencias y autonomia

ALTER TABLE ups_chart_history ADD COLUMN IF NOT EXISTS voltaje_bateria REAL;
ALTER TABLE ups_chart_history ADD COLUMN IF NOT EXISTS power_mode VARCHAR(32);
ALTER TABLE ups_chart_history ADD COLUMN IF NOT EXISTS power_factor REAL;
ALTER TABLE ups_chart_history ADD COLUMN IF NOT EXISTS active_power REAL;
ALTER TABLE ups_chart_history ADD COLUMN IF NOT EXISTS apparent_power REAL;
ALTER TABLE ups_chart_history ADD COLUMN IF NOT EXISTS battery_remain_time REAL;
