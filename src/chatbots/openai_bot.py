"""
OpenAI GPT Chat Bot Implementation

This module provides OpenAI GPT-specific implementation using the official SDK.
"""

import os
import json
from typing import Optional, List, Dict, Any, Callable

from .base import BaseChatBot
from chatbots.tool_executor import ToolExecutor
from common.pylogger import get_python_logger

logger = get_python_logger()


class OpenAIChatBot(BaseChatBot):
    """OpenAI GPT implementation with native tool calling."""

    def _get_api_key(self) -> Optional[str]:
        """Get OpenAI API key from environment."""
        return os.getenv("OPENAI_API_KEY")

    def _get_max_tool_result_length(self) -> int:
        """GPT-4 supports 128K token context - 10K chars is reasonable."""
        return 10000

    def _get_base_url_from_config(self) -> Optional[str]:
        """Get custom base URL from model config (for MAAS, custom endpoints)."""
        try:
            from core.model_config_manager import get_model_config
            config = get_model_config()
            model_config = config.get(self.model_name, {})
            api_url = model_config.get("apiUrl", "")

            if api_url:
                # Extract base URL by removing /chat/completions suffix
                for suffix in ["/chat/completions", "/v1/chat/completions"]:
                    if api_url.endswith(suffix):
                        return api_url[:-len(suffix)]
                return api_url  # Return as-is if no known suffix
            return None
        except Exception as e:
            logger.warning(f"Could not get base_url from config: {e}")
            return None

    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        api_url: Optional[str] = None,
        tool_executor: ToolExecutor = None):
        super().__init__(model_name, api_key, tool_executor)

        # Import OpenAI SDK
        self._sdk_import_failed = False
        try:
            from openai import OpenAI
            # Only create client if API key is provided
            # This matches the pattern used by other providers
            if self.api_key:
                # Priority: 1) Passed api_url (from DEV mode), 2) Model config (production)
                base_url = None
                if api_url:
                    # Extract base URL by removing /chat/completions suffix if present
                    for suffix in ["/chat/completions", "/v1/chat/completions"]:
                        if api_url.endswith(suffix):
                            base_url = api_url[:-len(suffix)]
                            break
                    if not base_url:
                        base_url = api_url  # Use as-is if no known suffix
                    logger.info(f"Using passed api_url for {self.model_name}: {base_url}")
                else:
                    # Check if model config specifies custom base_url (for MAAS, custom endpoints)
                    base_url = self._get_base_url_from_config()
                    if base_url:
                        logger.info(f"Using custom base_url from config for {self.model_name}: {base_url}")

                if base_url:
                    self.client = OpenAI(api_key=self.api_key, base_url=base_url)
                else:
                    self.client = OpenAI(api_key=self.api_key)
            else:
                self.client = None
        except ImportError:
            logger.error("OpenAI SDK not installed. Install with: pip install openai")
            self._sdk_import_failed = True
            self.client = None

    def _get_model_specific_instructions(self) -> str:
        """OpenAI GPT-specific instructions."""
        return """---

**GPT-SPECIFIC INSTRUCTIONS:**

**MANDATORY — Metric Discovery Before Queries:**
You MUST call `search_metrics` or `search_metrics_by_category` BEFORE calling
`execute_promql`. NEVER guess metric names — they are non-obvious
(e.g., `vllm:gpu_cache_usage_perc` not `vllm:kv_cache_usage_percentage`,
`DCGM_FI_DEV_GPU_TEMP` not `DCGM_FI_DEV_TEMP`).

**CRITICAL — ALWAYS Execute Queries, NEVER Just Show Them:**
When you construct a PromQL query, you MUST immediately call `execute_promql` to run it
and get the actual data. NEVER show the query to the user without executing it first.

Correct flow:
1. `search_metrics("GPU temperature")` → discover `DCGM_FI_DEV_GPU_TEMP`
2. `execute_promql("avg(DCGM_FI_DEV_GPU_TEMP) by (pod)")` → get actual data
3. Present the results to the user

Wrong flow (DO NOT DO THIS):
1. `search_metrics("GPU temperature")` → discover `DCGM_FI_DEV_GPU_TEMP`
2. Tell the user "Here's the PromQL query: avg(DCGM_FI_DEV_GPU_TEMP) by (pod)" ❌ WRONG - you must EXECUTE it!

**Best Practices:**
- Provide detailed breakdowns by pod and namespace
- Balance comprehensiveness with conciseness
- Always execute your queries to provide real data"""

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

    def chat(
        self,
        user_question: str,
        namespace: Optional[str] = None,
        progress_callback: Optional[Callable] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """Chat with OpenAI GPT using tool calling."""
        if not self.client:
            if self._sdk_import_failed:
                return "Error: OpenAI SDK not installed. Please install it with: pip install openai"
            else:
                return f"Error: API key required for OpenAI model {self.model_name}. Please configure an API key in Settings."

        logger.info(f"🎯 OpenAIChatBot.chat() - Using OpenAI API with model: {self.model_name}")

        try:
            # Create system prompt
            system_prompt = self._create_system_prompt(namespace)

            # Get model name suitable for OpenAI API
            model_name = self._extract_model_name()

            # Prepare messages - start with system prompt
            messages = [{"role": "system", "content": system_prompt}]

            # Add conversation history if provided
            if conversation_history:
                logger.info(f"📜 Adding {len(conversation_history)} messages from conversation history")
                messages.extend(conversation_history)

            # Add current user question
            messages.append({"role": "user", "content": user_question})

            # Convert tools to OpenAI format
            openai_tools = self._convert_tools_to_openai_format()

            # Iterative tool calling loop
            max_iterations = 30
            iteration = 0
            consecutive_tool_tracker = {"name": None, "count": 0}

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
                    logger.info(f"🤖 OpenAI requesting {len(message.tool_calls)} tool(s)")

                    tool_results = []
                    tool_loop_detected = False
                    for tool_call in message.tool_calls:
                        tool_name = tool_call.function.name
                        tool_args_str = tool_call.function.arguments
                        tool_id = tool_call.id

                        # Parse arguments
                        try:
                            tool_args = json.loads(tool_args_str)
                        except json.JSONDecodeError:
                            tool_args = {}

                        if self._check_tool_loop(tool_name, consecutive_tool_tracker):
                            tool_loop_detected = True
                            break

                        if progress_callback:
                            progress_callback(f"🔧 Using tool: {tool_name}")

                        # Get tool result with automatic truncation (logging handled in base class)
                        tool_result = self._get_tool_result(tool_name, tool_args, namespace=namespace)

                        tool_results.append({
                            "role": "tool",
                            "tool_call_id": tool_id,
                            "content": tool_result
                        })

                    if tool_loop_detected:
                        return (
                            "I got stuck in a loop calling the same tool repeatedly. "
                            "Please try rephrasing your question or being more specific."
                        )

                    # Add tool results to conversation
                    messages.extend(tool_results)

                    # Truncate conversation safely (preserves tool-call/result pairs)
                    messages = self._truncate_messages(messages, keep_system_prompt=True)

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
