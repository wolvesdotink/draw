#!/usr/bin/env bash
set -euo pipefail

BUMP_TYPE="${1:-}"

usage() {
  echo "Usage: $0 [major|minor|patch]"
  exit 1
}

if [[ -z "$BUMP_TYPE" ]]; then usage; fi
case "$BUMP_TYPE" in major|minor|patch) ;; *) usage ;; esac

# Ensure clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree has uncommitted changes. Commit or stash them first."
  exit 1
fi

# Read current version from package.json
CURRENT=$(node -p "require('./package.json').version")

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"
TAG="v$NEW"

echo "Bumping $CURRENT → $NEW"

# package.json
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '$NEW';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"

# src-tauri/Cargo.toml — only the first occurrence (the package version)
sed -i '' "0,/^version = \"$CURRENT\"/{s/^version = \"$CURRENT\"/version = \"$NEW\"/}" src-tauri/Cargo.toml

# src-tauri/tauri.conf.json
node -e "
  const fs = require('fs');
  const c = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  c.version = '$NEW';
  fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(c, null, 2) + '\n');
"

# iOS Info.plist (CFBundleShortVersionString + CFBundleVersion)
PLIST="src-tauri/gen/apple/draw_iOS/Info.plist"
sed -i '' "s/<string>$CURRENT<\/string>/<string>$NEW<\/string>/g" "$PLIST"

# iOS project.yml — source-of-truth for regenerating the Xcode project
PROJECT_YML="src-tauri/gen/apple/project.yml"
sed -i '' -E "s/(CFBundleShortVersionString: )$CURRENT/\1$NEW/" "$PROJECT_YML"
sed -i '' -E "s/(CFBundleVersion: \")$CURRENT(\")/\1$NEW\2/" "$PROJECT_YML"

# Refresh Cargo.lock so the draw package version matches Cargo.toml
(cd src-tauri && cargo update -p draw --precise "$NEW")

# Commit and tag
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json "$PLIST" "$PROJECT_YML"
git commit -m "chore: bump version to $NEW"
git tag "$TAG"
git push origin HEAD
git push origin "$TAG"

echo "Released $TAG"
