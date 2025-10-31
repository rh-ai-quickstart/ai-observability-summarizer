"""
Llama Chat Bot Implementation (via LlamaStack)

This module provides Llama-specific implementation using LlamaStack's OpenAI-compatible API.
"""

import json
import logging
from typing import Optional, Callable, List, Dict, Any

from .base import BaseChatBot
from core.config import LLAMA_STACK_URL, LLM_API_TOKEN

logger = logging.getLogger(__name__)


class LlamaChatBot(BaseChatBot):
    """Llama implementation using LlamaStack with OpenAI-compatible API."""

    def _get_api_key(self) -> Optional[str]:
        """Local models don't require API keys."""
        return None

    def _get_max_tool_result_length(self) -> int:
        """Llama 3.1 supports 128K token context - 8K chars is reasonable."""
        return 8000

    def _extract_model_name(self) -> str:
        """LlamaStack expects the full model name including provider prefix.

        Override the base class method to return the full name.
        """
        return self.model_name

    def __init__(self, model_name: str, api_key: Optional[str] = None):
        super().__init__(model_name, api_key)

        # Import OpenAI SDK (LlamaStack is OpenAI-compatible)
        try:
            from openai import OpenAI
            self.client = OpenAI(
                base_url=f"{LLAMA_STACK_URL}/chat/completions".replace("/chat/completions", ""),
                api_key=LLM_API_TOKEN or "dummy"
            )
        except ImportError:
            logger.error("OpenAI SDK not installed. Install with: pip install openai")
            self.client = None

    def _get_model_specific_instructions(self) -> str:
        """Llama-specific instructions to avoid tool calling issues."""
        return """---

**LLAMA-SPECIFIC INSTRUCTIONS:**

**Tool Calling Format:**
- Use the provided tools via the API - do NOT output JSON tool calls as text
- When you want to use a tool, invoke it through the function calling mechanism
- Never output raw JSON like {{"name": "tool_name", "parameters": {{...}}}}

**PromQL Query Patterns - Use These Proven Patterns:**

For CPU queries:
- Use: sum(rate(container_cpu_usage_seconds_total[5m])) by (pod, namespace)
- NOT: container_cpu_usage_seconds_total alone

For Memory queries:
- Use: sum(container_memory_usage_bytes) by (pod, namespace)
- NOT: container_memory_usage_bytes alone

For GPU queries:
- Use: DCGM_FI_DEV_GPU_UTIL or gpu_usage with appropriate job label

For Pod Status queries:
- Use: kube_pod_status_phase == 1 to filter only active states
- Include namespace filter and grouping

**Key PromQL Rules:**
- Always use aggregation functions: sum(), avg(), max(), etc.
- Always group by (pod, namespace) for detailed breakdowns (or just by pod if namespace already filtered)
- Use rate() for counter metrics with time window like [5m]
- Filter boolean metrics with == 1 to show only true states
- Extract namespace from user query and add as label filter

**Response Formatting:**
- Use markdown formatting (bold, lists, etc.) for readability
- Do NOT wrap the response or sections in code blocks (no ``` markers)
- Format lists with proper markdown: `- Item` or `**Label:** value`
- Use bold (**text**) for emphasis and section headers

**Remember:**
- Always use tools through proper function calling, not by generating JSON text
- Use the query patterns above for accurate results
- Pay special attention to namespace filters in user queries
- Format your responses with clean markdown, not code blocks"""

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
        """Chat with Llama using LlamaStack OpenAI-compatible API."""
        if not self.client:
            return "Error: OpenAI SDK not installed. Please install it with: pip install openai"

        try:
            # Create system prompt
            system_prompt = self._create_system_prompt(namespace)

            # LlamaStack expects the full model name (override preserves it)
            model_id = self._extract_model_name()

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
                logger.info(f"🤖 LlamaStack tool calling iteration {iteration}")

                if progress_callback:
                    progress_callback(f"🤖 Thinking... (iteration {iteration})")

                # Call LlamaStack via OpenAI SDK
                response = self.client.chat.completions.create(
                    model=model_id,
                    messages=messages,
                    tools=openai_tools,
                    temperature=0
                )

                choice = response.choices[0]
                finish_reason = choice.finish_reason
                message = choice.message

                # Convert message to dict format for conversation history
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
                    logger.info(f"LlamaStack model is using {len(message.tool_calls)} tool(s)")

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

                        # Get tool result with automatic truncation
                        tool_result = self._get_tool_result(tool_name, tool_args)

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
                    logger.info(f"LlamaStack tool calling completed in {iteration} iterations")
                    return final_response

            # Hit max iterations
            logger.warning(f"Hit max iterations ({max_iterations})")
            return "Analysis incomplete. Please try a more specific question."

        except Exception as e:
            logger.error(f"Error in LlamaStack chat: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return f"Error during LlamaStack tool calling: {str(e)}"
