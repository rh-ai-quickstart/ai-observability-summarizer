"""Observability tools for OpenShift AI monitoring and analysis (vLLM-focused).

This module provides MCP tools for vLLM observability:

Model & Namespace Discovery:
- list_models: Get available AI/vLLM models
- list_vllm_namespaces: List monitored namespaces with vLLM deployments
- get_model_config: Get configured LLM models for summarization
- list_summarization_models: List available summarization models

Metrics:
- get_vllm_metrics_tool: Get available vLLM metrics with friendly names
- fetch_vllm_metrics_data: Fetch metrics data with time-series for display
- calculate_metrics: Calculate statistics for provided metrics data

Analysis:
- analyze_vllm: Analyze vLLM metrics and summarize using LLM
- chat_vllm: Chat with AI about vLLM metrics

Infrastructure:
- get_gpu_info: Get cluster GPU information
- get_deployment_info: Get model deployment details

OpenShift-specific tools live in observability_openshift_tools.py
"""

import json
import math
import os
import re
import pandas as pd
from typing import Dict, Any, List, Optional
from datetime import datetime

# Core imports
from core.metrics import (
    get_models_helper,
    get_vllm_namespaces_helper,
    get_vllm_metrics,
    fetch_metrics,
    get_summarization_models,
    get_cluster_gpu_info,
    get_namespace_model_deployment_info,
    execute_instant_queries_parallel,
    execute_range_queries_parallel,
    build_correlated_context_from_metrics,
)
from core.llm_client import build_prompt, summarize_with_llm, extract_time_range_with_info
from core.response_validator import ResponseType
from core.config import DEFAULT_TIME_RANGE_DAYS, KORREL8R_ENABLED
from common.pylogger import get_python_logger
from core.response_utils import make_mcp_text_response

# MCP exception handling
from mcp_server.exceptions import (
    ValidationError,
    PrometheusError,
    LLMServiceError,
    MCPException,
    MCPErrorCode,
    validate_required_params,
    validate_time_range,
    safe_json_loads,
)

# Configure structured logging
logger = get_python_logger()


def check_rag_availability():
    """Check if RAG infrastructure is available for vLLM operations."""
    try:
        from core.config import RAG_AVAILABLE
        if not RAG_AVAILABLE:
            error = MCPException(
                message="vLLM infrastructure not available",
                error_code=MCPErrorCode.CONFIGURATION_ERROR,
                recovery_suggestion="RAG infrastructure is not installed or accessible. vLLM metrics require local model deployment. Install with: make install ENABLE_RAG=true"
            )
            return error.to_mcp_response()
        return None
    except Exception:
        # If we can't determine availability, allow the operation to continue
        return None


def resolve_time_range(
    time_range: Optional[str] = None,
    start_datetime: Optional[str] = None,
    end_datetime: Optional[str] = None,
) -> tuple[int, int]:
    """Resolve various time inputs into start/end epoch seconds.

    Precedence:
    1) time_range natural language → use extract_time_range_with_info
    2) ISO datetime strings (start_datetime/end_datetime)
    3) Default to last 1 hour
    """
    try:
        # 1) Natural language time range
        if time_range:
            start_ts2, end_ts2, _info = extract_time_range_with_info(time_range, None, None)
            return start_ts2, end_ts2

        # 2) ISO datetime strings
        if start_datetime and end_datetime:
            rs = int(datetime.fromisoformat(start_datetime.replace("Z", "+00:00")).timestamp())
            re = int(datetime.fromisoformat(end_datetime.replace("Z", "+00:00")).timestamp())
            return rs, re

        # 3) Default: last DEFAULT_TIME_RANGE_DAYS days
        now = int(datetime.utcnow().timestamp())
        return now - (DEFAULT_TIME_RANGE_DAYS * 24 * 3600), now
    except Exception as e:
        # Log the error for debugging
        logger.error(f"Error in resolve_time_range: {e}")
        logger.error(f"Inputs: time_range={time_range}, start_datetime={start_datetime}, end_datetime={end_datetime}")
        # Safe fallback to default range on any parsing error
        now = int(datetime.utcnow().timestamp())
        return now - (DEFAULT_TIME_RANGE_DAYS * 24 * 3600), now


