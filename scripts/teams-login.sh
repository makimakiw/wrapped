#!/usr/bin/env bash
# Engångs-inloggning för Teams/M365 i Weekly Wrap.
# Kör i din egen terminal (kräver interaktiva val):

set -euo pipefail

echo "=== Third Act Weekly Wrap — Teams-inloggning ==="
echo ""
echo "Steg 1: Skapa Entra-app (engångs) via M365 CLI wizard"
echo "  → Välj: Create a new app registration"
echo "  → Välj: Full set of permissions (enklast)"
echo "  → Välj: Interactive use"
echo ""

if ! command -v m365 >/dev/null; then
  echo "Installerar M365 CLI…"
  npm install -g @pnp/cli-microsoft365
fi

echo "Startar m365 setup (interaktiv)…"
m365 setup

echo ""
echo "Steg 2: Logga in med device code (öppnar webbläsare)…"
m365 login --authType deviceCode

echo ""
echo "Steg 3: Verifierar…"
m365 status

echo ""
echo "Klart! Kör sedan: npm run fetch"
