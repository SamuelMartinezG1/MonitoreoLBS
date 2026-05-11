-- 001_core_schema.sql
-- Esquema mínimo necesario para que el servicio de monitoreo funcione
-- aislado del proyecto monolítico LBS-SERVICIO-APP.
--
-- Crea las tablas de configuración (sitios + monitoreo_config) que son
-- referenciadas por foreign-keys en el resto de migraciones.
-- 100% idempotente.

-- ---------------------------------------------------------------- --
-- Sitios remotos                                                    --
-- ---------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS sitios (
    id           SERIAL PRIMARY KEY,
    nombre       TEXT NOT NULL,
    codigo       TEXT,
    subred       TEXT,           -- ej. 192.168.3.0/24
    router_ip    TEXT,           -- ej. 10.216.124.130 (ZeroTier)
    descripcion  TEXT,
    activo       BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sitios_nombre ON sitios(nombre);

-- ---------------------------------------------------------------- --
-- Dispositivos UPS monitoreados                                     --
-- ---------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS monitoreo_config (
    id              SERIAL PRIMARY KEY,
    nombre          TEXT NOT NULL,
    ip              TEXT NOT NULL,
    sitio_id        INTEGER REFERENCES sitios(id) ON DELETE SET NULL,

    -- Protocolo: 'snmp' | 'modbus'
    protocolo       TEXT NOT NULL DEFAULT 'snmp',

    -- SNMP
    snmp_port       INTEGER DEFAULT 161,
    snmp_community  TEXT    DEFAULT 'public',
    -- mp_model de pysnmp: 0 = SNMPv1, 1 = SNMPv2c
    snmp_version    SMALLINT DEFAULT 1,

    -- Modbus
    modbus_port     INTEGER DEFAULT 502,
    modbus_unit_id  SMALLINT DEFAULT 1,

    -- Tipo de UPS:
    --   invt_enterprise | invt_minimal | megatec_snmp |
    --   ups_mib_standard | hybrid
    ups_type        TEXT DEFAULT 'invt_enterprise',
    fases           SMALLINT DEFAULT 1,

    activo          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX  IF NOT EXISTS idx_monitoreo_activo ON monitoreo_config(activo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitoreo_ip_port
       ON monitoreo_config(ip, snmp_port);
