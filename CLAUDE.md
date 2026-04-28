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

## Installation Methods

### Option 1: Makefile (Helm-based) Installation

**When to use:**
- Development and custom deployments
- Direct control over component configuration
- Non-OLM environments
- Testing individual components

**Installation sequence:**
```bash
make install NAMESPACE=<namespace>
```

This command executes the following steps in order:
1. **Pre-install checks**: Validates cluster prerequisites
2. **Enable user workload monitoring**: Configures Prometheus for custom metrics
3. **Install dependency operators** (via OLM):
   - Cluster Observability Operator
   - OpenTelemetry Operator
   - Tempo Operator
   - Cluster Logging Operator
   - Loki Operator
4. **Install observability stack** (in sequence):
   - MinIO (object storage for traces/logs)
   - TempoStack (distributed tracing)
   - LokiStack (log aggregation)
   - OTEL Collector (OpenTelemetry collection)
   - Korrel8r (signal correlation)
   - Enables Tracing UI in Console
5. **Install MCP Server**: Model Context Protocol server with generated model config
6. **Install UI** (based on DEV_MODE):
   - `DEV_MODE=false` (default): OpenShift Console Plugin (2 replicas)
   - `DEV_MODE=true`: Standalone React UI
7. **Install RAG Stack** (if `RAG_ENABLED != false`):
   - LlamaStack or LlamaStack operator instance (based on RHOAI version)
   - vLLM InferenceService (KServe) with HuggingFace model
   - PGVector database
8. **Install Alerting** (if `ALERTING_ENABLED=true`):
   - Alert analysis CronJob with optional Slack integration

**Common variations:**
```bash
# Skip local LLM deployment (use existing endpoint)
make install NAMESPACE=<namespace> LLM_URL=http://your-llm-endpoint

# Development mode (standalone React UI + browser-cached API keys)
make install NAMESPACE=<namespace> DEV_MODE=true

# Skip RAG stack (no local LLM)
make install NAMESPACE=<namespace> RAG_ENABLED=false

# Enable alerting
make install NAMESPACE=<namespace> ALERTING_ENABLED=true

# Uninstall
make uninstall NAMESPACE=<namespace>
```

**What gets installed:**
- **Namespace**: User-specified namespace (e.g., `ai-observability`)
- **Observability infrastructure**: 
  - `observability-hub` namespace: MinIO, TempoStack, OTEL Collector
  - `openshift-logging` namespace: LokiStack
  - `openshift-cluster-observability-operator` namespace: Korrel8r
- **Application components** (user namespace):
  - MCP Server (1 replica, TLS-enabled)
  - Console Plugin (2 replicas) OR React UI (1 replica)
  - RAG Stack: LlamaStack, vLLM InferenceService, PGVector (optional)
  - Alerting CronJob (optional)

**Key configuration:**
- Operators install to their default namespaces (managed by OLM)
- Infrastructure components use hardcoded namespaces (cannot be changed)
- Application components install to user-specified namespace
- Observability components automatically drift-checked against reference manifests

### Option 2: Operator (OLM-based) Installation

**When to use:**
- Production deployments
- Centralized operator management
- Automatic dependency installation
- Cluster-wide singleton deployment
- Automatic upgrades via OLM

**Installation process (3 steps):**

1. **Install CatalogSource**:
   ```bash
   oc apply -f deploy/operator/catalog-source.yaml
   ```

2. **Install Operator via OperatorHub**:
   - Search for "AI Observability" in OperatorHub
   - Install to `openshift-operators` (recommended) or `openshift-operators-redhat`
   - OLM automatically installs all dependency operators

3. **Create AIObservabilitySummarizer CR**:
   - Create CR in `ai-observability` namespace
   - Configure RAG Stack (enabled by default, requires HuggingFace token)
   - Select LLM model and device type
   - Optionally enable alerting

**What gets installed automatically:**

**Application Components** (`ai-observability` namespace):
- MCP Server (1 replica, TLS-enabled) - Always
- Console Plugin (2 replicas) - Always
- LlamaStack - If RAG enabled (default)
- vLLM InferenceService - If RAG enabled
- PGVector - If RAG enabled
- Alert CronJob - If alerting enabled

**Infrastructure Components** (multi-namespace):
- MinIO - `observability-hub` - Always
- TempoStack - `observability-hub` - Always
- OTEL Collector - `observability-hub` - Always
- LokiStack - `openshift-logging` - Always
- Korrel8r - `openshift-cluster-observability-operator` - Always

**Dependency Operators** (auto-installed by OLM):
- Cluster Observability Operator (v1.0.0+)
- OpenTelemetry Operator (v0.140.0+)
- Tempo Operator (v0.20.x)
- Cluster Logging Operator (v6.3.x-6.4.x)
- Loki Operator (v6.3.x-6.4.x)

