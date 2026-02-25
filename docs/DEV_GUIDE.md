# DEV_GUIDE.md - OpenShift AI Observability Summarizer

> **Comprehensive Development Guide for Human Developers & AI Assistants**
> This file provides complete guidance for working with the AI Observability Summarizer project, combining development patterns, architecture, and comprehensive instructions for both **human developers** and **AI coding assistants**.

## 🚀 Project Overview

The **OpenShift AI Observability Summarizer** is an open source, CNCF-style project that provides advanced monitoring and automated summarization of AI model and OpenShift cluster metrics. It generates AI-powered insights and reports from Prometheus/Thanos metrics data.

### Key Capabilities
- **vLLM Monitoring**: GPU usage, latency, request volume analysis
- **OpenShift Fleet Monitoring**: Cluster-wide and namespace-scoped metrics
- **AI-Powered Insights**: LLM-based metric summarization and analysis
- **Report Generation**: HTML, PDF, and Markdown exports
- **Alerting & Notifications**: AI-powered alerts with Slack integration
- **Distributed Tracing**: OpenTelemetry and Tempo integration

## 📁 Project Structure

```
summarizer/
├── src/                    # Main source code
│   ├── core/              # Core business logic
│   │   ├── config.py      # Configuration management
│   │   ├── llm_client.py  # LLM communication
│   │   ├── metrics.py     # Metrics discovery & fetching
│   │   ├── analysis.py    # Statistical analysis
│   │   ├── reports.py     # Report generation
│   │   ├── promql_service.py # PromQL generation
│   │   └── thanos_service.py # Thanos integration
│   ├── chatbots/          # Multi-provider chatbot architecture (standalone)
│   │   ├── base.py           # Abstract base class with common functionality
│   │   ├── factory.py        # Model-to-bot routing
│   │   ├── tool_executor.py  # ToolExecutor interface
│   │   ├── anthropic_bot.py  # Anthropic Claude support
│   │   ├── openai_bot.py     # OpenAI GPT support
│   │   ├── google_bot.py     # Google Gemini support
│   │   ├── llama_bot.py      # Local Llama support
│   │   └── deterministic_bot.py # Fallback implementation
│   ├── mcp_server/        # Model Context Protocol server
│   │   ├── api.py         # MCP API implementation
│   │   ├── main.py        # HTTP server entrypoint
│   │   ├── stdio_server.py # STDIO server for AI assistants
│   │   ├── tools/         # MCP tools (observability_tools.py)
│   │   └── integrations/  # AI assistant integration configs
│   └── alerting/          # Alerting service
│       └── alert_receiver.py # Alert handling
├── openshift-plugin/      # Console Plugin & React UI source code
│   ├── src/               # TypeScript/React source
│   ├── Dockerfile.plugin  # Console Plugin container
│   └── Dockerfile.react-ui # React UI container
├── deploy/helm/           # Helm charts for deployment
│   ├── mcp-server/        # MCP server Helm chart
│   ├── openshift-console-plugin/ # Console Plugin Helm chart
│   ├── react-ui-app/      # React UI Helm chart
│   └── rag/               # RAG components (llama-stack, llm-service)
├── tests/                 # Test suite
│   ├── mcp/               # MCP server tests
│   ├── core/              # Core logic tests
│   └── alerting/          # Alerting tests
├── scripts/               # Development and deployment scripts
│   └── metrics/           # Metrics CLI tool for catalog management
└── docs/                  # Documentation
```

## 🔧 Development workflows

Use `./scripts/local-dev.sh` for local development and port-forwarding. Keep it as the primary entrypoint for dev work.

For installation, build/deploy, and test commands, refer to:
- `README.md`
- `docs/OBSERVABILITY_OVERVIEW.md`

## 🏗️ Architecture & Data Flow

