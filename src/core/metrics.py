"""
Metrics collection and processing functions

Contains all business logic for interacting with Prometheus/Thanos,
collecting vLLM metrics, and processing observability data.
"""

import requests
import pandas as pd
import os
import json
import re
import logging
import math
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, Set
from dataclasses import dataclass

import logging
from common.pylogger import get_python_logger

# Initialize structured logger once - other modules should use logging.getLogger(__name__)
get_python_logger()

logger = logging.getLogger(__name__)

from .config import PROMETHEUS_URL, THANOS_TOKEN, VERIFY_SSL, MODEL_CONFIG
from fastapi import HTTPException
from .llm_client import summarize_with_llm
from .response_validator import ResponseType
from .llm_client import (
    build_openshift_prompt,
    build_openshift_metrics_context,
    build_openshift_chat_prompt,
)
from .config import KORREL8R_ENABLED
from .korrel8r_service import fetch_goal_query_objects
NAMESPACE_SCOPED = "namespace_scoped"
CLUSTER_WIDE = "cluster_wide"


def execute_instant_query(query: str, timeout: int = 10) -> Dict[str, Any]:
    """Execute a Prometheus instant query (fast, single point in time).
    
    Args:
        query: PromQL query string
        timeout: Request timeout in seconds
        
    Returns:
        Dict with 'data' containing query results
    """
    headers = _auth_headers()
    try:
        resp = requests.get(
            f"{PROMETHEUS_URL}/api/v1/query",
            headers=headers,
            params={"query": query},
            verify=VERIFY_SSL,
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout:
        logger.warning(f"Timeout executing query: {query}")
        return {"data": {"result": []}}
    except Exception as e:
        logger.warning(f"Error executing query {query}: {e}")
        return {"data": {"result": []}}


def execute_instant_queries_parallel(queries: Dict[str, str], max_workers: int = 10) -> Dict[str, float]:
    """Execute multiple Prometheus instant queries in parallel.
    
    Args:
        queries: Dict mapping label -> PromQL query
        max_workers: Max parallel threads
        
    Returns:
        Dict mapping label -> numeric value
    """
    import concurrent.futures
    
    def fetch_one(label: str, query: str) -> Tuple[str, float]:
        result = execute_instant_query(query)
        value = 0.0
        try:
            data = result.get("data", {}).get("result", [])
            if data and len(data) > 0:
                val = data[0].get("value", [None, 0])
                if isinstance(val, list) and len(val) > 1:
                    value = float(val[1])
        except (ValueError, TypeError, IndexError):
            # Use default value (0.0) if extraction fails - metric may be unavailable
            pass
        return (label, round(value, 2))
    
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_one, label, query): label for label, query in queries.items()}
        for future in concurrent.futures.as_completed(futures):
            try:
                label, value = future.result()
                results[label] = value
            except Exception as e:
                label = futures[future]
                logger.warning(f"Failed to fetch {label}: {e}")
                results[label] = 0.0
    return results


def execute_range_queries_parallel(
    queries: Dict[str, str], 
    start_ts: int, 
    end_ts: int, 
    max_workers: int = 10,
    max_points: int = 20
) -> Dict[str, List[Dict[str, Any]]]:
    """Execute multiple Prometheus range queries in parallel for sparklines.
    
    Args:
        queries: Dict mapping label -> PromQL query
        start_ts: Start timestamp (epoch seconds)
        end_ts: End timestamp (epoch seconds)
        max_workers: Max parallel threads
        max_points: Target number of data points for sparklines
        
    Returns:
        Dict mapping label -> list of {timestamp, value} dicts
    """
    import concurrent.futures
    from datetime import datetime
    
    # Calculate step to get approximately max_points data points
    duration = end_ts - start_ts
    step = max(60, duration // max_points)  # At least 1 minute step
    
    headers = _auth_headers()
    
    def fetch_range(label: str, query: str) -> Tuple[str, List[Dict[str, Any]]]:
        try:
            resp = requests.get(
                f"{PROMETHEUS_URL}/api/v1/query_range",
                headers=headers,
                params={
                    "query": query,
                    "start": start_ts,
                    "end": end_ts,
                    "step": f"{step}s"
                },
                verify=VERIFY_SSL,
                timeout=30,
            )
            resp.raise_for_status()
            result = resp.json().get("data", {}).get("result", [])
            
            time_series = []
            if result and len(result) > 0:
                values = result[0].get("values", [])
                for ts, val in values:
                    try:
                        float_val = float(val)
                        # Skip NaN values using math.isnan for clarity
                        if not math.isnan(float_val):
                            time_series.append({
                                "timestamp": datetime.fromtimestamp(ts).isoformat(),
                                "value": round(float_val, 2)
                            })
                    except (ValueError, TypeError):
                        # Skip values that can't be converted to float (e.g., "NaN" string, None)
                        pass
            return (label, time_series)
        except Exception as e:
            logger.warning(f"Failed range query for {label}: {e}")
            return (label, [])
    
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_range, label, query): label for label, query in queries.items()}
        for future in concurrent.futures.as_completed(futures):
            try:
                label, time_series = future.result()
                results[label] = time_series
            except Exception as e:
                label = futures[future]
                logger.warning(f"Failed to fetch range for {label}: {e}")
                results[label] = []
    return results


@dataclass(frozen=True)
class NamespacePodPair:
    namespace: str
    pod: Optional[str] = None


 

def extract_namespace_pod_pairs_from_metrics(
    model_field: str,
    metric_dfs: Dict[str, Any],
) -> Set[NamespacePodPair]:
    """Extract all unique (namespace, pod) pairs from provided metrics.

    Uses DataFrame label columns when available and falls back to parsing
    namespace from model name formatted as "namespace | model". Deduplicates pairs.
    """
    pairs: Set[NamespacePodPair] = set()
    try:
        for _label, df in metric_dfs.items():
            if df is None or not isinstance(df, pd.DataFrame) or df.empty:
                continue
            has_ns = "namespace" in df.columns
            has_pod = "pod" in df.columns
            try:
                if has_ns and has_pod:
                    for _, row in df[["namespace", "pod"]].dropna(how="all").iterrows():
                        ns_val = str(row["namespace"]).strip() if pd.notna(row.get("namespace")) else None
                        pod_val = str(row["pod"]).strip() if pd.notna(row.get("pod")) else None
                        if ns_val or pod_val:
                            pairs.add(NamespacePodPair(namespace=ns_val or "", pod=pod_val))
            except Exception:
                continue
    except Exception:
        pass
    
    try:
        if not pairs and "|" in model_field:
            parts = [p.strip() for p in model_field.split("|", 1)]
            if len(parts) == 2 and parts[0]:
                pairs.add(NamespacePodPair(namespace=parts[0], pod=None))
    except Exception:
        pass
    logger.debug("extract_namespace_pod_pairs_from_metrics: pairs=%s", pairs)
    return pairs