**Automatic cluster configuration:**
- Enables User Workload Monitoring
- Enables Alertmanager for User Workload Monitoring
- Registers Console Plugin automatically
- Configures Tempo operator for optimal deployment

**Limitations:**
- **Singleton pattern**: Only ONE CR allowed per cluster
- **Fixed namespaces**: Infrastructure components use hardcoded namespaces
- **Shared infrastructure**: All CRs share the same observability stack

**For more details:** See `docs/OPERATOR.md` and `deploy/operator/README.md`

---

## Build & Development Commands

### Build Commands

**Container Tool**: The Makefile auto-detects and prefers **podman** over docker if available. Most development uses podman.

```bash
# Build all container images (uses podman if available)
make build

# Build and push all images
make build-and-push

# Build specific components
make build-mcp-server
make build-console-plugin
make build-react-ui

# Override build tool (if needed)
make build BUILD_TOOL=docker

# Operator build and deployment
make operator-config              # Show current operator configuration
make operator-build               # Build operator image
make operator-push                # Push operator image
make operator-bundle-build        # Build operator bundle image
make operator-bundle-push         # Push operator bundle image
make operator-catalog-build       # Build operator catalog image
make operator-catalog-push        # Push operator catalog image
make operator-deploy              # Build and push all operator images
```

### Local Development

```bash
# Set up Python environment (use uv, not pip/venv)
uv sync

# Start local development with port-forwarding to cluster dependencies
./scripts/local-dev.sh -n <namespace>

# Run MCP server locally (after port-forwarding)
obs-mcp-stdio  # stdio transport
obs-mcp-http   # HTTP/SSE transport
```

### Testing

```bash
# Run all tests (Python + React + scripts)
make test

# Run Python tests only
make test-python
pytest                           # all tests
pytest tests/core/              # specific directory
pytest tests/core/test_llm_client.py  # specific file
pytest -k "test_name"           # specific test
pytest --coverage               # with coverage report

# Run React tests only
make test-react
cd openshift-plugin && yarn test          # all tests
cd openshift-plugin && yarn test:watch    # watch mode
cd openshift-plugin && yarn test:coverage # with coverage

# Run script tests
make test-scripts
```

### Frontend Development

```bash
cd openshift-plugin

# Install dependencies
yarn install

# Build
yarn build          # build both plugin and React UI
yarn build:plugin   # Console plugin only
yarn build:react-ui # React UI only

# Development servers
yarn start:plugin    # Console plugin dev server (port 9001)
yarn start:react-ui  # React UI dev server (port 3000)

# Linting & type checking
yarn lint
yarn typecheck
```

## Architecture

### High-Level Data Flow

1. **Data Collection**: Prometheus/Thanos scrapes metrics from OpenShift, vLLM, DCGM (GPU), etc.
2. **MCP Server**: Exposes tools for querying Prometheus, analyzing traces (Tempo), logs (Loki), and correlating signals (Korrel8r)
3. **UI Layer**: Console Plugin or React UI sends requests to MCP server
4. **LLM Processing**: Queries routed to configured LLM (local via LlamaStack or external API)
5. **Response**: AI-generated insights with supporting metric data returned to UI

### MCP Server Architecture

The MCP server (`src/mcp_server/`) exposes observability capabilities as MCP tools:

**Core modules** (`src/core/`):
- `metrics_catalog.py`: Curated catalog of OpenShift + GPU metrics with validation
- `promql_service.py`: PromQL query generation and execution against Prometheus/Thanos
- `chat_with_prometheus.py`: Natural language → PromQL translation
- `llm_client.py`: Unified client for multiple LLM providers (OpenAI, Anthropic, Google, Meta, MaaS)
- `model_config_manager.py`: Dynamic model configuration (external APIs + local models)
- `tempo_service.py`: Distributed tracing queries via Tempo
- `korrel8r_service.py`: Cross-signal correlation (metrics ↔ traces ↔ logs)
- `reports.py`: HTML/PDF/Markdown report generation
- `gpu_metrics_discovery.py`: Dynamic DCGM metric detection for NVIDIA/AMD/Intel GPUs

**MCP tools** (`src/mcp_server/tools/`):
- `prometheus_tools.py`: Execute PromQL queries, analyze metrics, generate reports
- `chat_tool.py`: Natural language chat with Prometheus (query generation + execution)
- `tempo_tools.py`: Trace analysis, error trace detection, trace correlation
- `korrel8r_tools.py`: Cross-signal correlation (metrics ↔ traces ↔ logs)
- `observability_openshift_tools.py`: OpenShift-specific metric analysis
- `observability_vllm_tools.py`: vLLM model serving metric analysis
- `model_config_tools.py`: Dynamic model configuration (add/list/remove models)
- `credentials_tools.py`: API key management (set/get/remove provider keys)

