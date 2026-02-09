"""
Configuration management for OpenShift AI Observability

Centralizes all environment variables and configuration settings
that are shared across backend services and MCP server components.
"""

import os
import json
import logging
from typing import Dict, Any
from common.pylogger import get_python_logger

# Initialize structured logger once - other modules should use logging.getLogger(__name__)
get_python_logger()

logger = logging.getLogger(__name__)


def load_model_config() -> Dict[str, Any]:
    """
    DEPRECATED: Load unified model configuration from environment.

    This function is deprecated. Use get_model_config() from
    core.model_config_manager instead, which reads from ConfigMap
    with automatic refresh.

    This function is kept for backward compatibility only.
    """
    import warnings
    warnings.warn(
        "load_model_config() is deprecated, use get_model_config() from model_config_manager",
        DeprecationWarning,
        stacklevel=2
    )
    try:
        model_config_str = os.getenv("MODEL_CONFIG", "{}")
        return json.loads(model_config_str)
    except Exception as e:
        logger.warning("Could not parse MODEL_CONFIG: %s", e)
        return {}


def load_thanos_token() -> str:
    """Load Thanos token from file or environment variable."""
    token_input = os.getenv(
        "THANOS_TOKEN", "/var/run/secrets/kubernetes.io/serviceaccount/token"
    )
    if os.path.exists(token_input):
        with open(token_input, "r") as f:
            return f.read().strip()
    else:
        return token_input


def get_ca_verify_setting():
    """Get SSL certificate verification setting."""
    # Check if VERIFY_SSL environment variable is set
    verify_ssl_env = os.getenv("VERIFY_SSL")
    if verify_ssl_env is not None:
        # Convert string to boolean
        return verify_ssl_env.lower() in ("true", "1", "yes", "on")

    # Fallback to CA bundle check
    ca_bundle_path = "/etc/pki/ca-trust/extracted/pem/ca-bundle.crt"
    return ca_bundle_path if os.path.exists(ca_bundle_path) else True


def detect_environment() -> str:
    """Detect if running locally or in cluster."""
    # Check for Kubernetes service account (indicates cluster deployment)
    if os.path.exists("/var/run/secrets/kubernetes.io/serviceaccount/token"):
        return "cluster"
    # Check for local development indicators
    elif os.getenv("LOCAL_DEV") or os.getenv("PROMETHEUS_URL", "").startswith("http://localhost"):
        return "local"
    else:
        return "local"  # Default to local for safety


import threading
from datetime import datetime
from typing import Optional

# RAG availability cache
_rag_available_cache: Optional[bool] = None
_rag_cache_lock = threading.RLock()
_rag_cache_timestamp: Optional[datetime] = None
_RAG_CACHE_TTL_SECONDS = 30  # Re-check every 30 seconds


def _check_rag_infrastructure() -> bool:
    """
    Internal function to check if RAG (LlamaStack) infrastructure is reachable.
    This performs the actual HTTP check.
    """
    llama_stack_url = os.getenv("LLAMA_STACK_URL", "http://localhost:8321/v1/openai/v1")
    try:
        import requests
        # Try to reach the llama stack models endpoint with a quick timeout
        # LlamaStack doesn't have a /health endpoint, so we check /models instead
        models_url = f"{llama_stack_url.rstrip('/')}/models"
        response = requests.get(models_url, timeout=3)
        return response.status_code == 200
    except Exception:
        # If we can't reach llama stack or don't have requests, assume RAG unavailable
        return False


def is_rag_available() -> bool:
    """
    Check if RAG (local model) infrastructure is available.
    
    Uses caching with TTL to avoid checking on every request while still
    allowing dynamic detection when LlamaStack becomes available.
    
    Returns:
        True if LlamaStack is reachable, False otherwise
    """
    global _rag_available_cache, _rag_cache_timestamp
    
    with _rag_cache_lock:
        now = datetime.now()
        
        # Check if cache is valid
        cache_valid = (
            _rag_available_cache is not None and
            _rag_cache_timestamp is not None and
            (now - _rag_cache_timestamp).total_seconds() < _RAG_CACHE_TTL_SECONDS
        )
        
        if not cache_valid:
            # Cache expired or not set, perform check
            _rag_available_cache = _check_rag_infrastructure()
            _rag_cache_timestamp = now
            logger.debug(f"RAG availability checked: {_rag_available_cache}")
        
        return _rag_available_cache


def refresh_rag_status() -> bool:
    """
    Force refresh of RAG availability status.
    
    Use this after deploying LlamaStack to immediately detect it
    without waiting for cache expiry.
    
    Returns:
        Current RAG availability status
    """
    global _rag_available_cache, _rag_cache_timestamp
    
    with _rag_cache_lock:
        _rag_available_cache = _check_rag_infrastructure()
        _rag_cache_timestamp = datetime.now()
        logger.info(f"RAG availability refreshed: {_rag_available_cache}")
        return _rag_available_cache

def get_prometheus_url() -> str:
    """Get Prometheus URL based on environment."""
    # Allow explicit override
    if os.getenv("PROMETHEUS_URL"):
        return os.getenv("PROMETHEUS_URL")
    
    env = detect_environment()
    if env == "cluster":
        # In cluster: use Thanos querier service
        return "http://thanos-querier.openshift-monitoring.svc.cluster.local:9090"
    else:
        # Local development: use port-forwarded localhost
        return "http://localhost:9090"

