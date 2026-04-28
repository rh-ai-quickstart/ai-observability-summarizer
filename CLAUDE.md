# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The OpenShift AI Observability Summarizer is an AI-powered observability platform that transforms OpenShift + OpenShift AI metrics into plain-English, actionable insights. It combines a Model Context Protocol (MCP) server with interactive dashboards to analyze AI model performance, GPU metrics, and cluster health using natural language queries.

**Key components:**
- **MCP Server** (Python/FastMCP): Exposes observability tools via Model Context Protocol for AI assistants
- **OpenShift Console Plugin** (React/TypeScript): Production UI integrated into OpenShift Console
- **React UI** (React/TypeScript): Standalone development UI
- **RAG Stack** (optional): LlamaStack + vLLM + PGVector for local LLM deployment
- **Observability Stack**: Prometheus/Thanos, Loki, Tempo, OpenTelemetry, Korrel8r
- **Kubernetes Operator** (Helm-based): OLM-managed deployment with dependency orchestration

## Installation & Deployment

**For installation instructions, see:**
- **Helm-based installation**: `README.md` (Option 1: Install via Helm)
- **Operator-based installation**: `docs/OPERATOR.md` (production deployments)
- **Prerequisites & requirements**: `README.md` (Requirements section)

**Key installation patterns:**
```bash
# Standard installation
make install NAMESPACE=<namespace>

# Development mode (standalone React UI, browser-cached API keys)
make install NAMESPACE=<namespace> DEV_MODE=true

# Skip local LLM (use existing endpoint)
make install NAMESPACE=<namespace> LLM_URL=http://your-llm-endpoint

# Uninstall
make uninstall NAMESPACE=<namespace>
```

**Important:** Most Makefile targets require `NAMESPACE=<name>` parameter. Exceptions: `help`, `build`, `test`, `clean`.

## Build & Development Commands

**Container builds** (podman auto-detected and preferred over docker):
```bash
make build              # Build all images
make build-and-push     # Build and push all images
make build-mcp-server   # Build specific component
```

**Operator builds:**
```bash
make operator-config    # Show current operator configuration
make operator-deploy    # Build and push all operator images (manager + bundle + catalog)
```

**Local development:**
```bash
uv sync                 # Set up Python environment (use uv, NOT pip/venv)
./scripts/local-dev.sh -n <namespace> [-r] [-p]  # Port-forward dependencies
obs-mcp-stdio           # Run MCP server (stdio transport)
obs-mcp-server serve    # Run MCP server (HTTP transport, port 8085)
```

**Testing:**
```bash
make test               # All tests (Python + React + scripts)
make test-python        # Python tests with pytest --cov=src
make test-react         # React tests with yarn (handles dependencies)
pytest --cov=src        # Raw pytest (if dependencies installed)
cd openshift-plugin && yarn test  # Raw React tests
```

## Architecture

### High-Level Data Flow

1. **Data Collection**: Prometheus/Thanos scrapes metrics from OpenShift, vLLM, DCGM (GPU)
2. **MCP Server**: Exposes tools for querying Prometheus, analyzing traces (Tempo), logs (Loki), correlating signals (Korrel8r)
3. **UI Layer**: Console Plugin or React UI sends requests to MCP server
4. **LLM Processing**: Queries routed to configured LLM (local via LlamaStack or external API)
5. **Response**: AI-generated insights with supporting metric data returned to UI

### MCP Server Architecture (`src/mcp_server/`)

**Core modules** (`src/core/`):
- `metrics_catalog.py`: Curated catalog of OpenShift + GPU metrics with validation
- `promql_service.py`: PromQL query generation and execution
- `chat_with_prometheus.py`: Natural language → PromQL translation
- `llm_client.py`: Unified client for multiple LLM providers
- `model_config_manager.py`: Dynamic model configuration
- `tempo_service.py`: Distributed tracing queries
- `korrel8r_service.py`: Cross-signal correlation (metrics ↔ traces ↔ logs)
- `reports.py`: HTML/PDF/Markdown report generation
- `gpu_metrics_discovery.py`: Dynamic DCGM metric detection (NVIDIA/AMD/Intel)

**MCP tools** (`src/mcp_server/tools/`):
- `prometheus_tools.py`: `execute_promql` - Execute PromQL queries, analyze metrics
- `chat_tool.py`: Natural language chat with Prometheus
- `tempo_tools.py`: Trace analysis, error trace detection
- `korrel8r_tools.py`: Cross-signal correlation
- `observability_openshift_tools.py`, `observability_vllm_tools.py`: Domain-specific analysis
- `model_config_tools.py`: `add_model_to_config`, `list_provider_models`, `update_maas_model_api_key`
- `credentials_tools.py`: API key management

**REST API endpoints** (`src/mcp_server/api.py`, not MCP tools):
- `POST /generate_report`: Generate observability reports
- `GET /download_report/{report_id}`: Download reports

**Tool registration pattern:**
```python
# In observability_mcp.py _register_mcp_tools():
from mcp_server.tools.your_tool import your_tool_function
self.mcp.tool()(your_tool_function)  # NOT @decorator pattern
```

