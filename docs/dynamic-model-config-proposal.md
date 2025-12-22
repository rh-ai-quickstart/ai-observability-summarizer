# Dynamic Model Configuration Management - Proposal

## Problem Statement

The current implementation has critical limitations:

1. **Loss of User Data**: The `ai-model-config` ConfigMap is managed by Helm. When users add models via the console plugin, these are stored in the ConfigMap. Any Helm release update overwrites the ConfigMap, losing all user-added models.

2. **No Runtime Updates**: The `MODEL_CONFIG` is loaded from an environment variable at pod startup and cached in memory. Changes to the ConfigMap don't take effect until the pod restarts.

3. **Inconsistent Data Sources**:
   - `list_summarization_models` reads from cached `MODEL_CONFIG` env var
   - `get_current_model_config` reads directly from ConfigMap
   - This creates inconsistency between different parts of the system

4. **Tight Coupling**: Model configuration is tightly coupled to the Helm chart, making it difficult to manage models independently of infrastructure updates.

## Proposed Solution

### High-Level Architecture

Implement a **two-tier model configuration system**:

1. **Default Models** (from `MODEL_CONFIG` env var): Pre-validated, curated models bundled with the application
2. **Runtime Models** (from ConfigMap): User-added models managed dynamically at runtime

The system should:
- Use `MODEL_CONFIG` env var as the source for default/template configuration
- Check for an existing `ai-model-config` ConfigMap at runtime
- If ConfigMap exists, use it as the source of truth
- If ConfigMap doesn't exist, create it from `MODEL_CONFIG` defaults
- Support dynamic reloading when the ConfigMap changes
- Ensure all MCP tools read from the same runtime configuration source

### Key Design Principles

1. **ConfigMap as Source of Truth**: Once created, the ConfigMap becomes the runtime source of truth
2. **Env Var as Template**: MODEL_CONFIG provides the initial defaults and schema
3. **Helm Hands-Off**: Helm does NOT manage the ConfigMap after initial deployment
4. **Dynamic Refresh**: Configuration updates without pod restarts
5. **Consistency**: All tools (list_summarization_models, get_current_model_config) use same source

### Detailed Design

#### 1. Configuration Manager Module

Create `src/core/model_config_manager.py`:

```python
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
```

#### 2. Update Core Configuration

Modify `src/core/config.py`:

```python
# Remove the global MODEL_CONFIG variable
# OLD: MODEL_CONFIG = load_model_config()

# Add import for new config manager
from core.model_config_manager import get_model_config, get_default_models

# Keep load_model_config for backward compatibility during transition
def load_model_config() -> Dict[str, Any]:
    """
    DEPRECATED: Use get_model_config() from model_config_manager instead.

    This function is kept for backward compatibility.
    """
    import warnings
    warnings.warn(
        "load_model_config() is deprecated, use get_model_config() from model_config_manager",
        DeprecationWarning,
        stacklevel=2
    )
    return get_model_config()
```

#### 3. Update MCP Tools

Modify `src/mcp_server/tools/observability_vllm_tools.py`:

```python
def list_summarization_models() -> List[Dict[str, Any]]:
    """List available summarization models from runtime configuration."""
    try:
        # Use runtime config instead of cached MODEL_CONFIG
        from core.model_config_manager import get_model_config
        from core.config import RAG_AVAILABLE

        config = get_model_config()  # Auto-refreshes if stale

        if not config:
            if not RAG_AVAILABLE:
                return make_mcp_text_response(
                    "No summarization models available. RAG infrastructure is not installed. "
                    "Please configure external models (Anthropic, OpenAI, Google) with API keys."
                )
            return make_mcp_text_response("No summarization models configured.")

        # Filter models based on RAG availability
        available_models = []
        for name, model_config in config.items():
            is_external = model_config.get("external", True)
            if not is_external and not RAG_AVAILABLE:
                continue
            available_models.append((name, model_config))

        # Sort: internal first, then external
        available_models.sort(key=lambda x: x[1].get("external", True))
        model_names = [name for name, _ in available_models]

        content_lines = [f"• {name}" for name in model_names]
        content = f"Available Summarization Models ({len(model_names)} total):\n\n" + "\n".join(content_lines)
        return make_mcp_text_response(content)

    except Exception as e:
        error = MCPException(
            message=f"Failed to list summarization models: {str(e)}",
            error_code=MCPErrorCode.CONFIGURATION_ERROR,
            recovery_suggestion="Ensure model configuration is valid."
        )
        return error.to_mcp_response()
```

Modify `src/mcp_server/tools/model_config_tools.py`:

