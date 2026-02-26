from typing import Any, Dict, List, Optional
import json

from common.pylogger import get_python_logger
from core.korrel8r_client import Korrel8rClient
from core.korrel8r_service import fetch_goal_query_objects
from core.chat_with_prometheus import execute_promql_query
from core.response_utils import make_mcp_text_response
from mcp_server.exceptions import MCPException, MCPErrorCode

logger = get_python_logger()
# korrel8r_build_links tool removed per request


def korrel8r_query_objects(query: str) -> List[Dict[str, Any]]:
    """Execute a Korrel8r domain query and return objects.

    Example query strings (see docs [korrel8r#_query_8](https://korrel8r.github.io/korrel8r/#_query_8)):
      - alert:alert:{"alertname":"PodDisruptionBudgetAtLimit"}
      - k8s:Pod:{"namespace", "llm-serving", "name":"vllm-inference-*"}
      - loki:log:{"kubernetes.namespace_name":"llm-serving","kubernetes.pod_name":"p-abc"}
      - trace:span:{".k8s.namespace.name":"llm-serving"}
    """
    try:
        client = Korrel8rClient()
        result = client.query_objects(query)
        # Preserve previous behavior: simplify logs when applicable
        simplified = client.simplify_log_objects(result)
        to_return = simplified if simplified is not None else result
        logger.debug("korrel8r_query_objects result (possibly simplified): %s", to_return)
        return make_mcp_text_response(json.dumps(to_return))
    except Exception as e:
        logger.error("korrel8r_query_objects failed: %s", e)
        err = MCPException(
            message=f"Korrel8r query failed: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
            recovery_suggestion="Check query syntax and Korrel8r service availability.",
        )
        return err.to_mcp_response()


def korrel8r_get_correlated(goals: List[str], query: str) -> List[Dict[str, Any]]:
    """Return correlated objects for a query by leveraging listGoals + query_objects.

    Args:
        goals: Korrel8r goal classes to correlate. Use ['trace:span','log:application','log:infrastructure'] unless users ask for specific domain.
        query: A single Korrel8r domain query string (same format as query_objects),
               e.g., "alert:alert:{\"alertname\":\"PodDisruptionBudgetAtLimit\"}"
    """
    try:
        if not isinstance(goals, list) or not all(isinstance(g, str) for g in goals):
            err = MCPException(
                message="goals must be a list of strings",
                error_code=MCPErrorCode.INVALID_INPUT,
                recovery_suggestion=(
                    "Provide goals like ['trace:span', 'log:application', "
                    "'log:infrastructure', 'metric:metric']."
                ),
            )
            return err.to_mcp_response()

        if not isinstance(query, str) or not query.strip():
            err = MCPException(
                message="query must be a non-empty string",
                error_code=MCPErrorCode.INVALID_INPUT,
                recovery_suggestion="Provide a Korrel8r domain query string.",
            )
            return err.to_mcp_response()

        aggregated = fetch_goal_query_objects(goals, query)
        # aggregated is now a dict with 'logs' and 'traces' keys
        return make_mcp_text_response(json.dumps(aggregated))
    except Exception as e:
        logger.error("korrel8r_list_goals failed: goals=%s, query=%s, error=%s", goals, query, e)
        err = MCPException(
            message=f"Korrel8r list goals failed: {str(e)}",
            error_code=MCPErrorCode.RESOURCE_UNAVAILABLE,
            recovery_suggestion="Verify Korrel8r URL, token and service health.",
        )
        return err.to_mcp_response()


_LOG_GOALS = ["log:application", "log:infrastructure"]


def _fetch_logs_via_correlation(namespace: str, pod_name: Optional[str]) -> list:
    """Phase 1: Use Korrel8r correlation from k8s resource to log goals.

    Works reliably for pods with errors/alerts (cross-signal correlation paths).
    May return nothing for healthy pods with only INFO logs.
    """
    if pod_name:
        selector = json.dumps({"namespace": namespace, "name": pod_name})
        query = f"k8s:Pod:{selector}"
    else:
        selector = json.dumps({"name": namespace})
        query = f"k8s:Namespace:{selector}"

    logger.info("_fetch_logs_via_correlation query=%s", query)
    try:
        aggregated = fetch_goal_query_objects(_LOG_GOALS, query)
        return aggregated.get("logs", [])
    except Exception as e:
        logger.warning("_fetch_logs_via_correlation failed: %s", e)
        return []


