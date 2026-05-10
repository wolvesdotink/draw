#!/usr/bin/env bash
# Rasterize dmg-background.svg → dmg-background.png at 1440×960.
# Mirrors the pattern of generate-icons.sh — the source of truth is the
# SVG; the PNG is regenerated and committed so CI doesn't need a rasterizer.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Need rsvg-convert. Install with: brew install librsvg"
  exit 1
fi

if ! fc-list 2>/dev/null | grep -qi "JetBrains Mono"; then
  echo "Note: JetBrains Mono not installed — text will use the fontconfig fallback."
  echo "      Install with: brew install --cask font-jetbrains-mono"
fi

rsvg-convert -w 1440 -h 960 dmg-background.svg -o dmg-background.png
echo "✓ Generated dmg-background.png (1440×960)"
