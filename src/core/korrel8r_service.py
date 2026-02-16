from __future__ import annotations

import asyncio
from threading import Thread
from typing import Any, Dict, List, Set

from common.pylogger import get_python_logger
from .korrel8r_client import Korrel8rClient
from .tempo_service import TempoQueryService


logger = get_python_logger()


def _extract_timestamp_from_trace_obj(obj: Dict[str, Any]) -> int | None:
    """
    Extract timestamp (microseconds since epoch) from Korrel8r trace object.

    Tries multiple field locations and formats:
    - context.startTimeUnixNano (OTLP format)
    - attributes.startTimeUnixNano
    - attributes.startTime, timestamp, time

    Returns None if no valid timestamp found.
    """
    try:
        # Try context.startTimeUnixNano first (OTLP standard)
        context = obj.get("context")
        if isinstance(context, dict):
            nano_ts = context.get("startTimeUnixNano")
            if nano_ts is not None:
                try:
                    # Convert nanoseconds to microseconds
                    return int(nano_ts) // 1000
                except (ValueError, TypeError):
                    pass

        # Try attributes
        attrs = obj.get("attributes")
        if isinstance(attrs, dict):
            # Try startTimeUnixNano
            nano_ts = attrs.get("startTimeUnixNano")
            if nano_ts is not None:
                try:
                    return int(nano_ts) // 1000
                except (ValueError, TypeError):
                    pass

            # Try alternative field names
            for field in ["startTime", "timestamp", "time"]:
                ts_val = attrs.get(field)
                if ts_val is not None:
                    try:
                        ts_int = int(ts_val)
                        # Normalize to microseconds based on magnitude
                        # Typical Unix epoch in nanoseconds: ~1.6e18 (year 2021)
                        # Typical Unix epoch in microseconds: ~1.6e15 (year 2021)
                        # Typical Unix epoch in milliseconds: ~1.6e12 (year 2021)
                        if ts_int > 1_000_000_000_000_000_000:  # Nanoseconds (>1e18)
                            return ts_int // 1000
                        elif ts_int > 1_000_000_000_000_000:  # Microseconds (>1e15)
                            return ts_int
                        else:  # Milliseconds or smaller (<=1e15)
                            return ts_int * 1000
                    except (ValueError, TypeError):
                        pass

    except Exception as e:
        logger.debug("Failed to extract timestamp from trace object: %s", e)

    return None


def _extract_unique_trace_ids(obj_result: Any, max_traces: int | None = None) -> List[str]:
    """
    Extract unique trace IDs from Korrel8r trace objects.

    Args:
        obj_result: Raw Korrel8r query_objects response
        max_traces: Maximum trace IDs to return (None = all).
                   Returns most recent N if timestamps available.

    Returns:
        List of unique trace IDs, sorted by timestamp desc if available.
    """
    items: List[Dict[str, Any]] = []
    logger.info("ZZZZ _extract_unique_trace_ids with obj_result=%s", obj_result)
    if isinstance(obj_result, list):
        items = [x for x in obj_result if isinstance(x, dict)]
    elif isinstance(obj_result, dict):
        data = obj_result.get("data")
        if isinstance(data, list):
            items = [x for x in data if isinstance(x, dict)]
        else:
            items = [obj_result]

    # Extract trace IDs with timestamps
    trace_data: List[tuple[str, int | None]] = []
    seen: Set[str] = set()

    for it in items:
        trace_id = None
        context = it.get("context") if isinstance(it, dict) else None
        if isinstance(context, dict):
            trace_id = context.get("traceID") or context.get("traceId")
        if not trace_id and isinstance(it, dict):
            trace_id = (
                it.get("traceID")
                or it.get("traceId")
                or it.get("id")
            )
        if isinstance(trace_id, str) and trace_id and trace_id not in seen:
            seen.add(trace_id)
            timestamp = _extract_timestamp_from_trace_obj(it)
            trace_data.append((trace_id, timestamp))

    # Sort by timestamp descending (most recent first)
    # Items with timestamps come first, sorted by timestamp desc
    # Items without timestamps come last, maintaining original order
    trace_data_with_ts = [(tid, ts) for tid, ts in trace_data if ts is not None]
    trace_data_without_ts = [(tid, ts) for tid, ts in trace_data if ts is None]

    trace_data_with_ts.sort(key=lambda x: x[1], reverse=True)
    sorted_trace_data = trace_data_with_ts + trace_data_without_ts

    # Apply limit if specified
    if max_traces is not None and max_traces >= 0:
        total_count = len(sorted_trace_data)
        sorted_trace_data = sorted_trace_data[:max_traces] if max_traces > 0 else []
        limited_count = len(sorted_trace_data)

        if total_count > 0:
            logger.info(
                "Extracted %d trace IDs from Korrel8r, limited to %d most recent (%.1f%% reduction)",
                total_count,
                limited_count,
                100 * (1 - limited_count / total_count) if limited_count < total_count else 0
            )
            logger.debug(
                "Timestamp availability: %d/%d traces have timestamps",
                len(trace_data_with_ts),
                total_count
            )

    # Return list of trace IDs
    return [tid for tid, _ in sorted_trace_data]


