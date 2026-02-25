from __future__ import annotations

import asyncio
import time
import warnings
from threading import Thread
from typing import Any, Dict, List, Optional, Set

from common.pylogger import get_python_logger
from .korrel8r_client import Korrel8rClient
from .tempo_service import TempoQueryService

logger = get_python_logger()


def _extract_timestamp_from_trace_obj(obj: Dict[str, Any]) -> Optional[int]:
    """
    Extract timestamp (microseconds since epoch) from Korrel8r trace object.

    Uses field name hints and validates results are within reasonable bounds (1970-2100).
    Returns None if no valid timestamp found or out of bounds.
    """
    # Reasonable timestamp bounds (Unix epoch 1970 to year 2100 in microseconds)
    MIN_VALID_TIMESTAMP_US = 0  # Unix epoch (Jan 1, 1970) or later
    MAX_VALID_TIMESTAMP_US = 4_102_444_800_000_000  # Jan 1, 2100

    def normalize_timestamp(value: int, field_name: str = "") -> Optional[int]:
        """Normalize timestamp to microseconds using field name hints and validation."""
        # Use field name hints for unit detection (only for very explicit names)
        field_lower = field_name.lower()

        # Explicit nanosecond fields (highest priority)
        if "nano" in field_lower:
            result = value // 1000
        # Explicit millisecond fields
        elif "milli" in field_lower or "ms" in field_lower:
            result = value * 1000
        # Explicit second fields (only very specific names, not generic "time")
        elif "second" in field_lower and field_lower != "time":
            result = value * 1_000_000
        # Generic fields or ambiguous names - use magnitude with tighter bounds
        else:
            # Use tighter bounds to avoid misclassification
            if value > 1_000_000_000_000_000_000:  # > 1e18: nanoseconds
                result = value // 1000
            elif value > 100_000_000_000_000:  # > 1e14: microseconds (tighter than 1e15)
                result = value
            elif value > 100_000_000_000:  # > 1e11: milliseconds (tighter than 1e12)
                result = value * 1000
            elif value > 100_000_000:  # > 1e8: seconds (tighter than 1e9)
                result = value * 1_000_000
            else:
                # Too small - likely invalid or wrong unit
                return None

        # Validate result is within reasonable bounds (1970-2100)
        if MIN_VALID_TIMESTAMP_US <= result <= MAX_VALID_TIMESTAMP_US:
            return result
        else:
            logger.debug(
                "Timestamp out of bounds (Unix epoch to year 2100): %d µs (field=%s, value=%d)",
                result, field_name, value
            )
            return None

    try:
        # Try context.startTimeUnixNano first (OTLP standard)
        context = obj.get("context")
        if isinstance(context, dict):
            nano_ts = context.get("startTimeUnixNano")
            if nano_ts is not None:
                try:
                    result = normalize_timestamp(int(nano_ts), "startTimeUnixNano")
                    if result:
                        return result
                except (ValueError, TypeError):
                    pass

        # Try attributes
        attrs = obj.get("attributes")
        if isinstance(attrs, dict):
            # Try startTimeUnixNano
            nano_ts = attrs.get("startTimeUnixNano")
            if nano_ts is not None:
                try:
                    result = normalize_timestamp(int(nano_ts), "startTimeUnixNano")
                    if result:
                        return result
                except (ValueError, TypeError):
                    pass

            # Try alternative field names
            for field in ["startTime", "timestamp", "time"]:
                ts_val = attrs.get(field)
                if ts_val is not None:
                    try:
                        result = normalize_timestamp(int(ts_val), field)
                        if result:
                            return result
                    except (ValueError, TypeError):
                        pass

    except Exception as e:
        logger.debug("Failed to extract timestamp from trace object: %s", e)

    return None


