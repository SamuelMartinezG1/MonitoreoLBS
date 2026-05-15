#!/bin/bash
# setup_zerotier.sh — prepara ZeroTier para que MonitoreoLBS pueda gestionarlo.
#
# Lo que hace:
#   1. Verifica que zerotier-one esté instalado y corriendo.
#   2. Copia el authtoken a /etc/lbs/zerotier-token con permisos 0644 para que
#      el contenedor pueda leerlo (uid 1000 / user `lbs`).
#   3. Imprime el node ID local y la lista de networks actuales.
#
# Uso (en el host Ubuntu, con sudo):
#   sudo ./scripts/setup_zerotier.sh
#
# Si nunca has instalado ZeroTier:
#   curl -s https://install.zerotier.com | sudo bash

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "✗ Este script debe correrse como root (sudo)." >&2
    exit 1
fi

echo "→ Verificando ZeroTier..."
if ! command -v zerotier-cli >/dev/null 2>&1; then
    echo "✗ zerotier-cli no está instalado." >&2
    echo "  Instala con: curl -s https://install.zerotier.com | sudo bash" >&2
    exit 1
fi

if ! systemctl is-active --quiet zerotier-one; then
    echo "→ Servicio zerotier-one inactivo, intentando arrancarlo..."
    systemctl start zerotier-one
    sleep 2
fi

if ! systemctl is-active --quiet zerotier-one; then
    echo "✗ No se pudo iniciar zerotier-one. Revisa: systemctl status zerotier-one" >&2
    exit 1
fi

echo "✓ zerotier-one corriendo."

SRC=/var/lib/zerotier-one/authtoken.secret
DST=/etc/lbs/zerotier-token

if [ ! -f "$SRC" ]; then
    echo "✗ No se encontró $SRC" >&2
    echo "  ¿ZeroTier se acaba de instalar? Espera unos segundos y reintenta." >&2
    exit 1
fi

echo "→ Copiando authtoken a $DST con permisos 0644 (para que el contenedor lo lea)..."
install -d -m 0755 /etc/lbs
install -m 0644 "$SRC" "$DST"
echo "✓ Token disponible en $DST"

NODE_ID=$(zerotier-cli info | awk '{print $3}')
echo
echo "════════════════════════════════════════════════════════"
echo " Nodo ZeroTier local: $NODE_ID"
echo "════════════════════════════════════════════════════════"
echo
echo "Networks actualmente unidas:"
zerotier-cli listnetworks
echo
echo "→ Para unirte a una network nueva desde la línea de comandos:"
echo "    sudo zerotier-cli join <16-hex-network-id>"
echo "  ...o desde el portal: Diagnóstico → ZeroTier → Unirse"
echo
echo "→ No olvides AUTORIZAR este nodo ($NODE_ID) en"
echo "  https://my.zerotier.com/network/<network_id>"
echo
echo "Listo. Reinicia el portal:  docker compose up -d portal"
