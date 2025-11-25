# Chatbots Architecture & Usage Guide

## Overview

The chatbots module provides a unified interface for interacting with AI models (both local and cloud-based) to enable natural language queries across the observability platform. Chatbots power the **"Chat with Prometheus"** feature in the UI and can be used via the `chat` MCP tool for external clients.

Chatbots execute MCP (Model Context Protocol) tools to gather data from multiple observability sources:
- **Prometheus metrics** - Query metrics using PromQL
- **Tempo traces** - Analyze distributed traces
- **OpenShift metrics** - Kubernetes cluster and pod metrics
- **vLLM metrics** - AI/ML model serving metrics
- **Korrel8r** - Correlated observability data (alerts, logs, traces, metrics)

The chatbots then use AI models to provide natural language responses with contextual analysis, making observability data accessible through conversational queries.

## Quick Start

### Using Chatbots in UI

```python
from chatbots import create_chatbot
from ui.mcp_client_adapter import MCPClientAdapter
from ui.mcp_client_helper import MCPClientHelper

# Create MCP client and adapter
mcp_client = MCPClientHelper()
tool_executor = MCPClientAdapter(mcp_client)

# Create chatbot (tool_executor is REQUIRED)
chatbot = create_chatbot(
    model_name="anthropic/claude-3-5-haiku-20241022",
    api_key=user_api_key,
    tool_executor=tool_executor
)

# Use chatbot
response = chatbot.chat(
    user_question="What's the CPU usage?",
    namespace=None,  # Cluster-wide
    progress_callback=update_progress
)
```

### Using Chatbots in MCP Server (via `chat` tool)

```python
from chatbots import create_chatbot
from mcp_server.mcp_tools_adapter import MCPServerAdapter

# Get server instance and create adapter
from mcp_server.observability_mcp import _server_instance
tool_executor = MCPServerAdapter(_server_instance)

# Create chatbot
chatbot = create_chatbot(
    model_name="openai/gpt-4o-mini",
    api_key=api_key,
    tool_executor=tool_executor
)

# Execute chat
response = chatbot.chat(
    user_question="Show me firing alerts",
    namespace="production"
)
```

## Architecture

The chatbots system uses a **ToolExecutor interface** with **adapter pattern** implementations to decouple chatbot implementations from the execution context. This allows chatbots to work seamlessly whether they're running in the UI process or the MCP server process.

- **ToolExecutor**: Abstract interface that defines how tools are executed (dependency inversion principle)
- **Adapter Pattern**: Implementation approach where `MCPServerAdapter` and `MCPClientAdapter` adapt different contexts to the `ToolExecutor` interface

### Key Components

```
                    ┌─────────────────────────────────────┐
                    │      Chatbots Package               │
                    │  ┌───────────┐  ┌──────────┐        │
                    │  │BaseChatBot│  │Anthropic │        │
                    │  │(Abstract) │  │  Bot     │        │
                    │  └──────┬────┘  └─────┬────┘        │
                    │         │             │             │
                    │         └──────┬──────┘             │
                    │                │                    │
                    │          ┌─────▼──────┐             │
                    │          │ToolExecutor│             │
                    │          │(Interface) │             │
                    │          └─────┬──────┘             │
                    └────────────────┼────────────────────┘
                                     │
                      ┌──────────────┴──────────────┐
                      │                             │
          ┌───────────▼──────────┐       ┌──────────▼──────────┐
          │  MCPServerAdapter    │       │  MCPClientAdapter   │
          │   (MCP Server)       │       │    (UI Process)     │
          └───────────┬──────────┘       └──────────┬──────────┘
                      │                             │
                      │                             │
          ┌───────────▼──────────┐       ┌──────────▼──────────┐
          │  Observability       │       │  MCPClientHelper    │
          │  MCPServer           │       │  (FastMCP Client)   │
          └──────────────────────┘       └─────────────────────┘
```

## Usage Patterns

### 1. Usage from UI

The UI creates chatbots directly and uses them to answer user questions about observability data.

#### Flow Diagram

![Chatbot UI Flow](images/chatbot-ui-flow.png)