def _extract_unique_trace_ids(obj_result: Any, max_traces: Optional[int] = None) -> List[str]:
    """
    Extract unique trace IDs from Korrel8r trace objects.

    Args:
        obj_result: Raw Korrel8r query_objects response
        max_traces: Maximum trace IDs to return (None = all).
                   Returns most recent N if timestamps available.

    Returns:
        List of unique trace IDs, sorted by timestamp desc if available.
    """
    start_time = time.perf_counter()
    items: List[Dict[str, Any]] = []
    if isinstance(obj_result, list):
        items = [x for x in obj_result if isinstance(x, dict)]
    elif isinstance(obj_result, dict):
        data = obj_result.get("data")
        if isinstance(data, list):
            items = [x for x in data if isinstance(x, dict)]
        else:
            items = [obj_result]

    # Extract trace IDs with timestamps
    # For duplicate trace IDs, keep the one with the most recent timestamp
    extraction_start = time.perf_counter()
    trace_map: Dict[str, Optional[int]] = {}  # trace_id -> timestamp

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
        if isinstance(trace_id, str) and trace_id:
            timestamp = _extract_timestamp_from_trace_obj(it)
            # Keep the most recent timestamp for duplicate trace IDs
            if trace_id not in trace_map:
                trace_map[trace_id] = timestamp
            else:
                existing_ts = trace_map[trace_id]
                # Keep the higher (more recent) timestamp
                if timestamp is not None and (existing_ts is None or timestamp > existing_ts):
                    trace_map[trace_id] = timestamp

    # Convert to list of tuples
    trace_data = list(trace_map.items())

    extraction_time = time.perf_counter() - extraction_start

    # Sort by timestamp descending (most recent first)
    # Items with timestamps come first, sorted by timestamp desc
    # Items without timestamps come last, maintaining original order
    sorting_start = time.perf_counter()
    trace_data_with_ts = [(tid, ts) for tid, ts in trace_data if ts is not None]
    trace_data_without_ts = [(tid, ts) for tid, ts in trace_data if ts is None]

    trace_data_with_ts.sort(key=lambda x: x[1], reverse=True)
    sorted_trace_data = trace_data_with_ts + trace_data_without_ts
    sorting_time = time.perf_counter() - sorting_start

    # Apply limit if specified
    if max_traces is not None and max_traces >= 0:
        total_count = len(sorted_trace_data)
        sorted_trace_data = sorted_trace_data[:max_traces] if max_traces > 0 else []
        limited_count = len(sorted_trace_data)

        if total_count > 0:
            logger.debug(
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
    total_time = time.perf_counter() - start_time
    logger.debug(
        "_extract_unique_trace_ids timing: total=%.3fs (extraction=%.3fs, sorting=%.3fs)",
        total_time, extraction_time, sorting_time
    )
    return [tid for tid, _ in sorted_trace_data]


async def _fetch_trace_details_for_ids_async_all(trace_ids: List[str], concurrency: int = 10) -> List[Dict[str, Any]]:
    """Fetch ALL trace details concurrently, without filtering by error."""
    if not trace_ids:
        return []
    service = TempoQueryService()
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def fetch_one(tid: str) -> Optional[Dict[str, Any]]:
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
    start_time = time.perf_counter()
    trace_count = len(trace_ids)
    try:
        result = asyncio.run(_fetch_trace_details_for_ids_async_all(trace_ids))
        elapsed = time.perf_counter() - start_time
        logger.debug(
            "_get_trace_details_sync: Fetched %d traces from Tempo in %.3fs (avg %.3fs per trace)",
            trace_count, elapsed, elapsed / trace_count if trace_count > 0 else 0
        )
        return result
    except RuntimeError as e:
        # RuntimeError: asyncio.run() cannot be called from a running event loop
        # Fall back to running in a separate thread
        logger.debug("Event loop already running, using thread for async execution: %s", e)
        result: List[Dict[str, Any]] = []
        exception_holder = [None]  # Use list to store exception from thread

        def runner() -> None:
            nonlocal result
            try:
                result = asyncio.run(_fetch_trace_details_for_ids_async_all(trace_ids))
            except Exception as ex:
                exception_holder[0] = ex

        # Suppress false positive RuntimeWarning for coroutines in thread context
        # This warning can occur when using asyncio.run() in threads due to GC timing
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=RuntimeWarning, message=".*coroutine.*was never awaited.*")
            t = Thread(target=runner, daemon=True)
            t.start()
            t.join()

        # Re-raise any exception from the thread
        if exception_holder[0]:
            logger.error("Error in thread execution: %s", exception_holder[0])
            raise exception_holder[0]

        elapsed = time.perf_counter() - start_time
        logger.debug(
            "_get_trace_details_sync: Fetched %d traces from Tempo in %.3fs (avg %.3fs per trace) [thread mode]",
            trace_count, elapsed, elapsed / trace_count if trace_count > 0 else 0
        )
        return result


