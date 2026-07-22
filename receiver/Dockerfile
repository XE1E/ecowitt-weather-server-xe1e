FROM python:3.11-slim

WORKDIR /app

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
