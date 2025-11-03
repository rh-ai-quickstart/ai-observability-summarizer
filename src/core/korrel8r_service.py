from __future__ import annotations

import asyncio
from threading import Thread
from typing import Any, Dict, List, Set

from common.pylogger import get_python_logger
from .korrel8r_client import Korrel8rClient
from .tempo_service import TempoQueryService


logger = get_python_logger()


def _extract_unique_trace_ids(obj_result: Any) -> List[str]:
    """Extract unique trace IDs from Korrel8r trace objects."""
    items: List[Dict[str, Any]] = []
    if isinstance(obj_result, list):
        items = [x for x in obj_result if isinstance(x, dict)]
    elif isinstance(obj_result, dict):
        data = obj_result.get("data")
        if isinstance(data, list):
            items = [x for x in data if isinstance(x, dict)]
        else:
            items = [obj_result]
    trace_ids: List[str] = []
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
            trace_ids.append(trace_id)
    return trace_ids


def _trace_detail_contains_error(detail: Dict[str, Any]) -> bool:
    """Heuristically detect error-like signals within a Tempo/Jaeger trace detail response."""
    try:
        if not isinstance(detail, dict) or not detail.get("success"):
            return False
        trace_payload = detail.get("trace") or {}
        if not isinstance(trace_payload, dict):
            return False
        # Top-level errors (if present in Jaeger-style response)
        if trace_payload.get("errors"):
            return True
        data = trace_payload.get("data") or []
        if not isinstance(data, list):
            return False
        keywords = ("error", "exception", "fatal", "panic", "fail")
        for tr in data:
            if not isinstance(tr, dict):
                continue
            spans = tr.get("spans") or []
            for sp in spans:
                if not isinstance(sp, dict):
                    continue
                # Tags (Jaeger format)
                tags = sp.get("tags") or []
                if isinstance(tags, list):
                    for tg in tags:
                        if not isinstance(tg, dict):
                            continue
                        key = str(tg.get("key", "")).lower()
                        val = str(tg.get("value", "")).lower()
                        if key in ("error", "otel.status_code", "status.code", "span.status.code"):
                            if val in ("true", "1", "error"):
                                return True
                        if any(k in key for k in keywords) and any(k in val for k in keywords + ("true", "1")):
                            return True
                # Logs/events (Jaeger format)
                logs = sp.get("logs") or []
                if isinstance(logs, list):
                    for lg in logs:
                        if not isinstance(lg, dict):
                            continue
                        fields = lg.get("fields") or []
                        if isinstance(fields, list):
                            for f in fields:
                                if not isinstance(f, dict):
                                    continue
                                fkey = str(f.get("key", "")).lower()
                                fval = str(f.get("value", "")).lower()
                                if fkey == "event" and fval in ("exception", "error", "fatal"):
                                    return True
                                if any(k in fkey for k in keywords) or any(k in fval for k in keywords):
                                    return True
        return False
    except Exception:
        return False


async def _fetch_trace_details_for_ids_async(trace_ids: List[str], concurrency: int = 10) -> List[Dict[str, Any]]:
    """Fetch trace details concurrently and return only those containing errors."""
    if not trace_ids:
        return []
    service = TempoQueryService()
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def fetch_one(tid: str) -> Dict[str, Any] | None:
        async with semaphore:
            try:
                resp = await service.get_trace_details(tid)
                if isinstance(resp, dict) and _trace_detail_contains_error(resp):
                    return resp
            except Exception:
                return None
        return None

    tasks = [fetch_one(t) for t in trace_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    filtered: List[Dict[str, Any]] = []
    for r in results:
        if isinstance(r, dict):
            filtered.append(r)
    return filtered


def _get_error_trace_details_sync(trace_ids: List[str]) -> List[Dict[str, Any]]:
    """Synchronous wrapper to fetch error traces with async Tempo service, handling running event loops."""
    if not trace_ids:
        return []
    try:
        # Fast path when no running loop in this thread
        return asyncio.run(_fetch_trace_details_for_ids_async(trace_ids))
    except RuntimeError:
        # If there's already a running loop in this thread, run in a separate thread
        result: List[Dict[str, Any]] = []
        def runner() -> None:
            nonlocal result
            result = asyncio.run(_fetch_trace_details_for_ids_async(trace_ids))
        t = Thread(target=runner, daemon=True)
        t.start()
        t.join()
        return result


def _simplify_trace_detail_to_error_spans(detail: Dict[str, Any], related_objects: Any = None) -> List[Dict[str, Any]]:
    """
    Simplify a Tempo/Jaeger trace detail response to a list of spans that contain error-like tags.
    
    Each simplified span includes: traceID, spanID, operationName, startTime, duration, tags (filtered).
    Only include tag entries whose values contain an error-like string. If a span has no such tags, skip it.
    """
    logger.debug("_simplify_trace_detail_to_error_spans with detail=%s, related_objects=%s", detail, related_objects)
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
        keywords = ("error", "exception", "fatal", "panic", "fail", "critical")
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
                if not isinstance(tags_list, list):
                    continue
                # Only include tags whose VALUE contains an error-like string
                filtered_tags: Dict[str, Any] = {}
                for tg in tags_list:
                    if not isinstance(tg, dict):
                        continue
                    key = tg.get("key")
                    val = tg.get("value")
                    val_str = str(val).lower()
                    if any(k in val_str for k in keywords):
                        filtered_tags[str(key)] = val
                # Skip spans without any error-like tags
                if not filtered_tags:
                    continue
                one_span: Dict[str, Any] = {
                    "traceID": trace_id,
                    "spanID": sp.get("spanID") or sp.get("spanId"),
                    "operationName": sp.get("operationName") or sp.get("operation"),
                    "startTime": sp.get("startTime"),
                    "duration": sp.get("duration"),
                    "tags": filtered_tags,
                }
                # Enrich with namespace/pod if available from the related_objects index
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
        # Be conservative: on any parsing issue, return what we have so far
        return simplified_spans

    logger.debug("_simplify_trace_detail_to_error_spans returns simplified_spans=%s", simplified_spans)
    return simplified_spans


def fetch_goal_query_objects(goals: List[str], query: str) -> Dict[str, List[Any]]:
    """Resolve Korrel8r goals from a start query and aggregate related objects by signal type.

    Builds a Start model from the provided query, requests goal-specific queries
    from Korrel8r, executes each query via query_objects, and aggregates results.
    Returns a dict with 'logs' and 'traces' keys to separate signal types.
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
                        # For traces, extract unique IDs, fetch details in parallel, keep only error-like ones
                        if bucket == "traces":
                            trace_ids = _extract_unique_trace_ids(obj_result)
                            logger.debug("fetch_goal_query_objects trace_ids=%s", trace_ids)
                            # Remove ones we've already processed
                            ids_to_fetch = [tid for tid in trace_ids if tid not in seen_trace_ids]
                            seen_trace_ids.update(ids_to_fetch)
                            logger.debug("fetch_goal_query_objects ids_to_fetch=%s", ids_to_fetch)
                            if ids_to_fetch:
                                error_traces = _get_error_trace_details_sync(ids_to_fetch)
                                logger.debug("fetch_goal_query_objects error_traces=%s", error_traces)
                                if isinstance(error_traces, list):
                                    # Simplify to error-focused spans
                                    simplified_spans_all: List[Dict[str, Any]] = []
                                    for dt in error_traces:
                                        simplified_spans_all.extend(_simplify_trace_detail_to_error_spans(dt, obj_result))
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


