"""MCP tool for chatbot invocation with progress tracking.

This tool provides a unified interface for chatting with AI models through MCP.
Progress updates are captured and returned in the response for UI replay.
"""

import json
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)


def chat(
    model_name: str,
    message: str,
    api_key: Optional[str] = None,
    namespace: Optional[str] = None,
    scope: Optional[str] = None
) -> str:
    """
    Chat with AI models using observability tools.

    This tool creates a chatbot and executes the query with progress tracking.
    Progress updates are captured and returned in the response.

    Args:
        model_name: Model identifier (e.g., "anthropic/claude-3-5-sonnet-20241022",
                    "openai/gpt-4o-mini", "meta-llama/Llama-3.1-8B-Instruct")
        message: User's question
        api_key: Optional API key for external models (Anthropic, OpenAI, Google)
        namespace: Optional Kubernetes namespace filter
        scope: Optional scope (e.g., "cluster-wide")

    Returns:
        JSON string with response and progress_log

    Example:
        >>> result = chat(
        ...     model_name="anthropic/claude-3-5-sonnet-20241022",
        ...     message="What's the CPU usage?",
        ...     api_key="sk-ant-...",
        ...     namespace="llm-serving"
        ... )
        >>> parsed = json.loads(result)
        >>> print(parsed["response"])
        >>> for progress in parsed["progress_log"]:
        ...     print(progress["message"])
    """
    # Import from shared chatbots package and adapter
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))

    from chatbots import create_chatbot
    from mcp_server.mcp_tools_adapter import MCPServerAdapter

    logger.info(f"💬 Chat tool: model={model_name}, message={message[:50]}...")

    # Progress tracking
    progress_log: List[Dict[str, str]] = []
    iteration_count = 0

    def capture_progress(status_msg: str):
        """Capture progress updates with timestamps."""
        nonlocal iteration_count

        # Count iterations
        if "iteration" in status_msg.lower():
            iteration_count += 1

        progress_log.append({
            "timestamp": datetime.now().isoformat(),
            "message": status_msg
        })
        logger.info(f"📝 Progress: {status_msg}")

    try:
        # Get the MCP server instance (injected by FastMCP context)
        # We need to access the ObservabilityMCPServer instance
        # For now, we'll use a global reference that will be set during server initialization
        from mcp_server.observability_mcp import _server_instance

        # Create MCP tools adapter for this server
        tool_executor = MCPServerAdapter(_server_instance)

        # Create chatbot with tool executor
        chatbot = create_chatbot(
            model_name=model_name,
            api_key=api_key,
            tool_executor=tool_executor
        )

        logger.info(f"✅ Created {chatbot.__class__.__name__}")

        # Execute chat with progress callback
        capture_progress(f"🤖 Starting chat with {model_name}")

        # Note: scope parameter is not yet supported by chatbots, only namespace
        response = chatbot.chat(
            user_question=message,
            namespace=namespace,
            progress_callback=capture_progress
        )

        capture_progress("✅ Chat completed")

        # Return structured response
        result = {
            "response": response,
            "progress_log": progress_log,
            "model": model_name,
            "iterations": iteration_count,
            "timestamp": datetime.now().isoformat()
        }

        logger.info(f"✅ Chat completed: {len(progress_log)} updates, {iteration_count} iterations")

        return json.dumps(result, indent=2)

    except Exception as e:
        error_msg = f"Error in chat tool: {str(e)}"
        logger.error(error_msg, exc_info=True)

        return json.dumps({
            "error": error_msg,
            "progress_log": progress_log,
            "model": model_name,
            "timestamp": datetime.now().isoformat()
        })
