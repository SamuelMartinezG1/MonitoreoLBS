#!/usr/bin/env bash
# ============================================================
#  TryCloudflare — Quick Tunnel para testing/demo
#  Genera un subdominio aleatorio https://xxx.trycloudflare.com
#  sin cuenta, dominio ni configuración DNS.
# ============================================================
set -euo pipefail

PORT="${1:-80}"

# ── Colores ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Instalar cloudflared si no existe ────────────────────────
if ! command -v cloudflared &>/dev/null; then
    echo -e "${YELLOW}cloudflared no encontrado. Instalando...${NC}"
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
        | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
        | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
    sudo apt-get update -qq && sudo apt-get install -y -qq cloudflared
    echo -e "${GREEN}cloudflared instalado correctamente.${NC}"
fi

# ── Verificar que el puerto local responda ───────────────────
if ! curl -sf -o /dev/null "http://localhost:${PORT}"; then
    echo -e "${RED}ERROR: localhost:${PORT} no responde.${NC}"
    echo "Asegúrate de que Nginx/Docker esté corriendo:"
    echo "  docker compose up -d"
    exit 1
fi

# ── Advertencias ─────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        TryCloudflare — Quick Tunnel (Testing)          ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║${NC}  ${YELLOW}⚠  Solo para testing/demo, NO para producción${NC}         ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  • La URL cambia cada vez que se ejecuta              ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  • Límite ~200 requests concurrentes                  ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  • No requiere cuenta ni dominio                      ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  • Ctrl+C para cerrar el tunnel                       ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Iniciando Quick Tunnel → localhost:${PORT} ...${NC}"
echo ""

# ── Ejecutar Quick Tunnel ────────────────────────────────────
# cloudflared imprime la URL asignada en stderr con formato:
#   INF +-----------------------------------------------------------+
#   INF |  https://random-string.trycloudflare.com                  |
#   INF +-----------------------------------------------------------+
cloudflared tunnel --url "http://localhost:${PORT}"
