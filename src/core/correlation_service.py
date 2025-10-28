"""Correlation orchestration using Korrel8r.

Translates alerts/signals into Korrel8r queries, normalizes results, and builds deep links.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .korrel8r_client import Korrel8rClient, TimeWindow
from .config import (
    KORREL8R_ENABLED,
    KORREL8R_TARGETS,
    KORREL8R_MAX_ITEMS,
    KORREL8R_DEPTH,
)
from common.pylogger import get_python_logger


logger = get_python_logger()


def _parse_targets_from_env() -> List[str]:
    try:
        return [t.strip() for t in (KORREL8R_TARGETS or "").split(",") if t.strip()]
    except Exception:
        return [
            "k8s/object",
            "k8s/event",
            "loki/log",
            "tempo/trace",
        ]


class CorrelationService:
    def __init__(self, client: Optional[Korrel8rClient] = None) -> None:
        self.client = client or Korrel8rClient()
        self.default_targets: List[str] = _parse_targets_from_env()

    def is_enabled(self) -> bool:
        return bool(KORREL8R_ENABLED)

    def correlate_alert(
        self,
        *,
        alert_labels: Dict[str, Any],
        alert_timestamp_iso: Optional[str],
        window_start_iso: Optional[str],
        window_end_iso: Optional[str],
        targets: Optional[List[str]] = None,
        limit: Optional[int] = None,
        depth: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Perform correlation starting from an alert.

        Returns normalized structure:
        {
          "results": { "k8s/object": [...], "k8s/event": [...], ... },
          "meta": { ... }
        }
        """
        if not self.is_enabled():
            return {"error": "KORREL8R_DISABLED", "message": "Korrel8r feature disabled"}

        start_obj = {
            "class": "prom/alert",
            "labels": alert_labels or {},
        }
        if alert_timestamp_iso:
            start_obj["timestamp"] = alert_timestamp_iso

        time_window: Optional[TimeWindow] = None
        if window_start_iso and window_end_iso:
            time_window = TimeWindow(start=window_start_iso, end=window_end_iso)

        try:
            raw = self.client.find_related(
                start=start_obj,
                targets=targets or self.default_targets,
                time_window=time_window,
                limit=limit or KORREL8R_MAX_ITEMS,
                depth=depth or KORREL8R_DEPTH,
            )
        except Exception as e:
            logger.error("Correlation request failed: %s", e)
            return {"error": "KORREL8R_REQUEST_FAILED", "message": str(e)}

        # Normalize: ensure all expected keys exist
        results = raw.get("results", {}) if isinstance(raw, dict) else {}
        normalized: Dict[str, Any] = {
            "results": {
                "k8s/object": results.get("k8s/object", []),
                "k8s/event": results.get("k8s/event", []),
                "loki/log": results.get("loki/log", []),
                "tempo/trace": results.get("tempo/trace", []),
            },
            "meta": raw.get("meta", {}),
        }
        return normalized


