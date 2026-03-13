# AI Observability Summarizer — Umbrella Helm Chart

## Overview

This is an **umbrella Helm chart** that deploys the full AI Observability Summarizer stack in a single `helm install`. It wraps all existing sub-charts as dependencies, with toggles to enable/disable each component.

**Operators are NOT installed by this chart.** The platform team is expected to pre-install:
- Cluster Observability Operator
- Red Hat build of OpenTelemetry Operator
- Tempo Operator
- Red Hat OpenShift Logging Operator
- Loki Operator

---

## Quick Start

```bash
# Build dependencies (first time / after Chart.yaml changes)
cd deploy/helm/ai-observability-summarizer
helm dependency build

# Deploy everything
helm install aiobs . -n openshift-ai-observability --create-namespace

# Deploy with custom overrides
helm install aiobs . -n openshift-ai-observability -f values-custom.yaml

# Upgrade after changes
helm upgrade aiobs . -n openshift-ai-observability

# Uninstall
helm uninstall aiobs -n openshift-ai-observability
```

---

## What Gets Deployed

### Resource Summary (defaults)

| Resource Type | Count |
|---|---|
| ClusterRoleBinding | 15 |
| ServiceAccount | 9 |
| ConfigMap | 9 |
| ClusterRole | 9 |
| Service | 8 |
| Route | 8 |
| Secret | 7 |
| Deployment | 6 |
| Job | 4 |
| UIPlugin | 2 |
| StatefulSet | 2 |
| TempoStack | 1 |
| RoleBinding | 1 |
| Role | 1 |
| PersistentVolumeClaim | 1 |
| OpenTelemetryCollector | 1 |
| Namespace | 1 |
| LokiStack | 1 |
| Instrumentation | 1 |
| ConsolePlugin | 1 |
| ClusterLogForwarder | 1 |
| **Total** | **89** |

### Sub-Charts Included

| Sub-Chart | Alias | Default | Namespace | What It Deploys |
|---|---|---|---|---|
| `minio-observability-storage` | `minio` | enabled | `observability-hub` | MinIO object storage (Tempo traces + Loki logs backend) |
| `tempo-stack` | `tempo` | enabled | `observability-hub` | TempoStack CR, RBAC, UIPlugin |
| `otel-collector` | `otelCollector` | enabled | `observability-hub` | OpenTelemetryCollector CR, RBAC |
| `loki-stack` | `loki` | enabled | `openshift-logging` | LokiStack CR, ClusterLogForwarder, UIPlugin |
| `korrel8r` | `korrel8r` | enabled | `openshift-cluster-observability-operator` | Korrel8r deployment, service, route |
| `mcp-server` | `mcpServer` | enabled | release namespace | MCP Server deployment, service, route, RBAC |
| `ui` | `metricUi` | enabled | release namespace | Streamlit Metric UI deployment |
| `openshift-console-plugin` | `consolePlugin` | enabled | release namespace | Console Plugin deployment, ConsolePlugin CR, patcher job |
| `openshift-aiobs-react-ui` | `reactUi` | **disabled** | release namespace | Standalone React UI (dev/demo alternative) |
| `alerts` | `alerts` | **disabled** | release namespace | PrometheusRule, CronJob alerting |
| `rag` | `rag` | **disabled** | release namespace | llm-service, llama-stack, pgvector |

### Umbrella-Only Templates (not from sub-charts)

| Template | What It Does |
|---|---|
| `cluster-monitoring-config.yaml` | Enables User Workload Monitoring (`enableUserWorkload: true`) |
| `user-workload-monitoring-config.yaml` | Enables Alertmanager for UWM |
| `tracing-namespace.yaml` | Creates app namespace with OTel auto-instrumentation annotation |
| `instrumentation.yaml` | Python auto-instrumentation CR (OTel SDK injection) |
| `console-plugin-enablement.yaml` | Post-install Jobs to enable tracing + logging console plugins |
| `console-patcher-rbac.yaml` | ServiceAccount + RBAC for console plugin patcher jobs |

