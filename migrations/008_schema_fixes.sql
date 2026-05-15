-- 008_schema_fixes.sql
-- Alinea `sitios` y `monitoreo_config` con lo que esperan las rutas
-- trasplantadas desde LBS-SERVICIO-APP. Idempotente.

-- ============================================================
-- sitios: columnas extra que usan inventario / diagnostic / etc.
-- ============================================================
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS numero_sitio    INTEGER;
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS subred_lan      TEXT;
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS router_ip_lan   TEXT;
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS router_ip_zt    TEXT;
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS router_node_id  TEXT;
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS router_firmware TEXT;
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS fecha_despliegue DATE;
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS notas           TEXT;
ALTER TABLE sitios ADD COLUMN IF NOT EXISTS fecha_registro  TIMESTAMPTZ DEFAULT NOW();

-- Migrar dato legacy del esquema 001 (router_ip → router_ip_lan).
UPDATE sitios
   SET router_ip_lan = router_ip
 WHERE router_ip_lan IS NULL
   AND router_ip IS NOT NULL;

-- También migrar `subred` legacy → `subred_lan`.
UPDATE sitios
   SET subred_lan = subred
 WHERE subred_lan IS NULL
   AND subred IS NOT NULL;

-- Unique sobre numero_sitio para auto-poblado y upserts.
-- (omitido si ya existe; evita conflicto si hay datos duplicados).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'uq_sitios_numero_sitio'
    ) AND NOT EXISTS (
        SELECT numero_sitio
          FROM sitios
         WHERE numero_sitio IS NOT NULL
         GROUP BY numero_sitio
        HAVING COUNT(*) > 1
    ) THEN
        ALTER TABLE sitios
              ADD CONSTRAINT uq_sitios_numero_sitio UNIQUE (numero_sitio);
    END IF;
END $$;

-- ============================================================
-- monitoreo_config: columnas extra
-- ============================================================
ALTER TABLE monitoreo_config ADD COLUMN IF NOT EXISTS notas_tecnicas TEXT;
ALTER TABLE monitoreo_config ADD COLUMN IF NOT EXISTS estado         TEXT DEFAULT 'inactivo';
