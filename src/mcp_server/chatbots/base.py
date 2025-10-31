"""
Base Chat Bot - Common Functionality

This module provides the base class for all chat bot implementations.
All provider-specific implementations inherit from BaseChatBot.
"""

import os
import re
import logging
import importlib.util
from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any, Callable

from mcp_server.observability_mcp import ObservabilityMCPServer
from common.pylogger import get_python_logger
from core.config import KORREL8R_ENABLED

logger = get_python_logger()


class BaseChatBot(ABC):
    """Base class for all chat bot implementations with common functionality."""

    def __init__(self, model_name: str, api_key: Optional[str] = None):
        """Initialize base chat bot."""
        self.model_name = model_name
        # Let each subclass decide how to get its API key
        self.api_key = api_key if api_key is not None else self._get_api_key()

        # Initialize MCP server (our tools)
        self.mcp_server = ObservabilityMCPServer()

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
        """Get the base MCP tools that we want to expose."""
        tools = [
            {
                "name": "search_metrics",
                "description": "Search for Prometheus metrics by pattern (regex supported). Essential for discovering relevant metrics.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Search pattern or regex for metric names (e.g., 'pod', 'gpu', 'memory')"
                        }
                    },
                    "required": ["pattern"]
                }
            },
            {
                "name": "get_metric_metadata",
                "description": "Get detailed metadata about a specific metric including type, help text, available labels, and query examples.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "metric_name": {
                            "type": "string",
                            "description": "Exact name of the metric to get metadata for"
                        }
                    },
                    "required": ["metric_name"]
                }
            },
            {
                "name": "execute_promql",
                "description": "Execute a PromQL query against Prometheus/Thanos and get results. Use this to get actual metric values.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Valid PromQL query to execute (use metrics discovered through search_metrics or find_best_metric tools)"
                        },
                        "time_range": {
                            "type": "string",
                            "description": "Optional time range (e.g., '5m', '1h', '1d')",
                            "default": "now"
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "get_label_values",
                "description": "Get all possible values for a specific label across metrics.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "label_name": {
                            "type": "string",
                            "description": "Name of the label to get values for (e.g., 'namespace', 'phase', 'job')"
                        }
                    },
                    "required": ["label_name"]
                }
            },
            {
                "name": "suggest_queries",
                "description": "Get PromQL query suggestions based on intent or description.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "intent": {
                            "type": "string",
                            "description": "What you want to query about the infrastructure (describe in natural language)"
                        }
                    },
                    "required": ["intent"]
                }
            },
            {
                "name": "explain_results",
                "description": "Get human-readable explanation of query results and metrics data.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "data": {
                            "type": "string",
                            "description": "Query results or metrics data to explain"
                        }
                    },
                    "required": ["data"]
                }
            }
        ]

        # Conditionally expose Korrel8r tools
        if KORREL8R_ENABLED:
            tools.append({
                "name": "korrel8r_get_correlated",
                "description": "Get correlated objects by first listing goal queries then fetching objects for each via Korrel8r.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "goals": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Korrel8r goal classes to correlate. Examples: ['trace:span','log:application','log:infrastructure','metric:metric']"
                        },
                        "query": {
                            "type": "string",
                            "description": 'Starting Korrel8r domain query (same format as korrel8r_query_objects). Examples: alert:alert:{"alertname":"PodDisruptionBudgetAtLimit"}, k8s:Pod:{"namespace":"llm-serving"}, loki:log:{"kubernetes.namespace_name":"llm-serving","kubernetes.pod_name":"p-abc"}, trace:span:{".k8s.namespace.name":"llm-serving"}'
                        }
                    },
                    "required": ["goals", "query"]
                }
            })
            logger.info("Korrel8r tool added to base MCP tools")

        return tools

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
        """Route tool call to our MCP server with optional korrel8r query normalization."""
        # Normalize Korrel8r query inputs when needed before calling MCP
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
            # Import MCP client helper to call our tools
            import sys
            ui_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'ui')
            if ui_path not in sys.path:
                sys.path.insert(0, ui_path)

            try:
                from mcp_client_helper import MCPClientHelper
            except ImportError:
                # Load mcp_client_helper directly
                mcp_helper_path = os.path.join(ui_path, 'mcp_client_helper.py')
                spec = importlib.util.spec_from_file_location("mcp_client_helper", mcp_helper_path)
                mcp_helper = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mcp_helper)
                MCPClientHelper = mcp_helper.MCPClientHelper

            mcp_client = MCPClientHelper()

            # Call the tool via MCP (after optional normalization)
            result = mcp_client.call_tool_sync(tool_name, arguments)

            if result and len(result) > 0:
                return result[0]['text']
            else:
                return f"No results returned from {tool_name}"

        except Exception as e:
            logger.error(f"Error calling MCP tool {tool_name}: {e}")
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
        # Route to MCP server
        tool_result = self._route_tool_call_to_mcp(tool_name, tool_args)

        # Truncate large results to prevent context overflow
        max_length = self._get_max_tool_result_length()
        if isinstance(tool_result, str) and len(tool_result) > max_length:
            tool_result = tool_result[:max_length] + "\n... [Result truncated due to size]"

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
- search_metrics: Pattern-based metric search - use for broad exploration
- execute_promql: Execute PromQL queries for actual data
- get_metric_metadata: Get detailed information about specific metrics
- get_label_values: Get available label values
- suggest_queries: Get PromQL suggestions based on user intent
- explain_results: Get human-readable explanation of query results

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
    def chat(self, user_question: str, namespace: Optional[str] = None, scope: Optional[str] = None, progress_callback: Optional[Callable] = None) -> str:
        """
        Chat with the model. Must be implemented by subclasses.

        Args:
            user_question: The user's question
            namespace: Optional namespace filter
            scope: Optional scope filter
            progress_callback: Optional callback for progress updates

        Returns:
            Model's response as a string
        """
        pass

    def test_mcp_tools(self) -> bool:
        """Test if MCP tools server is initialized and has tools available."""
        try:
            # Check if MCP server is available
            if self.mcp_server is None:
                logger.error("MCP server is None - not initialized")
                return False

            # Test MCP server
            if hasattr(self.mcp_server, 'mcp') and hasattr(self.mcp_server.mcp, '_tool_manager'):
                tool_count = len(self.mcp_server.mcp._tool_manager._tools)
                if tool_count > 0:
                    logger.info(f"MCP server working with {tool_count} tools")
                    return True
                else:
                    logger.error("MCP server has no registered tools")
                    return False
            else:
                logger.error("MCP server not properly initialized")
                return False

        except Exception as e:
            logger.error(f"MCP tools test failed: {e}")
            return False