---

## Component Toggles

Each sub-chart can be toggled independently:

```yaml
minio:
  enabled: true         # MinIO object storage
tempo:
  enabled: true         # TempoStack (distributed tracing)
otelCollector:
  enabled: true         # OpenTelemetry Collector
loki:
  enabled: true         # LokiStack (log aggregation)
korrel8r:
  enabled: true         # Korrel8r (signal correlation)
mcpServer:
  enabled: true         # MCP Server (AI observability backend)
metricUi:
  enabled: true         # Streamlit Metric UI
consolePlugin:
  enabled: true         # OpenShift Console Plugin
reactUi:
  enabled: false        # Standalone React UI (dev/demo)
alerting:
  enabled: false        # Alerting (requires Slack secret)
rag:
  enabled: false        # RAG backend (requires GPU + HF token)
```

**Example: deploy only app components (observability stack already exists):**

```bash
helm install aiobs . -n openshift-ai-observability \
  --set minio.enabled=false \
  --set tempo.enabled=false \
  --set otelCollector.enabled=false \
  --set loki.enabled=false \
  --set clusterMonitoring.enableUserWorkloadMonitoring=false \
  --set clusterMonitoring.enableAlertmanagerForUWM=false
```

---

## `make install` vs `helm install` Comparison

| # | `make install` Step | Umbrella Chart | Status |
|---|---|---|---|
| 1 | `namespace` (create app namespace) | `--create-namespace` flag + `tracing-namespace.yaml` | COVERED |
| 2 | `enable-user-workload-monitoring` (patch ConfigMaps) | `cluster-monitoring-config.yaml` + `user-workload-monitoring-config.yaml` | COVERED |
| 3 | `depend` (helm dependency update rag, minio) | `helm dependency build` before install | COVERED |
| 4 | `validate-llm` (check LLM config) | N/A — imperative pre-flight check, not a K8s resource | INTENTIONAL SKIP |
| 5 | `install-operators` (5 OLM operators) | N/A — platform team handles this | INTENTIONAL SKIP |
| 6a | `install-minio` (MinIO in observability-hub) | `minio` sub-chart | COVERED |
| 6b | `setup-tracing` (Instrumentation CR + ns annotation) | `instrumentation.yaml` + `tracing-namespace.yaml` | COVERED |
| 6c | `install-observability` (Tempo) | `tempo` sub-chart | COVERED |
| 6c | `install-observability` (OTel Collector) | `otelCollector` sub-chart | COVERED |
| 6c | `install-observability` (Loki) | `loki` sub-chart | COVERED |
| 6d | `check-observability-drift` (drift script) | N/A — imperative runtime check, not a resource | INTENTIONAL SKIP |
| 6e | `enable-tracing-ui` (console patch) | `console-plugin-enablement.yaml` (post-install Job) | COVERED |
| -- | `enable-logging-ui` (console patch) | `console-plugin-enablement.yaml` (post-install Job) | COVERED |
| 7 | `install-metric-ui` (Streamlit UI) | `metricUi` sub-chart | COVERED |
| 8 | `install-mcp-server` (MCP Server) | `mcpServer` sub-chart | COVERED |
| 9 | `delete-jobs` (cleanup old jobs) | N/A — only needed for re-installs, not fresh deploy | INTENTIONAL SKIP |
| 10 | `install-console-plugin` (Console Plugin) | `consolePlugin` sub-chart | COVERED |
| 10 | `install-react-ui` (if DEV_MODE=true) | `reactUi` sub-chart (disabled by default) | COVERED |
| 11 | `install-korrel8r` (Korrel8r) | `korrel8r` sub-chart | COVERED |
| 12 | `install-rag` (unless ENABLE_RAG=false) | `rag` sub-chart (default: disabled) | COVERED |
| 13 | `install-alerts` (if ALERTS=TRUE) | `alerts` sub-chart (default: disabled) | COVERED |

### Intentionally Skipped Steps