<details>
<summary>View Mermaid source code</summary>

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Chatbot
    participant MCPClientAdapter
    participant MCPClientHelper
    participant MCPServer

    User->>UI: Ask question about metrics
    UI->>UI: Create MCPClientHelper
    UI->>UI: Create MCPClientAdapter(MCPClientHelper)
    UI->>Chatbot: create_chatbot(model, api_key, MCPClientAdapter)
    User->>UI: Submit question
    UI->>Chatbot: chatbot.chat(question)

    loop Tool Execution Loop
        Chatbot->>Chatbot: Decide to use tool
        Chatbot->>MCPClientAdapter: call_tool(tool_name, args)
        MCPClientAdapter->>MCPClientHelper: call_tool_sync(tool_name, args)
        MCPClientHelper->>MCPServer: HTTP POST /mcp (JSON-RPC)
        MCPServer->>MCPServer: Execute tool
        MCPServer-->>MCPClientHelper: Tool result
        MCPClientHelper-->>MCPClientAdapter: Result
        MCPClientAdapter-->>Chatbot: Tool result string
        Chatbot->>Chatbot: Process result, continue conversation
    end

    Chatbot-->>UI: Final response
    UI-->>User: Display response
```

</details>

**ASCII Sequence Diagram** (text fallback):

```
User → UI: Ask question about metrics
UI → UI: Create MCPClientHelper
UI → UI: Create MCPClientAdapter(MCPClientHelper)
UI → Chatbot: create_chatbot(model, api_key, MCPClientAdapter)
User → UI: Submit question
UI → Chatbot: chatbot.chat(question)

[Tool Execution Loop - repeats as needed]
  Chatbot → Chatbot: Decide to use tool
  Chatbot → MCPClientAdapter: call_tool(tool_name, args)
  MCPClientAdapter → MCPClientHelper: call_tool_sync(tool_name, args)
  MCPClientHelper → MCPServer: HTTP POST /mcp (JSON-RPC)
  MCPServer → MCPServer: Execute tool
  MCPServer → MCPClientHelper: Tool result
  MCPClientHelper → MCPClientAdapter: Result
  MCPClientAdapter → Chatbot: Tool result string
  Chatbot → Chatbot: Process result, continue conversation

Chatbot → UI: Final response
UI → User: Display response
```

#### Code Example

```python
# In UI (ui/ui.py)
from chatbots import create_chatbot
from ui.mcp_client_helper import MCPClientHelper
from ui.mcp_client_adapter import MCPClientAdapter

# Initialize MCP client and adapter
mcp_client = MCPClientHelper()
tool_executor = MCPClientAdapter(mcp_client)

# Create chatbot with user's API key
chatbot = create_chatbot(
    model_name="anthropic/claude-3-5-haiku-20241022",
    api_key=user_api_key,
    tool_executor=tool_executor  # REQUIRED parameter
)

# Use chatbot to answer questions
response = chatbot.chat(
    user_question="What's the CPU usage?",
    namespace=None,  # Cluster-wide
    progress_callback=update_progress
)
```

#### Key Points

- **Location**: Chatbots run in the UI process (Streamlit)
- **Tool Execution**: Tools are executed via MCP protocol (HTTP/JSON-RPC)
- **Adapter**: `MCPClientAdapter` wraps `MCPClientHelper` to provide `ToolExecutor` interface
- **Benefits**: UI can use chatbots without importing MCP server code

### 2. Usage from `chat` MCP Tool

The `chat` MCP tool allows external clients to use chatbots through the MCP protocol. This is useful for CLI tools, other services, or any MCP-compatible client.

#### Flow Diagram

![Chatbot MCP Tool Flow](images/chatbot-mcp-tool-flow.png)

<details>
<summary>View Mermaid source code</summary>

```mermaid
sequenceDiagram
    participant Client
    participant MCPServer
    participant ChatTool
    participant Chatbot
    participant MCPServerAdapter
    participant MCPServerTools

    Client->>MCPServer: Call "chat" tool via MCP
    MCPServer->>ChatTool: chat(model, message, api_key)
    ChatTool->>ChatTool: Create MCPServerAdapter(server_instance)
    ChatTool->>Chatbot: create_chatbot(model, api_key, MCPServerAdapter)

    loop Tool Execution Loop
        Chatbot->>Chatbot: Decide to use tool
        Chatbot->>MCPServerAdapter: call_tool(tool_name, args)
        MCPServerAdapter->>MCPServerTools: Direct function call (no HTTP)
        MCPServerTools->>MCPServerTools: Execute tool
        MCPServerTools-->>MCPServerAdapter: Tool result
        MCPServerAdapter-->>Chatbot: Tool result string
        Chatbot->>Chatbot: Process result, continue conversation
    end

    Chatbot-->>ChatTool: Final response
    ChatTool->>ChatTool: Package response with progress_log
    ChatTool-->>MCPServer: JSON response
    MCPServer-->>Client: MCP tool result
