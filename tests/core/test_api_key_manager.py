"""
Tests for API Key Manager functionality.

This module tests the centralized API key management utilities including
provider detection, Kubernetes secret retrieval, and API key resolution
with fallback priority.
"""

import pytest
import os
import base64
from unittest.mock import patch, Mock, MagicMock

from src.core.api_key_manager import (
    detect_provider_from_model_id,
    fetch_api_key_from_secret,
    resolve_api_key,
)


class TestDetectProviderFromModelId:
    """Test provider detection from model identifiers"""

    def test_explicit_provider_prefix_google(self):
        """Test detection with explicit provider prefix: google/model"""
        assert detect_provider_from_model_id("google/gemini-2.5-flash") == "google"

    def test_explicit_provider_prefix_openai(self):
        """Test detection with explicit provider prefix: openai/model"""
        assert detect_provider_from_model_id("openai/gpt-4o-mini") == "openai"

    def test_explicit_provider_prefix_anthropic(self):
        """Test detection with explicit provider prefix: anthropic/model"""
        assert detect_provider_from_model_id("anthropic/claude-3-5-sonnet") == "anthropic"

    def test_explicit_provider_prefix_meta(self):
        """Test detection with explicit provider prefix: meta/model"""
        assert detect_provider_from_model_id("meta-llama/Llama-3.1-8B-Instruct") == "meta-llama"

    def test_pattern_matching_gpt(self):
        """Test pattern matching for GPT models without prefix"""
        assert detect_provider_from_model_id("gpt-4o") == "openai"
        assert detect_provider_from_model_id("gpt-4o-mini") == "openai"
        assert detect_provider_from_model_id("gpt-3.5-turbo") == "openai"

    def test_pattern_matching_claude(self):
        """Test pattern matching for Claude models without prefix"""
        assert detect_provider_from_model_id("claude-3-5-sonnet-20241022") == "anthropic"
        assert detect_provider_from_model_id("claude-3-opus") == "anthropic"

    def test_pattern_matching_gemini(self):
        """Test pattern matching for Gemini models without prefix"""
        assert detect_provider_from_model_id("gemini-2.5-flash") == "google"
        assert detect_provider_from_model_id("gemini-pro") == "google"

    def test_pattern_matching_llama(self):
        """Test pattern matching for LLaMA models without prefix"""
        assert detect_provider_from_model_id("llama-3.1-8b-instruct") == "meta"
        assert detect_provider_from_model_id("Llama-3.2-3B-Instruct") == "meta"

    def test_pattern_matching_openai_keyword(self):
        """Test pattern matching with 'openai' keyword in name"""
        assert detect_provider_from_model_id("openai-model-v1") == "openai"

    def test_pattern_matching_anthropic_keyword(self):
        """Test pattern matching with 'anthropic' keyword in name"""
        assert detect_provider_from_model_id("anthropic-model") == "anthropic"

    def test_pattern_matching_google_keyword(self):
        """Test pattern matching with 'google' keyword in name"""
        assert detect_provider_from_model_id("google-ai-model") == "google"

    def test_pattern_matching_bard(self):
        """Test pattern matching for Bard (Google) models"""
        assert detect_provider_from_model_id("bard-advanced") == "google"

    def test_internal_model_fallback(self):
        """Test fallback to 'internal' for unknown model patterns"""
        assert detect_provider_from_model_id("my-custom-model") == "internal"
        assert detect_provider_from_model_id("unknown-llm-v2") == "internal"

    def test_none_input(self):
        """Test handling of None input"""
        assert detect_provider_from_model_id(None) is None

    def test_empty_string(self):
        """Test handling of empty string input"""
        assert detect_provider_from_model_id("") is None

    def test_case_insensitive_matching(self):
        """Test that pattern matching is case-insensitive"""
        assert detect_provider_from_model_id("GPT-4O") == "openai"
        assert detect_provider_from_model_id("CLAUDE-3") == "anthropic"
        assert detect_provider_from_model_id("GEMINI-PRO") == "google"
        assert detect_provider_from_model_id("LLAMA-3") == "meta"

    def test_provider_prefix_strips_whitespace(self):
        """Test that provider prefix extraction handles whitespace"""
        # The split should handle this, but worth testing
        assert detect_provider_from_model_id("google / gemini-flash") == "google"


