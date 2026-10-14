#!/usr/bin/env sh
# Lite local mode (no Docker): SQLite + local files + built-in SMTP on 2525.
# Prerequisites: Python 3.12, Node 20+.  Run from the repository root:  sh scripts/run-lite.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
[ -f dist/index.html ] || { npm install && npm run build; }
cd "$ROOT/backend"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -r requirements.txt; }
export FRONTEND_DIST="$ROOT/frontend/dist"
export DEMO_MODE="${DEMO_MODE:-true}"
exec .venv/bin/python -m app.devserver
