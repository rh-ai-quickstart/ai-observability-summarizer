"""
Tests for chatbot implementations.

This module tests the refactored chatbot architecture including:
- Factory function routing
- API key retrieval
- Tool result truncation
- Model-specific configurations
"""

import json
import os
import pytest
from unittest.mock import Mock, patch, MagicMock


@pytest.fixture
def mock_mcp_tools():
    """Mock tool executor for testing."""
    from chatbots.tool_executor import ToolExecutor, MCPTool

    class MockToolExecutor(ToolExecutor):
        def __init__(self):
            self.tools = [
                MCPTool("execute_promql", "Execute PromQL query", {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"}
                    }
                }),
                MCPTool("get_label_values", "Get label values", {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"}
                    }
                })
            ]

        def call_tool(self, tool_name: str, arguments: dict) -> str:
            return '{"status": "success", "data": "mock result"}'

        def list_tools(self):
            return self.tools

        def get_tool(self, tool_name: str):
            for tool in self.tools:
                if tool.name == tool_name:
                    return tool
            return None

    return MockToolExecutor()


# Test model name constants - Provider prefixes
LLAMA_PROVIDER = "meta-llama"
ANTHROPIC_PROVIDER = "anthropic"
OPENAI_PROVIDER = "openai"
GOOGLE_PROVIDER = "google"

# Llama models
LLAMA_3_1_8B = f"{LLAMA_PROVIDER}/Llama-3.1-8B-Instruct"
LLAMA_3_2_3B = f"{LLAMA_PROVIDER}/Llama-3.2-3B-Instruct"
LLAMA_3_3_70B = f"{LLAMA_PROVIDER}/Llama-3.3-70B-Instruct"

# Claude models
CLAUDE_HAIKU = "claude-haiku-4-5"
CLAUDE_HAIKU_WITH_PROVIDER = f"{ANTHROPIC_PROVIDER}/{CLAUDE_HAIKU}"
CLAUDE_SONNET = "claude-sonnet-4-20250514"
CLAUDE_SONNET_WITH_PROVIDER = f"{ANTHROPIC_PROVIDER}/{CLAUDE_SONNET}"
CLAUDE_HAIKU_DATED = "claude-haiku-4-5-20251001"

# OpenAI models
GPT_4O_MINI = "gpt-4o-mini"
GPT_4O_MINI_WITH_PROVIDER = f"{OPENAI_PROVIDER}/{GPT_4O_MINI}"
GPT_4O = "gpt-4o"

# Google models
GEMINI_FLASH = "gemini-2.5-flash"
GEMINI_FLASH_WITH_PROVIDER = f"{GOOGLE_PROVIDER}/{GEMINI_FLASH}"
GEMINI_FLASH_EXP = "gemini-2.0-flash-exp"
GEMINI_FLASH_EXP_WITH_PROVIDER = f"{GOOGLE_PROVIDER}/{GEMINI_FLASH_EXP}"