```

</details>

**ASCII Sequence Diagram** (text fallback):

```
Client → MCPServer: Call "chat" tool via MCP
MCPServer → ChatTool: chat(model, message, api_key)
ChatTool → ChatTool: Create MCPServerAdapter(server_instance)
ChatTool → Chatbot: create_chatbot(model, api_key, MCPServerAdapter)

[Tool Execution Loop - repeats as needed]
  Chatbot → Chatbot: Decide to use tool
  Chatbot → MCPServerAdapter: call_tool(tool_name, args)
  MCPServerAdapter → MCPServerTools: Direct function call (no HTTP)
  MCPServerTools → MCPServerTools: Execute tool
  MCPServerTools → MCPServerAdapter: Tool result
  MCPServerAdapter → Chatbot: Tool result string
  Chatbot → Chatbot: Process result, continue conversation

Chatbot → ChatTool: Final response
ChatTool → ChatTool: Package response with progress_log
ChatTool → MCPServer: JSON response
MCPServer → Client: MCP tool result
```

#### Code Example

```python
# In MCP Server (mcp_server/tools/chat_tool.py)
from chatbots import create_chatbot
from mcp_server.mcp_tools_adapter import MCPServerAdapter

def chat(
    model_name: str,
    message: str,
    api_key: Optional[str] = None,
    namespace: Optional[str] = None,
    scope: Optional[str] = None
) -> str:
    # Get server instance
    from mcp_server.observability_mcp import _server_instance

    # Create adapter for direct tool access
    tool_executor = MCPServerAdapter(_server_instance)

    # Create chatbot
    chatbot = create_chatbot(
        model_name=model_name,
        api_key=api_key,
        tool_executor=tool_executor
    )

    # Execute chat with progress tracking
    progress_log = []
    def capture_progress(msg):
        progress_log.append({"timestamp": datetime.now().isoformat(), "message": msg})

    response = chatbot.chat(
        user_question=message,
        namespace=namespace,
        progress_callback=capture_progress
    )

    # Return structured response
    return json.dumps({
        "response": response,
        "progress_log": progress_log,
        "model": model_name,
        "timestamp": datetime.now().isoformat()
    })
```

#### Key Points

- **Location**: Chatbots run in the MCP server process
- **Tool Execution**: Tools are executed directly (no HTTP overhead)
- **Adapter**: `MCPServerAdapter` wraps the server instance for direct tool access
- **Benefits**: Lower latency, no network overhead, progress tracking included

## What This Branch Fixed: Circular Dependency Resolution

### The Problem in Dev Branch

Previously, there was a **circular dependency** between components that made the architecture fragile and tightly coupled.

#### Dev Branch Architecture (❌ Problematic)

**Location**: Chatbots lived in `src/mcp_server/chatbots/`

**Import Chain**:
```
UI (ui/ui.py)
  ↓ imports
mcp_server.chatbots (chatbots in mcp_server package!)
  ↓ imports & instantiates
ObservabilityMCPServer (mcp_server/observability_mcp.py)
```

**The circular dependency chain:**
1. `ui/ui.py` imports `chatbots` from `mcp_server.chatbots` package
2. `chatbots/base.py` directly instantiates `ObservabilityMCPServer()`
3. UI needs MCP client to call server, but chatbots are in server package

**Code in dev branch:**
```python
# src/mcp_server/chatbots/base.py (dev)
from mcp_server.observability_mcp import ObservabilityMCPServer

class BaseChatBot(ABC):
    def __init__(self, model_name: str, api_key: Optional[str] = None):
        self.model_name = model_name
        self.api_key = api_key if api_key is not None else self._get_api_key()

        # ❌ CIRCULAR DEPENDENCY: Chatbots directly create MCP server
        self.mcp_server = ObservabilityMCPServer()
```

**UI usage in dev:**
```python
# src/ui/ui.py (dev)
# UI imports chatbots FROM mcp_server package
from mcp_server.chatbots import create_chatbot

