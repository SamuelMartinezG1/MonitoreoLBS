"""
Ejecutor de migraciones SQL para PostgreSQL.
Trackea migraciones aplicadas en la tabla schema_migrations.
"""
import os
import logging

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = os.path.dirname(os.path.abspath(__file__))


def run_migrations(pool):
    """Ejecuta todas las migraciones pendientes en orden."""
    with pool.get_connection() as conn:
        cursor = conn.cursor()

        # Crear tabla de tracking si no existe
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT NOW()
            )
        """)
        conn.commit()

        # Obtener migraciones ya aplicadas
        cursor.execute("SELECT version FROM schema_migrations ORDER BY version")
        applied = {row[0] for row in cursor.fetchall()}

        # Buscar archivos .sql en el directorio de migraciones
        migration_files = sorted(
            f for f in os.listdir(MIGRATIONS_DIR)
            if f.endswith('.sql')
        )

        applied_count = 0
        for filename in migration_files:
            version = filename.replace('.sql', '')
            if version in applied:
                continue

            filepath = os.path.join(MIGRATIONS_DIR, filename)
            logger.info("Aplicando migración: %s", filename)

            with open(filepath, 'r', encoding='utf-8') as f:
                sql = f.read()

            try:
                cursor.execute(sql)
                cursor.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s)",
                    (version,)
                )
                conn.commit()
                applied_count += 1
                logger.info("Migración %s aplicada correctamente", filename)
            except Exception as e:
                conn.rollback()
                logger.error("Error aplicando migración %s: %s", filename, e)
                raise

        if applied_count == 0:
            logger.info("Base de datos actualizada, no hay migraciones pendientes")
        else:
            logger.info("Se aplicaron %d migraciones", applied_count)
