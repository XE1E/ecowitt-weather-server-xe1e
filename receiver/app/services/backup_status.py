"""
Estado de los respaldos a R2 (ver docs/internal/PLAN-RESPALDO-R2.md).

Los scripts scripts/backup-*.sh corren por cron en el VPS, FUERA del contenedor,
así que no pueden llamar a este servicio directamente: dejan su estado como un
JSON chico en el volumen compartido (vía `docker compose cp`) tras cada corrida.
Este módulo solo LEE esos archivos, para el panel de Admin y para
`AlertService.check_backup_stale`.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

# Categorías que pueden reportar estado, una por script de scripts/backup-*.sh.
CATEGORIES = ("influx", "fotos", "timelapse", "analisis")


def read_status(base_dir: str, category: str) -> Optional[Dict[str, Any]]:
    """Lee el estado de UNA categoría. None si nunca corrió o el archivo es inválido."""
    path = os.path.join(base_dir, f"status-{category}.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def read_all(base_dir: str) -> Dict[str, Optional[Dict[str, Any]]]:
    """Lee el estado de todas las categorías conocidas."""
    return {cat: read_status(base_dir, cat) for cat in CATEGORIES}
