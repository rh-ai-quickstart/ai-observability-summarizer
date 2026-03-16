"""
MCP Tools for Model Configuration Management

This module provides tools for:
- Listing available models from AI providers
- Adding models to the configuration
- Retrieving current model configuration
"""

from typing import Dict, Any, Optional, List
import os
import json
import base64
import requests
from datetime import datetime

from common.pylogger import get_python_logger
from mcp_server.exceptions import MCPException, MCPErrorCode
from core.response_utils import make_mcp_text_response

logger = get_python_logger()

K8S_SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
K8S_SA_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
K8S_API_URL = "https://kubernetes.default.svc"


def _get_k8s_headers() -> Dict[str, str]:
    """Get Kubernetes API headers with service account token."""
    try:
        with open(K8S_SA_TOKEN_PATH, "r") as f:
            token = f.read().strip()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
    except Exception as e:
        raise MCPException(
            message=f"Failed to read service account token: {str(e)}",
            error_code=MCPErrorCode.KUBERNETES_API_ERROR,
        )


def _get_api_key_from_secret(provider: str) -> Optional[str]:
    """Retrieve API key from Kubernetes secret."""
    try:
        ns = os.getenv("NAMESPACE", "")
        if not ns:
            logger.warning("NAMESPACE not set, cannot retrieve API key from secret")
            return None

        secret_name = f"ai-{provider.lower()}-credentials"
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/secrets/{secret_name}"
        headers = _get_k8s_headers()
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        r = requests.get(url, headers=headers, timeout=5, verify=verify)
        if r.status_code == 404:
            logger.info(f"Secret {secret_name} not found")
            return None
        if r.status_code != 200:
            logger.warning(f"Failed to get secret {secret_name}: {r.status_code}")
            return None

        secret_data = r.json()
        api_key_b64 = secret_data.get("data", {}).get("api-key")
        if not api_key_b64:
            return None

        api_key = base64.b64decode(api_key_b64).decode("utf-8")
        return api_key
    except Exception as e:
        logger.warning(f"Error retrieving API key from secret: {e}")
        return None


def _provider_api_url(provider: str) -> str:
    """Get API URL for provider."""
    provider = (provider or "").lower()
    if provider == "openai":
        return "https://api.openai.com/v1"
    if provider == "anthropic":
        return "https://api.anthropic.com/v1/messages"
    if provider == "google":
        return "https://generativelanguage.googleapis.com/v1beta"
    if provider == "meta":
        return "https://api.llama-api.com/v1"
    if provider == "maas":
        # Allow MAAS URL to be configured via environment variable
        return os.getenv("MAAS_API_URL", "https://litellm-prod.apps.maas.redhatworkshops.io/v1")
    return ""


def _is_gpt5_model(model_id: str) -> bool:
    """Check if a model is GPT-5 or later (uses /v1/responses endpoint)."""
    if not model_id:
        return False
    model_lower = model_id.lower()
    # GPT-5 series models use the new /v1/responses endpoint
    # This includes: gpt-5, gpt-5.1, gpt-5.2, gpt-5-mini, gpt-5-nano, etc.
    return model_lower.startswith("gpt-5")


def _get_curated_maas_models() -> List[Dict[str, Any]]:
    """
    Get curated list of available MAAS models.

    Since MAAS requires per-model API keys, we cannot query a generic
    /models endpoint. Users must configure each model individually.
    """
    return [
        {
            "id": "qwen3-14b",
            "name": "Qwen 3 14B",
            "description": "Alibaba Qwen 14B parameter model for general-purpose tasks",
            "context_length": 32768,
        },
    ]


