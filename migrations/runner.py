"""
Ejecutor de migraciones SQL para PostgreSQL.

Trackea migraciones aplicadas en la tabla `schema_migrations`. Cada archivo
.sql se ejecuta en una transacción explícita; si falla, se hace rollback y
se aborta el resto. Funciona incluso con el pool en `autocommit=True`
porque `conn.transaction()` (psycopg 3) abre un BEGIN propio.
"""
import os
import logging

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = os.path.dirname(os.path.abspath(__file__))


def _row_to_version(row):
    if isinstance(row, dict):
        return row.get('version')
    return row[0]


def run_migrations(pool):
    """Ejecuta todas las migraciones pendientes en orden alfabético."""
    # 1. Crear / leer tabla de tracking.
    with pool.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version    TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("SELECT version FROM schema_migrations")
            applied = {_row_to_version(r) for r in cur.fetchall()}

    # 2. Descubrir archivos. Orden numérico por prefijo (001, 002, ... 010,
    #    011) para evitar el orden lexicográfico erróneo si conviven nombres
    #    como "01_x.sql" y "001_x.sql".
    def _mig_key(fname):
        prefix = fname.split('_', 1)[0]
        try:
            return (0, int(prefix))
        except ValueError:
            return (1, fname)  # sin prefijo numérico: al final, alfabético

    migration_files = sorted(
        (f for f in os.listdir(MIGRATIONS_DIR) if f.endswith('.sql')),
        key=_mig_key,
    )

    # 3. Aplicar pendientes en transacciones explícitas.
    applied_count = 0
    for filename in migration_files:
        version = filename.replace('.sql', '')
        if version in applied:
            continue

        filepath = os.path.join(MIGRATIONS_DIR, filename)
        logger.info("Aplicando migración: %s", filename)

        with open(filepath, 'r', encoding='utf-8') as f:
            sql = f.read()

        with pool.get_connection() as conn:
            try:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute(sql)
                        cur.execute(
                            "INSERT INTO schema_migrations (version) VALUES (%s)",
                            (version,),
                        )
                applied_count += 1
                logger.info("Migración %s aplicada", filename)
            except Exception as e:
                logger.error("Error aplicando migración %s: %s", filename, e)
                raise

    if applied_count == 0:
        logger.info("Base de datos al día, no hay migraciones pendientes")
    else:
        logger.info("Se aplicaron %d migración(es)", applied_count)