# No adapter needed - chatbot handles everything internally
chatbot = create_chatbot(model_name, api_key)
response = chatbot.chat(question)
```

**Problems:**
- ❌ Chatbots located in `mcp_server` package (tight coupling to server)
- ❌ Chatbots directly instantiate `ObservabilityMCPServer` (no flexibility)
- ❌ UI must import from `mcp_server.chatbots` (violates separation of concerns)
- ❌ Cannot use chatbots without MCP server code
- ❌ Difficult to test (can't mock tool execution)
- ❌ Chatbots can't use MCP client (hardcoded to server instantiation)

#### Circular Dependency Diagram (Before)

![Circular Dependency - Before](images/circular-dependency-before.png)

<details>
<summary>View Mermaid source code</summary>

```mermaid
graph LR
    A[UI] -->|imports| B[mcp_server.chatbots]
    B -->|instantiates| C[ObservabilityMCPServer]
    C -->|part of| D[mcp_server package]
    A -->|imports from| D
    style A fill:#ff6b6b
    style B fill:#ff6b6b
    style C fill:#ff6b6b
    style D fill:#ff6b6b
```

</details>

### The Solution in Current Branch

The fix introduces a **ToolExecutor interface** with **adapter pattern** implementations and **dependency injection**.

#### Current Branch Architecture (✅ Fixed)

**Location**: Chatbots live in standalone `src/chatbots/` package

**Import Chain** (UI):
```
UI (ui/ui.py)
  ↓ imports
chatbots (standalone package)
  ↓ uses (via dependency injection)
ToolExecutor (interface)
  ↑ implemented by
MCPClientAdapter (ui/mcp_client_adapter.py)
  ↓ uses
MCPClientHelper (ui/mcp_client_helper.py)
```

**Import Chain** (MCP Server):
```
MCP Server (mcp_server/tools/chat_tool.py)
  ↓ imports
chatbots (standalone package)
  ↓ uses (via dependency injection)
ToolExecutor (interface)
  ↑ implemented by
MCPServerAdapter (mcp_server/mcp_tools_adapter.py)
  ↓ wraps
ObservabilityMCPServer instance
```

**Code in current branch:**
```python
# src/chatbots/base.py (current)
from chatbots.tool_executor import ToolExecutor

class BaseChatBot(ABC):
    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        tool_executor: ToolExecutor = None  # ✅ REQUIRED parameter
    ):
        if tool_executor is None:
            raise ValueError(
                "tool_executor is required. Pass a ToolExecutor implementation"
            )

        self.model_name = model_name
        self.api_key = api_key if api_key is not None else self._get_api_key()

        # ✅ NO DIRECT DEPENDENCY: Uses injected interface
        self.tool_executor = tool_executor
```

**UI usage in current branch:**
```python
# src/ui/ui.py (current)
# UI imports from standalone chatbots package
from chatbots import create_chatbot
from ui.mcp_client_adapter import MCPClientAdapter
from ui.mcp_client_helper import MCPClientHelper

# Create adapter for MCP client (dependency injection)
mcp_client = MCPClientHelper()
tool_executor = MCPClientAdapter(mcp_client)

# Create chatbot with injected tool executor
chatbot = create_chatbot(
    model_name=model_name,
    api_key=api_key,
    tool_executor=tool_executor  # ✅ Injected dependency
)
response = chatbot.chat(question)
```

**Benefits:**
- ✅ Chatbots in standalone package (no coupling to mcp_server)
- ✅ Dependency injection via `ToolExecutor` interface
- ✅ UI imports from `chatbots` (clean separation)
- ✅ Can use chatbots anywhere (UI, MCP server, tests)
- ✅ Easy to test (mock `ToolExecutor`)
- ✅ No circular dependencies
- ✅ Follows SOLID principles (Dependency Inversion)

#### Clean Architecture Diagram (After)

![Circular Dependency - After](images/circular-dependency-after.png)

<details>
<summary>View Mermaid source code</summary>

```mermaid
graph LR
    A[UI] -->|creates| B[MCPClientAdapter]
    A -->|creates| C[Chatbot]
    B -->|uses| D[MCPClientHelper]
    C -->|uses| B
    E[MCP Server] -->|creates| F[MCPServerAdapter]
    E -->|creates| G[Chatbot]
    F -->|wraps| H[ObservabilityMCPServer]
    G -->|uses| F
    style A fill:#51cf66
    style B fill:#51cf66
    style C fill:#51cf66
    style D fill:#51cf66
    style E fill:#51cf66
    style F fill:#51cf66
    style G fill:#51cf66
    style H fill:#51cf66
