# AI Observability Summarizer Operator

A Helm-based Kubernetes Operator for deploying the AI Observability Summarizer stack on OpenShift with full OLM (Operator Lifecycle Manager) support.

## Overview

This operator provides a single Custom Resource (`AIObservabilitySummarizer`) to deploy the complete AI-powered observability stack. Built with `operator-sdk` using the Helm operator pattern, it wraps existing Helm charts without custom Go code.

### Components Deployed

**Always Installed:**
- **MCP Server**: Model Context Protocol server for AI-driven observability queries (with TLS)
- **OpenShift Console Plugin**: Native integration with OpenShift Console

**RAG Stack (Always Enabled):**
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

## Prerequisites

- OpenShift 4.12+
- Cluster admin access
- GPU node (for LLM deployment)

### Required Operators (Auto-Installed by OLM)

These operators are declared as OLM dependencies and will be **automatically installed** when this operator is installed:

| Operator | Required API | Auto-Installed |
|----------|--------------|----------------|
| **Cluster Observability Operator** | `UIPlugin` | ✅ Yes |
| **OpenTelemetry Operator** | `OpenTelemetryCollector` | ✅ Yes |
| **Tempo Operator** | `TempoStack` | ✅ Yes |
| **Loki Operator** | `LokiStack` | ✅ Yes |

OLM automatically resolves and installs operators that provide these APIs from the catalog.

> **Note:** OpenShift AI (RHOAI) for KServe/InferenceService is NOT auto-installed and must be installed separately if using local LLM deployment.

## Installation

### From OperatorHub (Recommended)

1. Open OpenShift Console
2. Navigate to **Operators → OperatorHub**
3. Search for "AI Observability Summarizer"
4. Click **Install**
5. **Suggested namespace:** `ai-observability`
6. Click **Install**

### Quick Install via Catalog Source

If the operator is not yet published to OperatorHub, apply the catalog source directly:

```bash
# 1. Apply the catalog source
oc apply -f deploy/operator/catalog-source.yaml

# 2. Wait for catalog to be ready
oc get catalogsource aiobs-operator-catalog -n openshift-marketplace -w

# 3. Install via OperatorHub UI or create subscription:
oc apply -f - <<EOF
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: aiobs-operator
  namespace: ai-observability
spec:
  channel: alpha
  name: aiobs-operator
  source: aiobs-operator-catalog
  sourceNamespace: openshift-marketplace
  installPlanApproval: Automatic
EOF
```

### Using Deployment Script

```bash
# Full build and deploy
./scripts/operator-deploy.sh full

# Or step by step:
./scripts/operator-deploy.sh build    # Build images
./scripts/operator-deploy.sh push     # Push to registry
./scripts/operator-deploy.sh deploy   # Deploy to cluster
```

### Manual Installation

```bash
cd deploy/operator

# Build and push operator image
make docker-build docker-push IMG=quay.io/ecosystem-appeng/aiobs-operator:v0.0.1

# Generate and push bundle
make bundle bundle-build bundle-push BUNDLE_IMG=quay.io/ecosystem-appeng/aiobs-operator-bundle:v0.0.1

# Build and push catalog
make catalog-build catalog-push CATALOG_IMG=quay.io/ecosystem-appeng/aiobs-operator-catalog:v0.0.1
```

## Usage

### Create an AIObservabilitySummarizer Instance

**Recommended:** Create the CR in the `ai-observability` namespace.

#### Via OpenShift Console (OLM UI)

1. Navigate to **Operators → Installed Operators → AI Observability Summarizer**
2. Click **Create AIObservabilitySummarizer**
3. Fill in the form:
   - **HuggingFace Token** (required): Your HF token for model download
   - **Device Type**: `gpu`, `hpu`, `gpu-amd`, or `cpu`
   - **Model Selection**: Choose LLM model (default: Llama 3.1 8B)
   - **Enable Alert Analysis**: Toggle for alert summarization
   - **Enable Korrel8r**: Toggle for signal correlation
4. Click **Create**

#### Via YAML

```yaml
apiVersion: aiobs.rh-ai-quickstart.io/v1alpha1
kind: AIObservabilitySummarizer
metadata:
  name: cluster-ai-observability
  namespace: ai-observability
spec:
  # RAG/LLM Configuration (required)
  aiobs-app:
    rag:
      enabled: true
      global:
        models:
          llama-3-1-8b-instruct:
            enabled: true    # Recommended model
      llm-service:
        device: gpu          # gpu | hpu | gpu-amd | cpu
        secret:
          hf_token: "hf_xxx" # Your HuggingFace token (required)
    
    # Optional: Alert Analysis
    alerting:
      enabled: false

  # Infrastructure
  infrastructure:
    enabled: true
  
  aiobs-infra:
    korrel8r:
      enabled: true          # Signal correlation
```

