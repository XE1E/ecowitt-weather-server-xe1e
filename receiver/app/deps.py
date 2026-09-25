"""Comprobaciones comunes de los endpoints (main.py y app/routers/*)."""
from typing import Optional

from fastapi import HTTPException

from .services import admin as adminsvc


def require_admin(authorization: Optional[str]) -> None:
    """401 si la cabecera Authorization no trae una sesión de admin válida."""
    if not adminsvc.valid_session(adminsvc.bearer_token(authorization)):
        raise HTTPException(status_code=401, detail="No autorizado")
