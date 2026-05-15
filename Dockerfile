# ============================================================================
# LBS Monitor — imagen del portal (Flask + Socket.IO + SNMP/Modbus + Frontend)
# ============================================================================
# Multi-stage:
#   builder → instala dependencias en site-packages estándar
#   runtime → copia site-packages + el código fuente
#
# Build:        docker build -t lbs/portal:latest .
# Compose:      docker compose build portal
# Tag/push:     docker tag lbs/portal:latest registry.example.com/lbs/portal:v1
#               docker push registry.example.com/lbs/portal:v1
# ============================================================================

# ---------------- STAGE 1 — builder ---------------- #
FROM python:3.10-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Dependencias de compilación para psycopg, bcrypt y SNMP.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev libffi-dev gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .

# Instala todo en site-packages estándar — preserva entry points (gunicorn, etc.)
RUN pip install --no-cache-dir -r requirements.txt


# ---------------- STAGE 2 — runtime ---------------- #
FROM python:3.10-slim AS runtime

LABEL org.opencontainers.image.title="LBS Monitor Portal" \
      org.opencontainers.image.description="Portal SCADA UPS (Flask + Socket.IO + nuevo diseño)" \
      org.opencontainers.image.vendor="LBS Power Systems" \
      org.opencontainers.image.source="https://github.com/lbs/monitoreo-lbs" \
      org.opencontainers.image.licenses="Proprietary"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=5000

# Dependencias de runtime: psql client, snmp tools, ping, traceroute,
# ip / iproute2 (rutas + interfaces), zerotier-cli (si está disponible),
# curl para healthcheck, tini para reaping de procesos.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 snmp iputils-ping iputils-tracepath traceroute iproute2 \
        net-tools dnsutils curl tini \
    && rm -rf /var/lib/apt/lists/*

# Usuario no-root.
RUN useradd --uid 1000 --create-home --home-dir /home/lbs --shell /bin/bash lbs

# Copiar paquetes Python desde el builder a la ubicación estándar de Python.
COPY --from=builder /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

WORKDIR /app

# Copiar código (orden de menor → mayor cambio para cache).
COPY --chown=lbs:lbs migrations/   ./migrations/
COPY --chown=lbs:lbs app/          ./app/
COPY --chown=lbs:lbs run_monitor.py ./

# Healthcheck contra el endpoint /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${APP_PORT:-5000}/health" || exit 1

EXPOSE 5000

USER lbs

# tini para reaping correcto de procesos hijo (gunicorn + workers eventlet).
# Forma shell para expandir $APP_PORT en runtime.
ENTRYPOINT ["/usr/bin/tini", "--", "sh", "-c"]

# Producción: 1 worker eventlet (Socket.IO exige worker único).
CMD ["exec gunicorn \
        --worker-class eventlet \
        -w 1 \
        --bind 0.0.0.0:${APP_PORT:-5000} \
        --timeout 120 \
        --graceful-timeout 30 \
        --access-logfile - \
        --error-logfile - \
        run_monitor:app"]