async def _fetch_trace_details_for_ids_async_all(trace_ids: List[str], concurrency: int = 10) -> List[Dict[str, Any]]:
    """Fetch ALL trace details concurrently, without filtering by error."""
    if not trace_ids:
        return []
    service = TempoQueryService()
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def fetch_one(tid: str) -> Dict[str, Any] | None:
        async with semaphore:
            try:
                resp = await service.get_trace_details(tid)
                if isinstance(resp, dict) and resp.get("success"):
                    return resp
            except Exception:
                return None
        return None

    tasks = [fetch_one(t) for t in trace_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    collected: List[Dict[str, Any]] = []
    for r in results:
        if isinstance(r, dict):
            collected.append(r)
    return collected


def _get_trace_details_sync(trace_ids: List[str]) -> List[Dict[str, Any]]:
    """Synchronous wrapper to fetch ALL trace details with async Tempo service, handling running loops."""
    if not trace_ids:
        return []
    try:
        return asyncio.run(_fetch_trace_details_for_ids_async_all(trace_ids))
    except RuntimeError:
        result: List[Dict[str, Any]] = []
        def runner() -> None:
            nonlocal result
            result = asyncio.run(_fetch_trace_details_for_ids_async_all(trace_ids))
        t = Thread(target=runner, daemon=True)
        t.start()
        t.join()
        return result


def _simplify_trace_detail_to_spans(detail: Dict[str, Any], related_objects: Any = None) -> List[Dict[str, Any]]:
    """
    Simplify a Tempo/Jaeger trace detail response to a list of spans (no error filtering).
    Keeps tags as a flattened dict where possible and enriches with namespace/pod if available.
    """
    logger.debug("_simplify_trace_detail_to_spans with detail=%s, related_objects=%s", detail, related_objects)
    simplified_spans: List[Dict[str, Any]] = []
    try:
        # Build an index from spanID -> (namespace, pod) using related objects returned by query_objects
        span_ctx_index: Dict[str, Dict[str, str]] = {}
        try:
            items: List[Dict[str, Any]] = []
            if isinstance(related_objects, list):
                items = [x for x in related_objects if isinstance(x, dict)]
            elif isinstance(related_objects, dict):
                data = related_objects.get("data")
                if isinstance(data, list):
                    items = [x for x in data if isinstance(x, dict)]
            for it in items:
                ctx = it.get("context") if isinstance(it, dict) else None
                if not isinstance(ctx, dict):
                    ctx = {}
                span_id = (
                    ctx.get("spanID")
                    or ctx.get("spanId")
                    or it.get("spanID")
                    or it.get("spanId")
                )
                if not isinstance(span_id, str) or not span_id:
                    continue
                attrs = it.get("attributes") if isinstance(it, dict) else None
                if not isinstance(attrs, dict):
                    attrs = {}
                ns = (
                    attrs.get("k8s.namespace.name")
                    or attrs.get("kubernetes.namespace_name")
                    or attrs.get("namespace")
                    or ""
                )
                pod = (
                    attrs.get("k8s.pod.name")
                    or attrs.get("kubernetes.pod_name")
                    or attrs.get("pod")
                    or attrs.get("service.name")  # heuristic fallback
                    or ""
                )
                span_ctx_index[str(span_id)] = {"namespace": str(ns), "pod": str(pod)}
        except Exception:
            span_ctx_index = {}

        if not isinstance(detail, dict) or not detail.get("success"):
            return simplified_spans
        trace_payload = detail.get("trace") or {}
        if not isinstance(trace_payload, dict):
            return simplified_spans
        data = trace_payload.get("data") or []
        if not isinstance(data, list):
            return simplified_spans
        for tr in data:
            if not isinstance(tr, dict):
                continue
            trace_id = tr.get("traceID") or tr.get("traceId")
            spans = tr.get("spans") or []
            if not isinstance(spans, list):
                continue
            for sp in spans:
                if not isinstance(sp, dict):
                    continue
                tags_list = sp.get("tags") or []
                tags_dict: Dict[str, Any] = {}
                if isinstance(tags_list, list):
                    for tg in tags_list:
                        try:
                            key = tg.get("key")
                            val = tg.get("value")
                            if key is not None:
                                tags_dict[str(key)] = val
                        except Exception:
                            continue
                one_span: Dict[str, Any] = {
                    "traceID": trace_id,
                    "spanID": sp.get("spanID") or sp.get("spanId"),
                    "operationName": sp.get("operationName") or sp.get("operation"),
                    "startTime": sp.get("startTime"),
                    "duration": sp.get("duration"),
                    "tags": tags_dict if tags_dict else tags_list,
                }
                # Enrich with namespace/pod if available
                try:
                    sid = str(one_span.get("spanID") or "")
                    ctx_vals = span_ctx_index.get(sid)
                    if isinstance(ctx_vals, dict):
                        ns_val = ctx_vals.get("namespace") or ""
                        pod_val = ctx_vals.get("pod") or ""
                        if ns_val:
                            one_span["namespace"] = ns_val
                        if pod_val:
                            one_span["pod"] = pod_val
                except Exception:
                    pass
                simplified_spans.append(one_span)
    except Exception:
        return simplified_spans
    logger.debug("_simplify_trace_detail_to_spans returns simplified_spans=%s", simplified_spans)
    return simplified_spans

 
def fetch_goal_query_objects(
    goals: List[str],
    query: str,
    max_traces_per_query: int | None = None
) -> Dict[str, List[Any]]:
    """Resolve Korrel8r goals from a start query and aggregate related objects by signal type.

    Builds a Start model from the provided query, requests goal-specific queries
    from Korrel8r, executes each query via query_objects, and aggregates results.
    Returns a dict with 'logs' and 'traces' keys to separate signal types.

    Args:
        goals: Korrel8r goal class names (e.g., ["trace:span"])
        query: Korrel8r start query string
        max_traces_per_query: Max trace IDs to fetch details for.
                             None = fetch all. Recommended: 2-3x MAX_NUM_TRACE_SPANS.
    """
    start_payload: Dict[str, Any] = {"queries": [query]}

    client = Korrel8rClient()
    goals_result = client.list_goals(goals=goals, start=start_payload)
    logger.debug("fetch_goal_query_objects with goals=%s, query=%s, goals_result=%s", goals, query, goals_result)
    aggregated: Dict[str, List[Any]] = {"logs": [], "traces": []}
    seen_trace_ids: Set[str] = set()
    if isinstance(goals_result, list):
        for idx, item in enumerate(goals_result):
            logger.debug("fetch_goal_query_objects item=%s", item)
            try:
                # Try to infer goal name for this item to route results
                goal_name = None
                if isinstance(item, dict):
                    goal_name = (
                        item.get("goal")
                        or item.get("class")
                        or item.get("name")
                    )
                # Fallback: align with the requested goals order if lengths match
                if not goal_name and 0 <= idx < len(goals):
                    goal_name = goals[idx]
                domain = ""
                if isinstance(goal_name, str) and ":" in goal_name:
                    domain = goal_name.split(":", 1)[0].strip().lower()
                bucket = "traces" if domain == "trace" else "logs" if domain == "log" else "logs"

                queries = item.get("queries", []) if isinstance(item, dict) else []
                for q in queries:
                    try:
                        qstr = q.get("query") if isinstance(q, dict) else None
                        if not qstr:
                            continue
                        obj_result = client.query_objects(qstr)
                        # For logs, attempt to simplify log objects
                        if bucket == "logs":
                            simplified = client.simplify_log_objects(obj_result)
                            if isinstance(simplified, list):
                                aggregated[bucket].extend(simplified)
                                continue
                        # For traces: extract unique IDs, fetch Tempo details, simplify to spans (no filtering)
                        if bucket == "traces":
                            trace_ids = _extract_unique_trace_ids(obj_result, max_traces=max_traces_per_query)
                            logger.debug("fetch_goal_query_objects trace_ids=%s", trace_ids)
                            # Remove ones we've already processed
                            ids_to_fetch = [tid for tid in trace_ids if tid not in seen_trace_ids]
                            seen_trace_ids.update(ids_to_fetch)
                            logger.debug("fetch_goal_query_objects ids_to_fetch=%s", ids_to_fetch)
                            if ids_to_fetch:
                                all_traces = _get_trace_details_sync(ids_to_fetch)
                                logger.debug("fetch_goal_query_objects all_traces=%s", all_traces)
                                if isinstance(all_traces, list):
                                    simplified_spans_all: List[Dict[str, Any]] = []
                                    for dt in all_traces:
                                        simplified_spans_all.extend(_simplify_trace_detail_to_spans(dt, obj_result))
                                    aggregated[bucket].extend(simplified_spans_all)
                                continue
                        # Fallback/default aggregation
                        if isinstance(obj_result, list):
                            aggregated[bucket].extend(obj_result)
                        elif isinstance(obj_result, dict):
                            if "data" in obj_result and isinstance(obj_result["data"], list):
                                aggregated[bucket].extend(obj_result["data"])
                            else:
                                aggregated[bucket].append(obj_result)
                    except Exception as inner_e:
                        logger.warning("korrel8r_get_correlated query failed: %s", inner_e)
                        continue
            except Exception:
                continue
    logger.debug("fetch_goal_query_objects returns aggregated=%s", aggregated)
    return aggregated


