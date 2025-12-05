from typing import Any, Dict, List, Optional
import json
import logging

from common.pylogger import get_python_logger
from core.korrel8r_client import Korrel8rClient
from core.korrel8r_service import fetch_goal_query_objects
from core.config import (
    KORREL8R_ENABLED,
)
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


