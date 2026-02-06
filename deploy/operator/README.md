# AI Observability Summarizer Operator

A Helm-based Kubernetes Operator for deploying the AI Observability Summarizer stack on OpenShift with full OLM (Operator Lifecycle Manager) support.

## Overview

This operator provides a single Custom Resource (`AIObservabilitySummarizer`) to deploy the complete AI-powered observability stack. Built with `operator-sdk` using the Helm operator pattern, it wraps existing Helm charts without custom Go code.

### Components Deployed

**Always Installed:**
- **MCP Server**: Model Context Protocol server for AI-driven observability queries (with TLS)
- **OpenShift Console Plugin**: Native integration with OpenShift Console

**RAG Stack (When Enabled):**
- **LLM Service**: KServe InferenceService with vLLM for local model deployment
- **LlamaStack**: LLM orchestration layer
- **PGVector**: Vector database for RAG

**Optional Features:**
- **Alerting**: Automated alert analysis and summarization (CronJob) - *disabled by default*
- **Korrel8r**: Signal correlation for metrics, logs, and traces - *enabled by default*

**Infrastructure (if not already present):**
- **MinIO**: Object storage for Tempo/Loki
- **TempoStack**: Distributed tracing backend
- **OTEL Collector**: OpenTelemetry trace collection
- **LokiStack**: Log aggregation

## Prerequisites

- OpenShift 4.12+
- Cluster admin access
- GPU node (for LLM deployment with RAG enabled)

### Automatic Configuration

The operator automatically configures the following cluster-level settings:

- **User Workload Monitoring**: Enables `enableUserWorkload: true` in the `cluster-monitoring-config` ConfigMap (required for PrometheusRules and alerting)
  - Checks if already enabled before applying (idempotent)
  - Skips if user workload monitoring is already configured

### Required Operators (Auto-Installed by OLM)

These operators are declared as OLM dependencies and will be **automatically installed** when this operator is installed:

| Operator | Required API | Auto-Installed |
|----------|--------------|----------------|
| **Cluster Observability Operator** | `UIPlugin`, `Korrel8r` | ✅ Yes |
| **OpenTelemetry Operator** | `OpenTelemetryCollector` | ✅ Yes |
| **Tempo Operator** | `TempoStack` | ✅ Yes |
| **Loki Operator** | `LokiStack` | ✅ Yes |
| **Cluster Logging Operator** | `ClusterLogForwarder` | ✅ Yes |

> **Note:** OpenShift AI (RHOAI) for KServe/InferenceService is NOT auto-installed and must be installed separately if using RAG with local LLM deployment.

## Installation

### Step 1: Create Namespace

```bash
oc new-project ai-observability
```

### Step 2: Apply Catalog Source

```bash
oc apply -f deploy/operator/catalog-source.yaml

# Wait for catalog to be ready
oc get catalogsource aiobs-operator-catalog -n openshift-marketplace -w
```

### Step 3: Install via OpenShift Console

1. Open **OpenShift Console**
2. Navigate to **Operators → OperatorHub**
3. Search for **"AI Observability"**
4. Click **Install**
5. Select **ai-observability** namespace
6. Click **Install**

### Step 4: Create AIObservabilitySummarizer

1. Navigate to **Operators → Installed Operators → AI Observability Summarizer**
2. Click **Create AIObservabilitySummarizer**
3. Fill in the form:
   - **HuggingFace Token** (required for RAG): Your HF token for model download
   - **Device Type**: `gpu`, `hpu`, `gpu-amd`, or `cpu`
   - **Model Selection**: Choose LLM model (default: Llama 3.1 8B)
   - **Enable Alert Analysis**: Toggle for alert summarization
   - **Enable Korrel8r**: Toggle for signal correlation
4. Click **Create**

## Uninstallation

### Via OpenShift Console

1. **Delete the CR:**
   - Go to **Operators → Installed Operators → AI Observability Summarizer**
   - Click on **AIObservabilitySummarizer** tab
   - Delete the CR instance

