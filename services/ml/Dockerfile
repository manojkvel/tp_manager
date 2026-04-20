# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for tp-ml (AD-10)

FROM python:3.11-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY services/ml/pyproject.toml ./
RUN pip install --upgrade pip && pip install hatchling
COPY services/ml/src ./src
RUN pip install --target=/install .

FROM python:3.11-slim-bookworm AS runner
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/lib \
    APP_VERSION=0.1.0 \
    PORT=8000
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r app && useradd -r -g app app
WORKDIR /app
COPY --from=deps --chown=app:app /install /app/lib
COPY --from=deps --chown=app:app /app/src /app/src
ENV PYTHONPATH=/app/lib:/app/src

USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

CMD ["python", "-m", "uvicorn", "tp_ml.main:app", "--host", "0.0.0.0", "--port", "8000"]
