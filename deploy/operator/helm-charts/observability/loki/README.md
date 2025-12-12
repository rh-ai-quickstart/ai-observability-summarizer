# Loki Deployment Guide - Production Tested Configuration

## Overview

This Helm chart contains the **production-tested configuration** that successfully resolved multiple critical issues encountered during deployment in October 2025. This guide ensures you can replicate the exact working setup.

**✅ NEW in v2.1**: The Helm chart is now **complete and self-contained**, automatically creating all necessary components including LokiStack deployment, RBAC, and log forwarding configuration. No manual setup steps required!

## ✅ Current Working Configuration

### LokiStack Configuration

- **Size**: `1x.small`
- **Ingester Replicas**: `2` (CRITICAL - prevents ring coordination issues)
- **Storage**: Shared MinIO instance in `observability-hub` namespace (cross-namespace access from `openshift-logging`)
- **Schema Version**: `v13` (updated from v12)

### Authentication & Security

- **TLS**: Currently uses `insecureSkipVerify: true` for internal cluster communication
- **Authentication**: Uses `collector` service account token from `openshift-logging` namespace
- **RBAC**: Uses OpenShift Logging v6.3+ observability API format for ClusterRoles
  - `collect-application-logs` - Permission to collect application logs
  - `collect-infrastructure-logs` - Permission to collect infrastructure logs
  - `collect-audit-logs` - Permission to collect audit logs
  - Uses new API: `logging.openshift.io` and `observability.openshift.io` with `logs` resource and `collect` verb

### Retention Policies (Optimized for Storage)

- **Global**: 3 days (reduced from 7 days)
- **Application**: 3 days (reduced from 7 days)
- **Infrastructure**: 7 days (reduced from 14 days)
- **Audit**: 1 day (reduced from 3 days) - **CURRENTLY DISABLED**

### Log Collection Filtering

- **Application Logs**: All namespaces (comprehensive coverage)
- **Infrastructure Logs**: Filtered to `node` and `container` sources only
- **Audit Logs**: **DISABLED** due to extreme volume (93GB in 2 days)

### External Access for Log Queries

- **Loki URL**: `https://logging-loki-gateway-http.openshift-logging.svc.cluster.local:8080`
- **Tenant Paths**: `/api/logs/v1/{tenant}/loki/api/v1/`
- **Authentication**: Uses `collector-token` from `openshift-logging` namespace
- **Use Case**: External services like Korrel8 can query logs by mounting the collector token

## 🚀 Installation Instructions

### Prerequisites

All prerequisites are automatically installed by the `make install` command:

1. **OpenShift Logging Operator** - Provides log collection infrastructure (auto-installed)
2. **Loki Operator** - Provides LokiStack CRD (auto-installed)
3. **Shared MinIO instance** - Object storage backend (auto-installed)
4. **Sufficient storage** - recommend 100GB+ for MinIO

**Note**: Collector service account and RBAC are intelligently managed by the Makefile and Helm chart.

### OpenShift Logging Setup (Intelligently Automated)

**✅ SMART RBAC MANAGEMENT**: The Helm chart intelligently handles RBAC based on whether the `collector` ServiceAccount exists:

- **ClusterRoles and ClusterRoleBindings**: **Always created/updated** to ensure correct permissions

  - This ensures ClusterRoles match the current chart version
  - Uses OpenShift Logging v6.3+ observability API format
  - Includes all three log types: application, infrastructure, and audit

- **Collector Service Account**: Only created if it doesn't already exist
  - Has `helm.sh/resource-policy: keep` annotation to prevent accidental deletion
  - Preserved during upgrades to maintain continuity
  - Makefile detects existing SA and sets `rbac.collector.create=false` automatically

**Key Benefits**:

- ✅ Works correctly on both fresh installs and reinstalls
- ✅ No manual ServiceAccount deletion required
- ✅ ClusterRoles always match the current operator version requirements
- ✅ Zero downtime during upgrades