def list_models() -> List[Dict[str, Any]]:
    """List all available AI models for analysis.
    
    Returns information about both local and external AI models available
    for generating observability analysis and summaries.
    
    Returns:
        List of available models with their configurations
    """
    try:
        models = get_models_helper()
        
        if not models:
            return make_mcp_text_response("No models are currently available.")
        
        model_list = [f"• {model}" for model in models]
        response = f"Available AI Models ({len(models)} total):\n\n" + "\n".join(model_list)
        return make_mcp_text_response(response)
    except Exception as e:
        error = MCPException(
            message=f"Failed to retrieve models: {str(e)}",
            error_code=MCPErrorCode.CONFIGURATION_ERROR,
            recovery_suggestion="Please check the model configuration and try again."
        )
        return error.to_mcp_response()


def list_vllm_namespaces() -> List[Dict[str, Any]]:
    """Get list of monitored vLLM Kubernetes namespaces.
    
    Retrieves all vLLMnamespaces that have vLLM deployed and observability data available
    in the Prometheus/Thanos monitoring system.
    
    Returns:
        List of vLLM namespace names with monitoring status
    """
    # Check if RAG infrastructure is available
    rag_error = check_rag_availability()
    if rag_error:
        return rag_error
    
    try:
        namespaces = get_vllm_namespaces_helper()
        if not namespaces:
            return make_mcp_text_response("No monitored vLLM namespaces found.")
        namespace_list = "\n".join([f"• {ns}" for ns in namespaces])
        response_text = f"Monitored vLLM Namespaces ({len(namespaces)} total):\n\n{namespace_list}"
        return make_mcp_text_response(response_text)
    except Exception as e:
        error = MCPException(
            message=f"Failed to retrieve vLLM namespaces: {str(e)}",
            error_code=MCPErrorCode.PROMETHEUS_ERROR,
            recovery_suggestion="Please check Prometheus/Thanos connectivity."
        )
        return error.to_mcp_response()


def get_model_config() -> List[Dict[str, Any]]:
    """Get available LLM models for summarization and analysis.
    
    Uses the exact same logic as the metrics API's /model_config endpoint:
    - Reads MODEL_CONFIG from environment (JSON string)
    - Filters out local models when RAG infrastructure is unavailable
    - Parses to dict and sorts with external:false models first
    - Returns a human-readable list formatted for MCP
    """
    try:
        model_config_str = os.getenv("MODEL_CONFIG", "{}")
        full_model_config = safe_json_loads(model_config_str, "MODEL_CONFIG environment variable")
        
        # Import here to avoid circular imports
        from core.config import RAG_AVAILABLE
        
        # Filter out local models if RAG is not available
        model_config = {}
        for name, config in full_model_config.items():
            is_external = config.get("external", True)
            if not is_external and not RAG_AVAILABLE:
                # Skip local models when RAG infrastructure is unavailable
                continue
            model_config[name] = config
        
        model_config = dict(
            sorted(model_config.items(), key=lambda x: x[1].get("external", True))
        )
    except ValidationError:
        logger.warning("Could not parse MODEL_CONFIG environment variable, using empty configuration")
        model_config = {}

    if not model_config:
        if not RAG_AVAILABLE:
            return make_mcp_text_response("No LLM models available. RAG infrastructure is not installed or accessible. Please configure external models (Anthropic, OpenAI, Google) with API keys.")
        return make_mcp_text_response("No LLM models configured for summarization.")

    response = f"Available Model Config ({len(model_config)} total):\n\n"
    for model_name, config in model_config.items():
        response += f"• {model_name}\n"
        for key, value in config.items():
            response += f"  - {key}: {value}\n"
        response += "\n"

    return make_mcp_text_response(response.strip())


