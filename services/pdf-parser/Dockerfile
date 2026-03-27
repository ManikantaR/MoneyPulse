FROM python:3.12-slim

WORKDIR /app

# Install Java for tabula-py and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY services/pdf-parser/pyproject.toml ./
RUN pip install --no-cache-dir .

# Copy application code
COPY services/pdf-parser/src/ ./src/

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "5000"]
