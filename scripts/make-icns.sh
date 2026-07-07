#!/bin/bash
# Regenerates resources/icon.icns (and icon.png) from scripts/generate-icon.swift.
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

swift scripts/generate-icon.swift "$TMP/AppIcon.iconset"
mkdir -p resources
iconutil -c icns -o resources/icon.icns "$TMP/AppIcon.iconset"
cp "$TMP/AppIcon.iconset/icon_512x512.png" resources/icon.png
echo "resources/icon.icns + resources/icon.png updated"
