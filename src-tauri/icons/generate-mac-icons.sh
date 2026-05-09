#!/usr/bin/env bash
#
# Regenerate the macOS app icon (.icns + the dock/window PNG sizes
# referenced from tauri.conf.json) from icon-ios.svg.
#
# macOS Tahoe (26) applies a Liquid Glass continuous-curve mask to app
# icons, so the source must be a full-bleed black square — same as iOS.
# Older macOS doesn't mask, but the brutalist square reads fine there too.
#
# We deliberately do NOT touch icon.ico (Windows) or the Square*Logo.png
# tile assets here — those still derive from the squircle icon.svg via
# `pnpm tauri icon`. If you want Windows/Linux to also go full-bleed,
# rerun `pnpm tauri icon` against icon-ios.svg.
#
# Requires: rsvg-convert (brew install librsvg) and iconutil (built-in).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_SVG="$SCRIPT_DIR/icon-ios.svg"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "error: rsvg-convert not found. Install with: brew install librsvg" >&2
  exit 1
fi
if ! command -v iconutil >/dev/null 2>&1; then
  echo "error: iconutil not found (macOS-only)." >&2
  exit 1
fi
if [[ ! -f "$SRC_SVG" ]]; then
  echo "error: $SRC_SVG not found" >&2
  exit 1
fi

# Build the .iconset directory with the standard macOS sizes,
# then compile to icon.icns.
ICONSET_DIR="$(mktemp -d)/draw.iconset"
mkdir -p "$ICONSET_DIR"
trap 'rm -rf "$(dirname "$ICONSET_DIR")"' EXIT

ICONSET_SPECS=(
  "icon_16x16.png:16"
  "icon_16x16@2x.png:32"
  "icon_32x32.png:32"
  "icon_32x32@2x.png:64"
  "icon_128x128.png:128"
  "icon_128x128@2x.png:256"
  "icon_256x256.png:256"
  "icon_256x256@2x.png:512"
  "icon_512x512.png:512"
  "icon_512x512@2x.png:1024"
)

echo "→ rasterising .iconset"
for spec in "${ICONSET_SPECS[@]}"; do
  name="${spec%%:*}"
  size="${spec##*:}"
  rsvg-convert -w "$size" -h "$size" "$SRC_SVG" -o "$ICONSET_DIR/$name"
  echo "  ${name} (${size}x${size})"
done

echo "→ compiling icon.icns"
iconutil -c icns "$ICONSET_DIR" -o "$SCRIPT_DIR/icon.icns"

# Also refresh the standalone PNGs that macOS uses (window icon, dock
# at small sizes, generic Linux fallback). Listed in tauri.conf.json.
PNG_SPECS=(
  "icon.png:512"
  "32x32.png:32"
  "128x128.png:128"
  "128x128@2x.png:256"
)

echo "→ refreshing standalone PNGs"
for spec in "${PNG_SPECS[@]}"; do
  name="${spec%%:*}"
  size="${spec##*:}"
  rsvg-convert -w "$size" -h "$size" "$SRC_SVG" -o "$SCRIPT_DIR/$name"
  echo "  ${name} (${size}x${size})"
done

echo "done."