```bash
oc apply -f config/samples/aiobs_v1alpha1_aiobservabilitysummarizer.yaml
```

### Check Status

```bash
# Get CR status
oc get aiobservabilitysummarizer -n ai-observability

# Check deployed pods
oc get pods -n ai-observability

# Check operator logs
oc logs -n ai-observability deployment/aiobs-operator-controller-manager
```

## Configuration Reference

### OLM UI Fields

| Field | Path | Default | Description |
|-------|------|---------|-------------|
| HuggingFace Token | `aiobs-app.rag.llm-service.secret.hf_token` | *required* | Token for model download |
| Device Type | `aiobs-app.rag.llm-service.device` | `gpu` | Hardware accelerator type |
| Llama 3.1 8B | `aiobs-app.rag.global.models.llama-3-1-8b-instruct.enabled` | `true` | Recommended model (16GB VRAM) |
| Llama 3.2 1B | `aiobs-app.rag.global.models.llama-3-2-1b-instruct.enabled` | `false` | Smallest model (2GB VRAM) |
| Llama 3.2 3B | `aiobs-app.rag.global.models.llama-3-2-3b-instruct.enabled` | `false` | Small model (6GB VRAM) |
| Llama 3.3 70B | `aiobs-app.rag.global.models.llama-3-3-70b-instruct.enabled` | `false` | Largest model (4 GPUs) |
| Alert Analysis | `aiobs-app.alerting.enabled` | `false` | Enable alert summarization |
| Korrel8r | `aiobs-infra.korrel8r.enabled` | `true` | Enable signal correlation |

### Infrastructure Handling

The operator uses Helm `lookup` to detect existing infrastructure:
- **MinIO**: Installed in `observability-hub` if not present
- **TempoStack**: Skipped if already exists in `observability-hub`
- **OTEL Collector**: Skipped if already exists in `observability-hub`
- **Korrel8r**: Installed in `openshift-cluster-observability-operator`

## Development

### Project Structure

```
deploy/operator/
├── Dockerfile              # Operator image
├── Makefile                # Build targets
├── PROJECT                 # Operator SDK project config
├── watches.yaml            # Helm chart to CR mapping
├── catalog-source.yaml     # CatalogSource for OLM installation
├── helm-charts/            # Helm charts (copied during build)
├── config/
│   ├── crd/                # Custom Resource Definition
│   ├── manager/            # Operator deployment (memory: 2Gi)
│   ├── rbac/               # RBAC permissions
│   ├── samples/            # Example CRs
│   └── manifests/          # OLM manifests base
└── bundle/                 # OLM bundle for OperatorHub
    ├── manifests/          # CSV, CRD
    ├── metadata/           # Annotations
    └── tests/              # Scorecard tests
```

### Build Commands

```bash
# Update Helm dependencies
cd deploy/helm && helm dependency update aiobs-stack

# Build operator image
make docker-build IMG=quay.io/ecosystem-appeng/aiobs-operator:v0.0.1

# Generate bundle manifests
make bundle

# Build bundle image
make bundle-build BUNDLE_IMG=quay.io/ecosystem-appeng/aiobs-operator-bundle:v0.0.1

# Build catalog image
make catalog-build CATALOG_IMG=quay.io/ecosystem-appeng/aiobs-operator-catalog:v0.0.1
```

### Run Locally (Development)

```bash
make install   # Install CRDs
make run       # Run operator locally (watches all namespaces)
```

### Test Bundle

```bash
operator-sdk run bundle quay.io/ecosystem-appeng/aiobs-operator-bundle:v0.0.1
```

## Troubleshooting

### Operator OOMKilled
The operator requires 2Gi memory. Check `config/manager/manager.yaml` for resource limits.

### MinIO Buckets Not Created
The bucket-init job runs as a Helm hook. Check:
```bash
oc get jobs -n observability-hub
oc logs -n observability-hub job/minio-observability-storage-bucket-init
```

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

## Deployment Script

The `scripts/operator-deploy.sh` script automates the complete workflow:

```bash
./scripts/operator-deploy.sh <command>

Commands:
  build      - Build operator, bundle, and catalog images
  push       - Push all images to registry
  deploy     - Deploy catalog source and install operator
  cleanup    - Remove all operator resources
  reinstall  - Cleanup and redeploy (full refresh)
  status     - Check operator status
  full       - Build, push, cleanup, and deploy
```

## License

Apache License 2.0
