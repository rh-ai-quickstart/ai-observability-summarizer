"""
Tests for Model Configuration Tools (MCP Tools)

Tests cover:
- list_provider_models
- add_model_to_config
- update_maas_model_api_key (NEW)
"""

import json
import pytest
from unittest.mock import patch, Mock, MagicMock
import base64

from src.mcp_server.tools.model_config_tools import (
    list_provider_models,
    add_model_to_config,
    update_maas_model_api_key,
    _save_maas_model_api_key,
)


def _parse_mcp_response(response):
    """Helper to parse MCP text response format"""
    if isinstance(response, list):
        # MCP response format: [{"type": "text", "text": "..."}]
        if len(response) > 0 and "text" in response[0]:
            text = response[0]["text"]
            # Try to parse as JSON, if it fails return the text as-is
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                # Return text wrapped in error object for consistency
                return {"success": False, "message": text}
    elif isinstance(response, dict):
        if "text" in response:
            try:
                return json.loads(response["text"])
            except json.JSONDecodeError:
                return {"success": False, "message": response["text"]}
        return response
    elif isinstance(response, str):
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return {"success": False, "message": response}
    return response


class TestListProviderModels:
    """Test list_provider_models function"""

    def test_list_maas_models_returns_curated_list(self):
        """Test that MAAS returns curated model list without API key"""
        result = list_provider_models(provider="maas")
        data = _parse_mcp_response(result)

        assert data["provider"] == "maas"
        assert "models" in data
        assert len(data["models"]) > 0
        assert data["models"][0]["id"] == "qwen3-14b"

    @patch("src.mcp_server.tools.model_config_tools.requests.get")
    def test_list_openai_models_success(self, mock_get):
        """Test successful OpenAI model listing"""
        # Mock OpenAI API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {"id": "gpt-4o", "created": 1234567890, "owned_by": "openai"},
                {"id": "gpt-3.5-turbo", "created": 1234567890, "owned_by": "openai"},
                {"id": "text-embedding-ada-002", "created": 1234567890, "owned_by": "openai"},  # Should be filtered
            ]
        }
        mock_get.return_value = mock_response

        result = list_provider_models(provider="openai", api_key="test-key")
        data = _parse_mcp_response(result)

        assert data["provider"] == "openai"
        assert len(data["models"]) == 2  # Embedding model should be filtered
        assert any(m["id"] == "gpt-4o" for m in data["models"])

    @patch("src.mcp_server.tools.model_config_tools.requests.get")
    def test_list_openai_models_invalid_key(self, mock_get):
        """Test OpenAI with invalid API key"""
        mock_response = Mock()
        mock_response.status_code = 401
        mock_get.return_value = mock_response

        result = list_provider_models(provider="openai", api_key="invalid-key")
        data = _parse_mcp_response(result)

        assert data["error"] is True
        assert "Invalid OpenAI API key" in data["message"]

    def test_list_provider_models_missing_provider(self):
        """Test with missing provider parameter"""
        result = list_provider_models(provider="")
        data = _parse_mcp_response(result)

        assert data["error"] is True
        assert "provider is required" in data["message"]

    @patch("src.mcp_server.tools.model_config_tools._get_api_key_from_secret")
    def test_list_provider_models_no_api_key(self, mock_secret):
        """Test listing models when API key not found in secret"""
        mock_secret.return_value = None

        result = list_provider_models(provider="openai")
        data = _parse_mcp_response(result)

        assert data["error"] is True
        assert "API key not found" in data["message"]


