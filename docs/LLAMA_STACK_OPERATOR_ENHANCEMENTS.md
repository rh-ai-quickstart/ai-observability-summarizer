# LlamaStack Operator Mode Enhancements

## Overview

This document describes the enhancements made to support deploying LlamaStack with the operator in a managed mode (`managedByOperator=true`) using the enhanced ai-architecture-chart.

## Changes Summary

### 1. Chart Dependencies (deploy/helm/rag/Chart.yaml)

- Updated `llama-stack` dependency to use enhanced chart from operator branch
- Repository changed to: `file://.llama-stack-operator-chart`
- Source: https://github.com/jianrongzhang89/ai-architecture-charts/tree/operator/llama-stack
- **Note**: This is temporary until the operator branch is merged and released

### 2. Makefile Enhancements

#### A. Enhanced `depend` Target
- Automatically fetches the enhanced llama-stack chart from git operator branch
- Clones to `deploy/helm/rag/.llama-stack-operator-chart/` (gitignored)
- Updates on subsequent runs via `git pull`

#### B. Enhanced `helm_llama_stack_args`
When `USE_LLAMA_STACK_OPERATOR=true`, now passes:
```makefile
--set llama-stack.useByOperator=true
--set llama-stack.network.allowedFrom.labels='ai-observability-summarizer/lls-allowed'
```

#### C. Enhanced `namespace` Target
- Auto-labels namespace with `ai-observability-summarizer/lls-allowed=true` when `USE_LLAMA_STACK_OPERATOR=true`
- This label enables network access control for operator-managed LlamaStack instances

#### D. Updated Help Documentation
- Updated help text for `install-rag` and `USE_LLAMA_STACK_OPERATOR` to document new behavior

### 3. Values Documentation (deploy/helm/rag/values.yaml)

Added documentation explaining:
- The new `useByOperator` parameter
- Network policy label selector configuration
- Auto-labeling behavior for namespaces

### 4. Gitignore (.gitignore)

Added entry to ignore the temporary operator chart directory:
```
deploy/helm/rag/.llama-stack-operator-chart/
```

## Usage

### Deploying with Operator Mode

```bash
# Set RHOAI version to 3 and enable operator mode
make install NAMESPACE=my-namespace RHOAI_VERSION=3 USE_LLAMA_STACK_OPERATOR=true

# The following will happen automatically:
# 1. Enhanced llama-stack chart is fetched from git operator branch
# 2. Namespace is labeled with 'ai-observability-summarizer/lls-allowed=true'
# 3. RAG chart is deployed with useByOperator=true and network access control labels
```

### Dependency Management

```bash
# Update all helm dependencies (including fetching operator chart)
make depend

# This will:
# 1. Clone/update the operator branch chart to deploy/helm/rag/.llama-stack-operator-chart/
# 2. Run helm dependency update for all charts
```

## Network Access Control

When deployed with operator mode:

1. **Namespace Labeling**: The deployment namespace gets labeled with `ai-observability-summarizer/lls-allowed=true`

2. **Network Policy**: The enhanced ai-architecture-chart creates NetworkPolicy rules that allow:
   - Pods in namespaces with the label `ai-observability-summarizer/lls-allowed=true`
   - To access the operator-managed LlamaStack service

3. **Service Access**: This enables the MCP server, alerting services, and other components in the same namespace to communicate with LlamaStack

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Namespace: my-namespace                                     │
│ Label: ai-observability-summarizer/lls-allowed=true        │
│                                                             │
│  ┌──────────────┐      ┌─────────────────────────┐        │
│  │ MCP Server   │─────>│ LlamaStack Service      │        │
│  └──────────────┘      │ (Operator-managed)      │        │
│                        │                         │        │
│  ┌──────────────┐      │ NetworkPolicy allows:   │        │
│  │ Alerting     │─────>│ - Labeled namespaces    │        │
│  └──────────────┘      └─────────────────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Parameters Reference

### New Parameters Passed to ai-architecture-chart

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `llama-stack.useByOperator` | `true` | Signals operator-compatible mode |
| `llama-stack.network.allowedFrom.labels` | `ai-observability-summarizer/lls-allowed` | Label selector for network access |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_LLAMA_STACK_OPERATOR` | `false` | Enable operator mode (requires RHOAI 3.x) |
| `RHOAI_VERSION` | Auto-detected | RHOAI version (2 or 3) |

## Migration Notes

### From Helm Chart to Operator Mode

When migrating from Helm chart mode to operator mode:

1. The namespace will be automatically labeled
2. Service name changes from `llamastack` to `llamastack-service`
3. Network policies are automatically configured
4. No manual intervention required - handled by the Makefile

### When Operator Branch is Merged

Once the operator branch is merged and released:

1. Update `deploy/helm/rag/Chart.yaml`:
   ```yaml
   - name: llama-stack
     version: 0.5.4  # or whatever the new version is
     repository: https://rh-ai-quickstart.github.io/ai-architecture-charts
     condition: llama-stack.enabled
   ```

2. Remove the git fetch logic from Makefile `depend` target

3. Remove `.llama-stack-operator-chart/` from .gitignore

## Troubleshooting

### Chart Fetch Fails

If the operator chart fetch fails:
```bash
# Manually clean and re-fetch
rm -rf deploy/helm/rag/.llama-stack-operator-chart
make depend
```

### Namespace Not Labeled

If the namespace doesn't have the label:
```bash
# Manually apply the label
oc label namespace <NAMESPACE> ai-observability-summarizer/lls-allowed=true
```

### Network Policy Issues

Check if the NetworkPolicy exists:
```bash
oc get networkpolicy -n <NAMESPACE>
```

Verify namespace label:
```bash
oc get namespace <NAMESPACE> --show-labels | grep lls-allowed
```

## References

- Enhanced ai-architecture-chart: https://github.com/jianrongzhang89/ai-architecture-charts/tree/operator/llama-stack
- Original ai-architecture-charts: https://github.com/rh-ai-quickstart/ai-architecture-charts
- LlamaStack Operator Documentation: [RHOAI Documentation]