def get_vllm_metrics_tool() -> List[Dict[str, Any]]:
    """Get available vLLM metrics with friendly names.
    
    Dynamically discovers available vLLM and GPU metrics from Prometheus
    and returns them as a mapping of friendly names to PromQL queries.
    
    Returns:
        Formatted list of available metrics with their PromQL queries
    """
    try:
        # Get the vLLM metrics mapping from the core function
        vllm_metrics_dict = get_vllm_metrics()
        
        if not vllm_metrics_dict:
            return make_mcp_text_response("No vLLM metrics are currently available from Prometheus.")

        # Format the response with categories for better organization
        content = f"Available vLLM Metrics ({len(vllm_metrics_dict)} total):\n\n"
        
        # Group metrics by type for better presentation
        gpu_metrics = {}
        vllm_core_metrics = {}
        other_metrics = {}
        
        for friendly_name, promql_query in vllm_metrics_dict.items():
            if any(gpu_term in friendly_name.lower() for gpu_term in ['gpu', 'temperature', 'power', 'memory', 'energy', 'utilization']):
                gpu_metrics[friendly_name] = promql_query
            elif any(vllm_term in friendly_name.lower() for vllm_term in ['prompt', 'token', 'latency', 'request', 'inference']):
                vllm_core_metrics[friendly_name] = promql_query
            else:
                other_metrics[friendly_name] = promql_query
        
        # Display GPU metrics first
        if gpu_metrics:
            content += "📊 **GPU Metrics:**\n"
            for friendly_name, promql_query in sorted(gpu_metrics.items()):
                content += f"• {friendly_name}\n  Query: `{promql_query}`\n\n"
        
        # Display vLLM core metrics
        if vllm_core_metrics:
            content += "🚀 **vLLM Performance Metrics:**\n"
            for friendly_name, promql_query in sorted(vllm_core_metrics.items()):
                content += f"• {friendly_name}\n  Query: `{promql_query}`\n\n"
        
        # Display other metrics
        if other_metrics:
            content += "🔧 **Other Metrics:**\n"
            for friendly_name, promql_query in sorted(other_metrics.items()):
                content += f"• {friendly_name}\n  Query: `{promql_query}`\n\n"

        # Add summary stats
        content += f"\n**Summary:**\n"
        content += f"- GPU Metrics: {len(gpu_metrics)}\n"
        content += f"- vLLM Performance: {len(vllm_core_metrics)}\n"
        content += f"- Other: {len(other_metrics)}\n"
        content += f"- Total: {len(vllm_metrics_dict)}\n"

        return make_mcp_text_response(content)

    except Exception as e:
        error = MCPException(
            message=f"Failed to retrieve vLLM metrics: {str(e)}",
            error_code=MCPErrorCode.PROMETHEUS_ERROR,
            recovery_suggestion="Check Prometheus/Thanos connectivity and vLLM metrics availability."
        )
        return error.to_mcp_response()


def _inject_labels_into_query(query: str, label_clause: str) -> str:
    """Inject labels into a Prometheus query at the correct position.
    
    Handles:
    - vllm:simple_metric -> vllm:simple_metric{labels}
    - vllm:metric[5m] -> vllm:metric{labels}[5m]
    - avg(vllm:metric) -> avg(vllm:metric{labels})
    - histogram_quantile(0.95, sum(rate(vllm:metric[5m])) by (le))
    
    DCGM metrics are skipped (they're global GPU metrics without model labels).
    """
    result = query
    
    # Skip DCGM/GPU metrics - they don't have model_name labels
    if 'DCGM_' in query or 'habana' in query:
        return result
    
    # Pattern 1: vllm:metric_name followed by [ (time range)
    # e.g., vllm:metric[5m] -> vllm:metric{labels}[5m]
    result = re.sub(
        r'(vllm:[\w:]+)(\[)',
        rf'\1{{{label_clause}}}\2',
        result
    )
    
    # Pattern 2: vllm:metric_name followed by ) (inside function)
    # e.g., avg(vllm:metric) -> avg(vllm:metric{labels})
    result = re.sub(
        r'(vllm:[\w:]+)(?!\{)(\))',
        rf'\1{{{label_clause}}}\2',
        result
    )
    
    # Pattern 3: Bare vllm:metric_name at end of query (no [ or ) after)
    # e.g., vllm:num_requests_running -> vllm:num_requests_running{labels}
    # Only if not already labeled and at end of string or followed by space/operator
    result = re.sub(
        r'(vllm:[\w:]+)(?!\{|\[|\))(\s|$|[+\-*/])',
        rf'\1{{{label_clause}}}\2',
        result
    )
    
    # Merge adjacent label blocks: {a}{b} -> {a,b}
    result = re.sub(r'\}\{', ',', result)
    
    return result


