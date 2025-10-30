"""
Anthropic Claude Chat Bot Implementation

This module provides Anthropic Claude-specific implementation using the official SDK.
"""

import os
import logging
from typing import Optional, Callable

from .base import BaseChatBot

logger = logging.getLogger(__name__)


class AnthropicChatBot(BaseChatBot):
    """Anthropic Claude implementation with native tool calling."""

    def _get_api_key(self) -> Optional[str]:
        """Get Anthropic API key from environment."""
        return os.getenv("ANTHROPIC_API_KEY")

    def _get_max_tool_result_length(self) -> int:
        """Claude supports 200K token context - 15K chars is reasonable."""
        return 15000

    def __init__(self, model_name: str, api_key: Optional[str] = None):
        super().__init__(model_name, api_key)

        # Import Anthropic SDK
        try:
            import anthropic
            self.client = anthropic.Anthropic(api_key=self.api_key)
        except ImportError:
            logger.error("Anthropic SDK not installed. Install with: pip install anthropic")
            self.client = None

    def _get_model_specific_instructions(self) -> str:
        """Anthropic Claude-specific instructions."""
        return """---

**CLAUDE-SPECIFIC INSTRUCTIONS:**

**Your Strengths:**
- Superior long-context reasoning (200K tokens)
- Highly reliable tool calling
- Excellent at nuanced analysis and detailed breakdowns

**Best Practices:**
- Leverage your strong reasoning for comprehensive analysis
- Provide detailed pod-level and namespace-level breakdowns
- Use your tool calling reliability for multi-step analysis"""

    def chat(self, user_question: str, namespace: Optional[str] = None, scope: Optional[str] = None, progress_callback: Optional[Callable] = None) -> str:
        """Chat with Anthropic Claude using tool calling."""
        if not self.client:
            return "Error: Anthropic SDK not installed. Please install it with: pip install anthropic"

        if not self.api_key:
            return f"API key required for Anthropic model {self.model_name}. Please provide an API key."

        try:
            # Create system prompt
            system_prompt = self._create_system_prompt(namespace)

            # Get model name suitable for Anthropic API
            model_name = self._extract_model_name()

            logger.info(f"🎯 AnthropicChatBot.chat() - Using Anthropic API with model: {model_name} (original: {self.model_name})")

            # MCP tools are already in Anthropic format
            claude_tools = self._get_mcp_tools()

            # Initial message
            messages = [{"role": "user", "content": user_question}]

            # Iterative tool calling loop
            max_iterations = 30
            iteration = 0

            while iteration < max_iterations:
                iteration += 1
                logger.info(f"🤖 Anthropic tool calling iteration {iteration}")

                if progress_callback:
                    progress_callback(f"🤖 Thinking... (iteration {iteration})")

                # Call Anthropic API
                response = self.client.messages.create(
                    model=model_name,
                    max_tokens=4000,
                    system=system_prompt,
                    messages=messages,
                    tools=claude_tools
                )

                # Add assistant's response to conversation
                messages.append({
                    "role": "assistant",
                    "content": response.content
                })

                # If Claude wants to use tools, execute them
                if response.stop_reason == "tool_use":
                    logger.info("Anthropic is using tools")

                    tool_results = []
                    for content_block in response.content:
                        if content_block.type == "tool_use":
                            tool_name = content_block.name
                            tool_args = content_block.input
                            tool_id = content_block.id

                            logger.info(f"🔧 Calling tool: {tool_name}")
                            if progress_callback:
                                progress_callback(f"🔧 Using tool: {tool_name}")

                            # Get tool result with automatic truncation
                            tool_result = self._get_tool_result(tool_name, tool_args)

                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_id,
                                "content": tool_result
                            })

                    # Add tool results to conversation
                    messages.append({
                        "role": "user",
                        "content": tool_results
                    })

                    # Limit conversation history
                    if len(messages) > 8:
                        messages = messages[-8:]

                    # Continue loop
                    continue

                else:
                    # Model is done, extract final text response
                    final_response = ""
                    for content_block in response.content:
                        if content_block.type == "text":
                            final_response += content_block.text

                    logger.info(f"Anthropic tool calling completed in {iteration} iterations")
                    return final_response

            # Hit max iterations
            logger.warning(f"Hit max iterations ({max_iterations})")
            return "Analysis incomplete. Please try a more specific question."

        except Exception as e:
            logger.error(f"Error in Anthropic chat: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return f"Error during Anthropic tool calling: {str(e)}"
