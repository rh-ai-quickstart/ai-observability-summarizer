from typing import Dict, Any, Optional, List
import os
import base64
import requests

from common.pylogger import get_python_logger
from mcp_server.exceptions import MCPException, MCPErrorCode
from core.response_utils import make_mcp_text_response

logger = get_python_logger()

K8S_SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
K8S_SA_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
K8S_API_URL = "https://kubernetes.default.svc"


def _provider_defaults(provider: str) -> Dict[str, str]:
    provider = (provider or "").lower()
    if provider == "openai":
        return {"endpoint": "https://api.openai.com/v1/models"}
    if provider == "anthropic":
        return {"endpoint": "https://api.anthropic.com/v1/messages"}
    if provider == "google":
        return {"endpoint": "https://generativelanguage.googleapis.com/v1beta/models"}
    if provider == "meta":
        return {"endpoint": "https://api.llama-api.com/v1/models"}
    return {"endpoint": ""}


def validate_api_key(provider: str, api_key: str, endpoint: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Validate an API key for a given provider by making a minimal request server-side.
    Returns structured MCP content with { success, details }.
    """
    try:
        logger.debug(f"ZZZZ Validating API key for provider: {provider} with API key: {api_key} and endpoint: {endpoint}")
        if not provider or not api_key:
            raise MCPException(
                message="provider and api_key are required",
                error_code=MCPErrorCode.INVALID_INPUT,
            )
        provider_lower = provider.lower()
        ep = endpoint or _provider_defaults(provider_lower)["endpoint"]
        timeout = 10
        ok = False
        details: Dict[str, Any] = {"provider": provider_lower, "endpoint": ep}

        if provider_lower == "openai":
            # GET /v1/models with Bearer token
            r = requests.get(ep, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout)
            ok = r.status_code in (200, 401, 403) and r.status_code != 401  # 401 indicates invalid
            details["status"] = r.status_code
        elif provider_lower == "anthropic":
            # Minimal chat call; accept 200 or 429 (rate limited) as valid
            r = requests.post(
                ep,
                headers={
                    "x-api-key": api_key,
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                },
                json={"model": "claude-3-haiku-20240307", "max_tokens": 1, "messages": [{"role": "user", "content": "hi"}]},
                timeout=timeout,
            )
            ok = r.status_code in (200, 429)
            details["status"] = r.status_code
        elif provider_lower == "google":
            # GET list models with key
            sep = "&" if "?" in ep else "?"
            r = requests.get(f"{ep}{sep}key={api_key}", timeout=timeout)
            ok = r.status_code == 200
            details["status"] = r.status_code
        elif provider_lower == "meta":
            # Generic GET; many gateways vary. Treat 200 as valid.
            r = requests.get(ep, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout)
            ok = r.status_code == 200
            details["status"] = r.status_code
        else:
            raise MCPException(
                message=f"Unsupported provider: {provider}",
                error_code=MCPErrorCode.INVALID_INPUT,
            )

        result = {"success": bool(ok), "details": details}
        logger.debug(f"ZZZZ validate_api_key Result: {result}")
        return make_mcp_text_response(json.dumps(result))
    except MCPException as e:
        return e.to_mcp_response()
    except Exception as e:
        err = MCPException(
            message=f"Validation failed: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
        )
        return err.to_mcp_response()


import json

def save_api_key(
    provider: str,
    api_key: str,
    model_id: Optional[str] = None,
    endpoint: Optional[str] = None,
    description: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Save or update provider API key in a namespaced Secret:
      name: ai-<provider>-credentials
      data: api-key (b64), provider, endpoint?, model-id?, description?
    """
    try:
        
        if not provider or not api_key:
            raise MCPException(
                message="provider and api_key are required",
                error_code=MCPErrorCode.INVALID_INPUT,
            )
        provider_lower = provider.lower()
        ns = os.getenv("NAMESPACE", "")
        if not ns:
            raise MCPException(
                message="Server namespace not detected; cannot save Secret",
                error_code=MCPErrorCode.INTERNAL_ERROR,
            )
        token = ""
        with open(K8S_SA_TOKEN_PATH, "r") as f:
            token = f.read().strip()
        if not token:
            raise MCPException(
                message="ServiceAccount token unavailable; cannot save Secret",
                error_code=MCPErrorCode.KUBERNETES_API_ERROR,
            )
        name = f"ai-{provider_lower}-credentials"
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/secrets/{name}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/merge-patch+json",
        }
        verify = K8S_SA_CA_PATH if os.path.exists(K8S_SA_CA_PATH) else True

        # Try PATCH existing Secret; if 404, create with POST
        payload = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": name, "namespace": ns, "labels": {"app.kubernetes.io/component": "ai-model-config"}},
            "type": "Opaque",
            "data": {
                "api-key": base64.b64encode(api_key.encode("utf-8")).decode("utf-8"),
                "provider": base64.b64encode(provider_lower.encode("utf-8")).decode("utf-8"),
            },
        }
        if endpoint:
            payload["data"]["endpoint"] = base64.b64encode(endpoint.encode("utf-8")).decode("utf-8")
        if model_id:
            payload["data"]["model-id"] = base64.b64encode(model_id.encode("utf-8")).decode("utf-8")
        if description:
            payload["data"]["description"] = base64.b64encode(description.encode("utf-8")).decode("utf-8")

        r = requests.patch(url, headers=headers, data=json.dumps(payload), timeout=5, verify=verify)
        status = "updated"
        if r.status_code == 404:
            # Create
            url_post = f"{K8S_API_URL}/api/v1/namespaces/{ns}/secrets"
            headers_post = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
            r = requests.post(url_post, headers=headers_post, data=json.dumps(payload), timeout=5, verify=verify)
            status = "created"

        if r.status_code not in (200, 201):
            logger.debug(f"ZZZZ save_api_key Failed to save Secret {name}: {r.status_code} {r.text}")
            raise MCPException(
                message=f"Failed to save Secret {name}: {r.status_code} {r.text}",
                error_code=MCPErrorCode.KUBERNETES_API_ERROR,
            )

        result = {"secret_name": name, "namespace": ns, "status": status}
        logger.debug(f"ZZZZ save_api_key Result: {result}")
        return make_mcp_text_response(json.dumps(result))
    except MCPException as e:
        logger.debug(f"ZZZZ save_api_key Exception: {e}")
        return e.to_mcp_response()
    except Exception as e:
        err = MCPException(
            message=f"Failed to save API key: {str(e)}",
            error_code=MCPErrorCode.INTERNAL_ERROR,
        )
        logger.debug(f"ZZZZ save_api_key Exception: {err}")
        return err.to_mcp_response()