def fetch_vllm_metrics_data(
    model_name: str,
    time_range: Optional[str] = None,
    start_datetime: Optional[str] = None,
    end_datetime: Optional[str] = None,
    namespace: Optional[str] = None,
) -> str:
    """Fetch vLLM metrics data for dashboard display.
    
    Returns JSON string with all vLLM and GPU metrics for the specified model.
    Uses parallel instant queries for fast loading.
    
    Args:
        model_name: Model to fetch metrics for (e.g., "demo3 | meta-llama/Llama-3.2-3B-Instruct")
        time_range: Time range like "1h", "6h", "24h"
        namespace: Optional namespace filter
        
    Returns:
        JSON string: {"model_name": "...", "start_ts": ..., "end_ts": ..., "metrics": {...}}
    """
    try:
        # Resolve time range (for metadata)
        resolved_start, resolved_end = resolve_time_range(
            time_range=time_range,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
        )
    except Exception as e:
        error = MCPException(
            message=f"Time range resolution failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the time range parameters."
        )
        return error.to_mcp_response()

    try:
        # Get vLLM metrics queries
        vllm_metrics = get_vllm_metrics()
        
        # Prepare queries with model_name filter
        prepared_queries: Dict[str, str] = {}
        for label, query in vllm_metrics.items():
            final_query = query
            # Inject model_name label if not "all"
            if model_name and model_name.lower() != "all":
                # Parse model_name which may be "namespace | model_name"
                if "|" in model_name:
                    ns, actual_model = [s.strip() for s in model_name.split("|", 1)]
                    label_clause = f'model_name="{actual_model}",namespace="{ns}"'
                else:
                    # Model name without namespace prefix
                    label_clause = f'model_name="{model_name}"'
                
                final_query = _inject_labels_into_query(query, label_clause)
            
            # Add namespace filter if specified separately
            if namespace and namespace.lower() != "all" and "namespace=" not in final_query:
                final_query = _inject_labels_into_query(final_query, f'namespace="{namespace}"')
            
            prepared_queries[label] = final_query
        
        # Execute instant queries for current values (fast!)
        values = execute_instant_queries_parallel(prepared_queries, max_workers=10)
        
        # Execute range queries for sparklines (in parallel)
        time_series_data = execute_range_queries_parallel(
            prepared_queries, 
            resolved_start, 
            resolved_end, 
            max_workers=10,
            max_points=15  # ~15 points for sparklines
        )
        
        # Format results - convert NaN to null for valid JSON
        metrics_data = {}
        for label, value in values.items():
            # NaN is not valid JSON, convert to None (null)
            clean_value = None if (isinstance(value, float) and math.isnan(value)) else value
            metrics_data[label] = {
                "latest_value": clean_value,
                "time_series": time_series_data.get(label, [])
            }
        
        # Return as plain JSON string (not wrapped in MCP format)
        response = {
            "model_name": model_name,
            "start_ts": resolved_start,
            "end_ts": resolved_end,
            "metrics": metrics_data
        }
        
        return json.dumps(response)
        
    except Exception as e:
        error = MCPException(
            message=f"Failed to fetch vLLM metrics: {str(e)}",
            error_code=MCPErrorCode.PROMETHEUS_ERROR,
            recovery_suggestion="Check Prometheus connectivity and try again."
        )
        return error.to_mcp_response()