def _save_maas_model_api_key(secret_field: str, api_key: str) -> Dict[str, Any]:
    """
    Save API key for a specific MAAS model to ai-maas-credentials Secret.

    Args:
        secret_field: Field name in secret (e.g., "qwen3-14b")
        api_key: API key to save

    Returns:
        Success/error dict
    """
    try:
        ns = os.getenv("NAMESPACE", "")
        if not ns:
            return {"success": False, "error": "NAMESPACE not set"}

        secret_name = "ai-maas-credentials"
        get_url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/secrets/{secret_name}"
        create_url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/secrets"
        headers = _get_k8s_headers()
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        # Try to get existing secret
        secret_exists = False
        secret_data = {}
        try:
            r = requests.get(get_url, headers=headers, timeout=5, verify=verify)
            if r.status_code == 200:
                # Update existing secret
                secret = r.json()
                secret_data = secret.get("data", {})
                secret_exists = True
            elif r.status_code == 404:
                # Will create new secret
                logger.info(f"Secret {secret_name} does not exist, will create it")
            else:
                return {"success": False, "error": f"Failed to get secret: {r.status_code}"}
        except Exception as e:
            logger.warning(f"Error getting secret, will create new: {e}")

        # Add/update model's API key field
        secret_data[secret_field] = base64.b64encode(api_key.encode()).decode()

        if secret_exists:
            # Update existing secret using PATCH (strategic merge)
            patch_headers = headers.copy()
            patch_headers["Content-Type"] = "application/strategic-merge-patch+json"

            # Only send the data field to merge
            patch_payload = {
                "data": {
                    secret_field: secret_data[secret_field]
                }
            }

            r = requests.patch(get_url, headers=patch_headers, json=patch_payload, timeout=10, verify=verify)
            if r.status_code not in (200, 201):
                return {"success": False, "error": f"Failed to update secret: {r.status_code}"}
        else:
            # Create new secret using POST
            secret_payload = {
                "apiVersion": "v1",
                "kind": "Secret",
                "metadata": {
                    "name": secret_name,
                    "namespace": ns,
                    "labels": {
                        "app.kubernetes.io/name": "mcp-server",
                        "app.kubernetes.io/component": "model-credentials"
                    }
                },
                "type": "Opaque",
                "data": secret_data
            }

            r = requests.post(create_url, headers=headers, json=secret_payload, timeout=10, verify=verify)
            if r.status_code not in (200, 201):
                return {"success": False, "error": f"Failed to create secret: {r.status_code}"}

        logger.info(f"Successfully saved MAAS API key for model in field '{secret_field}'")
        return {"success": True, "message": f"API key saved for MAAS model"}

    except Exception as e:
        logger.error(f"Error saving MAAS API key: {e}")
        return {"success": False, "error": f"Failed to save API key: {str(e)}"}


