"""
Tests for chatbot implementations.

This module tests the refactored chatbot architecture including:
- Factory function routing
- API key retrieval
- Tool result truncation
- Model-specific configurations
"""

import os
import pytest
from unittest.mock import Mock, patch, MagicMock


def test_chatbot_imports():
    """Test that all chatbot classes can be imported."""
    from mcp_server.chatbots import (
        BaseChatBot,
        AnthropicChatBot,
        OpenAIChatBot,
        GoogleChatBot,
        LlamaChatBot,
        DeterministicChatBot,
        create_chatbot
    )

    assert BaseChatBot is not None
    assert AnthropicChatBot is not None
    assert OpenAIChatBot is not None
    assert GoogleChatBot is not None
    assert LlamaChatBot is not None
    assert DeterministicChatBot is not None
    assert create_chatbot is not None


def test_factory_creates_llama_bot():
    """Test that factory creates LlamaChatBot for Llama 3.1 models."""
    from mcp_server.chatbots import create_chatbot, LlamaChatBot

    bot = create_chatbot("meta-llama/Llama-3.1-8B-Instruct")
    assert isinstance(bot, LlamaChatBot)
    assert bot.model_name == "meta-llama/Llama-3.1-8B-Instruct"


def test_factory_creates_deterministic_bot():
    """Test that factory creates DeterministicChatBot for Llama 3.2 models."""
    from mcp_server.chatbots import create_chatbot, DeterministicChatBot

    bot = create_chatbot("meta-llama/Llama-3.2-3B-Instruct")
    assert isinstance(bot, DeterministicChatBot)
    assert bot.model_name == "meta-llama/Llama-3.2-3B-Instruct"


def test_factory_creates_anthropic_bot():
    """Test that factory creates AnthropicChatBot for Anthropic models."""
    from mcp_server.chatbots import create_chatbot, AnthropicChatBot

    # Mock MODEL_CONFIG to avoid needing actual config
    with patch('mcp_server.chatbots.base.MODEL_CONFIG', {
        'claude-3-5-haiku': {
            'external': True,
            'provider': 'anthropic'
        }
    }):
        bot = create_chatbot("claude-3-5-haiku", api_key="test-key")
        assert isinstance(bot, AnthropicChatBot)


def test_factory_creates_openai_bot():
    """Test that factory creates OpenAIChatBot for OpenAI models."""
    from mcp_server.chatbots import create_chatbot, OpenAIChatBot

    with patch('mcp_server.chatbots.base.MODEL_CONFIG', {
        'gpt-4o-mini': {
            'external': True,
            'provider': 'openai'
        }
    }):
        bot = create_chatbot("gpt-4o-mini", api_key="test-key")
        assert isinstance(bot, OpenAIChatBot)


def test_factory_creates_google_bot():
    """Test that factory creates GoogleChatBot for Google models."""
    from mcp_server.chatbots import create_chatbot, GoogleChatBot

    with patch('mcp_server.chatbots.base.MODEL_CONFIG', {
        'gemini-2.5-flash': {
            'external': True,
            'provider': 'google'
        }
    }):
        bot = create_chatbot("gemini-2.5-flash", api_key="test-key")
        assert isinstance(bot, GoogleChatBot)