def analyze_vllm(
    model_name: str,
    summarize_model_id: str,
    time_range: Optional[str] = None,
    start_datetime: Optional[str] = None,
    end_datetime: Optional[str] = None,
    api_key: Optional[str] = None,
) -> str:
    """Analyze vLLM metrics and generate AI summary.
    
    Fetches metrics, builds a prompt, and uses LLM to generate analysis.
    
    Args:
        model_name: Model to analyze (e.g., "demo3 | meta-llama/Llama-3.2-3B-Instruct")
        summarize_model_id: LLM model to use for analysis
        time_range: Time range like "1h", "6h", "24h"
        api_key: Optional API key for external LLM
        
    Returns:
        JSON string: {"model_name": "...", "summary": "...", "time_range": "..."}
    """
    # Validate required parameters
    try:
        validate_required_params(model_name=model_name, summarize_model_id=summarize_model_id)
    except ValidationError as e:
        return e.to_mcp_response()
    except Exception as e:
        error = MCPException(
            message=f"Parameter validation failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the input parameters and try again."
        )
        return error.to_mcp_response()

    # Resolve time range → start_ts/end_ts via common helper
    try:
        resolved_start, resolved_end = resolve_time_range(
            time_range=time_range,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
        )
    except Exception as e:
        error = MCPException(
            message=f"Time range resolution failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the time range parameters and try again."
        )
        return error.to_mcp_response()

    # Validate time range
    try:
        validate_time_range(resolved_start, resolved_end)
    except ValidationError as e:
        return e.to_mcp_response()
    except Exception as e:
        error = MCPException(
            message=f"Time range validation failed: {str(e)}",
            error_code=MCPErrorCode.INVALID_INPUT,
            recovery_suggestion="Please check the time range and try again."
        )
        return error.to_mcp_response()

    # Collect metrics and perform analysis
    try:
        vllm_metrics = get_vllm_metrics()
        metric_dfs: Dict[str, Any] = {
            label: fetch_metrics(query, model_name, resolved_start, resolved_end)
                for label, query in vllm_metrics.items()
        }

        # --- Phase 1: Optional Korrel8r enrichment (logs only) ---
        korrel8r_section: Dict[str, Any] = {}
        korrel8r_prompt_note: str = ""
        log_trace_data: str = ""
        if KORREL8R_ENABLED:
            log_trace_data = build_correlated_context_from_metrics(
                metric_dfs=metric_dfs,
                model_name=model_name,
                start_ts=resolved_start,
                end_ts=resolved_end,
            )

        # Build prompt base and summarize (Korrel8r enrichment may augment prompt later)
        prompt = build_prompt(metric_dfs, model_name, log_trace_data)

        summary = summarize_with_llm(
            prompt,
            summarize_model_id,
            ResponseType.VLLM_ANALYSIS,
            api_key,
        )

        # Return only the AI summary - metrics data comes from fetch_vllm_metrics_data
        structured_response = {
            "model_name": model_name,
            "summary": summary,
            "time_range": time_range or f"{resolved_start.isoformat()}-{resolved_end.isoformat()}",
        }

        # Return as plain JSON string (not wrapped in MCP format)
        return json.dumps(structured_response)
        
    except PrometheusError as e:
        return e.to_mcp_response()
    except LLMServiceError as e:
        return e.to_mcp_response()
    except Exception as e:
        error = MCPException(
            message=f"Analysis failed: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
            recovery_suggestion="Please try again. If the problem persists, contact support."
        )
        return error.to_mcp_response()


def calculate_metrics(
    metrics_data_json: str,
) -> List[Dict[str, Any]]:
    """Calculate statistics for provided metrics data.

    This function mirrors the /calculate-metrics REST API endpoint functionality.
    Takes metrics data and returns calculated statistics in JSON format for UI consumption.

    Args:
        metrics_data_json: JSON string containing metrics data in the format:
            {
                "GPU Temperature (°C)": [
                    {"timestamp": "2024-01-01T10:00:00", "value": 45.2},
                    {"timestamp": "2024-01-01T10:01:00", "value": 46.1}
                ]
            }

    Returns:
        JSON string with calculated statistics matching REST API format
    """
    try:
        # Parse the JSON input
        try:
            metrics_data = json.loads(metrics_data_json)
        except json.JSONDecodeError as e:
            error = ValidationError(
                message=f"Invalid JSON format: {str(e)}",
                field="metrics_data_json",
                value=metrics_data_json[:100] + "..." if len(metrics_data_json) > 100 else metrics_data_json
            )
            return error.to_mcp_response()

        if not isinstance(metrics_data, dict):
            error = ValidationError(
                message="Expected metrics_data to be a dictionary",
                field="metrics_data_json"
            )
            return error.to_mcp_response()

        calculated_metrics = {}

        # Use same logic as REST API /calculate-metrics endpoint
        for label, data_points in metrics_data.items():
            if not data_points:
                calculated_metrics[label] = {
                    "avg": None,
                    "min": None,
                    "max": None,
                    "latest": None,
                    "count": 0
                }
                continue

            # Extract values from data points (same logic as REST API)
            values = []
            for point in data_points:
                if isinstance(point, dict) and "value" in point:
                    try:
                        value = float(point["value"])
                        if pd.notna(value):  # Check for non-NaN
                            values.append(value)
                    except (ValueError, TypeError):
                        continue

            if values:
                calculated_metrics[label] = {
                    "avg": sum(values) / len(values),
                    "min": min(values),
                    "max": max(values),
                    "latest": values[-1],
                    "count": len(values)
                }
            else:
                calculated_metrics[label] = {
                    "avg": None,
                    "min": None,
                    "max": None,
                    "latest": None,
                    "count": 0
                }

        # Return as JSON string (same format as REST API response)
        result = {"calculated_metrics": calculated_metrics}
        return make_mcp_text_response(json.dumps(result))

    except Exception as e:
        error = MCPException(
            message=f"Failed to calculate metrics: {str(e)}",
            error_code=MCPErrorCode.DATA_PROCESSING_ERROR,
            recovery_suggestion="Check the metrics data format and try again."
        )
        return error.to_mcp_response()