**No manual intervention required** - the installation handles all scenarios automatically!

### Automated Installation (Recommended)

The easiest way to install Loki is using the integrated Makefile:

```bash
# Install complete observability stack (including Loki)
make install NAMESPACE=your-namespace

# This automatically installs:
# - All required operators (Logging + Loki + Tempo + OpenTelemetry + Cluster Observability)
# - MinIO storage backend with loki bucket
# - TempoStack for traces
# - LokiStack for logs
# - OpenTelemetry Collector
# - Collector service account and RBAC
# - ClusterLogForwarder for log collection
```

The installation is **fully idempotent** - running `make install` multiple times is safe and will skip already-installed components.

### Manual Installation (Advanced)

If you need to install Loki separately:

```bash
# 1. Install operators first
make install-logging-operator
make install-loki-operator

# 2. Install MinIO (if not already installed)
make install-minio

# 3. Install LokiStack
make install-loki

# The Helm chart automatically creates:
# - LokiStack instance with MinIO storage
# - Collector service account and RBAC in openshift-logging namespace
# - ClusterLogForwarder for log collection
# - MinIO credentials secret

# Wait for LokiStack to be ready
kubectl wait --for=condition=Ready lokistack/logging-loki -n openshift-logging --timeout=600s
```

### Verify Deployment

```bash
# Check all Loki pods are running (should see 8 pods)
kubectl get pods -n openshift-logging | grep loki

# Verify LokiStack status
kubectl get lokistack logging-loki -n openshift-logging

# Check ClusterLogForwarder status
kubectl get clusterlogforwarder logging-loki-forwarder -n openshift-logging

# Verify log collection is working
kubectl get pods -n openshift-logging | grep forwarder
```

### Monitor Storage Usage

```bash
# Check MinIO storage usage (should be < 80%)
kubectl exec -n observability-hub minio-observability-storage-0 -- df -h | grep "/data"

# Monitor ingester status
kubectl get pods -n openshift-logging | grep ingester

# Check for configuration drift (recommended after install)
make check-observability-drift
```

## 🔧 Configuration Options

### Enable Audit Logs (Use with Caution)

```yaml
# In values.yaml
clusterLogging:
  logForwarder:
    inputs:
      audit:
        enabled: true # Change from false
```

### Enable Proper TLS Validation

```yaml
# In values.yaml
clusterLogging:
  logForwarder:
    tls:
      insecureSkipVerify: false # Change from true
```

### Adjust Retention Policies

```yaml
# In values.yaml
lokiStack:
  limits:
    global:
      retention:
        days: 7 # Increase if you have more storage
```

### Enable External Access for Services like Korrel8

The chart includes external access configuration that can be used by services like Korrel8 to query logs:

```yaml
# In values.yaml
externalAccess:
  enabled: true # Set to false if no external services need log access
```

**To integrate an external service:**