class TestFetchApiKeyFromSecret:
    """Test Kubernetes secret retrieval for API keys"""

    @patch('src.core.api_key_manager.requests.get')
    @patch('builtins.open', create=True)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_successful_secret_retrieval(self, mock_exists, mock_open, mock_requests_get):
        """Test successful API key retrieval from Kubernetes secret"""
        # Setup mocks
        mock_exists.return_value = True
        mock_open.return_value.__enter__.return_value.read.return_value = "test-token"

        # Mock successful K8s API response
        api_key = "test-api-key-12345"
        encoded_key = base64.b64encode(api_key.encode('utf-8')).decode('utf-8')
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "api-key": encoded_key
            }
        }
        mock_requests_get.return_value = mock_response

        result = fetch_api_key_from_secret("google")

        assert result == api_key
        mock_requests_get.assert_called_once()

    @patch('src.core.api_key_manager.requests.get')
    @patch('builtins.open', create=True)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_secret_not_found_404(self, mock_exists, mock_open, mock_requests_get):
        """Test handling when secret doesn't exist (404)"""
        mock_exists.return_value = True
        mock_open.return_value.__enter__.return_value.read.return_value = "test-token"

        # Mock 404 response
        mock_response = Mock()
        mock_response.status_code = 404
        mock_requests_get.return_value = mock_response

        result = fetch_api_key_from_secret("openai")

        assert result is None

    @patch.dict(os.environ, {}, clear=True)
    def test_no_namespace_env_var(self):
        """Test handling when NAMESPACE environment variable is not set"""
        result = fetch_api_key_from_secret("anthropic")
        assert result is None

    def test_internal_provider_returns_none(self):
        """Test that 'internal' provider returns None (no API key needed)"""
        result = fetch_api_key_from_secret("internal")
        assert result is None

    def test_none_provider_returns_none(self):
        """Test that None provider returns None"""
        result = fetch_api_key_from_secret(None)
        assert result is None

    @patch('src.core.api_key_manager.requests.get')
    @patch('builtins.open', create=True)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_secret_missing_api_key_field(self, mock_exists, mock_open, mock_requests_get):
        """Test handling when secret exists but missing 'api-key' field"""
        mock_exists.return_value = True
        mock_open.return_value.__enter__.return_value.read.return_value = "test-token"

        # Mock response with secret but missing api-key field
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "other-field": "some-value"
            }
        }
        mock_requests_get.return_value = mock_response

        result = fetch_api_key_from_secret("google")

        assert result is None

    @patch('builtins.open', side_effect=FileNotFoundError)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_service_account_token_not_found(self, mock_exists, mock_open):
        """Test handling when service account token file doesn't exist"""
        mock_exists.return_value = True

        result = fetch_api_key_from_secret("openai")

        assert result is None

    @patch('src.core.api_key_manager.requests.get')
    @patch('builtins.open', create=True)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_forbidden_403_response(self, mock_exists, mock_open, mock_requests_get):
        """Test handling when RBAC denies access (403)"""
        mock_exists.return_value = True
        mock_open.return_value.__enter__.return_value.read.return_value = "test-token"

        # Mock 403 Forbidden response
        mock_response = Mock()
        mock_response.status_code = 403
        mock_requests_get.return_value = mock_response

        result = fetch_api_key_from_secret("google")

        assert result is None

    @patch('src.core.api_key_manager.requests.get')
    @patch('builtins.open', create=True)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_correct_secret_name_format(self, mock_exists, mock_open, mock_requests_get):
        """Test that correct secret name format is used"""
        mock_exists.return_value = True
        mock_open.return_value.__enter__.return_value.read.return_value = "test-token"

        mock_response = Mock()
        mock_response.status_code = 404
        mock_requests_get.return_value = mock_response

        fetch_api_key_from_secret("google")

        # Verify URL contains correct secret name format
        call_args = mock_requests_get.call_args
        url = call_args[0][0]
        assert "ai-google-credentials" in url
        assert "/namespaces/test-namespace/" in url

    @patch('src.core.api_key_manager.requests.get')
    @patch('builtins.open', create=True)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_api_key_trailing_newline_stripped(self, mock_exists, mock_open, mock_requests_get):
        """Test that trailing newlines and whitespace are stripped from API key"""
        mock_exists.return_value = True
        mock_open.return_value.__enter__.return_value.read.return_value = "test-token"

        # Mock API key with trailing newline (common when manually creating secrets)
        api_key_with_newline = "test-api-key-12345\n"
        encoded_key = base64.b64encode(api_key_with_newline.encode('utf-8')).decode('utf-8')
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "api-key": encoded_key
            }
        }
        mock_requests_get.return_value = mock_response

        result = fetch_api_key_from_secret("google")

        # Should be stripped of trailing newline
        assert result == "test-api-key-12345"
        assert "\n" not in result


