# syntax=docker/dockerfile:1
# One image for the API, the Celery worker/beat and the SMTP receiver. The React app is built
# in the first stage and served by FastAPI from /app/static (same origin → no CORS needed).

FROM node:22.11.0-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12.8-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FRONTEND_DIST=/app/static
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 --home /app app && chown -R app:app /app
USER app
EXPOSE 8000 2525
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
