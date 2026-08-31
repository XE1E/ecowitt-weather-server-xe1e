"""
Uso de Cloudflare R2 vs. el tier gratis, vía la API GraphQL de Analytics de
Cloudflare. Necesita un Cloudflare API Token DISTINTO a las claves S3 de R2
(alcance "Account Analytics: Read"), que el usuario crea en su dashboard de
Cloudflare — ver docs/backups-r2.md.

Diferido en el plan original (docs/internal/PLAN-RESPALDO-R2.md) porque al
ritmo medido (~15 GB/año) no era urgente; se construyó a pedido explícito.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict

import httpx

logger = logging.getLogger(__name__)

GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"

# Límites del tier gratis de R2, verificados 2026-08-31 en cloudflare.com/r2/pricing.
# OJO: Cloudflare puede cambiarlos sin que este archivo se entere — confirmar ahí
# antes de tomarlos como definitivos.
FREE_TIER = {
    "storage_gb": 10.0,
    "class_a_ops": 1_000_000,
    "class_b_ops": 10_000_000,
}

# Clasificación de operaciones R2: Clase A (escritura/listado, más cara) vs
# Clase B (lectura). Ver https://developers.cloudflare.com/r2/pricing/
_CLASS_A = {
    "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload",
    "UploadPart", "UploadPartCopy", "ListMultipartUploads", "ListParts",
    "ListObjects", "ListObjectsV2", "ListBuckets", "PutBucket",
    "LifecycleStorageTierTransition",
}
_CLASS_B = {
    "GetObject", "HeadObject", "HeadBucket", "GetBucketEncryption",
}

# Cache en memoria: Cloudflare no hace falta consultarlo en cada carga del panel
# de Admin. {bucket: (epoch_del_fetch, resultado)}.
_CACHE_TTL_S = 900  # 15 min
_cache: Dict[str, tuple] = {}


def _account_tag(account_id: str) -> str:
    """El endpoint S3 acepta la URL completa o el ID solo (ver scripts/lib-backup.sh);
    GraphQL sólo quiere el ID (hex), así que se extrae si vino como URL."""
    m = re.search(r"([0-9a-fA-F]{32})", account_id or "")
    return m.group(1) if m else (account_id or "")


async def get_r2_usage(account_id: str, api_token: str, bucket: str) -> Dict[str, Any]:
    """Uso de R2 del mes en curso: storage actual (bytes) y operaciones Clase A/B.

    Devuelve {"ok": True, ...} o {"ok": False, "error": "..."} si la consulta
    falla (token sin permiso, esquema de Cloudflare cambiado, etc.) — nunca
    lanza, para no tumbar el panel de Admin por esto.
    """
    cached = _cache.get(bucket)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_S:
        return cached[1]

    tag = _account_tag(account_id)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    since = month_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    until = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    query = """
    query GetR2Usage($accountTag: string!, $since: string!, $until: string!, $bucket: string!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          r2StorageAdaptiveGroups(
            limit: 1
            filter: {datetime_geq: $since, datetime_leq: $until}
            orderBy: [datetime_DESC]
          ) {
            max { payloadSize metadataSize objectCount }
            dimensions { datetime }
          }
          r2OperationsAdaptiveGroups(
            limit: 1000
            filter: {datetime_geq: $since, datetime_leq: $until, bucketName: $bucket}
          ) {
            sum { requests }
            dimensions { actionType }
          }
        }
      }
    }
    """
    variables = {"accountTag": tag, "since": since, "until": until, "bucket": bucket}

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                GRAPHQL_URL,
                headers={"Authorization": f"Bearer {api_token}"},
                json={"query": query, "variables": variables},
            )
        data = resp.json()
    except Exception as e:
        return {"ok": False, "error": f"No se pudo contactar la API de Cloudflare: {e}"}

    if data.get("errors"):
        result = {"ok": False, "error": "; ".join(str(e.get("message", e)) for e in data["errors"])}
        return result

    try:
        acct = data["data"]["viewer"]["accounts"][0]
        storage_rows = acct.get("r2StorageAdaptiveGroups") or []
        storage_bytes = 0
        if storage_rows:
            m = storage_rows[0]["max"]
            storage_bytes = int(m.get("payloadSize", 0)) + int(m.get("metadataSize", 0))

        class_a = class_b = 0
        unknown_actions = set()
        for row in acct.get("r2OperationsAdaptiveGroups") or []:
            action = row["dimensions"]["actionType"]
            n = int(row["sum"]["requests"])
            if action in _CLASS_A:
                class_a += n
            elif action in _CLASS_B:
                class_b += n
            else:
                unknown_actions.add(action)
        if unknown_actions:
            logger.warning("r2_quota: actionType(s) sin clasificar (ignorados en el conteo): %s",
                            unknown_actions)
    except (KeyError, IndexError, TypeError, ValueError) as e:
        return {"ok": False, "error": f"Respuesta inesperada de Cloudflare: {e}"}

    result = {
        "ok": True,
        "storage_bytes": storage_bytes,
        "class_a_ops": class_a,
        "class_b_ops": class_b,
        "period_start": since,
        "period_end": until,
        "free_tier": FREE_TIER,
    }
    _cache[bucket] = (time.time(), result)
    return result
