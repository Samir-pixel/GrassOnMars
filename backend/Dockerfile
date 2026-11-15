FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/opt/marswalk/data

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 gdal-bin libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
# Rasters live outside /app: the compose mount of the source tree must not hide them.
COPY data /opt/marswalk/data

EXPOSE 8000

CMD ["python", "-m", "app.bootstrap"]
