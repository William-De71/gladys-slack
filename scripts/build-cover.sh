#!/usr/bin/env bash
# Builds cover.jpg (800 x 534, < 150 KB, as the store requires) from
# docs/assets/cover.svg. Needs Inkscape and ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp --suffix=.png)"
trap 'rm -f "$tmp"' EXIT
inkscape docs/assets/cover.svg --export-type=png --export-filename="$tmp" -w 800 -h 534 >/dev/null 2>&1
magick "$tmp" -strip -quality 85 -sampling-factor 4:2:0 cover.jpg
size="$(stat -c %s cover.jpg)"
dims="$(magick identify -format '%wx%h' cover.jpg)"
echo "cover.jpg: ${dims}, ${size} bytes"
[ "$dims" = "800x534" ] || { echo "wrong dimensions" >&2; exit 1; }
[ "$size" -lt $((150 * 1024)) ] || { echo "too heavy" >&2; exit 1; }
