#!/usr/bin/env bash
# Build a friend-shareable zip of the LinkedIn Scout extension:
# same code, but with the neutral README (README-share.md) as README.md
# and Parth-specific docs removed. Output: ~/jobpulse-scout-share.zip
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/extension"
OUT="${1:-$HOME/jobpulse-scout-share.zip}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -r "$SRC" "$STAGE/jobpulse-scout"
mv "$STAGE/jobpulse-scout/README-share.md" "$STAGE/jobpulse-scout/README.md"

rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" jobpulse-scout)
echo "Share zip written to: $OUT"
unzip -l "$OUT" | tail -3