```python
def get_current_model_config() -> List[Dict[str, Any]]:
    """
    Retrieve current model configuration from runtime config.

    This reads from the ConfigMap-backed runtime configuration,
    ensuring consistency with list_summarization_models.

    Returns:
        MCP response with current model configuration as JSON object
    """
    try:
        logger.info("Retrieving current model configuration")

        from core.model_config_manager import get_model_config

        config = get_model_config()  # Auto-refreshes if stale

        logger.info(f"Retrieved model configuration with {len(config)} models")
        return make_mcp_text_response(json.dumps(config))

    except Exception as e:
        logger.error(f"Error retrieving model config: {e}")
        err = MCPException(
            message=f"Failed to retrieve model config: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
        )
        return err.to_mcp_response()


def add_model_to_config(
    provider: str,
    model_id: str,
    model_name: Optional[str] = None,
    description: Optional[str] = None,
    context_length: Optional[int] = None,
    cost_prompt_rate: Optional[float] = None,
    cost_output_rate: Optional[float] = None
) -> List[Dict[str, Any]]:
    """
    Add a new model to runtime configuration by updating ConfigMap.

    After successful update, the runtime config is automatically refreshed.

    Args:
        provider: Provider name
        model_id: Model identifier (e.g., 'gpt-4o-mini')
        model_name: Display name for the model (optional)
        description: Optional description
        context_length: Max tokens (optional)
        cost_prompt_rate: Cost per input token (optional)
        cost_output_rate: Cost per output token (optional)

    Returns:
        MCP response with result
    """
    try:
        logger.info(f"Adding model to config: {provider}/{model_id}")

        if not provider or not model_id:
            raise MCPException(
                message="provider and model_id are required",
                error_code=MCPErrorCode.INVALID_INPUT,
            )

        provider_lower = provider.lower()
        ns = os.getenv("NAMESPACE", "")
        if not ns:
            raise MCPException(
                message="Server namespace not detected; cannot update ConfigMap",
                error_code=MCPErrorCode.INTERNAL_ERROR,
            )

        # Generate model key
        model_key = f"{provider_lower}/{model_id}"

        # Build model config object
        api_url = _provider_api_url(provider_lower)
        if provider_lower == "google":
            api_url = f"{api_url}/models/{model_id}:generateContent"
        elif provider_lower in ["openai", "anthropic", "meta"]:
            if provider_lower == "openai":
                api_url = f"{api_url}/chat/completions"

        model_config = {
            "external": True,
            "requiresApiKey": True,
            "serviceName": None,
            "provider": provider_lower,
            "apiUrl": api_url,
            "modelName": model_id,
            "cost": {
                "prompt_rate": cost_prompt_rate if cost_prompt_rate is not None else 0.0,
                "output_rate": cost_output_rate if cost_output_rate is not None else 0.0,
            },
            "_metadata": {
                "source": "user",
                "addedBy": "console-plugin",
                "addedAt": datetime.utcnow().isoformat() + "Z"
            }
        }

        if description:
            model_config["description"] = description
        if context_length:
            model_config["context_length"] = context_length

        # Get current config from ConfigMap
        from core.model_config_manager import get_model_config
        current_config = get_model_config(force_refresh=True)

        # Add/update model in config
        current_config[model_key] = model_config

        # Update ConfigMap
        configmap_name = "ai-model-config"
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/configmaps/{configmap_name}"
        headers = _get_k8s_headers()
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        configmap_payload = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": configmap_name,
                "namespace": ns,
                "labels": {
                    "app.kubernetes.io/name": "mcp-server",
                    "app.kubernetes.io/component": "model-config",
                    "app.kubernetes.io/managed-by": "mcp-server"
                },
                "annotations": {
                    "config.kubernetes.io/last-modified": datetime.utcnow().isoformat() + "Z"
                }
            },
            "data": {
                "model-config.json": json.dumps(current_config, indent=2)
            }
        }

        r = requests.put(url, headers=headers, json=configmap_payload, timeout=10, verify=verify)

        if r.status_code not in (200, 201):
            raise MCPException(
                message=f"Failed to update ConfigMap {configmap_name}: {r.status_code} {r.text}",
                error_code=MCPErrorCode.KUBERNETES_API_ERROR,
            )

        # Force refresh runtime config to pick up new model immediately
        from core.model_config_manager import reload_model_config
        reload_model_config()

        result = {
            "success": True,
            "model_key": model_key,
            "configmap_name": configmap_name,
            "namespace": ns,
            "status": "updated",
            "message": f"Model {model_key} added successfully and configuration reloaded."
        }
        logger.info(f"Model {model_key} added to ConfigMap and runtime config refreshed")
        return make_mcp_text_response(json.dumps(result))

    except MCPException as e:
        return e.to_mcp_response()
    except Exception as e:
        error = MCPException(
            message=f"Failed to add model: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
        )
        return error.to_mcp_response()
```

#### 4. Helm Chart Changes

**Remove ConfigMap Template:**

Delete `deploy/helm/mcp-server/templates/configmap-model-config.yaml`.

The ConfigMap will be created dynamically by the MCP server on first run.

**Update Deployment to Use Env Var:**

In `deploy/helm/mcp-server/templates/deployment.yaml`, the MODEL_CONFIG env var remains:

```yaml
env:
  - name: MODEL_CONFIG
    value: |
{{ .Files.Get "model-config.json" | indent 6 }}
```

This provides the default/template configuration that will be used to create the ConfigMap on first run.

**Add Documentation ConfigMap (Optional):**

