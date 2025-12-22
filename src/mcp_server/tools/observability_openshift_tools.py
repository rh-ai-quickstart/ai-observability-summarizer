from typing import Dict, Any, List, Optional
import os
import json
import base64
import core.metrics as core_metrics
import re
import pandas as pd
import requests

from .observability_vllm_tools import resolve_time_range
from core.response_utils import make_mcp_text_response
from core.metrics import (
    analyze_openshift_metrics,
    chat_openshift_metrics,
    NAMESPACE_SCOPED,
    CLUSTER_WIDE,
)
from common.pylogger import get_python_logger
from mcp_server.exceptions import (
    ValidationError,
    PrometheusError,
    LLMServiceError,
    MCPException,
    MCPErrorCode,
    validate_required_params,
    validate_time_range,
    parse_prometheus_error,
)

logger = get_python_logger()

K8S_SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
K8S_SA_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
K8S_API_URL = "https://kubernetes.default.svc"

def _detect_provider_from_model_id(model_id: Optional[str]) -> Optional[str]:
    try:
        if not model_id:
            return None
        if "/" in model_id:
            return model_id.split("/", 1)[0].strip().lower()
        m_lower = model_id.lower()
        if "gpt" in m_lower or "openai" in m_lower:
            return "openai"
        if "claude" in m_lower or "anthropic" in m_lower:
            return "anthropic"
        if "gemini" in m_lower or "google" in m_lower or "bard" in m_lower:
            return "google"
        if "llama" in m_lower or "meta" in m_lower:
            return "meta"
        return "internal"
    except Exception:
        return None

def _fetch_api_key_from_secret(provider: Optional[str]) -> Optional[str]:
    """
    Best-effort fetch of provider API key from a namespaced Secret:
      name: ai-<provider>-credentials
      data['api-key'] base64-encoded
    Requires RBAC for the service account to get the secret.
    """
    try:
        if not provider or provider == "internal":
            return None
        # Use only the MCP server namespace
        ns = os.getenv("NAMESPACE", "")
        if not ns:
            return None
        secret_name = f"ai-{provider}-credentials"
        token = ""
        try:
            with open(K8S_SA_TOKEN_PATH, "r") as f:
                token = f.read().strip()
        except Exception:
            return None
        if not token:
            return None
        headers = {"Authorization": f"Bearer {token}"}
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/secrets/{secret_name}"
        resp = requests.get(url, headers=headers, timeout=5, verify=verify)
        if resp.status_code != 200:
            logger.debug("Secret fetch failed: %s", resp.status_code)
            return None
        data = resp.json().get("data", {})
        api_key_b64 = data.get("api-key")
        if not api_key_b64:
            return None
        return base64.b64decode(api_key_b64).decode("utf-8").strip()
    except Exception as e:
        logger.debug("Error fetching API key from Secret: %s", e)
        return None


def _classify_requests_error(e: Exception) -> str:
    """Classify requests exceptions as 'prom', 'llm', or 'unknown'."""
    try:
        url = ""
        resp = getattr(e, "response", None)
        if resp is not None:
            url = getattr(resp, "url", "") or ""
        text = f"{url} {str(e)}".lower()
        if "/api/v1/query" in text or "/api/v1/query_range" in text:
            return "prom"
        if "/v1/openai" in text or "/completions" in text or "llamastack" in text or "openai" in text or "/responses" in text:
            return "llm"
        return "unknown"
    except Exception:
        return "unknown"


