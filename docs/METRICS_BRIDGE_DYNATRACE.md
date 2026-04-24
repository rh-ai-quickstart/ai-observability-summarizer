# Dynatrace export (OpenTelemetry Collector)

This repository’s **OpenTelemetry Collector** Helm chart (`deploy/helm/observability/otel-collector`) can send telemetry to **Dynatrace SaaS** over **OTLP/HTTP** with an **API token**. All options are **off by default**.

You can use **one or more** of the following:

1. **Prometheus scrape bridge** — `prometheus` receiver scrapes federation or `/metrics` targets, then **`metrics/bridge`** → Dynatrace (`metricsBridge.enabled` + `prometheus.scrapeConfigs`).
2. **Duplicate OTLP traces** — same **OTLP** traces the apps already send to this collector also go to Dynatrace (`metricsBridge.forwardOtelTraces`).
3. **Duplicate OTLP metrics** — same **OTLP** metrics pipeline also exports to Dynatrace (`metricsBridge.forwardOtelMetrics`).

For (1) you must set **`metricsBridge.dynatrace.otlpHttpEndpoint`** and **`apiTokenSecretName`**. The same credentials are used for (2) and (3).

## Enable

1. Create a Secret in the **same namespace** as the collector (for example `observability-hub`) with a Dynatrace token that is allowed to **ingest OpenTelemetry / metrics** (scope per your tenant policy):

   ```bash
   oc create secret generic dynatrace-otel-api \
     -n observability-hub \
     --from-literal=apiToken="YOUR_DYNATRACE_TOKEN"
   ```

2. Set your Dynatrace **OTLP/HTTP base** URL. For many SaaS tenants this matches the form documented by Dynatrace for OTLP ingest, for example:

   `https://<environment-id>.live.dynatrace.com/api/v2/otlp` (for example `https://kgs37200.live.dynatrace.com/api/v2/otlp` when the UI host is `kgs37200.apps.dynatrace.com`)

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

When **`metricsBridge.dynatrace.otlpHttpEndpoint`** and **`apiTokenSecretName`** are set **and** at least one of **`metricsBridge.enabled`**, **`forwardOtelTraces`**, or **`forwardOtelMetrics`** is true, the chart renders:

- Exporter **`otlp_http/dynatrace`** with header `Authorization: Api-Token ${env:DT_API_TOKEN}`.
- Pod env **`DT_API_TOKEN`** from that Secret.

Additionally:

- **`metricsBridge.enabled`** and a **non-empty** `prometheus.scrapeConfigs`: receiver **`prometheus/bridge`** and pipeline **`metrics/bridge`** (`prometheus/bridge` → `batch` / `memory_limiter` → `otlp_http/dynatrace`).
- **`forwardOtelTraces`**: appends **`otlp_http/dynatrace`** to the existing **`traces`** pipeline exporters (Tempo / `debug` unchanged).
- **`forwardOtelMetrics`**: appends **`otlp_http/dynatrace`** to the existing **`metrics`** pipeline exporters.

### OTLP-only example (no Prometheus scrape)

See `deploy/helm/observability/otel-collector/values-dynatrace-otel-forward.example.yaml`.

### MaaS / vLLM / Prometheus metrics → Dynatrace (via this collector)

**Goal:** Get **Prometheus text metrics** (for example `vllm_*` from model serving, `limitador_*` from MaaS rate limiting) into Dynatrace **through the same OpenTelemetry Collector**, using the **`prometheus` receiver** and the existing **`otlp_http/dynatrace`** exporter.

**Flow:**

```text
Prometheus /federate OR Pod/Service :metrics  --HTTP scrape-->  Collector (prometheus/bridge)  --OTLP/HTTP-->  Dynatrace
```

This is **independent** of Python OTLP auto-instrumentation. Your app OTLP path does **not** pull `vllm_*` out of Prometheus for you.

**Recommended steps:**