def _simplify_trace_detail_to_spans(detail: Dict[str, Any], related_objects: Any = None) -> List[Dict[str, Any]]:
    """
    Simplify a Tempo/Jaeger trace detail response to a list of spans (no error filtering).
    Keeps tags as a flattened dict where possible and enriches with namespace/pod if available.
    """
    start_time = time.perf_counter()
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
        elapsed = time.perf_counter() - start_time
        logger.debug("_simplify_trace_detail_to_spans: Processed to %d spans in %.3fs", len(simplified_spans), elapsed)
        return simplified_spans
    elapsed = time.perf_counter() - start_time
    logger.debug("_simplify_trace_detail_to_spans: Processed to %d spans in %.3fs", len(simplified_spans), elapsed)
    logger.debug("_simplify_trace_detail_to_spans returns simplified_spans=%s", simplified_spans)
    return simplified_spans

 
def fetch_goal_query_objects(
    goals: List[str],
    query: str,
    max_traces_per_query: Optional[int] = None
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
    overall_start = time.perf_counter()
    start_payload: Dict[str, Any] = {"queries": [query]}

    # Timing accumulators
    time_korrel8r_list_goals = 0.0
    time_korrel8r_query_objects = 0.0
    time_extract_trace_ids = 0.0
    time_fetch_trace_details = 0.0
    time_simplify_spans = 0.0

    client = Korrel8rClient()
    t_start = time.perf_counter()
    goals_result = client.list_goals(goals=goals, start=start_payload)
    time_korrel8r_list_goals = time.perf_counter() - t_start
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
                        logger.debug("fetch_goal_query_objects executing goal query: %s (goal=%s, bucket=%s)", qstr, goal_name, bucket)
                        t_start = time.perf_counter()
                        obj_result = client.query_objects(qstr)
                        time_korrel8r_query_objects += time.perf_counter() - t_start
                        # For logs, attempt to simplify log objects
                        if bucket == "logs":
                            simplified = client.simplify_log_objects(obj_result)
                            if isinstance(simplified, list):
                                aggregated[bucket].extend(simplified)
                                continue
                        # For traces: extract unique IDs, fetch Tempo details, simplify to spans (no filtering)
                        if bucket == "traces":
                            t_start = time.perf_counter()
                            trace_ids = _extract_unique_trace_ids(obj_result, max_traces=max_traces_per_query)
                            time_extract_trace_ids += time.perf_counter() - t_start
                            logger.debug("fetch_goal_query_objects trace_ids=%s", trace_ids)
                            # Remove ones we've already processed
                            ids_to_fetch = [tid for tid in trace_ids if tid not in seen_trace_ids]
                            seen_trace_ids.update(ids_to_fetch)
                            logger.debug("fetch_goal_query_objects ids_to_fetch=%s", ids_to_fetch)
                            if ids_to_fetch:
                                t_start = time.perf_counter()
                                all_traces = _get_trace_details_sync(ids_to_fetch)
                                time_fetch_trace_details += time.perf_counter() - t_start
                                logger.debug("fetch_goal_query_objects all_traces=%s", all_traces)
                                if isinstance(all_traces, list):
                                    simplified_spans_all: List[Dict[str, Any]] = []
                                    for dt in all_traces:
                                        t_start = time.perf_counter()
                                        simplified_spans_all.extend(_simplify_trace_detail_to_spans(dt, obj_result))
                                        time_simplify_spans += time.perf_counter() - t_start
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

    # Log performance summary
    overall_time = time.perf_counter() - overall_start
    logger.debug(
        "fetch_goal_query_objects performance: total=%.3fs, breakdown: "
        "korrel8r_list_goals=%.3fs, korrel8r_query_objects=%.3fs, "
        "extract_trace_ids=%.3fs, fetch_trace_details=%.3fs, simplify_spans=%.3fs | "
        "results: %d logs, %d trace spans",
        overall_time,
        time_korrel8r_list_goals,
        time_korrel8r_query_objects,
        time_extract_trace_ids,
        time_fetch_trace_details,
        time_simplify_spans,
        len(aggregated.get("logs", [])),
        len(aggregated.get("traces", []))
    )
    logger.debug("fetch_goal_query_objects returns aggregated=%s", aggregated)
    return aggregated