def _extract_llm_error_message(e: requests.exceptions.HTTPError) -> str:
    """Extract detailed error message from LLM API HTTP error response."""
    try:
        resp = getattr(e, "response", None)
        if resp is None:
            return "Cannot reach LLM service."

        # Try to parse JSON error response (OpenAI, Anthropic, etc.)
        try:
            error_data = resp.json()
            # OpenAI format: {"error": {"message": "...", "type": "...", "code": "..."}}
            if "error" in error_data and isinstance(error_data["error"], dict):
                error_obj = error_data["error"]
                message = error_obj.get("message", "")
                error_type = error_obj.get("type", "")
                error_code = error_obj.get("code", "")

                if message:
                    # Include error type and code if available for better context
                    if error_type or error_code:
                        details = []
                        if error_type:
                            details.append(f"type: {error_type}")
                        if error_code:
                            details.append(f"code: {error_code}")
                        return f"{message} ({', '.join(details)})"
                    return message

            # Fallback: try to find any "message" field
            if "message" in error_data:
                return error_data["message"]
        except Exception:
            pass

        # Fallback to response text if JSON parsing fails
        if resp.text:
            return f"LLM service error (HTTP {resp.status_code}): {resp.text[:200]}"

        return f"LLM service returned HTTP {resp.status_code}"
    except Exception:
        return "Cannot reach LLM service."