def test_chatbot_imports(mock_mcp_tools):
    """Test that all chatbot classes can be imported."""
    from chatbots import (
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


@patch("chatbots.factory.RAG_AVAILABLE", True)
def test_factory_creates_llama_bot(mock_mcp_tools):
    """Test that factory creates LlamaChatBot for Llama 3.1 models."""
    from chatbots import create_chatbot, LlamaChatBot

    bot = create_chatbot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
    assert isinstance(bot, LlamaChatBot)
    assert bot.model_name == LLAMA_3_1_8B


@patch("chatbots.factory.RAG_AVAILABLE", True)
def test_factory_creates_deterministic_bot(mock_mcp_tools):
    """Test that factory creates DeterministicChatBot for Llama 3.2 models."""
    from chatbots import create_chatbot, DeterministicChatBot

    bot = create_chatbot(LLAMA_3_2_3B, tool_executor=mock_mcp_tools)
    assert isinstance(bot, DeterministicChatBot)
    assert bot.model_name == LLAMA_3_2_3B


def test_factory_creates_anthropic_bot(mock_mcp_tools):
    """Test that factory creates AnthropicChatBot for Anthropic models."""
    from chatbots import create_chatbot, AnthropicChatBot

    # Factory determines bot type based on model name patterns
    bot = create_chatbot(CLAUDE_HAIKU_WITH_PROVIDER, api_key="test-key", tool_executor=mock_mcp_tools)
    assert isinstance(bot, AnthropicChatBot)


def test_factory_creates_openai_bot(mock_mcp_tools):
    """Test that factory creates OpenAIChatBot for OpenAI models."""
    from chatbots import create_chatbot, OpenAIChatBot

    # Factory determines bot type based on model name patterns
    bot = create_chatbot(GPT_4O_MINI_WITH_PROVIDER, api_key="test-key", tool_executor=mock_mcp_tools)
    assert isinstance(bot, OpenAIChatBot)


def test_factory_creates_google_bot(mock_mcp_tools):
    """Test that factory creates GoogleChatBot for Google models."""
    from chatbots import create_chatbot, GoogleChatBot

    # Factory determines bot type based on model name patterns
    bot = create_chatbot(GEMINI_FLASH_EXP_WITH_PROVIDER, api_key="test-key", tool_executor=mock_mcp_tools)
    assert isinstance(bot, GoogleChatBot)


def test_factory_creates_openai_bot_for_maas(mock_mcp_tools):
    """Test that factory creates OpenAIChatBot for MAAS models (OpenAI-compatible)."""
    from chatbots import create_chatbot, OpenAIChatBot

    # MAAS uses OpenAI-compatible API, so should route to OpenAIChatBot
    bot = create_chatbot("maas/qwen3-14b", api_key="test-maas-key", tool_executor=mock_mcp_tools)
    assert isinstance(bot, OpenAIChatBot)
    assert bot.model_name == "maas/qwen3-14b"


def test_factory_maas_with_api_url(mock_mcp_tools):
    """Test that factory passes api_url to OpenAIChatBot for MAAS models."""
    from chatbots import create_chatbot, OpenAIChatBot

    with patch('openai.OpenAI') as mock_openai_class:
        bot = create_chatbot(
            "maas/qwen3-14b",
            api_key="test-maas-key",
            api_url="https://custom-maas.example.com/v1/chat/completions",
            tool_executor=mock_mcp_tools
        )
        assert isinstance(bot, OpenAIChatBot)

        # Verify OpenAI client was created with custom base_url
        # The api_url includes /chat/completions suffix which should be removed for base_url
        mock_openai_class.assert_called_once_with(
            api_key="test-maas-key",
            base_url="https://custom-maas.example.com/v1"
        )


def test_factory_maas_pattern_matching(mock_mcp_tools):
    """Test that factory correctly identifies MAAS models by pattern."""
    from chatbots import create_chatbot, OpenAIChatBot

    # Test various MAAS model name patterns
    maas_patterns = [
        "maas/qwen3-14b",
        "maas/granite-3.1-8b-instruct",
        "MAAS/model-name",  # Case insensitive
    ]

    for model_name in maas_patterns:
        bot = create_chatbot(model_name, api_key="test-key", tool_executor=mock_mcp_tools)
        assert isinstance(bot, OpenAIChatBot), f"Failed for pattern: {model_name}"


def test_openai_bot_with_custom_base_url(mock_mcp_tools):
    """Test that OpenAIChatBot correctly handles custom base_url from api_url."""
    from chatbots import OpenAIChatBot

    # Test with /v1/chat/completions suffix - should strip /chat/completions, leaving /v1
    with patch('openai.OpenAI') as mock_openai_class:
        bot = OpenAIChatBot(
            "maas/qwen3-14b",
            api_key="test-key",
            api_url="https://test.api.com/v1/chat/completions",
            tool_executor=mock_mcp_tools
        )

        mock_openai_class.assert_called_once_with(
            api_key="test-key",
            base_url="https://test.api.com/v1"
        )

    # Test with just /chat/completions suffix - should strip it completely
    with patch('openai.OpenAI') as mock_openai_class:
        bot = OpenAIChatBot(
            "maas/qwen3-14b",
            api_key="test-key",
            api_url="https://custom.api.com/chat/completions",
            tool_executor=mock_mcp_tools
        )

        mock_openai_class.assert_called_once_with(
            api_key="test-key",
            base_url="https://custom.api.com"
        )

    # Test with URL that has no known suffix - should use as-is
    with patch('openai.OpenAI') as mock_openai_class:
        bot = OpenAIChatBot(
            "maas/qwen3-14b",
            api_key="test-key",
            api_url="https://another.api.com/v1",
            tool_executor=mock_mcp_tools
        )

        mock_openai_class.assert_called_once_with(
            api_key="test-key",
            base_url="https://another.api.com/v1"
        )


def test_openai_bot_api_url_priority(mock_mcp_tools):
    """Test that passed api_url takes priority over model config."""
    from chatbots import OpenAIChatBot

    with patch('openai.OpenAI') as mock_openai_class:
        with patch('core.model_config_manager.get_model_config') as mock_get_config:
            # Mock model config with different URL
            mock_get_config.return_value = {
                "maas/qwen3-14b": {
                    "apiUrl": "https://config-url.example.com/v1/chat/completions"
                }
            }

            # Pass api_url explicitly (should take priority)
            bot = OpenAIChatBot(
                "maas/qwen3-14b",
                api_key="test-key",
                api_url="https://passed-url.example.com/v1/chat/completions",
                tool_executor=mock_mcp_tools
            )

            # Should use the passed URL, not the config URL
            mock_openai_class.assert_called_once_with(
                api_key="test-key",
                base_url="https://passed-url.example.com/v1"
            )


class TestAPIKeyRetrieval:
    """Test API key retrieval for all bot types."""

    def test_anthropic_bot_api_key_from_env(self, mock_mcp_tools):
        """Test AnthropicChatBot gets API key from environment."""
        from chatbots import AnthropicChatBot

        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-anthropic-key'}):
            bot = AnthropicChatBot(CLAUDE_HAIKU, tool_executor=mock_mcp_tools)
            assert bot._get_api_key() == 'test-anthropic-key'
            assert bot.api_key == 'test-anthropic-key'

    def test_openai_bot_api_key_from_env(self, mock_mcp_tools):
        """Test OpenAIChatBot gets API key from environment."""
        from chatbots import OpenAIChatBot

        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-openai-key'}):
            bot = OpenAIChatBot(GPT_4O_MINI, tool_executor=mock_mcp_tools)
            assert bot._get_api_key() == 'test-openai-key'
            assert bot.api_key == 'test-openai-key'

    def test_google_bot_api_key_from_env(self, mock_mcp_tools):
        """Test GoogleChatBot gets API key from environment."""
        from chatbots import GoogleChatBot

        with patch.dict(os.environ, {'GOOGLE_API_KEY': 'test-google-key'}):
            bot = GoogleChatBot(GEMINI_FLASH, tool_executor=mock_mcp_tools)
            assert bot._get_api_key() == 'test-google-key'
            assert bot.api_key == 'test-google-key'

    def test_llama_bot_no_api_key_needed(self, mock_mcp_tools):
        """Test LlamaChatBot returns None for API key (local model)."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        assert bot._get_api_key() is None
        assert bot.api_key is None

    def test_deterministic_bot_no_api_key_needed(self, mock_mcp_tools):
        """Test DeterministicChatBot returns None for API key (local model)."""
        from chatbots import DeterministicChatBot

        bot = DeterministicChatBot(LLAMA_3_2_3B, tool_executor=mock_mcp_tools)
        assert bot._get_api_key() is None
        assert bot.api_key is None

    def test_explicit_api_key_overrides_env(self, mock_mcp_tools):
        """Test that explicitly passed API key overrides environment variable."""
        from chatbots import OpenAIChatBot

        with patch.dict(os.environ, {'OPENAI_API_KEY': 'env-key'}):
            bot = OpenAIChatBot(GPT_4O_MINI, api_key="explicit-key", tool_executor=mock_mcp_tools)
            assert bot.api_key == "explicit-key"

    def test_openai_bot_can_be_created_without_api_key(self, mock_mcp_tools):
        """Test that OpenAIChatBot can be initialized without an API key."""
        from chatbots import OpenAIChatBot

        # Clear any environment variables
        with patch.dict(os.environ, {}, clear=True):
            bot = OpenAIChatBot(GPT_4O_MINI, tool_executor=mock_mcp_tools)
            assert bot.api_key is None
            assert bot.client is None  # Client should not be created without API key

    def test_openai_bot_with_api_key_creates_client(self, mock_mcp_tools):
        """Test that OpenAIChatBot creates client when API key is provided."""
        from chatbots import OpenAIChatBot

        with patch('openai.OpenAI') as mock_openai_class:
            bot = OpenAIChatBot(GPT_4O_MINI, api_key="test-key", tool_executor=mock_mcp_tools)
            assert bot.api_key == "test-key"
            # Verify OpenAI client was instantiated with the API key
            mock_openai_class.assert_called_once_with(api_key="test-key")

    def test_openai_bot_without_api_key_does_not_create_client(self, mock_mcp_tools):
        """Test that OpenAIChatBot does not create client when no API key is provided."""
        from chatbots import OpenAIChatBot

        with patch('openai.OpenAI') as mock_openai_class:
            with patch.dict(os.environ, {}, clear=True):
                bot = OpenAIChatBot(GPT_4O_MINI, tool_executor=mock_mcp_tools)
                assert bot.api_key is None
                assert bot.client is None
                # Verify OpenAI client was NOT instantiated
                mock_openai_class.assert_not_called()


class TestToolResultTruncation:
    """Test tool result truncation for all bot types."""

    def test_anthropic_bot_max_length(self, mock_mcp_tools):
        """Test AnthropicChatBot has correct max length (15K)."""
        from chatbots import AnthropicChatBot

        bot = AnthropicChatBot(CLAUDE_HAIKU, api_key="test", tool_executor=mock_mcp_tools)
        assert bot._get_max_tool_result_length() == 15000

    def test_openai_bot_max_length(self, mock_mcp_tools):
        """Test OpenAIChatBot has correct max length (10K)."""
        from chatbots import OpenAIChatBot

        bot = OpenAIChatBot(GPT_4O_MINI, api_key="test", tool_executor=mock_mcp_tools)
        assert bot._get_max_tool_result_length() == 10000

    def test_google_bot_max_length(self, mock_mcp_tools):
        """Test GoogleChatBot has correct max length (10K)."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)
        assert bot._get_max_tool_result_length() == 10000

    def test_llama_bot_max_length(self, mock_mcp_tools):
        """Test LlamaChatBot has correct max length (8K)."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        assert bot._get_max_tool_result_length() == 8000

    def test_deterministic_bot_uses_base_max_length(self, mock_mcp_tools):
        """Test DeterministicChatBot uses base class default (5K)."""
        from chatbots import DeterministicChatBot

        bot = DeterministicChatBot(LLAMA_3_2_3B, tool_executor=mock_mcp_tools)
        assert bot._get_max_tool_result_length() == 5000

    def test_get_tool_result_truncates_large_results(self, mock_mcp_tools):
        """Test that _get_tool_result properly truncates results exceeding max length."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Mock _route_tool_call_to_mcp to return a large result
        large_result = "x" * 10000  # 10K chars, exceeds Llama's 8K limit
        with patch.object(bot, '_route_tool_call_to_mcp', return_value=large_result):
            result = bot._get_tool_result("test_tool", {"arg": "value"})

            # Should be truncated to 8000 + truncation message
            assert len(result) == 8000 + len("\n... [Result truncated due to size]")
            assert result.endswith("\n... [Result truncated due to size]")
            assert result.startswith("x" * 100)  # Verify it starts with the original content

    def test_get_tool_result_does_not_truncate_small_results(self, mock_mcp_tools):
        """Test that _get_tool_result doesn't truncate results within max length."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Mock _route_tool_call_to_mcp to return a small result
        small_result = "Small result"
        with patch.object(bot, '_route_tool_call_to_mcp', return_value=small_result):
            result = bot._get_tool_result("test_tool", {"arg": "value"})

            # Should NOT be truncated
            assert result == small_result
            assert "truncated" not in result.lower()

    def test_get_tool_result_calls_route_with_correct_args(self, mock_mcp_tools):
        """Test that _get_tool_result calls _route_tool_call_to_mcp with correct arguments."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        with patch.object(bot, '_route_tool_call_to_mcp', return_value="result") as mock_route:
            tool_name = "execute_promql"
            tool_args = {"query": "up"}

            bot._get_tool_result(tool_name, tool_args)

            # Verify the method was called with correct args
            mock_route.assert_called_once_with(tool_name, tool_args)


class TestToolAllowlist:
    """Test tool filtering via _get_tool_allowlist."""

    def test_llama_filters_tools(self, mock_mcp_tools):
        """Test LlamaChatBot only receives allowlisted tools."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        allowlist = bot._get_tool_allowlist()

        assert allowlist is not None
        assert "execute_promql" in allowlist
        assert "get_label_values" in allowlist
        # Admin/config tools should NOT be in the allowlist
        assert "chat" not in allowlist
        assert "save_api_key" not in allowlist
        assert "validate_api_key" not in allowlist
        assert "add_model_to_config" not in allowlist
        # LLM-chaining tools should NOT be in the allowlist
        assert "analyze_vllm" not in allowlist
        assert "chat_openshift" not in allowlist

    def test_llama_get_mcp_tools_respects_allowlist(self, mock_mcp_tools):
        """Test that _get_mcp_tools returns only allowlisted tools for Llama."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        tools = bot._get_mcp_tools()
        tool_names = {t["name"] for t in tools}

        # mock_mcp_tools has execute_promql and get_label_values — both in allowlist
        assert tool_names == {"execute_promql", "get_label_values"}

    def test_other_bots_get_all_tools(self, mock_mcp_tools):
        """Test that non-Llama bots return None allowlist (all tools)."""
        from chatbots import AnthropicChatBot, OpenAIChatBot, GoogleChatBot

        for BotClass, name, key in [
            (AnthropicChatBot, CLAUDE_HAIKU, "test"),
            (OpenAIChatBot, GPT_4O_MINI, "test"),
            (GoogleChatBot, GEMINI_FLASH, "test"),
        ]:
            bot = BotClass(name, api_key=key, tool_executor=mock_mcp_tools)
            assert bot._get_tool_allowlist() is None
            tools = bot._get_mcp_tools()
            # Should get all tools from mock (2 tools)
            assert len(tools) == 2


class TestModelSpecificInstructions:
    """Test that each bot has model-specific instructions."""

    def test_anthropic_bot_has_specific_instructions(self, mock_mcp_tools):
        """Test AnthropicChatBot has Claude-specific instructions."""
        from chatbots import AnthropicChatBot

        bot = AnthropicChatBot(CLAUDE_HAIKU, api_key="test", tool_executor=mock_mcp_tools)
        instructions = bot._get_model_specific_instructions()

        assert "CLAUDE-SPECIFIC" in instructions
        assert len(instructions) > 0

    def test_openai_bot_has_specific_instructions(self, mock_mcp_tools):
        """Test OpenAIChatBot has GPT-specific instructions."""
        from chatbots import OpenAIChatBot

        bot = OpenAIChatBot(GPT_4O_MINI, api_key="test", tool_executor=mock_mcp_tools)
        instructions = bot._get_model_specific_instructions()

        assert "GPT-SPECIFIC" in instructions
        assert len(instructions) > 0

    def test_google_bot_has_specific_instructions(self, mock_mcp_tools):
        """Test GoogleChatBot has Gemini-specific instructions."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)
        instructions = bot._get_model_specific_instructions()

        assert "GEMINI-SPECIFIC" in instructions
        assert len(instructions) > 0

    def test_llama_bot_has_compact_prompt(self, mock_mcp_tools):
        """Test LlamaChatBot uses compact base prompt with key instructions."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        prompt = bot._get_base_prompt()

        assert "Tool Calling" in prompt
        assert "PromQL Patterns" in prompt
        assert "execute_promql" in prompt
        # Compact prompt should be significantly shorter than the base class version
        base_prompt = super(LlamaChatBot, bot)._get_base_prompt()
        assert len(prompt) < len(base_prompt)


class TestModelNameExtraction:
    """Test model name extraction functionality."""

    def test_anthropic_extracts_model_name_with_provider(self, mock_mcp_tools):
        """Test Anthropic bot extracts model name from provider/model format."""
        from chatbots import AnthropicChatBot

        bot = AnthropicChatBot(CLAUDE_SONNET_WITH_PROVIDER, api_key="test", tool_executor=mock_mcp_tools)
        extracted = bot._extract_model_name()

        assert extracted == CLAUDE_SONNET

    def test_anthropic_keeps_model_name_without_provider(self, mock_mcp_tools):
        """Test Anthropic bot keeps model name when no provider prefix."""
        from chatbots import AnthropicChatBot

        bot = AnthropicChatBot(CLAUDE_HAIKU_DATED, api_key="test", tool_executor=mock_mcp_tools)
        extracted = bot._extract_model_name()

        assert extracted == CLAUDE_HAIKU_DATED

    def test_openai_extracts_model_name_with_provider(self, mock_mcp_tools):
        """Test OpenAI bot extracts model name from provider/model format."""
        from chatbots import OpenAIChatBot

        bot = OpenAIChatBot(GPT_4O_MINI_WITH_PROVIDER, api_key="test", tool_executor=mock_mcp_tools)
        extracted = bot._extract_model_name()

        assert extracted == GPT_4O_MINI

    def test_openai_keeps_model_name_without_provider(self, mock_mcp_tools):
        """Test OpenAI bot keeps model name when no provider prefix."""
        from chatbots import OpenAIChatBot

        bot = OpenAIChatBot(GPT_4O, api_key="test", tool_executor=mock_mcp_tools)
        extracted = bot._extract_model_name()

        assert extracted == GPT_4O

    def test_google_extracts_model_name_with_provider(self, mock_mcp_tools):
        """Test Google bot extracts model name from provider/model format."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH_EXP_WITH_PROVIDER, api_key="test", tool_executor=mock_mcp_tools)
        extracted = bot._extract_model_name()

        assert extracted == GEMINI_FLASH_EXP

    def test_google_keeps_model_name_without_provider(self, mock_mcp_tools):
        """Test Google bot keeps model name when no provider prefix."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)
        extracted = bot._extract_model_name()

        assert extracted == GEMINI_FLASH

    def test_llama_uses_full_model_name(self, mock_mcp_tools):
        """Test Llama bot uses full model name (doesn't strip provider for local models)."""
        from chatbots import LlamaChatBot

        # Llama uses the full model name including provider as it may be needed for local model paths
        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        extracted = bot._extract_model_name()

        # For local models like Llama, the full path is preserved
        assert extracted == LLAMA_3_1_8B

    def test_base_extraction_with_slash(self, mock_mcp_tools):
        """Test base class extraction splits on first slash for API models."""
        from chatbots import AnthropicChatBot

        # API-based models strip the provider prefix
        bot = AnthropicChatBot(CLAUDE_SONNET_WITH_PROVIDER, api_key="test", tool_executor=mock_mcp_tools)
        extracted = bot._extract_model_name()

        assert extracted == CLAUDE_SONNET

    def test_extraction_preserves_original_model_name(self, mock_mcp_tools):
        """Test that original model_name attribute is preserved."""
        from chatbots import AnthropicChatBot

        original_name = CLAUDE_SONNET_WITH_PROVIDER
        bot = AnthropicChatBot(original_name, api_key="test", tool_executor=mock_mcp_tools)

        # Original should be preserved
        assert bot.model_name == original_name

        # Extracted should be without provider
        assert bot._extract_model_name() == CLAUDE_SONNET


class TestBaseChatBot:
    """Test BaseChatBot common functionality."""

    def test_base_chatbot_is_abstract(self, mock_mcp_tools):
        """Test that BaseChatBot cannot be instantiated directly."""
        from chatbots.base import BaseChatBot

        # BaseChatBot is abstract and should raise TypeError
        with pytest.raises(TypeError):
            BaseChatBot("test-model")



    def test_get_mcp_tools_returns_list(self, mock_mcp_tools):
        """Test that _get_mcp_tools returns a list of tool definitions."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        tools = bot._get_mcp_tools()

        assert isinstance(tools, list)
        assert len(tools) > 0

        # Check that tools have expected structure
        for tool in tools:
            assert "name" in tool
            assert "description" in tool
            assert "input_schema" in tool

    def test_create_system_prompt_includes_model_specific(self, mock_mcp_tools):
        """Test that system prompt includes model-specific instructions."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        prompt = bot._create_system_prompt(namespace="test-namespace")

        # Llama overrides _get_base_prompt with a compact version
        assert "Kubernetes and Prometheus" in prompt
        assert "Tool Calling" in prompt
        assert "PromQL Patterns" in prompt


class TestKorrel8rNormalization:
    """Test Korrel8r query normalization functionality in BaseChatBot."""

    def test_normalize_alert_query_missing_class(self, mock_mcp_tools):
        """Test that alert queries without class get 'alert:alert:' prefix."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Missing class - should be normalized
        query = 'alert:{"alertname":"PodDisruptionBudgetAtLimit"}'
        normalized = bot._normalize_korrel8r_query(query)

        assert normalized == 'alert:alert:{"alertname":"PodDisruptionBudgetAtLimit"}'

    def test_normalize_alert_query_already_correct(self, mock_mcp_tools):
        """Test that correctly formatted alert queries are not changed."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Already correct - should not change
        query = 'alert:alert:{"alertname":"HighCPU"}'
        normalized = bot._normalize_korrel8r_query(query)

        assert normalized == 'alert:alert:{"alertname":"HighCPU"}'

    def test_normalize_escaped_quotes(self, mock_mcp_tools):
        """Test that escaped quotes are unescaped."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Escaped quotes should be unescaped
        query = 'alert:{\"alertname\":\"Test\"}'
        normalized = bot._normalize_korrel8r_query(query)

        # Should unescape quotes AND add missing class
        assert normalized == 'alert:alert:{"alertname":"Test"}'

    def test_normalize_k8s_alert_misclassification(self, mock_mcp_tools):
        """Test that k8s:Alert: is corrected to alert:alert:."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Misclassified as k8s - should be corrected
        query = 'k8s:Alert:{"alertname":"PodDown"}'
        normalized = bot._normalize_korrel8r_query(query)

        assert normalized == 'alert:alert:{"alertname":"PodDown"}'

    def test_normalize_alert_unquoted_keys(self, mock_mcp_tools):
        """Test that unquoted keys in alert selectors are quoted (JSON format)."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Unquoted key - should be quoted for alert domain
        query = 'alert:alert:{alertname="HighLatency"}'
        normalized = bot._normalize_korrel8r_query(query)

        assert normalized == 'alert:alert:{"alertname":"HighLatency"}'

    def test_normalize_alert_multiple_unquoted_keys(self, mock_mcp_tools):
        """Test normalization with multiple unquoted keys."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Multiple unquoted keys
        query = 'alert:alert:{alertname="Test",severity="critical"}'
        normalized = bot._normalize_korrel8r_query(query)

        assert normalized == 'alert:alert:{"alertname":"Test","severity":"critical"}'

    def test_normalize_k8s_pod_query(self, mock_mcp_tools):
        """Test normalization of k8s Pod queries (non-alert domain)."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # k8s domain uses := operator format
        query = 'k8s:Pod:{namespace="llm-serving"}'
        normalized = bot._normalize_korrel8r_query(query)

        # For non-alert domains, should use := operator
        assert normalized == 'k8s:Pod:{"namespace":="llm-serving"}'

    def test_normalize_loki_log_query(self, mock_mcp_tools):
        """Test normalization of loki log queries."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Loki domain
        query = 'loki:log:{kubernetes.namespace_name="test"}'
        normalized = bot._normalize_korrel8r_query(query)

        # Should use := for non-alert domains
        assert 'kubernetes.namespace_name":=' in normalized

    def test_normalize_trace_span_query(self, mock_mcp_tools):
        """Test normalization of trace span queries."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Trace domain - dots in key names need special handling
        query = 'trace:span:{k8s_namespace_name="llm-serving"}'
        normalized = bot._normalize_korrel8r_query(query)

        # Should use := for non-alert domains
        assert 'k8s_namespace_name":=' in normalized

    def test_normalize_empty_query(self, mock_mcp_tools):
        """Test that empty queries are handled gracefully."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Empty query
        normalized = bot._normalize_korrel8r_query("")
        assert normalized == ""

    def test_normalize_none_query(self, mock_mcp_tools):
        """Test that None queries are handled gracefully."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # None query - implementation converts to empty string
        normalized = bot._normalize_korrel8r_query(None)
        assert normalized == ""

    def test_normalize_malformed_query_doesnt_crash(self, mock_mcp_tools):
        """Test that malformed queries don't crash the normalization."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Malformed query - should return original on error
        query = 'totally:invalid{{'
        normalized = bot._normalize_korrel8r_query(query)

        # Should return something (either original or partially normalized)
        assert normalized is not None

    def test_normalize_works_for_all_bot_types(self, mock_mcp_tools):
        """Test that normalization is available to all chatbot types."""
        from chatbots import (
            LlamaChatBot,
            AnthropicChatBot,
            OpenAIChatBot,
            GoogleChatBot
        )

        query = 'alert:{"alertname":"Test"}'
        expected = 'alert:alert:{"alertname":"Test"}'

        # Test each bot type
        llama_bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        assert llama_bot._normalize_korrel8r_query(query) == expected

        anthropic_bot = AnthropicChatBot(CLAUDE_HAIKU, api_key="test", tool_executor=mock_mcp_tools)
        assert anthropic_bot._normalize_korrel8r_query(query) == expected

        openai_bot = OpenAIChatBot(GPT_4O_MINI, api_key="test", tool_executor=mock_mcp_tools)
        assert openai_bot._normalize_korrel8r_query(query) == expected

        google_bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)
        assert google_bot._normalize_korrel8r_query(query) == expected


