#!/usr/bin/env bash
# Render a Mermaid .mmd to PNG. Portable: finds a Chromium for puppeteer so it
# works even when mermaid-cli's bundled browser isn't installed.
# Usage: render-mermaid.sh <input.mmd> <output.png> [scale]
set -euo pipefail
IN="${1:?input .mmd required}"; OUT="${2:?output .png required}"; SCALE="${3:-3}"
DIR="$(dirname "$OUT")"; mkdir -p "$DIR"

# locate a system Chrome/Chromium across platforms
CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)" \
  "$(command -v chromium-browser || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
done

PP="$DIR/.puppeteer.json"
if [ -n "$CHROME" ]; then
  printf '{"executablePath":"%s","args":["--no-sandbox"]}' "$CHROME" > "$PP"
  PPFLAG=(-p "$PP")
else
  echo "no system Chrome found; relying on mermaid-cli's bundled browser" >&2
  PPFLAG=()
fi

pnpm dlx @mermaid-js/mermaid-cli -i "$IN" -o "$OUT" -t neutral -b white --scale "$SCALE" "${PPFLAG[@]}"
echo "rendered: $OUT"
