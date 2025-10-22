# Loki Stack Deployment Notes

This document contains comprehensive deployment instructions and troubleshooting information for the Loki logging stack in OpenShift AI Observability Summarizer.

## 📋 Current Configuration Summary

### LokiStack Configuration

- **Name**: `logging-loki`
- **Size**: `1x.small`
- **Schema Version**: `v13` (updated from v11)
- **Ingester Replicas**: `2` (for high availability)
- **Tenant Mode**: `openshift-logging` (for RBAC integration)

### Storage Configuration

- **Backend**: MinIO S3-compatible storage (cross-namespace access)
- **Bucket**: `loki`
- **Endpoint**: `http://minio-observability-storage.observability-hub.svc.cluster.local:9000`
- **Storage Class**: `gp3`
- **Note**: MinIO remains in `observability-hub` namespace, accessed from `openshift-logging` via ClusterIP service

### Retention Policies (Optimized for Storage)

- **Global Default**: 3 days (reduced from 7)
- **Audit Logs**: 1 day (reduced from 3, currently disabled)
- **Application Logs**: 3 days (reduced from 7)
- **Infrastructure Logs**: 7 days (reduced from 14)

### Authentication & Security

- **TLS**: Currently using `insecureSkipVerify: true` for internal cluster communication
- **CA Configuration**: OpenShift Service CA (`openshift-service-ca.crt`) available for production
- **Authentication Token**: Uses `collector-token` from `openshift-logging` namespace

### Log Collection Strategy

- **Application Logs**: All namespaces (no filtering)
- **Infrastructure Logs**: Filtered to `node` and `container` sources only
- **Audit Logs**: Disabled (due to high volume - 93GB in 2 days)

### OpenShift Console Integration

- **UI Plugin**: `logging-console` UIPlugin resource for "Observe → Logs" menu
- **Console Plugin**: `logging-console-plugin` (requires manual enablement)

### External Service Integration

- **Enabled**: Configuration for external services (e.g., Korrel8) to query logs
- **Authentication**: Uses collector token with proper tenant access
- **API Paths**: Tenant-specific paths for application, infrastructure, and audit logs

## 🚀 Installation Instructions

### Prerequisites

1. OpenShift cluster with cluster-admin permissions
2. Helm 3.x installed
3. `oc` CLI configured and authenticated

### Step 1: Install Required Operators

```bash
# Install OpenShift Logging Operator
make install-logging-operator

# Install Loki Operator
make install-loki-operator
```

### Step 2: Install MinIO Storage

```bash
# Install MinIO with loki bucket
make install-minio MINIO_BUCKETS=tempo,loki
```

### Step 3: Deploy Loki Stack

```bash
# Install complete Loki stack (via Makefile - automatically detects if collector SA exists)
make install-loki

# OR manually with Helm:
helm install loki-stack deploy/helm/observability/loki \
  --namespace openshift-logging \
  --create-namespace
```

**Note**: The Makefile automatically detects if the `collector` ServiceAccount already exists in `openshift-logging` and sets `rbac.collector.create` accordingly:

- If collector SA exists (e.g., managed by OpenShift Logging Operator) → skips creation
- If collector SA doesn't exist → creates it automatically

### Step 4: Manual Collector Service Account Setup (Optional)

If you need to manually manage the collector service account (not using Helm RBAC):

```bash
# Create collector service account in openshift-logging
oc create serviceaccount collector -n openshift-logging

# Create ClusterRoles for log collection
oc apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: collect-application-logs
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["namespaces"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: collect-infrastructure-logs
rules:
- apiGroups: [""]
  resources: ["nodes", "nodes/log", "nodes/metrics"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: logging-collector-logs-writer
rules:
- apiGroups: ["loki.grafana.com"]
  resources: ["application", "infrastructure", "audit"]
  verbs: ["create"]
EOF

# Bind ClusterRoles to collector service account
oc create clusterrolebinding collect-application-logs \
  --clusterrole=collect-application-logs \
  --serviceaccount=openshift-logging:collector

oc create clusterrolebinding collect-infrastructure-logs \
  --clusterrole=collect-infrastructure-logs \
  --serviceaccount=openshift-logging:collector

oc create clusterrolebinding logging-collector-logs-writer \
  --clusterrole=logging-collector-logs-writer \
  --serviceaccount=openshift-logging:collector

# Create collector token secret
oc apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: collector-token
  namespace: openshift-logging
  annotations:
    kubernetes.io/service-account.name: collector
type: kubernetes.io/service-account-token
EOF
```

