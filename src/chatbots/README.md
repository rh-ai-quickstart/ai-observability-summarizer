# Chatbots Package

Multi-provider AI chatbot implementations with observability tool integration.

## Quick Start

```python
from chatbots import create_chatbot
from ui.mcp_client_adapter import MCPClientAdapter
from ui.mcp_client_helper import MCPClientHelper

# Create MCP client adapter (for UI usage)
mcp_client = MCPClientHelper()
tool_executor = MCPClientAdapter(mcp_client)

# Create chatbot (tool_executor is REQUIRED)
chatbot = create_chatbot(
    model_name="anthropic/claude-3-5-sonnet-20241022",
    api_key="your-api-key",
    tool_executor=tool_executor
)

# Chat with the bot
response = chatbot.chat("What's the CPU usage?")
print(response)
```

## Available Implementations

- **AnthropicChatBot** - Anthropic Claude models (claude-3-5-sonnet, claude-3-5-haiku, etc.)
- **OpenAIChatBot** - OpenAI GPT models (gpt-4o, gpt-4o-mini, o1-mini, etc.)
- **GoogleChatBot** - Google Gemini models (gemini-2.0-flash, etc.)
- **LlamaChatBot** - Local Llama models (3.1/3.3 with tool calling support)
- **DeterministicChatBot** - Fallback for smaller models (Llama 3.2, unknown models)

## Factory Function

The `create_chatbot()` factory automatically selects the right implementation:

```python
from chatbots import create_chatbot

# External models (requires API key)
chatbot = create_chatbot(
    model_name="anthropic/claude-3-5-haiku-20241022",
    api_key="sk-ant-...",
    tool_executor=tool_executor
)

# Local models (no API key needed)
chatbot = create_chatbot(
    model_name="meta-llama/Llama-3.3-70B-Instruct",
    tool_executor=tool_executor
)
```

## Tool Executor (Required)

Chatbots use the **ToolExecutor** interface to execute observability tools. You must provide an implementation:

### In UI Process

```python
from ui.mcp_client_adapter import MCPClientAdapter
from ui.mcp_client_helper import MCPClientHelper

mcp_client = MCPClientHelper()
tool_executor = MCPClientAdapter(mcp_client)
```

### In MCP Server Process

```python
from mcp_server.mcp_tools_adapter import MCPServerAdapter
from mcp_server.observability_mcp import _server_instance

tool_executor = MCPServerAdapter(_server_instance)
```

## Parameters

### create_chatbot()

```python
def create_chatbot(
    model_name: str,           # Model identifier (e.g., "anthropic/claude-3-5-sonnet-20241022")
    api_key: Optional[str],    # API key for external models (None for local models)
    tool_executor: ToolExecutor # REQUIRED: Tool executor implementation
) -> BaseChatBot:
```

### chat()

```python
def chat(
    user_question: str,                      # User's question
    namespace: Optional[str] = None,         # Kubernetes namespace filter (None = cluster-wide)
    progress_callback: Optional[Callable] = None  # Optional callback for progress updates
) -> str:
```

## Examples

### Usage

```python
from chatbots import create_chatbot

chatbot = create_chatbot(
    model_name="openai/gpt-4o-mini",
    api_key="sk-...",
    tool_executor=tool_executor
)

response = chatbot.chat("How many pods are running?")
```

### With Namespace Filter

```python
response = chatbot.chat(
    "What's the memory usage?",
    namespace="production"  # Only query production namespace
)
```

### With Progress Callback

```python
def show_progress(message):
    print(f"[Progress] {message}")

response = chatbot.chat(
    "Show me firing alerts",
    progress_callback=show_progress
)
```


## Model Name Patterns

### External Providers

- **Anthropic**: `anthropic/claude-3-5-sonnet-20241022`, `anthropic/claude-3-5-haiku-20241022`
- **OpenAI**: `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/o1-mini`
- **Google**: `google/gemini-2.0-flash`, `google/gemini-1.5-pro`

### Local Models

- **Llama 3.1/3.3**: `meta-llama/Llama-3.1-8B-Instruct`, `meta-llama/Llama-3.3-70B-Instruct`
- **Llama 3.2**: `meta-llama/Llama-3.2-3B-Instruct` (uses deterministic parsing)

## Architecture

```
BaseChatBot (abstract)
├── AnthropicChatBot (Claude models)
├── OpenAIChatBot (GPT models)
├── GoogleChatBot (Gemini models)
├── LlamaChatBot (Llama 3.1/3.3)
└── DeterministicChatBot (Llama 3.2, fallback)

ToolExecutor (interface)
├── MCPClientAdapter (UI process - HTTP to MCP server)
└── MCPServerAdapter (MCP server process - direct calls)
```

## Error Handling

### Missing Tool Executor

```python
# ❌ This will raise ValueError
chatbot = create_chatbot("gpt-4o-mini", api_key="sk-...")

# ✅ Always provide tool_executor
chatbot = create_chatbot("gpt-4o-mini", api_key="sk-...", tool_executor=tool_executor)
```

### Missing API Key for External Models

```python
# ❌ External models require API key
chatbot = create_chatbot("anthropic/claude-3-5-sonnet-20241022", tool_executor=tool_executor)

# ✅ Provide API key
chatbot = create_chatbot("anthropic/claude-3-5-sonnet-20241022", api_key="sk-ant-...", tool_executor=tool_executor)

# ✅ Local models don't need API key
chatbot = create_chatbot("meta-llama/Llama-3.3-70B-Instruct", tool_executor=tool_executor)
```

## Documentation

For comprehensive documentation including architecture, usage patterns, circular dependency resolution, and migration guide, see:

**[📚 docs/CHATBOTS.md](../../docs/CHATBOTS.md)** - Complete chatbots architecture and usage guide

## Package Contents

```
chatbots/
├── __init__.py              # Package exports and lazy imports
├── base.py                  # BaseChatBot abstract class
├── factory.py               # create_chatbot() factory function
├── tool_executor.py         # ToolExecutor interface and MCPTool
├── anthropic_bot.py         # Anthropic Claude implementation
├── openai_bot.py            # OpenAI GPT implementation
├── google_bot.py            # Google Gemini implementation
├── llama_bot.py             # Llama 3.1/3.3 implementation
└── deterministic_bot.py     # Deterministic fallback implementation
```

## Related Documentation

- [Comprehensive architecture guide](../../docs/CHATBOTS.md)
- [Observability MCP Server](../mcp_server/README.md)