def get_tempo_url() -> str:
    """Get Tempo URL based on environment."""
    # Allow explicit override
    if os.getenv("TEMPO_URL"):
        return os.getenv("TEMPO_URL")
    
    env = detect_environment()
    if env == "cluster":
        return "https://tempo-tempostack-gateway.observability-hub.svc.cluster.local:8080"
    else:
        # Local development: use port-forwarded localhost
        return "https://localhost:8082"

# Main configuration settings
PROMETHEUS_URL = get_prometheus_url()
TEMPO_URL = get_tempo_url()
LLAMA_STACK_URL = os.getenv("LLAMA_STACK_URL", "http://localhost:8321/v1/openai/v1")
LLM_API_TOKEN = os.getenv("LLM_API_TOKEN", "")

# Tempo-specific configuration
TEMPO_TENANT_ID = os.getenv("TEMPO_TENANT_ID", "dev")

# Kubernetes service account token configuration
K8S_SERVICE_ACCOUNT_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
DEV_FALLBACK_TOKEN = "dev-token"

# Tempo analysis constants
SLOW_TRACE_THRESHOLD_MS = 1000  # Traces slower than this are considered "slow"
MAX_PER_SERVICE_LIMIT = 50  # Maximum traces to fetch per service in wildcard queries
DEFAULT_CHAT_QUERY_LIMIT = 50  # Default limit for chat tool queries
DEFAULT_QUERY_LIMIT = 20  # Default limit for regular queries
REQUEST_TIMEOUT_SECONDS = 30.0  # HTTP request timeout
DISCOVERY_TIMEOUT_SECONDS = float(os.getenv("DISCOVERY_TIMEOUT_SECONDS", "10.0"))  # GPU discovery and catalog validation timeout
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "180.0"))  # LLM API request timeout

# Load complex configurations
# NOTE: MODEL_CONFIG is deprecated - use get_model_config() from model_config_manager
# This is kept for backward compatibility only and reads from env var
MODEL_CONFIG = load_model_config()
THANOS_TOKEN = load_thanos_token()
VERIFY_SSL = get_ca_verify_setting()

# NOTE: RAG_AVAILABLE is checked dynamically with caching (30s TTL)
# Use is_rag_available() for fresh checks, or refresh_rag_status() to force refresh
# The initial value is set here for backward compatibility
RAG_AVAILABLE = is_rag_available()

# Import new dynamic config manager functions
# These should be used instead of MODEL_CONFIG for all new code
try:
    from core.model_config_manager import get_model_config, get_default_models, reload_model_config
except ImportError:
    # Fallback if model_config_manager is not available yet
    logger.warning("model_config_manager not available, using legacy MODEL_CONFIG")
    get_model_config = load_model_config
    get_default_models = load_model_config
    reload_model_config = lambda: None

# Log configuration for debugging
import logging
logger = logging.getLogger(__name__)
logger.info(f"Environment detected: {detect_environment()}")
logger.info(f"Prometheus URL: {PROMETHEUS_URL}")
logger.info(f"Tempo URL: {TEMPO_URL}")
logger.info(f"SSL Verification: {VERIFY_SSL}")
logger.info(f"RAG Available: {RAG_AVAILABLE}")
logger.info(f"Thanos Token: {'***configured***' if THANOS_TOKEN else 'not set'}") 

# Common constants
# Chat scope values used across the codebase
CHAT_SCOPE_FLEET_WIDE = "fleet_wide"
FLEET_WIDE_DISPLAY = "Fleet-wide"

# Time range constraints
# Maximum time range allowed for analysis (in days)
MAX_TIME_RANGE_DAYS: int = int(os.getenv("MAX_TIME_RANGE_DAYS", "90"))

# Default time range when none is provided (in days)
DEFAULT_TIME_RANGE_DAYS: int = int(os.getenv("DEFAULT_TIME_RANGE_DAYS", "90"))

# Korrel8r integration
KORREL8R_URL: str = os.getenv("KORREL8R_URL", "")
KORREL8R_TIMEOUT_SECONDS: int = int(os.getenv("KORREL8R_TIMEOUT_SECONDS", "8"))

# Deep-link configuration
CONSOLE_BASE_URL: str = os.getenv("CONSOLE_BASE_URL", "")
GRAFANA_BASE_URL: str = os.getenv("GRAFANA_BASE_URL", "")
TEMPO_BASE_URL: str = os.getenv("TEMPO_BASE_URL", "")
TEMPO_DATASOURCE_UID: str = os.getenv("TEMPO_DATASOURCE_UID", "")
LOKI_DATASOURCE_UID: str = os.getenv("LOKI_DATASOURCE_UID", "")


# Tools that accept a namespace parameter for scoping queries.
# Used by chatbots to automatically inject namespace into tool arguments.
#
# execute_promql is handled separately — namespace is injected into the PromQL
# query string itself (not as a function argument).
#
# Metric discovery/catalog tools (search_metrics, search_metrics_by_category,
# get_label_values, get_metric_metadata, suggest_queries, explain_results,
# find_best_metric_with_metadata) are intentionally excluded — they search
# the metrics catalog and do not accept a namespace parameter.
NAMESPACE_AWARE_TOOLS = frozenset({
    'execute_promql',
    'fetch_openshift_metrics_data', 'analyze_openshift', 'chat_openshift',
    'get_correlated_logs',
})