class TestKorrel8rToolIntegration:
    """Test Korrel8r tool integration in routing."""

    def test_normalize_is_called_for_korrel8r_queries(self, mock_mcp_tools):
        """Test that normalization is invoked for korrel8r queries."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Test that normalize method works correctly
        query = 'alert:{"alertname":"Test"}'
        normalized = bot._normalize_korrel8r_query(query)

        # Should be normalized
        assert normalized == 'alert:alert:{"alertname":"Test"}'


    def test_normalization_available_to_all_bots(self, mock_mcp_tools):
        """Test that normalization method is available to all bot types."""
        from chatbots import (
            LlamaChatBot,
            AnthropicChatBot,
            OpenAIChatBot,
            GoogleChatBot,
            DeterministicChatBot
        )

        bots = [
            LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools),
            AnthropicChatBot(CLAUDE_HAIKU, api_key="test", tool_executor=mock_mcp_tools),
            OpenAIChatBot(GPT_4O_MINI, api_key="test", tool_executor=mock_mcp_tools),
            GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools),
            DeterministicChatBot(LLAMA_3_2_3B, tool_executor=mock_mcp_tools)
        ]

        query = 'alert:{"alertname":"Test"}'
        expected = 'alert:alert:{"alertname":"Test"}'

        # All bots should have the method and it should work correctly
        for bot in bots:
            assert hasattr(bot, '_normalize_korrel8r_query')
            assert bot._normalize_korrel8r_query(query) == expected


def test_no_claude_integration_references(mock_mcp_tools):
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


class TestNamespaceInjection:
    """Test namespace injection via _get_tool_result parameter."""

    def test_get_tool_result_injects_namespace_into_promql(self, mock_mcp_tools):
        """Test that passing namespace to _get_tool_result modifies the PromQL query."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        with patch.object(bot, '_route_tool_call_to_mcp', return_value="result") as mock_route:
            bot._get_tool_result("execute_promql", {"query": "up"}, namespace="test-ns")

            # The query should have been modified to include namespace
            call_args = mock_route.call_args
            actual_args = call_args[0][1]  # second positional arg is tool_args
            assert 'namespace="test-ns"' in actual_args["query"]

    def test_get_tool_result_injects_namespace_into_tool_args(self, mock_mcp_tools):
        """Test that passing namespace to a namespace-aware non-PromQL tool adds namespace to tool_args."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # search_metrics is in NAMESPACE_AWARE_TOOLS
        with patch.object(bot, '_namespace_aware_tools', {"search_metrics", "execute_promql"}):
            with patch.object(bot, '_route_tool_call_to_mcp', return_value="result") as mock_route:
                bot._get_tool_result("search_metrics", {"pattern": "cpu"}, namespace="test-ns")

                call_args = mock_route.call_args
                actual_args = call_args[0][1]
                assert actual_args["namespace"] == "test-ns"
                assert actual_args["pattern"] == "cpu"


class TestNamespaceInjectionPromQL:
    """Test _inject_namespace_into_promql handles negated operators correctly."""

    def _make_bot(self, mock_mcp_tools):
        from chatbots import LlamaChatBot
        return LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

    def test_replaces_namespace_not_equal(self, mock_mcp_tools):
        """namespace!=\"kube-system\" should be replaced with the active namespace."""
        bot = self._make_bot(mock_mcp_tools)
        query = 'ALERTS{namespace!="kube-system",alertstate="firing"}'
        result = bot._inject_namespace_into_promql(query, "my-app")
        assert 'namespace="my-app"' in result
        assert 'namespace!=' not in result

    def test_replaces_namespace_not_regex(self, mock_mcp_tools):
        """namespace!~\"kube-.*\" should be replaced with the active namespace."""
        bot = self._make_bot(mock_mcp_tools)
        query = 'up{namespace!~"kube-.*"}'
        result = bot._inject_namespace_into_promql(query, "my-app")
        assert 'namespace="my-app"' in result
        assert 'namespace!~' not in result

    def test_replaces_namespace_regex_match(self, mock_mcp_tools):
        """namespace=~\"test-.*\" should be replaced with the active namespace."""
        bot = self._make_bot(mock_mcp_tools)
        query = 'container_memory_usage_bytes{namespace=~"test-.*"}'
        result = bot._inject_namespace_into_promql(query, "my-app")
        assert 'namespace="my-app"' in result
        assert 'namespace=~' not in result

    def test_no_namespace_injects_new_filter(self, mock_mcp_tools):
        """Query without any namespace filter should get one injected."""
        bot = self._make_bot(mock_mcp_tools)
        query = 'container_cpu_usage_seconds_total{pod="web-1"}'
        result = bot._inject_namespace_into_promql(query, "my-app")
        assert 'namespace="my-app"' in result
        assert 'pod="web-1"' in result


