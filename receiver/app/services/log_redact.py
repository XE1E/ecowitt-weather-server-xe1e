"""
Redacción de credenciales en los logs.

httpx registra la URL completa de cada petición saliente, así que el token de
WAQI, el hash de AWEKAS o la clave de WOW-BE acababan en claro en el panel de
Sistema -- y de ahí a una captura o a un pegado de logs. Se separa en su
propio módulo (en vez de vivir inline en main.py) para poder probarlo sin
tener que importar toda la app.
"""
import logging
import re

# Los términos sensibles se buscan como SUBCADENA del nombre del parámetro (no
# palabra completa con \b): varias redes usan camelCase compuesto, p. ej.
# WOW-BE manda "siteAuthenticationKey", que no tiene límite de palabra (\b)
# antes de "Key" -- con un patrón basado en \b(token|key|...)\b= esa
# credencial pasaba en claro al log. Comprobado en producción: se filtró la
# Auth Key de WOW-BE hasta que se corrigió esto.
_REDACT_SENSITIVE_SUBSTR = (
    "token", "key", "password", "passwd", "pwd", "secret", "passcode", "auth",
)
_REDACT_QUERY_RE = re.compile(
    r"(?i)([a-z0-9_]*(?:" + "|".join(_REDACT_SENSITIVE_SUBSTR) + r")[a-z0-9_]*)=([^&\s;\"']+)"
)
# "id" aparte, como PALABRA COMPLETA: es un identificador de estación, no una
# clave -- como subcadena generaría demasiados falsos positivos (cualquier
# parámetro que contenga "id", p. ej. "siteid" ya lo cubre igual, pero también
# cosas no sensibles).
_REDACT_ID_RE = re.compile(r"(?i)\b(id)=([^&\s;\"']+)")
# AWEKAS no usa un parámetro con nombre: manda "val=usuario;hash;fecha;..." y el
# segundo campo ES la credencial.
_REDACT_AWEKAS_RE = re.compile(r"(?i)(val=[^;&\s]*;)([^;&\s]+)")


def redact(text: str) -> str:
    text = _REDACT_AWEKAS_RE.sub(r"\1<redacted>", text)
    text = _REDACT_QUERY_RE.sub(r"\1=<redacted>", text)
    return _REDACT_ID_RE.sub(r"\1=<redacted>", text)


class RedactingFilter(logging.Filter):
    """Reescribe el mensaje ya formateado para que ningún handler vea el secreto.

    Va en los handlers y no en el logger raíz: los registros que suben por
    propagación desde un logger hijo (httpx, por ejemplo) no vuelven a pasar
    por los filtros de los loggers ancestros, pero sí por los de cada handler.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        redacted = redact(message)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def install_redaction() -> None:
    """Aplica el filtro a todos los handlers del raíz que aún no lo tengan."""
    for handler in logging.getLogger().handlers:
        if not any(isinstance(f, RedactingFilter) for f in handler.filters):
            handler.addFilter(RedactingFilter())