**Integrations** (`src/mcp_server/integrations/`):
- Claude Desktop, Cursor IDE support

### Frontend Architecture

**Console Plugin** (`openshift-plugin/src/plugin/`):
- Integrated into OpenShift Console via dynamic plugin SDK
- Production deployment mode (DEV_MODE=false)
- Pages: Overview, vLLM Metrics, Hardware Accelerator, OpenShift Metrics, Chat, Reports, Settings

**React UI** (`openshift-plugin/src/standalone/`):
- Standalone web app for development/testing
- Development mode (DEV_MODE=true) uses browser sessionStorage for API keys/models
- Shared components with Console Plugin

**Shared components** (`openshift-plugin/src/shared/`):
- API clients, hooks, utilities
- PatternFly React components for consistent OpenShift UX

### Deployment Modes

**Helm-based (default)**:
- Manual Helm chart installation via Makefile
- Direct control over component configuration
- Use: Development, custom deployments, non-OLM environments

**Operator-based (optional)**:
- OLM-managed lifecycle with automatic dependency installation
- Single AIObservabilitySummarizer CR deploys entire stack
- Operator is Helm-based (wraps existing Helm charts, no custom Go controllers)
- Use: Production, centralized operator management, automatic upgrades
- See: `deploy/operator/README.md`, `docs/OPERATOR.md`

### RHOAI Version Detection

The Makefile auto-detects Red Hat OpenShift AI version:
- **RHOAI 2.x**: Uses architectural Helm charts for LlamaStack
- **RHOAI 3.x**: Auto-enables LlamaStack operator if detected in DataScienceCluster
- Override: `USE_LLAMA_STACK_OPERATOR=false` forces Helm chart mode on RHOAI 3.x

### Component Communication & Service Endpoints

**How components talk to each other:**

1. **UI → MCP Server**:
   - Console Plugin: Via OpenShift Console proxy to `aiobs-mcp-server-svc:8085`
   - React UI: Direct HTTP to MCP server route or service
   - Protocol: HTTP REST API (JSON)
   - TLS: Enabled by default (service-serving-cert)

2. **MCP Server → Observability Stack**:
   - **Prometheus/Thanos**: `https://thanos-querier.openshift-monitoring.svc.cluster.local:9091`
     - Authentication: ClusterRole `grafana-prometheus-reader` binding
     - Queries: PromQL via HTTP API
   - **Tempo**: `https://tempo-tempostack-gateway.observability-hub.svc.cluster.local:8080`
     - Authentication: Bearer token from tempo tenant
     - Queries: TraceQL and HTTP API
   - **Loki**: Via Korrel8r (not direct)
   - **Korrel8r**: `https://korrel8r-summarizer.openshift-cluster-observability-operator.svc.cluster.local:9443`
     - Correlates metrics → traces → logs
     - Returns correlated signals as unified response

3. **MCP Server → LLM**:
   - **Local LLM** (RAG Stack): `http://llamastack:8321` (Helm) or `http://llamastack-service:8321` (Operator)
     - Protocol: OpenAI-compatible API
     - Path: `/v1/openai/v1/chat/completions`
   - **External LLMs**: Direct HTTPS to provider APIs (OpenAI, Anthropic, Google, etc.)
     - API keys from ConfigMap (production) or sessionStorage (dev mode)

4. **Operator → Helm Charts**:
   - Operator watches AIObservabilitySummarizer CR
   - Renders Helm charts from `deploy/operator/helm-charts/`
   - Applies manifests to cluster namespaces

**Service naming conventions:**
- MCP Server: `aiobs-mcp-server-svc` (fixed name for console plugin proxy)
- Console Plugin: `aiobs-plugin` (fixed name for console registration)
- LlamaStack: `llamastack` (Helm) or `<instance-name>-llamastack` (Operator)
- MinIO: `minio` in `observability-hub` namespace
- Tempo: `tempo-tempostack-gateway` in `observability-hub` namespace
- Loki: `loki-lokistack-gateway` in `openshift-logging` namespace
- Korrel8r: `korrel8r-summarizer` in `openshift-cluster-observability-operator` namespace

## Key Configuration Files

### Python Environment
- `pyproject.toml`: Python dependencies (managed by uv, NOT pip)
- Python 3.11 required (enforced in pyproject.toml)
- Use `uv sync` to install dependencies

### Helm Charts
- `deploy/helm/aiobs-stack/`: Umbrella chart (includes all sub-charts)
- `deploy/helm/mcp-server/`: MCP server deployment
- `deploy/helm/openshift-console-plugin/`: Console plugin
- `deploy/helm/react-ui-app/`: Standalone React UI
- `deploy/helm/rag/`: RAG stack (LlamaStack + vLLM + PGVector)
- `deploy/helm/observability/`: Tempo, Loki, OTEL, Korrel8r
- `deploy/helm/model-config.json`: Model catalog configuration