2. **Uninstall the Operator:**
   - Go to **Operators → Installed Operators**
   - Find **AI Observability Summarizer**
   - Click **⋮ → Uninstall Operator**

3. **Delete the Catalog Source:**
   - Go to **Administration → CustomResourceDefinitions**
   - Search for **CatalogSource**
   - Find `aiobs-operator-catalog` in `openshift-marketplace`
   - Delete it

Or via CLI:
```bash
oc delete aiobservabilitysummarizer --all -n ai-observability
oc delete subscription aiobs-operator -n ai-observability
oc delete csv -l operators.coreos.com/aiobs-operator.ai-observability -n ai-observability
oc delete catalogsource aiobs-operator-catalog -n openshift-marketplace
```

## Configuration Reference

| Field | Path | Default | Description |
|-------|------|---------|-------------|
| HuggingFace Token | `rag.llm-service.secret.hf_token` | *required* | Token for model download |
| Device Type | `rag.llm-service.device` | `gpu` | Hardware accelerator type |
| Llama 3.1 8B | `rag.global.models.llama-3-1-8b-instruct.enabled` | `true` | Recommended model (16GB VRAM) |
| Llama 3.2 1B | `rag.global.models.llama-3-2-1b-instruct.enabled` | `false` | Smallest model (2GB VRAM) |
| Llama 3.2 3B | `rag.global.models.llama-3-2-3b-instruct.enabled` | `false` | Small model (6GB VRAM) |
| Llama 3.3 70B | `rag.global.models.llama-3-3-70b-instruct.enabled` | `false` | Largest model (4 GPUs) |
| Alert Analysis | `alerting.enabled` | `false` | Enable alert summarization |
| Korrel8r | `korrel8r.enabled` | `true` | Enable signal correlation |

## Development

### Building Operator Images

Use the root Makefile for consistent builds:

```bash
# Show current configuration
make operator-config

# Build and push all images (in correct order)
make operator-build operator-push \
     operator-bundle-build operator-bundle-push \
     operator-catalog-build operator-catalog-push

# Or with custom version/registry
make operator-build operator-push VERSION=1.0.8 ORG=myorg
```

### Project Structure

```
deploy/operator/
├── Dockerfile              # Operator image
├── Makefile                # Build targets
├── PROJECT                 # Operator SDK project config
├── watches.yaml            # Helm chart to CR mapping
├── catalog-source.yaml     # CatalogSource for OLM installation
├── config/
│   ├── crd/                # Custom Resource Definition
│   ├── manager/            # Operator deployment
│   ├── rbac/               # RBAC permissions
│   ├── samples/            # Example CRs
│   └── manifests/          # OLM manifests base
└── bundle/                 # OLM bundle for OperatorHub
    ├── manifests/          # CSV, CRD
    ├── metadata/           # Annotations
    └── tests/              # Scorecard tests
```

### Run Locally (Development)

```bash
cd deploy/operator
make install   # Install CRDs
make run       # Run operator locally
```

## Troubleshooting

### Operator OOMKilled
The operator requires 2Gi memory. Check `config/manager/manager.yaml` for resource limits.

### Namespaces Already Exist
The operator uses Helm `lookup` to skip creating namespaces that already exist. If you see ownership errors, the namespace may have been created by another operator.

### LLM Model Not Loading
Ensure HuggingFace token is valid and has access to the model:
```bash
oc logs -n ai-observability deployment/llama-3-1-8b-instruct-predictor
```

### Console Plugin Not Showing
Check if plugin is enabled:
```bash
oc get consoleplugin openshift-ai-observability
oc get console.operator.openshift.io cluster -o jsonpath='{.spec.plugins}'
```

### Check Operator Logs
```bash
oc logs -n ai-observability -l control-plane=controller-manager -f
```

## Validation Rules

The operator enforces these rules:
1. **Namespace**: CR must be created in `ai-observability` namespace
2. **Singleton**: Only one CR allowed per cluster
3. **HuggingFace Token**: Required when RAG is enabled

## License

Apache License 2.0
