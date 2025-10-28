"""
Google Gemini Chat Bot Implementation

This module provides Google Gemini-specific implementation using the official SDK.
"""

import logging
from typing import Optional, Callable, List

from .base import BaseChatBot

logger = logging.getLogger(__name__)


class GoogleChatBot(BaseChatBot):
    """Google Gemini implementation with native tool calling."""

    def __init__(self, model_name: str, api_key: Optional[str] = None):
        super().__init__(model_name, api_key)

        # Import Google SDK and configure
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            self.genai = genai
            self.configured = True
        except ImportError:
            logger.error("Google Generative AI SDK not installed. Install with: pip install google-generativeai")
            self.genai = None
            self.configured = False

    def _get_model_specific_instructions(self) -> str:
        """Gemini-specific instructions for optimal performance."""
        return """---

**GEMINI-SPECIFIC INSTRUCTIONS:**

**Your Strengths:**
- Excellent at handling large context (1M tokens)
- Strong tool calling capabilities
- Good at detailed analysis and categorization

**Best Practices:**
- Provide rich, detailed breakdowns with full context
- Use comprehensive grouping in queries for detailed insights
- Leverage your large context window for thorough analysis"""

    def _json_type_to_gemini_type(self, json_type: str):
        """Convert JSON schema type to Gemini proto type."""
        if not self.genai:
            return None

        type_mapping = {
            "string": self.genai.protos.Type.STRING,
            "number": self.genai.protos.Type.NUMBER,
            "integer": self.genai.protos.Type.INTEGER,
            "boolean": self.genai.protos.Type.BOOLEAN,
            "array": self.genai.protos.Type.ARRAY,
            "object": self.genai.protos.Type.OBJECT
        }
        return type_mapping.get(json_type, self.genai.protos.Type.STRING)

    def _convert_tools_to_gemini_format(self) -> List:
        """Convert MCP tools to Google Gemini SDK format."""
        if not self.genai:
            return []

        tools = self._get_mcp_tools()
        sdk_tools = []

        for tool in tools:
            parameters = tool.get("input_schema", tool.get("parameters", {}))

            sdk_tools.append(
                self.genai.protos.FunctionDeclaration(
                    name=tool["name"],
                    description=tool["description"],
                    parameters=self.genai.protos.Schema(
                        type=self.genai.protos.Type.OBJECT,
                        properties={
                            k: self.genai.protos.Schema(
                                type=self._json_type_to_gemini_type(v.get("type", "string")),
                                description=v.get("description", "")
                            )
                            for k, v in parameters.get("properties", {}).items()
                        },
                        required=parameters.get("required", [])
                    )
                )
            )

        return sdk_tools

    def chat(self, user_question: str, namespace: Optional[str] = None, scope: Optional[str] = None, progress_callback: Optional[Callable] = None) -> str:
        """Chat with Google Gemini using tool calling."""
        if not self.configured:
            return "Error: Google Generative AI SDK not installed. Please install it with: pip install google-generativeai"

        if not self.api_key:
            return f"API key required for Google model {self.model_name}. Please provide an API key."

        try:
            # Create system prompt
            system_prompt = self._create_system_prompt(namespace)

            # Get model name from config
            model_name = self.model_config.get("modelName", "gemini-2.5-flash")

            # Convert tools to Gemini format
            gemini_tools = self._convert_tools_to_gemini_format()

            # Initialize the model with tools and system instruction
            model = self.genai.GenerativeModel(
                model_name=model_name,
                tools=gemini_tools,
                system_instruction=system_prompt
            )

            # Start a chat session
            chat = model.start_chat(enable_automatic_function_calling=False)

            # Send initial message with just the user question
            initial_message = user_question

            # Iterative tool calling loop
            max_iterations = 10  # Reduced from 30 to prevent long waits
            iteration = 0
            function_responses = []  # Initialize outside loop

            while iteration < max_iterations:
                iteration += 1
                logger.info(f"🤖 Google Gemini tool calling iteration {iteration}")

                if progress_callback:
                    progress_callback(f"🤖 Thinking... (iteration {iteration})")

                # Send message to model
                try:
                    if iteration == 1:
                        # First iteration - send the initial question
                        response = chat.send_message(
                            initial_message,
                            generation_config=self.genai.GenerationConfig(temperature=0)
                        )
                    else:
                        # Subsequent iterations - send function responses
                        if not function_responses:
                            logger.error("No function responses to send but not first iteration")
                            break
                        response = chat.send_message(
                            function_responses,
                            generation_config=self.genai.GenerationConfig(temperature=0)
                        )
                except Exception as e:
                    logger.error(f"Error sending message to Gemini: {e}")
                    return f"Error communicating with Gemini: {str(e)}"

                # Check if we have a valid response
                if not response.candidates:
                    logger.error("No candidates in response")
                    return "Error: No response candidates from Google Gemini"

                if not hasattr(response.candidates[0], 'content') or not response.candidates[0].content:
                    logger.error("No content in response candidate")
                    return "Error: No content in response from Google Gemini"

                if not hasattr(response.candidates[0].content, 'parts') or not response.candidates[0].content.parts:
                    logger.error("No parts in response content")
                    logger.error(f"Response structure: {response}")
                    return "Error: No response parts from Google Gemini. The model may have been blocked or returned an empty response."

                parts = response.candidates[0].content.parts

                # Check for function calls
                has_function_calls = any(hasattr(part, 'function_call') and part.function_call for part in parts)

                if has_function_calls:
                    tool_count = sum(1 for p in parts if hasattr(p, 'function_call') and p.function_call)
                    logger.info(f"Google Gemini is using {tool_count} tool(s)")

                    # Build function responses for next iteration
                    function_responses = []  # Clear previous responses
                    for part in parts:
                        if hasattr(part, 'function_call') and part.function_call:
                            func_call = part.function_call
                            tool_name = func_call.name
                            tool_args = dict(func_call.args)

                            logger.info(f"🔧 Calling tool: {tool_name} with args: {tool_args}")
                            if progress_callback:
                                progress_callback(f"🔧 Using tool: {tool_name}")

                            # Route to MCP server
                            tool_result = self._route_tool_call_to_mcp(tool_name, tool_args)
                            logger.info(f"Tool result length: {len(str(tool_result))}")

                            # Truncate large results to prevent context overflow
                            # 10K is reasonable for Gemini (supports 1M token context)
                            if isinstance(tool_result, str) and len(tool_result) > 10000:
                                tool_result = tool_result[:10000] + "\n... [Result truncated due to size]"

                            # Create function response for Gemini SDK
                            function_responses.append(
                                self.genai.protos.Part(
                                    function_response=self.genai.protos.FunctionResponse(
                                        name=tool_name,
                                        response={"content": tool_result}
                                    )
                                )
                            )

                    logger.info(f"Prepared {len(function_responses)} function response(s) for next iteration")
                    # Continue loop to send function responses
                    continue

                else:
                    # Model is done, extract final text response
                    final_response = ""
                    for part in parts:
                        if hasattr(part, 'text') and part.text:
                            final_response += part.text

                    if not final_response:
                        logger.warning("Model returned parts but no text content")
                        logger.warning(f"Parts: {parts}")
                        return "Error: Model completed but returned no text response"

                    logger.info(f"Google Gemini tool calling completed in {iteration} iterations")
                    return final_response

            # Hit max iterations
            logger.warning(f"Hit max iterations ({max_iterations})")
            return "Analysis incomplete. Please try a more specific question."

        except Exception as e:
            logger.error(f"Error in Google Gemini chat: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return f"Error during Google Gemini tool calling: {str(e)}"