### Operator
- `deploy/operator/watches.yaml`: Helm chart → CR mapping
- `deploy/operator/config/`: CRD, RBAC, manager deployment
- `deploy/operator/helm-charts/`: Helm charts bundled into operator image

### Frontend
- `openshift-plugin/package.json`: Node dependencies, build scripts
- `openshift-plugin/config/webpack.plugin.ts`: Console plugin webpack config
- `openshift-plugin/config/webpack.react-ui.ts`: React UI webpack config
- Requires Node 24.x (enforced in package.json)

## Common Development Workflows

### Adding a New MCP Tool

1. Create tool in `src/mcp_server/tools/<tool_name>.py`
2. Implement tool logic using `@mcp_server.tool()` decorator
3. Import and register in `src/mcp_server/observability_mcp.py`
4. Add tests in `tests/mcp_server/test_<tool_name>.py`
5. Update MCP server README if tool exposes new functionality

### Adding Support for a New LLM Provider

1. Add provider enum to `src/core/models.py` (LLMProviderEnum)
2. Update `src/core/llm_client.py`:
   - Add provider-specific client initialization in `get_llm_client()`
   - Implement chat completion format conversion if needed
3. Update `src/core/model_config_manager.py` for default models/pricing
4. Add frontend support in `openshift-plugin/src/shared/types/settings.ts`
5. Update settings UI in `openshift-plugin/src/shared/components/Settings/`

### Modifying Metrics Catalog

The metrics catalog (`src/mcp_server/data/metrics_catalog.json`) is the source of truth for available metrics:

1. Edit `src/mcp_server/data/metrics_catalog.json`
2. Run catalog validator: `pytest tests/core/test_catalog_validator.py`
3. Test metric discovery: `pytest tests/core/test_metrics_catalog.py`
4. GPU metrics are dynamically discovered at runtime (see `gpu_metrics_discovery.py`)

### Testing Observability Stack Drift

Check if deployed observability components match expected configuration:

```bash
make check-observability-drift
```

This validates Tempo, Loki, OTEL Collector, and other components against reference manifests.

### Testing Individual MCP Tools

**Local testing with MCP Inspector:**
1. Install MCP Inspector: `npm install -g @modelcontextprotocol/inspector`
2. Start MCP server locally: `obs-mcp-stdio`
3. Run inspector: `mcp-inspector`
4. Test individual tools via the UI

**Testing via Python:**
```python
# Import and test individual tools
from src.mcp_server.tools.prometheus_tools import query_prometheus

# Mock dependencies as needed
result = query_prometheus(query="up", start_time="now-1h", end_time="now")
```

**Testing HTTP transport:**
```bash
# Start MCP server in HTTP mode
obs-mcp-http

# Test with curl
curl -X POST http://localhost:8085/mcp/tools/query_prometheus \
  -H "Content-Type: application/json" \
  -d '{"query": "up", "start_time": "now-1h", "end_time": "now"}'
```

### Customizing Helm Chart Values

**Common customizations:**

```bash
# Override image versions
helm upgrade mcp-server deploy/helm/mcp-server \
  --set image.tag=6.2.0 \
  --set image.repository=my-registry/mcp-server

# Increase replica count
helm upgrade aiobs-plugin deploy/helm/openshift-console-plugin \
  --set replicaCount=3

# Configure resource limits
helm upgrade mcp-server deploy/helm/mcp-server \
  --set resources.limits.cpu=2 \
  --set resources.limits.memory=4Gi

# Enable/disable TLS
helm upgrade mcp-server deploy/helm/mcp-server \
  --set tls.enabled=false

# Change log level
helm upgrade mcp-server deploy/helm/mcp-server \
  --set env.PYTHON_LOG_LEVEL=DEBUG

# Add custom GPU metric prefix
helm upgrade mcp-server deploy/helm/mcp-server \
  --set env.GPU_METRICS_PREFIX_NVIDIA="custom_gpu_,dcgm_"
```

**Values precedence (highest to lowest):**
1. Command-line `--set` flags
2. Values files passed with `-f`
3. Chart `values.yaml` defaults
4. Parent chart (aiobs-stack) global values

## Important Development Notes

### Python Package Management
- **Always use `uv`** for Python dependency management, never pip or virtualenv
- Run `uv sync` after pulling changes that modify `pyproject.toml` or `uv.lock`
- Python 3.11 is strictly required (enforced in pyproject.toml)

### Namespace Requirements
- Most Makefile targets require `NAMESPACE=<name>` parameter
- Exception: targets like `help`, `build`, `test`, `clean` work without NAMESPACE

### Environment Variables

