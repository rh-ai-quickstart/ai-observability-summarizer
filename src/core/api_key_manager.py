"""
API Key Management Utilities

Provides shared utilities for detecting AI model providers and retrieving API keys
from Kubernetes Secrets. Used by MCP tools that need external model credentials.
"""

import os
import base64
import logging
import requests
from typing import Optional

logger = logging.getLogger(__name__)

# Kubernetes service account paths for secret retrieval
K8S_SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
K8S_SA_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
K8S_API_URL = "https://kubernetes.default.svc"


def detect_provider_from_model_id(model_id: Optional[str]) -> Optional[str]:
    """Detect AI provider from model identifier.

    Supports various naming conventions:
    - Explicit prefix: "google/gemini-2.5-flash" -> "google"
    - Model name patterns: "gpt-4o" -> "openai", "claude-3" -> "anthropic"

    Args:
        model_id: Model identifier (e.g., "google/gemini-2.5-flash", "gpt-4o-mini")

    Returns:
        Provider name (openai, anthropic, google, meta, internal) or None

    Examples:
        >>> detect_provider_from_model_id("google/gemini-2.5-flash")
        'google'
        >>> detect_provider_from_model_id("gpt-4o-mini")
        'openai'
        >>> detect_provider_from_model_id("claude-3-5-sonnet")
        'anthropic'
        >>> detect_provider_from_model_id("meta-llama/Llama-3.1-8B-Instruct")
        'meta'
    """
    try:
        if not model_id:
            return None

        # Check for explicit provider prefix (e.g., "google/model-name")
        if "/" in model_id:
            return model_id.split("/", 1)[0].strip().lower()

        # Pattern matching for common model names
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


def fetch_api_key_from_secret(provider: Optional[str]) -> Optional[str]:
    """Fetch provider API key from Kubernetes Secret.

    Retrieves API key from a namespaced secret with the naming convention:
        Secret name: ai-<provider>-credentials
        Secret key: api-key (base64 encoded)

    Requires RBAC permissions for the service account to read secrets.
    The MCP server's ServiceAccount must have 'get' permission on the secret.

    Args:
        provider: Provider name (openai, anthropic, google, meta)

    Returns:
        API key string or None if not found/accessible

    Note:
        - Logs debug messages for troubleshooting
        - Returns None for 'internal' provider (no API key needed)
        - Requires NAMESPACE environment variable to be set
    """
    try:
        if not provider or provider == "internal":
            return None

        # Get namespace from environment
        ns = os.getenv("NAMESPACE", "")
        if not ns:
            logger.debug("NAMESPACE not set, cannot fetch API key from secret")
            return None

        secret_name = f"ai-{provider}-credentials"

        # Read service account token
        token = ""
        try:
            with open(K8S_SA_TOKEN_PATH, "r") as f:
                token = f.read().strip()
        except Exception as e:
            logger.debug(f"Could not read service account token: {e}")
            return None

        if not token:
            logger.debug("Service account token is empty")
            return None

        # Prepare request to Kubernetes API
        headers = {"Authorization": f"Bearer {token}"}
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/secrets/{secret_name}"

        # Fetch secret
        resp = requests.get(url, headers=headers, timeout=5, verify=verify)
        if resp.status_code != 200:
            logger.debug(f"Secret {secret_name} fetch failed: {resp.status_code}")
            return None

        # Extract and decode API key
        data = resp.json().get("data", {})
        api_key_b64 = data.get("api-key", "")
        if not api_key_b64:
            logger.debug(f"Secret {secret_name} does not contain 'api-key' field")
            return None

        api_key = base64.b64decode(api_key_b64).decode("utf-8").strip()
        logger.info(f"✅ Retrieved API key from secret: {secret_name}")
        return api_key
    except Exception as e:
        logger.debug(f"Failed to fetch API key from secret: {e}")
        return None


def resolve_api_key(
    api_key: Optional[str] = None,
    model_id: Optional[str] = None,
) -> str:
    """Resolve API key with fallback priority.

    Priority order:
    1. Explicitly provided api_key parameter (from UI)
    2. Kubernetes Secret based on detected provider from model_id

    Args:
        api_key: Explicitly provided API key from UI (highest priority)
        model_id: Model identifier used to detect provider for secret lookup

    Returns:
        Resolved API key string (empty string if not found)

    Examples:
        >>> # With explicit API key from UI
        >>> resolve_api_key(api_key="sk-123", model_id="gpt-4")
        'sk-123'

        >>> # From Kubernetes secret (if available)
        >>> resolve_api_key(model_id="google/gemini-2.5-flash")
        # Returns key from ai-google-credentials secret

    Note:
        Environment variables are NOT used for API key resolution.
        API keys should either be passed explicitly from the UI or
        retrieved from Kubernetes Secrets in production mode.
    """
    # Priority 1: Explicitly provided API key (from UI)
    if api_key:
        return api_key

    # Priority 2: Kubernetes secret based on model provider
    if model_id:
        provider = detect_provider_from_model_id(model_id)
        secret_key = fetch_api_key_from_secret(provider)
        if secret_key:
            return secret_key

    return ""