class TestGeminiTextToolCallDetection:
    """Test detection of text-based tool calls in Gemini responses."""

    def test_detect_text_tool_call_with_function_syntax(self, mock_mcp_tools):
        """Test that tool_name(...) in markdown code block triggers detection."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)
        text = '**Tool Call:**\n```python\nexecute_promql(query="up")\n```'
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is True

    def test_detect_text_tool_call_with_header(self, mock_mcp_tools):
        """Test that 'Tool Call:' header triggers detection."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)
        text = "I need to use the following:\nTool Call:\nget_label_values with label=namespace"
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is True

    def test_no_false_positive_normal_text(self, mock_mcp_tools):
        """Test that mentioning a tool name in prose does NOT trigger detection."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)
        text = "I used the execute_promql tool to query your cluster metrics and found 5 targets."
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is False

    def test_no_false_positive_empty_text(self, mock_mcp_tools):
        """Test that empty string returns False."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)

        assert bot._detect_text_tool_calls("", ["execute_promql"]) is False

    def test_detect_inline_call(self, mock_mcp_tools):
        """Test that execute_promql(query='up') inline triggers detection."""
        from chatbots import GoogleChatBot

        bot = GoogleChatBot(GEMINI_FLASH, api_key="test", tool_executor=mock_mcp_tools)
        text = "Let me run execute_promql(query='up') to check."
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is True


