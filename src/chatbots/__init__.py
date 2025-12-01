"""
Chat Bots Package

This package provides multi-provider chat bot implementations with a clean
base class hierarchy.

Usage:
    from chatbots import create_chatbot

    # Create a chatbot using the factory function
    chatbot = create_chatbot("gpt-4o-mini", api_key="sk-...")
    response = chatbot.chat("What's the CPU usage?")

    # Or import specific implementations
    from chatbots import AnthropicChatBot, OpenAIChatBot

    anthropic_bot = AnthropicChatBot("claude-3-5-haiku", api_key="sk-ant-...")
    openai_bot = OpenAIChatBot("gpt-4o-mini", api_key="sk-...")

Architecture:
    - BaseChatBot: Abstract base class with common functionality
    - AnthropicChatBot: Anthropic Claude implementation
    - OpenAIChatBot: OpenAI GPT implementation
    - GoogleChatBot: Google Gemini implementation
    - LlamaChatBot: Local Llama models via LlamaStack
    - DeterministicChatBot: Fallback for small models
    - create_chatbot(): Factory function to create appropriate bot
"""

# Lazy imports to avoid loading SDKs until needed
def __getattr__(name):
    if name == 'BaseChatBot':
        from .base import BaseChatBot
        return BaseChatBot
    elif name == 'ToolExecutor':
        from .tool_executor import ToolExecutor
        return ToolExecutor
    elif name == 'AnthropicChatBot':
        from .anthropic_bot import AnthropicChatBot
        return AnthropicChatBot
    elif name == 'OpenAIChatBot':
        from .openai_bot import OpenAIChatBot
        return OpenAIChatBot
    elif name == 'GoogleChatBot':
        from .google_bot import GoogleChatBot
        return GoogleChatBot
    elif name == 'LlamaChatBot':
        from .llama_bot import LlamaChatBot
        return LlamaChatBot
    elif name == 'DeterministicChatBot':
        from .deterministic_bot import DeterministicChatBot
        return DeterministicChatBot
    elif name == 'create_chatbot':
        from .factory import create_chatbot
        return create_chatbot
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")

__all__ = [
    # Base class and interface
    'BaseChatBot',
    'ToolExecutor',

    # Provider-specific implementations
    'AnthropicChatBot',
    'OpenAIChatBot',
    'GoogleChatBot',
    'LlamaChatBot',
    'DeterministicChatBot',

    # Factory function (recommended)
    'create_chatbot',
]

# Version
__version__ = '1.0.0'
