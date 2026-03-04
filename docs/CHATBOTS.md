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

The chatbots system uses a **ToolExecutor interface** with **Adapter pattern** to decouple chatbot implementations from the MCP server infrastructure. Chatbots run in the _MCP server process_ and use `MCPServerAdapter` for direct tool execution.

- **ToolExecutor**: Abstract interface that defines how tools are executed (_dependency inversion principle_)
- **Adapter Pattern**: `MCPServerAdapter` adapts the MCP server instance to the `ToolExecutor` interface for direct tool execution

### Key Components

- `BaseChatBot` implementations (provider-specific)
- `ToolExecutor` interface
- `MCPServerAdapter` - adapts MCP server instance for direct tool execution

## Usage Patterns

### Usage via `chat` MCP Tool

All clients (including the OpenShift Console Plugin, CLI tools, and other services) use chatbots through the `chat` MCP tool. Chatbots run in the MCP server process and execute tools directly via `MCPServerAdapter`.

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

**Import Chain**: Chatbots package → ToolExecutor → MCPServerAdapter

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

**Improvements in this approach:**

- Chatbots in standalone package, decoupled from server implementation
- Dependency injection enables flexible tool execution
- Clean separation between chatbot logic and server infrastructure
- Chatbots work in the MCP server context and can be tested with mock implementations
- Eliminates circular dependencies
- Follows SOLID principles (Dependency Inversion)

### Key Changes

1. **Introduced `ToolExecutor` Interface** (Dependency Inversion Pattern)

   - Abstract interface in `chatbots/tool_executor.py`
   - Chatbots depend on interface, not concrete implementations
   - Defines contract: `call_tool()`, `list_tools()`, `get_tool()`

2. **Created Adapter Implementation** (Adapter Pattern)

   - `MCPServerAdapter` (in `mcp_server/mcp_tools_adapter.py`) - adapts `ObservabilityMCPServer` to `ToolExecutor` interface
   - Implements the `ToolExecutor` interface for direct tool execution within the server

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