class TestAPIKeyRetrieval:
    """Test API key retrieval for all bot types."""

    def test_anthropic_bot_api_key_from_env(self):
        """Test AnthropicChatBot gets API key from environment."""
        from mcp_server.chatbots import AnthropicChatBot

        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-anthropic-key'}):
            bot = AnthropicChatBot("claude-3-5-haiku")
            assert bot._get_api_key() == 'test-anthropic-key'
            assert bot.api_key == 'test-anthropic-key'

    def test_openai_bot_api_key_from_env(self):
        """Test OpenAIChatBot gets API key from environment."""
        from mcp_server.chatbots import OpenAIChatBot

        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-openai-key'}):
            bot = OpenAIChatBot("gpt-4o-mini")
            assert bot._get_api_key() == 'test-openai-key'
            assert bot.api_key == 'test-openai-key'

    def test_google_bot_api_key_from_env(self):
        """Test GoogleChatBot gets API key from environment."""
        from mcp_server.chatbots import GoogleChatBot

        with patch.dict(os.environ, {'GOOGLE_API_KEY': 'test-google-key'}):
            bot = GoogleChatBot("gemini-2.5-flash")
            assert bot._get_api_key() == 'test-google-key'
            assert bot.api_key == 'test-google-key'

    def test_llama_bot_no_api_key_needed(self):
        """Test LlamaChatBot returns None for API key (local model)."""
        from mcp_server.chatbots import LlamaChatBot

        bot = LlamaChatBot("meta-llama/Llama-3.1-8B-Instruct")
        assert bot._get_api_key() is None
        assert bot.api_key is None

    def test_deterministic_bot_no_api_key_needed(self):
        """Test DeterministicChatBot returns None for API key (local model)."""
        from mcp_server.chatbots import DeterministicChatBot

        bot = DeterministicChatBot("meta-llama/Llama-3.2-3B-Instruct")
        assert bot._get_api_key() is None
        assert bot.api_key is None

    def test_explicit_api_key_overrides_env(self):
        """Test that explicitly passed API key overrides environment variable."""
        from mcp_server.chatbots import OpenAIChatBot

        with patch.dict(os.environ, {'OPENAI_API_KEY': 'env-key'}):
            bot = OpenAIChatBot("gpt-4o-mini", api_key="explicit-key")
            assert bot.api_key == "explicit-key"

    def test_openai_bot_can_be_created_without_api_key(self):
        """Test that OpenAIChatBot can be initialized without an API key."""
        from mcp_server.chatbots import OpenAIChatBot

        # Clear any environment variables
        with patch.dict(os.environ, {}, clear=True):
            bot = OpenAIChatBot("gpt-4o-mini")
            assert bot.api_key is None
            assert bot.client is None  # Client should not be created without API key

    def test_openai_bot_with_api_key_creates_client(self):
        """Test that OpenAIChatBot creates client when API key is provided."""
        from mcp_server.chatbots import OpenAIChatBot

        with patch('openai.OpenAI') as mock_openai_class:
            bot = OpenAIChatBot("gpt-4o-mini", api_key="test-key")
            assert bot.api_key == "test-key"
            # Verify OpenAI client was instantiated with the API key
            mock_openai_class.assert_called_once_with(api_key="test-key")

    def test_openai_bot_without_api_key_does_not_create_client(self):
        """Test that OpenAIChatBot does not create client when no API key is provided."""
        from mcp_server.chatbots import OpenAIChatBot

        with patch('openai.OpenAI') as mock_openai_class:
            with patch.dict(os.environ, {}, clear=True):
                bot = OpenAIChatBot("gpt-4o-mini")
                assert bot.api_key is None
                assert bot.client is None
                # Verify OpenAI client was NOT instantiated
                mock_openai_class.assert_not_called()


class TestToolResultTruncation:
    """Test tool result truncation for all bot types."""

    def test_anthropic_bot_max_length(self):
        """Test AnthropicChatBot has correct max length (15K)."""
        from mcp_server.chatbots import AnthropicChatBot

        bot = AnthropicChatBot("claude-3-5-haiku", api_key="test")
        assert bot._get_max_tool_result_length() == 15000

    def test_openai_bot_max_length(self):
        """Test OpenAIChatBot has correct max length (10K)."""
        from mcp_server.chatbots import OpenAIChatBot

        bot = OpenAIChatBot("gpt-4o-mini", api_key="test")
        assert bot._get_max_tool_result_length() == 10000

    def test_google_bot_max_length(self):
        """Test GoogleChatBot has correct max length (10K)."""
        from mcp_server.chatbots import GoogleChatBot

        bot = GoogleChatBot("gemini-2.5-flash", api_key="test")
        assert bot._get_max_tool_result_length() == 10000

    def test_llama_bot_max_length(self):
        """Test LlamaChatBot has correct max length (8K)."""
        from mcp_server.chatbots import LlamaChatBot

        bot = LlamaChatBot("meta-llama/Llama-3.1-8B-Instruct")
        assert bot._get_max_tool_result_length() == 8000

    def test_deterministic_bot_uses_base_max_length(self):
        """Test DeterministicChatBot uses base class default (5K)."""
        from mcp_server.chatbots import DeterministicChatBot

        bot = DeterministicChatBot("meta-llama/Llama-3.2-3B-Instruct")
        assert bot._get_max_tool_result_length() == 5000

    def test_get_tool_result_truncates_large_results(self):
        """Test that _get_tool_result properly truncates results exceeding max length."""
        from mcp_server.chatbots import LlamaChatBot

        bot = LlamaChatBot("meta-llama/Llama-3.1-8B-Instruct")

        # Mock _route_tool_call_to_mcp to return a large result
        large_result = "x" * 10000  # 10K chars, exceeds Llama's 8K limit
        with patch.object(bot, '_route_tool_call_to_mcp', return_value=large_result):
            result = bot._get_tool_result("test_tool", {"arg": "value"})

            # Should be truncated to 8000 + truncation message
            assert len(result) == 8000 + len("\n... [Result truncated due to size]")
            assert result.endswith("\n... [Result truncated due to size]")
            assert result.startswith("x" * 100)  # Verify it starts with the original content

    def test_get_tool_result_does_not_truncate_small_results(self):
        """Test that _get_tool_result doesn't truncate results within max length."""
        from mcp_server.chatbots import LlamaChatBot

        bot = LlamaChatBot("meta-llama/Llama-3.1-8B-Instruct")

        # Mock _route_tool_call_to_mcp to return a small result
        small_result = "Small result"
        with patch.object(bot, '_route_tool_call_to_mcp', return_value=small_result):
            result = bot._get_tool_result("test_tool", {"arg": "value"})

            # Should NOT be truncated
            assert result == small_result
            assert "truncated" not in result.lower()

    def test_get_tool_result_calls_route_with_correct_args(self):
        """Test that _get_tool_result calls _route_tool_call_to_mcp with correct arguments."""
        from mcp_server.chatbots import LlamaChatBot

        bot = LlamaChatBot("meta-llama/Llama-3.1-8B-Instruct")

        with patch.object(bot, '_route_tool_call_to_mcp', return_value="result") as mock_route:
            tool_name = "execute_promql"
            tool_args = {"query": "up"}

            bot._get_tool_result(tool_name, tool_args)

            # Verify the method was called with correct args
            mock_route.assert_called_once_with(tool_name, tool_args)