### Core Components
1. **MCP Server** (`src/mcp_server/`): Model Context Protocol server for metrics analysis, report generation, and AI assistant integration
2. **Chatbots** (`src/chatbots/`): Multi-provider LLM chatbot architecture with factory pattern (see [CHATBOTS.md](CHATBOTS.md))
   - **Anthropic Claude**: Claude Sonnet 4, Claude Haiku 4.5, Claude 3 Opus
   - **OpenAI GPT**: GPT-4o, GPT-4o-mini
   - **Google Gemini**: Gemini 2.0/2.5 Flash
   - **Local Llama**: Llama 3.1-8B, Llama 3.2-3B (via LlamaStack)
3. **UI Options**: Console Plugin (OpenShift Console integration), React UI (standalone)
4. **Core Logic** (`src/core/`): Business logic modules for metrics processing and LLM integration
5. **Alerting** (`src/alerting/`): Alert handling and Slack notifications
6. **Helm Charts** (`deploy/helm/`): OpenShift deployment configuration

### Data Flow
1. **Natural Language Question** → PromQL generation via LLM
2. **PromQL Queries** → Thanos/Prometheus for metrics data
3. **Metrics Data** → Statistical analysis and anomaly detection
4. **Analysis Results** → LLM summarization
5. **Summary** → Report generation (HTML/PDF/Markdown)

### Key Services Integration
- **Prometheus/Thanos**: Metrics storage and querying
- **vLLM**: Model serving with /metrics endpoint
- **DCGM**: GPU monitoring metrics
- **Llama Stack**: LLM inference backend
- **OpenTelemetry/Tempo**: Distributed tracing

## 🔍 Common Development Patterns

### Adding New Metrics
1. Update metric discovery functions in `src/core/metrics.py`
2. Add PromQL queries for the new metrics
3. Update UI components to display the metrics
4. Add corresponding tests

### Adding New MCP Tools
1. Define request/response models in `src/core/models.py`
2. Implement business logic in appropriate `src/core/` module
3. Add MCP tool in `src/mcp_server/tools/`
4. Add corresponding tests

### Managing the Metrics Catalog

The `scripts/metrics/cli.py` tool manages the optimized metrics catalog used by AI Chat for intelligent metric discovery.

```bash
# Regenerate the metrics catalog (requires Prometheus access)
python scripts/metrics/cli.py -a              # Run all: fetch → categorize → optimize

# Individual steps
python scripts/metrics/cli.py -f              # Fetch from Prometheus
python scripts/metrics/cli.py -c              # Categorize by priority
python scripts/metrics/cli.py -m              # Optimize with keywords

# Options
python scripts/metrics/cli.py -h              # Show all options
python scripts/metrics/cli.py -a -v           # Verbose output
python scripts/metrics/cli.py -m -o out.json  # Custom output path
```

**Output**: `src/mcp_server/data/openshift-metrics-optimized.json` - Contains categorized metrics with keywords for AI-powered search.

### Shared Metric Configurations (Frontend)

Metric constants used by both the metrics pages and Settings tabs are in shared data files:

- **`openshift-plugin/src/core/data/vllmMetricsConfig.ts`** — `KEY_METRICS_CONFIG` (6 key metrics) and `METRIC_CATEGORIES` (8 categories) used by the vLLM Metrics page and vLLM Metrics Settings tab
- **`openshift-plugin/src/core/data/openshiftMetricsConfig.ts`** — `CLUSTER_WIDE_CATEGORIES` (11 categories) used by the OpenShift Metrics page and OpenShift Metrics Settings tab

Both the page components and settings tabs import from these shared files to keep metric definitions in a single location.

### Settings — Metrics Tab

The Settings modal has a consolidated **"Metrics"** tab containing three subtabs:

| Subtab | Source | Description |
|--------|--------|-------------|
| **Chat Metrics Catalog** | MCP `get_category_metrics_detail` tool | Browse the AI chat metrics catalog (loaded from MCP server) |
| **vLLM Metrics** | `vllmMetricsConfig.ts` | Read-only view of vLLM Metrics page metrics (6 key + 8 categories) |
| **OpenShift Metrics** | `openshiftMetricsConfig.ts` | Read-only view of OpenShift Metrics page metrics (11 categories) |

All three subtabs support:
- **Search** with 200ms debounce filtering
- **Shared download button** at the parent level that exports metrics as a markdown (`.md`) file for whichever subtab is active

The wrapper component is `MetricsSettingsTab.tsx`. Each sub-component (`MetricsCatalogTab`, `VLLMMetricsSettingsTab`, `OpenShiftMetricsSettingsTab`) accepts optional `downloadRef` and `hideHeader` props for integration with the wrapper while remaining usable standalone.

The download utility is at `openshift-plugin/src/core/utils/downloadFile.ts`.

### Error Handling
- API endpoints use HTTPException for user-facing errors
- Internal errors are logged with stack traces
- LLM API key errors return specific user-friendly messages

## 🚀 Development Workflows

### Feature Development
1. Start local dev environment: `./scripts/local-dev.sh -n <DEFAULT_NAMESPACE>`
2. Make changes.
3. Validate behavior in the UI and MCP server logs.

### Bug Fixing
1. Reproduce via local dev environment.
2. Add/adjust tests only if the change is not easily validated manually.

## 📊 Monitoring & Debugging

### Setup Namespace
```bash
# Use the script with appropriate namespace parameters
./scripts/local-dev.sh -n <DEFAULT_NAMESPACE>
# or with separate model namespace:
./scripts/local-dev.sh -n <DEFAULT_NAMESPACE> -m <MODEL_NAMESPACE>
```

### Port Forwarding
```bash
# Manual port-forwarding (if script fails)

# Thanos querier (pod-based, use head -1 since multiple pods may exist)
THANOS_POD=$(oc get pods -n openshift-monitoring -o name -l 'app.kubernetes.io/component=query-layer,app.kubernetes.io/instance=thanos-querier' | head -1)
oc port-forward $THANOS_POD 9090:9090 -n openshift-monitoring &

# LlamaStack (service-based)
LLAMASTACK_SERVICE=$(oc get services -n <DEFAULT_NAMESPACE> -o name -l 'app.kubernetes.io/instance=rag, app.kubernetes.io/name=llamastack')
oc port-forward $LLAMASTACK_SERVICE 8321:8321 -n <DEFAULT_NAMESPACE> &

# Llama Model service (service-based)
LLAMA_MODEL_SERVICE=$(oc get services -n <MODEL_NAMESPACE> -o name -l 'app=isvc.llama-3-1-8b-instruct-predictor')
oc port-forward $LLAMA_MODEL_SERVICE 8080:8080 -n <MODEL_NAMESPACE> &

# Tempo gateway (service-based)
TEMPO_SERVICE=$(oc get services -n observability-hub -o name -l 'app.kubernetes.io/name=tempo,app.kubernetes.io/component=gateway')
oc port-forward $TEMPO_SERVICE 8082:8080 -n observability-hub &
```

**Note**:
- Thanos uses pod-based forwarding with `head -1` because multiple thanos-querier pods may exist
- Other services use service-based forwarding for better reliability
- Replace `<DEFAULT_NAMESPACE>` and `<MODEL_NAMESPACE>` with your actual namespaces

### Logs
```bash
# View pod logs (replace with your actual namespace)
oc logs -f deployment/aiobs-ui -n <DEFAULT_NAMESPACE>
oc logs -f deployment/mcp-server -n <DEFAULT_NAMESPACE>
oc logs -f deployment/metric-alerting -n <DEFAULT_NAMESPACE>
```

### Metrics
```bash
# Access MCP server health/metrics
oc port-forward svc/mcp-server 8085:8085 -n <DEFAULT_NAMESPACE>
# Then visit http://localhost:8085/health
```