**Installation-time variables (Makefile):**
- `NAMESPACE`: Target namespace for installation (required for most targets)
- `DEV_MODE`: `true` (React UI + sessionStorage) or `false` (Console Plugin + secrets, default)
- `RAG_ENABLED`: `true` (default) or `false` (skip local LLM deployment)
- `ALERTING_ENABLED`: `true` or `false` (default, skip alerting CronJob)
- `LLM_URL`: Existing LLM endpoint URL (skips local model deployment)
- `HF_TOKEN`: HuggingFace token (required for local model download)
- `USE_LLAMA_STACK_OPERATOR`: `true` (use operator) or `false` (use Helm chart)
- `REGISTRY`: Container registry (default: `quay.io`)
- `ORG`: Registry organization (default: `ecosystem-appeng`)
- `VERSION`: Image tag version (default: `6.1.1`)
- `BUILD_TOOL`: `podman` (auto-detected, preferred) or `docker`

**Runtime variables (MCP Server):**
- `MCP_HOST`: Server bind address (default: `0.0.0.0`)
- `MCP_PORT`: Server port (default: `8085`)
- `MCP_TRANSPORT_PROTOCOL`: `http` or `stdio`
- `PYTHON_LOG_LEVEL`: Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`)
- `DEV_MODE`: `true` (sessionStorage) or `false` (ConfigMap/Secrets)
- `PROMETHEUS_URL`: Prometheus/Thanos endpoint (default: cluster Thanos querier)
- `TEMPO_URL`: Tempo gateway endpoint (default: `observability-hub` namespace)
- `TEMPO_TENANT_ID`: Tempo tenant (default: `dev`)
- `KORREL8R_URL`: Korrel8r service endpoint
- `MAAS_API_URL`: Model as a Service API endpoint (for MAAS provider)
- `MAX_TIME_RANGE_DAYS`: Maximum time range for queries (default: `90`)
- `DEFAULT_TIME_RANGE_DAYS`: Default time range (default: `7`)
- `MAX_NUM_LOG_ROWS`: Maximum log rows returned by Korrel8r (default: `10`)
- `MAX_NUM_TRACE_SPANS`: Maximum trace spans analyzed (default: `10`)
- `TRACE_FETCH_SAFETY_FACTOR`: Trace fetching multiplier (default: `2`, see tuning below)
- `KORREL8R_TIMEOUT_SECONDS`: Korrel8r query timeout (default: `8`)
- `LLM_TIMEOUT_SECONDS`: LLM request timeout (default: `180`)
- `GPU_METRICS_PREFIX_NVIDIA`: Custom NVIDIA GPU metric prefixes (comma-separated, additive)
- `GPU_METRICS_PREFIX_INTEL`: Custom Intel GPU metric prefixes (comma-separated, additive)
- `GPU_METRICS_PREFIX_AMD`: Custom AMD GPU metric prefixes (comma-separated, additive)

**Trace analysis tuning:**
`TRACE_FETCH_SAFETY_FACTOR` controls how many traces to fetch from Tempo. The analyzer fetches `(MAX_NUM_TRACE_SPANS × TRACE_FETCH_SAFETY_FACTOR)` traces, then filters for error traces.

- **Default: 2** (fetch 20 traces when `MAX_NUM_TRACE_SPANS=10`)
- **Low error rate (~1%)**: Increase to 3-5 to ensure enough error traces are found
- **High error rate (~10%+)**: Can use 1-2 for faster analysis
- **Trade-off**: Higher values = better error detection but slower queries

### GPU Metrics Discovery
- Custom GPU metric prefixes: `GPU_PREFIX_NVIDIA`, `GPU_PREFIX_INTEL`, `GPU_PREFIX_AMD`
- DCGM metrics auto-discovered at runtime based on available labels
- See `src/core/gpu_metrics_discovery.py` for discovery logic

### Observability Stack Namespaces
- **ai-observability**: MCP server, Console plugin, React UI, RAG stack
- **observability-hub**: Tempo, OTEL Collector, MinIO
- **openshift-logging**: Loki
- **openshift-cluster-observability-operator**: Korrel8r

These namespaces are hardcoded in various Helm charts and scripts.

### Testing Guidelines
- Python tests use pytest with fixtures in `tests/conftest.py`
- Mock external services (Prometheus, LLM APIs) in tests
- React tests use Jest + React Testing Library
- Maintain >80% code coverage for new Python code

### Error Handling Architecture

The MCP server uses a structured exception hierarchy (`src/mcp_server/exceptions.py`):

**Base exception:**
- `MCPException`: Base class for all MCP errors with error codes and context

**Specialized exceptions:**
- `ValidationError`: Input validation failures (invalid parameters, missing fields)
- `PrometheusError`: Prometheus/Thanos query failures (includes query + status code)
- `LLMServiceError`: LLM service failures (includes model ID + status code)
- `ConfigurationError`: Invalid or missing configuration
- `TempoError`: Tempo trace query failures
- `KorrelatorError`: Korrel8r correlation failures

**Error codes** (MCPErrorCode enum):
- `INVALID_INPUT`: Input validation failed
- `MISSING_PARAMETER`: Required parameter not provided
- `SERVICE_UNAVAILABLE`: External service (Prometheus, Tempo, etc.) unavailable
- `TIMEOUT`: Operation timed out
- `AUTHENTICATION_ERROR`: API key or credential issues
- `RATE_LIMIT_EXCEEDED`: External API rate limit hit

All exceptions include context (query, model ID, etc.) for better debugging.

### Common Pitfalls & Troubleshooting

**Installation issues:**
- **"NAMESPACE is not set"**: Most Makefile targets require `NAMESPACE=<name>` parameter
- **Operator channel detection failed**: Cluster catalog may be unhealthy, check `oc get catalogsource -n openshift-marketplace`
- **LlamaStack operator on RHOAI 2.x**: Not supported, use `USE_LLAMA_STACK_OPERATOR=false` or upgrade to RHOAI 3.x
- **HuggingFace token prompt loops**: Set `LLM_URL` to skip local model deployment, or provide valid HF token

**Runtime issues:**
- **MCP server can't reach Prometheus**: Check ClusterRole binding `grafana-prometheus-reader`
- **Console Plugin not appearing**: Check plugin registration `oc get consoles.operator.openshift.io cluster -o yaml`
- **Tempo traces not found**: Ensure auto-instrumentation is enabled in target namespace
- **Loki logs unavailable**: Check LokiStack ClusterRole binding for collector ServiceAccount
- **GPU metrics not discovered**: Ensure DCGM exporter is running and metrics exposed

**Development issues:**
- **Port conflicts in local-dev.sh**: Another process using ports 9090, 8082, 3100, etc.
- **React UI 404 errors**: MCP server not running or wrong URL in `.env`
- **TypeScript build errors**: Run `yarn install` to update dependencies
- **Python import errors**: Run `uv sync` to update dependencies
- **Test failures after pull**: Metrics catalog or model config may have changed

**Performance issues:**
- **Slow trace analysis**: Reduce `TRACE_FETCH_SAFETY_FACTOR` or `MAX_NUM_TRACE_SPANS`
- **LLM timeout**: Increase `LLM_TIMEOUT_SECONDS` (default 180s may be too short for large models)
- **Prometheus query timeout**: Reduce time range or narrow down query scope

### Version Management
- Version defined in Makefile: `VERSION ?= 6.1.1`
- Semantic versioning enforced by CI/CD
- Script `scripts/verify-version-locks.sh` validates version consistency across Helm charts and operator manifests

### Debugging & Logging

**View logs in deployed cluster:**
```bash
# MCP Server logs
oc logs -n <namespace> deployment/aiobs-mcp-server -f

