#!/usr/bin/env python3
"""
CLI example for invoking chatbots via the MCP chat tool.

This script demonstrates how to use the "chat" MCP tool by making HTTP requests
to the MCP server (local dev via scripts/local-dev.sh or deployed on OpenShift).

Usage:
    # Show help and all available options
    python scripts/chatbot_mcp_cli_example.py --help

    # Invoke chat with local Llama model (default)
    uv run scripts/chatbot_mcp_cli_example.py --model llama

    # Invoke chat with Anthropic Claude (will prompt for API key securely)
    python scripts/chatbot_mcp_cli_example.py --model anthropic

    # Invoke chat with OpenAI GPT (will prompt for API key securely)
    python scripts/chatbot_mcp_cli_example.py --model openai

    # Invoke chat with Google Gemini (will prompt for API key securely)
    python scripts/chatbot_mcp_cli_example.py --model gemini

    # Use with namespace scoping
    python scripts/chatbot_mcp_cli_example.py --model llama --namespace llm-serving

    # List all available MCP tools
    python scripts/chatbot_mcp_cli_example.py --list-tools

    # Custom MCP server URL (e.g., OpenShift deployment)
    python scripts/chatbot_mcp_cli_example.py --model llama --mcp-url https://your-mcp-server.apps.example.com
"""

import argparse
import json
import sys
import requests
import asyncio
import site
import getpass
import importlib
from typing import Dict, Any, Optional, List


# Sample queries for testing
SAMPLE_QUERIES = [
    "What is the current CPU usage in the cluster?",
    "Any alerts firing?",
    "Show me memory usage trends",
    "What's the GPU utilization?",
    "List all running pods",
    "What metrics are available?",
    "Analyze cluster performance",
]

# Model configurations
MODEL_CONFIGS = {
    "llama": {
        "model_name": "meta-llama/Llama-3.2-3B-Instruct",
        "requires_api_key": False,
        "display_name": "Local Llama Model",
    },
    "anthropic": {
        "model_name": "anthropic/claude-3-5-haiku-20241022",
        "requires_api_key": True,
        "api_key_provider": "Anthropic",
        "display_name": "Anthropic Claude",
    },
    "openai": {
        "model_name": "openai/gpt-4o-mini",
        "requires_api_key": True,
        "api_key_provider": "OpenAI",
        "display_name": "OpenAI GPT",
    },
    "gemini": {
        "model_name": "google/gemini-2.5-flash",
        "requires_api_key": True,
        "api_key_provider": "Google Gemini",
        "display_name": "Google Gemini",
    },
}


def get_api_key(provider: str) -> str:
    """Securely prompt for API key without showing in terminal."""
    try:
        api_key = getpass.getpass(f"Enter {provider} API key (input hidden): ")
        if not api_key.strip():
            print(f"❌ API key cannot be empty.")
            sys.exit(1)
        return api_key.strip()
    except KeyboardInterrupt:
        print("\n\n❌ Cancelled by user.")
        sys.exit(1)


def select_query() -> str:
    """Interactive query selection menu."""
    print("\n" + "="*80)
    print("Select a query to test:")
    print("="*80)

    for i, query in enumerate(SAMPLE_QUERIES, 1):
        print(f"  {i}. {query}")
    print(f"  {len(SAMPLE_QUERIES) + 1}. Enter custom query")

    while True:
        try:
            choice = input(f"\nEnter your choice (1-{len(SAMPLE_QUERIES) + 1}): ").strip()
            choice_num = int(choice)

            if 1 <= choice_num <= len(SAMPLE_QUERIES):
                selected = SAMPLE_QUERIES[choice_num - 1]
                print(f"\n✅ Selected: {selected}")
                return selected
            elif choice_num == len(SAMPLE_QUERIES) + 1:
                custom_query = input("\nEnter your custom query: ").strip()
                if custom_query:
                    print(f"\n✅ Custom query: {custom_query}")
                    return custom_query
                else:
                    print("❌ Query cannot be empty. Please try again.")
            else:
                print(f"❌ Invalid choice. Please enter a number between 1 and {len(SAMPLE_QUERIES) + 1}.")
        except ValueError:
            print("❌ Invalid input. Please enter a number.")
        except KeyboardInterrupt:
            print("\n\n❌ Cancelled by user.")
            sys.exit(1)


def _extract_text_from_result(result: Any) -> str:
    """Extract text content from FastMCP tool result.
    
    Args:
        result: FastMCP tool result object
        
    Returns:
        Extracted text as string
    """
    if hasattr(result, 'content') and result.content:
        # Content is a list of content blocks
        result_text = ""
        for block in result.content:
            if hasattr(block, 'text'):
                result_text += block.text
            elif isinstance(block, dict) and 'text' in block:
                result_text += block['text']
            else:
                result_text += str(block)
        return result_text
    return str(result)


