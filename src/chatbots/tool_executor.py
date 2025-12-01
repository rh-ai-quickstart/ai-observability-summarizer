"""
Tool Executor Interface - Abstract interface for chatbots to execute tools.

This interface allows chatbots to execute tools without depending on
whether they're running in the MCP server process or in a client process.

Implementations:
- MCPServerAdapter (mcp_server/mcp_tools_adapter.py) - Direct tool calls in server process
- MCPClientAdapter (ui/mcp_client_adapter.py) - MCP protocol calls via FastMCP client from UI
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional


class MCPTool:
    """Represents a tool with metadata."""

    def __init__(self, name: str, description: str, input_schema: Dict[str, Any]):
        self.name = name
        self.description = description
        self.input_schema = input_schema


class ToolExecutor(ABC):
    """Abstract interface for executing tools.

    This allows chatbots to execute tools without knowing whether they're
    running in the MCP server process or as a client.
    """

    @abstractmethod
    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Execute a tool and return the result as a string.

        Args:
            tool_name: Name of the tool to call
            arguments: Dictionary of arguments for the tool

        Returns:
            Tool result as string

        Raises:
            ValueError: If tool not found
            Exception: If tool execution fails
        """
        pass

    @abstractmethod
    def list_tools(self) -> List[MCPTool]:
        """List all available tools.

        Returns:
            List of MCPTool objects
        """
        pass

    @abstractmethod
    def get_tool(self, tool_name: str) -> Optional[MCPTool]:
        """Get metadata for a specific tool.

        Args:
            tool_name: Name of the tool

        Returns:
            MCPTool object if found, None otherwise
        """
        pass