1. **Keep** (or create) the Dynatrace **Secret** in `observability-hub` as in [Enable](#enable) above.

2. **Discover where MaaS / vLLM metrics live today** (usually already in **user-workload Prometheus** if you use `ServiceMonitor` / UWM):
   - In OpenShift: **Observe → Metrics** (user workload) or Grafana, confirm series like `vllm_num_requests_total` exist and which **labels** (`namespace`, `pod`, etc.) you care about.

3. **Choose ingest strategy:**
   - **Federation (typical for “many series already in Prometheus”):** one scrape job hits `https://prometheus-user-workload.openshift-user-workload-monitoring.svc:9092/federate` with one or more `match[]` selectors.
   - **Direct scrape:** add a second job that hits a **Service DNS** `:port/metrics` (for example Limitador) if those metrics are **not** in Prometheus or you want a smaller slice.

4. **Start with narrow `match[]`, not “all metrics”:**  
   Example selectors: `{__name__=~"vllm_.*"}`, `{__name__=~"limitador_.*"}`  
   Widening to “everything” (`{__name__=~".+"}`) can **overload** Prometheus, the collector, and Dynatrace cost.

5. **RBAC for federation (required on OpenShift):**  
   The scrape config uses **`bearer_token_file`**: `/var/run/secrets/kubernetes.io/serviceaccount/token` (the collector pod’s ServiceAccount). That identity must be allowed to call **user-workload Prometheus** `/federate`.  
   If logs show **`Failed to scrape Prometheus endpoint`** for `job=uwm-federate-*` (often with **`up`** and no series), check for **403** in collector logs at **debug** level, or test from a debug pod with the same token.  
   Typical fix (cluster-admin): bind **`cluster-monitoring-view`** to the collector ServiceAccount:

   ```bash
   oc create clusterrolebinding otel-collector-monitoring-view \
     --clusterrole=cluster-monitoring-view \
     --serviceaccount=observability-hub:otel-collector
   ```

   Adjust namespace if the collector runs elsewhere. Your org may prefer a **narrower custom ClusterRole** instead of `cluster-monitoring-view`—use what your platform team approves.

6. **If scrape still fails:** confirm **service and port** (`oc get svc -n openshift-user-workload-monitoring`), try full DNS **`.svc.cluster.local`**, and confirm **`scheme: https`** matches the service (some setups use **http** on the internal port—rare).

7. **Merge values and upgrade Helm:**  
   Use `deploy/helm/observability/otel-collector/values-dynatrace-maas-prometheus.example.yaml` as a starting point (copy it out of git, edit hosts and `match[]`), then:

   ```bash
   cd deploy/helm
   helm upgrade --install otel-collector ./observability/otel-collector \
     -n observability-hub \
     --set global.namespace=observability-hub \
     -f /path/to/your-private-overlay.yaml
   ```

8. **Verify:**  
   - Collector logs: no repeated **403** on scrape; occasional Dynatrace **partial success** on OTLP **metrics** may still appear for SDK metrics if `forwardOtelMetrics` is true.  
   - Dynatrace **Data explorer**: search for `vllm_` after traffic; series should be **selectable** (not gray) once points exist.

**Files:**

- `values-dynatrace-maas-prometheus.example.yaml` — federation + optional direct scrape + commented “all metrics” job.  
- `values-dynatrace-otel-forward.example.yaml` — OTLP duplicate export only (no Prometheus).

## Operations notes

- **Dynatrace “Partial success” on metrics:** Dynatrace may accept most OTLP metric data points but **reject a subset** (for example OpenTelemetry SDK internal series such as `otel.sdk.metric_reader.collection.duration` as cumulative histogram, or `otel.sdk.span.started` as monotonic cumulative sum). That shows as a **warning** in collector logs, not a full failure. Application metrics and traces can still ingest. To reduce noise: turn off **`forwardOtelMetrics`** if you only care about traces and Prometheus-scraped metrics, or tune Python instrumentation so it emits fewer SDK self-metrics.
- **Deprecation `otlphttp` → `otlp_http`:** This chart uses exporter IDs **`otlp_http/dev`** and **`otlp_http/dynatrace`** (Collector ≥ 0.144).

- **Cardinality and cost:** Prefer tight federation `match[]` or short scrape intervals only after you understand volume in Dynatrace.
- **RBAC:** Scraping in-cluster Prometheus federation often requires a **token** with access to that Prometheus instance; mount or reference credentials as required by your scrape config (for example `authorization.credentials_file` on the scrape job).
- **Image capabilities:** This assumes the collector image from your OpenTelemetry Operator distribution includes the **prometheus** receiver (common for Red Hat builds). If the collector fails to start, verify receiver support for your operator version.

## Partner branch

This feature is maintained on branch **`partner/dynatrace-metrics-bridge`** for review and iteration before merging to the main development line.
