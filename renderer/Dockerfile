# Imagen oficial de Playwright: ya trae Chromium + todas las libs del sistema
# (fuentes, deps de render) con la versión emparejada a playwright 1.48.
FROM mcr.microsoft.com/playwright/python:v1.48.0-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
