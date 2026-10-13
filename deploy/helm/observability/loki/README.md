# Loki Deployment Guide

## Overview

This Helm chart creates the LokiStack, log forwarding configuration, and required RBAC. Loki stores objects in aws-compatible-storage (S4), which runs in `ai-observability`; Loki reaches it through the S3 service endpoint on port `7480`.

## ✅ Current Working Configuration

### LokiStack Configuration

- **Size**: `1x.demo` by default (adjust for production load)
- **Ingester Replicas**: `1` by default (use at least 2 for high availability)
- **Storage**: S4 `loki` bucket at `http://s4.ai-observability.svc.cluster.local:7480`
- **Schema Version**: managed by the Loki Operator; check its status after installation

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
3. **S4 storage** - Installed in `ai-observability` by the parent chart or `make install-s4`
4. **Sufficient storage** - S4 is configured with a 10Gi PVC by default; size it for expected log volume and retention

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
- ✅ Existing Helm releases are reconciled on repeat installs without uninstalling Loki

**No manual intervention required** - the installation handles all scenarios automatically!

### Automated Installation (Recommended)

The easiest way to install Loki is using the integrated Makefile:

```bash
# Install complete observability stack (including S4 and Loki)
make install-observability-stack NAMESPACE=your-namespace

# This automatically installs:
# - All required operators (Logging + Loki + Tempo + OpenTelemetry + Cluster Observability)
# - S4 storage backend with the loki bucket
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

# 2. Install S4 (if not already installed)
make install-s4

# 3. Install LokiStack
make install-loki

# The Helm chart automatically creates:
# - LokiStack instance configured for S4 storage
# - Collector service account and RBAC in openshift-logging namespace
# - ClusterLogForwarder for log collection
# - Loki S3 credentials secret

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
# Check S4 storage PVC
oc get pvc s4-data -n ai-observability

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

1. **Storage Usage**: Monitor S4 PVC usage against its requested capacity
2. **Ingester Health**: Both ingesters should be `1/1 Running`
3. **Log Ingestion Rate**: Monitor per-tenant rates
4. **ClusterLogForwarder Status**: Should be `Ready: True`

### Regular Maintenance Tasks

```bash
# Weekly storage check
oc get pvc s4-data -n ai-observability

# Check for failed pods
kubectl get pods -n openshift-logging | grep -v Running

# Verify log collection status
kubectl get clusterlogforwarder -n openshift-logging -o yaml | grep -A 5 "conditions:"
```

## 🚨 Critical Issues Encountered & Solutions

### Historical note: former MinIO storage incident

An earlier deployment stored Loki data on MinIO and exhausted its storage with high-volume audit logs. New deployments use S4 in `ai-observability`; do not use the old MinIO pod or filesystem commands against S4.

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

### Issue 3: Full WAL or Slow Ingester Recovery

The ingester WAL uses a separate PVC from S4. A full WAL can make Vector receive
HTTP 500 while the ingester still reports Ready. Loki may log checkpoint writes
failing with `no space left on device` and reject pushes with the misleading
`Ingester is shutting down` message. Check the WAL filesystem before changing
the S4 bucket or credentials.

```bash
oc -n openshift-logging get pvc wal-logging-loki-ingester-0
oc -n openshift-logging exec logging-loki-ingester-0 -- df -h /tmp/wal
oc -n openshift-logging logs logging-loki-ingester-0 --tail=100
```

For a StorageClass that permits expansion, increase the WAL PVC to a capacity
appropriate for the log rate, then wait for its reported capacity to grow. The
`1x.demo` profile can create a 10Gi WAL PVC; 30Gi restored headroom in one
deployment, but size this for your cluster.

```bash
oc -n openshift-logging patch pvc wal-logging-loki-ingester-0 \
  --type merge -p '{"spec":{"resources":{"requests":{"storage":"30Gi"}}}}'
oc -n openshift-logging get pvc wal-logging-loki-ingester-0 -w
# Only if the PVC reports FileSystemResizePending:
oc -n openshift-logging rollout restart statefulset/logging-loki-ingester
```

Allow WAL replay to finish, then verify fresh log ingestion and queries. Do not
delete the WAL PVC to speed recovery: it holds buffered log data. See the
[Loki WAL guide](https://grafana.com/docs/loki/latest/operations/storage/wal/)
for sizing and recovery behavior.

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
# Check S4 PVC capacity
oc get pvc s4-data -n ai-observability

# Emergency: disable audit logs
kubectl patch clusterlogforwarder logging-loki-forwarder -n openshift-logging --type='merge' -p='{"spec":{"pipelines":[{"name":"application-logs","inputRefs":["application-all-namespaces"],"outputRefs":["loki-application"]},{"name":"infrastructure-logs","inputRefs":["infrastructure-minimal"],"outputRefs":["loki-infrastructure"]}]}}'
```

### Ingester Issues

```bash
# Check ingester readiness
kubectl exec logging-loki-ingester-X -n openshift-logging -- curl -k -s https://localhost:3101/ready

# If recovery is slow, inspect WAL capacity and ingester logs as described above
oc -n openshift-logging get pvc wal-logging-loki-ingester-0
oc -n openshift-logging logs logging-loki-ingester-0 --tail=100
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
- **S4 Storage**: 10Gi requested by default; set capacity based on ingestion and retention needs
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
- **`templates/s4-secrets.yaml`** - S3 credentials for S4 storage
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
# Uninstall only LokiStack (preserves operators and S4)
make uninstall-loki

# Uninstall LokiStack + operators (requires confirmation flag)
make uninstall NAMESPACE=your-namespace UNINSTALL_OPERATORS=true

# Uninstall the complete observability stack including S4 (deletes S4 PVC data)
make uninstall NAMESPACE=your-namespace UNINSTALL_OBSERVABILITY=true UNINSTALL_OPERATORS=true
```

### Configuration

```bash
# Customize S4 credentials (before install)
make install-s4 S4_ACCESS_KEY_ID=custom-user S4_SECRET_ACCESS_KEY=custom-secret
# Pass the same values to Make targets that install Tempo or Loki.
make install-observability S4_ACCESS_KEY_ID=custom-user S4_SECRET_ACCESS_KEY=custom-secret
make install-loki S4_ACCESS_KEY_ID=custom-user S4_SECRET_ACCESS_KEY=custom-secret

# Customize the buckets created by the regular boto3 Job
make install-s4 S4_BUCKETS=tempo,loki,custom
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
