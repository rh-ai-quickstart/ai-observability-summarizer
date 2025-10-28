"""Korrel8r REST client.

Provides a minimal, resilient client for calling Korrel8r from server code and MCP tools.
"""

from __future__ import annotations

import json
import re
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests
from urllib.parse import urlparse

from .config import (
    KORREL8R_URL,
    KORREL8R_TIMEOUT_SECONDS,
    VERIFY_SSL,
)
from common.pylogger import get_python_logger
from .config import THANOS_TOKEN


logger = get_python_logger()


@dataclass
class TimeWindow:
    start: str  # ISO8601
    end: str    # ISO8601


class Korrel8rClient:
    def __init__(self, base_url: Optional[str] = None, timeout_seconds: Optional[int] = None) -> None:
        self.base_url: str = (base_url or KORREL8R_URL).rstrip("/")
        self.timeout_seconds: int = timeout_seconds or KORREL8R_TIMEOUT_SECONDS

    def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.base_url:
            raise RuntimeError("Korrel8r base URL not configured")

        url = f"{self.base_url}{path}"
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        # Forward bearer token so Korrel8r can impersonate to stores (Prometheus, etc.)
        if THANOS_TOKEN:
            headers["Authorization"] = f"Bearer {THANOS_TOKEN}"

        # Choose verify behavior: use service CA only for in-cluster svc endpoints
        verify_param: Any = self._choose_verify_param(url)

        try:
            response = requests.post(
                url,
                data=json.dumps(payload),
                headers=headers,
                verify=verify_param,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.Timeout as e:
            logger.warning("Korrel8r request timed out: %s", e)
            raise
        except requests.exceptions.RequestException as e:
            logger.error("Korrel8r request failed: %s", e)
            raise

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not self.base_url:
            raise RuntimeError("Korrel8r base URL not configured")

        url = f"{self.base_url}{path}"
        headers: Dict[str, str] = {}
        if THANOS_TOKEN:
            headers["Authorization"] = f"Bearer {THANOS_TOKEN}"

        verify_param: Any = self._choose_verify_param(url)

        try:
            response = requests.get(
                url,
                params=params,
                headers=headers,
                verify=verify_param,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.Timeout as e:
            logger.warning("Korrel8r GET timed out: %s", e)
            raise
        except requests.exceptions.RequestException as e:
            logger.error("Korrel8r GET failed: %s", e)
            raise

    def _choose_verify_param(self, full_url: str) -> Any:
        """Use service CA bundle for in-cluster service URLs; otherwise system CAs.

        This avoids overriding public CA trust with the injected service CA bundle
        when calling external routes.
        """
        try:
            host = urlparse(full_url).hostname or ""
            if ".svc" in host or "cluster.local" in host:
                return VERIFY_SSL
            return True
        except Exception:
            return True

    def health(self) -> Dict[str, Any]:
        """Check Korrel8r liveness/readiness."""
        return self._get("/healthz")

    def find_related(
        self,
        *,
        start: Dict[str, Any],
        targets: Optional[List[str]] = None,
        time_window: Optional[TimeWindow] = None,
        limit: Optional[int] = None,
        depth: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Call Korrel8r 'graphs/neighbours' endpoint with path fallback.

        Arguments mirror the proposal; server must map to Korrel8r's actual API.
        """
        payload: Dict[str, Any] = {"start": start}
        if targets:
            payload["targets"] = targets
        if time_window:
            payload["timeWindow"] = {"start": time_window.start, "end": time_window.end}
        if limit is not None:
            payload["limit"] = limit
        if depth is not None:
            payload["depth"] = depth

        return self._post("/api/v1alpha1/graphs/neighbours", payload)

    def query_objects(self, query: str) -> Any:
        """Execute a Korrel8r domain query and return raw objects.

        GET /api/v1alpha1/objects?query=domain:class:selector
        """
        if not query or not isinstance(query, str):
            raise ValueError("query must be a non-empty string")
        result = self._get("/api/v1alpha1/objects", params={"query": query})
        # Try to simplify log objects when applicable; otherwise return as-is
        simplified = self._simplify_log_objects(result)
        logger.debug("Korrel8rClient.query_objects simplified result=%s", simplified)
        return simplified if simplified is not None else result

    def _simplify_log_objects(self, objects: Any) -> Optional[List[Dict[str, str]]]:
        """Return simplified log entries if the response looks like log objects.

        Each entry contains: namespace, pod, level, message, timestamp.
        If the input does not appear to be a list of log objects, return None.
        """
        if not isinstance(objects, list):
            return None

        ansi_escape = re.compile(r"\x1b\[[0-9;]*m")
        level_regex = re.compile(
            r"\b(INFO|ERROR|WARN|WARNING|DEBUG|TRACE|CRITICAL|FATAL)\b\s*:?[\t ]*(.*)$",
            re.IGNORECASE | re.DOTALL,
        )

        simplified: List[Dict[str, str]] = []
        found_log_shape = False

        for item in objects:
            if not isinstance(item, dict):
                continue

            body: Any = item.get("body") or item.get("message") or item.get("log")
            pod: Any = (
                item.get("k8s_pod_name")
                or item.get("kubernetes_pod_name")
                or item.get("pod")
            )
            namespace: Any = (
                item.get("k8s_namespace_name")
                or item.get("kubernetes_namespace_name")
                or item.get("namespace")
            )
            timestamp: Any = (
                item.get("_timestamp")
                or item.get("timestamp")
                or item.get("@timestamp")
                or item.get("time")
                or item.get("ts")
            )

            if body is None:
                continue

            found_log_shape = True

            text = str(body)
            text = ansi_escape.sub("", text).strip()

            level = "UNKNOWN"
            message = text
            m = level_regex.search(text)
            if m:
                level = m.group(1).upper()
                # Use captured message tail if present; otherwise keep full text
                tail = m.group(2).strip() if len(m.groups()) >= 2 else ""
                if tail:
                    message = tail

            # Discard DEBUG and INFO log levels
            #if level in ("DEBUG", "INFO"):
            #    continue

            simplified.append(
                {
                    "namespace": str(namespace) if namespace is not None else "",
                    "pod": str(pod) if pod is not None else "",
                    "level": level,
                    "message": message,
                    "timestamp": str(timestamp) if timestamp is not None else "",
                }
            )

        if found_log_shape:
            # De-duplicate by (namespace, pod, level, message), keep latest timestamp
            from datetime import datetime

            def _parse_ts(ts: str):
                try:
                    if not ts:
                        return None
                    s = ts.strip()
                    if s.endswith("Z"):
                        s = s[:-1] + "+00:00"
                    if "." in s:
                        head, tail = s.split(".", 1)
                        tz = ""
                        for i, ch in enumerate(tail):
                            if ch in "+-" and i != 0:
                                tz = tail[i:]
                                tail = tail[:i]
                                break
                        digits = "".join(ch for ch in tail if ch.isdigit())
                        if len(digits) > 6:
                            digits = digits[:6]
                        s = f"{head}.{digits}{tz}" if digits else f"{head}{tz}"
                    return datetime.fromisoformat(s)
                except Exception:
                    return None

            best_by_key: Dict[tuple, Dict[str, str]] = {}
            best_dt_by_key: Dict[tuple, Any] = {}

            for entry in simplified:
                key = (entry.get("namespace", ""), entry.get("pod", ""), entry.get("level", ""), entry.get("message", ""))
                dt = _parse_ts(entry.get("timestamp", ""))
                if key not in best_by_key:
                    best_by_key[key] = entry
                    best_dt_by_key[key] = dt
                else:
                    prev_dt = best_dt_by_key.get(key)
                    prev_ts = best_by_key[key].get("timestamp", "")
                    if prev_dt is None and dt is not None:
                        best_by_key[key] = entry
                        best_dt_by_key[key] = dt
                    elif dt is not None and prev_dt is not None and dt >= prev_dt:
                        best_by_key[key] = entry
                        best_dt_by_key[key] = dt
                    elif dt is None and prev_dt is None:
                        if entry.get("timestamp", "") > prev_ts:
                            best_by_key[key] = entry

            simplified = list(best_by_key.values())

        return simplified if found_log_shape else None

    def list_goals(self, goals: List[str], start: Dict[str, Any]) -> Any:
        """List Korrel8r goal classes for a given start.

        POST /api/v1alpha1/lists/goals
        Args:
            goals: List of goal class names (e.g., ["log:log", "trace:span"]).
            start: Start object per Korrel8r spec (see docs: Start model).
        Returns:
            JSON response from Korrel8r.
        """
        if not isinstance(goals, list) or not all(isinstance(g, str) for g in goals):
            raise ValueError("goals must be a list of strings")
        if not isinstance(start, dict):
            raise ValueError("start must be a dict per Korrel8r Start model")
        payload: Dict[str, Any] = {"goals": goals, "start": start}
        return self._post("/api/v1alpha1/lists/goals", payload=payload)