## 🛠️ Useful Makefile Targets

### Development
- `./scripts/local-dev.sh -n <namespace>` - Set up local development environment
- `make test` - Run unit tests with coverage
- `make clean` - Clean up local images

### Building
- `make build` - Build all container images
- `make build-console-plugin` - Build Console Plugin
- `make build-react-ui` - Build React UI
- `make build-alerting` - Build alerting service
- `make build-mcp-server` - Build MCP server

### Deployment
- `make install` - Deploy to OpenShift (Console Plugin by default, React UI with DEV_MODE=true)
- `make install-with-alerts` - Deploy with alerting
- `make install-mcp-server` - Deploy MCP server only
- `make status` - Check deployment status
- `make uninstall` - Remove deployment

### Observability Stack
- `make install-observability-stack` - Install complete observability stack
- `make uninstall-observability-stack` - Uninstall complete observability stack
- `make install-minio` - Install MinIO storage only
- `make uninstall-minio` - Uninstall MinIO storage only
- `make install-observability` - Install TempoStack + OTEL only
- `make uninstall-observability` - Uninstall TempoStack + OTEL only
- `make setup-tracing` - Enable auto-instrumentation
- `make remove-tracing` - Disable auto-instrumentation

### Configuration
- `make config` - Show current configuration
- `make list-models` - List available LLM models
- `make help` - Show all available targets

## 🔧 Troubleshooting

### Common Issues

#### Port Forwarding Fails
```bash
# Check if pods are running
oc get pods -n <DEFAULT_NAMESPACE>

# Restart port-forwarding
./scripts/local-dev.sh -n <DEFAULT_NAMESPACE>
```

#### Tests Fail
```bash
# Ensure virtual environment is activated
source .venv/bin/activate

# Reinstall dependencies
uv sync --group dev --reinstall

# Run tests with verbose output
uv run pytest -v --tb=short
```

#### Build Fails
```bash
# Check Docker/Podman is running
docker ps

# Clean and rebuild
make clean
make build
```

#### Deployment Issues
```bash
# Check namespace exists
oc get namespace <DEFAULT_NAMESPACE>

# Check Helm releases
helm list -n <DEFAULT_NAMESPACE>

# View deployment events
oc get events -n <DEFAULT_NAMESPACE> --sort-by='.lastTimestamp'
```

## 🔒 Security Considerations
- Service account tokens are read from mounted volumes
- SSL verification uses cluster CA bundle when available
- No secrets should be logged or committed to repository
- API endpoints use proper authentication and authorization

## 📚 Additional Resources

- **README.md** - Comprehensive project overview and setup
- **docs/GITHUB_ACTIONS.md** - CI/CD workflow documentation
- **docs/SEMANTIC_VERSIONING.md** - Version management guidelines

## 🎯 Quick Reference

### File Locations
- **MCP Server**: `src/mcp_server/main.py`
- **Chatbots**: `src/chatbots/` (see [CHATBOTS.md](CHATBOTS.md))
- **Core Logic**: `src/core/llm_summary_service.py`
- **Console Plugin & React UI**: `openshift-plugin/` (TypeScript/React source for both UIs)
- **Tests**: `tests/`
- **Helm Charts**: `deploy/helm/`

### Key Commands
- **Local Dev**: `./scripts/local-dev.sh -n <namespace>`
- **Tests**: `uv run pytest -v`
- **Build**: `make build`
- **Deploy**: `make install NAMESPACE=ns`
- **Status**: `make status NAMESPACE=ns`

### Environment Variables
- `REGISTRY` - Container registry (default: quay.io)
- `VERSION` - Image version (default: 0.1.2)
- `LLM` - LLM model ID for deployment
- `PROMETHEUS_URL` - Metrics endpoint
- `LLAMA_STACK_URL` - LLM backend URL

---

**💡 Tip**: Use `make help` to see all available Makefile targets and their descriptions.