# Console Plugin logs
oc logs -n <namespace> deployment/aiobs-plugin -f

# React UI logs (DEV_MODE=true)
oc logs -n <namespace> deployment/aiobs-react-ui -f

# LlamaStack logs
oc logs -n <namespace> deployment/llamastack -f  # Helm mode
oc logs -n <namespace> deployment/<instance-name>-llamastack -f  # Operator mode

# vLLM InferenceService logs
oc logs -n <namespace> -l serving.kserve.io/inferenceservice=<model-name> -f

# Tempo operator logs
oc logs -n observability-hub -l app.kubernetes.io/name=tempo-operator -f

# Loki operator logs
oc logs -n openshift-logging -l app.kubernetes.io/name=loki-operator -f
```

**Python logging levels:**
- Set via `PYTHON_LOG_LEVEL` environment variable in MCP server
- Levels: DEBUG, INFO, WARNING, ERROR, CRITICAL
- Default: INFO
- Override in Helm: `--set env.PYTHON_LOG_LEVEL=DEBUG`

**Frontend debugging:**
- Console Plugin: Browser DevTools → Console (integrated in OpenShift Console)
- React UI: Browser DevTools → Console (standalone app)
- Network tab shows MCP server API calls

**MCP Server debugging:**
- Local testing: `obs-mcp-stdio` with MCP Inspector
- HTTP mode: `obs-mcp-http` then test at `http://localhost:8085`
- Use `--log-level debug` flag for verbose output

## Prerequisites & Requirements

### Cluster Requirements
- **OpenShift**: 4.18.33+ required
- **OpenShift AI (RHOAI)**: 2.16.2+ required
- **User permissions**: cluster-admin or equivalent privileges for:
  - Installing console plugins
  - Installing operators via OLM
  - Creating cluster-wide observability components
  - Managing RBAC

