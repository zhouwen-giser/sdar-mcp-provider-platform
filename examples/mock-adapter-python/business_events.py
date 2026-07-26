"""Canonical Business Events Profile 1.0 helpers shared by the Python Adapter."""

from __future__ import annotations

import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any


def event_id(provider_id: str, source_id: str, source_stream_id: str, source_event_id: str) -> str:
    value = "\0".join((provider_id, source_id, source_stream_id, source_event_id)).encode()
    return base64.urlsafe_b64encode(hashlib.sha256(value).digest()).decode().rstrip("=")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_sha256(value: Any) -> str:
    digest = hashlib.sha256(canonical_json(value).encode()).hexdigest()
    return f"sha256:{digest}"


def normalize_rfc3339_nano(value: str) -> str:
    match = re.fullmatch(
        r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})",
        value,
    )
    if match is None:
        raise ValueError("BUSINESS_EVENT_TIMESTAMP_INVALID")
    base, fraction, zone = match.groups()
    instant = datetime.fromisoformat(f"{base}{zone.replace('Z', '+00:00')}").astimezone(timezone.utc)
    normalized_fraction = (fraction or "").rstrip("0")
    return instant.strftime("%Y-%m-%dT%H:%M:%S") + (
        f".{normalized_fraction}" if normalized_fraction else ""
    ) + "Z"
