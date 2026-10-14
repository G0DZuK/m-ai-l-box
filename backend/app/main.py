"""FastAPI application factory."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .logging_conf import configure_logging
from .services import ServiceError

API_JSON_LIMIT = 1024 * 1024  # non-upload, non-inbound request bodies
SPA_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; "
    "frame-src 'self' blob: data:; object-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


def create_app() -> FastAPI:
    s = get_settings()
    configure_logging(s.log_level)
    if s.environment == "production" and s.secret_key.startswith("dev-"):
        raise RuntimeError("SECRET_KEY must be set to a long random value in production")

    app = FastAPI(
        title="M-Ai-L Box API",
        version="1.0.0",
        description="Disposable inboxes for QA testing. See docs/API.md for authentication and examples.",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    @app.exception_handler(ServiceError)
    async def _service_error(_: Request, exc: ServiceError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/") and not (path.startswith("/api/files") or path.startswith("/api/inbound")):
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > API_JSON_LIMIT:
                return JSONResponse({"detail": "Request body too large"}, status_code=413)
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
        if path.startswith("/api/"):
            h.setdefault("Cache-Control", "no-store")  # Swagger UI at /api/docs loads assets from a CDN
        else:
            h.setdefault("Content-Security-Policy", SPA_CSP)
        if s.environment == "production":
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    if s.cors_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=s.cors_origins, allow_methods=["*"],
            allow_headers=["Authorization", "X-Mailbox-Token", "Content-Type"], allow_credentials=False,
        )

    from . import demo
    from .routers import admin, api_keys, attachments, auth, files, inbound, mailboxes, messages, meta

    for r in (meta.router, mailboxes.router, messages.router, attachments.router, auth.router, files.router,
              api_keys.router, admin.router, inbound.router, demo.router):
        app.include_router(r)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def api_not_found(rest: str):
        return JSONResponse({"detail": "Not found"}, status_code=404)

    dist = Path(s.frontend_dist) if s.frontend_dist else None
    if dist and (dist / "index.html").exists():
        if (dist / "assets").exists():
            app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
        index = dist / "index.html"

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and dist.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(index)

    return app


app = create_app()