def list_provider_models(
    provider: str,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Query provider API to list available models.

    Args:
        provider: Provider name (openai, anthropic, google, meta)
        api_key: API key for authentication (optional, reads from secret if not provided)
                 In dev mode, this is passed from browser session cache.
                 In production, this is retrieved from Kubernetes Secret.

    Returns:
        MCP response with list of available models and metadata
    """
    try:
        logger.info(f"Listing models for provider: {provider}")

        if not provider:
            error_result = {
                "error": True,
                "message": "provider is required",
                "models": []
            }
            return make_mcp_text_response(json.dumps(error_result))

        provider_lower = provider.lower()

        # MAAS: Return curated list immediately (no API key needed for listing)
        # MAAS uses per-model API keys, not a provider-level key
        if provider_lower == "maas":
            models = _get_curated_maas_models()
            result = {"models": models, "provider": provider_lower, "count": len(models)}
            logger.info(f"Returning {len(models)} curated MAAS models (no API key required)")
            return make_mcp_text_response(json.dumps(result))

        # Get API key: use provided key (dev mode) or retrieve from K8s Secret (production)
        if api_key:
            logger.info(f"Using provided API key for {provider_lower} (dev mode)")
        else:
            logger.info(f"Retrieving API key from K8s Secret for {provider_lower} (production mode)")
            api_key = _get_api_key_from_secret(provider_lower)
            if not api_key:
                error_result = {
                    "error": True,
                    "message": f"API key not found for provider {provider}. Please configure API key in the API Keys tab.",
                    "models": []
                }
                return make_mcp_text_response(json.dumps(error_result))

        models = []
        timeout = 10

        if provider_lower == "openai":
            # Query OpenAI models API
            url = "https://api.openai.com/v1/models"
            headers = {"Authorization": f"Bearer {api_key}"}
            r = requests.get(url, headers=headers, timeout=timeout)

            if r.status_code == 401:
                error_result = {
                    "error": True,
                    "message": "Invalid OpenAI API key. Please check your API key in the API Keys tab.",
                    "models": []
                }
                return make_mcp_text_response(json.dumps(error_result))
            if r.status_code != 200:
                error_result = {
                    "error": True,
                    "message": f"OpenAI API error: {r.status_code}. Please try again later.",
                    "models": []
                }
                return make_mcp_text_response(json.dumps(error_result))

            data = r.json()
            # Filter to chat models only - only include known valid GPT chat models
            valid_prefixes = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"]
            for model in data.get("data", []):
                model_id = model.get("id", "")
                # Only include models that start with known valid chat model prefixes
                # Exclude fine-tuned models (contain ':'), and non-chat models
                if any(model_id.startswith(prefix) for prefix in valid_prefixes) and ":" not in model_id:
                    # Further exclude specific non-chat models
                    if not any(x in model_id.lower() for x in ["instruct", "vision", "embedding", "tts", "whisper", "dall-e", "audio", "realtime"]):
                        models.append({
                            "id": model_id,
                            "name": model_id.upper().replace("-", " ").title(),
                            "created": model.get("created"),
                            "owned_by": model.get("owned_by"),
                        })

        elif provider_lower == "anthropic":
            # Query Anthropic models API
            # Using API version 2023-06-01 (stable version for models endpoint)
            try:
                url = "https://api.anthropic.com/v1/models"
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01"
                }
                r = requests.get(url, headers=headers, timeout=timeout)

                if r.status_code == 401:
                    error_result = {
                        "error": True,
                        "message": "Invalid Anthropic API key. Please check your API key in the API Keys tab.",
                        "models": []
                    }
                    return make_mcp_text_response(json.dumps(error_result))
                if r.status_code != 200:
                    error_result = {
                        "error": True,
                        "message": f"Anthropic API error: {r.status_code}. Please try again later.",
                        "models": []
                    }
                    return make_mcp_text_response(json.dumps(error_result))

                # Parse JSON response with error handling
                try:
                    data = r.json()
                except json.JSONDecodeError as e:
                    error_result = {
                        "error": True,
                        "message": f"Invalid JSON response from Anthropic API: {str(e)}",
                        "models": []
                    }
                    return make_mcp_text_response(json.dumps(error_result))

                # Filter to chat models only (type: "model") with field validation
                for model in data.get("data", []):
                    # Only include models of type "model" (excludes other types if any)
                    if model.get("type") == "model":
                        model_id = model.get("id")
                        # Validate required field - skip models without IDs
                        if not model_id:
                            logger.warning("Skipping Anthropic model with missing ID: %s", model)
                            continue

                        models.append({
                            "id": model_id,
                            "name": model.get("display_name") or model_id,
                            # Omit 'created' field - API returns string but UI expects number
                            # Field is optional and not currently used, avoiding type mismatch
                        })

            except requests.exceptions.Timeout:
                error_result = {
                    "error": True,
                    "message": "Connection to Anthropic API timed out. Please try again later.",
                    "models": []
                }
                return make_mcp_text_response(json.dumps(error_result))
            except requests.exceptions.ConnectionError as e:
                error_result = {
                    "error": True,
                    "message": f"Failed to connect to Anthropic API: {str(e)}",
                    "models": []
                }
                return make_mcp_text_response(json.dumps(error_result))
            except requests.exceptions.RequestException as e:
                error_result = {
                    "error": True,
                    "message": f"Anthropic API request failed: {str(e)}",
                    "models": []
                }
                return make_mcp_text_response(json.dumps(error_result))

        elif provider_lower == "google":
            # Query Google models API
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            r = requests.get(url, timeout=timeout)

            if r.status_code == 400 or r.status_code == 403:
                error_result = {
                    "error": True,
                    "message": "Invalid Google API key. Please check your API key in the API Keys tab.",
                    "models": []
                }
                return make_mcp_text_response(json.dumps(error_result))
            if r.status_code != 200:
                error_result = {
                    "error": True,
                    "message": f"Google API error: {r.status_code}. Please try again later.",
                    "models": []
                }
                return make_mcp_text_response(json.dumps(error_result))

            data = r.json()
            for model in data.get("models", []):
                name = model.get("name", "")
                # Extract model ID from full name (models/gemini-xxx)
                if name.startswith("models/"):
                    model_id = name[7:]  # Remove "models/" prefix
                    model_id_lower = model_id.lower()

                    # Filter to Gemini generative models only
                    # Include: gemini-* models that support text generation
                    # Exclude: embeddings, vision-only, code-only, experimental variants
                    if "gemini" in model_id_lower:
                        # Exclude non-chat models
                        exclude_keywords = ["embedding", "vision-only", "imagen", "code-only", "aqa"]
                        if not any(keyword in model_id_lower for keyword in exclude_keywords):
                            # Get supported generation methods to verify it supports text generation
                            supported_methods = model.get("supportedGenerationMethods", [])
                            # Only include if it supports generateContent (text generation)
                            if not supported_methods or "generateContent" in supported_methods:
                                models.append({
                                    "id": model_id,
                                    "name": model.get("displayName", model_id),
                                    "description": model.get("description", ""),
                                    "context_length": model.get("inputTokenLimit"),
                                })

        elif provider_lower == "meta":
            # Meta/Llama API - use curated list
            models = [
                {
                    "id": "llama-3.3-70b",
                    "name": "Llama 3.3 70B",
                    "description": "Latest Llama model, 70B parameters",
                    "context_length": 128000,
                },
                {
                    "id": "llama-3.1-70b",
                    "name": "Llama 3.1 70B",
                    "description": "Llama 3.1 with 70B parameters",
                    "context_length": 128000,
                },
                {
                    "id": "llama-3.1-8b",
                    "name": "Llama 3.1 8B",
                    "description": "Efficient 8B parameter model",
                    "context_length": 128000,
                },
                {
                    "id": "llama-2-70b",
                    "name": "Llama 2 70B",
                    "description": "Llama 2 with 70B parameters",
                    "context_length": 4096,
                },
                {
                    "id": "llama-2-13b",
                    "name": "Llama 2 13B",
                    "description": "Llama 2 with 13B parameters",
                    "context_length": 4096,
                },
            ]

        else:
            error_result = {
                "error": True,
                "message": f"Unsupported provider: {provider}",
                "models": []
            }
            return make_mcp_text_response(json.dumps(error_result))

        result = {"models": models, "provider": provider_lower, "count": len(models)}
        logger.info(f"Found {len(models)} models for provider {provider_lower}")
        return make_mcp_text_response(json.dumps(result))

    except Exception as e:
        logger.error(f"Error listing models: {e}")
        error_result = {
            "error": True,
            "message": f"Failed to list models: {str(e)}",
            "models": []
        }
        return make_mcp_text_response(json.dumps(error_result))


def add_model_to_config(
    provider: str,
    model_id: str,
    model_name: Optional[str] = None,
    description: Optional[str] = None,
    context_length: Optional[int] = None,
    cost_prompt_rate: Optional[float] = None,
    cost_output_rate: Optional[float] = None,
    api_url: Optional[str] = None,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Add a new model to MODEL_CONFIG by updating ConfigMap.

    Args:
        provider: Provider name
        model_id: Model identifier (e.g., 'gpt-4o-mini')
        model_name: Display name for the model (optional)
        description: Optional description
        context_length: Max tokens (optional)
        cost_prompt_rate: Cost per input token (optional)
        cost_output_rate: Cost per output token (optional)
        api_url: Custom API URL (required for MAAS, optional for others)
        api_key: API key (required for MAAS, not used for other providers)

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

        # Special handling for MAAS models
        if provider_lower == "maas":
            # MAAS requires per-model API key and URL
            if not api_key:
                raise MCPException(
                    message="MAAS models require an API key. Each MAAS model has unique credentials.",
                    error_code=MCPErrorCode.INVALID_INPUT,
                )
            if not api_url:
                # Use MAAS URL from environment variable or default
                api_url = os.getenv("MAAS_API_URL", "https://litellm-prod.apps.maas.redhatworkshops.io/v1")

            # Save API key to Secret (specific field for this model)
            secret_field = model_id.replace("maas/", "").strip()
            save_result = _save_maas_model_api_key(secret_field, api_key)
            if not save_result["success"]:
                raise MCPException(
                    message=f"Failed to save MAAS API key: {save_result.get('error', 'Unknown error')}",
                    error_code=MCPErrorCode.KUBERNETES_API_ERROR,
                )

        # Generate model key
        model_key = f"{provider_lower}/{model_id}"

        # Build model config object
        if provider_lower == "maas":
            # MAAS uses custom api_url provided by user
            # Normalize endpoint: only append /chat/completions if not already present
            normalized_url = api_url.rstrip('/')
            if not normalized_url.endswith('/chat/completions'):
                final_api_url = f"{normalized_url}/chat/completions"
            else:
                final_api_url = normalized_url
            secret_field = model_id.replace("maas/", "").strip()
            model_config = {
                "external": True,
                "requiresApiKey": True,
                "serviceName": None,
                "provider": provider_lower,
                "apiUrl": final_api_url,
                "modelName": model_id.replace("maas/", ""),
                "apiKeySecretField": secret_field,
                "cost": {
                    "prompt_rate": cost_prompt_rate if cost_prompt_rate is not None else 0.0,
                    "output_rate": cost_output_rate if cost_output_rate is not None else 0.0,
                },
                "_metadata": {
                    "source": "user",
                    "addedBy": "console-plugin",
                    "addedAt": datetime.utcnow().isoformat() + "Z",
                    "description": description or ""
                }
            }
        else:
            # Other providers use standard logic
            final_api_url = api_url if api_url else _provider_api_url(provider_lower)
            if provider_lower == "google":
                # Google uses specific endpoint format
                final_api_url = f"{final_api_url}/models/{model_id}:generateContent"
            elif provider_lower in ["openai", "anthropic", "meta"]:
                # OpenAI-compatible endpoint normalization (defensive)
                normalized_url = final_api_url.rstrip('/')
                if provider_lower == "openai":
                    # GPT-5 and later use the new /v1/responses endpoint
                    # GPT-4 and earlier use /v1/chat/completions
                    if _is_gpt5_model(model_id):
                        if not normalized_url.endswith('/responses'):
                            final_api_url = f"{normalized_url}/responses"
                        else:
                            final_api_url = normalized_url
                    else:
                        if not normalized_url.endswith('/chat/completions'):
                            final_api_url = f"{normalized_url}/chat/completions"
                        else:
                            final_api_url = normalized_url
                else:
                    # For meta and other OpenAI-compatible providers, use /chat/completions
                    if not normalized_url.endswith('/chat/completions'):
                        final_api_url = f"{normalized_url}/chat/completions"
                    else:
                        final_api_url = normalized_url

            model_config = {
                "external": True,
                "requiresApiKey": True,
                "serviceName": None,
                "provider": provider_lower,
                "apiUrl": final_api_url,
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

        # Get current config from runtime config manager (with force refresh)
        from core.model_config_manager import get_model_config
        current_config = get_model_config(force_refresh=True)

        # Add/update model in config
        current_config[model_key] = model_config

        # Update ConfigMap using PATCH (strategic merge)
        configmap_name = "ai-model-config"
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/configmaps/{configmap_name}"
        headers = _get_k8s_headers()
        headers["Content-Type"] = "application/strategic-merge-patch+json"
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        # Use strategic merge patch to update data and annotations
        patch_payload = {
            "metadata": {
                "annotations": {
                    "config.kubernetes.io/last-modified": datetime.utcnow().isoformat() + "Z"
                }
            },
            "data": {
                "model-config.json": json.dumps(current_config, indent=2)
            }
        }

        r = requests.patch(url, headers=headers, json=patch_payload, timeout=10, verify=verify)

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
        logger.error(f"Error adding model to config: {e}")
        err = MCPException(
            message=f"Failed to add model to config: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
        )
        return err.to_mcp_response()


def update_maas_model_api_key(
    model_id: str,
    api_key: str,
    api_url: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Update API key and optionally endpoint for an existing MAAS model.

    Args:
        model_id: Model identifier (e.g., 'qwen3-14b')
        api_key: New API key for the model
        api_url: Optional new endpoint URL

    Returns:
        MCP response with result
    """
    try:
        logger.info(f"Updating MAAS model API key: {model_id}")

        if not model_id or not api_key:
            raise MCPException(
                message="model_id and api_key are required",
                error_code=MCPErrorCode.INVALID_INPUT,
            )

        # Clean up model_id (remove maas/ prefix if present)
        clean_model_id = model_id.replace("maas/", "").strip()
        model_key = f"maas/{clean_model_id}"

        # Verify model exists in config
        from core.model_config_manager import get_model_config
        current_config = get_model_config(force_refresh=True)

        if model_key not in current_config:
            raise MCPException(
                message=f"Model {model_key} not found in configuration. Use Add Model to add it first.",
                error_code=MCPErrorCode.INVALID_INPUT,
            )

        # Update API key in Secret
        secret_field = clean_model_id
        save_result = _save_maas_model_api_key(secret_field, api_key)
        if not save_result["success"]:
            raise MCPException(
                message=f"Failed to update MAAS API key: {save_result.get('error', 'Unknown error')}",
                error_code=MCPErrorCode.KUBERNETES_API_ERROR,
            )

        # Update endpoint in ConfigMap if provided
        if api_url:
            ns = os.getenv("NAMESPACE", "")
            if not ns:
                raise MCPException(
                    message="Server namespace not detected; cannot update ConfigMap",
                    error_code=MCPErrorCode.INTERNAL_ERROR,
                )

            # Normalize endpoint URL
            normalized_url = api_url.rstrip('/')
            if not normalized_url.endswith('/chat/completions'):
                final_api_url = f"{normalized_url}/chat/completions"
            else:
                final_api_url = normalized_url

            # Update model config
            model_config = current_config[model_key]
            model_config["apiUrl"] = final_api_url
            model_config["_metadata"]["lastUpdated"] = datetime.utcnow().isoformat() + "Z"
            model_config["_metadata"]["updatedBy"] = "console-plugin"

            # Update ConfigMap
            configmap_name = "ai-model-config"
            url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/configmaps/{configmap_name}"
            headers = _get_k8s_headers()
            headers["Content-Type"] = "application/strategic-merge-patch+json"
            verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

            patch_payload = {
                "metadata": {
                    "annotations": {
                        "config.kubernetes.io/last-modified": datetime.utcnow().isoformat() + "Z"
                    }
                },
                "data": {
                    "model-config.json": json.dumps(current_config, indent=2)
                }
            }

            r = requests.patch(url, headers=headers, json=patch_payload, timeout=10, verify=verify)

            if r.status_code not in (200, 201):
                # API key was updated but endpoint update failed
                logger.warning(f"API key updated but endpoint update failed: {r.status_code}")
                result = {
                    "success": True,
                    "model_key": model_key,
                    "warning": f"API key updated successfully, but endpoint update failed: {r.status_code}",
                    "message": f"Model {model_key} API key updated (endpoint update failed)"
                }
                return make_mcp_text_response(json.dumps(result))

            # Force refresh runtime config
            from core.model_config_manager import reload_model_config
            reload_model_config()

        result = {
            "success": True,
            "model_key": model_key,
            "message": f"Model {model_key} updated successfully" + (" with new endpoint" if api_url else "")
        }
        logger.info(f"MAAS model {model_key} updated successfully")
        return make_mcp_text_response(json.dumps(result))

    except MCPException as e:
        return e.to_mcp_response()
    except Exception as e:
        logger.error(f"Error updating MAAS model: {e}")
        err = MCPException(
            message=f"Failed to update MAAS model: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
        )
        return err.to_mcp_response()


# get_current_model_config has been removed - use list_summarization_models instead
# The console plugin now uses list_summarization_models for both displaying models
# and checking for duplicates, providing a single source of truth.