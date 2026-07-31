# バックエンド（FastAPI + uvicorn）。uv でロックどおりに依存を入れる。
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

# SQLite（定義＋記録）は /app/data に置く（compose が ./data を bind mount する）
ENV SUMMER_DATA_DIR=/app/data \
    PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
