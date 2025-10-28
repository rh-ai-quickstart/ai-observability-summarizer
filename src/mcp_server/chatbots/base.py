"""
Base Chat Bot - Common Functionality

This module provides the base class for all chat bot implementations.
All provider-specific implementations inherit from BaseChatBot.
"""

import os
import json
import logging
import importlib.util
from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any, Callable

try:
    from ..observability_mcp import ObservabilityMCPServer
except ImportError:
    try:
        from mcp_server.observability_mcp import ObservabilityMCPServer
    except ImportError:
        ObservabilityMCPServer = None

# Import logger from common directory
try:
    from common.pylogger import get_python_logger
except ImportError:
    def get_python_logger(name):
        return logging.getLogger(name)

try:
    from ...core.config import MODEL_CONFIG
except ImportError:
    # Fallback
    try:
        MODEL_CONFIG = json.loads(os.getenv("MODEL_CONFIG", "{}"))
    except:
        MODEL_CONFIG = {}

# Initialize logger
try:
    logger = get_python_logger(__name__)
    logger.setLevel(logging.INFO)
except Exception:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)


class BaseChatBot(ABC):
    """Base class for all chat bot implementations with common functionality."""

    def __init__(self, model_name: str, api_key: Optional[str] = None):
        """Initialize base chat bot."""
        self.model_name = model_name
        self.model_config = self._get_model_config(model_name)
        self.is_external = self.model_config.get("external", False) if self.model_config else False
        self.provider = self.model_config.get("provider", "local") if self.model_config else "local"
        self.api_key = api_key or self._get_default_api_key()

        # Initialize MCP server (our tools)
        if ObservabilityMCPServer is not None:
            self.mcp_server = ObservabilityMCPServer()
        else:
            self.mcp_server = None
            logger.warning("ObservabilityMCPServer not available - MCP tools will not work")

        logger.info(f"{self.__class__.__name__} initialized with model: {self.model_name}")

    @staticmethod
    def _get_model_config(model_name: str) -> Dict[str, Any]:
        """Get model configuration from MODEL_CONFIG."""
        if not isinstance(MODEL_CONFIG, dict):
            logger.warning("MODEL_CONFIG is not a dictionary")
            return {}

        model_config = MODEL_CONFIG.get(model_name, {})
        if not model_config:
            logger.warning(f"Model {model_name} not found in MODEL_CONFIG")
            return {}

        return model_config

    def _get_default_api_key(self) -> Optional[str]:
        """Get default API key based on provider."""
        if not self.model_config:
            return None
        provider = self.model_config.get("provider", "openai")

        if provider == "openai":
            return os.getenv("OPENAI_API_KEY")
        elif provider == "google":
            return os.getenv("GOOGLE_API_KEY")
        elif provider == "anthropic":
            return os.getenv("ANTHROPIC_API_KEY")
        else:
            return None

    def _get_mcp_tools(self) -> List[Dict[str, Any]]:
        """Get the base MCP tools that we want to expose."""
        return [
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

    def _route_tool_call_to_mcp(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Route tool call to our MCP server."""
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

            # Call the tool via MCP
            result = mcp_client.call_tool_sync(tool_name, arguments)

            if result and len(result) > 0:
                return result[0]['text']
            else:
                return f"No results returned from {tool_name}"

        except Exception as e:
            logger.error(f"Error calling MCP tool {tool_name}: {e}")
            return f"Error executing {tool_name}: {str(e)}"

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