class TestUpdateMaasModelApiKey:
    """Test update_maas_model_api_key function"""

    @patch("core.model_config_manager.reload_model_config")
    @patch("src.mcp_server.tools.model_config_tools._get_k8s_headers")
    @patch("os.path.exists")
    @patch("src.mcp_server.tools.model_config_tools.requests.patch")
    @patch("src.mcp_server.tools.model_config_tools._save_maas_model_api_key")
    @patch("core.model_config_manager.get_model_config")
    @patch("os.getenv")
    def test_update_maas_api_key_success(
        self, mock_getenv, mock_get_config, mock_save_key, mock_patch,
        mock_exists, mock_headers, mock_reload
    ):
        """Test successful MAAS model API key update"""
        # Setup mocks
        mock_getenv.return_value = "test-namespace"
        mock_exists.return_value = True
        mock_headers.return_value = {"Authorization": "Bearer test-token"}
        mock_get_config.return_value = {
            "maas/qwen3-14b": {
                "provider": "maas",
                "modelName": "qwen3-14b",
                "apiUrl": "https://old-url.com/v1/chat/completions",
                "_metadata": {}
            }
        }
        mock_save_key.return_value = {"success": True, "message": "API key saved"}

        mock_response = Mock()
        mock_response.status_code = 200
        mock_patch.return_value = mock_response

        # Execute
        result = update_maas_model_api_key(
            model_id="qwen3-14b",
            api_key="new-test-key",
            api_url="https://new-url.com/v1"
        )
        data = _parse_mcp_response(result)

        # Verify
        assert data["success"] is True
        assert data["model_key"] == "maas/qwen3-14b"
        assert "updated successfully" in data["message"]
        mock_save_key.assert_called_once_with("qwen3-14b", "new-test-key")
        mock_patch.assert_called_once()  # ConfigMap was patched
        mock_reload.assert_called_once()  # Config reloaded

    @patch("src.mcp_server.tools.model_config_tools._save_maas_model_api_key")
    @patch("core.model_config_manager.get_model_config")
    @patch("os.getenv")
    def test_update_maas_api_key_only(
        self, mock_getenv, mock_get_config, mock_save_key
    ):
        """Test updating only API key without endpoint"""
        mock_getenv.return_value = "test-namespace"
        mock_get_config.return_value = {
            "maas/qwen3-14b": {
                "provider": "maas",
                "modelName": "qwen3-14b",
                "_metadata": {}
            }
        }
        mock_save_key.return_value = {"success": True, "message": "API key saved"}

        # Execute - no api_url provided
        result = update_maas_model_api_key(
            model_id="qwen3-14b",
            api_key="new-test-key"
        )
        data = _parse_mcp_response(result)

        # Verify
        assert data["success"] is True
        assert data["model_key"] == "maas/qwen3-14b"
        mock_save_key.assert_called_once()

    @patch("core.model_config_manager.get_model_config")
    def test_update_maas_model_not_found(self, mock_get_config):
        """Test updating non-existent model"""
        mock_get_config.return_value = {}

        result = update_maas_model_api_key(
            model_id="nonexistent-model",
            api_key="test-key"
        )
        data = _parse_mcp_response(result)

        assert data["success"] is False
        assert "not found in configuration" in data["message"]

    def test_update_maas_missing_model_id(self):
        """Test with missing model_id parameter"""
        result = update_maas_model_api_key(
            model_id="",
            api_key="test-key"
        )
        data = _parse_mcp_response(result)

        assert data["success"] is False
        assert "model_id and api_key are required" in data["message"]

    def test_update_maas_missing_api_key(self):
        """Test with missing api_key parameter"""
        result = update_maas_model_api_key(
            model_id="qwen3-14b",
            api_key=""
        )
        data = _parse_mcp_response(result)

        assert data["success"] is False
        assert "model_id and api_key are required" in data["message"]

    @patch("src.mcp_server.tools.model_config_tools._save_maas_model_api_key")
    @patch("core.model_config_manager.get_model_config")
    @patch("os.getenv")
    def test_update_maas_secret_save_failure(
        self, mock_getenv, mock_get_config, mock_save_key
    ):
        """Test handling of Secret update failure"""
        mock_getenv.return_value = "test-namespace"
        mock_get_config.return_value = {
            "maas/qwen3-14b": {
                "provider": "maas",
                "modelName": "qwen3-14b",
                "_metadata": {}
            }
        }
        mock_save_key.return_value = {
            "success": False,
            "error": "Failed to update secret: 403 Forbidden"
        }

        result = update_maas_model_api_key(
            model_id="qwen3-14b",
            api_key="new-test-key"
        )
        data = _parse_mcp_response(result)

        assert data["success"] is False
        assert "Failed to update MAAS API key" in data["message"]

    @patch("core.model_config_manager.reload_model_config")
    @patch("src.mcp_server.tools.model_config_tools._get_k8s_headers")
    @patch("os.path.exists")
    @patch("src.mcp_server.tools.model_config_tools.requests.patch")
    @patch("src.mcp_server.tools.model_config_tools._save_maas_model_api_key")
    @patch("core.model_config_manager.get_model_config")
    @patch("os.getenv")
    def test_update_maas_configmap_update_failure(
        self, mock_getenv, mock_get_config, mock_save_key, mock_patch,
        mock_exists, mock_headers, mock_reload
    ):
        """Test handling of ConfigMap update failure"""
        mock_getenv.return_value = "test-namespace"
        mock_exists.return_value = True
        mock_headers.return_value = {"Authorization": "Bearer test-token"}
        mock_get_config.return_value = {
            "maas/qwen3-14b": {
                "provider": "maas",
                "modelName": "qwen3-14b",
                "apiUrl": "https://old-url.com/v1",
                "_metadata": {}
            }
        }
        mock_save_key.return_value = {"success": True, "message": "API key saved"}

        # ConfigMap update fails
        mock_response = Mock()
        mock_response.status_code = 403
        mock_patch.return_value = mock_response

        result = update_maas_model_api_key(
            model_id="qwen3-14b",
            api_key="new-test-key",
            api_url="https://new-url.com/v1"
        )
        data = _parse_mcp_response(result)

        # API key was updated successfully, but endpoint update failed
        assert data["success"] is True
        assert "warning" in data
        assert "endpoint update failed" in data["warning"]
        mock_reload.assert_not_called()  # Should not reload if ConfigMap update failed

    @patch("src.mcp_server.tools.model_config_tools._save_maas_model_api_key")
    @patch("core.model_config_manager.get_model_config")
    @patch("os.getenv")
    def test_update_maas_with_maas_prefix(
        self, mock_getenv, mock_get_config, mock_save_key
    ):
        """Test that maas/ prefix is handled correctly"""
        mock_getenv.return_value = "test-namespace"
        mock_get_config.return_value = {
            "maas/qwen3-14b": {
                "provider": "maas",
                "modelName": "qwen3-14b",
                "_metadata": {}
            }
        }
        mock_save_key.return_value = {"success": True, "message": "API key saved"}

        # Pass model_id with maas/ prefix
        result = update_maas_model_api_key(
            model_id="maas/qwen3-14b",
            api_key="new-test-key"
        )
        data = _parse_mcp_response(result)

        # Should still work - prefix is stripped
        assert data["success"] is True
        assert data["model_key"] == "maas/qwen3-14b"
        # Secret field should not have maas/ prefix
        mock_save_key.assert_called_once_with("qwen3-14b", "new-test-key")

    @patch("core.model_config_manager.reload_model_config")
    @patch("src.mcp_server.tools.model_config_tools._get_k8s_headers")
    @patch("os.path.exists")
    @patch("src.mcp_server.tools.model_config_tools.requests.patch")
    @patch("src.mcp_server.tools.model_config_tools._save_maas_model_api_key")
    @patch("core.model_config_manager.get_model_config")
    @patch("os.getenv")
    def test_update_maas_endpoint_normalization(
        self, mock_getenv, mock_get_config, mock_save_key, mock_patch,
        mock_exists, mock_headers, mock_reload
    ):
        """Test that endpoint URL is normalized correctly"""
        mock_getenv.return_value = "test-namespace"
        mock_exists.return_value = True
        mock_headers.return_value = {"Authorization": "Bearer test-token"}
        mock_get_config.return_value = {
            "maas/qwen3-14b": {
                "provider": "maas",
                "modelName": "qwen3-14b",
                "apiUrl": "https://old-url.com/v1",
                "_metadata": {}
            }
        }
        mock_save_key.return_value = {"success": True, "message": "API key saved"}

        mock_response = Mock()
        mock_response.status_code = 200
        mock_patch.return_value = mock_response

        # Provide URL without /chat/completions
        result = update_maas_model_api_key(
            model_id="qwen3-14b",
            api_key="new-test-key",
            api_url="https://new-url.com/v1"
        )
        data = _parse_mcp_response(result)

        assert data["success"] is True

        # Verify the ConfigMap was updated with normalized URL
        call_args = mock_patch.call_args
        patch_payload = call_args.kwargs["json"]
        config_json = patch_payload["data"]["model-config.json"]
        config = json.loads(config_json)

        # Should have /chat/completions appended
        assert config["maas/qwen3-14b"]["apiUrl"] == "https://new-url.com/v1/chat/completions"


