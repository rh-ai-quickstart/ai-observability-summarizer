# Dynatrace metrics bridge (OpenTelemetry Collector)

This repository’s **OpenTelemetry Collector** Helm chart (`deploy/helm/observability/otel-collector`) can run an optional pipeline that:

1. **Scrapes** Prometheus text exposition (via the `prometheus` receiver), for example from **Prometheus federation** or from a component’s **`/metrics`** endpoint.
2. **Exports** those series to **Dynatrace SaaS** using **OTLP/HTTP** and an **API token**.

The default install leaves this **disabled** so existing trace-only behavior is unchanged.

## Enable

1. Create a Secret in the **same namespace** as the collector (for example `observability-hub`) with a Dynatrace token that is allowed to **ingest OpenTelemetry / metrics** (scope per your tenant policy):

   ```bash
   oc create secret generic dynatrace-otel-api \
     -n observability-hub \
     --from-literal=apiToken="YOUR_DYNATRACE_TOKEN"
   ```

2. Set your Dynatrace **OTLP/HTTP base** URL. For many SaaS tenants this matches the form documented by Dynatrace for OTLP ingest, for example:

   `https://<environment-id>.live.dynatrace.com/api/v2/otlp`

   Confirm the exact URL and TLS requirements in [Dynatrace OpenTelemetry ingest](https://docs.dynatrace.com/docs/extend-dynatrace/opentelemetry/getting-started/otel-collector-ingest) for your deployment type.

3. Provide **`metricsBridge.prometheus.scrapeConfigs`** (standard Prometheus `scrape_configs` entries). Examples:

   - **Federation** against user-workload Prometheus (narrow `match[]` to Limitador / vLLM / MaaS-related series to control cardinality).
   - **Static** scrape of a `Service` that exposes `limitador_*` metrics on `/metrics`.

4. Install or upgrade Helm with overrides, for example:

   ```bash
   helm upgrade --install otel-collector ./observability/otel-collector \
     -n observability-hub \
     --reuse-values \
     -f values-metrics-bridge.example.yaml
   ```

   Prefer copying `values-metrics-bridge.example.yaml` to a private overlay and editing endpoints and `match[]` there.

## Collector configuration

When `metricsBridge.enabled` is `true`, the chart renders:

- Receiver **`prometheus/bridge`** using your `scrapeConfigs`.
- Exporter **`otlphttp/dynatrace`** targeting `metricsBridge.dynatrace.otlpHttpEndpoint` with header `Authorization: Api-Token ${env:DT_API_TOKEN}`.
- Pipeline **`metrics/bridge`**: `prometheus/bridge` → `batch` / `memory_limiter` → `otlphttp/dynatrace`.
- Pod env **`DT_API_TOKEN`** from the configured Secret.

The existing **`metrics`** pipeline (OTLP in → `debug`) is unchanged.

## Operations notes

- **Cardinality and cost:** Prefer tight federation `match[]` or short scrape intervals only after you understand volume in Dynatrace.
- **RBAC:** Scraping in-cluster Prometheus federation often requires a **token** with access to that Prometheus instance; mount or reference credentials as required by your scrape config (for example `authorization.credentials_file` on the scrape job).
- **Image capabilities:** This assumes the collector image from your OpenTelemetry Operator distribution includes the **prometheus** receiver (common for Red Hat builds). If the collector fails to start, verify receiver support for your operator version.

## Partner branch

This feature is maintained on branch **`partner/dynatrace-metrics-bridge`** for review and iteration before merging to the main development line.
