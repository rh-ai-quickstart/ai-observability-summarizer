# Namespace Creation Hook

## Overview

This directory contains Helm hook templates that ensure required namespaces exist before the main chart resources are deployed.

## Problem Solved

The original approach used Helm's `lookup` function to conditionally create namespaces:

```yaml
{{- if not (lookup "v1" "Namespace" "" .Values.global.lokiNamespace) }}
  # create namespace
{{- end }}
```

**This doesn't work reliably in Helm-based operators** because:
- The Helm operator (v1.37.0) doesn't fully support `lookup` during reconciliation
- Templates are cached and `lookup` isn't re-evaluated on every reconcile
- `helm template` (dry-run mode) can't query live cluster state

## Solution: Pre-Install/Pre-Upgrade Hooks

Instead of relying on `lookup`, we use Helm hooks to create namespaces before installation:

### Files

1. **namespace-hook-rbac.yaml**
   - Creates ServiceAccount, ClusterRole, and ClusterRoleBinding
   - Hook weight: `-10` (runs first)
   - Grants permissions to check and create namespaces

2. **namespace-hook-job.yaml**
   - Runs a Job that checks each namespace and creates it if missing
   - Hook weight: `-5` (runs after RBAC is set up)
   - Uses `oc`/`kubectl` to check cluster state at runtime

### Namespaces Created

All three namespaces are created with `helm.sh/resource-policy: keep`:

1. **observability-hub** ({{ .Values.global.observabilityNamespace }})
   - Tempo, OTEL Collector, MinIO

2. **openshift-cluster-observability-operator** ({{ .Values.global.korrel8rNamespace }})
   - Korrel8r

3. **openshift-logging** ({{ .Values.global.lokiNamespace }})
   - LokiStack and log forwarding

## Hook Lifecycle

```
Pre-Install/Pre-Upgrade Phase:
  1. (-10) Create RBAC resources (ServiceAccount, ClusterRole, ClusterRoleBinding)
  2. (-5)  Run namespace creation job
  3. Job checks each namespace with `kubectl get namespace`
  4. Job creates missing namespaces with `kubectl apply`
  5. Job completes successfully

Main Installation Phase:
  - Deploy all chart resources (Tempo, Loki, OTEL, etc.)

Post-Install/Post-Upgrade Phase:
  - Hook resources are deleted (hook-delete-policy: hook-succeeded)
```

## Benefits

- ✅ Works reliably in Helm operators
- ✅ Checks actual cluster state at runtime
- ✅ Idempotent - safe to run multiple times
- ✅ Clear visibility - Job logs show what was created
- ✅ Handles all three namespaces consistently

## Troubleshooting

### Check hook job logs

```bash
# Find the job
kubectl get jobs -n ai-observability | grep namespace-setup

# View job logs
kubectl logs job/<job-name> -n ai-observability
```

### Expected output

```
=== AI Observability Namespace Setup Hook ===
Ensuring required namespaces exist...

Checking namespace: observability-hub
✓ Namespace 'observability-hub' already exists

Checking namespace: openshift-cluster-observability-operator
✓ Namespace 'openshift-cluster-observability-operator' already exists

Checking namespace: openshift-logging
✗ Namespace 'openshift-logging' does not exist, creating...
✓ Namespace 'openshift-logging' created successfully

=== Namespace setup completed successfully ===
```

### Hook job fails

If the hook job fails, check:
1. ServiceAccount permissions: `kubectl get clusterrolebinding | grep namespace-hook`
2. Image pull permissions: The job uses `registry.redhat.io/openshift4/ose-cli:latest`
3. Network policies: Ensure the job pod can reach the Kubernetes API

## Migration from Old Approach

The old `00-namespaces.yaml` template has been removed and replaced with this hook-based approach. No configuration changes are needed - the same namespace values are used.