### Step 5: Enable OpenShift Console Integration

```bash
# Enable the "Observe → Logs" menu in OpenShift Console
make enable-logging-ui
```

### Step 6: Verify Installation

```bash
# Check all Loki pods (should see 8 running)
oc get pods -n openshift-logging | grep loki

# Expected pods:
# logging-loki-distributor-0        1/1 Running
# logging-loki-gateway-0            1/1 Running
# logging-loki-ingester-0           1/1 Running
# logging-loki-ingester-1           1/1 Running
# logging-loki-querier-0            1/1 Running
# logging-loki-query-frontend-0     1/1 Running
# logging-loki-index-gateway-0      1/1 Running
# logging-loki-compactor-0          1/1 Running

# Check LokiStack status
oc get lokistack logging-loki -n openshift-logging

# Check ClusterLogForwarder
oc get clusterlogforwarder -n openshift-logging

# Check Vector collectors (should see collector pods)
oc get pods -n openshift-logging | grep collector

# Check MinIO storage usage
oc exec -n observability-hub minio-observability-storage-0 -- df -h /data

# Check UIPlugin
oc get uiplugin logging-console -n openshift-logging

# Verify console plugin is enabled
oc get console.operator.openshift.io cluster -o jsonpath='{.spec.plugins}' | grep logging-console-plugin
```

## 🔧 Configuration Options

### Helm Values Configuration

Key configuration options in `values.yaml`:

```yaml
# UI Plugin for OpenShift Console
uiPlugin:
  enabled: true                    # Enable "Observe → Logs" menu
  name: logging-console
  logging:
    timeout: 30s
    lokiStack:
      name: logging-loki
      namespace: openshift-logging

# LokiStack sizing and replicas
lokiStack:
  size: 1x.small                  # Options: 1x.extra-small, 1x.small, 1x.medium
  template:
    ingester:
      replicas: 2                 # High availability (minimum for replication_factor=2)

# Retention policies (adjust based on storage capacity)
lokiStack:
  limits:
    global:
      retention:
        days: 3                   # Global default
    tenants:
      audit:
        retention:
          days: 1                 # High-volume audit logs
      application:
        retention:
          days: 3                 # Application logs
      infrastructure:
        retention:
          days: 7                 # Infrastructure logs

# Log collection filtering
clusterLogging:
  logForwarder:
    inputs:
      application:
        allNamespaces: true       # Collect from all namespaces
      infrastructure:
        filtered: true            # Filter to reduce volume
        sources: [node, container]
      audit:
        enabled: false            # Disabled due to high volume

# RBAC management
rbac:
  collector:
    create: true                  # Set to false if collector SA already exists

# External service access (e.g., for Korrel8)
externalAccess:
  enabled: true
  loki:
    url: https://logging-loki-gateway-http.openshift-logging.svc.cluster.local:8080
    tenantPaths:
      application: /api/logs/v1/application/loki/api/v1
      infrastructure: /api/logs/v1/infrastructure/loki/api/v1
  authentication:
    useCollectorToken: true
    collectorTokenPath: /var/run/secrets/loki/collector-token
```

## 🐛 Issues Encountered & Solutions

### 1. Loki Ingester Not Ready (Ring Issues)

**Problem**: `logging-loki-ingester-0` stuck at `0/1 Running` with logs showing "past heartbeat timeout" and "autoforget have seen 1 unhealthy ingesters".

**Root Cause**: Dead ingester stuck in Loki ring from previous deployment + outdated schema version (v11).

**Solution**:

1. Completely deleted and recreated LokiStack with updated schema (v13)
2. Configured 2 ingester replicas for high availability
3. Ensured proper cleanup of previous deployment artifacts

**Prevention**: Always use 2+ ingester replicas and proper cleanup procedures.

### 2. MinIO Storage Crisis (99% Full)

**Problem**: MinIO storage reached 99% capacity, causing `XMinioStorageFull` errors and ingester failures.

**Root Cause**: Audit logs consuming 93GB in 2 days despite 1-day retention policy.

**Solution**:

1. **Immediate**: Disabled audit log collection in ClusterLogForwarder
2. **Immediate**: Manually deleted `/data/loki/audit` directory in MinIO pod
3. **Long-term**: Reduced retention policies across all tenants
4. **Long-term**: Implemented infrastructure log filtering

**Result**: Storage usage dropped from 99% to 5%.

