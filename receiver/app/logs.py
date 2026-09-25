"""Búfer de logs en memoria para el panel de admin (GET /api/admin/logs).

main.py lo registra en el logger raíz al arrancar; el router de admin lo lee.
"""
import logging
from collections import deque
from datetime import datetime, timedelta
from typing import Dict, List


class MemoryLogHandler(logging.Handler):
    def __init__(self, maxlen: int = 500):
        super().__init__()
        self.buffer: deque = deque(maxlen=maxlen)

    def emit(self, record: logging.LogRecord):
        self.buffer.append({
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        })

    def get_logs(self, limit: int = 100) -> List[Dict]:
        return list(self.buffer)[-limit:]

    def get_logs_since(self, minutes: int) -> List[Dict]:
        """
        Filtra por ventana de tiempo en vez de cantidad de líneas: con más
        redes publicando (reintentos incluidos) y más chequeos de alertas, un
        límite fijo de líneas cubre cada vez menos tiempo real según cuánto
        esté pasando en ese momento.
        """
        cutoff = datetime.now() - timedelta(minutes=minutes)
        return [e for e in self.buffer if datetime.fromisoformat(e["timestamp"]) >= cutoff]



memory_log_handler = MemoryLogHandler(maxlen=1500)