class TestModelSpecificInstructions:
    """Test that each bot has model-specific instructions."""

    def test_anthropic_bot_has_specific_instructions(self):
        """Test AnthropicChatBot has Claude-specific instructions."""
        from mcp_server.chatbots import AnthropicChatBot

        bot = AnthropicChatBot("claude-3-5-haiku", api_key="test")
        instructions = bot._get_model_specific_instructions()

        assert "CLAUDE-SPECIFIC" in instructions
        assert len(instructions) > 0

    def test_openai_bot_has_specific_instructions(self):
        """Test OpenAIChatBot has GPT-specific instructions."""
        from mcp_server.chatbots import OpenAIChatBot

        bot = OpenAIChatBot("gpt-4o-mini", api_key="test")
        instructions = bot._get_model_specific_instructions()

        assert "GPT-SPECIFIC" in instructions
        assert len(instructions) > 0

    def test_google_bot_has_specific_instructions(self):
        """Test GoogleChatBot has Gemini-specific instructions."""
        from mcp_server.chatbots import GoogleChatBot

        bot = GoogleChatBot("gemini-2.5-flash", api_key="test")
        instructions = bot._get_model_specific_instructions()

        assert "GEMINI-SPECIFIC" in instructions
        assert len(instructions) > 0

    def test_llama_bot_has_specific_instructions(self):
        """Test LlamaChatBot has Llama-specific instructions."""
        from mcp_server.chatbots import LlamaChatBot

        bot = LlamaChatBot("meta-llama/Llama-3.1-8B-Instruct")
        instructions = bot._get_model_specific_instructions()

        assert "LLAMA-SPECIFIC" in instructions
        assert "Tool Calling Format" in instructions
        assert "PromQL Query Patterns" in instructions
        assert "Key PromQL Rules" in instructions


class TestBaseChatBot:
    """Test BaseChatBot common functionality."""

    def test_base_chatbot_is_abstract(self):
        """Test that BaseChatBot cannot be instantiated directly."""
        from mcp_server.chatbots.base import BaseChatBot

        # BaseChatBot is abstract and should raise TypeError
        with pytest.raises(TypeError):
            BaseChatBot("test-model")

    def test_get_mcp_tools_returns_list(self):
        """Test that _get_mcp_tools returns a list of tool definitions."""
        from mcp_server.chatbots import LlamaChatBot

        bot = LlamaChatBot("meta-llama/Llama-3.1-8B-Instruct")
        tools = bot._get_mcp_tools()

        assert isinstance(tools, list)
        assert len(tools) > 0

        # Check that tools have expected structure
        for tool in tools:
            assert "name" in tool
            assert "description" in tool
            assert "input_schema" in tool

    def test_create_system_prompt_includes_model_specific(self):
        """Test that system prompt includes model-specific instructions."""
        from mcp_server.chatbots import LlamaChatBot

        bot = LlamaChatBot("meta-llama/Llama-3.1-8B-Instruct")
        prompt = bot._create_system_prompt(namespace="test-namespace")

        # Should include both base prompt and model-specific instructions
        assert "Kubernetes and Prometheus" in prompt  # Base prompt
        assert "LLAMA-SPECIFIC" in prompt  # Model-specific


def test_no_claude_integration_references():
    """Test that no code references the deleted claude_integration module."""
    import subprocess

    # Search for references to PrometheusChatBot or claude_integration
    result = subprocess.run(
        ['grep', '-r', 'PrometheusChatBot', 'src/', '--include=*.py'],
        capture_output=True,
        text=True
    )

    # Should return non-zero (not found) or empty output
    assert result.returncode != 0 or len(result.stdout.strip()) == 0, \
        f"Found references to PrometheusChatBot: {result.stdout}"


if __name__ == "__main__":
    # Run with: python -m pytest tests/mcp_server/test_chatbots.py -v
    pytest.main([__file__, "-v"])
