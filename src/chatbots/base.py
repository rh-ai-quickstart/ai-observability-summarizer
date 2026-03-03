"""
Base Chat Bot - Common Functionality

This module provides the base class for all chat bot implementations.
All provider-specific implementations inherit from BaseChatBot.
"""

import re
from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any, Callable

from chatbots.tool_executor import ToolExecutor
from common.pylogger import get_python_logger

logger = get_python_logger()

# PromQL functions, keywords, and common label names that should NOT get
# namespace injected — only actual metric names should.  Module-level constant
# to avoid rebuilding on every call.
_PROMQL_SKIP = frozenset({
    # Aggregation operators
    'sum', 'avg', 'min', 'max', 'count', 'stddev', 'stdvar',
    'topk', 'bottomk', 'quantile', 'count_values',
    # Rate/counter functions
    'rate', 'irate', 'increase', 'delta', 'idelta',
    # Histogram functions
    'histogram_quantile', 'histogram_count', 'histogram_sum',
    # Label functions
    'label_replace', 'label_join',
    # Math functions
    'abs', 'ceil', 'floor', 'round', 'clamp', 'clamp_min', 'clamp_max',
    'exp', 'ln', 'log2', 'log10', 'sqrt',
    # Sort/utility functions
    'sort', 'sort_desc', 'time', 'timestamp',
    'vector', 'scalar', 'sgn',
    # Range functions
    'changes', 'resets', 'deriv', 'predict_linear',
    'absent', 'absent_over_time', 'present_over_time',
    # Date functions
    'day_of_month', 'day_of_week', 'days_in_month',
    'hour', 'minute', 'month', 'year',
    # Keywords and operators
    'by', 'without', 'on', 'ignoring', 'group_left', 'group_right',
    'bool', 'offset', 'and', 'or', 'unless',
    # Over-time functions
    'avg_over_time', 'min_over_time', 'max_over_time',
    'sum_over_time', 'count_over_time', 'stddev_over_time',
    'last_over_time', 'quantile_over_time',
    # Common Kubernetes label names (appear in by/without/grouping clauses)
    'pod', 'namespace', 'container', 'node', 'instance', 'job',
    'service', 'deployment', 'daemonset', 'statefulset', 'replicaset',
    'phase', 'reason', 'condition', 'type', 'resource', 'unit',
    'device', 'interface', 'mode', 'cpu', 'endpoint', 'alertname',
    'alertstate', 'severity', 'le', 'model_name',
    # Numeric literals used in comparisons (won't match our regex, but safe)
    'inf', 'nan',
})


