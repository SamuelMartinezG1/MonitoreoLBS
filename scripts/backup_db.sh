#!/bin/sh
# backup_db.sh — Backup automático de PostgreSQL con retención configurable
# Se ejecuta dentro del contenedor backup (postgres:15-alpine)

set -e

BACKUP_DIR="/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="ups_manager_${TIMESTAMP}.sql.gz"

echo "[$(date)] Iniciando backup de base de datos..."

# Crear directorio si no existe
mkdir -p "$BACKUP_DIR"

# Ejecutar pg_dump y comprimir
pg_dump | gzip > "${BACKUP_DIR}/${FILENAME}"

# Verificar que el backup se creó correctamente
if [ -s "${BACKUP_DIR}/${FILENAME}" ]; then
    SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
    echo "[$(date)] Backup creado: ${FILENAME} (${SIZE})"
else
    echo "[$(date)] ERROR: Backup vacío o fallido"
    rm -f "${BACKUP_DIR}/${FILENAME}"
    exit 1
fi

# Eliminar backups antiguos
DELETED=$(find "$BACKUP_DIR" -name "ups_manager_*.sql.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
    echo "[$(date)] Eliminados ${DELETED} backup(s) con más de ${RETENTION_DAYS} días"
fi

echo "[$(date)] Backup completado exitosamente"