def sort_logs_by_severity_then_time(logs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sort logs by severity (desc) then timestamp (newest first).

    Severity order: FATAL/CRITICAL > ERROR > WARN/WARNING > INFO > DEBUG > TRACE > UNKNOWN.
    Accepts timestamps in ISO8601, including Z suffix and sub-second precision.
    """
    severity_rank = {
        "FATAL": 7,
        "CRITICAL": 7,
        "ERROR": 6,
        "WARN": 5,
        "WARNING": 5,
        "INFO": 3,
        "DEBUG": 2,
        "TRACE": 1,
        "UNKNOWN": 0,
    }

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

    def _sort_key(log: Dict[str, Any]):
        level = str(log.get("level") or "UNKNOWN").upper()
        rank = severity_rank.get(level, 0)
        ts = str(log.get("timestamp") or log.get("ts") or "")
        dt = _parse_ts(ts)
        return (rank, dt or datetime.fromtimestamp(0))

    return sorted(logs or [], key=_sort_key, reverse=True)

def build_korrel8r_log_query_for_vllm(
    namespace: Optional[str],
    pod: Optional[str],
) -> Optional[str]:
    """Return a Korrel8r domain query for logs given namespace/pod context.

    - If both namespace and pod are known: use the pod
    - Else if only namespace is known: k8s Pod selector to pivot to logs
    - Else: None
    """
    try:
        if namespace and pod:
            return (
                f'k8s:Pod.v1:{{"namespace":"{namespace}",'
                f'"name":"{pod}"}}'
            )
        if namespace:
            return f'k8s:Pod.v1:{{"namespace":"{namespace}"}}'
        return None
    except Exception:
        return None

def choose_prometheus_step(
    start_ts: int,
    end_ts: int,
    max_points_per_series: int = 11000,
    min_step_seconds: int = 30,
) -> str:
    """Select an appropriate Prometheus step to keep points per series under limits.

    Returns a Prometheus duration string like "30s", "1m", "5m", "1h".
    """
    try:
        duration_seconds = max(0, int(end_ts) - int(start_ts))
        # Use (max_points - 1) because query_range is inclusive of endpoints
        raw_step_seconds = max(
            min_step_seconds,
            math.ceil(duration_seconds / max(1, (max_points_per_series - 1))),
        )

        # Round up to the next "nice" bucket
        buckets = [
            1, 2, 5, 10, 15, 30,
            60, 120, 300, 600, 900, 1800,
            3600, 7200, 14400, 21600, 43200,
        ]
        step_seconds = next((b for b in buckets if b >= raw_step_seconds), buckets[-1])

        if step_seconds % 3600 == 0:
            return f"{step_seconds // 3600}h"
        if step_seconds % 60 == 0:
            return f"{step_seconds // 60}m"
        return f"{step_seconds}s"
    except Exception:
        # Fallback to previous default on any error
        return f"{max(min_step_seconds, 30)}s"



def _auth_headers() -> Dict[str, str]:
    """Create Authorization headers only when a plausible token is present.

    Avoid sending a default file path or empty string as a token to local
    Prometheus, which can cause request failures in some setups.
    """
    try:
        token = (THANOS_TOKEN or "").strip()
        if not token:
            return {}
        # Heuristic: if token looks like a filesystem path, skip auth header
        if token.startswith("/") or token.lower().startswith("file:"):
            return {}
        return {"Authorization": f"Bearer {token}"}
    except Exception:
        return {}


def extract_first_json_object_from_text(text: str) -> Optional[Dict[str, Any]]:
    """Extract a JSON object from arbitrary text, robust to extra prose and nesting.

    Strategy:
    - Prefer fenced code blocks (```json ... ``` or ``` ... ```)
    - Scan text with a bracket-depth parser that respects strings/escapes
    - Parse all candidates; if a list at top-level, select the first dict
    - Prefer dicts containing promql/summary; else choose the largest
    """
    candidates = []  # list of tuples: (raw_str, parsed_dict)

    def _try_add(parsed_obj, raw_str: str):
        # If a list, pick the first dict element
        if isinstance(parsed_obj, list):
            for el in parsed_obj:
                if isinstance(el, dict):
                    candidates.append((raw_str, el))
                    return
        elif isinstance(parsed_obj, dict):
            candidates.append((raw_str, parsed_obj))

    def _collect_from_string(source: str):
        # Try whole string
        try:
            _try_add(json.loads(source), source)
        except Exception:
            pass

        # Depth-aware scan for JSON objects
        n = len(source)
        i = 0
        while i < n:
            if source[i] == '{':
                depth = 0
                in_str = False
                esc = False
                j = i
                while j < n:
                    ch = source[j]
                    if in_str:
                        if esc:
                            esc = False
                        elif ch == '\\':
                            esc = True
                        elif ch == '"':
                            in_str = False
                    else:
                        if ch == '"':
                            in_str = True
                        elif ch == '{':
                            depth += 1
                        elif ch == '}':
                            depth -= 1
                            if depth == 0:
                                segment = source[i : j + 1]
                                try:
                                    _try_add(json.loads(segment), segment)
                                except Exception:
                                    pass
                                break
                    j += 1
                i = j
            i += 1

    # 1) Fenced code blocks
    for block in re.findall(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE):
        _collect_from_string(block)

    # 2) Whole text
    _collect_from_string(text)

    if not candidates:
        return None

    def _score(item):
        raw, obj = item
        keys = {str(k).lower() for k in obj.keys()}
        has_promql = 1 if ("promql" in keys or "promqls" in keys) else 0
        has_summary = 1 if ("summary" in keys) else 0
        return (has_promql + has_summary, len(raw))

    best = max(candidates, key=_score)
    return best[1]

def get_models_helper() -> List[str]:
    """
    Get list of available vLLM models from Prometheus metrics.
    
    Optimized with parallel requests for fast dashboard loading.
    
    Returns:
        List of model names in format "namespace | model_name"
    """
    import concurrent.futures
    
    headers = _auth_headers()
    model_set: set = set()
    
    # Use just the most reliable metric with 24h window (fast)
    def fetch_series(metric_name: str) -> List[dict]:
        try:
            response = requests.get(
                f"{PROMETHEUS_URL}/api/v1/series",
                headers=headers,
                params={
                    "match[]": metric_name,
                    "start": int(datetime.now().timestamp() - 24 * 3600),  # 24h
                    "end": int(datetime.now().timestamp()),
                },
                verify=VERIFY_SSL,
                timeout=10,  # Fast timeout
            )
            response.raise_for_status()
            return response.json().get("data", [])
        except Exception as e:
            logger.debug(f"Error checking {metric_name}: {e}")
            return []
    
    # Check 3 key metrics in parallel
    metrics = [
        "vllm:num_requests_running",
        "vllm:gpu_cache_usage_perc",
        "vllm:request_prompt_tokens_total",
    ]
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fetch_series, m): m for m in metrics}
        for future in concurrent.futures.as_completed(futures):
            for entry in future.result():
                model = entry.get("model_name", "").strip()
                namespace = entry.get("namespace", "").strip()
                if model and namespace:
                    model_set.add(f"{namespace} | {model}")
    
    logger.info(f"Found {len(model_set)} model(s)")
    return sorted(list(model_set))


def get_vllm_namespaces_helper() -> List[str]:
    """
    Get list of namespaces that have vLLM metrics available.
    
    Optimized with parallel requests for fast dashboard loading.

    Returns:
        Sorted list of namespace names
    """
    import concurrent.futures
    
    try:
        headers = _auth_headers()
        namespace_set: set = set()
        
        def fetch_series(metric_name: str) -> List[dict]:
            try:
                response = requests.get(
                    f"{PROMETHEUS_URL}/api/v1/series",
                    headers=headers,
                    params={
                        "match[]": metric_name,
                        "start": int(datetime.now().timestamp() - 24 * 3600),  # 24h
                        "end": int(datetime.now().timestamp()),
                    },
                    verify=VERIFY_SSL,
                    timeout=10,  # Fast timeout
                )
                response.raise_for_status()
                return response.json().get("data", [])
            except Exception as e:
                logger.debug(f"Error checking {metric_name}: {e}")
                return []
        
        # Check 3 key metrics in parallel
        metrics = [
            "vllm:num_requests_running",
            "vllm:gpu_cache_usage_perc", 
            "vllm:request_prompt_tokens_total",
        ]
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            futures = {executor.submit(fetch_series, m): m for m in metrics}
            for future in concurrent.futures.as_completed(futures):
                for entry in future.result():
                    namespace = entry.get("namespace", "").strip()
                    model = entry.get("model_name", "").strip()
                    if namespace and model:
                        namespace_set.add(namespace)
        
        logger.info(f"Found {len(namespace_set)} namespace(s)")
        return sorted(list(namespace_set))
    except Exception as e:
        logger.error("Error getting namespaces", exc_info=e)
        return []


def get_openshift_namespaces_helper() -> List[str]:
    """
    Get list of all namespaces present in Prometheus/Thanos data.

    Uses the label values endpoint to retrieve all observed namespace labels.
    Optimized with fast timeout for dashboard loading.

    Returns:
        Sorted list of namespace names
    """
    try:
        headers = _auth_headers()
        response = requests.get(
            f"{PROMETHEUS_URL}/api/v1/label/namespace/values",
            headers=headers,
            verify=VERIFY_SSL,
            timeout=10,  # Fast timeout
        )
        response.raise_for_status()
        values = response.json().get("data", [])
        if not isinstance(values, list):
            return []
        namespaces = sorted({str(v).strip() for v in values if v})
        return namespaces
    except Exception as e:
        logger.error("Error getting OpenShift namespaces", exc_info=e)
        return []

def calculate_metric_stats(data):
    """
    Calculate basic statistics (average and max) from metric data.
    
    Args:
        data: List of dictionaries with 'value' and 'timestamp' keys
        
    Returns:
        Tuple of (average, max) or (None, None) for invalid data
    """
    if not data or data is None:
        return (None, None)
    
    try:
        values = [item.get("value") for item in data if "value" in item]
        if not values:
            return (None, None)
            
        avg = sum(values) / len(values)
        max_val = max(values)
        return (float(avg), float(max_val))
    except (TypeError, ValueError, KeyError):
        return (None, None)


# --- Metric Discovery Functions ---

def discover_vllm_metrics():
    """Dynamically discover available vLLM metrics from Prometheus, including GPU metrics"""
    try:
        headers = {"Authorization": f"Bearer {THANOS_TOKEN}"}
        response = requests.get(
            f"{PROMETHEUS_URL}/api/v1/label/__name__/values",
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30,  # Add timeout
        )
        response.raise_for_status()
        all_metrics = response.json()["data"]

        # Create friendly names for metrics
        metric_mapping = {}

        # First, add GPU metrics (DCGM for NVIDIA or habanalabs for Intel Gaudi) that are relevant for vLLM monitoring
        # Try NVIDIA DCGM metrics first
        gpu_metrics_nvidia = {
            "GPU Temperature (°C)": "DCGM_FI_DEV_GPU_TEMP",
            "GPU Power Usage (Watts)": "DCGM_FI_DEV_POWER_USAGE",
            "GPU Memory Usage (GB)": "DCGM_FI_DEV_FB_USED / (1024*1024*1024)",
            "GPU Energy Consumption (Joules)": "DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION",
            "GPU Memory Temperature (°C)": "DCGM_FI_DEV_MEMORY_TEMP",
            "GPU Utilization (%)": "DCGM_FI_DEV_GPU_UTIL",
        }

        # Try Intel Gaudi metrics as alternative
        gpu_metrics_gaudi = {
            "GPU Temperature (°C)": "habanalabs_temperature_onchip",
            "GPU Power Usage (Watts)": "habanalabs_power_mW / 1000",
            "GPU Memory Usage (GB)": "habanalabs_memory_used_bytes / (1024*1024*1024)",
            "GPU Energy Consumption (Joules)": "habanalabs_energy",
            "GPU Memory Temperature (°C)": "habanalabs_temperature_threshold_memory",
            "GPU Utilization (%)": "habanalabs_utilization",
        }

        # Try NVIDIA metrics first
        for friendly_name, metric_name in gpu_metrics_nvidia.items():
            # Handle expressions (like memory GB conversion) by checking base metric presence
            if friendly_name == "GPU Memory Usage (GB)":
                if "DCGM_FI_DEV_FB_USED" in all_metrics:
                    metric_mapping[friendly_name] = "avg(DCGM_FI_DEV_FB_USED) / (1024*1024*1024)"
                continue

            if metric_name in all_metrics:
                metric_mapping[friendly_name] = f"avg({metric_name})"

        # If no NVIDIA metrics, try Intel Gaudi metrics
        if not metric_mapping:
            for friendly_name, metric_expr in gpu_metrics_gaudi.items():
                # Handle expressions (like memory GB conversion and power mW to W)
                if friendly_name == "GPU Memory Usage (GB)":
                    if "habanalabs_memory_used_bytes" in all_metrics:
                        metric_mapping[friendly_name] = "avg(habanalabs_memory_used_bytes) / (1024*1024*1024)"
                    continue
                elif friendly_name == "GPU Power Usage (Watts)":
                    if "habanalabs_power_mW" in all_metrics:
                        metric_mapping[friendly_name] = "avg(habanalabs_power_mW) / 1000"
                    continue

                # For simple metric names without expressions
                metric_name = metric_expr.split()[0] if " " not in metric_expr and "/" not in metric_expr else None
                if metric_name and metric_name in all_metrics:
                    metric_mapping[friendly_name] = f"avg({metric_name})"

        # Ensure GPU Usage (%) metric is available by aliasing to vendor-specific utilization metrics
        # This provides a fallback when vLLM-specific GPU cache usage metric is not available
        if "GPU Usage (%)" not in metric_mapping:
            if "DCGM_FI_DEV_GPU_UTIL" in all_metrics:
                metric_mapping["GPU Usage (%)"] = "avg(DCGM_FI_DEV_GPU_UTIL)"
            elif "habanalabs_utilization" in all_metrics:
                metric_mapping["GPU Usage (%)"] = "avg(habanalabs_utilization)"
            # TODO: Add AMD support here when available.
            # When AMD GPU metrics are available, add:
            # elif "amd_smi_utilization" in all_metrics:
            #     metric_mapping["GPU Usage (%)"] = "avg(amd_smi_utilization)"

        # Build vLLM-derived queries based on available metrics
        vllm_metrics = set(m for m in all_metrics if m.startswith("vllm:"))

        # Tokens - For dashboard display, prefer current totals over increases
        # This shows accumulated tokens rather than recent activity
        if "vllm:request_prompt_tokens_sum" in vllm_metrics:
            metric_mapping["Prompt Tokens Created"] = "vllm:request_prompt_tokens_sum"
        elif "vllm:prompt_tokens_total" in vllm_metrics:
            metric_mapping["Prompt Tokens Created"] = "sum(vllm:prompt_tokens_total)"
        elif "vllm:request_prompt_tokens_created" in vllm_metrics:
            metric_mapping["Prompt Tokens Created"] = "sum(increase(vllm:request_prompt_tokens_created[1h]))"
        elif "vllm:request_prompt_tokens_total" in vllm_metrics:
            metric_mapping["Prompt Tokens Created"] = "sum(increase(vllm:request_prompt_tokens_total[1h]))"

        if "vllm:request_generation_tokens_sum" in vllm_metrics:
            metric_mapping["Output Tokens Created"] = "vllm:request_generation_tokens_sum"
        elif "vllm:generation_tokens_total" in vllm_metrics:
            metric_mapping["Output Tokens Created"] = "sum(vllm:generation_tokens_total)"
        elif "vllm:request_generation_tokens_created" in vllm_metrics:
            metric_mapping["Output Tokens Created"] = "sum(increase(vllm:request_generation_tokens_created[1h]))"
        elif "vllm:request_generation_tokens_total" in vllm_metrics:
            metric_mapping["Output Tokens Created"] = "sum(increase(vllm:request_generation_tokens_total[1h]))"

        # Requests running (gauge)
        if "vllm:num_requests_running" in vllm_metrics:
            metric_mapping["Requests Running"] = "vllm:num_requests_running"

        # GPU cache usage percent exposed by vLLM (model-scoped proxy for GPU usage)
        # This is preferred over DCGM_FI_DEV_GPU_UTIL as it's model-specific
        if "vllm:gpu_cache_usage_perc" in vllm_metrics:
            metric_mapping["GPU Usage (%)"] = "avg(vllm:gpu_cache_usage_perc)"
        elif "vllm:gpu_memory_usage" in vllm_metrics:
            # Alternative vLLM GPU metric
            metric_mapping["GPU Usage (%)"] = "avg(vllm:gpu_memory_usage)"

        # P95 latency from histogram buckets
        if "vllm:e2e_request_latency_seconds_bucket" in vllm_metrics:
            metric_mapping["P95 Latency (s)"] = (
                "histogram_quantile(0.95, sum(rate(vllm:e2e_request_latency_seconds_bucket[5m])) by (le))"
            )

        # Inference time average = sum(rate(sum)) / sum(rate(count))
        if (
            "vllm:request_inference_time_seconds_sum" in vllm_metrics
            and "vllm:request_inference_time_seconds_count" in vllm_metrics
        ):
            metric_mapping["Inference Time (s)"] = (
                "sum(rate(vllm:request_inference_time_seconds_sum[5m])) / "
                "sum(rate(vllm:request_inference_time_seconds_count[5m]))"
            )

        # Add any other vLLM metrics with a generic friendly name if not already mapped
        for metric in vllm_metrics:
            if metric in (
                "vllm:request_prompt_tokens_created",
                "vllm:request_prompt_tokens_total",
                "vllm:request_generation_tokens_created",
                "vllm:request_generation_tokens_total",
                "vllm:num_requests_running",
                "vllm:e2e_request_latency_seconds_bucket",
                "vllm:request_inference_time_seconds_sum",
                "vllm:request_inference_time_seconds_count",
            ):
                continue
            friendly_name = metric.replace("vllm:", "").replace("_", " ").title()
            if friendly_name not in metric_mapping:
                metric_mapping[friendly_name] = metric

        return metric_mapping
    except Exception as e:
        logger.error("Error discovering vLLM metrics: %s", e)
        # Enhanced fallback with comprehensive GPU metrics and vLLM metrics (multi-vendor)
        return {
            "GPU Temperature (°C)": "avg(DCGM_FI_DEV_GPU_TEMP) or avg(habanalabs_temperature_onchip)",
            "GPU Power Usage (Watts)": "avg(DCGM_FI_DEV_POWER_USAGE) or avg(habanalabs_power_mW) / 1000",
            "GPU Memory Usage (GB)": "avg(DCGM_FI_DEV_FB_USED) / (1024*1024*1024) or avg(habanalabs_memory_used_bytes) / (1024*1024*1024)",
            "GPU Energy Consumption (Joules)": "avg(DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION) or avg(habanalabs_energy)",
            "GPU Memory Temperature (°C)": "avg(DCGM_FI_DEV_MEMORY_TEMP) or avg(habanalabs_temperature_onboard)",
            "GPU Usage (%)": "avg(DCGM_FI_DEV_GPU_UTIL) or avg(habanalabs_utilization)",
            "Prompt Tokens Created": "vllm:request_prompt_tokens_sum",
            "Output Tokens Created": "vllm:request_generation_tokens_sum",
            "Requests Running": "vllm:num_requests_running",
            "P95 Latency (s)": "histogram_quantile(0.95, sum(rate(vllm:e2e_request_latency_seconds_bucket[5m])) by (le))",
            "Inference Time (s)": "sum(rate(vllm:request_inference_time_seconds_sum[5m])) / sum(rate(vllm:request_inference_time_seconds_count[5m]))",
        }


def discover_dcgm_metrics():
    """Dynamically discover available GPU metrics (DCGM, nvidia_smi, or alternatives)"""
    try:
        headers = {"Authorization": f"Bearer {THANOS_TOKEN}"}
        response = requests.get(
            f"{PROMETHEUS_URL}/api/v1/label/__name__/values",
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30,  # Add timeout
        )
        response.raise_for_status()
        all_metrics = response.json()["data"]

        # Filter for different types of GPU metrics
        dcgm_metrics = [metric for metric in all_metrics if metric.startswith("DCGM_")]
        nvidia_metrics = [metric for metric in all_metrics if "nvidia" in metric.lower()]
        gpu_metrics = [metric for metric in all_metrics if "gpu" in metric.lower() and not metric.startswith("vllm:")]

        logger.info("Found %d DCGM metrics, %d NVIDIA metrics, %d GPU metrics", len(dcgm_metrics), len(nvidia_metrics), len(gpu_metrics))

        # Create a mapping of useful GPU metrics for fleet monitoring
        gpu_mapping = {}
        fb_used_metric = None

        # Priority 1: DCGM metrics (most comprehensive)
        for metric in dcgm_metrics:
            if "GPU_TEMP" in metric:
                gpu_mapping["GPU Temperature (°C)"] = f"avg({metric})"
            elif "POWER_USAGE" in metric:
                gpu_mapping["GPU Power Usage (Watts)"] = f"avg({metric})"
            elif "GPU_UTIL" in metric:
                gpu_mapping["GPU Utilization (%)"] = f"avg({metric})"
            elif "MEMORY_TEMP" in metric:
                gpu_mapping["GPU Memory Temperature (°C)"] = f"avg({metric})"
            elif "TOTAL_ENERGY_CONSUMPTION" in metric:
                gpu_mapping["GPU Energy Consumption (Joules)"] = f"avg({metric})"
            elif "FB_USED" in metric:
                fb_used_metric = metric
                gpu_mapping["GPU Memory Used (bytes)"] = f"avg({metric})"
            elif "FB_TOTAL" in metric:
                gpu_mapping["GPU Memory Total (bytes)"] = f"avg({metric})"
            elif "SM_CLOCK" in metric:
                gpu_mapping["GPU SM Clock (MHz)"] = f"avg({metric})"
            elif "MEM_CLOCK" in metric:
                gpu_mapping["GPU Memory Clock (MHz)"] = f"avg({metric})"

        # Add GPU Memory Usage in GB if we found the FB_USED metric
        if fb_used_metric:
            gpu_mapping["GPU Memory Usage (GB)"] = (
                f"avg({fb_used_metric}) / (1024*1024*1024)"
            )

        # Priority 2: nvidia-smi or alternative metrics if DCGM not available
        if not gpu_mapping:
            logger.info("No DCGM metrics found, checking for alternative GPU metrics...")
            
            # Look for common GPU metric patterns
            gpu_patterns = {
                "GPU Temperature (°C)": ["nvidia_smi_temperature", "gpu_temperature", "gpu_temp"],
                "GPU Utilization (%)": ["nvidia_smi_utilization", "gpu_utilization", "gpu_usage_percent"],
                "GPU Power Usage (Watts)": ["nvidia_smi_power", "gpu_power", "gpu_power_usage"],
                "GPU Memory Usage (%)": ["nvidia_smi_memory_used", "gpu_memory_usage", "gpu_mem_used"],
                "GPU Memory Free (bytes)": ["nvidia_smi_memory_free", "gpu_memory_free"],
                "GPU Fan Speed (%)": ["nvidia_smi_fan_speed", "gpu_fan"],
            }
            
            for friendly_name, pattern_list in gpu_patterns.items():
                for pattern in pattern_list:
                    matching_metrics = [m for m in all_metrics if pattern in m.lower()]
                    if matching_metrics:
                        # Use the first matching metric
                        gpu_mapping[friendly_name] = f"avg({matching_metrics[0]})"
                        logger.info("Found alternative GPU metric: %s -> %s", friendly_name, matching_metrics[0])
                        break

        # Priority 3: Generic GPU metrics
        if not gpu_mapping:
            logger.info("No specific GPU metrics found, checking for generic patterns...")
            for metric in gpu_metrics:
                metric_lower = metric.lower()
                if "temperature" in metric_lower or "temp" in metric_lower:
                    gpu_mapping["GPU Temperature"] = f"avg({metric})"
                elif "utilization" in metric_lower or "usage" in metric_lower:
                    gpu_mapping["GPU Utilization"] = f"avg({metric})"
                elif "power" in metric_lower:
                    gpu_mapping["GPU Power"] = f"avg({metric})"
                elif "memory" in metric_lower and "used" in metric_lower:
                    gpu_mapping["GPU Memory Used"] = f"avg({metric})"

        if gpu_mapping:
            logger.info("Successfully discovered %d GPU metrics", len(gpu_mapping))
        else:
            logger.warning("No GPU metrics found - cluster may not have GPUs or GPU monitoring")

        return gpu_mapping
    except Exception as e:
        logger.error("Error discovering GPU metrics", exc_info=e)
        return {}


def discover_intel_gaudi_metrics():
    """Dynamically discover available Intel Gaudi accelerator metrics
    
    Note: This function follows a vendor-specific discovery pattern.
    To add AMD support in the future, create a similar discover_amd_metrics() function
    following the same pattern used here.
    """
    try:
        headers = {"Authorization": f"Bearer {THANOS_TOKEN}"}
        response = requests.get(
            f"{PROMETHEUS_URL}/api/v1/label/__name__/values",
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30,
        )
        response.raise_for_status()
        all_metrics = response.json()["data"]

        # Filter for Intel Gaudi (habanalabs) metrics
        gaudi_metrics = [metric for metric in all_metrics if metric.startswith("habanalabs_")]

        logger.info("Found %d Intel Gaudi (habanalabs) metrics", len(gaudi_metrics))

        # Create a mapping of useful Intel Gaudi metrics for fleet monitoring
        gaudi_mapping = {}
        memory_used_metric = None
        memory_total_metric = None

        for metric in gaudi_metrics:
            # Temperature metrics
            if "temperature_onchip" in metric:
                gaudi_mapping["GPU Temperature (°C)"] = f"avg({metric})"
            elif "temperature_onboard" in metric:
                gaudi_mapping["Board Temperature (°C)"] = f"avg({metric})"
            elif "temperature_threshold_gpu" in metric:
                gaudi_mapping["GPU Temperature Threshold (°C)"] = f"avg({metric})"
            elif "temperature_threshold_memory" in metric:
                gaudi_mapping["GPU Memory Temperature Threshold (°C)"] = f"avg({metric})"
            
            # Power metrics (convert mW to Watts)
            elif metric == "habanalabs_power_mW":
                gaudi_mapping["GPU Power Usage (Watts)"] = f"avg({metric}) / 1000"
            elif "power_default_limit_mW" in metric:
                gaudi_mapping["GPU Power Cap (Watts)"] = f"avg({metric}) / 1000"
            
            # Utilization
            elif metric == "habanalabs_utilization":
                gaudi_mapping["GPU Utilization (%)"] = f"avg({metric})"
            
            # Memory metrics
            elif metric == "habanalabs_memory_used_bytes":
                memory_used_metric = metric
                gaudi_mapping["GPU Memory Used (bytes)"] = f"avg({metric})"
            elif metric == "habanalabs_memory_total_bytes":
                memory_total_metric = metric
                gaudi_mapping["GPU Memory Total (bytes)"] = f"avg({metric})"
            elif metric == "habanalabs_memory_free_bytes":
                gaudi_mapping["GPU Memory Free (bytes)"] = f"avg({metric})"
            
            # Clock speeds
            elif metric == "habanalabs_clock_soc_mhz":
                gaudi_mapping["GPU SoC Clock (MHz)"] = f"avg({metric})"
            elif metric == "habanalabs_clock_soc_max_mhz":
                gaudi_mapping["GPU SoC Max Clock (MHz)"] = f"avg({metric})"
            
            # Energy
            elif metric == "habanalabs_energy":
                gaudi_mapping["GPU Energy Consumption (Joules)"] = f"avg({metric})"
            
            # PCIe metrics
            elif metric == "habanalabs_pcie_rx":
                gaudi_mapping["PCIe RX Traffic (bytes)"] = f"avg({metric})"
            elif metric == "habanalabs_pcie_tx":
                gaudi_mapping["PCIe TX Traffic (bytes)"] = f"avg({metric})"
            elif "pcie_receive_throughput" in metric:
                gaudi_mapping["PCIe Receive Throughput"] = f"avg({metric})"
            elif "pcie_transmit_throughput" in metric:
                gaudi_mapping["PCIe Transmit Throughput"] = f"avg({metric})"
            elif "pcie_replay_count" in metric:
                gaudi_mapping["PCIe Replay Count"] = f"avg({metric})"
            
            # PCIe link info
            elif metric == "habanalabs_pci_link_speed":
                gaudi_mapping["PCIe Link Speed"] = f"avg({metric})"
            elif metric == "habanalabs_pci_link_width":
                gaudi_mapping["PCIe Link Width"] = f"avg({metric})"
            
            # ECC and memory health
            elif "ecc_feature_mode" in metric:
                gaudi_mapping["ECC Status"] = f"avg({metric})"
            elif "pending_rows_with_single_bit_ecc_errors" in metric:
                gaudi_mapping["Single-bit ECC Errors"] = f"sum({metric})"
            elif "pending_rows_with_double_bit_ecc_errors" in metric:
                gaudi_mapping["Double-bit ECC Errors"] = f"sum({metric})"
            
            # NIC port status
            elif "nic_port_status" in metric:
                gaudi_mapping["NIC Port Status"] = f"avg({metric})"

        # Add GPU Memory Usage in GB if we found the memory used metric
        if memory_used_metric:
            gaudi_mapping["GPU Memory Usage (GB)"] = (
                f"avg({memory_used_metric}) / (1024*1024*1024)"
            )
        
        # Add memory usage percentage if we have both used and total
        if memory_used_metric and memory_total_metric:
            gaudi_mapping["GPU Memory Usage (%)"] = (
                f"(avg({memory_used_metric}) / avg({memory_total_metric})) * 100"
            )

        if gaudi_mapping:
            logger.info("Successfully discovered %d Intel Gaudi metrics", len(gaudi_mapping))
        else:
            logger.warning("No Intel Gaudi metrics found - cluster may not have Intel Gaudi accelerators or monitoring")

        return gaudi_mapping
    except Exception as e:
        logger.error("Error discovering Intel Gaudi metrics", exc_info=e)
        return {}


def discover_openshift_metrics():
    """Return comprehensive OpenShift/Kubernetes metrics organized by category"""
    return {
        # ========== CLUSTER-WIDE CATEGORIES ==========
        "Fleet Overview": {
            # Core cluster-wide metrics
            "Total Pods Running": "sum(kube_pod_status_phase{phase='Running'})",
            "Total Pods Failed": "sum(kube_pod_status_phase{phase='Failed'})",
            "Pods Pending": "sum(kube_pod_status_phase{phase='Pending'})",
            "Total Deployments": "sum(kube_deployment_status_replicas_ready)",
            "Cluster CPU Usage (%)": "100 - (avg(rate(node_cpu_seconds_total{mode='idle'}[5m])) * 100)",
            "Cluster Memory Usage (%)": "100 - (sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes) * 100)",
            "Total Services": "sum(kube_service_info)",
            "Total Nodes": "sum(kube_node_info)",
            "Total Namespaces": "count(kube_namespace_labels)",
        },
        "Jobs & Workloads": {
            # Jobs, cronjobs, and other workload types
            "Jobs Running": "sum(kube_job_status_active)",
            "Jobs Completed": "sum(kube_job_status_succeeded)",
            "Jobs Failed": "sum(kube_job_status_failed)", 
            "CronJobs": "sum(kube_cronjob_info)",
            "DaemonSets Ready": "sum(kube_daemonset_status_number_ready)",
            "StatefulSets Ready": "sum(kube_statefulset_status_replicas_ready)",
            "ReplicaSets Ready": "sum(kube_replicaset_status_ready_replicas)",
        },
        "Storage & Config": {
            # Storage and configuration resources
            "Persistent Volumes": "sum(kube_persistentvolume_info)",
            "PV Claims": "sum(kube_persistentvolumeclaim_info)",
            "PVC Bound": "sum(kube_persistentvolumeclaim_status_phase{phase='Bound'})",
            "PVC Pending": "sum(kube_persistentvolumeclaim_status_phase{phase='Pending'})",
            "ConfigMaps": "sum(kube_configmap_info)",
            "Secrets": "sum(kube_secret_info)",
            "Storage Classes": "sum(kube_storageclass_info)",
        },
        "Node Metrics": {
            # Node-level resource metrics
            "Node CPU Usage (%)": "100 - (avg(rate(node_cpu_seconds_total{mode='idle'}[5m])) * 100)",
            "Node Memory Available (GB)": "sum(node_memory_MemAvailable_bytes) / (1024*1024*1024)",
            "Node Memory Total (GB)": "sum(node_memory_MemTotal_bytes) / (1024*1024*1024)",
            "Node Disk Reads": "sum(rate(node_disk_reads_completed_total[5m]))",
            "Node Disk Writes": "sum(rate(node_disk_writes_completed_total[5m]))",
            "Nodes Ready": "sum(kube_node_status_condition{condition='Ready',status='true'})",
            "Nodes Not Ready": "sum(kube_node_status_condition{condition='Ready',status='false'})",
            "Memory Pressure": "sum(kube_node_status_condition{condition='MemoryPressure',status='true'})",
            "Disk Pressure": "sum(kube_node_status_condition{condition='DiskPressure',status='true'})",
            "PID Pressure": "sum(kube_node_status_condition{condition='PIDPressure',status='true'})",
        },
        "GPU & Accelerators": {
            # GPU/Accelerator fleet monitoring (multi-vendor: NVIDIA DCGM + Intel Gaudi)
            "GPU Temperature (°C)": "avg(DCGM_FI_DEV_GPU_TEMP) or avg(habanalabs_temperature_onchip)",
            "GPU Power Usage (W)": "avg(DCGM_FI_DEV_POWER_USAGE) or avg(habanalabs_power_mW) / 1000",
            "GPU Utilization (%)": "avg(DCGM_FI_DEV_GPU_UTIL) or avg(habanalabs_utilization)",
            "GPU Memory Used (GB)": "avg(DCGM_FI_DEV_FB_USED) / (1024*1024*1024) or avg(habanalabs_memory_used_bytes) / (1024*1024*1024)",
            "GPU Count": "count(DCGM_FI_DEV_GPU_TEMP) or sum(habana_hpu_count)",
            "GPU Memory Temp (°C)": "avg(DCGM_FI_DEV_MEMORY_TEMP) or avg(habanalabs_temperature_threshold_memory)",
        },
        "Autoscaling & Scheduling": {
            # Autoscaling and scheduling metrics
            "Pending Pods": "sum(kube_pod_status_phase{phase='Pending'})",
            "Scheduler Latency (s)": "histogram_quantile(0.99, sum(rate(scheduler_e2e_scheduling_duration_seconds_bucket[5m])) by (le))",
            "CPU Requests Total": "sum(kube_pod_container_resource_requests{resource='cpu'})",
            "CPU Limits Total": "sum(kube_pod_container_resource_limits{resource='cpu'})",
            "Memory Requests (GB)": "sum(kube_pod_container_resource_requests{resource='memory'}) / (1024*1024*1024)",
            "Memory Limits (GB)": "sum(kube_pod_container_resource_limits{resource='memory'}) / (1024*1024*1024)",
            "HPA Active": "sum(kube_horizontalpodautoscaler_status_current_replicas)",
            "HPA Desired": "sum(kube_horizontalpodautoscaler_status_desired_replicas)",
        },
        # ========== NAMESPACE-SCOPED CATEGORIES ==========
        "Pod & Container Metrics": {
            # Pod and container resource usage
            "Pod CPU Usage (cores)": "sum(rate(container_cpu_usage_seconds_total[5m]))",
            "CPU Throttled (%)": "sum(rate(container_cpu_cfs_throttled_periods_total[5m])) / sum(rate(container_cpu_cfs_periods_total[5m])) * 100",
            "Pod Memory (GB)": "sum(container_memory_working_set_bytes) / (1024*1024*1024)",
            "RSS Memory (GB)": "sum(container_memory_rss) / (1024*1024*1024)",
            "Container Restarts": "sum(kube_pod_container_status_restarts_total)",
            "Pods Ready": "sum(kube_pod_status_ready{condition='true'})",
            "Pods Not Ready": "sum(kube_pod_status_ready{condition='false'})",
            "Container OOM Killed": "sum(kube_pod_container_status_last_terminated_reason{reason='OOMKilled'})",
        },
        "Network Metrics": {
            # Network I/O metrics
            "Network RX (MB/s)": "sum(rate(container_network_receive_bytes_total[5m])) / (1024*1024)",
            "Network TX (MB/s)": "sum(rate(container_network_transmit_bytes_total[5m])) / (1024*1024)",
            "Network RX Packets": "sum(rate(container_network_receive_packets_total[5m]))",
            "Network TX Packets": "sum(rate(container_network_transmit_packets_total[5m]))",
            "Network RX Errors": "sum(rate(container_network_receive_errors_total[5m]))",
            "Network TX Errors": "sum(rate(container_network_transmit_errors_total[5m]))",
            "Network RX Dropped": "sum(rate(container_network_receive_packets_dropped_total[5m]))",
            "Network TX Dropped": "sum(rate(container_network_transmit_packets_dropped_total[5m]))",
        },
        "Storage I/O": {
            # Storage and filesystem metrics
            "Disk Read (MB/s)": "sum(rate(container_fs_reads_bytes_total[5m])) / (1024*1024)",
            "Disk Write (MB/s)": "sum(rate(container_fs_writes_bytes_total[5m])) / (1024*1024)",
            "Disk Read IOPS": "sum(rate(container_fs_reads_total[5m]))",
            "Disk Write IOPS": "sum(rate(container_fs_writes_total[5m]))",
            "Filesystem Usage (GB)": "sum(container_fs_usage_bytes) / (1024*1024*1024)",
            "Filesystem Limit (GB)": "sum(container_fs_limit_bytes) / (1024*1024*1024)",
            "PVC Used (GB)": "sum(kubelet_volume_stats_used_bytes) / (1024*1024*1024)",
            "PVC Capacity (GB)": "sum(kubelet_volume_stats_capacity_bytes) / (1024*1024*1024)",
        },
        "Services & Networking": {
            # Services and ingress metrics
            "Services Running": "sum(kube_service_info)",
            "Service Endpoints": "sum(kube_endpoint_address_available)",
            "Ingress Rules": "sum(kube_ingress_info)",
            "Network Policies": "sum(kube_networkpolicy_labels)",
            "Load Balancer Services": "sum(kube_service_spec_type{type='LoadBalancer'})",
            "ClusterIP Services": "sum(kube_service_spec_type{type='ClusterIP'})",
        },
        "Application Services": {
            # Application-level metrics
            "HTTP Request Rate": "sum(rate(http_requests_total[5m]))",
            "HTTP Error Rate (%)": "sum(rate(http_requests_total{status=~'5..'}[5m])) / sum(rate(http_requests_total[5m])) * 100",
            "HTTP P95 Latency (s)": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
            "HTTP P99 Latency (s)": "histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
            "Active Connections": "sum(nginx_ingress_controller_nginx_process_connections)",
            "Ingress Request Rate": "sum(rate(nginx_ingress_controller_requests[5m]))",
        },
    } 


# Cache discovered metrics to avoid repeated API calls
_vllm_metrics_cache = None
_openshift_metrics_cache = None
_cache_timestamp = None
CACHE_TTL = 300  # 5 minutes


def get_vllm_metrics():
    """Get vLLM metrics with caching"""
    global _vllm_metrics_cache, _cache_timestamp

    current_time = datetime.now().timestamp()
    if (
        _vllm_metrics_cache is None
        or _cache_timestamp is None
        or (current_time - _cache_timestamp) > CACHE_TTL
    ):
        _vllm_metrics_cache = discover_vllm_metrics()
        _cache_timestamp = current_time

    return _vllm_metrics_cache


def get_openshift_metrics():
    """Get OpenShift metrics with caching"""
    global _openshift_metrics_cache, _cache_timestamp

    current_time = datetime.now().timestamp()
    if (
        _openshift_metrics_cache is None
        or _cache_timestamp is None
        or (current_time - _cache_timestamp) > CACHE_TTL
    ):
        _openshift_metrics_cache = discover_openshift_metrics()
        _cache_timestamp = current_time

    return _openshift_metrics_cache


def discover_cluster_metrics_dynamically():
    """Dynamically discover cluster metrics from Prometheus"""
    try:
        headers = {"Authorization": f"Bearer {THANOS_TOKEN}"}
        response = requests.get(
            f"{PROMETHEUS_URL}/api/v1/label/__name__/values",
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30,
        )
        response.raise_for_status()
        all_metrics = response.json()["data"]

        # Filter for Kubernetes/OpenShift metrics
        cluster_metrics = {}
        kube_prefixes = ["kube_", "node_", "container_", "apiserver_", "etcd_", "scheduler_", "kubelet_"]
        
        for metric in all_metrics:
            if any(metric.startswith(prefix) for prefix in kube_prefixes):
                # Create a friendly name
                friendly_name = metric.replace("_", " ").title()
                cluster_metrics[friendly_name] = f"sum({metric})"

        # Limit to first 50 metrics to avoid overwhelming UI
        limited_metrics = dict(list(cluster_metrics.items())[:50])
        return limited_metrics
    except Exception as e:
        logger.error("Error discovering cluster metrics", exc_info=e)
        return {}


def get_all_metrics():
    """Get all available metrics (vLLM, OpenShift, GPU) combined"""
    all_metrics = {}
    
    # Add vLLM metrics
    vllm_metrics = get_vllm_metrics()
    for label, query in vllm_metrics.items():
        all_metrics[f"vLLM: {label}"] = query
    
    # Add GPU/DCGM metrics
    dcgm_metrics = discover_dcgm_metrics()
    for label, query in dcgm_metrics.items():
        all_metrics[f"GPU: {label}"] = query
    
    # Add OpenShift metrics (flattened from categories)
    openshift_metrics = get_openshift_metrics()
    for category, metrics in openshift_metrics.items():
        for label, query in metrics.items():
            all_metrics[f"OpenShift {category}: {label}"] = query
    
    return all_metrics


def get_namespace_specific_metrics(category):
    """Get metrics that actually have namespace labels for namespace-specific analysis"""

    namespace_aware_metrics = {
        "Fleet Overview": {
            # Metrics that work with namespace filtering
            "Deployment Replicas Ready": "sum(kube_deployment_status_replicas_ready)",
            "Pods Running": "sum(kube_pod_status_phase{phase='Running'})",
            "Pods Failed": "sum(kube_pod_status_phase{phase='Failed'})",
            "Container CPU Usage": "sum(rate(container_cpu_usage_seconds_total[5m]))",
            "Container Memory Usage": "sum(container_memory_usage_bytes)",
            "Pod Restart Rate": "sum(rate(kube_pod_container_status_restarts_total[5m]))",
        },
        "Workloads & Pods": {
            # Pod and container metrics naturally have namespace labels
            "Pods Running": "sum(kube_pod_status_phase{phase='Running'})",
            "Pods Pending": "sum(kube_pod_status_phase{phase='Pending'})",
            "Pods Failed": "sum(kube_pod_status_phase{phase='Failed'})",
            "Pod Restarts (Rate)": "sum(rate(kube_pod_container_status_restarts_total[5m]))",
            "Container CPU Usage": "sum(rate(container_cpu_usage_seconds_total[5m]))",
            "Container Memory Usage": "sum(container_memory_usage_bytes)",
        },
        "Compute & Resources": {
            # Container-level compute and resource metrics
            "Container CPU Throttling": "sum(container_cpu_cfs_throttled_seconds_total)",
            "Container Memory Failures": "sum(container_memory_failcnt)",
            "OOM Events": "sum(container_oom_events_total)",
            "Container Processes": "sum(container_processes)",
            "Container Threads": "sum(container_threads)",
            "Container File Descriptors": "sum(container_file_descriptors)",
        },
        "Storage & Networking": {
            # Storage and network metrics that have namespace context
            "PV Claims Bound": "sum(kube_persistentvolumeclaim_status_phase{phase='Bound'})",
            "PV Claims Pending": "sum(kube_persistentvolumeclaim_status_phase{phase='Pending'})",
            "Container Network Receive": "sum(rate(container_network_receive_bytes_total[5m]))",
            "Container Network Transmit": "sum(rate(container_network_transmit_bytes_total[5m]))",
            "Network Errors": "sum(rate(container_network_receive_errors_total[5m]) + rate(container_network_transmit_errors_total[5m]))",
            "Filesystem Usage": "sum(container_fs_usage_bytes)",
        },
        "Application Services": {
            # Application metrics that work at namespace level
            "HTTP Request Rate": "sum(rate(http_requests_total[5m]))",
            "HTTP Error Rate (%)": "sum(rate(http_requests_total{status=~'5..'}[5m])) / sum(rate(http_requests_total[5m])) * 100",
            "Available Endpoints": "sum(kube_endpoint_address_available)",
            "Container Processes": "sum(container_processes)",
            "Container File Descriptors": "sum(container_file_descriptors)",
            "Container Threads": "sum(container_threads)",
        },
    }

    return namespace_aware_metrics.get(category, {})


def _select_openshift_metrics_for_scope(
    metric_category: str,
    scope: str,
    namespace: Optional[str],
) -> Tuple[Dict[str, str], Optional[str]]:
    """Select metrics dict and namespace filter based on scope/category.

    Returns (metrics_to_fetch, namespace_for_query)
    """
    openshift_metrics = get_openshift_metrics()

    if scope == NAMESPACE_SCOPED and namespace:
        namespace_metrics = get_namespace_specific_metrics(metric_category)
        metrics_to_fetch = (
            namespace_metrics if namespace_metrics else openshift_metrics.get(metric_category, {})
        )
    else:
        metrics_to_fetch = openshift_metrics.get(metric_category, {})

    namespace_for_query = namespace if scope == NAMESPACE_SCOPED else None
    return metrics_to_fetch, namespace_for_query


def analyze_openshift_metrics(
    metric_category: str,
    scope: str,
    namespace: Optional[str],
    start_ts: int,
    end_ts: int,
    summarize_model_id: Optional[str],
    api_key: Optional[str],
) -> Dict[str, Any]:
    """
    Returns a dict matching the API response fields (health_prompt, llm_summary, metrics, etc.).
    Raises HTTPException for client (400) and server (500) errors.
    """
    metrics_to_fetch, namespace_for_query = _select_openshift_metrics_for_scope(
        metric_category, scope, namespace
    )
    # Fetch metrics; if Prometheus fails, raise immediately so MCP tool can surface PROMETHEUS_ERROR
    metric_dfs: Dict[str, Any] = {}
    try:
        for label, query in metrics_to_fetch.items():
            df = fetch_openshift_metrics(
                query,
                start_ts,
                end_ts,
                namespace_for_query,
            )
            metric_dfs[label] = df
    except requests.exceptions.RequestException:
        # Bubble up Prometheus errors unchanged; MCP layer maps them to PrometheusError
        raise
    # Build scope description
    scope_description = f"{scope.replace('_', ' ').title()}"
    if scope == NAMESPACE_SCOPED and namespace:
        scope_description += f" ({namespace})"

    # Build correlated log/trace context for OpenShift analysis (only when relevant)
    log_trace_data: str = ""
    if KORREL8R_ENABLED:
        log_trace_data = build_log_trace_context_for_pod_issues(
            namespace_for_query=namespace_for_query,
            namespace_label=namespace,
            start_ts=start_ts,
            end_ts=end_ts,
            metrics_to_fetch=metrics_to_fetch,
        )
        logger.debug("In analyze_openshift_metrics: log_trace_data=%s", log_trace_data)
    # Build OpenShift metrics prompt (including optional log/trace context)
    prompt = build_openshift_prompt(
        metric_dfs, metric_category, namespace_for_query, scope_description, log_trace_data
    )

    logger.debug("In analyze_openshift_metrics: prompt=%s", prompt)
    # Summarize; if LLM service fails, raise HTTPException to be mapped to LLMServiceError by MCP
    try:
        summary = summarize_with_llm(
            prompt, summarize_model_id or "", ResponseType.OPENSHIFT_ANALYSIS, api_key or ""
        )
    except requests.exceptions.RequestException:
        # Re-raise so MCP layer can classify as LLM service error
        raise
 
    # Serialize metric DataFrames
    serialized_metrics: Dict[str, Any] = {}
    for label, df in metric_dfs.items():
            if "timestamp" not in df.columns:
                df["timestamp"] = pd.Series(dtype="datetime64[ns]")
            if "value" not in df.columns:
                df["value"] = pd.Series(dtype="float")
            serialized_metrics[label] = df[["timestamp", "value"]].to_dict(orient="records")

    return {
        "metric_category": metric_category,
        "scope": scope,
        "namespace": namespace,
        "health_prompt": prompt,
        "llm_summary": summary,
        "metrics": serialized_metrics,
    }


def chat_openshift_metrics(
    metric_category: str,
    question: str,
    scope: str,
    namespace: Optional[str],
    start_ts: int,
    end_ts: int,
    summarize_model_id: Optional[str],
    api_key: Optional[str],
) -> Dict[str, Any]:
    """
    Build a chat-oriented OpenShift analysis:
    - Validates inputs (raises HTTPException on errors)
    - Fetches metrics per category/scope
    - Builds prompt and invokes LLM
    - Parses LLM JSON to extract promql and summary
    Returns dict with at least: {"promql": str, "summary": str}
    """
    # Select metrics without raising (validation is done by callers)
    metrics_to_fetch, namespace_for_query = _select_openshift_metrics_for_scope(
        metric_category, scope, namespace
    )
    metric_dfs: Dict[str, Any] = {}
    for label, query in metrics_to_fetch.items():
        # Allow Prometheus connectivity/request exceptions to propagate so callers
        # (e.g., MCP tools) can surface structured PROMETHEUS_ERROR instead of
        # falling back to a generic "no data" message.
        df = fetch_openshift_metrics(query, start_ts, end_ts, namespace_for_query)
        metric_dfs[label] = df

    # If no data at all, avoid LLM call and return helpful message
    has_any_data = any(isinstance(df, pd.DataFrame) and not df.empty for df in metric_dfs.values())
    if not has_any_data:
        return {
            "promql": "",
            "summary": (
                "No metric data found for the selected category/scope in the time window. "
                "Try a broader window (e.g., last 6h) or a different category."
            ),
        }

    # Build scope description and prompt
    scope_description = f"{scope.replace('_', ' ').title()}"
    if scope == NAMESPACE_SCOPED and namespace:
        scope_description += f" ({namespace})"

    # Build correlated log/trace context for chat_openshift_metrics prompt (only when relevant)
    log_trace_data: str = ""
    if KORREL8R_ENABLED:
        log_trace_data = build_log_trace_context_for_pod_issues(
            namespace_for_query=namespace_for_query,
            namespace_label=namespace,
            start_ts=start_ts,
            end_ts=end_ts,
            metrics_to_fetch=metrics_to_fetch,
        )
        logger.debug("In chat_openshift_metrics: log_trace_data=%s", log_trace_data)

    metrics_data_summary = build_openshift_metrics_context(
        metric_dfs, metric_category, namespace_for_query, scope_description
    )

    chat_scope_value = "fleet_wide" if scope == CLUSTER_WIDE else "namespace_specific"
    prompt = build_openshift_chat_prompt(
        question=question,
        metrics_context=metrics_data_summary,
        time_range_info=None,
        chat_scope=chat_scope_value,
        target_namespace=namespace_for_query if scope == NAMESPACE_SCOPED else None,
        log_trace_data=log_trace_data,
    )

    llm_response = summarize_with_llm(
        prompt, summarize_model_id or "", ResponseType.OPENSHIFT_ANALYSIS, api_key or ""
    )
    # Parse JSON content robustly (handles extra text and fenced code blocks)
    promql = ""
    summary = llm_response
    parsed = extract_first_json_object_from_text(llm_response)
    if isinstance(parsed, dict):
        # Allow both a single promql and a list of promqls (take first)
        promql_value = parsed.get("promql")
        if not promql_value and isinstance(parsed.get("promqls"), list) and parsed["promqls"]:
            promql_value = parsed["promqls"][0]
        promql = (promql_value or "").strip() if isinstance(promql_value, str) else (promql_value or "")
        if not isinstance(promql, str):
            promql = ""
        summary = (parsed.get("summary") or llm_response).strip()

        # Add namespace filter when needed
        if promql and namespace and "namespace=" not in promql:
            if "{" in promql:
                promql = promql.replace("{", f'{{namespace="{namespace}", ', 1)
            else:
                promql = f'{promql}{{namespace="{namespace}"}}'
    return {
        "promql": promql,
        "summary": summary,
    }

# --- Metric Fetching Functions ---

def fetch_metrics(query, model_name, start, end, namespace=None):
    """Fetch metrics from Prometheus for vLLM models"""
    promql_query = query

    # Inject labels for vLLM metrics inside rate()/histogram_quantile expressions
    def _inject_labels(expr: str, model: str, ns: Optional[str]) -> str:
        # Helper to build label matcher
        if "|" in model:
            model_ns, actual_model = map(str.strip, model.split("|", 1))
        else:
            model_ns, actual_model = None, model.strip()

        ns_value = (ns or model_ns or "").strip()
        label_clause = f'model_name="{actual_model}"' + (f', namespace="{ns_value}"' if ns_value else "")

        # Match complete vllm metric names that don't already have labels
        # Use inline lambda to make the dependency on label_clause explicit
        expr = re.sub(
            r"\b(vllm:[\w:]+)(?!\{)",
            lambda m: f"{m.group(1)}{{{label_clause}}}",
            expr,
        )
        
        return expr

    # GPU metrics are global; inject only for vLLM metrics
    if "vllm:" in promql_query:
        promql_query = _inject_labels(promql_query, model_name, namespace)

    headers = _auth_headers()
    try:
        step = choose_prometheus_step(start, end)
        logger.debug("Fetching Prometheus metrics for vLLM, query: %s, start: %s, end: %s: step: %s", query, start, end, step)
        response = requests.get(
            f"{PROMETHEUS_URL}/api/v1/query_range",
            headers=headers,
            params={"query": promql_query, "start": start, "end": end, "step": step},
            verify=VERIFY_SSL,
            timeout=30,  # Add timeout
        )
        response.raise_for_status()
        result = response.json()["data"]["result"]

    except requests.exceptions.ConnectionError as e:
        logger.warning("Prometheus connection error for query '%s': %s", promql_query, e)
        return pd.DataFrame()  # Return empty DataFrame on connection error
    except requests.exceptions.Timeout as e:
        logger.warning("Prometheus timeout for query '%s': %s", promql_query, e)
        return pd.DataFrame()  # Return empty DataFrame on timeout
    except requests.exceptions.RequestException as e:
        logger.warning("Prometheus request error for query '%s': %s", promql_query, e)
        return pd.DataFrame()  # Return empty DataFrame on other request errors

    rows = []
    for series in result:
        for val in series["values"]:
            ts = datetime.fromtimestamp(float(val[0]))
            value = float(val[1])

            # Handle NaN values that can't be JSON serialized
            if pd.isna(value) or value != value:  # Check for NaN
                value = 0.0  # Convert NaN to 0 for JSON compatibility

            row = dict(series["metric"])
            row["timestamp"] = ts
            row["value"] = value
            rows.append(row)

    return pd.DataFrame(rows)


def fetch_openshift_metrics(query, start, end, namespace=None):
    """Fetch OpenShift metrics with optional namespace filtering.

    Network/request exceptions are raised to allow callers (e.g., MCP tools)
    to convert them into structured errors for the UI.
    """
    headers = _auth_headers()
    # Add namespace filter to the query if specified
    if namespace:
        # Skip if namespace already exists in the query
        if f'namespace="{namespace}"' in query:
            pass  # Already has the correct namespace
        else:
            # Simple string replacements for common patterns

            # Pattern 1: sum(metric_name)
            pattern1 = r"sum\(([a-zA-Z_:][a-zA-Z0-9_:]*)\)"
            if re.search(pattern1, query):
                query = re.sub(pattern1, f'sum(\\1{{namespace="{namespace}"}})', query)

            # Pattern 2: sum(rate(metric_name[5m]))
            elif re.search(r"sum\(rate\([a-zA-Z_:][a-zA-Z0-9_:]*\[[^\]]+\]\)\)", query):
                pattern2 = r"sum\(rate\(([a-zA-Z_:][a-zA-Z0-9_:]*)\[([^\]]+)\]\)\)"
                query = re.sub(
                    pattern2, f'sum(rate(\\1{{namespace="{namespace}"}}[\\2]))', query
                )

            # Pattern 3: rate(metric_name[5m])
            elif re.search(r"rate\([a-zA-Z_:][a-zA-Z0-9_:]*\[[^\]]+\]\)", query):
                pattern3 = r"rate\(([a-zA-Z_:][a-zA-Z0-9_:]*)\[([^\]]+)\]\)"
                query = re.sub(
                    pattern3, f'rate(\\1{{namespace="{namespace}"}}[\\2])', query
                )

            # Pattern 4: metric_name{existing_labels}
            elif re.search(r"[a-zA-Z_:][a-zA-Z0-9_:]*\{[^}]*\}", query):
                pattern4 = r"([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}"
                query = re.sub(pattern4, f'\\1{{namespace="{namespace}",\\2}}', query)

            # Pattern 5: simple metric_name (no labels)
            elif re.search(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$", query):
                query = f'{query}{{namespace="{namespace}"}}'

            # Pattern 6: handle other aggregations (avg, count, etc.)
            else:
                for func in ["avg", "count", "max", "min"]:
                    pattern = f"{func}\\(([a-zA-Z_:][a-zA-Z0-9_:]*)\\)"
                    if re.search(pattern, query):
                        query = re.sub(
                            pattern, f'{func}(\\1{{namespace="{namespace}"}})', query
                        )
                        break

    try:
        step = choose_prometheus_step(start, end)
        logger.debug("Fetching Prometheus metrics for OpenShift, query: %s, start: %s, end: %s: step: %s", query, start, end, step)
        response = requests.get(
            f"{PROMETHEUS_URL}/api/v1/query_range",
            headers=headers,
            params={"query": query, "start": start, "end": end, "step": step},
            verify=VERIFY_SSL,
            timeout=30,  # Add timeout
        )
        response.raise_for_status()
        result = response.json()["data"]["result"]
        logger.debug("Metrics fetched successfully")
    except requests.exceptions.ConnectionError as e:
        logger.warning("Prometheus connection error for OpenShift query '%s': %s", query, e)
        raise
    except requests.exceptions.Timeout as e:
        logger.warning("Prometheus timeout for OpenShift query '%s': %s", query, e)
        raise
    except requests.exceptions.RequestException as e:
        logger.warning("Prometheus request error for OpenShift query '%s': %s", query, e)
        raise

    rows = []
    for series in result:
        for val in series["values"]:
            ts = datetime.fromtimestamp(float(val[0]))
            value = float(val[1])

            # Handle NaN values that can't be JSON serialized
            if pd.isna(value) or value != value:  # Check for NaN
                value = 0.0  # Convert NaN to 0 for JSON compatibility

            row = dict(series["metric"])
            row["timestamp"] = ts
            row["value"] = value
            rows.append(row)

    return pd.DataFrame(rows) 


# --- Business logic for MCP tools (moved from tools module) ---

def build_log_trace_context_for_pod_issues(
    namespace_for_query: Optional[str],
    namespace_label: Optional[str],
    start_ts: int,
    end_ts: int,
    metrics_to_fetch: Optional[Dict[str, str]] = None,
) -> str:
    """Return correlated log/trace context for pods in Failed/CrashLoopBackOff states.

    Uses an explicit PromQL to retrieve (namespace,pod) pairs, then delegates to
    build_correlated_context_from_metrics to construct the prompt lines. Returns
    an empty string on any error.
    """
    try:
        contains_pods_failed_metric = any(
            isinstance(label, str) and ("Pods Failed" in label)
            for label in (metrics_to_fetch or {}).keys()
        ) if isinstance(metrics_to_fetch, dict) else False
        if not contains_pods_failed_metric:
            return ""

        pod_issue_query = (
            "max by (namespace, pod) ((kube_pod_status_phase{phase=\"Failed\"} == 1) "
            "or (kube_pod_container_status_waiting_reason{reason=\"CrashLoopBackOff\"} == 1))"
        )
        pairs_df = fetch_openshift_metrics(
            pod_issue_query,
            start_ts,
            end_ts,
            namespace_for_query,
        )
        pairs_metric_dfs: Dict[str, Any] = {"pod_status": pairs_df}
        logger.debug("In build_log_trace_context_for_pod_issues: pairs_metric_dfs=%s", pairs_metric_dfs)
        if not pairs_metric_dfs:
            return ""
        return build_correlated_context_from_metrics(
            metric_dfs=pairs_metric_dfs,
            model_name=namespace_label or "",
            start_ts=start_ts,
            end_ts=end_ts,
        )
    except Exception:
        return ""

def get_summarization_models() -> List[str]:
    """Return available summarization model IDs from MODEL_CONFIG.

    External models are sorted after internal ones to match UI expectations.
    When RAG infrastructure is not available, local models are filtered out.
    """
    try:
        if not isinstance(MODEL_CONFIG, dict) or not MODEL_CONFIG:
            return []
        
        # Import here to avoid circular imports
        from core.config import RAG_AVAILABLE
        
        # Filter out local models if RAG is not available
        available_models = []
        for name, config in MODEL_CONFIG.items():
            is_external = config.get("external", True)
            if not is_external and not RAG_AVAILABLE:
                # Skip local models when RAG infrastructure is unavailable
                continue
            available_models.append((name, config))
        
        # Sort with internal models first, external models second
        sorted_items = sorted(available_models, key=lambda x: x[1].get("external", True))
        return [name for name, _ in sorted_items]
    except Exception:
        return []


def _fetch_vendor_gpu_info(
    headers: Dict[str, str],
    temp_metric: str,
    vendor_name: str,
    model_name: str,
    info: Dict[str, Any]
) -> int:
    """Helper function to fetch GPU info for a specific vendor.
    
    Args:
        headers: Authentication headers for Prometheus
        temp_metric: Temperature metric query (e.g., "DCGM_FI_DEV_GPU_TEMP")
        vendor_name: Vendor display name (e.g., "NVIDIA")
        model_name: Model display name (e.g., "GPU")
        info: Dictionary to populate with vendor data
        
    Returns:
        Count of GPUs/accelerators found for this vendor
    """
    try:
        resp = requests.get(
            f"{PROMETHEUS_URL}/api/v1/query",
            headers=headers,
            params={"query": temp_metric},
            verify=VERIFY_SSL,
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json().get("data", {}).get("result", [])
        count = len(result)
        if count > 0:
            temps = [float(series.get("value", [None, None])[1]) for series in result if series.get("value")]
            info["temperatures"].extend(temps)
            info["vendors"].append(vendor_name)
            info["models"].append(model_name)
        return count
    except Exception:
        return 0


def get_cluster_gpu_info() -> Dict[str, Any]:
    """Fetch cluster GPU/accelerator info from Prometheus (multi-vendor: NVIDIA DCGM + Intel Gaudi).

    Returns a dict with total_gpus, vendors, models, temperatures, power_usage.
    
    To add AMD support: Add a call to _fetch_vendor_gpu_info() with AMD-specific parameters
    (e.g., temp_metric="GPU_JUNCTION_TEMPERATURE", vendor_name="AMD", model_name="Instinct")
    and update the mixed vendor logic to include AMD.
    """
    headers = _auth_headers()
    info: Dict[str, Any] = {
        "total_gpus": 0,
        "vendors": [],
        "models": [],
        "temperatures": [],
        "power_usage": [],
    }
    
    # Fetch info for each vendor
    nvidia_count = _fetch_vendor_gpu_info(
        headers, "DCGM_FI_DEV_GPU_TEMP", "NVIDIA", "GPU", info
    )
    intel_count = _fetch_vendor_gpu_info(
        headers, "habanalabs_temperature_onchip", "Intel Gaudi", "Gaudi Accelerator", info
    )
    # TODO: AMD - Add AMD support:
    # amd_count = _fetch_vendor_gpu_info(
    #     headers, "GPU_JUNCTION_TEMPERATURE", "AMD", "Instinct", info
    # )
    
    # Set total count and handle mixed vendor scenarios
    info["total_gpus"] = nvidia_count + intel_count
    
    # If we have both vendors, add mixed indicator while preserving individual vendor info
    if nvidia_count > 0 and intel_count > 0:
        # Prepend mixed indicator to existing vendor lists
        info["vendors"].insert(0, "Mixed (NVIDIA + Intel Gaudi)")
        info["mixed"] = True
    
    return info


def get_namespace_model_deployment_info(namespace: str, model: str) -> Dict[str, Any]:
    """Heuristic deployment info by probing kube_pod_info and vLLM cache timeline."""
    headers = _auth_headers()
    try:
        # Probe pods in namespace
        query = f'kube_pod_info{{namespace="{namespace}"}}'
        r = requests.get(
            f"{PROMETHEUS_URL}/api/v1/query",
            headers=headers,
            params={"query": query},
            verify=VERIFY_SSL,
            timeout=30,
        )
        r.raise_for_status()
        result = r.json().get("data", {}).get("result", [])
    except Exception:
        result = []

    from datetime import datetime as _dt, timedelta as _td
    now = _dt.utcnow()
    is_new = False
    deploy_date: Optional[str] = None

    if result:
        try:
            one_week_ago = int((now - _td(days=7)).timestamp())
            vq = f'vllm:cache_config_info{{namespace="{namespace}"}}'
            vr = requests.get(
                f"{PROMETHEUS_URL}/api/v1/query_range",
                headers=headers,
                params={"query": vq, "start": one_week_ago, "end": int(now.timestamp()), "step": "1h"},
                verify=VERIFY_SSL,
                timeout=30,
            )
            if vr.status_code == 200:
                vres = vr.json().get("data", {}).get("result", [])
                if not vres:
                    is_new = True
                    deploy_date = now.strftime("%Y-%m-%d")
                else:
                    three_days_ago = now - _td(days=3)
                    for series in vres:
                        values = series.get("values", [])
                        if values:
                            first_ts = float(values[0][0])
                            first_time = _dt.utcfromtimestamp(first_ts)
                            if first_time > three_days_ago:
                                is_new = True
                                deploy_date = first_time.strftime("%Y-%m-%d")
                            break
        except Exception:
            is_new = True
            deploy_date = now.strftime("%Y-%m-%d")
    else:
        is_new = True
        deploy_date = now.strftime("%Y-%m-%d")

    message = None
    if is_new:
        message = (
            f"New deployment detected in namespace '{namespace}'. "
            f"Metrics will appear once the model starts processing requests. "
            f"This typically takes 5-10 minutes after the first inference request."
        )

    return {
        "is_new_deployment": is_new,
        "deployment_date": deploy_date,
        "message": message,
        "namespace": namespace,
        "model": model,
    }

def _fmt_val(v: Any) -> str:
    try:
        if v is None:
            return "null"
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, (int, float)):
            return str(v)
        s = str(v)
        if '"' in s:
            s = s.replace('"', '\\"')
        if any(c.isspace() for c in s):
            return f"\"{s}\""
        return s
    except Exception:
        return str(v)


def _format_span_kv(span_obj: Dict[str, Any]) -> str:
    ordered_keys = ["traceID", "spanID", "operationName", "startTime", "duration"]
    parts = []
    try:
        for k in ordered_keys:
            if k in span_obj:
                parts.append(f"{k}={_fmt_val(span_obj.get(k))}")
        # Add remaining top-level keys (excluding tags) in stable order
        for k in sorted(span_obj.keys()):
            if k in ordered_keys or k == "tags":
                continue
            parts.append(f"{k}={_fmt_val(span_obj.get(k))}")
        # Flatten tags (dict or list-style) into key=value
        tags_val = span_obj.get("tags")
        if isinstance(tags_val, dict):
            for tk in sorted(tags_val.keys()):
                parts.append(f"{tk}={_fmt_val(tags_val.get(tk))}")
        elif isinstance(tags_val, list):
            for t in tags_val:
                try:
                    tk = str(t.get("key", "")).strip()
                    tv = t.get("value")
                    if tk:
                        parts.append(f"{tk}={_fmt_val(tv)}")
                except Exception:
                    continue
    except Exception:
        pass
    return "- trace " + " ".join(parts) if parts else "- trace"


def _span_is_error_like(span: Dict[str, Any]) -> bool:
    try:
        tags = span.get("tags", {})
        kv_iter = []
        if isinstance(tags, dict):
            kv_iter = tags.items()
        elif isinstance(tags, list):
            tmp = []
            for t in tags:
                try:
                    k = str(t.get("key", "")).lower()
                    v = str(t.get("value", ""))
                    if k:
                        tmp.append((k, v))
                except Exception:
                    continue
            kv_iter = tmp
        keywords = ("error", "exception", "fatal", "panic", "fail", "critical")
        # Explicit error tag true
        for k, v in kv_iter:
            if k in ("error", "span.status.code", "status.code", "otel.status_code"):
                vs = str(v).strip().lower()
                if k == "error" and vs in ("true", "1", "yes"):
                    return True
                if vs in ("error", "2", "status_code_error"):
                    return True
            # Any tag value containing error-like keywords
            vs_lower = str(v).lower()
            if any(kw in vs_lower for kw in keywords):
                return True
        return False
    except Exception:
        return False


def build_correlated_context_from_metrics(
    metric_dfs: Dict[str, Any],
    model_name: str,
    start_ts: int,
    end_ts: int,
) -> str:
    """Return up to 5 log/trace lines for vLLM prompt.

    Each line includes: pod, container, level, and the log message.
    """
    if not KORREL8R_ENABLED:
        return ""
    try:
        # Gather all unique (namespace, pod) pairs from metrics
        pairs = extract_namespace_pod_pairs_from_metrics(model_name, metric_dfs)
        logger.debug("In build_correlated_context_from_metrics: pairs=%s", pairs)
        if not pairs:
            return ""
        goals = ["log:application", "log:infrastructure", "trace:span"]
        # Aggregate logs and traces across all pairs first
        aggregated_logs: List[Dict[str, Any]] = []
        aggregated_traces: List[Dict[str, Any]] = []
        for pair in pairs:
            try:
                query_str = build_korrel8r_log_query_for_vllm(pair.namespace, pair.pod)
                if not query_str:
                    continue
                logger.debug("In build_correlated_context_from_metrics: query_str=%s", query_str)
                aggregated = fetch_goal_query_objects(goals, query_str)
                logger.debug("In build_correlated_context_from_metrics: aggregated=%s", aggregated)
                # Logs
                for obj in aggregated.get("logs", []):
                    try:
                        message = obj.get("message") or obj.get("line") or ""
                        if not message:
                            continue
                        level = str(obj.get("level") or "UNKNOWN").upper()
                        # Skip DEBUG, INFO, TRACE, UNKNOWN levels
                        if level in ("DEBUG", "INFO", "TRACE", "UNKNOWN"):
                            continue
                        aggregated_logs.append(obj)
                    except Exception:
                        continue
                # Traces (kept for potential downstream use)
                try:
                    if isinstance(aggregated.get("traces", []), list):
                        aggregated_traces.extend(aggregated.get("traces", []))
                except Exception:
                    pass
            except Exception:
                continue
        # Sort aggregated logs by severity then timestamp
        aggregated_logs_sorted = sort_logs_by_severity_then_time(aggregated_logs)
        logger.debug("In build_correlated_context_from_metrics: aggregated_logs_sorted=%s", aggregated_logs_sorted)
        # Optionally log trace aggregate count for visibility
        try:
            logger.debug(
                "In build_correlated_context_from_metrics: aggregated_traces_count=%s",
                len(aggregated_traces),
            )
        except Exception:
            pass
        # Take top N (configurable) and build lines
        try:
            max_rows = int(os.getenv("MAX_NUM_LOG_ROWS", "10"))
        except Exception:
            max_rows = 10
        lines: List[str] = []
        for obj in aggregated_logs_sorted[:max_rows]:
            try:
                message = obj.get("message") or obj.get("line") or ""
                if not message:
                    continue
                pod = obj.get("pod") or ""
                namespace = obj.get("namespace") or ""
                level = str(obj.get("level") or "UNKNOWN").upper()
                lines.append(f"- namespace={namespace} pod={pod} level={level} {message}")
            except Exception:
                continue

        result_str = "\n".join(lines)
        # Filter error-like trace spans, then append top items using helper
        try:
            max_trace_spans = int(os.getenv("MAX_NUM_TRACE_SPANS", "10"))
        except Exception:
            max_trace_spans = 10
        filtered_spans = [s for s in aggregated_traces if isinstance(s, dict) and _span_is_error_like(s)]
        trace_lines_kv = []
        for span in filtered_spans[:max_trace_spans]:
            if isinstance(span, dict):
                trace_lines_kv.append(_format_span_kv(span))
        if trace_lines_kv:
            trace_section_str = "\n".join(trace_lines_kv)
            result_str = f"{result_str}\n{trace_section_str}" if result_str else trace_section_str
        # Optionally inject a synthetic error log line for testing ONLY
        try:
            if os.getenv("INJECT_VLLM_ERROR_LOG_MSG"):
                injected = (
                    "- namespace=dev pod=llama-3-2-3b-instruct-predictor-649469cd68-8zn49 "
                    "level=ERROR Server running out of memory"
                )
                result_str = f"{result_str}\n{injected}" if result_str else injected
        except Exception:
            pass
        logger.debug("In build_correlated_context_from_metrics: result=%s", result_str)
        return result_str
    except Exception:
        return ""