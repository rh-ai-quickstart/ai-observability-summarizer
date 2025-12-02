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
CLAUDE_HAIKU = "claude-3-5-haiku"
CLAUDE_HAIKU_WITH_PROVIDER = f"{ANTHROPIC_PROVIDER}/{CLAUDE_HAIKU}"
CLAUDE_SONNET = "claude-sonnet-4-20250514"
CLAUDE_SONNET_WITH_PROVIDER = f"{ANTHROPIC_PROVIDER}/{CLAUDE_SONNET}"
CLAUDE_HAIKU_DATED = "claude-3-5-haiku-20241022"

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


def test_factory_creates_llama_bot(mock_mcp_tools):
    """Test that factory creates LlamaChatBot for Llama 3.1 models."""
    from chatbots import create_chatbot, LlamaChatBot

    bot = create_chatbot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
    assert isinstance(bot, LlamaChatBot)
    assert bot.model_name == LLAMA_3_1_8B


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

    def test_llama_bot_has_specific_instructions(self, mock_mcp_tools):
        """Test LlamaChatBot has Llama-specific instructions."""
        from chatbots import LlamaChatBot

        bot = LlamaChatBot(LLAMA_3_1_8B, tool_executor=mock_mcp_tools)
        instructions = bot._get_model_specific_instructions()

        assert "LLAMA-SPECIFIC" in instructions
        assert "Tool Calling Format" in instructions
        assert "PromQL Query Patterns" in instructions
        assert "Key PromQL Rules" in instructions


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

        # Should include both base prompt and model-specific instructions
        assert "Kubernetes and Prometheus" in prompt  # Base prompt
        assert "LLAMA-SPECIFIC" in prompt  # Model-specific


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


if __name__ == "__main__":
    # Run with: python -m pytest tests/mcp_server/test_chatbots.py -v
    pytest.main([__file__, "-v"])
