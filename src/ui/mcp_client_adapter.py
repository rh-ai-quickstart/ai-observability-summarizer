"""
MCP Client Adapter for Chatbots in UI

This module provides an adapter that implements ToolExecutor for use in the UI process.
It wraps an MCP client connection to execute tools via the MCP protocol.
"""

from typing import Dict, Any, List, Optional
import json

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from chatbots.tool_executor import ToolExecutor, MCPTool
from common.pylogger import get_python_logger

logger = get_python_logger()


class MCPClientAdapter(ToolExecutor):
    """Adapter for executing tools via MCP client in the UI process.

    This adapter wraps an MCP client session and provides the ToolExecutor
    interface for chatbots to execute tools via the MCP protocol.
    """

    def __init__(self, mcp_client_helper):
        """Initialize with MCP client helper instance.

        Args:
            mcp_client_helper: MCPClientHelper instance that provides MCP client access
        """
        self.mcp_client = mcp_client_helper
        self._tools_cache: Optional[List[MCPTool]] = None
        logger.info("🔌 MCPClientAdapter initialized for MCP protocol access")

    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Call an MCP tool via the MCP client.

        Args:
            tool_name: Name of the tool to call
            arguments: Tool arguments as a dictionary

        Returns:
            Tool result as a string

        Raises:
            Exception: If tool execution fails
        """
        try:
            logger.info(f"🔧 MCPClientAdapter calling tool: {tool_name}")

            # Call tool via MCP client helper
            result = self.mcp_client.call_tool_sync(tool_name, arguments)

            # Import helper function from common module (breaks circular dependency)
            from common.mcp_utils import extract_text_from_mcp_result

            # Extract text from MCP result
            result_text = extract_text_from_mcp_result(result)

            if result_text:
                return result_text
            else:
                # Fallback to stringification
                if isinstance(result, str):
                    return result
                else:
                    return json.dumps(result)

        except Exception as e:
            logger.error(f"❌ Error calling tool {tool_name} via MCP client: {e}")
            raise

    def list_tools(self) -> List[MCPTool]:
        """List all available MCP tools from the server via client.

        Returns:
            List of MCPTool objects with metadata
        """
        try:
            # Use cached tools if available
            if self._tools_cache is not None:
                return self._tools_cache

            logger.info("📋 MCPClientAdapter listing available MCP tools")

            # List tools via MCP client helper
            tools_response = self.mcp_client.get_available_tools()

            if not tools_response:
                logger.warning("No tools response from MCP client")
                return []

            mcp_tools = []

            # Handle fastmcp.Client response format
            if hasattr(tools_response, 'tools'):
                # ListToolsResult object
                tools_list = tools_response.tools
            elif isinstance(tools_response, dict) and 'tools' in tools_response:
                tools_list = tools_response['tools']
            elif isinstance(tools_response, list):
                tools_list = tools_response
            else:
                logger.warning(f"Unexpected tools response format: {type(tools_response)}")
                tools_list = []

            for tool_info in tools_list:
                # Handle protobuf/dataclass Tool objects
                if hasattr(tool_info, 'name'):
                    mcp_tool = MCPTool(
                        name=tool_info.name,
                        description=getattr(tool_info, 'description', ''),
                        input_schema=getattr(tool_info, 'inputSchema', {})
                    )
                    mcp_tools.append(mcp_tool)
                elif isinstance(tool_info, dict):
                    # Handle dict format
                    mcp_tool = MCPTool(
                        name=tool_info.get('name', ''),
                        description=tool_info.get('description', ''),
                        input_schema=tool_info.get('input_schema', {})
                    )
                    mcp_tools.append(mcp_tool)

            # Cache the tools
            self._tools_cache = mcp_tools

            logger.info(f"✅ MCPClientAdapter found {len(mcp_tools)} MCP tools")
            return mcp_tools

        except Exception as e:
            logger.error(f"❌ Error listing MCP tools via MCP client: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return []

    def get_tool(self, tool_name: str) -> Optional[MCPTool]:
        """Get metadata for a specific MCP tool.

        Args:
            tool_name: Name of the tool

        Returns:
            MCPTool object if found, None otherwise
        """
        try:
            # Get all tools (uses cache if available)
            mcp_tools = self.list_tools()

            # Find the specific tool
            for mcp_tool in mcp_tools:
                if mcp_tool.name == tool_name:
                    logger.debug(f"Found tool: {tool_name}")
                    return mcp_tool

            logger.warning(f"Tool not found: {tool_name}")
            return None

        except Exception as e:
            logger.error(f"❌ Error getting tool {tool_name}: {e}")
            return None