```

</details>

### Key Changes

1. **Introduced `ToolExecutor` Interface** (Dependency Inversion Pattern)
   - Abstract interface in `chatbots/tool_executor.py`
   - Chatbots depend on interface, not concrete implementations
   - Defines contract: `call_tool()`, `list_tools()`, `get_tool()`

2. **Created Adapter Implementations** (Adapter Pattern)
   - `MCPClientAdapter` (in `ui/mcp_client_adapter.py`) - adapts `MCPClientHelper` to `ToolExecutor` interface for UI context
   - `MCPServerAdapter` (in `mcp_server/mcp_tools_adapter.py`) - adapts `ObservabilityMCPServer` to `ToolExecutor` interface for MCP server context
   - Both implement the `ToolExecutor` interface but use different underlying mechanisms

3. **Dependency Injection**
   - Chatbots receive `ToolExecutor` via constructor (dependency injection)
   - No direct imports of MCP server or client in chatbots
   - Chatbots only depend on the `ToolExecutor` abstraction

4. **Moved Utilities to Common**
   - `extract_text_from_mcp_result` moved to `common/mcp_utils.py`
   - Breaks circular dependency on UI-specific code
   - Shared utilities accessible from both UI and server contexts

5. **Relocated Chatbots Package**
   - Moved from `src/mcp_server/chatbots/` to `src/chatbots/`
   - Now a standalone package independent of MCP server

### Architecture Comparison

#### Before (Problematic)

```
ui/ui.py
  ├── imports mcp_server.chatbots  ❌ UI imports from server package
  └── mcp_server/chatbots/base.py
        └── instantiates ObservabilityMCPServer()  ❌ Hardcoded dependency
```

#### After (Fixed)

```
ui/ui.py
  ├── imports chatbots  ✅ Standalone package
  ├── imports mcp_client_adapter  ✅ UI-specific adapter
  └── creates: MCPClientAdapter(MCPClientHelper())  ✅ Dependency injection

mcp_server/tools/chat_tool.py
  ├── imports chatbots  ✅ Same standalone package
  ├── imports mcp_tools_adapter  ✅ Server-specific adapter
  └── creates: MCPServerAdapter(server_instance)  ✅ Dependency injection

chatbots/base.py
  └── uses ToolExecutor interface  ✅ No concrete imports!
```

### Migration Guide

**What Changed**:
1. Chatbots moved from `src/mcp_server/chatbots/` → `src/chatbots/`
2. Added `tool_executor` **REQUIRED** parameter to factory and constructors
3. Created `ToolExecutor` interface in `chatbots/tool_executor.py`
4. Created adapters:
   - `MCPClientAdapter` in `ui/mcp_client_adapter.py` (for UI)
   - `MCPServerAdapter` in `mcp_server/mcp_tools_adapter.py` (for MCP server)
5. Moved shared utilities to `common/mcp_utils.py`

**Update Your Code**:

OLD (dev):
```python
from mcp_server.chatbots import create_chatbot

chatbot = create_chatbot(model, api_key)
response = chatbot.chat(question)
```

NEW (current):
```python
from chatbots import create_chatbot
from ui.mcp_client_adapter import MCPClientAdapter
from ui.mcp_client_helper import MCPClientHelper

# Create adapter
mcp_client = MCPClientHelper()
tool_executor = MCPClientAdapter(mcp_client)

# Create chatbot with tool_executor (REQUIRED)
chatbot = create_chatbot(model, api_key, tool_executor=tool_executor)
response = chatbot.chat(question)
```

## Supported Models

The chatbot factory (`chatbots/factory.py`) supports multiple AI providers:

### External Providers
- **Anthropic**: Claude models (e.g., `anthropic/claude-3-5-sonnet-20241022`)
- **OpenAI**: GPT models (e.g., `openai/gpt-4o-mini`)
- **Google**: Gemini models (e.g., `google/gemini-2.0-flash`)

### Local Models
- **Llama 3.1/3.3**: Uses `LlamaChatBot` (tool calling capable)
- **Llama 3.2**: Uses `DeterministicChatBot` (deterministic parsing)
- **Unknown Models**: Falls back to `DeterministicChatBot`

## Tool Execution

Chatbots can execute any MCP tool available on the server. Common tools include:

- `search_metrics`: Pattern-based metric search
- `execute_promql`: Execute PromQL queries
- `get_metric_metadata`: Get metric details
- `get_label_values`: Get available label values
- `suggest_queries`: Get PromQL suggestions
- `explain_results`: Human-readable explanations
- `korrel8r_query_objects`: Query observability objects
- `korrel8r_get_correlated`: Get correlated data

## Best Practices

1. **Always Provide Tool Executor**: Chatbots require a `ToolExecutor` instance
   ```python
   # ✅ Good
   chatbot = create_chatbot(model, api_key, tool_executor=adapter)

   # ❌ Bad - will raise ValueError
   chatbot = create_chatbot(model, api_key)  # Missing tool_executor
   ```

2. **Use Appropriate Adapter**: Choose the right adapter for your context
   - UI process → `MCPClientAdapter`
   - MCP server process → `MCPServerAdapter`

3. **Handle Progress Callbacks**: Use progress callbacks for better UX
   ```python
   def update_progress(msg):
       logger.info(f"Progress: {msg}")

   response = chatbot.chat(question, progress_callback=update_progress)
   ```

4. **Namespace Filtering**: Use namespace parameter for scoped queries
   ```python
   response = chatbot.chat(
       "What pods are running?",
       namespace="production"  # Only query production namespace
   )
   ```

## Troubleshooting

### Import Errors

**Error**: `ImportError: cannot import name 'create_chatbot' from 'mcp_server.chatbots'`

**Solution**: Update imports - chatbots moved to standalone package:
```python
# OLD (dev)
from mcp_server.chatbots import create_chatbot

