"""
Dynamic model configuration manager.

Manages model configuration with ConfigMap as source of truth,
using MODEL_CONFIG env var as template for initialization.
"""

import os
import json
import logging
import threading
import requests
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# Kubernetes configuration
K8S_API_URL = os.getenv("KUBERNETES_SERVICE_HOST", "https://kubernetes.default.svc")
if not K8S_API_URL.startswith("http"):
    K8S_API_URL = f"https://{K8S_API_URL}"
K8S_SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
K8S_SA_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
CONFIGMAP_NAME = "ai-model-config"

# Runtime configuration cache
_runtime_config: Optional[Dict[str, Any]] = None
_config_lock = threading.RLock()
_config_last_updated: Optional[datetime] = None
_config_cache_ttl_seconds = 60  # Refresh every 60 seconds


def load_model_config_from_env() -> Dict[str, Any]:
    """
    Load default model configuration from MODEL_CONFIG env var.

    This serves as the template/defaults for initial ConfigMap creation.

    Returns:
        Model configuration dict
    """
    try:
        model_config_str = os.getenv("MODEL_CONFIG", "{}")
        config = json.loads(model_config_str)
        logger.debug(f"Loaded {len(config)} default models from MODEL_CONFIG env var")
        return config
    except Exception as e:
        logger.warning(f"Could not parse MODEL_CONFIG: {e}")
        return {}


def _get_k8s_headers() -> Dict[str, str]:
    """Get Kubernetes API headers with service account token."""
    try:
        with open(K8S_SA_TOKEN_PATH, 'r') as f:
            token = f.read().strip()
        return {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
    except Exception as e:
        logger.error(f"Failed to read service account token: {e}")
        return {'Content-Type': 'application/json'}


def load_model_config_from_configmap() -> Optional[Dict[str, Any]]:
    """
    Load model configuration from ConfigMap.

    Returns:
        Model config dict if ConfigMap exists, None otherwise
    """
    try:
        ns = os.getenv("NAMESPACE", "")
        if not ns:
            logger.warning("NAMESPACE not set, cannot read ConfigMap")
            return None

        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/configmaps/{CONFIGMAP_NAME}"
        headers = _get_k8s_headers()
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        r = requests.get(url, headers=headers, timeout=5, verify=verify)

        if r.status_code == 404:
            logger.info(f"ConfigMap {CONFIGMAP_NAME} not found")
            return None

        if r.status_code != 200:
            logger.error(f"Failed to get ConfigMap: {r.status_code}")
            return None

        configmap_data = r.json()
        config_json = configmap_data.get("data", {}).get("model-config.json", "{}")
        config = json.loads(config_json)
        logger.debug(f"Loaded {len(config)} models from ConfigMap")
        return config

    except Exception as e:
        logger.error(f"Error loading ConfigMap: {e}")
        return None


def create_configmap_from_defaults(default_config: Dict[str, Any]) -> bool:
    """
    Create ConfigMap from default configuration.

    This is called only if ConfigMap doesn't exist.
    The ConfigMap is NOT managed by Helm and will persist across upgrades.

    Args:
        default_config: Default model configuration from env var

    Returns:
        True if successful, False otherwise
    """
    try:
        ns = os.getenv("NAMESPACE", "")
        if not ns:
            logger.error("Cannot create ConfigMap: NAMESPACE not set")
            return False

        configmap_payload = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": CONFIGMAP_NAME,
                "namespace": ns,
                "labels": {
                    "app.kubernetes.io/name": "mcp-server",
                    "app.kubernetes.io/component": "model-config",
                    "app.kubernetes.io/managed-by": "mcp-server"  # NOT helm!
                },
                "annotations": {
                    "config.kubernetes.io/created-by": "mcp-server",
                    "config.kubernetes.io/created-at": datetime.utcnow().isoformat() + "Z",
                    "config.kubernetes.io/description": (
                        "User-managed AI model configuration. "
                        "This ConfigMap is not managed by Helm and will persist across upgrades."
                    )
                }
            },
            "data": {
                "model-config.json": json.dumps(default_config, indent=2)
            }
        }

        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/configmaps"
        headers = _get_k8s_headers()
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        r = requests.post(url, headers=headers, json=configmap_payload, timeout=10, verify=verify)

        if r.status_code not in (200, 201):
            logger.error(f"Failed to create ConfigMap: {r.status_code} {r.text}")
            return False

        logger.info(f"Created ConfigMap {CONFIGMAP_NAME} from defaults with {len(default_config)} models")
        return True

    except Exception as e:
        logger.error(f"Error creating ConfigMap: {e}")
        return False


def load_runtime_model_config() -> Dict[str, Any]:
    """
    Load model configuration with ConfigMap-first priority.

    Loading strategy:
    1. Try to load from ConfigMap (user-managed, persists across Helm upgrades)
    2. If ConfigMap doesn't exist, create it from MODEL_CONFIG defaults
    3. If creation fails, fall back to defaults from env var

    Returns:
        Model configuration dict
    """
    # Load defaults from environment variable
    default_config = load_model_config_from_env()

    # Try to load from ConfigMap
    configmap_config = load_model_config_from_configmap()

    if configmap_config is not None:
        # ConfigMap exists, use it as source of truth
        logger.debug(f"Using ConfigMap as model config source ({len(configmap_config)} models)")
        return configmap_config
    else:
        # ConfigMap doesn't exist, try to create it from defaults
        logger.info("ConfigMap not found, creating from defaults")
        success = create_configmap_from_defaults(default_config)

        if success:
            # Return the newly created config
            return default_config
        else:
            # Fall back to env var defaults if creation failed
            logger.warning("ConfigMap creation failed, using env var defaults")
            return default_config


def get_model_config(force_refresh: bool = False) -> Dict[str, Any]:
    """
    Get current model configuration with optional refresh.

    Uses caching with TTL to avoid excessive ConfigMap reads.

    Args:
        force_refresh: If True, bypass cache and reload from ConfigMap

    Returns:
        Current model configuration dict
    """
    global _runtime_config, _config_last_updated

    with _config_lock:
        now = datetime.now()

        # Check if we need to refresh
        should_refresh = (
            force_refresh or
            _runtime_config is None or
            _config_last_updated is None or
            (now - _config_last_updated).total_seconds() > _config_cache_ttl_seconds
        )

        if should_refresh:
            logger.debug("Refreshing model configuration")
            _runtime_config = load_runtime_model_config()
            _config_last_updated = now
            logger.info(f"Model configuration refreshed: {len(_runtime_config)} models")

        return _runtime_config


def reload_model_config() -> None:
    """Force reload model configuration from ConfigMap, bypassing cache."""
    logger.info("Force reloading model configuration")
    get_model_config(force_refresh=True)


def get_default_models() -> Dict[str, Any]:
    """
    Get default models from MODEL_CONFIG env var.

    Useful for showing users which models are pre-configured vs. custom.

    Returns:
        Default model configuration from env var
    """
    return load_model_config_from_env()
