-- Migration 009: Add OID profiles table for custom SNMP mapping
CREATE TABLE IF NOT EXISTS ups_oid_profiles (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES monitoreo_config(id) ON DELETE CASCADE,
    variable_name VARCHAR(64) NOT NULL,
    oid VARCHAR(128) NOT NULL,
    data_type VARCHAR(32) DEFAULT 'Integer',
    factor REAL DEFAULT 1.0,
    unit VARCHAR(16) DEFAULT '',
    description TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(device_id, variable_name)
);

CREATE INDEX IF NOT EXISTS idx_oid_profiles_device ON ups_oid_profiles(device_id);