**Prevention**: Monitor storage usage and implement aggressive retention policies for high-volume log streams.

### 3. Ingester WAL Recovery Issues

**Problem**: After storage cleanup, `logging-loki-ingester-1` stuck "recovering from checkpoint" with 87GB WAL.

**Root Cause**: Massive WAL checkpoint from audit logs preventing ingester startup.

**Solution**: Deleted `wal-logging-loki-ingester-1` PersistentVolumeClaim to force fresh start.

**Impact**: Only affects logs (no data loss for other services).

### 4. Authentication and Tenant Access

**Problem**: Various service account tokens failing with "You don't have permission to access this tenant".

**Root Cause**: Only the `collector` service account has proper OpenShift Logging RBAC.

**Solution**:

1. Use `collector-token` from `openshift-logging` namespace
2. Ensure proper ClusterRoleBindings for tenant access

### 5. ClusterLogForwarder Validation Failures

**Problem**: "collector not ready" errors preventing log forwarding.

**Root Cause**: Missing `collector` service account and associated RBAC.

**Solution**:

1. Added Helm option `rbac.collector.create` to manage collector SA
2. Created comprehensive RBAC templates for collector permissions
3. Updated documentation to reflect modern OpenShift Logging (no ClusterLogging CRD)

### 6. Console Plugin Missing

**Problem**: "Observe → Logs" menu not appearing in OpenShift Console.

**Root Cause**: Missing UIPlugin resource and console plugin enablement.

**Solution**:

1. Created `uiplugin.yaml` template for logging console integration
2. Added Makefile targets for enabling/disabling console plugin
3. Added configuration options in `values.yaml`

## 🔍 Troubleshooting Commands

### Check Loki Stack Health

```bash
# Overall LokiStack status
oc get lokistack logging-loki -n openshift-logging -o yaml

# Individual component health
oc get pods -n openshift-logging -l app.kubernetes.io/name=loki

# Ingester ring status (from any loki pod)
oc exec -n openshift-logging logging-loki-ingester-0 -- \
  wget -qO- http://localhost:3100/ring

# Check for stuck ingesters
oc logs -n openshift-logging logging-loki-ingester-0 | grep -i "heartbeat\|ring\|unhealthy"
```

### Check Log Collection

```bash
# ClusterLogForwarder status
oc get clusterlogforwarder -n openshift-logging -o yaml

# Vector collector logs
oc logs -n openshift-logging -l component=collector

# Check collector token
oc get secret collector-token -n openshift-logging -o yaml
```

### Check Storage

```bash
# MinIO storage usage
oc exec -n observability-hub minio-observability-storage-0 -- df -h /data

# MinIO bucket contents
oc exec -n observability-hub minio-observability-storage-0 -- \
  ls -la /data/loki/

# Ingester WAL size
oc exec -n openshift-logging logging-loki-ingester-0 -- \
  du -sh /tmp/wal
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

### Console Plugin Troubleshooting

```bash
# Check UIPlugin resource
oc get uiplugin logging-console -n observability-hub

# Check console plugin status
oc get console.operator.openshift.io cluster -o jsonpath='{.spec.plugins}'

# Enable console plugin manually
oc patch console.operator.openshift.io cluster --type=json \
  -p='[{"op": "add", "path": "/spec/plugins/-", "value": "logging-console-plugin"}]'
```

## 📚 Related Documentation

- [OpenShift Logging Operator Documentation](https://docs.openshift.com/container-platform/latest/logging/cluster-logging.html)
- [Loki Operator Documentation](https://loki-operator.dev/)
- [LogQL Query Language](https://grafana.com/docs/loki/latest/logql/)
- [OpenShift Console Plugin Development](https://docs.openshift.com/container-platform/latest/web_console/creating-quick-start-tutorials.html)

## 🎯 Next Steps

1. **Monitor Storage Usage**: Set up alerts for MinIO storage capacity
2. **Optimize Retention**: Fine-tune retention policies based on actual usage patterns
3. **Enable Audit Logs**: Re-enable audit logs with aggressive filtering once storage is stable
4. **Production Security**: Switch from `insecureSkipVerify` to proper CA validation
5. **Performance Tuning**: Adjust ingester replicas and resource limits based on log volume
6. **Console Integration**: Verify "Observe → Logs" functionality in OpenShift Console

---

**Last Updated**: October 2024
**Configuration Version**: Loki Stack v13 with OpenShift Console Integration