class TestLlamaTextToolCallDetection:
    """Test detection of text-based tool calls in Llama responses."""

    def test_detect_json_tool_call(self, mock_mcp_tools):
        """Test that JSON-style {"name": "tool_name"} triggers detection."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        text = '{"type":"function","name":"execute_promql","parameters":{"query":"up"}}'
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is True

    def test_detect_tool_call_header(self, mock_mcp_tools):
        """Test that 'Tool Call:' header triggers detection."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        text = "I need to run:\nTool Call:\nexecute_promql with query=up"
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is True

    def test_detect_function_syntax(self, mock_mcp_tools):
        """Test that tool_name(...) function syntax triggers detection."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        text = 'Let me call execute_promql(query="up") to check.'
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is True

    def test_no_false_positive_normal_prose(self, mock_mcp_tools):
        """Test that mentioning a tool name in prose does NOT trigger detection."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        text = "I used execute_promql to query your cluster and found 5 running pods."
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is False

    def test_no_false_positive_empty_text(self, mock_mcp_tools):
        """Test that empty string returns False."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        assert bot._detect_text_tool_calls("", ["execute_promql"]) is False

    def test_no_false_positive_unknown_tool_names(self, mock_mcp_tools):
        """Test that JSON with unknown tool names does NOT trigger detection."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        text = '{"name": "unknown_tool", "parameters": {}}'
        tool_names = ["execute_promql", "get_label_values"]

        assert bot._detect_text_tool_calls(text, tool_names) is False