def list_summarization_models() -> List[Dict[str, Any]]:
    """List available summarization models, including internal and external models."""
    try:
        models = get_summarization_models()
        if not models:
            # Import here to avoid circular imports
            from core.config import RAG_AVAILABLE
            if not RAG_AVAILABLE:
                return make_mcp_text_response("No summarization models available. RAG infrastructure is not installed or accessible. Please configure external models (Anthropic, OpenAI, Google) with API keys.")
            return make_mcp_text_response("No summarization models configured.")
        content_lines = [f"• {name}" for name in models]
        content = f"Available Summarization Models ({len(models)} total):\n\n" + "\n".join(content_lines)
        return make_mcp_text_response(content)
    except Exception as e:
        error = MCPException(
            message=f"Failed to list summarization models: {str(e)}",
            error_code=MCPErrorCode.CONFIGURATION_ERROR,
            recovery_suggestion="Ensure model configuration is valid."
        )
        return error.to_mcp_response()


def get_gpu_info() -> List[Dict[str, Any]]:
    """Get GPU information."""
    try:
        info = get_cluster_gpu_info()
        return make_mcp_text_response(json.dumps(info))
    except Exception as e:
        error = MCPException(
            message=f"Failed to get GPU info: {str(e)}",
            error_code=MCPErrorCode.PROMETHEUS_ERROR,
            recovery_suggestion="Verify Prometheus/Thanos connectivity and DCGM exporter availability."
        )
        return error.to_mcp_response()


def get_deployment_info(namespace: str, model: str) -> List[Dict[str, Any]]:
    """Get deployment info for a model in a namespace."""
    try:
        validate_required_params(namespace=namespace, model=model)
    except ValidationError as e:
        return e.to_mcp_response()

    try:
        payload = get_namespace_model_deployment_info(namespace, model)
        return make_mcp_text_response(json.dumps(payload))
    except Exception as e:
        error = MCPException(
            message=f"Failed to get deployment info: {str(e)}",
            error_code=MCPErrorCode.PROMETHEUS_ERROR,
            recovery_suggestion="Verify Prometheus/Thanos connectivity and metric availability."
        )
        return error.to_mcp_response()


def chat_vllm(
    model_name: str,
    prompt_summary: str,
    question: str,
    summarize_model_id: str,
    api_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Chat about vLLM metrics - ask follow-up questions about analyzed data.
    
    Args:
        model_name: The vLLM model name (format: "namespace | model" or just "model")
        prompt_summary: The metrics summary/context from previous analysis
        question: The user's follow-up question
        summarize_model_id: The LLM model to use for generating response
        api_key: Optional API key for external LLM models
    
    Returns:
        Chat response with answer to the question
    
    Example:
        >>> chat_vllm(
        ...     model_name="dev | llama-3.2-3b-instruct",
        ...     prompt_summary="GPU usage is at 85%...",
        ...     question="What is the average latency?",
        ...     summarize_model_id="meta-llama/Llama-3.2-3B-Instruct"
        ... )
    """
    logger.debug("chat_vllm tool with model_name=%s, prompt_summary=%s, question=%s, summarize_model_id=%s, api_key=%s", model_name, prompt_summary, question, summarize_model_id, api_key)
    try:
        # Validate required parameters
        validate_required_params(
            model_name=model_name,
            prompt_summary=prompt_summary,
            question=question,
            summarize_model_id=summarize_model_id
        )
    except ValidationError as e:
        return e.to_mcp_response()
    
    try:
        # Import here to avoid circular dependencies
        from core.llm_client import build_chat_prompt, _clean_llm_summary_string
        
        # Build the chat prompt
        prompt = build_chat_prompt(
            user_question=question,
            metrics_summary=prompt_summary
        )
        
        # Get LLM response
        response = summarize_with_llm(
            prompt,
            summarize_model_id,
            ResponseType.GENERAL_CHAT,
            api_key,
            max_tokens=1500
        )
        
        # Clean the response
        cleaned_response = _clean_llm_summary_string(response)
        
        return make_mcp_text_response(cleaned_response)
        
    except Exception as e:
        logger.exception(f"Error in chat_vllm: {e}")
        error = MCPException(
            message=f"Failed to generate chat response: {str(e)}",
            error_code=MCPErrorCode.LLM_SERVICE_ERROR,
            recovery_suggestion="Please check your API key or try again later."
        )
        return error.to_mcp_response()