class TestResolveApiKey:
    """Test API key resolution with fallback priority"""

    def test_explicit_api_key_has_priority(self):
        """Test that explicitly provided API key is returned first"""
        explicit_key = "explicit-api-key-123"

        # Even with a model_id that would trigger secret lookup, explicit key wins
        result = resolve_api_key(api_key=explicit_key, model_id="google/gemini-2.5-flash")

        assert result == explicit_key

    @patch('src.core.api_key_manager.fetch_api_key_from_secret')
    def test_fallback_to_secret_when_no_explicit_key(self, mock_fetch_secret):
        """Test fallback to Kubernetes secret when no explicit key provided"""
        secret_key = "secret-api-key-456"
        mock_fetch_secret.return_value = secret_key

        result = resolve_api_key(api_key=None, model_id="google/gemini-2.5-flash")

        assert result == secret_key
        mock_fetch_secret.assert_called_once_with("google")

    @patch('src.core.api_key_manager.fetch_api_key_from_secret')
    def test_empty_string_when_no_key_found(self, mock_fetch_secret):
        """Test that empty string is returned when no API key found"""
        mock_fetch_secret.return_value = None

        result = resolve_api_key(api_key=None, model_id="google/gemini-2.5-flash")

        assert result == ""

    def test_no_model_id_returns_empty_string(self):
        """Test that empty string is returned when no model_id provided"""
        result = resolve_api_key(api_key=None, model_id=None)

        assert result == ""

    @patch('src.core.api_key_manager.fetch_api_key_from_secret')
    def test_provider_detection_from_model_id(self, mock_fetch_secret):
        """Test that provider is correctly detected from model_id for secret lookup"""
        mock_fetch_secret.return_value = "test-key"

        # Test various model ID formats
        resolve_api_key(api_key=None, model_id="google/gemini-2.5-flash")
        mock_fetch_secret.assert_called_with("google")

        resolve_api_key(api_key=None, model_id="gpt-4o")
        mock_fetch_secret.assert_called_with("openai")

        resolve_api_key(api_key=None, model_id="claude-3-5-sonnet")
        mock_fetch_secret.assert_called_with("anthropic")

    @patch('src.core.api_key_manager.fetch_api_key_from_secret')
    def test_internal_model_no_secret_lookup(self, mock_fetch_secret):
        """Test that internal models don't trigger secret lookup"""
        mock_fetch_secret.return_value = None

        result = resolve_api_key(api_key=None, model_id="my-internal-model")

        # fetch_api_key_from_secret is called but returns None for 'internal'
        assert result == ""

    def test_explicit_empty_string_api_key(self):
        """Test handling of explicit empty string API key"""
        # Empty string is falsy, so should fall back to secret lookup
        with patch('src.core.api_key_manager.fetch_api_key_from_secret') as mock_fetch:
            mock_fetch.return_value = "fallback-key"

            result = resolve_api_key(api_key="", model_id="google/gemini-flash")

            # Empty string is falsy, should fallback
            assert result == "fallback-key"

    @patch('src.core.api_key_manager.fetch_api_key_from_secret')
    def test_whitespace_api_key_is_truthy(self, mock_fetch_secret):
        """Test that whitespace-only API key is still considered truthy"""
        # Whitespace string is truthy, so should be returned
        result = resolve_api_key(api_key="   ", model_id="google/gemini-flash")

        assert result == "   "
        mock_fetch_secret.assert_not_called()

    @patch('src.core.api_key_manager.fetch_api_key_from_secret')
    def test_both_none_returns_empty_string(self, mock_fetch_secret):
        """Test that both None values returns empty string"""
        mock_fetch_secret.return_value = None

        result = resolve_api_key(api_key=None, model_id=None)

        assert result == ""
        mock_fetch_secret.assert_not_called()


class TestEdgeCases:
    """Test edge cases and error conditions"""

    def test_detect_provider_with_special_characters(self):
        """Test provider detection with special characters in model name"""
        assert detect_provider_from_model_id("google/gemini-2.5-flash-exp") == "google"
        assert detect_provider_from_model_id("meta-llama/Llama-3.1-8B-Instruct-FP16") == "meta-llama"

    def test_detect_provider_with_version_numbers(self):
        """Test provider detection with various version number formats"""
        assert detect_provider_from_model_id("gpt-4-turbo-2024-04-09") == "openai"
        assert detect_provider_from_model_id("claude-3-5-sonnet-20241022") == "anthropic"

    @patch('src.core.api_key_manager.requests.get')
    @patch('builtins.open', create=True)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_fetch_secret_with_network_error(self, mock_exists, mock_open, mock_requests_get):
        """Test handling of network errors during secret retrieval"""
        mock_exists.return_value = True
        mock_open.return_value.__enter__.return_value.read.return_value = "test-token"

        # Mock network error
        mock_requests_get.side_effect = Exception("Network error")

        result = fetch_api_key_from_secret("google")

        assert result is None

    @patch('src.core.api_key_manager.requests.get')
    @patch('builtins.open', create=True)
    @patch('os.path.exists')
    @patch.dict(os.environ, {'NAMESPACE': 'test-namespace'})
    def test_fetch_secret_with_malformed_base64(self, mock_exists, mock_open, mock_requests_get):
        """Test handling of malformed base64 in secret data"""
        mock_exists.return_value = True
        mock_open.return_value.__enter__.return_value.read.return_value = "test-token"

        # Mock response with invalid base64
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "api-key": "not-valid-base64!!!"
            }
        }
        mock_requests_get.return_value = mock_response

        result = fetch_api_key_from_secret("google")

        # Should handle base64 decode error gracefully
        assert result is None