### Hardware Requirements
- **CPU**: 4 cores minimum (8 recommended)
- **Memory**: 8 GiB minimum (16 GiB recommended)
- **Storage**: 20 GiB minimum (50 GiB recommended)
- **GPU**: Optional (required only if RAG Stack enabled with local model deployment)

### Required CLI Tools
- `oc` - OpenShift CLI
- `helm` v3.x - Helm package manager
- `yq` - YAML processor
- `jq` - JSON processor (used by Makefile)
- `uv` - Python package manager (for local development)
- `yarn` - Node package manager (for frontend development)

### Container Registry
Default images are hosted on Quay.io. Override with Makefile variables:
```bash
REGISTRY=quay.io           # Container registry
ORG=ecosystem-appeng       # Organization/namespace
IMAGE_PREFIX=aiobs         # Image name prefix
VERSION=6.1.1              # Version tag
PLATFORM=linux/amd64       # Target platform

# Example: Use custom registry
make build REGISTRY=docker.io ORG=myorg VERSION=1.0.0
```

## Helper Scripts

The `scripts/` directory contains several utility scripts:

- **`local-dev.sh`**: Port-forward cluster dependencies for local development
  - Forwards: Prometheus (9090), Tempo (8082), Loki (3100), Korrel8r (9443), LlamaStack (8321)
  - Starts local React UI (3000) and Console Plugin (9001) dev servers
  - Usage: `./scripts/local-dev.sh -n <namespace>`

- **`operator-manager.sh`**: Unified script for operator installation/uninstall
  - Manages Cluster Observability, OpenTelemetry, Tempo, Logging, Loki operators
  - Auto-detects operator versions from cluster catalog

- **`enable-user-workload-monitoring.sh`**: Enables Prometheus user workload monitoring
  - Required for custom metrics and PrometheusRules
  - Enables Alertmanager for user workload

- **`check-observability-drift.sh`**: Validates deployed observability stack
  - Compares deployed manifests against reference configurations
  - Detects configuration drift

- **`generate-model-config.sh`**: Generates model configuration for MCP server
  - Combines local models with external model catalog
  - Creates JSON config consumed by MCP server

- **`verify-version-locks.sh`**: Validates version consistency
  - Checks Helm charts, operator manifests, Makefile
  - Enforces semantic versioning

- **`portforward-mcp-server.sh`**: Port-forward MCP server for local testing
  - Forwards MCP server to localhost:8085

## CI/CD & Release Process

### GitHub Actions Workflows
- **`build-and-push.yml`**: Automated image builds on push to main/dev
- **`build-operator-images.yml`**: Operator image builds
- **`create-release.yml`**: Automated release creation
- **`prepare-release.yml`**: Release preparation (version bumps, changelogs)
- **`update-versions.yml`**: Automated version updates across manifests
- **`run_tests.yml`**: Run test suite on PRs
- **`cleanup-old-images.yml`**: Automated cleanup of old container images

See `docs/GITHUB_ACTIONS.md` for detailed workflow documentation.

### Release Process
- Semantic versioning enforced (MAJOR.MINOR.PATCH)
- Version defined in Makefile `VERSION` variable
- Automated via `prepare-release.yml` workflow
- See `docs/RELEASE_PROCESS.md` and `docs/SEMANTIC_VERSIONING.md` for details

### Version Consistency
All version references must match across:
- `Makefile` (VERSION variable)
- Helm chart `Chart.yaml` files (version + appVersion)
- Operator bundle manifests
- Validated by `scripts/verify-version-locks.sh`

## Security Considerations

### API Key Storage

**Production Mode (`DEV_MODE=false`)**:
- API keys stored in Kubernetes Secrets (base64-encoded)
- Model configurations stored in ConfigMaps
- Requires RBAC permissions to read secrets
- Secrets managed via Helm charts

**Development Mode (`DEV_MODE=true`)**:
- API keys stored in browser `sessionStorage` (NOT localStorage)
- Cleared on tab close (ephemeral)
- No cluster resources modified
- Intended for local testing only, NOT production

### Secret Management
- HuggingFace tokens: Stored in secrets when RAG enabled
- External API keys: Stored per-provider in secrets
- MaaS API keys: Stored per-model in secrets
- Slack webhook URLs: Stored in alerting secret (if enabled)

### RBAC Requirements
- MCP Server: ClusterRole for Prometheus/Thanos access
- Console Plugin: ServiceAccount with console plugin permissions
- LokiStack: ClusterRole for log access (auto-created by Loki operator)

## Troubleshooting Resources

### Primary Documentation
- **General troubleshooting**: `docs/TROUBLESHOOTING.md`
- **Observability stack**: `docs/OBSERVABILITY_OVERVIEW.md`
- **Chatbot architecture**: `docs/CHATBOTS.md`
- **Development guide**: `docs/DEV_GUIDE.md`
- **Operator details**: `deploy/operator/README.md`, `docs/OPERATOR.md`