def analyze_openshift(
    metric_category: str,
    scope: str = "cluster_wide",
    namespace: Optional[str] = None,
    time_range: Optional[str] = None,
    start_datetime: Optional[str] = None,
    end_datetime: Optional[str] = None,
    summarize_model_id: Optional[str] = None,
    api_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Analyze OpenShift metrics for a category and scope with structured error handling."""
    # Validate required parameters
    try:
        validate_required_params(metric_category=metric_category, scope=scope)
        if scope not in (CLUSTER_WIDE, NAMESPACE_SCOPED):
            raise ValidationError(
                message="Invalid scope. Use 'cluster_wide' or 'namespace_scoped'.",
                field="scope",
                value=scope,
            )
        if scope == NAMESPACE_SCOPED and not namespace:
            raise ValidationError(
                message="Namespace is required when scope is 'namespace_scoped'.",
                field="namespace",
                value=namespace,
            )
    except ValidationError as e:
        return e.to_mcp_response()
    except Exception as e:
        error = MCPException(
            message=f"Parameter validation failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the input parameters and try again.",
        )
        return error.to_mcp_response()

    # Resolve time range
    try:
        start_ts, end_ts = resolve_time_range(
            time_range=time_range,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
        )
    except Exception as e:
        error = MCPException(
            message=f"Time range resolution failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the time range parameters and try again.",
        )
        return error.to_mcp_response()

    # Validate time range
    try:
        validate_time_range(start_ts, end_ts)
    except ValidationError as e:
        return e.to_mcp_response()
    except Exception as e:
        error = MCPException(
            message=f"Time range validation failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the time range and try again.",
        )
        return error.to_mcp_response()

    # Perform analysis
    try:
        result = analyze_openshift_metrics(
            metric_category=metric_category,
            scope=scope,
            namespace=namespace or "",
            start_ts=start_ts,
            end_ts=end_ts,
            summarize_model_id=summarize_model_id or os.getenv("DEFAULT_SUMMARIZE_MODEL", ""),
            api_key=(
                api_key
                or os.getenv("LLM_API_TOKEN", "")
                or _fetch_api_key_from_secret(_detect_provider_from_model_id(summarize_model_id))
                or ""
            ),
        )

        # Format the response for MCP consumers
        summary = result.get("llm_summary", "")
        scope_desc = result.get("scope", scope)
        ns_desc = result.get("namespace", namespace or "")
        header = f"OpenShift Analysis ({metric_category}) — {scope_desc}"
        if scope == NAMESPACE_SCOPED and ns_desc:
            header += f" (namespace={ns_desc})"

        # Attach structured payload so UI can render metric grids
        def _serialize_metrics(metrics: Dict[str, Any]) -> Dict[str, Any]:
            out: Dict[str, Any] = {}
            try:
                for label, rows in (metrics or {}).items():
                    safe_rows = []
                    if isinstance(rows, list):
                        for r in rows:
                            if isinstance(r, dict):
                                ts = r.get("timestamp")
                                val = r.get("value")
                                # Convert timestamp to ISO 8601 string; ensure it ends with 'Z' to indicate UTC.
                                if hasattr(ts, "isoformat"):
                                    ts_str = ts.isoformat()
                                    if not ts_str.endswith("Z"):
                                        ts_str += "Z"
                                else:
                                    ts_str = str(ts) if ts is not None else ""
                                try:
                                    val_num = float(val) if val is not None else None
                                except Exception:
                                    val_num = None
                                safe_rows.append({"timestamp": ts_str, "value": val_num})
                    out[label] = safe_rows
            except Exception:
                return {}
            return out

        structured = {
            "health_prompt": result.get("health_prompt", ""),
            "llm_summary": summary,
            "metrics": _serialize_metrics(result.get("metrics", {})),
        }

        content = f"{header}\n\n{summary}\n\nSTRUCTURED_DATA:\n{json.dumps(structured)}".strip()
        return make_mcp_text_response(content)

    except PrometheusError as e:
        return e.to_mcp_response()
    except requests.exceptions.HTTPError as e:
        cls = _classify_requests_error(e)
        if cls == "llm":
            error_msg = _extract_llm_error_message(e)
            return LLMServiceError(message=error_msg).to_mcp_response()
        # Default: treat as Prometheus HTTP error
        prom_err = parse_prometheus_error(getattr(e, 'response', None))
        return prom_err.to_mcp_response()
    except requests.exceptions.ConnectionError as e:
        cls = _classify_requests_error(e)
        if cls == "llm":
            return LLMServiceError(message="Cannot reach LLM service.").to_mcp_response()
        return PrometheusError(message="Cannot connect to Prometheus/Thanos service.").to_mcp_response()
    except requests.exceptions.Timeout as e:
        cls = _classify_requests_error(e)
        if cls == "llm":
            return LLMServiceError(message="LLM service request timed out.").to_mcp_response()
        return PrometheusError(message="Prometheus/Thanos request timed out.").to_mcp_response()
    except requests.exceptions.RequestException as e:
        cls = _classify_requests_error(e)
        if cls == "llm":
            return LLMServiceError(message="LLM service request failed.").to_mcp_response()
        return PrometheusError(message="Prometheus/Thanos request failed.").to_mcp_response()
    except LLMServiceError as e:
        return e.to_mcp_response()
    except Exception as e:
        error = MCPException(
            message=f"Error running analyze_openshift: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
            recovery_suggestion="Please try again. If the problem persists, contact support.",
        )
        return error.to_mcp_response()


def fetch_openshift_metrics_data(
    metric_category: str,
    scope: str = "cluster_wide",
    namespace: Optional[str] = None,
    time_range: Optional[str] = None,
    start_datetime: Optional[str] = None,
    end_datetime: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch OpenShift metrics data for dashboard visualization (no LLM analysis).
    
    Uses parallel instant queries for fast dashboard loading.
    Returns raw metrics with latest values.
    """
    # Validate parameters
    try:
        validate_required_params(metric_category=metric_category, scope=scope)
        if scope not in (CLUSTER_WIDE, NAMESPACE_SCOPED):
            raise ValidationError(
                message="Invalid scope. Use 'cluster_wide' or 'namespace_scoped'.",
                field="scope",
                value=scope,
            )
        if scope == NAMESPACE_SCOPED and not namespace:
            raise ValidationError(
                message="Namespace is required when scope is 'namespace_scoped'.",
                field="namespace",
                value=namespace,
            )
    except ValidationError as e:
        return e.to_mcp_response()

    # Resolve time range (for metadata, not used in instant queries)
    try:
        start_ts, end_ts = resolve_time_range(
            time_range=time_range,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
        )
    except Exception as e:
        error = MCPException(
            message=f"Time range resolution failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
        )
        return error.to_mcp_response()

    try:
        # Get the queries for this category
        openshift_metrics = core_metrics.get_openshift_metrics()
        category_queries = openshift_metrics.get(metric_category, {})
        
        if not category_queries:
            return make_mcp_text_response(json.dumps({
                "category": metric_category,
                "scope": scope,
                "namespace": namespace,
                "metrics": {},
                "error": f"Unknown metric category: {metric_category}"
            }))

        # Prepare queries with namespace filter if needed
        prepared_queries: Dict[str, str] = {}
        for label, query in category_queries.items():
            final_query = query
            if scope == NAMESPACE_SCOPED and namespace:
                if '{' in query:
                    final_query = query.replace('{', f'{{namespace="{namespace}",')
                else:
                    # Add namespace filter to queries without existing filters
                    final_query = query.replace(')', f'{{namespace="{namespace}"}})')
            prepared_queries[label] = final_query

        # Execute instant queries for current values (fast!)
        values = core_metrics.execute_instant_queries_parallel(prepared_queries, max_workers=10)
        
        # Execute range queries for sparklines (in parallel)
        time_series_data = core_metrics.execute_range_queries_parallel(
            prepared_queries,
            start_ts,
            end_ts,
            max_workers=10,
            max_points=15  # ~15 points for sparklines
        )
        
        # Format results
        metrics_data: Dict[str, Any] = {}
        for label, value in values.items():
            metrics_data[label] = {
                "latest_value": value,
                "time_series": time_series_data.get(label, []),
            }

        result = {
            "category": metric_category,
            "scope": scope,
            "namespace": namespace,
            "start_ts": start_ts,
            "end_ts": end_ts,
            "metrics": metrics_data,
        }
        
        return make_mcp_text_response(json.dumps(result))

    except Exception as e:
        error = MCPException(
            message=f"Error fetching OpenShift metrics: {str(e)}",
            error_code=MCPErrorCode.PROMETHEUS_ERROR,
        )
        return error.to_mcp_response()


def list_openshift_metric_groups() -> List[Dict[str, Any]]:
    """Return OpenShift metric group categories (cluster-wide)."""
    groups = list(core_metrics.get_openshift_metrics().keys())
    header = "Available OpenShift Metric Groups (cluster-wide):\n\n"
    body = "\n".join([f"• {g}" for g in groups])
    return make_mcp_text_response(header + body if groups else "No OpenShift metric groups available.")


def list_openshift_namespace_metric_groups() -> List[Dict[str, Any]]:
    """Return OpenShift metric groups that support namespace-scoped analysis."""
    groups = [
        "Workloads & Pods",
        "Storage & Networking",
        "Application Services",
    ]
    header = "Available OpenShift Namespace Metric Groups:\n\n"
    body = "\n".join([f"• {g}" for g in groups])
    return make_mcp_text_response(header + body)


def list_openshift_namespaces() -> List[Dict[str, Any]]:
    """Get list of all OpenShift namespaces observed in Prometheus.

    Returns a bullet list formatted response suitable for MCP clients.
    """
    try:
        from core.metrics import get_openshift_namespaces_helper

        namespaces = get_openshift_namespaces_helper()
        if not namespaces:
            return make_mcp_text_response("No OpenShift namespaces found.")
        namespace_list = "\n".join([f"• {ns}" for ns in namespaces])
        response_text = f"OpenShift Namespaces ({len(namespaces)} total):\n\n{namespace_list}"
        return make_mcp_text_response(response_text)
    except Exception as e:
        err = MCPException(
            message=f"Failed to retrieve OpenShift namespaces: {str(e)}",
            error_code=MCPErrorCode.PROMETHEUS_ERROR,
            recovery_suggestion="Please check Prometheus/Thanos connectivity."
        )
        return err.to_mcp_response()

def chat_openshift(
    metric_category: str,
    question: str,
    scope: str = "cluster_wide",
    namespace: Optional[str] = None,
    time_range: Optional[str] = None,
    start_datetime: Optional[str] = None,
    end_datetime: Optional[str] = None,
    summarize_model_id: Optional[str] = None,
    api_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Chat about OpenShift metrics for a specific category/scope with structured error handling.

    Returns a text block including PromQL (if provided) and the LLM summary.
    """
    # Validate inputs
    try:
        validate_required_params(metric_category=metric_category, question=question, scope=scope)
        if scope not in (CLUSTER_WIDE, NAMESPACE_SCOPED):
            raise ValidationError(
                message="Invalid scope. Use 'cluster_wide' or 'namespace_scoped'.",
                field="scope",
                value=scope,
            )
        if scope == NAMESPACE_SCOPED and not namespace:
            raise ValidationError(
                message="Namespace is required when scope is 'namespace_scoped'.",
                field="namespace",
                value=namespace,
            )
    except ValidationError as e:
        return e.to_mcp_response()
    except Exception as e:
        err = MCPException(
            message=f"Parameter validation failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the input parameters and try again.",
        )
        return err.to_mcp_response()

    # Resolve and validate time range
    try:
        start_ts_resolved, end_ts_resolved = resolve_time_range(
            time_range=time_range,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
        )
    except Exception as e:
        err = MCPException(
            message=f"Time range resolution failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the time range parameters and try again.",
        )
        return err.to_mcp_response()

    try:
        validate_time_range(start_ts_resolved, end_ts_resolved)
    except ValidationError as e:
        return e.to_mcp_response()
    except Exception as e:
        err = MCPException(
            message=f"Time range validation failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the time range and try again.",
        )
        return err.to_mcp_response()

    # Delegate to core logic and handle provider errors
    try:
        result = chat_openshift_metrics(
            metric_category=metric_category,
            question=question,
            scope=scope,
            namespace=namespace or "",
            start_ts=start_ts_resolved,
            end_ts=end_ts_resolved,
            summarize_model_id=summarize_model_id or "",
            api_key=api_key or "",
        )
        payload = {
            "metric_category": metric_category,
            "scope": scope,
            "namespace": namespace or "",
            "start_ts": start_ts_resolved,
            "end_ts": end_ts_resolved,
            "promql": result.get("promql", ""),
            "summary": result.get("summary", ""),
        }
        return make_mcp_text_response(json.dumps(payload))
    except PrometheusError as e:
        return e.to_mcp_response()
    except requests.exceptions.HTTPError as e:
        cls = _classify_requests_error(e)
        if cls == "llm":
            error_msg = _extract_llm_error_message(e)
            return LLMServiceError(message=error_msg).to_mcp_response()
        prom_err = parse_prometheus_error(getattr(e, 'response', None))
        return prom_err.to_mcp_response()
    except requests.exceptions.ConnectionError as e:
        cls = _classify_requests_error(e)
        if cls == "llm":
            return LLMServiceError(message="Cannot reach LLM service.").to_mcp_response()
        return PrometheusError(message="Cannot connect to Prometheus/Thanos service.").to_mcp_response()
    except requests.exceptions.Timeout as e:
        cls = _classify_requests_error(e)
        if cls == "llm":
            return LLMServiceError(message="LLM service request timed out.").to_mcp_response()
        return PrometheusError(message="Prometheus/Thanos request timed out.").to_mcp_response()
    except requests.exceptions.RequestException as e:
        cls = _classify_requests_error(e)
        if cls == "llm":
            return LLMServiceError(message="LLM service request failed.").to_mcp_response()
        return PrometheusError(message="Prometheus/Thanos request failed.").to_mcp_response()
    except LLMServiceError as e:
        return e.to_mcp_response()
    except Exception as e:
        err = MCPException(
            message=f"Error in chat_openshift: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
            recovery_suggestion="Please try again. If the problem persists, contact support.",
        )
        return err.to_mcp_response()


