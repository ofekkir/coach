#!/usr/bin/env sh
# Prepares local enrichment: verifies the Ollama daemon is reachable and pulls
# the labeling model. Ollama is a system binary (not an npm dep), so this is a
# one-time, out-of-band setup that `pnpm install` does not cover.
set -e

MODEL="${OLLAMA_MODEL:-llama3.2:3b}"
HOST="${OLLAMA_HOST:-http://localhost:11434}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama not found." >&2
  echo "Install the app bundle:  brew install --cask ollama" >&2
  echo "(the 'ollama' formula ships without llama-server — use the cask)" >&2
  exit 1
fi

if ! curl -fsS -m 3 "$HOST/api/tags" >/dev/null 2>&1; then
  echo "Ollama daemon not reachable at $HOST." >&2
  echo "Start it:  open -a Ollama   (or: ollama serve)" >&2
  exit 1
fi

echo "Pulling $MODEL ..."
ollama pull "$MODEL"
echo "Local enrichment ready. Run:  pnpm e2e <path> --enrich"
