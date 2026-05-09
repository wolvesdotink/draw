#!/usr/bin/env bash
#
# Regenerate every committed icon asset from the two SVG sources via
# `pnpm tauri icon`. Replaces the old generate-mac-icons.sh /
# generate-ios-icons.sh pair, which used rsvg-convert directly and
# produced RGB (alpha-stripped) PNGs that tauri::generate_context!()
# rejects with "icon ... is not RGBA".
#
# Visual split (matches comments in icon.svg / icon-ios.svg):
#   icon-ios.svg (full-bleed black square) drives:
#     32x32.png, 128x128.png, 128x128@2x.png, icon.icns, icon.png (Linux),
#     ios/AppIcon-*.png + ios/Contents.json
#   icon.svg (squircle) drives:
#     icon.ico, Square*Logo.png, StoreLogo.png, android/**
#
# After regen, ios/* is mirrored into the Xcode-consumed copy at
# gen/apple/Assets.xcassets/AppIcon.appiconset/.
#
# Requires: pnpm + a working tauri CLI (already a project dev dep).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ICONS_DIR="$SCRIPT_DIR"
APPICONSET_DIR="$PROJECT_DIR/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset"

BLEED_SVG="$ICONS_DIR/icon-ios.svg"
SQUIRCLE_SVG="$ICONS_DIR/icon.svg"

[[ -f "$BLEED_SVG"    ]] || { echo "error: $BLEED_SVG not found"    >&2; exit 1; }
[[ -f "$SQUIRCLE_SVG" ]] || { echo "error: $SQUIRCLE_SVG not found" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BLEED_OUT="$TMP/bleed"
SQUIRCLE_OUT="$TMP/squircle"
mkdir -p "$BLEED_OUT" "$SQUIRCLE_OUT"

cd "$PROJECT_DIR"

echo "→ tauri icon (full-bleed, black iOS bg)"
pnpm tauri icon "$BLEED_SVG"    --output "$BLEED_OUT"    --ios-color "#000000"

echo "→ tauri icon (squircle)"
pnpm tauri icon "$SQUIRCLE_SVG" --output "$SQUIRCLE_OUT"

echo "→ cherry-picking full-bleed outputs"
# Bundle PNGs that Tauri's generate_context!() validates as RGBA.
cp "$BLEED_OUT/32x32.png"        "$ICONS_DIR/"
cp "$BLEED_OUT/128x128.png"      "$ICONS_DIR/"
cp "$BLEED_OUT/128x128@2x.png"   "$ICONS_DIR/"
cp "$BLEED_OUT/icon.icns"        "$ICONS_DIR/"
# Standalone 512px (Linux fallback / generic).
cp "$BLEED_OUT/icon.png"         "$ICONS_DIR/"
# iOS appiconset (source-tree copy).
rm -rf "$ICONS_DIR/ios"
cp -R  "$BLEED_OUT/ios"          "$ICONS_DIR/ios"

echo "→ cherry-picking squircle outputs"
cp "$SQUIRCLE_OUT/icon.ico"            "$ICONS_DIR/"
cp "$SQUIRCLE_OUT"/Square*Logo.png     "$ICONS_DIR/"
cp "$SQUIRCLE_OUT/StoreLogo.png"       "$ICONS_DIR/"
rm -rf "$ICONS_DIR/android"
cp -R  "$SQUIRCLE_OUT/android"         "$ICONS_DIR/android"

echo "→ syncing iOS appiconset → gen/apple"
if [[ -d "$APPICONSET_DIR" ]]; then
  rm -f "$APPICONSET_DIR"/AppIcon-*.png
  cp "$ICONS_DIR/ios"/AppIcon-*.png "$APPICONSET_DIR/"
  if [[ -f "$ICONS_DIR/ios/Contents.json" ]]; then
    cp "$ICONS_DIR/ios/Contents.json" "$APPICONSET_DIR/Contents.json"
  fi
else
  echo "  (skipped — $APPICONSET_DIR not initialised; run 'pnpm tauri ios init' first)"
fi

echo "done."