def _fetch_logs_via_direct_query(namespace: str, pod_name: Optional[str]) -> list:
    """Phase 2: Direct log query via Korrel8r's query_objects API.

    Queries both log:application and log:infrastructure domains with simple
    field names (namespace, name) matching the format Korrel8r generates
    internally during correlation. Works for all pods regardless of error state.
    """
    selector = {"namespace": namespace}
    if pod_name:
        selector["name"] = pod_name
    selector_json = json.dumps(selector)

    all_logs: list = []
    try:
        client = Korrel8rClient()
        for domain in _LOG_GOALS:
            query = f"{domain}:{selector_json}"
            logger.info("_fetch_logs_via_direct_query query=%s", query)
            try:
                result = client.query_objects(query)
                simplified = client.simplify_log_objects(result)
                if isinstance(simplified, list):
                    all_logs.extend(simplified)
                elif isinstance(result, list):
                    all_logs.extend(result)
            except Exception as e:
                logger.warning("_fetch_logs_via_direct_query domain=%s failed: %s", domain, e)
    except Exception as e:
        logger.warning("_fetch_logs_via_direct_query failed: %s", e)
    return all_logs


def _check_unhealthy_pods(namespace: str) -> str:
    """Check for unhealthy pods in the namespace via Prometheus.

    Queries two metrics to catch all common failure modes:
    - kube_pod_container_status_waiting_reason: pods stuck waiting
      (ImagePullBackOff, CrashLoopBackOff, ErrImagePull, CreateContainerConfigError)
    - kube_pod_container_status_terminated_reason: pods terminated with errors
      (Error, OOMKilled)

    Returns a warning string if unhealthy pods found, empty string otherwise.
    """
    queries = [
        (
            'kube_pod_container_status_waiting_reason{'
            f'namespace="{namespace}",'
            'reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError"'
            '} == 1'
        ),
        (
            'kube_pod_container_status_terminated_reason{'
            f'namespace="{namespace}",'
            'reason=~"Error|OOMKilled"'
            '} == 1'
        ),
    ]

    pods = []
    seen = set()
    for query in queries:
        try:
            result = execute_promql_query(query)
            if not isinstance(result, dict) or result.get("status") != "success":
                continue
            # execute_promql_query returns {"results": [...]} (not "data.result")
            for item in result.get("results", []):
                metric = item.get("metric", {}) if isinstance(item, dict) else {}
                pod_name = metric.get("pod", "unknown")
                reason = metric.get("reason", "unknown")
                if pod_name not in seen:
                    seen.add(pod_name)
                    pods.append(f"{pod_name} ({reason})")
        except Exception as e:
            logger.debug("_check_unhealthy_pods query failed (non-fatal): %s", e)

    if not pods:
        return ""

    warning = (
        f"WARNING: {len(pods)} unhealthy pod(s) in namespace '{namespace}': "
        f"{', '.join(pods)}. "
        "These pods may have no logs or only partial logs."
    )
    logger.info("_check_unhealthy_pods: %s", warning)
    return warning


def _resolve_pod_names(namespace: str, pod_pattern: str) -> List[str]:
    """Resolve a pod name pattern to exact pod names via Prometheus.

    Korrel8r log domain queries don't support glob patterns — only exact pod
    names.  When the LLM passes a pattern like ``alert-example*``, this
    function queries ``kube_pod_info`` to find matching pod names.

    Returns a list of exact pod names, or empty list on failure.
    """
    # Strip trailing glob
    prefix = pod_pattern.rstrip("*")
    query = f'kube_pod_info{{namespace="{namespace}",pod=~"{prefix}.*"}}'
    try:
        result = execute_promql_query(query)
        if not isinstance(result, dict) or result.get("status") != "success":
            return []
        pods = []
        seen = set()
        for item in result.get("results", []):
            metric = item.get("metric", {}) if isinstance(item, dict) else {}
            pod_name = metric.get("pod")
            if pod_name and pod_name not in seen:
                seen.add(pod_name)
                pods.append(pod_name)
        if pods:
            logger.info("_resolve_pod_names: resolved '%s' to %s", pod_pattern, pods)
        return pods
    except Exception as e:
        logger.debug("_resolve_pod_names failed (non-fatal): %s", e)
        return []


