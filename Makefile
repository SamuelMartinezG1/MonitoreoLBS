# ============================================================================
# LBS Monitor — Makefile de ayuda para deploy y operación
# ============================================================================
# Uso: `make help`

SHELL := /bin/bash

# Permite override por línea de comandos: `make build TAG=v1.2.3`
TAG     ?= latest
IMAGE   ?= lbs/portal
COMPOSE ?= docker compose

# ----------------------------------------------------------------------------
.PHONY: help
help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-20s\033[0m %s\n",$$1,$$2}'

# ---------------- Imagen ---------------- #
.PHONY: build
build: ## Construye la imagen Docker (TAG=latest por defecto)
	docker build -t $(IMAGE):$(TAG) .

.PHONY: build-nocache
build-nocache: ## Build limpio sin cache
	docker build --no-cache -t $(IMAGE):$(TAG) .

.PHONY: push
push: ## Sube la imagen a tu registry (requiere docker login + retagging previo)
	docker push $(IMAGE):$(TAG)

# ---------------- Compose ---------------- #
.PHONY: up
up: ## Levanta el stack (db + portal) en background
	$(COMPOSE) up -d

.PHONY: up-tunnel
up-tunnel: ## Levanta el stack + Cloudflare Tunnel
	$(COMPOSE) --profile tunnel up -d

.PHONY: down
down: ## Detiene el stack (mantiene volúmenes)
	$(COMPOSE) down

.PHONY: nuke
nuke: ## Detiene y BORRA volúmenes (datos) — ¡ojo!
	$(COMPOSE) down -v

.PHONY: restart
restart: ## Reinicia solo el portal
	$(COMPOSE) restart portal

.PHONY: rebuild
rebuild: ## Rebuild + restart del portal
	$(COMPOSE) build portal && $(COMPOSE) up -d portal

.PHONY: migrate
migrate: ## Aplica migraciones SQL pendientes sin reiniciar el portal
	$(COMPOSE) exec portal python -c "from app.base_datos import GestorDB; from migrations.runner import run_migrations; run_migrations(GestorDB().pool)"

# ---------------- Logs / debug ---------------- #
.PHONY: logs
logs: ## Logs del portal en vivo
	$(COMPOSE) logs -f --tail=200 portal

.PHONY: logs-db
logs-db: ## Logs de Postgres
	$(COMPOSE) logs -f --tail=200 db

.PHONY: ps
ps: ## Estado de los servicios
	$(COMPOSE) ps

.PHONY: shell
shell: ## Bash dentro del contenedor del portal
	$(COMPOSE) exec portal bash

.PHONY: psql
psql: ## psql interactivo
	$(COMPOSE) exec db psql -U $${DB_USER:-guia_app} -d $${DB_NAME:-guia_instalacion}

# ---------------- Sanity / verificación ---------------- #
.PHONY: health
health: ## curl al /health del portal
	@curl -fsS http://127.0.0.1:$${APP_PORT:-5000}/health && echo "" || echo "DOWN"

.PHONY: lint
lint: ## Sintaxis Python + Jinja
	python3 -m py_compile run_monitor.py app/auth.py app/permisos.py app/extensions.py app/base_datos.py app/routes/*.py app/services/*.py app/services/protocols/*.py
	@python3 -c "from jinja2 import Environment, FileSystemLoader; \
e=Environment(loader=FileSystemLoader('app/templates')); \
import os; \
[e.get_template(os.path.relpath(os.path.join(r,f),'app/templates')) \
  for r,_,fs in os.walk('app/templates') for f in fs if f.endswith('.html')]; \
print('jinja OK')"
