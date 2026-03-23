"""
Llama Chat Bot Implementation (via LlamaStack)

This module provides Llama-specific implementation using LlamaStack's OpenAI-compatible API.
"""

import json
import re
from typing import Optional, List, Dict, Any, Callable

from openai import OpenAI

from .base import BaseChatBot
from chatbots.tool_executor import ToolExecutor
from core.config import LLAMA_STACK_URL, LLM_API_TOKEN, LLM_TIMEOUT_SECONDS
from common.pylogger import get_python_logger

logger = get_python_logger()


class LlamaChatBot(BaseChatBot):
    """Llama implementation using LlamaStack with OpenAI-compatible API."""

    def _get_api_key(self) -> Optional[str]:
        """Local models don't require API keys."""
        return None

    def _get_max_tool_result_length(self) -> int:
        """Llama 3.1 supports 128K token context - 8K chars is reasonable."""
        return 8000

    # Tools that Llama should have access to.
    #
    # Selection criteria — include a tool here if it:
    #   1. Retrieves or queries observability data (metrics, traces, logs, alerts)
    #   2. Helps the model understand or navigate that data (metadata, categories, explain)
    #   3. Provides infrastructure context (namespaces, deployments, GPUs)
    #
    # Exclude a tool if it:
    #   1. Chains to another LLM (analyze_vllm, chat_openshift, etc.)
    #   2. Is administrative/config-only (not useful for end-user queries)
    #   3. Is the recursive `chat` tool (would blow context)
    #
    # When adding a new tool to the MCP server, check these criteria and update
    # this list accordingly. The allowlist lives here (not in the MCP server)
    # because the constraint is specific to Llama's limited context window.
    _TOOL_ALLOWLIST = {
        # Prometheus / metrics
        "execute_promql",
        "search_metrics",
        "get_metric_metadata",
        "get_label_values",
        "suggest_queries",
        "explain_results",
        "select_best_metric",
        "get_metrics_categories",
        "search_metrics_by_category",
        "get_category_metrics_detail",
        # Traces
        "chat_tempo_tool",
        "query_tempo_tool",
        "get_trace_details_tool",
        # Correlation & logs
        "korrel8r_get_correlated",
        "korrel8r_query_objects",
        "get_correlated_logs",
        # Infrastructure discovery
        "get_gpu_info",
        "get_deployment_info",
        "list_openshift_namespaces",
    }

    def _get_tool_allowlist(self) -> set:
        """Limit tools to reduce context usage for Llama's constrained context."""
        return self._TOOL_ALLOWLIST

    def _extract_model_name(self) -> str:
        """LlamaStack expects the full model name including provider prefix.

        Override the base class method to return the full name.
        """
        return self.model_name

    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        tool_executor: ToolExecutor = None
    ):
        super().__init__(model_name, api_key, tool_executor)

        self.client = OpenAI(
            base_url=LLAMA_STACK_URL.removesuffix("/chat/completions"),
            api_key=LLM_API_TOKEN or "dummy"
        )

    def _get_model_specific_instructions(self) -> str:
        """No separate model-specific block — merged into _get_base_prompt."""
        return ""

    def _get_base_prompt(self, namespace=None) -> str:
        """Compact system prompt for Llama's constrained context window."""
        scope = self._format_scope_line(namespace)
        ns_directive = self._format_namespace_directive(namespace)

        return f"""You are an expert Kubernetes and Prometheus observability assistant.

**Scope:** {scope}
{ns_directive}
**CRITICAL — Tool Calling:**
- ALWAYS call tools via the function calling API to get real data.
- NEVER fabricate data or make up numbers.
- NEVER output tool calls as JSON text — use the function calling mechanism.

**Tool Selection:**
- Metrics/pods/GPU/CPU/memory → execute_promql (primary), search_metrics, suggest_queries
- Traces/spans/latency → chat_tempo_tool, query_tempo_tool, get_trace_details_tool
- Logs/errors → get_correlated_logs
- Alert investigation → execute_promql with ALERTS metric, then korrel8r_get_correlated
- Correlation/investigation/korrel8r → korrel8r_get_correlated with:
  goals=["alert:alert","trace:span","log:application","log:infrastructure"]
  query="k8s:Pod:{{\\"namespace\\":\\"NS\\",\\"name\\":\\"POD_NAME\\"}}"
  For namespace-wide: query="k8s:Namespace:{{\\"name\\":\\"NS\\"}}"

**PromQL Patterns:**
- CPU: sum(rate(container_cpu_usage_seconds_total[5m])) by (pod, namespace)
- Memory: sum(container_memory_usage_bytes) by (pod, namespace)
- GPU temp: avg(DCGM_FI_DEV_GPU_TEMP) or avg(habanalabs_temperature_onchip)
- GPU util: avg(DCGM_FI_DEV_GPU_UTIL) or avg(habanalabs_utilization)
- GPU power: avg(DCGM_FI_DEV_POWER_USAGE) or avg(habanalabs_power_mW) / 1000
- Pod status: kube_pod_status_phase{{phase="Running"}} == 1
- Failing pods: kube_pod_container_status_waiting_reason{{reason=~"CrashLoopBackOff|ImagePullBackOff"}} == 1
- Always use aggregation (sum/avg/max) and group by (pod, namespace)
- Use rate() for counters, append == 1 for boolean metrics
- Use regex for pod names: pod=~"name.*" (pods have hash suffixes)

**Response Format:**
- Use markdown (bold, lists) — no code block wrappers
- Include PromQL used, metric source, and data points in a Technical Details section
- Provide operational context and actionable insights"""

    # Query category patterns → specific tool + usage hint for the nudge message.
    # Order matters: first match wins. More specific patterns come first.
    _QUERY_CATEGORIES = [
        # Correlation / korrel8r — must precede "alert" because pod names
        # like "alert-example-5d9cbf68fd-62zsb" would otherwise match the
        # alert pattern and route to execute_promql instead.
        (re.compile(r'correlat|korrel8r|investigate', re.IGNORECASE),
         'korrel8r_get_correlated',
         'Call korrel8r_get_correlated with goals=["trace:span","log:application","log:infrastructure"] '
         'and query="k8s:Pod:{\\"namespace\\":\\"<namespace>\\",\\"name\\":\\"<pod>\\"}"'),
        # Alerts — only match "alert" as a standalone concept (firing alerts),
        # not as part of pod/deployment names like "alert-example".
        (re.compile(r'\balerts?\b(?!-)', re.IGNORECASE),
         'execute_promql',
         'Call execute_promql with query: ALERTS{namespace="<namespace>"} or ALERTS{} for cluster-wide.'),
        # Pod health / failures
        (re.compile(r'pod.*(fail|crash|error|unhealthy|status|restart)', re.IGNORECASE),
         'execute_promql',
         'Call execute_promql with query: '
         'kube_pod_container_status_waiting_reason{namespace="<namespace>", '
         'reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull"} == 1'),
        # Trace details (specific trace ID)
        (re.compile(r'trace.*(detail|id|info)|detail.*trace', re.IGNORECASE),
         'get_trace_details_tool',
         'Call get_trace_details_tool with the trace ID from the user query.'),
        # Traces (general)
        (re.compile(r'trace|span|latency', re.IGNORECASE),
         'chat_tempo_tool',
         'Call chat_tempo_tool with the user query to search for traces.'),
        # Logs
        (re.compile(r'\blog', re.IGNORECASE),
         'get_correlated_logs',
         'Call get_correlated_logs with namespace and optional pod name.'),
        # GPU metrics
        (re.compile(r'gpu|power|temperature|temp\b', re.IGNORECASE),
         'execute_promql',
         'Call execute_promql for each metric separately. '
         'GPU power: avg(DCGM_FI_DEV_POWER_USAGE) by (pod, namespace). '
         'GPU temperature: avg(DCGM_FI_DEV_GPU_TEMP) by (pod, namespace).'),
        # CPU / memory metrics
        (re.compile(r'cpu|memory|mem\b', re.IGNORECASE),
         'execute_promql',
         'Call execute_promql. '
         'CPU: sum(rate(container_cpu_usage_seconds_total[5m])) by (pod, namespace). '
         'Memory: sum(container_memory_usage_bytes) by (pod, namespace).'),
        # Generic metrics
        (re.compile(r'metric|promql|prometheus', re.IGNORECASE),
         'execute_promql',
         'Call execute_promql with the appropriate PromQL query.'),
    ]

    def _get_nudge_for_query(self, user_question: str, namespace: Optional[str] = None) -> tuple:
        """Build a category-specific nudge message based on the user's query.

        Returns (nudge_text, tool_name) where tool_name is the matched tool
        or None if no category matched.
        """
        for pattern, tool_name, hint in self._QUERY_CATEGORIES:
            if pattern.search(user_question):
                # Substitute namespace placeholder if available
                resolved_hint = hint
                if namespace:
                    resolved_hint = resolved_hint.replace('<namespace>', namespace)
                else:
                    # Remove namespace filter clauses entirely when no namespace is set
                    resolved_hint = re.sub(r'namespace="<namespace>",?\s*', '', resolved_hint)
                    resolved_hint = resolved_hint.replace('<namespace>', '')
                logger.info("Smart nudge matched category: tool=%s", tool_name)
                nudge_text = (
                    f"You MUST call the `{tool_name}` tool now to answer this question. "
                    f"Do NOT fabricate data. {resolved_hint}"
                )
                return nudge_text, tool_name

        # Generic fallback nudge
        return (
            "You MUST use the provided tools to answer this question. "
            "Do NOT fabricate data. Call the appropriate tool now.",
            None
        )

    # Patterns to extract namespace and pod from user queries for direct tool execution
    _NS_RE = re.compile(
        r'(?:in\s+(?:namespace|ns)|namespace|ns)[:\s]+([a-z0-9][-a-z0-9]*)',
        re.IGNORECASE
    )
    _POD_RE = re.compile(
        r'pod\s+([a-z0-9][-a-z0-9]*)',
        re.IGNORECASE
    )

    def _try_direct_tool_call(
        self,
        user_question: str,
        namespace: Optional[str],
        openai_tools: List[Dict],
        messages: List[Dict],
        progress_callback: Optional[Callable] = None,
    ) -> Optional[str]:
        """Last-resort: directly execute the matched tool and ask the model to summarise.

        When the nudge fails (model returns empty), we know which tool to call
        from ``_get_nudge_for_query``.  For korrel8r queries we can construct
        the arguments from the user question and execute the tool ourselves,
        then feed the result back so the model can produce a human-readable
        summary.

        Returns the model's summary string, or None if direct execution is
        not applicable.
        """
        _, matched_tool = self._get_nudge_for_query(user_question, namespace)
        if matched_tool != 'korrel8r_get_correlated':
            return None  # only korrel8r supported for now

        # Extract namespace (prefer injected, fall back to regex)
        ns = namespace
        if not ns:
            m = self._NS_RE.search(user_question)
            ns = m.group(1) if m else None
        if not ns:
            return None

        # Extract pod name
        m = self._POD_RE.search(user_question)
        pod_name = m.group(1) if m else None

        # Build korrel8r args
        goals = ["alert:alert", "trace:span", "log:application", "log:infrastructure"]
        if pod_name:
            query = f'k8s:Pod:{json.dumps({"namespace": ns, "name": pod_name})}'
        else:
            query = f'k8s:Namespace:{json.dumps({"name": ns})}'

        tool_args = {"goals": goals, "query": query}
        logger.info(
            "Direct tool execution fallback: tool=%s, args=%s",
            matched_tool, tool_args
        )

        if progress_callback:
            progress_callback(f"🔧 Using tool: {matched_tool}")

        tool_result = self._get_tool_result(matched_tool, tool_args, namespace=namespace)

        # Feed the result back to the model for summarisation
        messages.append({
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": "direct_call_1",
                "type": "function",
                "function": {
                    "name": matched_tool,
                    "arguments": json.dumps(tool_args),
                }
            }]
        })
        messages.append({
            "role": "tool",
            "tool_call_id": "direct_call_1",
            "content": tool_result,
        })

        try:
            if progress_callback:
                progress_callback("🤖 Summarising results...")

            summary_response = self.client.chat.completions.create(
                model=self._extract_model_name(),
                messages=messages,
                tools=openai_tools,
                tool_choice="none",
                temperature=0,
                timeout=LLM_TIMEOUT_SECONDS,
            )
            summary = summary_response.choices[0].message.content or ''
            if summary.strip():
                logger.info("Direct tool execution produced a summary (%d chars)", len(summary))
                return summary
        except Exception as e:
            logger.warning("Summary call after direct tool execution failed: %s", e)

        # If summary is empty, return the raw tool result
        return f"Korrel8r correlation results for {ns}:\n\n{tool_result}"

    def _detect_text_tool_calls(self, text: str, tool_names: List[str]) -> bool:
        """Detect if the model described a tool call in text instead of using the function calling API.

        Llama models may output tool calls as plain text in several formats:
        - Tool Call: header (case-insensitive)
        - tool_name( function-call syntax
        - {"name": "tool_name"} JSON pattern

        Returns True if a text-based tool call pattern is detected.
        """
        if not text or not tool_names:
            return False

        # Check for "Tool Call:" header pattern (shared with Google)
        if re.search(r'Tool Call:', text, re.IGNORECASE):
            return True

        # Check for tool_name( pattern — function invocation syntax (shared with Google)
        for name in tool_names:
            pattern = r'\b' + re.escape(name) + r'\s*\('
            if re.search(pattern, text):
                return True

        # Check for JSON-style {"name": "tool_name"} pattern (Llama-specific)
        for name in tool_names:
            pattern = r'"name"\s*:\s*"' + re.escape(name) + r'"'
            if re.search(pattern, text):
                return True

        return False

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
        """Chat with Llama using LlamaStack OpenAI-compatible API."""
        try:
            # Create system prompt
            system_prompt = self._create_system_prompt(namespace)

            # LlamaStack expects the full model name (override preserves it)
            model_id = self._extract_model_name()

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

            # Extract tool names for text-tool-call detection
            tool_names = [t["function"]["name"] for t in openai_tools]

            # Iterative tool calling loop
            max_iterations = 30
            iteration = 0
            nudge_retried = False
            has_called_tools = False
            tool_choice = "auto"
            consecutive_tool_tracker = {"name": None, "count": 0}

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
                    tool_choice=tool_choice,
                    temperature=0,
                    timeout=LLM_TIMEOUT_SECONDS,
                )

                # Reset to auto after each call so forced tool calls don't persist
                tool_choice = "auto"

                choice = response.choices[0]
                finish_reason = choice.finish_reason
                message = choice.message

                logger.debug(
                    "LlamaStack iteration %d: finish_reason=%s, has_tool_calls=%s, content_len=%d",
                    iteration, finish_reason, bool(message.tool_calls),
                    len(message.content or '')
                )

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

                # If model wants to use tools, execute them.
                # Check tool_calls presence regardless of finish_reason —
                # LlamaStack may return finish_reason='stop' even with tool calls
                # when tool_choice forces a specific function.
                if message.tool_calls:
                    has_called_tools = True
                    logger.info(f"🤖 LlamaStack requesting {len(message.tool_calls)} tool(s)")

                    # Collect tool names for iteration-level loop detection
                    tool_names_this_iteration = {
                        tc.function.name for tc in message.tool_calls
                    }

                    if self._check_tool_loop(tool_names_this_iteration, consecutive_tool_tracker):
                        return (
                            "I got stuck in a loop calling the same tool repeatedly. "
                            "Please try rephrasing your question or being more specific."
                        )

                    tool_results = []
                    for tool_call in message.tool_calls:
                        tool_name = tool_call.function.name
                        tool_args_str = tool_call.function.arguments
                        tool_id = tool_call.id

                        # Parse arguments
                        try:
                            tool_args = json.loads(tool_args_str)
                        except json.JSONDecodeError:
                            tool_args = {}

                        if progress_callback:
                            progress_callback(f"🔧 Using tool: {tool_name}")

                        # Get tool result with automatic truncation (logging handled in base class)
                        tool_result = self._get_tool_result(tool_name, tool_args, namespace=namespace)

                        tool_results.append({
                            "role": "tool",
                            "tool_call_id": tool_id,
                            "content": tool_result
                        })

                    # Add tool results to conversation
                    messages.extend(tool_results)

                    # Truncate conversation safely (preserves tool-call/result pairs)
                    messages = self._truncate_messages(messages, keep_system_prompt=True)

                    # Continue loop
                    continue

                else:
                    final_response = message.content or ''

                    if not nudge_retried:
                        # Guard 1: Fabrication — model returned text without
                        # ever calling tools (likely fabricated response)
                        if not has_called_tools:
                            nudge_text, matched_tool = self._get_nudge_for_query(user_question, namespace)
                            logger.warning(
                                "Llama returned text without calling any tools "
                                "(iteration %d) — possible fabrication. "
                                "Nudging model with category-specific hint.",
                                iteration
                            )
                            nudge_retried = True
                            tool_choice = "required"
                            messages.append({
                                "role": "user",
                                "content": nudge_text
                            })
                            continue

                        # Guard 2: Text tool calls — model wrote tool call as text
                        # instead of using the function calling API
                        if self._detect_text_tool_calls(final_response, tool_names):
                            nudge_text, matched_tool = self._get_nudge_for_query(user_question, namespace)
                            logger.warning(
                                "Llama output a tool call as text instead of using "
                                "the function calling API. Nudging model to retry."
                            )
                            nudge_retried = True
                            tool_choice = "required"
                            messages.append({
                                "role": "user",
                                "content": (
                                    "You wrote a tool call as text instead of using the "
                                    "function calling API. Do NOT output JSON tool calls "
                                    "as text. Use the function calling mechanism. "
                                    + nudge_text
                                )
                            })
                            continue

                    # Nudge was already attempted — try direct tool execution
                    # as last resort, then fall back to graceful message.
                    if not final_response or not final_response.strip():
                        direct_result = self._try_direct_tool_call(
                            user_question, namespace, openai_tools, messages, progress_callback
                        )
                        if direct_result:
                            return direct_result

                        logger.warning(
                            "Llama returned empty response after nudge. "
                            "Returning graceful fallback."
                        )
                        return (
                            "I wasn't able to retrieve data for this query. "
                            "Please try rephrasing your question or being more "
                            "specific about what information you need."
                        )

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
