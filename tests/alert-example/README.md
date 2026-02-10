# Alert Example - E2E Observability Testing

This example application is designed to test and demonstrate the end-to-end observability stack integration, including:
- **MCP Server** - Model Context Protocol server for LLM-powered observability queries
- **Korrel8r** - Correlation engine for connecting alerts, logs, and traces
- **Loki** - Log aggregation
- **Tempo** - Distributed tracing

## Overview

The alert example provides two test workloads that demonstrate different observability scenarios:

### 1. `alert-example` (Deployment)
- **Purpose**: Demonstrates alert firing and CrashLoopBackoff detection
- **Behavior**: Crashes immediately on startup, triggering alerts
- **Alert**: `AlertExampleDown` fires after 10 seconds of unavailable replicas
- **Use Case**: Testing alert detection, correlation, and query functionality

### 2. `my-app-example` (Pod)
- **Purpose**: Demonstrates error trace generation without crashing
- **Behavior**: Emits error spans when `/config` endpoint is accessed
- **Alert**: No alerts configured
- **Use Case**: Testing distributed tracing and error correlation

## Alert Timing Behavior

### Why 10 Seconds?

The PrometheusRule is configured with `for: 10s` to ensure **deterministic behavior** during demonstrations:

```yaml
- alert: AlertExampleDown
  expr: kube_deployment_status_replicas_unavailable{deployment="alert-example"} > 0
  for: 10s  # Short duration for demo reliability
```

**Timeline:**
1. **t=0s**: Deployment created, pod starts
2. **t=1s**: App reads config, detects "Crash" keyword, exits with code 1
3. **t=1-10s**: Alert condition is true, alert enters **PENDING** state
4. **t=10s**: Alert transitions to **FIRING** state (visible to queries)
5. **Continuous**: Kubernetes restarts pod with exponential backoff (10s, 20s, 40s, 80s...)

### Previous Behavior (2m Duration)

Previously, the alert used `for: 2m`, which caused **non-deterministic results**:
- Queries within 0-2 minutes: "No alerts firing" (alert still pending)
- Queries after 2 minutes: "Alert firing"
- If pod briefly recovers during CrashLoopBackoff, the 2-minute timer resets
- This created inconsistent demo experiences

With `for: 10s`, the alert fires reliably within **10-15 seconds** of deployment.

## Application Behavior

The FastAPI application (see `app/app.py`) supports three config triggers:

### 1. "Crash" - Immediate Exit on Startup
```python
if "Crash" in data:
    print("ERROR: config contained Crash keyword on startup, terminating")
    sys.exit(1)
```
- Used by: `alert-example` deployment
- Effect: CrashLoopBackoff, triggers alerts
- When: During startup (app.py:135-142)

### 2. "Error" - Error Span on /config Endpoint
```python
if "Error" in data:
    emit_error_span(data)  # Creates OpenTelemetry error span
    return Response(content="config triggered error; exiting", status_code=500)
```
- Used by: `my-app-example` pod
- Effect: Generates error traces, exits after 5s delay
- When: When `/config` endpoint is called (app.py:159-168)

### 3. Normal Operation
- Returns config content on `/config`
- Responds "ok" on `/healthz`
- Emits OpenTelemetry traces for all requests

## Testing the Integration

### 1. Deploy the Alert Example
```bash
helm install alert-example ./tests/alert-example/helm/alert-example \
  -n jianrong --create-namespace
```

### 2. Verify Alert Fires (after 10+ seconds)
```bash
# Query Prometheus ALERTS metric
kubectl exec -n openshift-user-workload-monitoring prometheus-user-workload-0 -- \
  promtool query instant 'ALERTS{alertstate="firing", alertname="AlertExampleDown"}'
```

### 3. Query via MCP Server / AI Chat
Example queries that should return consistent results:
- "Any alerts firing in jianrong namespace?"
- "Show me critical alerts"
- "Is AlertExampleDown firing?"
- "Use korrel8r to investigate AlertExampleDown"

**Expected Result**: Alert should be visible within 10-15 seconds of deployment.

### 4. Test Korrel8r Correlation
The alert should be correlatable to:
- **Logs**: Pod crash logs in Loki
- **Traces**: OpenTelemetry spans (if pod runs briefly before crashing)
- **Metrics**: `kube_deployment_status_replicas_unavailable` metric

## Configuration Reference

### Values (values.yaml)

```yaml
apps:
  - name: alert-example
    enabled: true
    workload: deployment      # Creates a Deployment (restarts on crash)
    config:
      message: "Crash on startup"  # Triggers immediate crash
    prometheusRule:
      enabled: true            # Creates AlertExampleDown alert

  - name: my-app-example
    enabled: true
    workload: pod             # Creates a Pod (does not auto-restart)
    config:
      message: "Error detected in configuration"  # Triggers error span
    prometheusRule:
      enabled: false           # No alerts for this example
```

### Environment Variables

The app supports these environment variables:
- `CONFIG_PATH`: Path to config file (default: `/etc/alert-example/config.yaml`)
- `OTEL_SERVICE_NAME`: Service name for traces (default: `alert-example`)
- `OTEL_EXPORTER_OTLP_ENDPOINT`: OTLP collector endpoint
- `OTEL_RESOURCE_ATTRIBUTES`: OpenTelemetry resource attributes

## Troubleshooting

### Alert Not Firing After 10 Seconds

**Check pod status:**
```bash
kubectl get pods -n jianrong -l app=alert-example
```

**Check deployment replicas:**
```bash
kubectl get deployment alert-example -n jianrong
```

**Check if metric exists:**
```bash
# Should return value > 0
kubectl exec -n openshift-user-workload-monitoring prometheus-user-workload-0 -- \
  promtool query instant 'kube_deployment_status_replicas_unavailable{deployment="alert-example"}'
```

### Alert Shows as Pending, Not Firing

Wait at least 10 seconds. The `for: 10s` duration requires the condition to be true continuously.

### "No Alerts Firing" Response from AI Chat

**Possible causes:**
1. Less than 10 seconds elapsed since deployment
2. Chatbot is filtering for `alertstate="firing"` (correct behavior)
3. Prometheus hasn't scraped the metric yet (default scrape interval: 30s)

**Wait 30-40 seconds** after deployment to ensure:
- Metric is scraped
- Alert condition is evaluated
- Alert transitions to firing state

## Architecture

```
┌─────────────────┐
│  alert-example  │ (Deployment)
│   (crashes)     │
└────────┬────────┘
         │
         ├──> ConfigMap (contains "Crash")
         │
         ├──> PrometheusRule (for: 10s)
         │         │
         │         v
         │    ALERTS metric
         │         │
         │         v
         ├──> MCP Server (queries ALERTS)
         │         │
         │         v
         │    AI Chat Response
         │
         └──> Korrel8r (correlates to logs/traces)
```

## Related Files

- `app/app.py` - FastAPI application with crash/error logic
- `app/Dockerfile` - Container image definition
- `helm/alert-example/templates/prometheusrule.yaml` - Alert rule definition
- `helm/alert-example/templates/deployment.yaml` - Kubernetes deployment
- `helm/alert-example/values.yaml` - Configuration values