1. **Grant RBAC access** to read the collector token:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: external-service-loki-access
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["collector-token"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: external-service-loki-access
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: external-service-loki-access
subjects:
  - kind: ServiceAccount
    name: your-service-account
    namespace: your-namespace
```

2. **Mount the collector token** in your service:

```yaml
volumes:
  - name: loki-token
    secret:
      secretName: collector-token
      namespace: openshift-logging
volumeMounts:
  - name: loki-token
    mountPath: /var/run/secrets/loki
    readOnly: true
```

3. **Use the configuration** from `values.yaml`:
   - Loki URL: From `externalAccess.loki.url`
   - Tenant paths: From `externalAccess.loki.tenantPaths`
   - Token path: From `externalAccess.authentication.collectorTokenPath`

## 📊 Monitoring & Maintenance

### Key Metrics to Monitor

1. **Storage Usage**: Keep MinIO below 80% capacity
2. **Ingester Health**: Both ingesters should be `1/1 Running`
3. **Log Ingestion Rate**: Monitor per-tenant rates
4. **ClusterLogForwarder Status**: Should be `Ready: True`

### Regular Maintenance Tasks

```bash
# Weekly storage check
kubectl exec -n observability-hub minio-observability-storage-0 -- df -h

# Check for failed pods
kubectl get pods -n openshift-logging | grep -v Running

# Verify log collection status
kubectl get clusterlogforwarder -n openshift-logging -o yaml | grep -A 5 "conditions:"
```

## 🚨 Critical Issues Encountered & Solutions

### Issue 1: Storage Crisis - MinIO 99% Full

**Problem**: MinIO storage reached 99% capacity, causing all ingesters to fail with `XMinioStorageFull` errors.

**Root Cause**: Audit logs consumed 93GB in 2 days (96% of total storage).

**Solution**:

1. **Immediate**: Manually deleted audit log directory from MinIO
2. **Temporary**: Disabled audit log collection
3. **Long-term**: Reduced retention policies across all tenants
4. **Result**: Storage usage dropped from 99% to 5%, then stabilized at ~18%

**Prevention**:

```bash
# Monitor storage regularly
kubectl exec -n observability-hub minio-observability-storage-0 -- df -h | grep "/data"

# Keep audit logs disabled unless absolutely necessary
# If enabled, use very short retention (1 day max)
```

### Issue 2: Ingester Ring Coordination Failures

**Problem**: Single ingester couldn't handle load and kept failing with ring coordination errors.

**Symptoms**:

- `logging-loki-ingester-0` showing `0/1 Running`
- Logs: "at least 2 live replicas required"
- Readiness probe failing with 503 status

**Solution**:

1. **Scaled ingesters to 2 replicas** for high availability
2. **Updated LokiStack template** to prevent single points of failure
3. **Verified ring membership** was healthy

**Configuration**:

```yaml
lokiStack:
  template:
    ingester:
      replicas: 2 # CRITICAL - never use 1 replica
```

### Issue 3: Ingester Stuck on WAL Recovery

**Problem**: After storage crisis, ingester-1 was stuck "recovering from checkpoint" with 87GB of WAL data.

**Symptoms**:

- Ingester showing `0/1 Running` for hours
- Logs: "recovering from checkpoint"
- Readiness probe failing

**Solution**:

1. **Deleted the problematic ingester pod**
2. **Deleted the WAL PVC** to clear checkpoint data
3. **Allowed fresh PVC creation** on pod restart
4. **Result**: Ingester started cleanly in seconds

**Prevention**:

```bash
# If ingester stuck on recovery, check WAL size
kubectl exec logging-loki-ingester-X -n openshift-logging -- du -sh /tmp/wal

# If > 10GB, consider clearing WAL PVC
kubectl delete pvc wal-logging-loki-ingester-X -n openshift-logging
```

### Issue 4: Namespace Filtering Complexity

**Problem**: Initial namespace filtering was too restrictive and complex to configure correctly.

**Evolution**:

1. **Started with**: Specific namespace lists for applications
2. **Encountered**: Syntax errors with infrastructure filtering
3. **Learned**: Infrastructure only supports `node` and `container` sources
4. **Final Solution**: All namespaces for applications, minimal sources for infrastructure

**Working Configuration**:

```yaml
inputs:
  application:
    allNamespaces: true # Comprehensive coverage
  infrastructure:
    sources: [node, container] # Minimal but sufficient
  audit:
    enabled: false # Disabled due to volume
```

### Issue 5: Authentication Token Confusion

**Problem**: Multiple service accounts and tokens caused confusion about which to use.

**Tokens Encountered**:

- `logging-loki-gateway-token` (gateway internal use)
- `loki-log-forwarder-token` (insufficient permissions)
- `collector-token` (correct choice)

**Solution**: Use `collector` service account token which has proper ClusterRoleBindings for tenant access.

### Issue 6: ClusterLogForwarder Validation Failures

**Problem**: ClusterLogForwarder showing validation failures and "collector not ready".

**Causes**:

- Unused audit output (not referenced by pipeline)
- Custom input syntax errors
- Missing service account permissions

**Solution**:

1. **Removed unused audit pipeline** when audit disabled
2. **Fixed input syntax** for application and infrastructure
3. **Verified RBAC permissions** for collector service account

### Issue 7: Compactor Waiting 2 Hours

**Problem**: After storage cleanup, compactor waited 2 hours before starting cleanup operations.

**Solution**: Restart compactor pod to trigger immediate cleanup without waiting period.

```bash
kubectl delete pod logging-loki-compactor-0 -n openshift-logging
```

## 🔍 Troubleshooting Guide

### Storage Issues

```bash
# Check MinIO usage
kubectl exec -n observability-hub minio-observability-storage-0 -- df -h

# If > 80%, check log sizes
kubectl exec -n observability-hub minio-observability-storage-0 -- du -sh /data/loki/*

# Emergency: disable audit logs
kubectl patch clusterlogforwarder logging-loki-forwarder -n openshift-logging --type='merge' -p='{"spec":{"pipelines":[{"name":"application-logs","inputRefs":["application-all-namespaces"],"outputRefs":["loki-application"]},{"name":"infrastructure-logs","inputRefs":["infrastructure-minimal"],"outputRefs":["loki-infrastructure"]}]}}'
```

### Ingester Issues

```bash
# Check ingester readiness
kubectl exec logging-loki-ingester-X -n openshift-logging -- curl -k -s https://localhost:3101/ready

# If stuck on recovery, check WAL size
kubectl exec logging-loki-ingester-X -n openshift-logging -- du -sh /tmp/wal

# Force restart if needed
kubectl delete pod logging-loki-ingester-X -n openshift-logging
```

### Log Collection Issues

```bash
# Check ClusterLogForwarder status
kubectl get clusterlogforwarder logging-loki-forwarder -n openshift-logging -o yaml | grep -A 10 "conditions:"

# Check forwarder pods (created by ClusterLogForwarder)
kubectl get pods -n openshift-logging | grep forwarder

# Verify collector service account exists
oc get sa collector -n openshift-logging

# Check collector RBAC permissions
kubectl auth can-i create application.loki.grafana.com --as=system:serviceaccount:openshift-logging:collector
kubectl auth can-i get pods --as=system:serviceaccount:openshift-logging:collector
kubectl auth can-i get nodes --as=system:serviceaccount:openshift-logging:collector
```

### ClusterLogForwarder Permission Issues

**Symptom**: ClusterLogForwarder shows error: `"insufficient permissions on service account, not authorized to collect [\"application\" \"infrastructure\"] logs"`

**Root Cause**: ClusterRoles are missing or using incorrect API format. OpenShift Logging v6.3+ requires specific ClusterRole format using the observability API.

**Solution**: The Helm chart automatically creates the correct ClusterRoles. Verify they exist:

```bash
# Check if ClusterRoles exist with correct format
oc get clusterrole collect-application-logs collect-infrastructure-logs collect-audit-logs

# Verify ClusterRole uses correct API (should show observability.openshift.io)
oc get clusterrole collect-application-logs -o yaml | grep -A 10 "rules:"

# Expected output shows new API format:
# rules:
# - apiGroups:
#   - logging.openshift.io
#   - observability.openshift.io
#   resourceNames:
#   - application
#   resources:
#   - logs
#   verbs:
#   - collect

# If ClusterRoles are missing or wrong, upgrade the Helm chart:
make upgrade-observability
# OR
helm upgrade loki-stack deploy/helm/observability/loki \
  --namespace openshift-logging \
  --reuse-values

# Verify ClusterLogForwarder is now authorized:
oc get clusterlogforwarder logging-loki-forwarder -n openshift-logging \
  -o jsonpath='{.status.conditions[?(@.type=="observability.openshift.io/Authorized")]}'
```

**Important Notes**:

- ✅ ClusterRoles are **always created/updated** regardless of whether the collector ServiceAccount exists
- ✅ The chart uses the **new observability API format** required by OpenShift Logging v6.3+
- ✅ All three log types (application, infrastructure, audit) have dedicated ClusterRoles
- ✅ ClusterRoleBindings automatically bind the ClusterRoles to the collector ServiceAccount

## 📈 Performance Characteristics

### Tested Load Capacity

- **Application Logs**: All namespaces, ~500 logs/sec sustained
- **Infrastructure Logs**: Node + container sources, ~500 logs/sec sustained
- **Storage Growth**: ~2-3GB/day with current filtering
- **Query Performance**: Sub-second for recent logs, 2-5s for historical

### Resource Usage

- **LokiStack Size**: 1x.small handles current load comfortably
- **MinIO Storage**: 100GB sufficient for 2+ weeks retention
- **Memory**: Ingesters use ~2GB each under normal load
- **CPU**: Low usage except during compaction cycles

## 🎯 Success Metrics

After implementing all fixes:

- ✅ **Storage Usage**: Stable at 18% (down from 99%)
- ✅ **All Loki Components**: 8/8 pods running healthy
- ✅ **Log Collection**: Both application and infrastructure working
- ✅ **System Stability**: No ingester failures for 24+ hours
- ✅ **Query Performance**: Sub-second response times

---

## 📦 Helm Chart Components

The complete Loki stack now includes these templates:

- **`Chart.yaml`** - Helm chart metadata and dependencies
- **`templates/_helpers.tpl`** - Template helper functions for consistent labeling
- **`templates/lokistack.yaml`** - LokiStack CRD deployment with multitenant configuration
- **`templates/minio-secrets.yaml`** - MinIO S3 credentials for storage backend
- **`templates/clusterlogforwarder.yaml`** - Log forwarding configuration
- **`templates/rbac.yaml`** - Core RBAC for log collection service accounts
- **`templates/collector-rbac.yaml`** - Collector service account and permissions
- **`values.yaml`** - Complete configuration for log collection, storage, and external access

---

## 🔧 Makefile Commands Reference

The following Makefile targets are available for Loki management:

### Installation

```bash
# Install complete stack (recommended)
make install NAMESPACE=your-namespace

# Install only Loki operators
make install-logging-operator
make install-loki-operator

# Install only LokiStack (operators must be installed first)
make install-loki

# Check if all operators are installed
make check-operators
```

### Maintenance

```bash
# Check for configuration drift
make check-observability-drift

# Force upgrade Loki configuration
make upgrade-observability

# Check Loki status
helm list -n openshift-logging | grep loki
```

### Uninstallation

```bash
# Uninstall only LokiStack (preserves operators and MinIO data)
make uninstall-loki

# Uninstall LokiStack + operators (requires confirmation flag)
make uninstall NAMESPACE=your-namespace UNINSTALL_OPERATORS=true

# Uninstall everything including MinIO (requires confirmation flag)
make uninstall NAMESPACE=your-namespace UNINSTALL_OBSERVABILITY=true UNINSTALL_OPERATORS=true
```

### Configuration

```bash
# Customize MinIO credentials (before install)
make install NAMESPACE=your-namespace MINIO_USER=custom-user MINIO_PASSWORD=custom-pass

# Customize MinIO buckets
make install NAMESPACE=your-namespace MINIO_BUCKETS=tempo,loki,custom
```

### Edge Cases

**If Loki is already installed:**

- `make install-loki` is idempotent and will skip if already exists
- To update configuration, use `make upgrade-observability`

**If configuration needs to change:**

- Edit `deploy/helm/observability/loki/values.yaml`
- Run `make upgrade-observability` to apply changes

**If operators are missing:**

- Run `make check-operators` to verify operator status
- Install missing operators individually or run `make install-operators`

---

**Last Updated**: October 28, 2025
**Configuration Version**: v2.1 (Complete Helm Chart with Makefile Integration)
**Tested Environment**: OpenShift 4.x with OpenShift Logging 5.x and Loki Operator
**Integration**: Fully integrated with `make install` workflow
