"""
Chat Bot Factory

This module provides a factory function to create the appropriate chatbot
based on model capabilities and provider.
"""

import logging
from typing import Optional

from .base import BaseChatBot
from .anthropic_bot import AnthropicChatBot
from .openai_bot import OpenAIChatBot
from .google_bot import GoogleChatBot
from .llama_bot import LlamaChatBot
from .deterministic_bot import DeterministicChatBot

logger = logging.getLogger(__name__)


def create_chatbot(model_name: str, api_key: Optional[str] = None) -> BaseChatBot:
    """
    Factory function to create the appropriate chatbot based on model capabilities.

    Args:
        model_name: Name of the model to use
        api_key: Optional API key for external models

    Returns:
        Instance of the appropriate chatbot class

    Examples:
        >>> chatbot = create_chatbot("gpt-4o-mini", api_key="sk-...")
        >>> response = chatbot.chat("What's the CPU usage?")

        >>> chatbot = create_chatbot("meta-llama/Llama-3.1-8B-Instruct")
        >>> response = chatbot.chat("Check memory usage")
    """
    # Detect provider from model name pattern
    # This allows the factory to work without MODEL_CONFIG dependency
    is_external = False
    provider = "local"

    model_lower = model_name.lower()
    if "anthropic/" in model_lower or "claude" in model_lower:
        is_external = True
        provider = "anthropic"
        logger.info(f"Detected Anthropic model from name: {model_name}")
    elif "openai/" in model_lower or model_lower.startswith("gpt-") or model_lower.startswith("o1-"):
        is_external = True
        provider = "openai"
        logger.info(f"Detected OpenAI model from name: {model_name}")
    elif "google/" in model_lower or "gemini" in model_lower:
        is_external = True
        provider = "google"
        logger.info(f"Detected Google model from name: {model_name}")

    # Route to appropriate implementation based on provider and capabilities
    if is_external:
        if provider == "anthropic":
            logger.info(f"Creating AnthropicChatBot for {model_name}")
            return AnthropicChatBot(model_name, api_key)
        elif provider == "openai":
            logger.info(f"Creating OpenAIChatBot for {model_name}")
            return OpenAIChatBot(model_name, api_key)
        elif provider == "google":
            logger.info(f"Creating GoogleChatBot for {model_name}")
            return GoogleChatBot(model_name, api_key)
        else:
            logger.warning(f"Unknown external provider {provider}, using OpenAI as fallback")
            return OpenAIChatBot(model_name, api_key)
    else:
        # Local models - check if they support reliable tool calling
        model_lower = model_name.lower()

        # Llama 3.1 (8B+) has good tool calling (82.6%+ accuracy)
        if "llama-3.1" in model_lower or "llama-3-1" in model_lower:
            if any(size in model_lower for size in ["8b", "70b", "405b"]):
                logger.info(f"Creating LlamaChatBot for {model_name} (tool calling capable)")
                return LlamaChatBot(model_name, api_key)

        # Llama 3.3 (70B) has good tool calling (~85% accuracy)
        if "llama-3.3" in model_lower or "llama-3-3" in model_lower:
            if "70b" in model_lower:
                logger.info(f"Creating LlamaChatBot for {model_name} (tool calling capable)")
                return LlamaChatBot(model_name, api_key)

        # Llama 3.2 and smaller - use deterministic parsing (67% accuracy is too low)
        if "llama-3.2" in model_lower or "llama-3-2" in model_lower:
            logger.info(f"Creating DeterministicChatBot for {model_name} (67% tool calling accuracy - using deterministic parsing)")
            return DeterministicChatBot(model_name, api_key)

        # Unknown local models - use deterministic parsing for safety
        logger.info(f"Creating DeterministicChatBot for {model_name} (unknown capability - using deterministic parsing)")
        return DeterministicChatBot(model_name, api_key)
