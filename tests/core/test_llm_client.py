"""
Tests for LLM client functionality.

This module tests the LLM client integration, including authentication,
response parsing, and error handling for different providers (Anthropic, OpenAI, Google).
"""

import pytest
from unittest.mock import patch, Mock

from src.core.llm_client import (
    summarize_with_llm,
    _validate_and_extract_response,
    _make_api_request
)
from src.core.response_validator import ResponseType


class TestLLMClientAuthentication:
    """Test LLM client authentication for different providers"""

    @patch('src.core.llm_client._make_api_request')
    def test_openai_authentication_headers(self, mock_api_request):
        """Test that OpenAI uses correct Authorization Bearer header"""
        mock_api_request.return_value = {
            "choices": [{"message": {"content": "Test response"}}]
        }
        
        # Mock model config for OpenAI
        model_config = {
            "provider": "openai",
            "apiUrl": "https://api.openai.com/v1/chat/completions",
            "external": True,
            "requiresApiKey": True
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            summarize_with_llm(
                prompt="Test prompt",
                summarize_model_id="test-model",
                response_type=ResponseType.GENERAL_CHAT,
                api_key="test-openai-key"
            )
        
        # Verify the API request was made with correct headers
        call_args = mock_api_request.call_args
        headers = call_args[0][1]  # Second argument is headers
        assert headers["Authorization"] == "Bearer test-openai-key"

    @patch('src.core.llm_client._make_api_request')
    def test_google_authentication_headers(self, mock_api_request):
        """Test that Google uses correct x-goog-api-key header"""
        mock_api_request.return_value = {
            "candidates": [{"content": {"parts": [{"text": "Test response"}]}}]
        }
        
        # Mock model config for Google
        model_config = {
            "provider": "google",
            "apiUrl": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            "external": True,
            "requiresApiKey": True
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            summarize_with_llm(
                prompt="Test prompt",
                summarize_model_id="test-model",
                response_type=ResponseType.GENERAL_CHAT,
                api_key="test-google-key"
            )
        
        # Verify the API request was made with correct headers
        call_args = mock_api_request.call_args
        headers = call_args[0][1]  # Second argument is headers
        assert headers["x-goog-api-key"] == "test-google-key"

    @patch('anthropic.Anthropic')
    def test_anthropic_authentication_headers(self, mock_anthropic_class):
        """Test that Anthropic uses correct x-api-key header"""
        # Mock the Anthropic client
        mock_client = Mock()
        mock_anthropic_class.return_value = mock_client
        
        # Mock the response
        mock_content = Mock()
        mock_content.type = "text"
        mock_content.text = "Test response"
        mock_response = Mock()
        mock_response.content = [mock_content]
        mock_client.messages.create.return_value = mock_response
        
        # Mock model config for Anthropic
        model_config = {
            "provider": "anthropic",
            "apiUrl": "https://api.anthropic.com/v1/messages",
            "external": True,
            "requiresApiKey": True
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            result = summarize_with_llm(
                prompt="Test prompt",
                summarize_model_id="test-model",
                response_type=ResponseType.GENERAL_CHAT,
                api_key="test-anthropic-key"
            )
        
        # Verify the Anthropic client was initialized with correct API key
        mock_anthropic_class.assert_called_once_with(api_key="test-anthropic-key")
        
        # Verify the response was processed correctly
        assert result == "Test response"


class TestLLMClientResponseParsing:
    """Test LLM client response parsing for different providers"""

    def test_openai_response_parsing(self):
        """Test OpenAI response format parsing"""
        response_json = {
            "choices": [
                {
                    "message": {
                        "content": "Test OpenAI response"
                    }
                }
            ]
        }
        
        result = _validate_and_extract_response(
            response_json, is_external=True, provider="openai"
        )
        
        assert result == "Test OpenAI response"

    def test_google_response_parsing(self):
        """Test Google response format parsing"""
        response_json = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "Test Google response"}
                        ]
                    }
                }
            ]
        }
        
        result = _validate_and_extract_response(
            response_json, is_external=True, provider="google"
        )
        
        assert result == "Test Google response"

    def test_anthropic_response_parsing(self):
        """Test Anthropic response format parsing"""
        response_json = {
            "content": [
                {
                    "type": "text",
                    "text": "Test Anthropic response"
                }
            ]
        }
        
        result = _validate_and_extract_response(
            response_json, is_external=True, provider="anthropic"
        )
        
        assert result == "Test Anthropic response"

    def test_anthropic_multiple_content_blocks(self):
        """Test Anthropic response with multiple content blocks"""
        response_json = {
            "content": [
                {
                    "type": "text",
                    "text": "First part of response"
                },
                {
                    "type": "text",
                    "text": "Second part of response"
                }
            ]
        }
        
        result = _validate_and_extract_response(
            response_json, is_external=True, provider="anthropic"
        )
        
        assert result == "First part of responseSecond part of response"

    def test_anthropic_empty_content_blocks(self):
        """Test Anthropic response with empty content blocks"""
        response_json = {
            "content": []
        }
        
        with pytest.raises(ValueError, match="Invalid anthropic response format"):
            _validate_and_extract_response(
                response_json, is_external=True, provider="anthropic"
            )

    def test_anthropic_malformed_response(self):
        """Test Anthropic response with malformed structure"""
        response_json = {
            "content": [
                {
                    "type": "text"
                    # Missing "text" field
                }
            ]
        }
        
        with pytest.raises(ValueError, match="Invalid anthropic response content"):
            _validate_and_extract_response(
                response_json, is_external=True, provider="anthropic"
            )

    def test_anthropic_missing_content_field(self):
        """Test Anthropic response missing content field"""
        response_json = {}
        
        with pytest.raises(ValueError, match="Invalid anthropic response format"):
            _validate_and_extract_response(
                response_json, is_external=True, provider="anthropic"
            )


