#!/bin/bash
# setup_cloudflared.sh — Instalar cloudflared como servicio systemd en Ubuntu
#
# Uso:
#   sudo bash scripts/setup_cloudflared.sh <TUNNEL_TOKEN>
#
# Prerequisitos:
#   1. Dominio propio con nameservers apuntando a Cloudflare
#   2. Tunnel creado en https://one.dash.cloudflare.com/ → Zero Trust → Networks → Tunnels
#   3. En la config del tunnel, agregar Public Hostname:
#      - Subdomain: app (o el que quieras)
#      - Domain: tudominio.com
#      - Service: http://localhost:80
#   4. Copiar el token del tunnel

set -e

TUNNEL_TOKEN="${1:-}"

if [ -z "$TUNNEL_TOKEN" ]; then
    echo "ERROR: Se requiere el token del tunnel como argumento"
    echo "Uso: sudo bash $0 <TUNNEL_TOKEN>"
    echo ""
    echo "Pasos para obtener el token:"
    echo "  1. Ve a https://one.dash.cloudflare.com/"
    echo "  2. Zero Trust → Networks → Tunnels"
    echo "  3. Crea un nuevo tunnel o selecciona uno existente"
    echo "  4. Copia el token de instalación"
    exit 1
fi

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Este script requiere permisos de root"
    echo "Uso: sudo bash $0 <TUNNEL_TOKEN>"
    exit 1
fi

echo "=== Instalando cloudflared ==="

# Agregar repositorio oficial de Cloudflare
if ! command -v cloudflared &> /dev/null; then
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
        | tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null

    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
        | tee /etc/apt/sources.list.d/cloudflared.list

    apt-get update
    apt-get install -y cloudflared
    echo "cloudflared instalado: $(cloudflared --version)"
else
    echo "cloudflared ya está instalado: $(cloudflared --version)"
fi

echo ""
echo "=== Configurando servicio systemd ==="

cloudflared service install "$TUNNEL_TOKEN"

echo ""
echo "=== Verificando servicio ==="
systemctl status cloudflared --no-pager

echo ""
echo "=== Instalación completada ==="
echo ""
echo "Comandos útiles:"
echo "  systemctl status cloudflared    # Ver estado"
echo "  systemctl restart cloudflared   # Reiniciar"
echo "  journalctl -u cloudflared -f    # Ver logs en tiempo real"
echo ""
echo "IMPORTANTE: Asegúrate de configurar el Public Hostname en el dashboard de Cloudflare:"
echo "  Subdomain: app (o el que prefieras)"
echo "  Domain: tudominio.com"
echo "  Service: http://localhost:80"
