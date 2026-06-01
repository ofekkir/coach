#!/usr/bin/env bash
#
# Claude Code PostToolUse hook: auto-formats and lints a file right after Claude
# edits it, then feeds any remaining lint errors back to Claude (exit code 2).
#
# This is the agent-loop counterpart to the git pre-commit hook. The pre-commit
# hook + CI are the authoritative gates; this one just shortens the feedback loop.
set -euo pipefail

# The full tool-call payload arrives as JSON on stdin. Pull out the edited file.
input="$(cat)"
file_path="$(
  printf '%s' "$input" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        process.stdout.write(j?.tool_input?.file_path ?? "");
      } catch {
        process.stdout.write("");
      }
    });
  '
)"

[ -z "$file_path" ] && exit 0
[ -f "$file_path" ] || exit 0

case "$file_path" in
  *.ts | *.tsx | *.js | *.cjs | *.mjs) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}"

# Dependencies may not be installed yet (e.g. before the first `pnpm install`).
command -v pnpm >/dev/null 2>&1 || exit 0
[ -d node_modules ] || exit 0

pnpm exec prettier --write "$file_path" >/dev/null 2>&1 || true

if ! out="$(pnpm exec eslint --fix --max-warnings=0 --no-warn-ignored "$file_path" 2>&1)"; then
  {
    echo "ESLint reported unresolved issues in $file_path:"
    echo "$out"
  } >&2
  exit 2
fi

exit 0
