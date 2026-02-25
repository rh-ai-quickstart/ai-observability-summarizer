"""Tests for MCPServerAdapter — verifies FastMCP 3.x list_tools() integration."""

from unittest.mock import AsyncMock, Mock

from mcp_server.mcp_tools_adapter import MCPServerAdapter


def _make_function_tool(name: str, description: str, parameters: dict):
    """Create a mock that looks like a FastMCP 3.x FunctionTool."""
    tool = Mock()
    tool.name = name
    tool.description = description
    tool.parameters = parameters
    return tool


def _make_server_with_tools(tools: list):
    """Create a mock ObservabilityMCPServer whose mcp.list_tools() returns *tools*."""
    server = Mock()
    server.mcp = Mock()
    server.mcp.list_tools = AsyncMock(return_value=tools)
    return server


class TestListTools:
    """Verify MCPServerAdapter.list_tools() works with FastMCP 3.x API."""

    def test_list_tools_returns_mcp_tool_objects(self):
        tools = [
            _make_function_tool("execute_promql", "Run a PromQL query", {"type": "object", "properties": {"query": {"type": "string"}}}),
            _make_function_tool("get_trace_details_tool", "Get trace details", {"type": "object", "properties": {"trace_id": {"type": "string"}}}),
        ]
        adapter = MCPServerAdapter(_make_server_with_tools(tools))

        result = adapter.list_tools()

        assert len(result) == 2
        assert result[0].name == "execute_promql"
        assert result[0].description == "Run a PromQL query"
        assert result[0].input_schema == {"type": "object", "properties": {"query": {"type": "string"}}}
        assert result[1].name == "get_trace_details_tool"

    def test_list_tools_empty(self):
        adapter = MCPServerAdapter(_make_server_with_tools([]))

        result = adapter.list_tools()

        assert result == []

    def test_list_tools_handles_none_description(self):
        tools = [_make_function_tool("my_tool", None, {})]
        adapter = MCPServerAdapter(_make_server_with_tools(tools))

        result = adapter.list_tools()

        assert result[0].description == ""

    def test_list_tools_handles_missing_parameters(self):
        tool = Mock()
        tool.name = "simple_tool"
        tool.description = "A tool"
        del tool.parameters  # no parameters attribute
        adapter = MCPServerAdapter(_make_server_with_tools([tool]))

        result = adapter.list_tools()

        assert result[0].input_schema == {}

    def test_list_tools_calls_fastmcp_list_tools_not_get_tools(self):
        """Ensure we call list_tools() (3.x API), not get_tools() (2.x API)."""
        server = _make_server_with_tools([])
        adapter = MCPServerAdapter(server)

        adapter.list_tools()

        server.mcp.list_tools.assert_called_once()
        assert not hasattr(server.mcp, 'get_tools') or not server.mcp.get_tools.called

    def test_list_tools_returns_empty_on_error(self):
        server = Mock()
        server.mcp = Mock()
        server.mcp.list_tools = AsyncMock(side_effect=AttributeError("'FastMCP' object has no attribute 'list_tools'"))
        adapter = MCPServerAdapter(server)

        result = adapter.list_tools()

        assert result == []