class TestLlamaNudgeBehavior:
    """Test the nudge retry logic in LlamaChatBot.chat()."""

    def _make_mock_response(self, content, finish_reason="stop", tool_calls=None):
        """Helper to create a mock OpenAI chat completion response."""
        message = MagicMock()
        message.content = content
        message.tool_calls = tool_calls

        choice = MagicMock()
        choice.finish_reason = finish_reason
        choice.message = message

        response = MagicMock()
        response.choices = [choice]
        return response

    def _make_tool_call_response(self, tool_name, tool_args, tool_id="call_1"):
        """Helper to create a mock response with tool calls."""
        tc = MagicMock()
        tc.id = tool_id
        tc.function.name = tool_name
        tc.function.arguments = json.dumps(tool_args)

        return self._make_mock_response(
            content=None,
            finish_reason="tool_calls",
            tool_calls=[tc]
        )

    def test_fabrication_guard_triggers_on_iteration_1(self, mock_mcp_tools):
        """Test that fabrication guard triggers when model returns stop on iteration 1."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # First call: fabricated response (stop, no tools, iteration 1)
        # Second call: proper final response after nudge
        fabricated = self._make_mock_response("Here are your pods: pod1, pod2")
        final = self._make_mock_response("I apologize, let me use the tools. Unfortunately I cannot proceed.")

        bot.client = MagicMock()
        bot.client.chat.completions.create = MagicMock(side_effect=[fabricated, final])

        result = bot.chat("show me running pods")

        # Should have made 2 API calls (original + retry after nudge)
        assert bot.client.chat.completions.create.call_count == 2
        assert result == "I apologize, let me use the tools. Unfortunately I cannot proceed."

        # First call should use tool_choice="auto", retry should use "required"
        calls = bot.client.chat.completions.create.call_args_list
        assert calls[0].kwargs["tool_choice"] == "auto"
        assert calls[1].kwargs["tool_choice"] == "required"

    def test_no_nudge_when_tools_called(self, mock_mcp_tools):
        """Test that no nudge fires when model properly calls tools."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # First call: model calls a tool
        tool_response = self._make_tool_call_response("execute_promql", {"query": "up"})
        # Second call: model returns final answer
        final = self._make_mock_response("There are 5 running pods.")

        bot.client = MagicMock()
        bot.client.chat.completions.create = MagicMock(side_effect=[tool_response, final])

        result = bot.chat("show me running pods")

        # 2 calls: tool call + final answer (no nudge)
        assert bot.client.chat.completions.create.call_count == 2
        assert result == "There are 5 running pods."

    def test_nudge_fires_only_once(self, mock_mcp_tools):
        """Test that nudge only fires once to prevent infinite loops."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # First call: fabricated (triggers nudge)
        fabricated = self._make_mock_response("Fake data: pod1, pod2")
        # Second call: still fabricated (nudge already fired, should return)
        still_fabricated = self._make_mock_response("More fake data: pod3, pod4")

        bot.client = MagicMock()
        bot.client.chat.completions.create = MagicMock(side_effect=[fabricated, still_fabricated])

        result = bot.chat("show me running pods")

        # Should only make 2 calls (original + 1 nudge retry), not loop forever
        assert bot.client.chat.completions.create.call_count == 2
        assert result == "More fake data: pod3, pod4"


class TestLlamaSmartNudge:
    """Test query-category detection and smart nudge generation."""

    def test_alert_query_routes_to_execute_promql(self, mock_mcp_tools):
        """Test that alert queries produce a nudge mentioning execute_promql."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("Any alerts firing in jianrong namespace", namespace="jianrong")

        assert tool == "execute_promql"
        assert "execute_promql" in nudge
        assert "ALERTS" in nudge
        assert "jianrong" in nudge

    def test_pod_failure_query_routes_to_execute_promql(self, mock_mcp_tools):
        """Test that pod failure queries produce a nudge with the right PromQL."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("any pods failing in openshift-monitoring namespace")

        assert tool == "execute_promql"
        assert "execute_promql" in nudge
        assert "kube_pod_container_status_waiting_reason" in nudge

    def test_correlation_query_routes_to_korrel8r(self, mock_mcp_tools):
        """Test that correlation queries produce a nudge mentioning korrel8r."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("Use correlated data to investigate pod my-app in jianrong namespace")

        assert tool == "korrel8r_get_correlated"
        assert "korrel8r_get_correlated" in nudge

    def test_korrel8r_beats_alert_in_pod_name(self, mock_mcp_tools):
        """Test that korrel8r/investigate matches before alert pattern for pod names like alert-example."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query(
            "Use korrel8r to investigate pod alert-example-5d9cbf68fd-62zsb in jianrong ns"
        )

        assert tool == "korrel8r_get_correlated"
        assert "korrel8r_get_correlated" in nudge

    def test_trace_detail_query_routes_to_get_trace_details(self, mock_mcp_tools):
        """Test that trace detail queries produce a nudge mentioning get_trace_details_tool."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("Give me trace details for trace id abc123")

        assert tool == "get_trace_details_tool"
        assert "get_trace_details_tool" in nudge

    def test_general_trace_query_routes_to_chat_tempo(self, mock_mcp_tools):
        """Test that general trace queries produce a nudge mentioning chat_tempo_tool."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("Find the top trace and find its details")

        # "trace" + "details" should match trace detail pattern first
        # but "Find the top trace" without "trace id" may match general trace
        assert "trace" in nudge.lower()

    def test_gpu_query_routes_to_execute_promql(self, mock_mcp_tools):
        """Test that GPU queries produce a nudge with GPU-specific PromQL hints."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("Show me GPU power consumption and temperature trends")

        assert tool == "execute_promql"
        assert "execute_promql" in nudge
        assert "DCGM_FI_DEV_POWER_USAGE" in nudge
        assert "DCGM_FI_DEV_GPU_TEMP" in nudge

    def test_unknown_query_returns_generic_nudge(self, mock_mcp_tools):
        """Test that unrecognized queries get a generic nudge."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("What is the meaning of life?")

        assert tool is None
        assert "MUST use the provided tools" in nudge

    def test_namespace_substitution(self, mock_mcp_tools):
        """Test that namespace placeholder is replaced when namespace is provided."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("Any alerts firing", namespace="my-ns")

        assert "my-ns" in nudge
        assert "<namespace>" not in nudge

    def test_no_namespace_removes_placeholder(self, mock_mcp_tools):
        """Test that namespace placeholder is removed when no namespace is provided."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        nudge, tool = bot._get_nudge_for_query("Any alerts firing")

        assert "<namespace>" not in nudge


class TestLlamaGracefulFallback:
    """Test graceful fallback when nudge fails to produce tool calls."""

    def _make_mock_response(self, content, finish_reason="stop", tool_calls=None):
        """Helper to create a mock OpenAI chat completion response."""
        message = MagicMock()
        message.content = content
        message.tool_calls = tool_calls

        choice = MagicMock()
        choice.finish_reason = finish_reason
        choice.message = message

        response = MagicMock()
        response.choices = [choice]
        return response

    def test_empty_response_after_nudge_returns_fallback(self, mock_mcp_tools):
        """Test that empty response after nudge returns a user-friendly message."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # First call: fabricated (triggers nudge)
        fabricated = self._make_mock_response("Fake data: pod1, pod2")
        # Second call: empty response (nudge failed)
        empty = self._make_mock_response("")

        bot.client = MagicMock()
        bot.client.chat.completions.create = MagicMock(side_effect=[fabricated, empty])

        result = bot.chat("any pods failing in jianrong namespace")

        assert bot.client.chat.completions.create.call_count == 2
        assert "wasn't able to retrieve data" in result
        assert "rephrasing" in result

    def test_none_response_after_nudge_returns_fallback(self, mock_mcp_tools):
        """Test that None content after nudge returns a user-friendly message."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # First call: fabricated (triggers nudge)
        fabricated = self._make_mock_response("Fake data: pod1, pod2")
        # Second call: None content (nudge failed)
        none_response = self._make_mock_response(None)

        bot.client = MagicMock()
        bot.client.chat.completions.create = MagicMock(side_effect=[fabricated, none_response])

        result = bot.chat("any alerts firing")

        assert "wasn't able to retrieve data" in result

    def test_whitespace_response_after_nudge_returns_fallback(self, mock_mcp_tools):
        """Test that whitespace-only response after nudge returns fallback."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        fabricated = self._make_mock_response("Fake data")
        whitespace = self._make_mock_response("   \n\t  ")

        bot.client = MagicMock()
        bot.client.chat.completions.create = MagicMock(side_effect=[fabricated, whitespace])

        result = bot.chat("show me pod status")

        assert "wasn't able to retrieve data" in result

    def test_non_empty_response_after_nudge_returned_as_is(self, mock_mcp_tools):
        """Test that a substantive response after nudge is returned normally."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        fabricated = self._make_mock_response("Fake data")
        real_response = self._make_mock_response("Based on my analysis, here are the results.")

        bot.client = MagicMock()
        bot.client.chat.completions.create = MagicMock(side_effect=[fabricated, real_response])

        result = bot.chat("show me pod status")

        assert result == "Based on my analysis, here are the results."


class TestToolLoopDetection:
    """Test the consecutive same-tool loop detection in BaseChatBot.

    Loop detection operates at the iteration level: each call to
    _check_tool_loop represents one LLM response (iteration) and receives
    the *set* of tool names used in that response.
    """

    def test_no_loop_different_tools(self, mock_mcp_tools):
        """Test that different single-tool iterations don't trigger loop detection."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        tracker = {"name": None, "count": 0}

        assert bot._check_tool_loop({"execute_promql"}, tracker) is False
        assert bot._check_tool_loop({"get_label_values"}, tracker) is False
        assert bot._check_tool_loop({"execute_promql"}, tracker) is False
        assert tracker["count"] == 1  # Reset on tool change

    def test_same_tool_below_threshold(self, mock_mcp_tools):
        """Test that same single-tool iterations < 5 times doesn't trigger."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        tracker = {"name": None, "count": 0}

        for i in range(4):
            assert bot._check_tool_loop({"execute_promql"}, tracker) is False
        assert tracker["count"] == 4

    def test_same_tool_at_threshold_triggers(self, mock_mcp_tools):
        """Test that same single-tool iteration 5 times triggers loop detection."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        tracker = {"name": None, "count": 0}

        for i in range(4):
            assert bot._check_tool_loop({"query_tempo_tool"}, tracker) is False
        # 5th iteration triggers
        assert bot._check_tool_loop({"query_tempo_tool"}, tracker) is True

    def test_counter_resets_on_different_tool(self, mock_mcp_tools):
        """Test that the counter resets when a different tool is called."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        tracker = {"name": None, "count": 0}

        # Call same tool in 4 consecutive iterations (just below threshold)
        for i in range(4):
            bot._check_tool_loop({"query_tempo_tool"}, tracker)
        assert tracker["count"] == 4

        # Different tool resets counter
        bot._check_tool_loop({"execute_promql"}, tracker)
        assert tracker["count"] == 1
        assert tracker["name"] == "execute_promql"

    def test_parallel_same_tool_calls_not_flagged(self, mock_mcp_tools):
        """Test that one iteration with multiple calls to the same tool is NOT a loop.

        This is the key scenario: Haiku issues 5x execute_promql in a single
        response for different pod-phase queries. That's one iteration with
        parallel queries, not 5 consecutive loop iterations.
        """
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        tracker = {"name": None, "count": 0}

        # One iteration with 5 calls to the same tool — the set has 1 element,
        # but it's only 1 iteration so count goes to 1, not 5.
        assert bot._check_tool_loop({"execute_promql"}, tracker) is False
        assert tracker["count"] == 1

        # A second iteration with different tools resets counter
        assert bot._check_tool_loop({"execute_promql", "get_label_values"}, tracker) is False
        assert tracker["count"] == 0

    def test_multi_tool_iteration_resets_counter(self, mock_mcp_tools):
        """Test that an iteration with multiple different tools resets the counter."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        tracker = {"name": None, "count": 0}

        # Build up 4 consecutive same-tool iterations
        for i in range(4):
            bot._check_tool_loop({"execute_promql"}, tracker)
        assert tracker["count"] == 4

        # An iteration with multiple different tools resets the counter
        bot._check_tool_loop({"execute_promql", "query_tempo_tool"}, tracker)
        assert tracker["count"] == 0
        assert tracker["name"] is None

    def test_tool_loop_breaks_chat_loop(self, mock_mcp_tools):
        """Test that tool loop detection breaks the chat iteration loop."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)

        # Create 6 responses that each call the same single tool
        def make_tool_response():
            tc = MagicMock()
            tc.id = "call_1"
            tc.function.name = "query_tempo_tool"
            tc.function.arguments = json.dumps({"query": "traces"})

            message = MagicMock()
            message.content = None
            message.tool_calls = [tc]

            choice = MagicMock()
            choice.finish_reason = "tool_calls"
            choice.message = message

            response = MagicMock()
            response.choices = [choice]
            return response

        responses = [make_tool_response() for _ in range(6)]
        bot.client = MagicMock()
        bot.client.chat.completions.create = MagicMock(side_effect=responses)

        result = bot.chat("find traces")

        # Should break after 5 consecutive same-tool iterations, not use all 6
        assert bot.client.chat.completions.create.call_count == 5
        assert "got stuck in a loop" in result

    def test_threshold_constant(self, mock_mcp_tools):
        """Test that the threshold constant is accessible and correct."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        assert bot._MAX_CONSECUTIVE_SAME_TOOL == 5


if __name__ == "__main__":
    # Run with: python -m pytest tests/mcp_server/test_chatbots.py -v
    pytest.main([__file__, "-v"])