### Specialized Topics
- **Helm charts**: `docs/HELM_CHARTS.md` - Chart structure and customization
- **Model configuration**: `docs/MODEL-CONFIGURATION.md` - LLM provider setup
- **Metrics architecture**: `docs/METRICS_ARCHITECTURE.md` - Metrics catalog design
- **Korrel8r integration**: `docs/KORREL8R_INTEGRATION.md` - Signal correlation
- **vLLM metrics**: `docs/VLLM_METRICS_REFERENCE.md` - Model serving metrics
- **Intel Gaudi**: `docs/INTEL_GAUDI_METRICS.md` - HPU-specific metrics
- **GitHub Actions**: `docs/GITHUB_ACTIONS.md` - CI/CD workflows
- **Release process**: `docs/RELEASE_PROCESS.md` - Versioning and releases
- **Dependency locks**: `docs/DEPENDENCY_LOCK_SUMMARY.md` - Version pinning strategy

## Contributing

See `CONTRIBUTING.md` for contribution guidelines.

**Project maintainer**: @tsisodia10

**Trusted reviewers**: @sgahlot, @jianrongzhang89, @redhatHameed, @makon57

All PRs require approval from the code owner (@tsisodia10) before merging.

## Additional Context

### MCP Server Integration
This project implements a Model Context Protocol server that can be used with:
- **Claude Desktop** (stdio transport) - Configuration in `.cursor/mcp.json`
- **Cursor IDE** (stdio transport) - Same configuration as Claude Desktop
- **HTTP clients** (SSE transport on port 8000) - For web-based integrations

The MCP server exposes observability tools (query metrics, analyze traces, generate reports) as standardized MCP tools that AI assistants can invoke.

**Local development setup example** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "ai-observability": {
      "command": ".venv/bin/obs-mcp-stdio",
      "env": {
        "PROMETHEUS_URL": "http://localhost:9090",
        "LLAMA_STACK_URL": "http://localhost:8321/v1/openai/v1",
        "MODEL_CONFIG": "{...model config JSON...}"
      }
    }
  }
}
```

### Multi-Model Support
The system supports both local and external LLMs:

**Local Models** (deployed via RAG Stack):
- Deployed via LlamaStack + vLLM InferenceService (KServe)
- Requires GPU (VRAM varies by model)
- Supported: Llama 3.1/3.2/3.3 variants, Llama Guard
- Auto-configured service endpoints

**External Models** (API-based):
- **OpenAI**: GPT-4, GPT-3.5, etc. (requires OpenAI API key)
- **Anthropic**: Claude models (requires Anthropic API key)
- **Google**: Gemini models (requires Google API key)
- **Meta**: Llama via external endpoint (requires API key)
- **Model as a Service (MaaS)**: Red Hat-hosted models (per-model API keys)

**Configuration storage**:
- Production (`DEV_MODE=false`): Kubernetes ConfigMaps + Secrets
- Development (`DEV_MODE=true`): Browser sessionStorage (ephemeral)

See `docs/MODEL-CONFIGURATION.md` for detailed provider setup.

### Report Generation
Reports combine metric data, time-series charts, and AI analysis:
- **Formats**: HTML, PDF (via WeasyPrint), Markdown
- **Templates**: `src/core/report_assets/` (Jinja2 templates)
- **Charts**: Rendered server-side using matplotlib
- **Content**: Time-series data, metric summaries, AI-generated insights
- **Export**: Available via UI or MCP tool (`generate_report`)

### Metrics Catalog
The metrics catalog (`src/mcp_server/data/metrics_catalog.json`) is a curated, validated catalog of OpenShift and GPU metrics:
- **Static metrics**: Pre-defined OpenShift metrics (CPU, memory, network, storage)
- **Dynamic metrics**: GPU metrics discovered at runtime via `gpu_metrics_discovery.py`
- **Validation**: Catalog validator ensures schema compliance
- **Question templates**: Pre-defined natural language questions mapped to PromQL queries

When modifying the catalog, always run `pytest tests/core/test_catalog_validator.py` to validate changes.

### Port Forwarding (Local Development)
The `./scripts/local-dev.sh` script port-forwards these services:

| Service | Cluster Port | Local Port | Purpose |
|---------|--------------|------------|---------|
| Prometheus/Thanos | 9090 | 9090 | Metrics queries |
| Tempo | 8080 | 8082 | Trace queries |
| Loki | 8080 | 3100 | Log queries |
| Korrel8r | 9443 | 9443 | Signal correlation |
| LlamaStack | 8321 | 8321 | LLM inference |
| MCP Server | 8085 | 8085 | MCP protocol (optional) |
| React UI | N/A | 3000 | Dev server (local) |
| Console Plugin | N/A | 9001 | Dev server (local) |

The script also monitors port-forward health and auto-restarts failed connections.