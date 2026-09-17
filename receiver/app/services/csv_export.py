"""
Exportar filas de datos (como las que devuelven /api/history y
/api/summaries/daily) a CSV.

Las filas vienen de Influx ya "pivoteadas" (un dict por punto en el tiempo),
pero no todas comparten exactamente las mismas columnas -- un sensor que se
desconectó un rato, o un campo que se agregó después, deja huecos. Por eso no
alcanza con `csv.DictWriter(fieldnames=rows[0].keys())`: hay que sacar la
UNIÓN de columnas de todas las filas, o se pierden datos en silencio.
"""
import csv
import io
import re
from typing import Any, Dict, List

# Claves que van primero si existen (el "eje" de tiempo de la fila), en el
# orden de preferencia. El resto de columnas se ordena alfabéticamente detrás
# para que la salida sea determinista entre llamadas.
_LEADING_KEYS = ("_time", "date")


def rows_to_csv(rows: List[Dict[str, Any]]) -> str:
    """Convierte una lista de dicts (posiblemente con distintas claves) a CSV."""
    if not rows:
        return ""

    all_keys: set = set()
    for row in rows:
        all_keys.update(row.keys())

    leading = [k for k in _LEADING_KEYS if k in all_keys]
    rest = sorted(k for k in all_keys if k not in leading)
    fieldnames = leading + rest

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, restval="", extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


def safe_filename_part(value: str) -> str:
    """Sanea un fragmento (fecha/rango/nombre de estación) para usarlo en un
    nombre de archivo descargable (Content-Disposition) sin caracteres que
    Windows/otros navegadores rechacen (`: / \\ ? * " < > |`)."""
    return re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_-") or "datos"
