from __future__ import annotations

from typing import Any, Dict, List

from common.pylogger import get_python_logger
from .korrel8r_client import Korrel8rClient


logger = get_python_logger()


def fetch_goal_query_objects(goals: List[str], query: str) -> List[Any]:
    """Resolve Korrel8r goals from a start query and aggregate related objects.

    Builds a Start model from the provided query, requests goal-specific queries
    from Korrel8r, executes each query via query_objects, and aggregates results.
    Returns a flat list of simplified objects (if client simplifies logs).
    """
    start_payload: Dict[str, Any] = {"queries": [query]}

    client = Korrel8rClient()
    goals_result = client.list_goals(goals=goals, start=start_payload)

    aggregated: List[Any] = []
    if isinstance(goals_result, list):
        for item in goals_result:
            try:
                queries = item.get("queries", []) if isinstance(item, dict) else []
                for q in queries:
                    try:
                        qstr = q.get("query") if isinstance(q, dict) else None
                        if not qstr:
                            continue
                        obj_result = client.query_objects(qstr)
                        if isinstance(obj_result, list):
                            aggregated.extend(obj_result)
                        elif isinstance(obj_result, dict) and "data" in obj_result:
                            aggregated.extend(obj_result["data"])
                    except Exception as inner_e:
                        logger.warning("korrel8r_get_correlated query failed: %s", inner_e)
                        continue
            except Exception:
                continue

    return aggregated


