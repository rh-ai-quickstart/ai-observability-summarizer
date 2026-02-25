# Troubleshooting Guide

This document provides solutions to common issues encountered in the OpenShift AI Observability Summarizer.

## Table of Contents

- [Loki Stack Issues](#loki-stack-issues)
- [Observability Stack Issues](#observability-stack-issues)
- [Application Issues](#application-issues)
- [Diagnostic Commands](#diagnostic-commands)

---

## Loki Stack Issues

### 1. Loki Ingester Not Ready (Ring Issues)

**Symptoms**:
- `logging-loki-ingester-0` stuck at `0/1 Running`
- Logs showing "past heartbeat timeout"
- Logs showing "autoforget have seen 1 unhealthy ingesters"

**Root Cause**: Dead ingester stuck in Loki ring from previous deployment + outdated schema version.

**Solution**:
1. Completely delete and recreate LokiStack with updated schema
2. Configure 2+ ingester replicas for high availability
3. Ensure proper cleanup of previous deployment artifacts

**Prevention**: Always use 2+ ingester replicas and proper cleanup procedures.

---

### 2. MinIO Storage Crisis (99% Full)

**Symptoms**:
- MinIO storage at 99% capacity
- `XMinioStorageFull` errors
- Ingester failures

**Root Cause**: High-volume log streams (especially audit logs) consuming excessive storage.

**Immediate Actions**:
```bash
# 1. Disable audit log collection
oc edit clusterlogforwarder -n openshift-logging
# Set audit.enabled: false

# 2. Check storage usage
oc exec -n observability-hub minio-observability-storage-0 -- df -h /data

# 3. Manually clean up audit logs if necessary
oc exec -n observability-hub minio-observability-storage-0 -- rm -rf /data/loki/audit
```

**Long-term Solutions**:
- Reduce retention policies for high-volume tenants
- Implement log filtering for infrastructure logs
- Monitor storage usage proactively
- Set up alerts for storage capacity

**Example Result**: Storage usage can drop from 99% to 5% after cleanup.

---

### 3. Ingester WAL Recovery Issues

**Symptoms**:
- Ingester stuck "recovering from checkpoint"
- Massive WAL size (80GB+)
- Ingester fails to start

**Root Cause**: Massive WAL checkpoint from high-volume logs preventing startup.

**Solution**:
```bash
# Delete the problematic WAL PersistentVolumeClaim
oc delete pvc wal-logging-loki-ingester-1 -n openshift-logging

# The ingester will restart with a fresh WAL
```

**Impact**: Only affects log data in the WAL (recent logs not yet flushed to storage). No impact on other observability services.

---

### 4. Authentication and Tenant Access Errors

**Symptoms**:
- "You don't have permission to access this tenant" errors
- Service account tokens failing

**Root Cause**: Only the `collector` service account has proper OpenShift Logging RBAC.

**Solution**:
```bash
# Use the collector token for log queries
TOKEN=$(oc get secret collector-token -n openshift-logging -o jsonpath='{.data.token}' | base64 -d)

# Verify ClusterRoleBindings exist
oc get clusterrolebinding | grep collect-

# If missing, ensure Helm chart RBAC is properly configured
helm upgrade loki-stack deploy/helm/observability/loki \
  --namespace openshift-logging \
  --set rbac.collector.create=true
```

---

### 5. ClusterLogForwarder Permission Errors (v6.3+ Format Issue)

**Symptoms**:
- ClusterLogForwarder shows "insufficient permissions on service account"
- Status shows `ClusterRoleMissing`
- Collector ServiceAccount exists but permissions denied

**Root Cause**: ClusterRoles using old format instead of OpenShift Logging v6.3+ observability API format.

**Solution**:

Update ClusterRoles to use correct API format:

```bash
# Check current ClusterRole format
oc get clusterrole collect-application-logs -o yaml | grep -A 10 "rules:"

# Should show NEW format:
# - apiGroups:
#   - logging.openshift.io
#   - observability.openshift.io
#   resourceNames:
#   - application
#   resources:
#   - logs
#   verbs:
#   - collect

# If using OLD format (deprecated), upgrade via Helm:
helm upgrade loki-stack deploy/helm/observability/loki \
  --namespace openshift-logging
```

**Verification**:
```bash
# Verify ClusterLogForwarder is authorized
oc get clusterlogforwarder logging-loki-forwarder -n openshift-logging \
  -o jsonpath='{.status.conditions[?(@.type=="observability.openshift.io/Authorized")]}'
```

**Important**: This issue only affects OpenShift Logging v6.3+ installations. The fix is backward compatible.

---

### 6. Console Plugin Missing

**Symptoms**: "Observe → Logs" menu not appearing in OpenShift Console.

**Root Cause**: Missing UIPlugin resource or console plugin not enabled.

**Solution**:
```bash
# 1. Check if UIPlugin exists
oc get uiplugin logging-console -n openshift-logging

# 2. Check if console plugin is enabled
oc get console.operator.openshift.io cluster -o jsonpath='{.spec.plugins}' | grep logging-console-plugin

# 3. Enable console plugin if missing
make enable-logging-ui

# OR manually:
oc patch console.operator.openshift.io cluster --type=json \
  -p='[{"op": "add", "path": "/spec/plugins/-", "value": "logging-console-plugin"}]'
```

---

## Observability Stack Issues

### 1. No Traces Appearing

**Symptoms**: No traces visible in OpenShift Console or Grafana.

**Diagnostic Steps**:
```bash
# 1. Check if instrumentation is applied
oc get instrumentation -n your-namespace

# 2. Verify namespace annotation
oc get namespace your-namespace -o yaml | grep instrumentation

# 3. Check application pods have init containers
oc get pod <pod-name> -n your-namespace -o yaml | grep -A 20 "initContainers:"

# 4. Verify environment variables
oc get pod <pod-name> -n your-namespace -o yaml | grep -A 10 "OTEL_"
```

**Solution**: Restart application deployments to pick up instrumentation:
```bash
oc rollout restart deployment/<deployment-name> -n your-namespace
```

---

### 2. Tempo Gateway 502 Errors

**Symptoms**: Tempo gateway returning 502 errors, traces not being stored.

**Diagnostic Steps**:
```bash
# 1. Check OpenTelemetry Collector is running
oc get pods -n observability-hub | grep otel-collector

# 2. Check Tempo gateway logs
oc logs -n observability-hub deployment/tempo-tempostack-gateway --tail=20

# 3. Verify service connectivity
oc get svc -n observability-hub | grep otel-collector
```

**Solution**: Ensure all observability components are running and properly configured.

---

### 3. Applications Not Instrumented

**Symptoms**: Applications running but no init containers for OpenTelemetry.

**Diagnostic Steps**:
```bash
# Check if Instrumentation resource exists
oc get instrumentation -n your-namespace -o yaml

# Check if namespace has instrumentation annotation
oc get namespace your-namespace -o yaml
```

**Solution**: Apply instrumentation before deploying applications:
```bash
make setup-tracing NAMESPACE=your-namespace

# Then redeploy applications
oc rollout restart deployment/<deployment-name> -n your-namespace
```

---

## Application Issues

### 1. MCP Server Connection Issues

**Symptoms**: UI cannot connect to MCP server, API calls failing.

**Diagnostic Steps**:
```bash
# 1. Check MCP server is running
oc get pods -n your-namespace | grep mcp-server

# 2. Check MCP server logs
oc logs -n your-namespace deployment/aiobs-mcp-server --tail=50

# 3. Verify service exists
oc get svc -n your-namespace | grep mcp-server

# 4. Test connectivity from UI pod
oc exec -n your-namespace deployment/aiobs-ui -- curl -v http://aiobs-mcp-server-svc:8085/health
```

**Solution**: Verify service endpoints and network policies.

---

### 2. LLM Model Not Responding

**Symptoms**: Chat functionality not working, timeouts on LLM requests.

**Diagnostic Steps**:
```bash
# 1. Check LLM pod status
oc get pods -n your-namespace | grep llama

# 2. Check LLM logs
oc logs -n your-namespace <llm-pod-name> --tail=100

# 3. Verify model configuration
oc get deployment aiobs-mcp-server -n your-namespace -o yaml | grep MODEL_CONFIG

# 4. Test LLM endpoint
oc exec -n your-namespace deployment/aiobs-mcp-server -- curl -v http://llama-stack-svc:8321/health
```

**Solution**: Ensure LLM pod has sufficient resources and is properly configured.

---

## Diagnostic Commands

### Loki Stack Health Check

```bash
# Overall LokiStack status
oc get lokistack logging-loki -n openshift-logging -o yaml

# Individual component health
oc get pods -n openshift-logging -l app.kubernetes.io/name=loki

# Ingester ring status
oc exec -n openshift-logging logging-loki-ingester-0 -- \
  wget -qO- http://localhost:3100/ring

# Check for unhealthy ingesters
oc logs -n openshift-logging logging-loki-ingester-0 | grep -i "heartbeat\|ring\|unhealthy"
```

### Log Collection Check

```bash
# ClusterLogForwarder status
oc get clusterlogforwarder -n openshift-logging -o yaml

# Vector collector logs
oc logs -n openshift-logging -l component=collector

# Collector token verification
oc get secret collector-token -n openshift-logging -o yaml
```

### Storage Check

```bash
# MinIO storage usage
oc exec -n observability-hub minio-observability-storage-0 -- df -h /data

# MinIO bucket contents
oc exec -n observability-hub minio-observability-storage-0 -- ls -la /data/loki/

# Ingester WAL size
oc exec -n openshift-logging logging-loki-ingester-0 -- du -sh /tmp/wal
```

### Test Log Queries

```bash
# Get collector token
TOKEN=$(oc get secret collector-token -n openshift-logging -o jsonpath='{.data.token}' | base64 -d)

# Query application logs
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://$(oc get route logging-loki-gateway -n openshift-logging -o jsonpath='{.spec.host}')/api/logs/v1/application/loki/api/v1/query_range" \
  --data-urlencode 'query={namespace="observability-hub"}' \
  --data-urlencode "start=$(date -u -d '1 hour ago' +%s)000000000" \
  --data-urlencode "end=$(date -u +%s)000000000" \
  --data-urlencode 'limit=10'
```

### Observability Components Check

```bash
# Check all observability components
oc get all -n observability-hub

# Check instrumentation status
oc get instrumentation -n your-namespace

# Check OpenTelemetry Collector logs
oc logs -n observability-hub deployment/otel-collector-collector --tail=50

# Check Tempo components
oc get pods -n observability-hub | grep tempo
oc logs -n observability-hub deployment/tempo-tempostack-gateway --tail=20
```

### Application Health Check

```bash
# Check all application pods
oc get pods -n your-namespace

# Check MCP server logs
oc logs -n your-namespace deployment/aiobs-mcp-server --tail=50

# Check UI logs
oc logs -n your-namespace deployment/aiobs-ui --tail=50

# Check alerting logs
oc logs -n your-namespace deployment/aiobs-alerting --tail=50
```

---

## Related Documentation

- [Observability Overview](OBSERVABILITY_OVERVIEW.md) - Architecture and setup
- [Developer Guide](DEV_GUIDE.md) - Development workflows
- [README](../README.md) - Main project documentation
- [OpenShift Logging Operator](https://docs.openshift.com/container-platform/latest/logging/cluster-logging.html)
- [Loki Operator](https://loki-operator.dev/)
- [OpenTelemetry Operator](https://github.com/open-telemetry/opentelemetry-operator)
