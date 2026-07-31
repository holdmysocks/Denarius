FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (curl for healthcheck, pg client for backup trigger)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create backups directory (bind mount will overlay this)
RUN mkdir -p /app/backups

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
# The application owns an in-process scheduler. Keep one web worker per container;
# the scheduler also uses a PostgreSQL advisory lock so scaled containers cannot
# run the same scheduled work concurrently.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
