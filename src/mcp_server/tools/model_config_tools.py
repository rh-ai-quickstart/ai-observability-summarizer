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
    return ""


def list_provider_models(
    provider: str,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Query provider API to list available models.

    Args:
        provider: Provider name (openai, anthropic, google, meta)
        api_key: API key for authentication (optional, reads from secret if not provided)

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

        # Get API key from secret if not provided
        if not api_key:
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
            valid_prefixes = ["gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"]
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
            # Anthropic doesn't have a public models list API
            # Return curated list of current models
            models = [
                {
                    "id": "claude-opus-4-5-20250929",
                    "name": "Claude Opus 4.5",
                    "description": "Most capable model for complex tasks",
                    "context_length": 200000,
                },
                {
                    "id": "claude-sonnet-4-5-20250929",
                    "name": "Claude Sonnet 4.5",
                    "description": "Balanced performance and speed",
                    "context_length": 200000,
                },
                {
                    "id": "claude-3-5-haiku-20241022",
                    "name": "Claude 3.5 Haiku",
                    "description": "Fast and efficient",
                    "context_length": 200000,
                },
                {
                    "id": "claude-opus-4-1-20250805",
                    "name": "Claude Opus 4.1",
                    "description": "Previous generation flagship",
                    "context_length": 200000,
                },
                {
                    "id": "claude-sonnet-4-20250514",
                    "name": "Claude Sonnet 4",
                    "description": "Previous generation balanced model",
                    "context_length": 200000,
                },
            ]

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
    cost_output_rate: Optional[float] = None
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
            # Google uses specific endpoint format
            api_url = f"{api_url}/models/{model_id}:generateContent"
        elif provider_lower in ["openai", "anthropic", "meta"]:
            # Standard chat completions endpoint
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
            }
        }

        if description:
            model_config["description"] = description
        if context_length:
            model_config["context_length"] = context_length

        # Get ConfigMap
        configmap_name = "ai-model-config"
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/configmaps/{configmap_name}"
        headers = _get_k8s_headers()
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        # Try to get existing ConfigMap
        r = requests.get(url, headers=headers, timeout=5, verify=verify)

        if r.status_code == 404:
            # ConfigMap doesn't exist, create it
            logger.info(f"Creating new ConfigMap: {configmap_name}")
            current_config = {}
        elif r.status_code == 200:
            # ConfigMap exists, read current config
            configmap_data = r.json()
            config_json = configmap_data.get("data", {}).get("model-config.json", "{}")
            current_config = json.loads(config_json)
        else:
            raise MCPException(
                message=f"Failed to get ConfigMap {configmap_name}: {r.status_code} {r.text}",
                error_code=MCPErrorCode.KUBERNETES_API_ERROR,
            )

        # Add/update model in config
        current_config[model_key] = model_config

        # Prepare ConfigMap payload
        configmap_payload = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": configmap_name,
                "namespace": ns,
                "labels": {
                    "app.kubernetes.io/name": "mcp-server",
                    "app.kubernetes.io/component": "model-config"
                },
                "annotations": {
                    "config.kubernetes.io/last-modified": datetime.utcnow().isoformat() + "Z"
                }
            },
            "data": {
                "model-config.json": json.dumps(current_config, indent=2)
            }
        }

        # Create or update ConfigMap
        if r.status_code == 404:
            # Create new ConfigMap
            create_url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/configmaps"
            r = requests.post(create_url, headers=headers, json=configmap_payload, timeout=10, verify=verify)
            status = "created"
        else:
            # Update existing ConfigMap
            r = requests.put(url, headers=headers, json=configmap_payload, timeout=10, verify=verify)
            status = "updated"

        if r.status_code not in (200, 201):
            raise MCPException(
                message=f"Failed to save ConfigMap {configmap_name}: {r.status_code} {r.text}",
                error_code=MCPErrorCode.KUBERNETES_API_ERROR,
            )

        result = {
            "success": True,
            "model_key": model_key,
            "configmap_name": configmap_name,
            "namespace": ns,
            "status": status,
            "message": f"Model {model_key} {status} successfully. Note: Backend pod restart may be required for changes to take effect."
        }
        logger.info(f"Model {model_key} {status} in ConfigMap")
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


def get_current_model_config() -> List[Dict[str, Any]]:
    """
    Retrieve current MODEL_CONFIG from ConfigMap.

    Returns:
        MCP response with current model configuration as JSON object
    """
    try:
        logger.info("Retrieving current model configuration")

        ns = os.getenv("NAMESPACE", "")
        if not ns:
            raise MCPException(
                message="Server namespace not detected; cannot read ConfigMap",
                error_code=MCPErrorCode.INTERNAL_ERROR,
            )

        configmap_name = "ai-model-config"
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/configmaps/{configmap_name}"
        headers = _get_k8s_headers()
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        r = requests.get(url, headers=headers, timeout=5, verify=verify)

        if r.status_code == 404:
            # ConfigMap doesn't exist yet, return empty config
            logger.info(f"ConfigMap {configmap_name} not found, returning empty config")
            return make_mcp_text_response("{}")

        if r.status_code != 200:
            raise MCPException(
                message=f"Failed to get ConfigMap {configmap_name}: {r.status_code} {r.text}",
                error_code=MCPErrorCode.KUBERNETES_API_ERROR,
            )

        configmap_data = r.json()
        config_json = configmap_data.get("data", {}).get("model-config.json", "{}")

        logger.info(f"Retrieved model configuration with {len(json.loads(config_json))} models")
        return make_mcp_text_response(config_json)

    except MCPException as e:
        return e.to_mcp_response()
    except Exception as e:
        logger.error(f"Error retrieving model config: {e}")
        err = MCPException(
            message=f"Failed to retrieve model config: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
        )
        return err.to_mcp_response()