| Step | Why Not in Helm Chart |
|---|---|
| `validate-llm` | Imperative pre-flight check — validates LLM endpoint is reachable. Not a K8s resource. |
| `install-operators` | Platform team responsibility. Operators are a prerequisite, not part of this chart. |
| `check-observability-drift` | Imperative runtime script — compares deployed state vs chart values. Not declarative. |
| `delete-jobs` | Imperative cleanup of completed Jobs. Only needed during re-installs with the Makefile. |

---

## Namespace Mapping

The umbrella chart deploys resources across multiple namespaces. Each sub-chart targets its own namespace via `global.namespace` or hardcoded namespace in templates.

| Namespace | Components |
|---|---|
| `openshift-ai-observability` (release namespace) | MCP Server, Metric UI, Console Plugin, React UI, Alerting, RAG |
| `observability-hub` | MinIO, TempoStack, OTel Collector |
| `openshift-logging` | LokiStack, ClusterLogForwarder |
| `openshift-cluster-observability-operator` | Korrel8r |
| `openshift-monitoring` | cluster-monitoring-config ConfigMap |
| `openshift-user-workload-monitoring` | user-workload-monitoring-config ConfigMap |

---

## Deployment Methods

### 1. Helm CLI (single command)

```bash
helm dependency build deploy/helm/ai-observability-summarizer/
helm install aiobs deploy/helm/ai-observability-summarizer/ \
  -n openshift-ai-observability --create-namespace
```

### 2. ArgoCD (single Application)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ai-observability-summarizer
  namespace: openshift-gitops
spec:
  project: default
  source:
    repoURL: https://github.com/YOUR_ORG/ai-observability-summarizer.git
    targetRevision: main
    path: deploy/helm/ai-observability-summarizer
    helm:
      valueFiles:
        - values.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: openshift-ai-observability
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
      - SkipDryRunOnMissingResource=true
```

### 3. RH Demo Platform (packaged chart)

```bash
# Package for distribution
cd deploy/helm/ai-observability-summarizer
helm dependency build
helm package .
# Produces: ai-observability-summarizer-1.0.0.tgz

# Push to OCI registry (optional)
helm push ai-observability-summarizer-1.0.0.tgz oci://quay.io/ecosystem-appeng

# Consumer installs with:
helm install aiobs oci://quay.io/ecosystem-appeng/ai-observability-summarizer \
  --version 1.0.0 -n openshift-ai-observability --create-namespace
```

### 4. Makefile (backward compatible)

```bash
# Existing individual targets still work:
make install NAMESPACE=openshift-ai-observability

# New umbrella target:
make helm-install NAMESPACE=openshift-ai-observability
```

---

## Prerequisites

Before deploying, ensure the following operators are installed and healthy:

| Operator | Provides CRDs |
|---|---|
| Cluster Observability Operator | `monitoring.rhobs`, `observability.openshift.io` |
| Red Hat build of OpenTelemetry | `opentelemetry.io` (Instrumentation, OpenTelemetryCollector) |
| Tempo Operator | `tempo.grafana.com` (TempoStack) |
| Red Hat OpenShift Logging | `logging.openshift.io` (ClusterLogForwarder) |
| Loki Operator | `loki.grafana.com` (LokiStack) |

---

## Files

```
deploy/helm/ai-observability-summarizer/
  Chart.yaml                                      # Dependencies on all sub-charts
  values.yaml                                     # Master config with toggles
  .helmignore                                     # Excluded files
  UMBRELLA-CHART.md                               # This document
  templates/
    cluster-monitoring-config.yaml                # UWM enablement
    user-workload-monitoring-config.yaml          # Alertmanager for UWM
    tracing-namespace.yaml                        # Namespace with OTel injection
    instrumentation.yaml                          # Python auto-instrumentation CR
    console-plugin-enablement.yaml                # Post-install Jobs (tracing + logging plugins)
    console-patcher-rbac.yaml                     # RBAC for console patcher jobs
  charts/                                         # Auto-populated by helm dependency build
```
