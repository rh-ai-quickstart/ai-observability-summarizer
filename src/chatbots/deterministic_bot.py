"""
Deterministic Chat Bot Implementation

This module provides a deterministic parsing implementation for models
that don't have reliable tool calling capabilities (e.g., Llama 3.2 with ~67% accuracy).
"""

import json
import re
from typing import Optional, List, Dict, Any, Callable

from .base import BaseChatBot
from chatbots.tool_executor import ToolExecutor
from common.pylogger import get_python_logger

logger = get_python_logger()


class DeterministicChatBot(BaseChatBot):
    """Deterministic parsing implementation for small models without reliable tool calling."""

    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        tool_executor: ToolExecutor = None):
        super().__init__(model_name, api_key, tool_executor)

    def _get_api_key(self) -> Optional[str]:
        """Local models don't require API keys."""
        return None

    def chat(self, user_question: str, namespace: Optional[str] = None, progress_callback: Optional[Callable] = None) -> str:
        """Chat using deterministic parsing approach."""
        if progress_callback:
            progress_callback("🔍 Analyzing your question...")

        # Extract key concepts from the question
        question_lower = user_question.lower()

        # Identify query type and execute
        tool_results = []
        query_type = None

        # Memory-related questions (check FIRST to avoid "usage" matching CPU)
        if any(term in question_lower for term in ['memory', 'mem', 'ram']):
            query_type = 'memory'
            try:
                if progress_callback:
                    progress_callback("📊 Querying memory metrics...")

                memory_query = "sum(container_memory_usage_bytes{}) / 1024 / 1024 / 1024"
                query_result = self._route_tool_call_to_mcp("execute_promql", {"query": memory_query})

                tool_results.append({
                    "tool": "execute_promql",
                    "query": memory_query,
                    "result": query_result
                })
            except Exception as e:
                logger.error(f"Error calling MCP tools: {e}")
                return f"Error analyzing memory metrics: {str(e)}"

        # CPU-related questions
        elif any(term in question_lower for term in ['cpu', 'usage', 'utilization']):
            query_type = 'cpu'
            try:
                if progress_callback:
                    progress_callback("📊 Querying CPU metrics...")

                cpu_query = "cluster:container_cpu_usage:ratio"
                query_result = self._route_tool_call_to_mcp("execute_promql", {"query": cpu_query})

                tool_results.append({
                    "tool": "execute_promql",
                    "query": cpu_query,
                    "result": query_result
                })
            except Exception as e:
                logger.error(f"Error calling MCP tools: {e}")
                return f"Error analyzing CPU metrics: {str(e)}"

        else:
            # For general questions, provide a helpful response
            return f"""I understand you're asking about: "{user_question}"

To provide accurate metrics and insights, please ask about specific aspects like:
- CPU usage or utilization
- Memory usage
- Pod counts or status
- Network metrics
- Storage metrics

I'll query the Prometheus metrics and provide detailed analysis."""

        # Format the results deterministically
        if tool_results:
            if progress_callback:
                progress_callback("✨ Formatting response...")

            return self._format_deterministic_response(query_type, tool_results)

        return "No metrics found for your question. Please try asking about CPU, memory, pods, or other infrastructure metrics."

    def _format_deterministic_response(self, query_type: str, tool_results: List[Dict[str, Any]]) -> str:
        """Format response deterministically based on query type."""
        if query_type == 'cpu':
            return self._format_cpu_response(tool_results)
        elif query_type == 'memory':
            return self._format_memory_response(tool_results)
        return "Unable to format response for this query type."

    def _format_cpu_response(self, tool_results: List[Dict[str, Any]]) -> str:
        """Format CPU query response."""
        try:
            result_text = tool_results[0]['result']
            query_used = tool_results[0]['query']

            # Extract CPU value
            cpu_value = self._extract_numeric_value(result_text)

            if cpu_value is not None:
                cpu_percent = cpu_value * 100

                # Determine usage level
                if cpu_percent < 20:
                    usage_level = "low"
                    recommendation = "The cluster has plenty of available computational resources."
                elif cpu_percent < 60:
                    usage_level = "moderate"
                    recommendation = "CPU utilization is within normal operating range."
                elif cpu_percent < 80:
                    usage_level = "high"
                    recommendation = "Consider monitoring for potential performance impacts."
                else:
                    usage_level = "very high"
                    recommendation = "CPU resources are heavily utilized. Consider scaling or optimization."

                return f"""🖥️ CPU Usage Overview

Current CPU Utilization: {cpu_percent:.2f}%

📊 Detailed Breakdown:
- The cluster is currently using approximately {cpu_percent:.2f}% of its total CPU capacity
- This indicates a {usage_level} level of CPU utilization
- The metric represents the ratio of CPU cores being used across the entire cluster

PromQL Used: `{query_used}`

Operational Insights:
- {recommendation}
- This measurement reflects cluster-wide container CPU usage"""

            else:
                return f"""🖥️ CPU Usage Analysis

I retrieved the CPU metrics but had trouble parsing the exact value.

PromQL Used: `{query_used}`

Raw result: {result_text[:500]}

Please check the Prometheus query directly for detailed values."""

        except Exception as e:
            logger.error(f"Error parsing CPU result: {e}")
            return f"Error formatting CPU metrics: {str(e)}\n\nRaw result: {tool_results[0]['result'][:500]}"

    def _format_memory_response(self, tool_results: List[Dict[str, Any]]) -> str:
        """Format memory query response."""
        try:
            result_text = tool_results[0]['result']
            query_used = tool_results[0]['query']

            # Extract memory value
            memory_gb = self._extract_numeric_value(result_text)

            if memory_gb is not None:
                # Determine usage level
                if memory_gb < 100:
                    usage_level = "low"
                    recommendation = "Memory usage is minimal, plenty of capacity available."
                elif memory_gb < 500:
                    usage_level = "moderate"
                    recommendation = "Memory usage is within normal operating range."
                elif memory_gb < 1000:
                    usage_level = "high"
                    recommendation = "Memory usage is elevated. Monitor for potential issues."
                else:
                    usage_level = "very high"
                    recommendation = "Substantial memory consumption. Review container memory requests and limits."

                return f"""🧠 Memory Usage Analysis

Total Memory Used: {memory_gb:.1f} GB

📊 Detailed Breakdown:
- Cluster containers are using approximately {memory_gb:.1f} GB of memory
- This indicates a {usage_level} level of memory utilization
- The metric represents total container memory usage across the cluster

PromQL Used: `{query_used}`

Operational Insights:
- {recommendation}
- This measurement reflects cluster-wide container memory consumption"""

            else:
                return f"""🧠 Memory Usage Analysis

I retrieved the memory metrics but had trouble parsing the exact value.

PromQL Used: `{query_used}`

Raw result: {result_text[:500]}

Please check the Prometheus query directly for detailed values."""

        except Exception as e:
            logger.error(f"Error parsing memory result: {e}")
            return f"Error formatting memory metrics: {str(e)}\n\nRaw result: {tool_results[0]['result'][:500]}"

    def _extract_numeric_value(self, result_text: str) -> Optional[float]:
        """Extract numeric value from tool result."""
        if not isinstance(result_text, str):
            return None

        # Try JSON first
        try:
            result_json = json.loads(result_text)
            if isinstance(result_json, dict):
                if 'results' in result_json and len(result_json['results']) > 0:
                    first_result = result_json['results'][0]
                    if 'value' in first_result and len(first_result['value']) > 1:
                        return float(first_result['value'][1])
        except (json.JSONDecodeError, ValueError, KeyError):
            pass

        # Try regex
        match = re.search(r'"value"\s*:\s*\[\s*[\d.]+\s*,\s*"([\d.]+)"', result_text)
        if match:
            return float(match.group(1))

        # Try to find any decimal number
        match = re.search(r'(\d+\.\d+)', result_text)
        if match:
            return float(match.group(1))

        return None