def get_correlated_logs(
    namespace: str,
    pod: Optional[str] = None,
    time_range: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Fetch application and infrastructure logs for a namespace or pod via Korrel8r.

    Builds a Korrel8r log query from the provided namespace/pod and retrieves
    matching log entries. Returns simplified log entries with namespace, pod,
    level, message, and timestamp fields.

    Args:
        namespace: Kubernetes namespace to query logs for (required).
        pod: Optional pod name or glob pattern to filter logs (e.g., "vllm-predictor-*").
        time_range: Optional human-readable time range (e.g., "1h", "30m", "24h").
            Currently informational — Korrel8r returns recent logs by default.
    """
    if not namespace or not isinstance(namespace, str) or not namespace.strip():
        err = MCPException(
            message="namespace is required and must be a non-empty string",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Provide a Kubernetes namespace, e.g., 'llm-serving'.",
        )
        return err.to_mcp_response()

    namespace = namespace.strip()
    pod_name = pod.strip() if pod and isinstance(pod, str) and pod.strip() else None

    # Strategy: two-phase log retrieval.
    #
    # Phase 1 — Correlation (k8s resource → logs):
    #   Uses Korrel8r's list_goals API to find logs correlated to a k8s Pod
    #   or Namespace. This works reliably for pods with errors/alerts because
    #   Korrel8r has cross-signal correlation paths for those.
    #
    # Phase 2 — Direct query (log:application + log:infrastructure):
    #   If correlation returns nothing (e.g., healthy pods with only INFO logs),
    #   fall back to a direct log query via Korrel8r's query_objects API.
    #   Uses log:application and log:infrastructure domains with simple field
    #   names (namespace, name) matching the format Korrel8r generates internally.

    logger.info("get_correlated_logs namespace=%s, pod=%s, time_range=%s", namespace, pod_name, time_range)

    try:
        # Phase 1: Correlation from k8s resource
        all_logs = _fetch_logs_via_correlation(namespace, pod_name)

        # Phase 2: Direct query fallback if correlation returned nothing
        if not all_logs:
            logger.info("get_correlated_logs: correlation returned no logs, trying direct query")
            all_logs = _fetch_logs_via_direct_query(namespace, pod_name)

        # Phase 3: If pod name returned no logs, resolve exact pod names via
        # Prometheus and retry.  Korrel8r log queries require exact pod names
        # — neither glob patterns (alert-example*) nor partial names
        # (alert-example) work.  LLMs almost never pass full k8s pod names
        # with the deployment/replicaset hash suffixes.
        if not all_logs and pod_name:
            resolved_pods = _resolve_pod_names(namespace, pod_name if "*" in pod_name else pod_name + "*")
            for exact_pod in resolved_pods:
                logger.info("get_correlated_logs: retrying with resolved pod name: %s", exact_pod)
                logs = _fetch_logs_via_correlation(namespace, exact_pod)
                if not logs:
                    logs = _fetch_logs_via_direct_query(namespace, exact_pod)
                all_logs.extend(logs)

        logger.info("get_correlated_logs returned %d log entries for namespace=%s", len(all_logs), namespace)

        # Check for unhealthy pods (may have no logs or partial logs)
        pod_warning = _check_unhealthy_pods(namespace)
        if pod_warning:
            response_text = pod_warning + "\n\n" + json.dumps(all_logs)
        else:
            response_text = json.dumps(all_logs)
        return make_mcp_text_response(response_text)
    except Exception as e:
        logger.error("get_correlated_logs failed: namespace=%s, pod=%s, error=%s", namespace, pod_name, e)
        err = MCPException(
            message=f"Failed to fetch logs: {str(e)}",
            error_code=MCPErrorCode.RESOURCE_UNAVAILABLE,
            recovery_suggestion="Verify Korrel8r URL, token and service health. "
                                "Ensure the namespace exists and has running pods.",
        )
        return err.to_mcp_response()