def _parse_tool_result(result_text: str) -> Dict[str, Any]:
    """Parse tool result text into a dictionary.
    
    Args:
        result_text: Raw text result from tool
        
    Returns:
        Parsed result as dictionary
    """
    # The chat tool returns JSON string
    try:
        return json.loads(result_text)
    except json.JSONDecodeError:
        return {"raw_text": result_text}


def call_mcp_tool(
    mcp_url: str,
    tool_name: str,
    arguments: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Call an MCP tool via FastMCP Client.

    Args:
        mcp_url: Base URL of MCP server (e.g., http://localhost:8085)
        tool_name: Name of the tool to call
        arguments: Tool arguments as dictionary

    Returns:
        Tool response as dictionary
    """
    print(f"\n{'='*80}")
    print(f"Calling tool: {tool_name}")
    print(f"Arguments: {json.dumps(arguments, indent=2)}")
    print(f"{'='*80}\n")

    try:
        # Use FastMCP Client for proper session handling
        client = _get_fastmcp_client(mcp_url)
        
        async def _call_tool():
            async with client:
                result = await client.call_tool(tool_name, arguments)
                return result
        
        result = asyncio.run(_call_tool())
        result_text = _extract_text_from_result(result)
        return _parse_tool_result(result_text)

    except ImportError as e:
        error_msg = str(e)
        print(f"❌ Import Error: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        print(f"❌ Error calling tool: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def test_health_check(mcp_url: str) -> bool:
    """Test MCP server health endpoint."""
    print("\n" + "="*80)
    print("Testing MCP Server Health")
    print("="*80)

    try:
        response = requests.get(f"{mcp_url}/health", timeout=5)
        response.raise_for_status()
        health = response.json()

        print(f"✅ Server Status: {health.get('status')}")
        print(f"   Service: {health.get('service')}")
        print(f"   Transport: {health.get('transport_protocol')}")
        print(f"   MCP Endpoint: {health.get('mcp_endpoint')}")

        return health.get('status') == 'healthy'

    except Exception as e:
        print(f"❌ Health check failed: {e}")
        return False


def check_fastmcp_available() -> bool:
    """Check if fastmcp is available and can be imported."""
    try:
        importlib.import_module("fastmcp")
        return True
    except ImportError:
        return False


def _ensure_site_packages_in_path() -> None:
    """Ensure site-packages directories are in sys.path to find fastmcp."""
    try:
        site_paths: List[str] = []
        try:
            site_paths.extend(site.getsitepackages())  # type: ignore[attr-defined]
        except Exception:
            pass
        try:
            user_site = site.getusersitepackages()
            if isinstance(user_site, str):
                site_paths.append(user_site)
        except Exception:
            pass
        for p in reversed([p for p in site_paths if p and p not in sys.path]):
            sys.path.insert(0, p)
    except Exception:
        pass


def _get_fastmcp_client(mcp_url: str):
    """Get FastMCP Client instance for the given URL.
    
    Args:
        mcp_url: Base URL of MCP server
        
    Returns:
        FastMCP Client instance
        
    Raises:
        ImportError: If fastmcp cannot be imported
    """
    _ensure_site_packages_in_path()
    
    if not check_fastmcp_available():
        raise ImportError(
            "fastmcp is not available. Please install it with: "
            "pip install fastmcp>=2.11 or uv pip install fastmcp>=2.11"
        )
    
    fastmcp_module = importlib.import_module("fastmcp")
    Client = fastmcp_module.Client

    config = {
        "mcpServers": {"obs_mcp_server": {"url": f"{mcp_url}/mcp"}}
    }
    return Client(config)


def test_list_tools(mcp_url: str) -> bool:
    """List available MCP tools and verify 'chat' is present."""
    print("\n" + "="*80)
    print("Listing Available MCP Tools")
    print("="*80)

    try:
        # Use FastMCP Client for proper session handling
        client = _get_fastmcp_client(mcp_url)
        
        async def _list_tools():
            async with client:
                tools = await client.list_tools()
                return tools
        
        tools = asyncio.run(_list_tools())
        
        tool_names = [tool.name for tool in tools]
        
        print(f"Found {len(tools)} tools:")
        for tool in tools:
            print(f"  • {tool.name}")

        if 'chat' in tool_names:
            return True
        else:
            print("\n❌ 'chat' tool NOT found in available tools")
            return False

    except Exception as e:
        print(f"❌ Error listing tools: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_chat_with_model(
    mcp_url: str,
    model_key: str,
    namespace: Optional[str] = None
) -> bool:
    """Invoke chat tool with a specific model.
    
    Args:
        mcp_url: Base URL of MCP server
        model_key: Key from MODEL_CONFIGS dictionary
        namespace: Optional Kubernetes namespace
        
    Returns:
        True if chat succeeded, False otherwise
    """
    if model_key not in MODEL_CONFIGS:
        print(f"❌ Unknown model key: {model_key}")
        return False
    
    config = MODEL_CONFIGS[model_key]
    display_name = config["display_name"]
    
    print("\n" + "="*80)
    print(f"Chat with {display_name}")
    print("="*80)

    # Get API key if required
    api_key: Optional[str] = None
    if config.get("requires_api_key", False):
        try:
            api_key = get_api_key(config["api_key_provider"])
        except (KeyboardInterrupt, SystemExit):
            print("\n⚠️  Cancelled by user.")
            return False

    # First, get available models (only for llama to show available options)
    if model_key == "llama":
        print("\nFetching available models...")
        models_result = call_mcp_tool(mcp_url, "list_summarization_models", {})
        print(f"Available models: {models_result}")

    # Interactive query selection
    try:
        query = select_query()
    except (KeyboardInterrupt, SystemExit):
        print("\n⚠️  Cancelled by user.")
        return False

    # Build arguments
    args: Dict[str, Any] = {
        "model_name": config["model_name"],
        "message": query
    }
    
    if api_key:
        args["api_key"] = api_key
    
    if namespace:
        args["namespace"] = namespace

    result = call_mcp_tool(mcp_url, "chat", args)
    
    if "error" in result:
        print_chat_result(result)
        return False
    
    print_chat_result(result)
    return True




def print_chat_result(result: Dict[str, Any]):
    """Pretty print chat tool result."""
    if "error" in result:
        print(f"\n❌ Error: {result['error']}")
        if "progress_log" in result:
            print("\nProgress Log:")
            for entry in result["progress_log"]:
                print(f"  [{entry['timestamp']}] {entry['message']}")
        return

    print(f"\n✅ Chat Response:")
    print(f"   Model: {result.get('model', 'Unknown')}")
    print(f"   Iterations: {result.get('iterations', 0)}")
    print(f"   Timestamp: {result.get('timestamp', 'Unknown')}")

    print("\n📝 Response:")
    print("-" * 80)
    print(result.get("response", "No response"))
    print("-" * 80)

    if "progress_log" in result and result["progress_log"]:
        print(f"\n📊 Progress Log ({len(result['progress_log'])} entries):")
        for i, entry in enumerate(result["progress_log"], 1):
            print(f"  {i}. [{entry['timestamp']}] {entry['message']}")


def main():
    # Custom formatter to show each option on a separate line in usage only
    class CustomFormatter(argparse.HelpFormatter):
        def __init__(self, prog):
            super().__init__(prog, max_help_position=30, width=100)

        def _format_usage(self, usage, actions, groups, prefix):
            if prefix is None:
                prefix = 'usage: '

            # Get the program name
            prog = '%(prog)s' % dict(prog=self._prog)

            # Build usage string with each option on a new line
            optionals = []
            positionals = []

            for action in actions:
                if action.option_strings:
                    optionals.append(self._format_actions_usage([action], groups))
                elif action.metavar != argparse.SUPPRESS:
                    positionals.append(self._format_actions_usage([action], groups))

            # Format with newlines
            usage_parts = [prefix + prog]
            for opt in optionals:
                usage_parts.append(' ' * len(prefix) + opt.strip())
            for pos in positionals:
                usage_parts.append(' ' * len(prefix) + pos.strip())

            return '\n'.join(usage_parts) + '\n\n'

    parser = argparse.ArgumentParser(
        description="CLI example for invoking chatbots via the MCP chat tool",
        formatter_class=CustomFormatter
    )
    parser.add_argument(
        "--mcp-url",
        default="http://localhost:8085",
        help="MCP server URL (default: http://localhost:8085)"
    )
    parser.add_argument(
        "--namespace",
        help="Kubernetes namespace for scoped queries"
    )
    parser.add_argument(
        "--model",
        choices=["llama", "anthropic", "openai", "gemini"],
        default="llama",
        help="Model to use for chat (default: llama)"
    )
    parser.add_argument(
        "--list-tools",
        action="store_true",
        help="List all available MCP tools and exit"
    )

    args = parser.parse_args()

    print("\n" + "="*80)
    print("MCP Chat Tool")
    print("="*80)
    print(f"MCP Server: {args.mcp_url}")
    if args.namespace:
        print(f"Namespace: {args.namespace}")
    print("="*80)

    # Check for fastmcp dependency
    if not check_fastmcp_available():
        print("\n❌ fastmcp is not available. Please install it:")
        print("   pip install fastmcp>=2.11")
        print("   or")
        print("   uv pip install fastmcp>=2.11")
        sys.exit(1)

    # Always run health check
    if not test_health_check(args.mcp_url):
        print("\n❌ Server health check failed. Exiting.")
        sys.exit(1)

    # List tools if requested
    if args.list_tools:
        chat_tool_found = test_list_tools(args.mcp_url)
        if not chat_tool_found:
            print("\n⚠️  Chat tool not found in tools list.")
        sys.exit(0 if chat_tool_found else 1)

    # Invoke chat with selected model
    try:
        model_key = args.model
        success = test_chat_with_model(args.mcp_url, model_key, args.namespace)
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n❌ Cancelled by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
