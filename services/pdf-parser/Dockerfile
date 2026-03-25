FROM python:3.12-slim

WORKDIR /app

# Install Java for tabula-py
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless curl \
    && rm -rf /var/lib/apt/lists/*

COPY services/pdf-parser/pyproject.toml ./
RUN pip install --no-cache-dir .

COPY services/pdf-parser/src/ ./src/

EXPOSE 5000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "5000"]
