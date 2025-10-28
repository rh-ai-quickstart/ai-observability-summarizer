"""
Chat Bots Package

This package provides multi-provider chat bot implementations with a clean
base class hierarchy.

Usage:
    from mcp_server.chatbots import create_chatbot

    # Create a chatbot using the factory function
    chatbot = create_chatbot("gpt-4o-mini", api_key="sk-...")
    response = chatbot.chat("What's the CPU usage?")

    # Or import specific implementations
    from mcp_server.chatbots import AnthropicChatBot, OpenAIChatBot

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

from .base import BaseChatBot
from .anthropic_bot import AnthropicChatBot
from .openai_bot import OpenAIChatBot
from .google_bot import GoogleChatBot
from .llama_bot import LlamaChatBot
from .deterministic_bot import DeterministicChatBot
from .factory import create_chatbot

__all__ = [
    # Base class
    'BaseChatBot',

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
