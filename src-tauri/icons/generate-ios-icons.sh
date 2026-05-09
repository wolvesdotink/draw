#!/usr/bin/env bash
#
# Regenerate all iOS app icon PNGs from icon-ios.svg.
#
# iOS applies its own continuous-curve mask to app icons, so the iOS
# source is a full-bleed black square (icon-ios.svg) rather than the
# Big Sur squircle used for macOS/Windows/Linux (icon.svg).
#
# Writes to both the source-tree copy (src-tauri/icons/ios/) and the
# Xcode-consumed copy (src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/).
#
# Requires: rsvg-convert (brew install librsvg).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_SVG="$SCRIPT_DIR/icon-ios.svg"
OUT_DIRS=(
  "$SCRIPT_DIR/ios"
  "$SCRIPT_DIR/../gen/apple/Assets.xcassets/AppIcon.appiconset"
)

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "error: rsvg-convert not found. Install with: brew install librsvg" >&2
  exit 1
fi

if [[ ! -f "$SRC_SVG" ]]; then
  echo "error: $SRC_SVG not found" >&2
  exit 1
fi

# filename:pixel-size pairs derived from Contents.json (size * scale).
SPECS=(
  "AppIcon-20x20@1x.png:20"
  "AppIcon-20x20@2x.png:40"
  "AppIcon-20x20@2x-1.png:40"
  "AppIcon-20x20@3x.png:60"
  "AppIcon-29x29@1x.png:29"
  "AppIcon-29x29@2x.png:58"
  "AppIcon-29x29@2x-1.png:58"
  "AppIcon-29x29@3x.png:87"
  "AppIcon-40x40@1x.png:40"
  "AppIcon-40x40@2x.png:80"
  "AppIcon-40x40@2x-1.png:80"
  "AppIcon-40x40@3x.png:120"
  "AppIcon-60x60@2x.png:120"
  "AppIcon-60x60@3x.png:180"
  "AppIcon-76x76@1x.png:76"
  "AppIcon-76x76@2x.png:152"
  "AppIcon-83.5x83.5@2x.png:167"
  "AppIcon-512@2x.png:1024"
)

for out_dir in "${OUT_DIRS[@]}"; do
  if [[ ! -d "$out_dir" ]]; then
    echo "error: output directory not found: $out_dir" >&2
    exit 1
  fi
  echo "→ $out_dir"
  for spec in "${SPECS[@]}"; do
    name="${spec%%:*}"
    size="${spec##*:}"
    rsvg-convert -w "$size" -h "$size" "$SRC_SVG" -o "$out_dir/$name"
    echo "  ${name} (${size}x${size})"
  done
done

echo "done."