class TestSaveMaasModelApiKey:
    """Test _save_maas_model_api_key helper function"""

    @patch("src.mcp_server.tools.model_config_tools.requests.patch")
    @patch("src.mcp_server.tools.model_config_tools.requests.get")
    @patch("src.mcp_server.tools.model_config_tools._get_k8s_headers")
    @patch("os.path.exists")
    @patch("os.getenv")
    def test_save_api_key_update_existing_secret(
        self, mock_getenv, mock_exists, mock_headers, mock_get, mock_patch
    ):
        """Test updating API key in existing Secret"""
        mock_getenv.return_value = "test-namespace"
        mock_exists.return_value = True
        mock_headers.return_value = {"Authorization": "Bearer test-token"}

        # Mock GET - secret exists
        get_response = Mock()
        get_response.status_code = 200
        get_response.json.return_value = {
            "data": {
                "other-model": base64.b64encode(b"old-key").decode()
            }
        }
        mock_get.return_value = get_response

        # Mock PATCH - update succeeds
        patch_response = Mock()
        patch_response.status_code = 200
        mock_patch.return_value = patch_response

        result = _save_maas_model_api_key("qwen3-14b", "new-api-key")

        assert result["success"] is True
        mock_patch.assert_called_once()

        # Verify PATCH payload
        call_args = mock_patch.call_args
        patch_data = call_args.kwargs["json"]["data"]
        assert "qwen3-14b" in patch_data
        decoded_key = base64.b64decode(patch_data["qwen3-14b"]).decode()
        assert decoded_key == "new-api-key"

    @patch("src.mcp_server.tools.model_config_tools.requests.post")
    @patch("src.mcp_server.tools.model_config_tools.requests.get")
    @patch("src.mcp_server.tools.model_config_tools._get_k8s_headers")
    @patch("os.path.exists")
    @patch("os.getenv")
    def test_save_api_key_create_new_secret(
        self, mock_getenv, mock_exists, mock_headers, mock_get, mock_post
    ):
        """Test creating new Secret when it doesn't exist"""
        mock_getenv.return_value = "test-namespace"
        mock_exists.return_value = True
        mock_headers.return_value = {"Authorization": "Bearer test-token"}

        # Mock GET - secret doesn't exist
        get_response = Mock()
        get_response.status_code = 404
        mock_get.return_value = get_response

        # Mock POST - create succeeds
        post_response = Mock()
        post_response.status_code = 201
        mock_post.return_value = post_response

        result = _save_maas_model_api_key("qwen3-14b", "new-api-key")

        assert result["success"] is True
        mock_post.assert_called_once()

        # Verify POST payload
        call_args = mock_post.call_args
        secret_payload = call_args.kwargs["json"]
        assert secret_payload["metadata"]["name"] == "ai-maas-credentials"
        assert "qwen3-14b" in secret_payload["data"]

    @patch("os.getenv")
    def test_save_api_key_no_namespace(self, mock_getenv):
        """Test when NAMESPACE is not set"""
        mock_getenv.return_value = ""

        result = _save_maas_model_api_key("qwen3-14b", "new-api-key")

        assert result["success"] is False
        assert "NAMESPACE not set" in result["error"]

    @patch("src.mcp_server.tools.model_config_tools.requests.patch")
    @patch("src.mcp_server.tools.model_config_tools.requests.get")
    @patch("src.mcp_server.tools.model_config_tools._get_k8s_headers")
    @patch("os.path.exists")
    @patch("os.getenv")
    def test_save_api_key_patch_failure(
        self, mock_getenv, mock_exists, mock_headers, mock_get, mock_patch
    ):
        """Test handling of Secret PATCH failure"""
        mock_getenv.return_value = "test-namespace"
        mock_exists.return_value = True
        mock_headers.return_value = {"Authorization": "Bearer test-token"}

        # Secret exists
        get_response = Mock()
        get_response.status_code = 200
        get_response.json.return_value = {"data": {}}
        mock_get.return_value = get_response

        # PATCH fails with 403
        patch_response = Mock()
        patch_response.status_code = 403
        mock_patch.return_value = patch_response

        result = _save_maas_model_api_key("qwen3-14b", "new-api-key")

        assert result["success"] is False
        assert "Failed to update secret" in result["error"]


