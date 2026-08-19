FROM python:3.11-slim

WORKDIR /app

# ffmpeg: junta las fotos del dia en el timelapse diario (services/timelapse.py).
# Es un encode al dia de ~170 fotogramas, no una transcodificacion continua --que es
# lo que el ARM del free tier de Oracle no aguantaria--. Va ANTES de instalar las
# dependencias de Python para que un cambio en requirements.txt no rehaga esta capa,
# que es la lenta de las dos en ARM.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app/ ./app/

# Commit desplegado (se pasa como build arg en el deploy) para /admin/updates.
# Va después del COPY para no invalidar la caché de dependencias.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

# Expose port
EXPOSE 8080

# Run application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
