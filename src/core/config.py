"""
Configuration management for OpenShift AI Observability

Centralizes all environment variables and configuration settings
that are shared across FastAPI, Streamlit UI, and MCP servers.
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
    """Load unified model configuration from environment."""
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


def is_rag_available() -> bool:
    """Check if RAG (local model) infrastructure is available."""
    # Check environment variable for explicit override
    rag_enabled_env = os.getenv("RAG_ENABLED")
    if rag_enabled_env is not None:
        return rag_enabled_env.lower() in ("true", "1", "yes", "on")
    
    # Auto-detect based on LLAMA_STACK_URL availability
    llama_stack_url = os.getenv("LLAMA_STACK_URL", "http://localhost:8321/v1/openai/v1")
    try:
        import requests
        # Try to reach the llama stack endpoint with a quick timeout
        response = requests.get(f"{llama_stack_url.rstrip('/v1/openai/v1')}/health", timeout=3)
        return response.status_code == 200
    except Exception:
        # If we can't reach llama stack or don't have requests, assume RAG unavailable
        return False

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
TEMPO_NAMESPACE = "observability-hub"

# Default Tempo URL for OpenShift deployment
DEFAULT_TEMPO_URL = "https://tempo-tempostack-gateway.observability-hub.svc.cluster.local:8080"

# Kubernetes service account token configuration
K8S_SERVICE_ACCOUNT_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
DEV_FALLBACK_TOKEN = "dev-token"

# Tempo analysis constants
SLOW_TRACE_THRESHOLD_MS = 1000  # Traces slower than this are considered "slow"
MAX_PER_SERVICE_LIMIT = 50  # Maximum traces to fetch per service in wildcard queries
DEFAULT_CHAT_QUERY_LIMIT = 50  # Default limit for chat tool queries
DEFAULT_QUERY_LIMIT = 20  # Default limit for regular queries
REQUEST_TIMEOUT_SECONDS = 30.0  # HTTP request timeout

# Load complex configurations
MODEL_CONFIG = load_model_config()
THANOS_TOKEN = load_thanos_token()
VERIFY_SSL = get_ca_verify_setting()
RAG_AVAILABLE = is_rag_available()

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

# Korrel8r integration (feature-flagged)
KORREL8R_ENABLED: bool = os.getenv("KORREL8R_ENABLED", "true").lower() == "true"
KORREL8R_URL: str = os.getenv("KORREL8R_URL", "")
KORREL8R_TIMEOUT_SECONDS: int = int(os.getenv("KORREL8R_TIMEOUT_SECONDS", "8"))

# Deep-link configuration
CONSOLE_BASE_URL: str = os.getenv("CONSOLE_BASE_URL", "")
GRAFANA_BASE_URL: str = os.getenv("GRAFANA_BASE_URL", "")
TEMPO_BASE_URL: str = os.getenv("TEMPO_BASE_URL", "")
TEMPO_DATASOURCE_UID: str = os.getenv("TEMPO_DATASOURCE_UID", "")
LOKI_DATASOURCE_UID: str = os.getenv("LOKI_DATASOURCE_UID", "")