#!/bin/bash
# Cloud sessions start from a fresh clone: install deps once so `npm run check` works on the first try.
# Quiet on purpose — anything printed here lands in every session's context.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}"
[ -d node_modules ] || npm ci --silent --no-audit --no-fund >/dev/null 2>&1 || echo "session-start: npm ci failed; run it manually"
