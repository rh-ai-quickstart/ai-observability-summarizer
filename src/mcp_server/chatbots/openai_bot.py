"""
OpenAI GPT Chat Bot Implementation

This module provides OpenAI GPT-specific implementation using the official SDK.
"""

import json
import logging
from typing import Optional, Callable, List, Dict, Any

from .base import BaseChatBot

logger = logging.getLogger(__name__)


class OpenAIChatBot(BaseChatBot):
    """OpenAI GPT implementation with native tool calling."""

    def __init__(self, model_name: str, api_key: Optional[str] = None):
        super().__init__(model_name, api_key)

        # Import OpenAI SDK
        try:
            from openai import OpenAI
            self.client = OpenAI(api_key=self.api_key)
        except ImportError:
            logger.error("OpenAI SDK not installed. Install with: pip install openai")
            self.client = None

    def _get_model_specific_instructions(self) -> str:
        """OpenAI GPT-specific instructions."""
        return """---

**GPT-SPECIFIC INSTRUCTIONS:**

**Your Strengths:**
- Strong general-purpose performance
- Reliable tool calling with function API
- Good balance of speed and accuracy

**Best Practices:**
- Use clear, structured queries with proper grouping
- Provide detailed breakdowns by pod and namespace
- Balance comprehensiveness with conciseness"""

    def _convert_tools_to_openai_format(self) -> List[Dict[str, Any]]:
        """Convert MCP tools to OpenAI function calling format."""
        tools = self._get_mcp_tools()
        openai_tools = []
        for tool in tools:
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["input_schema"]
                }
            })
        return openai_tools

    def chat(self, user_question: str, namespace: Optional[str] = None, scope: Optional[str] = None, progress_callback: Optional[Callable] = None) -> str:
        """Chat with OpenAI GPT using tool calling."""
        if not self.client:
            return "Error: OpenAI SDK not installed. Please install it with: pip install openai"

        if not self.api_key:
            return f"API key required for OpenAI model {self.model_name}. Please provide an API key."

        try:
            # Create system prompt
            system_prompt = self._create_system_prompt(namespace)

            # Get model name from config
            model_name = self.model_config.get("modelName", "gpt-4o-mini")

            # Prepare messages
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_question}
            ]

            # Convert tools to OpenAI format
            openai_tools = self._convert_tools_to_openai_format()

            # Iterative tool calling loop
            max_iterations = 30
            iteration = 0

            while iteration < max_iterations:
                iteration += 1
                logger.info(f"🤖 OpenAI tool calling iteration {iteration}")

                if progress_callback:
                    progress_callback(f"🤖 Thinking... (iteration {iteration})")

                # Call OpenAI API
                response = self.client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    tools=openai_tools,
                    temperature=0
                )

                choice = response.choices[0]
                finish_reason = choice.finish_reason
                message = choice.message

                # Convert message to dict for conversation history
                message_dict = {
                    "role": "assistant",
                    "content": message.content
                }

                # Add tool calls if present
                if message.tool_calls:
                    message_dict["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments
                            }
                        }
                        for tc in message.tool_calls
                    ]

                # Add assistant's response to conversation
                messages.append(message_dict)

                # If model wants to use tools, execute them
                if finish_reason == 'tool_calls' and message.tool_calls:
                    logger.info(f"OpenAI is using {len(message.tool_calls)} tool(s)")

                    tool_results = []
                    for tool_call in message.tool_calls:
                        tool_name = tool_call.function.name
                        tool_args_str = tool_call.function.arguments
                        tool_id = tool_call.id

                        logger.info(f"🔧 Calling tool: {tool_name}")
                        if progress_callback:
                            progress_callback(f"🔧 Using tool: {tool_name}")

                        # Parse arguments
                        try:
                            tool_args = json.loads(tool_args_str)
                        except json.JSONDecodeError:
                            tool_args = {}

                        # Route to MCP server
                        tool_result = self._route_tool_call_to_mcp(tool_name, tool_args)

                        # Truncate large results to prevent context overflow
                        # 10K is reasonable for GPT-4 (supports 128K token context)
                        if isinstance(tool_result, str) and len(tool_result) > 10000:
                            tool_result = tool_result[:10000] + "\n... [Result truncated due to size]"

                        tool_results.append({
                            "role": "tool",
                            "tool_call_id": tool_id,
                            "content": tool_result
                        })

                    # Add tool results to conversation
                    messages.extend(tool_results)

                    # Limit conversation history
                    if len(messages) > 10:
                        messages = [messages[0]] + messages[-8:]

                    # Continue loop
                    continue

                else:
                    # Model is done, return final response
                    final_response = message.content or ''

                    # Strip markdown code fences if OpenAI wrapped the response
                    if final_response.startswith('```') and final_response.endswith('```'):
                        lines = final_response.split('\n')
                        if lines[0].startswith('```'):
                            lines = lines[1:]
                        if lines and lines[-1].strip() == '```':
                            lines = lines[:-1]
                        final_response = '\n'.join(lines).strip()

                    logger.info(f"OpenAI tool calling completed in {iteration} iterations")
                    return final_response

            # Hit max iterations
            logger.warning(f"Hit max iterations ({max_iterations})")
            return "Analysis incomplete. Please try a more specific question."

        except Exception as e:
            logger.error(f"Error in OpenAI chat: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return f"Error during OpenAI tool calling: {str(e)}"