class TestLLMClientErrorHandling:
    """Test LLM client error handling"""

    @patch('anthropic.Anthropic')
    def test_anthropic_import_error(self, mock_anthropic_class):
        """Test handling of missing anthropic package"""
        mock_anthropic_class.side_effect = ImportError("No module named 'anthropic'")
        
        model_config = {
            "provider": "anthropic",
            "apiUrl": "https://api.anthropic.com/v1/messages",
            "external": True,
            "requiresApiKey": True
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            with pytest.raises(ValueError, match="Anthropic client not available"):
                summarize_with_llm(
                    prompt="Test prompt",
                    summarize_model_id="test-model",
                    response_type=ResponseType.GENERAL_CHAT,
                    api_key="test-key"
                )

    @patch('anthropic.Anthropic')
    def test_anthropic_api_error(self, mock_anthropic_class):
        """Test handling of Anthropic API errors"""
        mock_client = Mock()
        mock_anthropic_class.return_value = mock_client
        mock_client.messages.create.side_effect = Exception("API rate limit exceeded")
        
        model_config = {
            "provider": "anthropic",
            "apiUrl": "https://api.anthropic.com/v1/messages",
            "external": True,
            "requiresApiKey": True
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            with pytest.raises(ValueError, match="Anthropic API error"):
                summarize_with_llm(
                    prompt="Test prompt",
                    summarize_model_id="test-model",
                    response_type=ResponseType.GENERAL_CHAT,
                    api_key="test-key"
                )


class TestLLMClientIntegration:
    """Test LLM client integration scenarios"""

    @patch('anthropic.Anthropic')
    def test_anthropic_client_integration_success(self, mock_anthropic_class):
        """Test successful Anthropic client integration"""
        # Mock the Anthropic client
        mock_client = Mock()
        mock_anthropic_class.return_value = mock_client
        
        # Mock the response
        mock_content = Mock()
        mock_content.type = "text"
        mock_content.text = "Generated summary"
        mock_response = Mock()
        mock_response.content = [mock_content]
        mock_client.messages.create.return_value = mock_response
        
        model_config = {
            "provider": "anthropic",
            "apiUrl": "https://api.anthropic.com/v1/messages",
            "external": True,
            "requiresApiKey": True,
            "modelName": "claude-3-5-haiku-20241022"
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            result = summarize_with_llm(
                prompt="Summarize this data",
                summarize_model_id="test-model",
                response_type=ResponseType.GENERAL_CHAT,
                api_key="test-anthropic-key"
            )
        
        # Verify the client was called with correct parameters
        mock_client.messages.create.assert_called_once()
        call_args = mock_client.messages.create.call_args
        
        assert call_args[1]["model"] == "claude-3-5-haiku-20241022"
        assert call_args[1]["max_tokens"] == 6000  # DEFAULT_MAX_TOKENS
        assert call_args[1]["temperature"] == 0  # DETERMINISTIC_TEMPERATURE
        assert len(call_args[1]["messages"]) == 1
        assert call_args[1]["messages"][0]["role"] == "user"
        assert call_args[1]["messages"][0]["content"] == "Summarize this data"
        
        # Verify the response
        assert result == "Generated summary"

    @patch('anthropic.Anthropic')
    def test_anthropic_message_conversion(self, mock_anthropic_class):
        """Test conversion of messages to Anthropic format"""
        mock_client = Mock()
        mock_anthropic_class.return_value = mock_client
        
        mock_content = Mock()
        mock_content.type = "text"
        mock_content.text = "Response"
        mock_response = Mock()
        mock_response.content = [mock_content]
        mock_client.messages.create.return_value = mock_response
        
        model_config = {
            "provider": "anthropic",
            "apiUrl": "https://api.anthropic.com/v1/messages",
            "external": True,
            "requiresApiKey": True,
            "modelName": "claude-3-5-haiku-20241022"
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            # Test with multiple messages (conversation)
            result = summarize_with_llm(
                prompt="Test prompt",
                summarize_model_id="test-model",
                response_type=ResponseType.GENERAL_CHAT,
                api_key="test-key",
                messages=[
                    {"role": "user", "content": "First message"},
                    {"role": "assistant", "content": "Assistant response"},
                    {"role": "user", "content": "Second message"}
                ]
            )
        
        # Verify messages were converted correctly
        call_args = mock_client.messages.create.call_args
        messages = call_args[1]["messages"]
        
        assert len(messages) == 4
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "First message"
        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"] == "Assistant response"
        assert messages[2]["role"] == "user"
        assert messages[2]["content"] == "Second message"
        assert messages[3]["role"] == "user"
        assert messages[3]["content"] == "Test prompt"


class TestLLMClientBackwardCompatibility:
    """Test that existing functionality still works after Anthropic changes"""

    @patch('src.core.llm_client._make_api_request')
    def test_openai_still_works(self, mock_api_request):
        """Test that OpenAI integration still works unchanged"""
        mock_api_request.return_value = {
            "choices": [{"message": {"content": "OpenAI response"}}]
        }
        
        model_config = {
            "provider": "openai",
            "apiUrl": "https://api.openai.com/v1/chat/completions",
            "external": True,
            "requiresApiKey": True
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            result = summarize_with_llm(
                prompt="Test prompt",
                summarize_model_id="test-model",
                response_type=ResponseType.GENERAL_CHAT,
                api_key="test-openai-key"
            )
        
        # Verify OpenAI still uses HTTP requests (not Anthropic client)
        mock_api_request.assert_called_once()
        assert result == "OpenAI response"

    @patch('src.core.llm_client._make_api_request')
    def test_google_still_works(self, mock_api_request):
        """Test that Google integration still works unchanged"""
        mock_api_request.return_value = {
            "candidates": [{"content": {"parts": [{"text": "Google response"}]}}]
        }
        
        model_config = {
            "provider": "google",
            "apiUrl": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            "external": True,
            "requiresApiKey": True
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            result = summarize_with_llm(
                prompt="Test prompt",
                summarize_model_id="test-model",
                response_type=ResponseType.GENERAL_CHAT,
                api_key="test-google-key"
            )
        
        # Verify Google still uses HTTP requests (not Anthropic client)
        mock_api_request.assert_called_once()
        assert result == "Google response"

    def test_local_model_unchanged(self):
        """Test that local model integration is unchanged"""
        # This test would verify that local models still work
        # without being affected by the Anthropic changes
        pass  # Local model testing would require more complex setup


class TestLLMClientEdgeCases:
    """Test edge cases and error scenarios"""

    def test_invalid_provider_response_format(self):
        """Test handling of invalid provider in response parsing"""
        response_json = {"invalid": "format"}
        
        with pytest.raises(ValueError, match="Invalid.*response format"):
            _validate_and_extract_response(
                response_json, is_external=True, provider="unknown"
            )

    def test_anthropic_non_text_content_blocks(self):
        """Test Anthropic response with non-text content blocks"""
        response_json = {
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": "..."}
                },
                {
                    "type": "text",
                    "text": "This is the text content"
                }
            ]
        }
        
        result = _validate_and_extract_response(
            response_json, is_external=True, provider="anthropic"
        )
        
        # Should only extract text content, ignoring image blocks
        assert result == "This is the text content"

    @patch('anthropic.Anthropic')
    def test_anthropic_empty_response_content(self, mock_anthropic_class):
        """Test Anthropic response with empty content"""
        mock_client = Mock()
        mock_anthropic_class.return_value = mock_client
        
        # Mock empty response
        mock_response = Mock()
        mock_response.content = []
        mock_client.messages.create.return_value = mock_response
        
        model_config = {
            "provider": "anthropic",
            "apiUrl": "https://api.anthropic.com/v1/messages",
            "external": True,
            "requiresApiKey": True
        }
        
        with patch('src.core.llm_client.MODEL_CONFIG', {"test-model": model_config}):
            result = summarize_with_llm(
                prompt="Test prompt",
                summarize_model_id="test-model",
                response_type=ResponseType.GENERAL_CHAT,
                api_key="test-key"
            )
        
        # Should return empty string for empty content
        assert result == ""
