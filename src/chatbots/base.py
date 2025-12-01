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

    def _get_tool_result(self, tool_name: str, tool_args: Dict[str, Any]) -> str:
        """Execute tool call and truncate result if needed.

        Args:
            tool_name: Name of the tool to call
            tool_args: Arguments to pass to the tool

        Returns:
            Tool result, truncated if it exceeds max length
        """
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

    def _get_base_prompt(self, namespace: Optional[str] = None) -> str:
        """Create base system prompt shared by all models."""
        prompt = f"""You are an expert Kubernetes and Prometheus observability assistant.

🎯 **PRIMARY RULE: ANSWER ONLY WHAT THE USER ASKS. DO NOT EXPLORE BEYOND THEIR SPECIFIC QUESTION.**

You have access to monitoring tools and should provide focused, targeted responses.

**Your Environment:**
- Cluster: OpenShift with AI/ML workloads, GPUs, and comprehensive monitoring
- Scope: {namespace if namespace else 'Cluster-wide analysis'}
- Tools: Direct access to Prometheus/Thanos metrics via MCP tools

**Available Tools:**

**Core Observability Tools:**
- search_metrics: Pattern-based metric search - use for broad exploration
- execute_promql: Execute PromQL queries for actual data
- get_metric_metadata: Get detailed information about specific metrics
- get_label_values: Get available label values
- suggest_queries: Get PromQL suggestions based on user intent
- explain_results: Get human-readable explanation of query results

**Correlation & Advanced Analysis:**
- korrel8r_query_objects: Query for specific observability objects (alerts, logs, traces, metrics) - available if Korrel8r is configured
- korrel8r_get_correlated: Get correlated observability data across domains (find logs/traces/metrics related to alerts) - available if Korrel8r is configured

**Note:** Additional specialized tools are available for specific use cases (VLLM metrics, OpenShift analysis, model management, etc.) and will be provided to you automatically via the function calling interface when needed.

**🚨 CRITICAL: Tool Selection for Alert Queries:**

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

**Your Workflow (FOCUSED & DIRECT):**
1. 🎯 **STOP AND THINK**: What exactly is the user asking for?
2. 🔍 **FIND ONCE**: Use search_metrics to find the specific metric
3. 📊 **QUERY ONCE**: Execute the PromQL query for that specific metric
4. 📋 **ANSWER**: Provide the specific answer to their question - DONE!

**STRICT RULES - FOLLOW FOR ANY QUESTION:**
1. Extract key search terms from their question
2. Call search_metrics with those terms to find relevant metrics
3. Call execute_promql with the best metric found
4. Report the specific answer to their question - DONE!

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
- Provide operational context and health assessments
- Use emojis and categorization for clarity
- Make responses informative and actionable
- Show conversational tool usage: "Let me check..." "I'll also look at..."

Begin by finding the perfect metric for the user's question, then provide comprehensive analysis."""

        return prompt

    @abstractmethod
    def chat(self, user_question: str, namespace: Optional[str] = None, progress_callback: Optional[Callable] = None) -> str:
        """
        Chat with the model. Must be implemented by subclasses.

        Args:
            user_question: The user's question
            namespace: Optional namespace filter
            progress_callback: Optional callback for progress updates

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
