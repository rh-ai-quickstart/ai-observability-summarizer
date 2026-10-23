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

### 2. Historical MinIO storage incident

Earlier deployments used MinIO and could exhaust storage when high-volume audit logs were retained. Current deployments use S4 in `ai-observability`. Check its PVC capacity and Loki retention settings; do not use MinIO pod or filesystem cleanup commands against S4.

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

### S4 HTTP 500 or `Too many open files` during S3 writes

The pinned S4 0.3.2 image starts RGW under Supervisor. Its stock config leaves the soft file-descriptor limit at 1024, which can cause Tempo PUTs to fail even when S4's UI and bucket listings are healthy. This quickstart mounts `s4-supervisord-config` with `minfds=65536`, and the bucket Job verifies temporary write/read/delete operations in both observability buckets.

For a standalone Helm install, rerun `make install-s4` with the same current `S4_ACCESS_KEY_ID`, `S4_SECRET_ACCESS_KEY`, and UI credentials; the Makefile applies the ConfigMap before the S4 upgrade. For an operator install, upgrade the umbrella chart so it creates the ConfigMap and rolls the S4 Deployment. Check the new RGW process limit and bucket Job result after the pod restarts. The ConfigMap mount uses `subPath`, so editing it later requires another S4 pod rollout.

---

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

### 3. Console Plugin UI Is Unstyled on OpenShift 4.22+

**Symptoms**: The **AI Observability** console page renders as one long, unstyled vertical column. The browser console shows `aiobs-console-plugin@1.0.0 was built for an older version of Console`.

**Root Cause**: The console plugin is built with PatternFly 5 and relies on the OpenShift Console to provide PatternFly's base styles. The OpenShift 4.22 console ships only PatternFly 6 styles, so the plugin's components render without layout CSS. This was observed on OpenShift 4.22.6; the exact release that stopped shipping PatternFly 5 styles has not been confirmed. The fix is to migrate the plugin to PatternFly 6, which is tracked separately.

**Workaround**: Use the standalone React UI, which bundles its own PatternFly styles and uses the same MCP server. It is available only with the Helm (non-operator) installation:

```bash
# New installation
make install NAMESPACE=your-namespace DEV_MODE=true

# Existing Helm installation: add the standalone UI
make install-react-ui NAMESPACE=your-namespace

# Find the UI address
oc get route aiobs-react-ui -n your-namespace -o jsonpath='{.spec.host}'
```

The operator installation does not deploy the standalone React UI. On OpenShift 4.22+, use the Helm installation until the console plugin supports PatternFly 6.

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
# S4 storage claim and capacity
oc get pvc s4-data -n ai-observability

# S4 pod status
oc get pods -n ai-observability -l app=s4

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
