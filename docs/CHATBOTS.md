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

For working code examples, API reference, and usage patterns, see:

- **[src/chatbots/README.md](../src/chatbots/README.md)** - Package documentation with runnable examples
- **[src/mcp_server/README.md](../src/mcp_server/README.md)** - MCP server setup and tool usage

This document focuses on **architecture** and **design decisions**.

## Architecture

The chatbots system uses a **ToolExecutor interface** with **Adapter pattern** implementations to decouple chatbot
implementations from the execution context. This allows chatbots to work seamlessly whether they are running in the
_UI process_ or the _MCP server process_.

- **ToolExecutor**: Abstract interface that defines how tools are executed (_dependency inversion principle_)
- **Adapter Pattern**: Implementation approach where `MCPServerAdapter` and `MCPClientAdapter` adapt different contexts to the `ToolExecutor` interface

### Key Components

- `BaseChatBot` implementations (provider-specific)
- `ToolExecutor` interface
- Adapters for UI (`MCPClientAdapter`) and MCP server (`MCPServerAdapter`)

## Usage Patterns

### 1. Usage from UI

The UI creates chatbots directly and uses them to answer user questions about observability data.

#### Sequence Diagram

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


<details>
<summary>ASCII Sequence Diagram</summary>

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
  MCPServer ⤶ MCPClientHelper: Tool result
  MCPClientHelper ⤶ MCPClientAdapter: Result
  MCPClientAdapter ⤶ Chatbot: Tool result string
  Chatbot → Chatbot: Process result, continue conversation

Chatbot ⤶ UI: Final response
UI ⤶ User: Display response
```

</details>


#### Code Example

<details>
<summary>Click to expand or collapse</summary>

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
    model_name="anthropic/claude-haiku-4-5-20251001",
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

</details>

#### Key Points

- **Location**: Chatbots run in the UI process (Console Plugin or React UI)
- **Tool Execution**: Tools are executed via MCP protocol (HTTP/JSON-RPC)
- **Adapter**: `MCPClientAdapter` wraps `MCPClientHelper` to provide `ToolExecutor` interface
- **Benefits**: UI can use chatbots without importing MCP server code

### 2. Usage from `chat` MCP Tool

The `chat` MCP tool allows external clients to use chatbots through the MCP protocol. This is useful for CLI tools, other services, or any MCP-compatible client.

#### Sequence Diagram

![Chatbot MCP Tool Flow](images/chatbot-mcp-tool-flow.png)

#### Key Points

- **Location**: Chatbots run in the MCP server process
- **Tool Execution**: Tools are executed directly (no HTTP overhead)
- **Adapter**: `MCPServerAdapter` wraps the server instance for direct tool access
- **Benefits**: Lower latency, no network overhead, progress tracking included

## Architecture Evolution: Resolving Circular Dependencies

This section documents the architectural refactoring that introduced the **ToolExecutor interface** and **Adapter pattern** to eliminate circular dependencies and enable flexible chatbot usage across different execution contexts.

### Previous Architecture

The initial implementation had chatbots located within the MCP server package with direct dependencies on server components.

#### Original Design

**Location**: Chatbots lived in `src/mcp_server/chatbots/` (inside the server package)

**How the circular dependency occurred:**

1. UI imports chatbots from `mcp_server.chatbots` package
2. Chatbots need to execute MCP tools
3. Chatbots import `mcp_client_helper` from the `ui/` directory (using dynamic import with sys.path manipulation)
4. This creates: **UI → mcp_server.chatbots → ui.mcp_client_helper → UI** (circular!)

**Characteristics of this design:**

1. Chatbots located in `mcp_server` package but depend on UI code
2. Dynamic import with sys.path manipulation to access UI modules
3. Chatbots use `MCPClientHelper` from UI to call MCP server
4. Creates circular dependency: UI imports from mcp_server, mcp_server imports from UI
5. Tight coupling between server and UI packages

**Code structure:** See `src/mcp_server/chatbots/` for the original layout.

**Limitations of this approach:**

- **Circular dependency**: UI imports from `mcp_server.chatbots`, chatbots import from `ui/`
- **Dynamic sys.path manipulation**: Chatbots modify Python path at runtime to access UI modules
- Chatbots tightly coupled to both `mcp_server` and `ui` packages
- UI depends on server package, server depends on UI package
- Brittle import mechanism relying on directory structure
- Chatbots cannot work in different execution contexts
- Testing requires both MCP server and UI infrastructure
- No way to use alternative tool execution mechanisms

#### Architecture Diagram (Original)

![Circular Dependency - Before](images/circular-dependency-before.png)

### Current Architecture

The refactored design introduces a **ToolExecutor interface** with **Adapter pattern** implementations and **dependency injection**.

#### Improved Design

**Location**: Chatbots now live in standalone `src/chatbots/` package

**Import Chain** (UI): Chatbots package → ToolExecutor → MCPClientAdapter.

**Import Chain** (MCP Server): Chatbots package → ToolExecutor → MCPServerAdapter.

**Current code structure:**
```python
# src/chatbots/base.py (refactored architecture)
from chatbots.tool_executor import ToolExecutor

class BaseChatBot(ABC):
    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        tool_executor: ToolExecutor = None  # REQUIRED parameter
    ):
        if tool_executor is None:
            raise ValueError(
                "tool_executor is required. Pass a ToolExecutor implementation"
            )

        self.model_name = model_name
        self.api_key = api_key if api_key is not None else self._get_api_key()

        # Uses dependency injection instead of direct instantiation
        self.tool_executor = tool_executor
```

**UI usage (refactored architecture):**
```python
# src/ui/ui.py (refactored architecture)
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
    tool_executor=tool_executor
)
response = chatbot.chat(question)
```

**Improvements in this approach:**

- Chatbots in standalone package, decoupled from server implementation
- Dependency injection enables flexible tool execution
- Clean separation between UI and server concerns
- Chatbots work in multiple contexts (UI, MCP server, tests)
- Easy to test with mock implementations
- Eliminates circular dependencies
- Follows SOLID principles (Dependency Inversion)

#### Architecture Diagram (Refactored)

![Circular Dependency - After](images/circular-dependency-after.png)

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

### Architecture Summary

The refactor moved chatbots into a standalone package and introduced the `ToolExecutor` interface so the UI and MCP server can each provide their own adapter for tool execution.

## Supported Models

The chatbot factory supports multiple AI providers with automatic model selection. For detailed model names, parameters, and examples, see [src/chatbots/README.md](../src/chatbots/README.md#model-name-patterns).

### Provider Categories

- **External Providers**: Anthropic Claude, OpenAI GPT, Google Gemini
- **Local Models**: Llama 3.1/3.3 (tool calling), Llama 3.2 (deterministic parsing)
- **Fallback**: Unknown models use deterministic parsing

## Related Documentation

### For Implementation & Usage
- **[src/chatbots/README.md](../src/chatbots/README.md)** - Package API, examples, error handling, and model reference
- **[src/mcp_server/README.md](../src/mcp_server/README.md)** - MCP server setup, configuration, and available tools

### For Architecture & Development
- **[OBSERVABILITY_OVERVIEW.md](OBSERVABILITY_OVERVIEW.md)** - Overall system architecture
- **[DEV_GUIDE.md](DEV_GUIDE.md)** - Development setup and workflows
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues and solutions