### Frontend Architecture

**Console Plugin** (`openshift-plugin/src/plugin/`): Production UI integrated into OpenShift Console  
**React UI** (`openshift-plugin/src/standalone/`): Standalone dev/testing UI with sessionStorage for DEV_MODE  
**Shared components** (`openshift-plugin/src/shared/`): API clients, hooks, PatternFly components

### Chatbot Architecture (`src/chatbots/`)

Multi-provider LLM framework with factory pattern and deterministic fallback:
- **Providers**: `anthropic_provider.py`, `openai_provider.py`, `google_provider.py`, `llama_provider.py`, `deterministic_provider.py` (fallback)
- **Design**: Provider-agnostic interface, standardized message format, deterministic fallback when LLM unavailable
- **Usage**: UI conversational interactions (separate from MCP server's `llm_client.py`)

### Component Communication

**UI → MCP Server**: HTTP REST API to `aiobs-mcp-server-svc:8085` (TLS-enabled)

**MCP Server → Observability:**
- **Prometheus/Thanos**: `https://thanos-querier.openshift-monitoring.svc.cluster.local:9091` (ClusterRole: `grafana-prometheus-reader`)
- **Tempo**: `https://tempo-tempostack-gateway.observability-hub.svc.cluster.local:8080`
- **Korrel8r**: `https://korrel8r-summarizer.openshift-cluster-observability-operator.svc.cluster.local:9443`

**MCP Server → LLM:**
- **Local**: `http://llamastack.<namespace>.svc.cluster.local:8321/v1/openai/v1` (Helm) or `http://llamastack-service.<namespace>.svc.cluster.local:8321/v1/openai/v1` (Operator)
- **External**: Direct HTTPS to provider APIs (API keys from ConfigMap or sessionStorage)

## Key Configuration Files

- `pyproject.toml`: Python dependencies (Python 3.11 required, managed by `uv`)
- `Makefile`: Build, deploy, test targets. `VERSION` variable is source of truth.
- `deploy/helm/`: Helm charts (aiobs-stack, mcp-server, openshift-console-plugin, react-ui-app, rag, observability)
- `deploy/helm/model-config.json`: Model catalog configuration
- `deploy/operator/`: Operator manifests, watches.yaml, bundled Helm charts
- `openshift-plugin/package.json`: Node dependencies (Node 24.x required)
- `src/mcp_server/data/openshift-metrics-base.json`: Metrics catalog (source of truth for available metrics)

## Common Development Workflows

### Adding a New MCP Tool

1. Create tool function in `src/mcp_server/tools/<tool_name>.py` (plain Python function with type hints + docstring)
2. Import function in `src/mcp_server/observability_mcp.py`
3. Register in `_register_mcp_tools()`: `self.mcp.tool()(your_tool_function)`
4. Add tests in `tests/mcp_server/test_<tool_name>.py`

### Adding Support for a New LLM Provider

1. Add provider enum to `src/core/models.py` (`LLMProviderEnum`)
2. Update `src/core/llm_client.py`: Add client initialization in `get_llm_client()`
3. Update `src/core/model_config_manager.py`: Default models/pricing
4. Add frontend support in `openshift-plugin/src/shared/types/settings.ts`
5. Update settings UI in `openshift-plugin/src/shared/components/Settings/`

### Modifying Metrics Catalog

**File**: `src/mcp_server/data/openshift-metrics-base.json`

1. Edit the JSON file (static metrics only - GPU metrics are dynamically discovered)
2. Run catalog validator: `pytest tests/core/test_catalog_validator.py`
3. Test metric discovery: `pytest tests/core/test_metrics_catalog.py`

## Important Development Notes

### Python Package Management
- **Always use `uv`** for Python dependencies, never pip or virtualenv
- Run `uv sync` after pulling changes that modify `pyproject.toml` or `uv.lock`
- Python 3.11 strictly required

### Environment Variables (Key Runtime Variables)

**MCP Server** (`deploy/helm/mcp-server/values.yaml`):
- `MCP_PORT`: Server port (default: `8085`)
- `PYTHON_LOG_LEVEL`: Logging level (default: `INFO`)
- `DEV_MODE`: `true` (sessionStorage) or `false` (ConfigMap/Secrets)
- `PROMETHEUS_URL`, `TEMPO_URL`, `KORREL8R_URL`: Service endpoints
- `DEFAULT_TIME_RANGE_DAYS`: Helm sets `7`, code defaults to `90` if env var unset
- `MAX_NUM_TRACE_SPANS`: Maximum traces analyzed (default: `10`)
- `TRACE_FETCH_SAFETY_FACTOR`: Trace fetching multiplier (default: `2` - tune based on error rate)
- `LLM_TIMEOUT_SECONDS`: LLM request timeout (default: `180`)
- `GPU_METRICS_PREFIX_NVIDIA/INTEL/AMD`: Custom GPU metric prefixes (Makefile: `GPU_PREFIX_*`)

**Installation** (Makefile):
- `NAMESPACE`: Required for most targets
- `DEV_MODE`, `RAG_ENABLED`, `ALERTING_ENABLED`: Feature toggles
- `LLM_URL`, `HF_TOKEN`: LLM configuration
- `USE_LLAMA_STACK_OPERATOR`: Force operator mode on RHOAI 3.x
- `REGISTRY`, `ORG`, `VERSION`: Container image settings

### Observability Stack Namespaces (Hardcoded)

- `ai-observability`: MCP server, Console plugin, React UI, RAG stack
- `observability-hub`: Tempo, OTEL Collector, MinIO
- `openshift-logging`: Loki
- `openshift-cluster-observability-operator`: Korrel8r

### Error Handling Architecture

**Base exception**: `MCPException` (`src/mcp_server/exceptions.py`)

**Specialized exceptions**: `ValidationError`, `PrometheusError`, `LLMServiceError`, `ConfigurationError`

**Error codes** (`MCPErrorCode` enum): `INVALID_INPUT`, `MISSING_PARAMETER`, `PROMETHEUS_ERROR`, `LLM_SERVICE_ERROR`, `CONNECTION_ERROR`, `TIMEOUT_ERROR`, `AUTHENTICATION_ERROR`, etc.

**Note**: `src/core/error_handling.py` has separate `ErrorType` enum for core services.

### Debugging & Logging

**View logs:**
```bash
oc logs -n <namespace> deployment/aiobs-mcp-server -f
oc logs -n <namespace> deployment/aiobs-plugin -f
oc logs -n <namespace> deployment/aiobs-react-ui -f
```

**MCP Server debugging:**
- Stdio mode: `obs-mcp-stdio` (logging disabled for Claude Desktop/Cursor)
- HTTP mode: `obs-mcp-server serve` (test: `curl http://localhost:8085/health`)
- Set log level via `PYTHON_LOG_LEVEL` environment variable (not CLI flag)

**Frontend debugging:** Browser DevTools → Console, Network tab shows MCP API calls

### Common Pitfalls

**Installation:**
- **"NAMESPACE is not set"**: Add `NAMESPACE=<name>` to make command
- **HF token prompt loops**: Set `LLM_URL` to skip local model deployment
- **LlamaStack operator on RHOAI 2.x**: Not supported, use `USE_LLAMA_STACK_OPERATOR=false`

**Runtime:**
- **MCP server can't reach Prometheus**: Check ClusterRole binding `grafana-prometheus-reader`
- **Console Plugin not appearing**: Check plugin registration: `oc get consoles.operator.openshift.io cluster -o yaml`
- **GPU metrics not discovered**: Ensure DCGM exporter running

**Development:**
- **Port conflicts in local-dev.sh**: Another process using ports 9090, 8082, 3100
- **Python import errors**: Run `uv sync`
- **TypeScript build errors**: Run `yarn install`
- **Test failures after pull**: Metrics catalog or model config may have changed

**Performance:**
- **Slow trace analysis**: Reduce `TRACE_FETCH_SAFETY_FACTOR` or `MAX_NUM_TRACE_SPANS`
- **LLM timeout**: Increase `LLM_TIMEOUT_SECONDS` (default 180s)

## Version Management & CI/CD

- **Version**: Defined in `Makefile VERSION` variable (source of truth)
- **Validation**: `scripts/verify-version-locks.sh` checks consistency across Helm charts, operator manifests
- **CI/CD**: See `docs/GITHUB_ACTIONS.md` for workflow documentation
- **Release process**: See `docs/RELEASE_PROCESS.md` and `docs/SEMANTIC_VERSIONING.md`

## MCP Server Integration

**Claude Desktop**: Config at `~/Library/Application Support/Claude/claude_desktop_config.json` (template: `src/mcp_server/integrations/claude-desktop-config.json`)

**Cursor IDE**: Config at `.cursor/mcp.json` (project-level)

**Example Cursor config:**
```json
{
  "mcpServers": {
    "ai-observability": {
      "command": ".venv/bin/obs-mcp-stdio",
      "env": {
        "PROMETHEUS_URL": "http://localhost:9090",
        "LLAMA_STACK_URL": "http://localhost:8321/v1/openai/v1"
      }
    }
  }
}
```

## Additional Resources

**Primary documentation:**
- **Installation & deployment**: `README.md`
- **Operator deployment**: `docs/OPERATOR.md`
- **Development guide**: `docs/DEV_GUIDE.md`
- **Troubleshooting**: `docs/TROUBLESHOOTING.md`

**Specialized topics:**
- **Helm charts**: `docs/HELM_CHARTS.md`
- **Model configuration**: `docs/MODEL-CONFIGURATION.md`
- **Observability stack**: `docs/OBSERVABILITY_OVERVIEW.md`
- **Chatbot architecture**: `docs/CHATBOTS.md`
- **Metrics architecture**: `docs/METRICS_ARCHITECTURE.md`
- **GitHub Actions**: `docs/GITHUB_ACTIONS.md`
- **Release process**: `docs/RELEASE_PROCESS.md`

**Helper scripts**: See `scripts/` directory (local-dev.sh, operator-manager.sh, check-observability-drift.sh, etc.)