class BaseChatBot(ABC):
    """Base class for all chat bot implementations with common functionality."""

    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        tool_executor: ToolExecutor = None  # Type is non-optional, but runtime validates
    ):
        """Initialize base chat bot.

        Args:
            model_name: Model identifier (e.g., "gpt-4", "claude-3-5-sonnet")
            api_key: Optional API key for the model
            tool_executor: Tool executor for calling observability tools (REQUIRED)
                          Pass a ToolExecutor implementation:
                          - MCPServerAdapter (from MCP server context)
                          - MCPClientAdapter (from UI context)

        Raises:
            ValueError: If tool_executor is None
            TypeError: If tool_executor is None or doesn't implement ToolExecutor
        """
        if tool_executor is None:
            raise ValueError(
                "tool_executor is required. Pass a ToolExecutor implementation "
                "(MCPServerAdapter from MCP server or MCPClientAdapter from UI)"
            )

        if not isinstance(tool_executor, ToolExecutor):
            raise TypeError(
                f"tool_executor must implement ToolExecutor, got {type(tool_executor)}"
            )

        self.model_name = model_name
        # Let each subclass decide how to get its API key
        self.api_key = api_key if api_key is not None else self._get_api_key()

        # Store tool executor (dependency injection)
        self.tool_executor = tool_executor

        from core.config import NAMESPACE_AWARE_TOOLS
        self._namespace_aware_tools = NAMESPACE_AWARE_TOOLS

        logger.info(f"{self.__class__.__name__} initialized with model: {self.model_name}")

    @abstractmethod
    def _get_api_key(self) -> Optional[str]:
        """Get API key for this bot implementation.

        Each subclass should implement this to return the appropriate
        API key from environment variables, config files, or other sources.

        Returns:
            API key string or None if not needed/available
        """
        pass

    def _extract_model_name(self) -> str:
        """Extract the API-specific model name from the full model identifier.

        By default, strips the provider prefix (e.g., "provider/model" → "model").
        Subclasses can override this if they need different behavior.

        Returns:
            Model name suitable for the provider's API
        """
        # Default implementation: strip provider prefix if present
        if "/" in self.model_name:
            return self.model_name.split("/", 1)[1]
        return self.model_name

    def _get_mcp_tools(self) -> List[Dict[str, Any]]:
        """Get available tools via tool executor.

        Returns:
            List of tool definitions with name, description, and input_schema
        """
        try:
            # Fetch tools via tool executor (dependency injection)
            tools_list = self.tool_executor.list_tools()

            # Convert to expected format
            tools = []
            for tool in tools_list:
                tool_def = {
                    'name': tool.name,
                    'description': tool.description,
                    'input_schema': tool.input_schema
                }
                tools.append(tool_def)

            if tools:
                tool_names = [tool['name'] for tool in tools]
                logger.info(f"🧰 Fetched {len(tools)} tools via executor: {', '.join(tool_names)}")
            else:
                logger.warning("No tools returned from tool executor")

            return tools
        except Exception as e:
            logger.error(f"Error fetching tools via executor: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise

    def _normalize_korrel8r_query(self, q: str) -> str:
        """Normalize common Korrel8r query issues for AI-provided inputs.

        - Ensure domain:class present for alert domain (alert -> alert:alert)
        - Convert selector keys of form key="value" to JSON-style "key":="value"
        """
        logger.info(f"Normalizing korrel8r query: {q}")
        try:
            s = (q or "").strip()
            # Unescape accidentally escaped quotes if present (e.g., \" -> ")
            if '\\"' in s:
                s = s.replace('\\"', '"')
            # Insert missing class for alert domain
            if s.startswith("alert:{"):
                s = s.replace("alert:{", "alert:alert:{", 1)

            # Determine domain prefix to tailor selector formatting
            domain = s.split(":", 1)[0] if ":" in s else ""

            # Fix misclassified alerts like k8s:Alert:{...} to alert:alert:{...}
            if s.lower().startswith("k8s:alert:"):
                s = "alert:alert:" + s.split(":", 2)[2]
                domain = "alert"

            # Transform unquoted selector keys inside first {...}
            m = re.search(r"\{(.*)\}", s)
            if m:
                inner = m.group(1)

                # For alert domain, use JSON key:value (":")
                if domain == "alert":
                    def repl_alert(match: re.Match) -> str:
                        key = match.group(1)
                        return f'"{key}":' + match.group(2)
                    inner2 = re.sub(r"\b([A-Za-z0-9_\.]+)\s*=\s*(\")", repl_alert, inner)
                else:
                    # Other domains may use operator syntax; default to ":=" form
                    def repl_generic(match: re.Match) -> str:
                        key = match.group(1)
                        return f'"{key}":=' + match.group(2)
                    inner2 = re.sub(r"\b([A-Za-z0-9_\.]+)\s*=\s*(\")", repl_generic, inner)

                if inner2 != inner:
                    s = s[: m.start(1)] + inner2 + s[m.end(1) :]
            logger.info(f"Normalized korrel8r query: {s}")
            return s
        except Exception:
            return q

    def _route_tool_call_to_mcp(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Route tool call via tool executor.

        Uses the injected ToolExecutor to execute tools (works in both server and client contexts).

        Args:
            tool_name: Name of the tool to call
            arguments: Tool arguments

        Returns:
            Tool execution result as string
        """
        logger.info(f"🔧 Routing tool call: {tool_name} with arguments: {arguments}")

        # Normalize Korrel8r query inputs when needed before executing
        if tool_name == "korrel8r_get_correlated":
            try:
                q = arguments.get("query") if isinstance(arguments, dict) else None
                if isinstance(q, str) and q:
                    normalized_q = self._normalize_korrel8r_query(q)
                    if normalized_q != q:
                        logger.info(f"Normalized korrel8r query from '{q}' to '{normalized_q}'")
                        arguments = dict(arguments)
                        arguments["query"] = normalized_q
            except Exception:
                # Best-effort normalization; continue with original arguments on error
                pass

        try:
            logger.info(f"⚙️ Executing tool '{tool_name}' via tool executor")

            # Execute tool via tool executor (handles both server and client scenarios)
            result = self.tool_executor.call_tool(tool_name, arguments)

            logger.info(f"✅ Tool {tool_name} returned result (length: {len(result) if result else 0})")
            return result

        except Exception as e:
            logger.error(f"❌ Error calling tool {tool_name}: {e}")
            return f"Error executing {tool_name}: {str(e)}"

    def _get_max_tool_result_length(self) -> int:
        """Get maximum length for tool results before truncation.

        Each subclass should override this based on their model's context window.
        Default is conservative 5000 characters.

        Returns:
            Maximum length in characters
        """
        return 5000

    def _inject_namespace_into_promql(self, query: str, namespace: str) -> str:
        """Inject a namespace label filter into a PromQL query string.

        Handles common PromQL patterns:
        - metric_name → metric_name{namespace="ns"}
        - metric_name{existing="label"} → metric_name{existing="label",namespace="ns"}
        - sum(metric_name) → sum(metric_name{namespace="ns"})
        - sum(rate(metric_name[5m])) → sum(rate(metric_name{namespace="ns"}[5m]))

        If the query already contains a namespace filter, it is replaced with
        the active namespace to ensure the UI dropdown selection takes precedence.
        """
        # If namespace filter already present, replace it with the active namespace
        if f'namespace="' in query or f"namespace='" in query or 'namespace=~' in query:
            modified = re.sub(
                r'namespace\s*=~?\s*["\'][^"\']*["\']',
                f'namespace="{namespace}"',
                query
            )
            if modified != query:
                logger.info(f"📌 Replaced namespace in PromQL: {query} → {modified}")
            return modified

        original = query

        # Pattern: find metric names followed by optional labels and/or range vector
        # This regex matches: metric_name, metric_name{...}, metric_name[5m], metric_name{...}[5m]
        # We inject namespace into the label set of each metric selector.
        def inject_ns(match):
            metric = match.group(1)
            labels = match.group(2) or ''   # existing {labels} or empty
            rest = match.group(3) or ''     # trailing [range] or empty

            # Skip PromQL functions/keywords/label names — they aren't metric selectors
            if metric.lower() in _PROMQL_SKIP:
                return match.group(0)

            if labels:
                # Has existing labels: metric{existing="val"} → metric{existing="val",namespace="ns"}
                inner = labels[1:-1].strip()  # strip { }
                if inner:
                    return f'{metric}{{{inner},namespace="{namespace}"}}{rest}'
                else:
                    return f'{metric}{{namespace="{namespace}"}}{rest}'
            else:
                # No existing labels: metric → metric{namespace="ns"}
                return f'{metric}{{namespace="{namespace}"}}{rest}'

        # Match metric selectors: word chars and colons (for namespaced metrics like vllm:xxx)
        # followed by optional {labels} and optional [range]
        modified = re.sub(
            r'([a-zA-Z_:][a-zA-Z0-9_:]*)'   # group 1: metric name
            r'(\{[^}]*\})?'                   # group 2: optional label matchers
            r'(\[[^\]]*\])?',                  # group 3: optional range vector
            inject_ns,
            query
        )

        if modified != original:
            logger.info(f"📌 Injected namespace '{namespace}' into PromQL: {original} → {modified}")
        return modified

    def _get_tool_result(self, tool_name: str, tool_args: Dict[str, Any], namespace: Optional[str] = None) -> str:
        """Execute tool call and truncate result if needed.

        For execute_promql: injects namespace filter directly into the PromQL
        query string (since execute_promql doesn't accept a namespace parameter).

        For other namespace-aware tools: injects namespace as an argument.

        Args:
            tool_name: Name of the tool to call
            tool_args: Arguments to pass to the tool
            namespace: Optional namespace to inject into tool args

        Returns:
            Tool result, truncated if it exceeds max length
        """
        # Inject namespace for namespace-scoped queries
        if namespace and tool_name in self._namespace_aware_tools:
            if tool_name == 'execute_promql' and 'query' in tool_args:
                # For execute_promql: modify the PromQL query string itself
                tool_args = dict(tool_args)
                tool_args['query'] = self._inject_namespace_into_promql(
                    tool_args['query'], namespace
                )
            elif not tool_args.get('namespace'):
                # For other tools: inject namespace as an argument
                tool_args = dict(tool_args)
                tool_args['namespace'] = namespace
                logger.info(f"📌 Injected namespace '{namespace}' into {tool_name} args")

        # Log tool request with arguments
        logger.info(f"🔧 Requesting tool: {tool_name} with args: {tool_args}")

        # Route to MCP server
        tool_result = self._route_tool_call_to_mcp(tool_name, tool_args)

        # Log result preview
        logger.info(f"📬 Returning result for tool {tool_name}: {str(tool_result)[:200]}...")

        # Truncate large results to prevent context overflow
        max_length = self._get_max_tool_result_length()
        if isinstance(tool_result, str) and len(tool_result) > max_length:
            logger.info(f"✂️ Truncating result from {len(tool_result)} to {max_length} chars")
            tool_result = tool_result[:max_length] + "\n... [Result truncated due to size]"
        else:
            logger.info(f"📦 Tool result size: {len(str(tool_result))} chars (within limit of {max_length})")

        return tool_result

    def _truncate_messages(
        self,
        messages: list,
        keep_system_prompt: bool = True,
        max_messages: int = 20,
        target_messages: int = 14,
    ) -> list:
        """Truncate messages while keeping tool-call/result pairs atomic.

        Groups assistant messages that contain tool_calls together with their
        corresponding tool-result messages, so truncation never orphans a
        tool call from its results (which causes LLMs to hallucinate).

        Supports two message formats:
        - OpenAI/LlamaStack: tool results are separate {"role": "tool", ...} messages
        - Anthropic: tool results are a single {"role": "user", "content": [{"type": "tool_result", ...}]} message

        Args:
            messages: The current message list (mutated in-place style; returns new list).
            keep_system_prompt: If True, preserves messages[0] as the system prompt.
            max_messages: Trigger truncation when len(messages) exceeds this.
            target_messages: Keep this many messages (plus optional system prompt) after truncation.

        Returns:
            Truncated message list.
        """
        if len(messages) <= max_messages:
            return messages

        # Separate system prompt if needed
        if keep_system_prompt and messages:
            system = [messages[0]]
            body = messages[1:]
        else:
            system = []
            body = list(messages)

        # Build atomic groups from body messages.
        # A "group" is either:
        #   1. A standalone message (user or assistant without tool_calls)
        #   2. An assistant message with tool_calls + all subsequent tool-result messages
        groups: list[list] = []
        i = 0
        while i < len(body):
            msg = body[i]

            # Detect assistant message with tool_calls (OpenAI/Llama format)
            has_tool_calls = (
                isinstance(msg, dict)
                and msg.get("role") == "assistant"
                and msg.get("tool_calls")
            )

            if has_tool_calls:
                group = [msg]
                i += 1
                # Collect subsequent tool-result messages
                while i < len(body):
                    next_msg = body[i]
                    is_tool_result = False

                    # OpenAI format: {"role": "tool", ...}
                    if isinstance(next_msg, dict) and next_msg.get("role") == "tool":
                        is_tool_result = True

                    # Anthropic format: {"role": "user", "content": [{"type": "tool_result", ...}]}
                    if (
                        isinstance(next_msg, dict)
                        and next_msg.get("role") == "user"
                        and isinstance(next_msg.get("content"), list)
                        and any(
                            isinstance(c, dict) and c.get("type") == "tool_result"
                            for c in next_msg["content"]
                        )
                    ):
                        is_tool_result = True

                    if is_tool_result:
                        group.append(next_msg)
                        i += 1
                    else:
                        break
                groups.append(group)
            else:
                groups.append([msg])
                i += 1

        # Drop oldest groups until we're at or below target
        total = sum(len(g) for g in groups)
        while groups and (len(system) + total) > target_messages:
            dropped = groups.pop(0)
            total -= len(dropped)

        # Reconstruct
        result = system[:]
        for g in groups:
            result.extend(g)

        logger.info(
            f"✂️ Truncated messages from {len(messages)} to {len(result)} "
            f"({len(groups)} atomic groups preserved)"
        )
        return result

    def _get_model_specific_instructions(self) -> str:
        """Override this in subclasses for model-specific guidance.

        Returns:
            Model-specific instructions to append to base prompt, or empty string.
        """
        return ""

    def _create_system_prompt(self, namespace: Optional[str] = None) -> str:
        """Create system prompt for observability assistant.

        Combines base prompt with model-specific instructions.
        Subclasses can override _get_model_specific_instructions() to customize.
        """
        base_prompt = self._get_base_prompt(namespace)
        model_specific = self._get_model_specific_instructions()

        if model_specific:
            return f"{base_prompt}\n\n{model_specific}"
        return base_prompt

    def _format_scope_line(self, namespace: Optional[str]) -> str:
        """Format the Scope line for the system prompt."""
        if namespace:
            return (
                "**NAMESPACE-SCOPED: %s** — ALL queries MUST be filtered "
                "to this namespace only" % namespace
            )
        return "Cluster-wide analysis"

    def _format_namespace_directive(self, namespace: Optional[str]) -> str:
        """Format the namespace scoping directive for the system prompt."""
        if not namespace:
            return ""
        return (
            "\n**NAMESPACE SCOPE REQUIREMENT — MANDATORY:**\n"
            'You are operating in NAMESPACE-SCOPED mode for namespace **"%s"**.\n'
            "- You MUST call tools (execute_promql, search_metrics, etc.) to get FRESH data for this namespace.\n"
            "- Do NOT reuse or reference results from previous queries — they may be from a different scope.\n"
            '- Do NOT add namespace filters to your PromQL queries — the system automatically injects namespace="%s" for you.\n'
            '- If a previous conversation shows cluster-wide data, IGNORE it and query fresh data for "%s".\n'
            '- Every answer must reflect data from namespace "%s" ONLY.\n'
            '- If the user mentions a different namespace in their question, still answer the question but use "%s"'
            " — the active namespace selected in the UI always takes precedence.\n"
        ) % (namespace, namespace, namespace, namespace, namespace)

    def _get_base_prompt(self, namespace: Optional[str] = None) -> str:
        """Create base system prompt shared by all models."""
        prompt = f"""You are an expert Kubernetes and Prometheus observability assistant.

🎯 **PRIMARY RULE: ANSWER ONLY WHAT THE USER ASKS. DO NOT EXPLORE BEYOND THEIR SPECIFIC QUESTION.**

You have access to monitoring tools and should provide focused, targeted responses.

**Your Environment:**
- Cluster: OpenShift with AI/ML workloads, GPUs, and comprehensive monitoring
- Scope: {self._format_scope_line(namespace)}
- Tools: Direct access to Prometheus/Thanos metrics via MCP tools
- **Enhanced Metrics Catalog**: Smart category-aware metric discovery via catalog tools
{self._format_namespace_directive(namespace)}

**Available Tools:**

**Core Observability Tools:**
- search_metrics: Pattern-based metric search - use for broad exploration
- execute_promql: Execute PromQL queries for actual data
- convert_time_to_promql_duration: Convert decimal hours to Prometheus format (use before constructing queries with decimal time values)
- get_metric_metadata: Get detailed information about specific metrics
- get_label_values: Get available label values
- suggest_queries: Get PromQL suggestions based on user intent
- explain_results: Get human-readable explanation of query results
- **get_metrics_categories**: Get all metric categories with summary (NEW - use for exploring available metrics by category)
- **search_metrics_by_category**: Search metrics filtered by category and priority (NEW - use for targeted category-specific queries)

**Trace Analysis Tools:**
- chat_tempo_tool: Conversational trace analysis - use for trace/span/latency/request flow questions
- query_tempo_tool: Direct tempo queries for specific trace searches
- get_trace_details_tool: Get detailed information about specific trace IDs

**Log Analysis Tools:**
- get_correlated_logs: Fetch application and infrastructure logs for a namespace or pod. Use for: "show me logs", "error logs in namespace X", "what's happening in pod Y", crash investigation, log search by severity. Requires namespace; pod is optional.

**Correlation & Advanced Analysis:**
- korrel8r_get_correlated: Get correlated observability data across domains (find logs/traces/metrics related to alerts) - available if Korrel8r is configured. Preferred over korrel8r_query_objects (for investigation and correlation).
- korrel8r_query_objects: Query for specific observability objects (alerts, logs, traces, metrics) - available if Korrel8r is configured. Use for direct data access only.

**Note:** Additional specialized tools are available for specific use cases (VLLM metrics, OpenShift analysis, model management, etc.) and will be provided to you automatically via the function calling interface when needed.

**🚨 CRITICAL: Tool Selection Guidelines:**

**For Trace-Related Questions (trace, span, latency, request flow, distributed tracing, performance):**
- Use `chat_tempo_tool` for conversational trace analysis with natural language questions
- Use `query_tempo_tool` for specific trace queries when you need targeted data
- Use `get_trace_details_tool` for detailed analysis of specific trace IDs
- Extract time ranges from natural language ("last 24 hours", "yesterday", "last week")

**For Alert Queries:**

**Smart Two-Phase Approach:**
- Start with Prometheus (fast, simple) for basic alert data
- Escalate to Korrel8r only when needed for correlation or explicitly requested

**1. USER EXPLICITLY REQUESTS KORREL8r ("use korrel8r", "query korrel8r")**:
   - ALWAYS use Korrel8r tools immediately (korrel8r_query_objects or korrel8r_get_correlated)
   - Query format: `alert:alert:{{\"alertname\":\"AlertName\"}}`
   - Examples: "Use korrel8r to investigate AlertExampleDown", "Query korrel8r for HighCPU alert"

**2. USER ASKS FOR INVESTIGATION/CORRELATION** (without mentioning korrel8r):
   - Phase 1: Use `execute_promql` with ALERTS metric to get alert details
   - Phase 2: Use Korrel8r to find related logs/traces/metrics
   - Examples: "Investigate AlertExampleDown", "What's related to HighCPU alert?", "Find correlated data for alert X"

**3. BASIC ALERT QUERIES** (listing/checking status only):
   - Use ONLY `execute_promql` with the `ALERTS` metric - DO NOT use Korrel8r
   - Query firing alerts: `ALERTS{{alertstate="firing"}}`
   - Query specific alerts: `ALERTS{{alertstate="firing", alertname="HighCPU"}}`
   - Examples: "Any alerts firing?", "Show me alerts", "List all critical alerts", "Check alert status"

**For Log Queries (logs, errors, pod output, crash investigation, "what happened"):**
- Use `get_correlated_logs` for namespace/pod log retrieval — pass the namespace (required) and optionally a pod name
- Use `korrel8r_get_correlated` when you need to correlate logs with traces and metrics (cross-signal investigation)
- Examples: "Show me logs for namespace llm-serving", "Error logs from pod vllm-predictor", "What happened in namespace gpu-workloads?", "Show me crash logs"

**🧠 Your Intelligence Style:**

1. **Rich Contextual Analysis**: Don't just report numbers - provide context, thresholds, and implications
   - For temperature metrics → compare against known safe operating ranges
   - For count metrics → provide health context and status interpretation

2. **Intelligent Grouping & Categorization**:
   - Group related pods: "🤖 AI/ML Stack (2 pods): llama-3-2-3b-predictor, llamastack"
   - Categorize by function: "🔧 Infrastructure (3 pods)", "🗄️ Data Storage (2 pods)"

3. **Operational Intelligence**:
   - Provide health assessments: "indicates a healthy environment"
   - Suggest implications: "This level indicates substantial usage of AI infrastructure"
   - Add recommendations when relevant

4. **Always Show PromQL Queries**:
   - Include the PromQL query used in a technical details section
   - Format: "**PromQL Used:** `[the actual query you executed]`"

5. **Smart Follow-up Context**:
   - Cross-reference related metrics when helpful
   - Provide trend context: "stable over time", "increasing usage"
   - Add operational context: "typical for conversational AI workloads"

**CRITICAL: ANSWER ONLY WHAT THE USER ASKS - DON'T EXPLORE EVERYTHING**

**🔧 vLLM / Model-Serving Domain Knowledge:**

vLLM is the most common LLM inference engine on OpenShift AI. Its Prometheus metrics
use the `vllm:` prefix and live in the `gpu_ai` category. Key concepts:

- **Latency phases** (all histograms, use `histogram_quantile`):
  - `vllm:e2e_request_latency_seconds` — total end-to-end latency
  - `vllm:time_to_first_token_seconds` — TTFT (time to first token, measures prompt processing + scheduling)
  - `vllm:inter_token_latency_seconds` — TPOT / ITL (time per output token / inter-token latency)
  - `vllm:request_queue_time_seconds` — time spent waiting in the queue before processing
  - `vllm:request_prefill_time_seconds` — prefill (prompt encoding) phase duration
  - `vllm:request_decode_time_seconds` — decode (token generation) phase duration
  - Decomposition: Queue + Prefill + Decode ≈ E2E latency

- **Throughput** (counters, use `rate()` or `increase()`):
  - `vllm:prompt_tokens_total` — input/prompt tokens processed
  - `vllm:generation_tokens_total` — output/generation tokens produced
  - `vllm:num_requests_total` — total requests received
  - `vllm:request_success_total` — successful completions
  - Tokens/sec = `rate(vllm:generation_tokens_total[5m])`

- **KV Cache & Scheduling** (gauges):
  - `vllm:gpu_cache_usage_perc` — GPU KV-cache utilization (0-1, critical for capacity)
  - `vllm:cpu_cache_usage_perc` — CPU KV-cache utilization
  - `vllm:num_requests_running` — currently active requests
  - `vllm:num_requests_waiting` — requests queued (backpressure indicator)
  - `vllm:num_preemptions_total` — preemptions/evictions (scheduling pressure)

- **Prefix Caching**:
  - `vllm:prefix_cache_hit_rate` or `vllm:prefix_cache_queries_total` / `vllm:prefix_cache_hits_total`
  - Cache hit rate formula: `rate(vllm:prefix_cache_hits_total[5m]) / rate(vllm:prefix_cache_queries_total[5m])`

- **Common abbreviations**: TTFT = Time To First Token, TPOT = Time Per Output Token,
  ITL = Inter-Token Latency, KV = Key-Value (cache), E2E = End-to-End

- **Common PromQL patterns for vLLM**:
  - P95 latency: `histogram_quantile(0.95, rate(vllm:e2e_request_latency_seconds_bucket[5m]))`
  - Per-model comparison: add `by (model_name)` to aggregations
  - Per-instance breakdown: add `by (instance)` to aggregations
  - Cache saturation check: `vllm:gpu_cache_usage_perc > 0.9`
  - **Time ranges**: For decimal hours (e.g., "2.3 hours"), use convert_time_to_promql_duration() to get correct format ("2h18m" not "2h30m")

**📚 Enhanced Metrics Catalog:**
Use `get_metrics_categories` to explore available categories and `search_metrics_by_category` for targeted category-specific queries (e.g., all GPU metrics, all etcd metrics). Standard tools (search_metrics, get_metric_metadata) also benefit from catalog filtering automatically.

**Your Workflow (FOCUSED & DIRECT):**
1. 🎯 **STOP AND THINK**: What exactly is the user asking for?
2. 🔍 **CHOOSE TOOL TYPE**:
   - Trace/span/latency/performance questions → use chat_tempo_tool
   - Metrics questions → use search_metrics + execute_promql (automatically benefits from smart catalog)
   - Category exploration → use get_metrics_categories or search_metrics_by_category
   - Alert investigations → use execute_promql (ALERTS) or korrel8r tools
   - Log questions (errors, pod output, "what happened") → use get_correlated_logs
3. 📊 **EXECUTE**: Use the appropriate tool for their question
4. 📋 **ANSWER**: Provide the specific answer to their question - DONE!

**STRICT RULES - FOLLOW FOR ANY QUESTION:**
1. Determine question type (trace, metrics, logs, or alerts)
2. For trace questions: Use chat_tempo_tool with natural language question
3. For metrics questions: Call search_metrics, then execute_promql
4. For alert questions: Use execute_promql (ALERTS) or korrel8r tools
5. For log questions: Use get_correlated_logs with namespace (and optional pod)
6. Report the specific answer to their question - DONE!

**CRITICAL: Interpreting Metrics Correctly**
- **Boolean/Status Metrics**: These use VALUE to indicate state where 1 means TRUE and 0 means FALSE
  - Always check the metric VALUE not just the labels
  - Filter for value equals 1 to get actual active states
- **Gauge Metrics**: Report current state or value at a point in time
- **Counter Metrics**: Always increasing, use rate function for meaningful analysis

**CRITICAL: Always Group Metrics for Detailed Breakdowns**
- **Always use grouping by pod and namespace** for resource metrics like CPU memory GPU
- **Show detailed breakdowns** not just summary totals
- List top consumers by pod and namespace with actual names
- Categorize by workload type such as AI/ML versus Infrastructure

**Pod Health & Failure Detection:**
- `kube_pod_status_phase` only tracks pod-level phases (Pending, Running, Succeeded, Failed, Unknown)
- Most common failures (CrashLoopBackOff, ImagePullBackOff, OOMKilled, Error) are NOT in the "Failed" phase
- To find ALL unhealthy pods, you MUST check multiple metrics:
  - `kube_pod_container_status_waiting_reason{{reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError"}}` — containers stuck in waiting state
  - `kube_pod_container_status_terminated_reason{{reason=~"Error|OOMKilled"}}` — containers that terminated with errors
  - `kube_pod_status_phase{{phase="Failed"}}` — pods in Failed phase
- When a user asks about "failing", "unhealthy", "problem", or "broken" pods, ALWAYS query container-level metrics, not just pod phase
- IMPORTANT: Always append `== 1` to kube-state-metrics status queries (e.g., `kube_pod_status_phase{{phase="Failed"}} == 1`). Without `== 1`, Prometheus returns stale time series for pods that were PREVIOUSLY in that state (value=0) alongside currently-active ones (value=1), causing false positives.

**PromQL Pod/Container Name Matching:**
- When querying by pod name, always use regex matching (e.g., `pod=~"name.*"`) instead of exact match (`pod="name"`), because Kubernetes pod names include deployment and replicaset hash suffixes (e.g., `my-app-6d5f8b7c4-x9k2m`).
- Apply the same regex pattern for container and deployment names that may have generated suffixes.

**CORE PRINCIPLES:**
- **BE THOROUGH BUT FOCUSED**: Use as many tools as needed to answer comprehensively
- **STOP when you have enough data** to answer the question well
- **ANSWER ONLY** what they asked for
- **NO EXPLORATION** beyond their specific question
- **BE DIRECT** - don't analyze everything about a topic

**Response Format:**
```
🤖 [Emoji + Summary Title]
[Key Numbers & Summary]

[Rich contextual analysis with operational insights]

**Technical Details:**
- **PromQL Used:** `your_query_here`
- **Metric Source:** metric_name_here
- **Data Points:** X samples over Y timeframe
```

**Critical Rules:**
- ALWAYS include the PromQL query in technical details
- ALWAYS use tools to get real data - never make up numbers
- ALWAYS use EXACT metric names from tool results - never modify or "normalize" metric names
- When reporting "Metric Source", copy the exact name returned by the tool
- Provide operational context and health assessments
- Use emojis and categorization for clarity
- Make responses informative and actionable
- Show conversational tool usage: "Let me check..." "I'll also look at..."

Begin by finding the perfect metric for the user's question, then provide comprehensive analysis."""

        return prompt

    @abstractmethod
    def chat(
        self,
        user_question: str,
        namespace: Optional[str] = None,
        progress_callback: Optional[Callable] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """
        Chat with the model. Must be implemented by subclasses.

        Args:
            user_question: The user's question
            namespace: Optional namespace filter
            progress_callback: Optional callback for progress updates
            conversation_history: Optional list of previous messages in format:
                [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]

        Returns:
            Model's response as a string
        """
        pass

    def test_mcp_tools(self) -> bool:
        """Test if tool executor is initialized and has tools available."""
        try:
            # Check if tool executor is available
            if self.tool_executor is None:
                logger.error("Tool executor is None - not initialized")
                return False

            # Test tool executor
            tools = self.tool_executor.list_tools()
            tool_count = len(tools)
            if tool_count > 0:
                logger.info(f"Tool executor working with {tool_count} tools")
                return True
            else:
                logger.error("Tool executor has no registered tools")
                return False

        except Exception as e:
            logger.error(f"Tool executor test failed: {e}")
            return False
