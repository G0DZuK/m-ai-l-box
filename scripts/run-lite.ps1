# Lite local mode on Windows (no Docker): SQLite + local files + built-in SMTP on 2525.
# Prerequisites: Python 3.12, Node 20+.  Run from the repository root:  .\scripts\run-lite.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "frontend")
if (-not (Test-Path "dist\index.html")) { npm install; npm run build }
Set-Location (Join-Path $root "backend")
if (-not (Test-Path ".venv")) { python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements.txt }
$env:FRONTEND_DIST = (Join-Path $root "frontend\dist")
if (-not $env:DEMO_MODE) { $env:DEMO_MODE = "true" }
.\.venv\Scripts\python -m app.devserver