Create `deploy/helm/mcp-server/templates/configmap-readme.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-model-config-readme
  namespace: {{ .Release.Namespace }}
  labels:
    app.kubernetes.io/name: mcp-server
    app.kubernetes.io/component: documentation
data:
  README.md: |
    # AI Model Configuration Management

    ## Overview

    The `ai-model-config` ConfigMap stores user-managed AI model configurations.
    This ConfigMap is **NOT managed by Helm** and persists across upgrades.

    ## How It Works

    - **Defaults**: Default models are provided via the MODEL_CONFIG environment variable
    - **Runtime**: User-added models are stored in the ai-model-config ConfigMap
    - **Persistence**: The ConfigMap is created automatically on first run if it doesn't exist
    - **Upgrades**: The ConfigMap persists across Helm upgrades

    ## Management

    ### View Current Configuration
    ```bash
    kubectl get configmap ai-model-config -n {{ .Release.Namespace }} -o yaml
    ```

    ### Reset to Defaults
    To reset configuration to defaults, delete the ConfigMap and restart the MCP server:
    ```bash
    kubectl delete configmap ai-model-config -n {{ .Release.Namespace }}
    kubectl rollout restart deployment/mcp-server -n {{ .Release.Namespace }}
    ```

    The ConfigMap will be automatically recreated from defaults on next startup.

    ### Backup Configuration
    ```bash
    kubectl get configmap ai-model-config -n {{ .Release.Namespace }} -o json > ai-model-config-backup.json
    ```

    ### Restore Configuration
    ```bash
    kubectl apply -f ai-model-config-backup.json
    ```
```

### MCP Tool Summary

After this change, both MCP tools will use the same runtime configuration source:

| Tool | Purpose | Returns | Data Source |
|------|---------|---------|-------------|
| `list_summarization_models` | List available model names | Text response with bullet list | Runtime config (ConfigMap-backed) |
| `get_current_model_config` | Get full model configuration | JSON object with all model details | Runtime config (ConfigMap-backed) |

**Key Point**: Both tools now read from the same source (`get_model_config()` from `model_config_manager`), ensuring consistency. The ConfigMap is the source of truth, with automatic creation from MODEL_CONFIG env var if it doesn't exist.

### Benefits

1. **No Data Loss**: User-added models survive Helm upgrades
2. **Consistency**: All tools read from the same runtime configuration source
3. **No Downtime**: Configuration refreshes automatically without pod restarts (60s cache TTL)
4. **Clear Separation**: Default models (env var) vs. runtime models (ConfigMap)
5. **Safe Defaults**: ConfigMap auto-created from defaults on first run
6. **Simple Management**: Single source of truth (ConfigMap) after initialization

### Implementation Checklist

- [ ] Create `src/core/model_config_manager.py` with dynamic loading logic
- [ ] Update `src/core/config.py` to import from config manager
- [ ] Update `src/core/metrics.py` to use `get_model_config()`
- [ ] Update `src/mcp_server/tools/model_config_tools.py`:
  - [ ] Update `get_current_model_config()` to use runtime config
  - [ ] Update `add_model_to_config()` to reload after changes
- [ ] Update `src/mcp_server/tools/observability_vllm_tools.py`:
  - [ ] Update `list_summarization_models()` to use runtime config
- [ ] Remove `deploy/helm/mcp-server/templates/configmap-model-config.yaml`
- [ ] Add `deploy/helm/mcp-server/templates/configmap-readme.yaml` (optional)
- [ ] Add unit tests for `model_config_manager.py`
- [ ] Add integration tests for ConfigMap creation and updates
- [ ] Update documentation

### Testing Strategy

1. **Fresh Install**: Verify ConfigMap is created from MODEL_CONFIG defaults
2. **Add Model**: Verify model appears in both `list_summarization_models` and `get_current_model_config`
3. **Cache Refresh**: Verify config refreshes automatically after 60s
4. **Force Refresh**: Verify `reload_model_config()` works immediately
5. **Helm Upgrade**: Deploy with new helm chart, verify ConfigMap persists
6. **ConfigMap Deletion**: Delete ConfigMap, verify it's recreated from defaults
7. **Concurrent Access**: Verify thread-safe access with multiple requests

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| ConfigMap corruption | Fall back to MODEL_CONFIG env var; provide reset mechanism |
| Cache staleness | 60s TTL with force refresh option; immediate refresh after updates |
| Thread safety | Use `threading.RLock()` for cache access |
| Initial creation failure | Fall back to env var defaults; log warnings |
| Kubernetes API errors | Comprehensive error handling with fallback to cached values |

## Conclusion

This proposal provides a robust solution that:
- Eliminates data loss on Helm upgrades by removing ConfigMap from Helm management
- Enables dynamic configuration updates via 60s cache TTL
- Maintains consistency by having all tools read from same runtime source
- Provides clear separation between defaults (env var) and runtime config (ConfigMap)
- Keeps implementation relatively simple with a dedicated config manager module

The key insight is to use the ConfigMap as the runtime source of truth, with the MODEL_CONFIG env var serving as a template for initialization only.
