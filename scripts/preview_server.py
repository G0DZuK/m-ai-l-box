"""Launch the lite dev server from any working directory (used by editor/preview launchers).

    <venv python> scripts/preview_server.py
"""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
backend = root / "backend"
os.chdir(backend)
sys.path.insert(0, str(backend))
os.environ.setdefault("FRONTEND_DIST", str(root / "frontend" / "dist"))
os.environ.setdefault("DEMO_MODE", "true")

from app.devserver import main  # noqa: E402

main()