class TestAddModelToConfig:
    """Test add_model_to_config function"""

    @patch("core.model_config_manager.reload_model_config")
    @patch("src.mcp_server.tools.model_config_tools._get_k8s_headers")
    @patch("os.path.exists")
    @patch("src.mcp_server.tools.model_config_tools.requests.patch")
    @patch("src.mcp_server.tools.model_config_tools._save_maas_model_api_key")
    @patch("core.model_config_manager.get_model_config")
    @patch("os.getenv")
    def test_add_maas_model_success(
        self, mock_getenv, mock_get_config, mock_save_key, mock_patch,
        mock_exists, mock_headers, mock_reload
    ):
        """Test successfully adding a MAAS model"""
        mock_getenv.return_value = "test-namespace"
        mock_exists.return_value = True
        mock_headers.return_value = {"Authorization": "Bearer test-token"}
        mock_get_config.return_value = {}
        mock_save_key.return_value = {"success": True, "message": "API key saved"}

        mock_response = Mock()
        mock_response.status_code = 200
        mock_patch.return_value = mock_response

        result = add_model_to_config(
            provider="maas",
            model_id="qwen3-14b",
            api_key="test-key",
            api_url="https://maas.example.com/v1"
        )
        data = _parse_mcp_response(result)

        assert data["success"] is True
        assert data["model_key"] == "maas/qwen3-14b"
        mock_save_key.assert_called_once()
        mock_patch.assert_called_once()
        mock_reload.assert_called_once()

    @patch("os.getenv")
    def test_add_maas_model_missing_api_key(self, mock_getenv):
        """Test adding MAAS model without API key"""
        # Need to mock NAMESPACE so we get past the namespace check
        # and reach the API key validation
        mock_getenv.return_value = "test-namespace"

        result = add_model_to_config(
            provider="maas",
            model_id="qwen3-14b"
        )
        data = _parse_mcp_response(result)

        assert data["success"] is False
        assert "MAAS models require an API key" in data["message"]

    @patch("core.model_config_manager.reload_model_config")
    @patch("src.mcp_server.tools.model_config_tools._get_k8s_headers")
    @patch("os.path.exists")
    @patch("src.mcp_server.tools.model_config_tools.requests.patch")
    @patch("core.model_config_manager.get_model_config")
    @patch("os.getenv")
    def test_add_openai_model_success(
        self, mock_getenv, mock_get_config, mock_patch,
        mock_exists, mock_headers, mock_reload
    ):
        """Test successfully adding an OpenAI model"""
        mock_getenv.return_value = "test-namespace"
        mock_exists.return_value = True
        mock_headers.return_value = {"Authorization": "Bearer test-token"}
        mock_get_config.return_value = {}

        mock_response = Mock()
        mock_response.status_code = 200
        mock_patch.return_value = mock_response

        result = add_model_to_config(
            provider="openai",
            model_id="gpt-4o",
            description="GPT-4 Optimized"
        )
        data = _parse_mcp_response(result)

        assert data["success"] is True
        assert data["model_key"] == "openai/gpt-4o"
        mock_patch.assert_called_once()
        mock_reload.assert_called_once()