# NEW (current)
from chatbots import create_chatbot
```

### Tool Executor Missing

**Error**: `ValueError: tool_executor is required`

**Solution**: Always pass a `ToolExecutor` implementation:
```python
# In UI
from ui.mcp_client_adapter import MCPClientAdapter
from ui.mcp_client_helper import MCPClientHelper

mcp_client = MCPClientHelper()
tool_executor = MCPClientAdapter(mcp_client)
chatbot = create_chatbot(model, api_key, tool_executor=tool_executor)

# In MCP Server
from mcp_server.mcp_tools_adapter import MCPServerAdapter
from mcp_server.observability_mcp import _server_instance

tool_executor = MCPServerAdapter(_server_instance)
chatbot = create_chatbot(model, api_key, tool_executor=tool_executor)
```

### Tool Execution Failures

- Verify MCP server is running (for UI usage)
- Check that `ToolExecutor` is properly initialized
- Review logs for specific tool errors
- Ensure MCP server URL is correct (default: `http://localhost:8085`)

### Model Selection

- Use `create_chatbot()` factory function
- Provide correct model name format (e.g., `anthropic/claude-3-5-haiku-20241022`)
- Ensure API keys are provided for external models

## Related Documentation

- [MCP Server README](../src/mcp_server/README.md) - MCP server setup and configuration
- [Observability Overview](OBSERVABILITY_OVERVIEW.md) - Overall system architecture
- [Developer Guide](DEV_GUIDE.md) - Development setup and workflows

## Diagram Source Files

The diagrams in this document are generated from Mermaid source files in `diagrams/`:
- `diagrams/chatbot-ui-flow.mmd` - UI usage flow
- `diagrams/chatbot-mcp-tool-flow.mmd` - MCP tool usage flow
- `diagrams/circular-dependency-before.mmd` - Circular dependency problem
- `diagrams/circular-dependency-after.mmd` - Clean architecture solution

To regenerate images after modifying source files:

```bash
cd docs

# Regenerate flow diagrams
npx @mermaid-js/mermaid-cli@latest -i diagrams/chatbot-ui-flow.mmd -o images/chatbot-ui-flow.png -w 1200 -H 800
npx @mermaid-js/mermaid-cli@latest -i diagrams/chatbot-mcp-tool-flow.mmd -o images/chatbot-mcp-tool-flow.png -w 1200 -H 800

# Regenerate circular dependency diagrams
npx @mermaid-js/mermaid-cli@latest -i diagrams/circular-dependency-before.mmd -o images/circular-dependency-before.png -w 800 -H 400
npx @mermaid-js/mermaid-cli@latest -i diagrams/circular-dependency-after.mmd -o images/circular-dependency-after.png -w 800 -H 400
```

Or regenerate all at once:
```bash
cd docs

# Regenerate all chatbot flow diagrams
for file in diagrams/chatbot-*.mmd; do
  name=$(basename "$file" .mmd)
  npx @mermaid-js/mermaid-cli@latest -i "$file" -o "images/${name}.png" -w 1200 -H 800
done

# Regenerate all circular dependency diagrams
for file in diagrams/circular-*.mmd; do
  name=$(basename "$file" .mmd)
  npx @mermaid-js/mermaid-cli@latest -i "$file" -o "images/${name}.png" -w 800 -H 400
done
```
