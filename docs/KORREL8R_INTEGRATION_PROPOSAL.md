## Korrel8r Integration Proposal

### Summary
Integrate Korrel8r into the metric summarizer so that when critical Prometheus alerts are detected (via the existing “chat prometheus” flow), the system automatically queries Korrel8r to find related resources, logs, traces, and events. The goal is to accelerate root cause analysis by surfacing correlated, high-signal context alongside existing alert summaries.

### Feasibility Assessment
- **Purpose fit**: Korrel8r correlates signals across data stores (Prometheus, Loki, Kubernetes, Jaeger/Tempo) using rule-driven graph traversal. Starting from a fired alert, Korrel8r can traverse to related objects and signals, which aligns with our root-cause discovery goal.
- **Integration mode**: In-cluster service with REST API. Provide a starting object (e.g., alert with labels and time window) and request correlated results.
- **OpenShift alignment**: Used to augment alert troubleshooting in OpenShift environments, indicating practicality and maturity for our use case.
- **Risks**: Quality depends on rule coverage and observability store availability; requires careful time scoping, guardrails, and graceful degradation.

### Current Code Integration Points
- Alerts intent detection and LLM summary flow:
  - `src/core/promql_service.py` → `select_queries_directly(...)` builds `ALERTS{alertstate="firing"}` queries.
  - `src/core/llm_summary_service.py` → `generate_llm_summary(...)` has a dedicated alerts path and formats alert analyses.
- Alert retrieval helpers (alternate path):
  - `src/core/alerts.py` → `fetch_alerts_from_prometheus(...)` and `fetch_all_rule_definitions()`.
  - `src/alerting/alert_receiver.py` → `get_active_alerts()` for Alertmanager.

These provide natural hooks to trigger correlation lookups once alerts are identified.

### Proposed User Experience
- When a user asks about alerts or when the system surfaces firing critical alerts, the response includes a concise “Correlated signals” section per alert with:
  - Related Kubernetes objects (kind/name/namespace) and recent events.
  - Logs (Loki query link and 1–3 sample lines when available).
  - Traces (trace IDs/links where present).
  - Suggested pivots (e.g., namespace → deployment → pod logs).
- API responses also return a structured `correlations` object for UI and future automation.

### Architecture & Data Flow
1. User asks about alerts or alerts are detected via Thanos query.
2. System identifies top-N recent alerts (prioritize severity=critical, then warning).
3. For each selected alert, build a Korrel8r starting object using alert labels (e.g., `namespace`, `deployment`, `pod`, `service`, `job`, `cluster`) and a bounded time window centered on the alert timestamp.
4. Call Korrel8r REST API to traverse to related nodes across stores (Kubernetes API, Loki, Jaeger/Tempo, etc.).
5. Normalize results to a common schema, rank by proximity/relevance, cap to per-alert and overall limits.
6. Present a compact textual summary and include the full structured results in the API payload.

### Components to Add
- `src/core/korrel8r_client.py` (new): Thin REST client for Korrel8r.
  - Configurable base URL, auth, timeout, retries, and rate limits.
  - Methods like `find_related(start_object, classes, time_range)`.
- `src/core/correlation_service.py` (new): Correlation orchestration.
  - Translates alert labels to Korrel8r starting objects.
  - Invokes client calls to retrieve related objects/logs/traces/events.
  - Applies deduplication, ranking, limits; returns structured `CorrelationFinding` results.
- `src/mcp_server/tools/korrel8r_tools.py` (new): MCP tool wrappers around correlation features.
  - Expose Korrel8r correlation and health checks as MCP tools consumable by UI and automations.
- Configuration (extend `src/core/config.py`):
  - `KORREL8R_ENABLED` (bool, default false)
  - `KORREL8R_URL`
  - `KORREL8R_TIMEOUT_SECONDS` (e.g., 5–10s)

### API Expectations (Korrel8r)
- REST endpoints that accept a starting object (class, labels/attributes, time window) and return related objects/edges, filterable by store/class.
- Results should include stable identifiers and optional deep links (e.g., Loki query URIs, Jaeger trace links, Kubernetes Console/Grafana paths).
- The `korrel8r_client` should be adaptable if endpoint paths/parameters differ across environments.

### MCP Toolization Plan

We will expose Korrel8r capabilities as MCP tools so agents/clients can request correlations directly, independent of the REST path in the API server.

Files:
- `src/mcp_server/tools/korrel8r_tools.py` (new)
- Wire-up in `src/mcp_server/observability_mcp.py` (tool registration)

### Non-Goals (Initial Phase)
- Building a custom correlation engine; Korrel8r is the source of truth.
- Full UI drill-downs; we provide compact summaries and links rather than a new navigation surface.
- Changing alerting rules; we consume existing rules and labels.

### Risks & Mitigations
- **Rule coverage & data quality**: Start with Korrel8r default rules; iterate with SRE feedback.
- **Store availability**: Detect/store-specific failures and degrade gracefully; annotate missing stores in results.
- **Latency & rate limits**: Short timeouts, caching, deduplication, and caps; per-request correlation budget.
- **LLM context bloat**: Keep correlations concise in text; include full structure out-of-band in API.

### Acceptance Criteria
- For a firing critical alert containing pod/deployment labels:
  - Related Kubernetes object(s) and 1–3 recent events are returned.
  - A Loki query link and at least one sample log line are provided when logs exist.
  - Trace links are included when available.
  - Errors in correlation do not block alert summaries; correlations are optional and clearly flagged.
  - Feature flags can enable/disable the integration at runtime.

### Milestones & Timeline (Indicative)
- **Week 1**: Confirm Korrel8r deployment/API, finalize response schema, add configuration and `korrel8r_client` scaffold with mocks.
- **Week 2**: Implement `correlation_service` adapters (objects/logs/traces/events), ranking/limits, unit tests.
- **Week 3**: Wire correlations into alert flow in `generate_llm_summary(...)` and API payloads; add concise UI text; dev-cluster e2e.
- **Week 4**: Hardening (timeouts, rate limits, observability), documentation, and staged rollout with `KORREL8R_ENABLED=false` default.

### Rollout Plan
1. Ship disabled by default behind `KORREL8R_ENABLED`.
2. Enable in a non-prod cluster; validate correlation accuracy, latency, and user value.
3. Iterate rule and ranking tuning with SRE feedback.
4. Gradual enablement in production environments.

### Open Questions
- Which Korrel8r stores are guaranteed in target environments (Loki, Jaeger/Tempo, Kubernetes API)?
- Preferred deep-link targets (OpenShift Console, Grafana/Loki, Tempo/Jaeger)?
- Any PII/log redaction requirements for sampled log lines in UI/API?
- Do we need per-tenant scoping beyond namespace for multi-tenant clusters?

### References
- Red Hat blog: Observability signal correlation in OpenShift — see “Korrel8r” overview.
- Korrel8r documentation site for concepts, stores, and API.

—
This proposal is for review only. No implementation will begin until it is approved.

---

## Appendix A: Provisional Korrel8r API Contract (to be verified)

Notes:
- Endpoint names and shapes below are representative and intended to de-risk design and testing. We will align to the actual Korrel8r API during implementation.
- All requests include short timeouts, explicit limits, and are idempotent.

### Base configuration
- Base URL: `KORREL8R_URL` (e.g., `https://korrel8r.k8s.svc.cluster.local`)
- Auth: bearer token or mTLS (cluster service account). Reuse existing CA bundle.
- Timeout: `KORREL8R_TIMEOUT_SECONDS` (default 8s)

### Endpoint: Find related signals
- Method: `POST`
- Path (candidate): `/api/v1/related`
- Purpose: From a starting alert object, traverse to related resources in selected stores/classes.

Request (example):
```json
{
  "start": {
    "class": "prom/alert", 
    "labels": {
      "alertname": "KubePodCrashLooping",
      "namespace": "llm-serving",
      "pod": "vllm-inference-7d6c9d6bfc-abc12"
    },
    "timestamp": "2025-10-02T11:17:31Z"
  },
  "targets": [
    "k8s/object",
    "k8s/event",
    "loki/log",
    "tempo/trace"
  ],
  "timeWindow": {
    "start": "2025-10-02T11:07:31Z",
    "end": "2025-10-02T11:27:31Z"
  },
  "limit": 50,
  "depth": 2
}
```

Response (example):
```json
{
  "results": {
    "k8s/object": [
      {"kind": "Deployment", "name": "vllm-inference", "namespace": "llm-serving", "uid": "...", "link": "https://console/..."},
      {"kind": "Pod", "name": "vllm-inference-7d6c9d6bfc-abc12", "namespace": "llm-serving", "uid": "...", "link": "https://console/..."}
    ],
    "k8s/event": [
      {"involvedObject": {"kind": "Pod", "name": "vllm-inference-7d6c9d6bfc-abc12"}, "reason": "BackOff", "message": "Back-off restarting failed container", "firstTimestamp": "2025-10-02T11:12:00Z", "lastTimestamp": "2025-10-02T11:16:30Z"}
    ],
    "loki/log": [
      {"ts": "2025-10-02T11:16:15Z", "line": "OOMKilled", "stream": {"pod": "vllm-inference-7d6c9d6bfc-abc12", "namespace": "llm-serving"}, "link": "https://loki/grafana/explore?..."}
    ],
    "tempo/trace": [
      {"traceId": "c9b1...", "link": "https://tempo/trace/c9b1..."}
    ]
  },
  "meta": {"traversalDepth": 2, "durationMs": 412}
}
```

Error (example):
```json
{
  "error": {
    "code": "STORE_UNAVAILABLE",
    "message": "Loki not reachable",
    "store": "loki/log"
  }
}
```

### Endpoint: Health
- Method: `GET`
- Path (candidate): `/healthz`
- Purpose: Liveness/readiness for circuit-breaking and feature flagging.

---

## Appendix B: Our API Response Extension (draft)

We will extend alert-oriented responses to include a structured `correlations` field and keep the textual summary concise. Below is a representative JSON shape for one alert.

```json
{
  "alert": {
    "alertname": "KubePodCrashLooping",
    "severity": "critical",
    "namespace": "llm-serving",
    "labels": {"pod": "vllm-inference-7d6c9d6bfc-abc12"},
    "timestamp": "2025-10-02T11:17:31Z"
  },
  "analysisText": "... existing concise LLM analysis ...\n\nCorrelated signals: 1 Deployment, 1 Pod, 1 Event, 1 Loki log sample.",
  "correlations": {
    "resources": [
      {"kind": "Deployment", "name": "vllm-inference", "namespace": "llm-serving", "uid": "...", "link": "https://console/..."},
      {"kind": "Pod", "name": "vllm-inference-7d6c9d6bfc-abc12", "namespace": "llm-serving", "uid": "...", "link": "https://console/..."}
    ],
    "events": [
      {"kind": "Event", "reason": "BackOff", "message": "Back-off restarting failed container", "firstTimestamp": "2025-10-02T11:12:00Z", "lastTimestamp": "2025-10-02T11:16:30Z"}
    ],
    "logs": {
      "query": "{namespace=\"llm-serving\", pod=\"vllm-inference-7d6c9d6bfc-abc12\"}",
      "sampleLines": ["OOMKilled"],
      "link": "https://loki/grafana/explore?..."
    },
    "traces": [
      {"traceId": "c9b1...", "link": "https://tempo/trace/c9b1..."}
    ],
    "confidence": 0.86,
    "notes": ["Loki unreachable"],
    "limits": {"maxItems": 50}
  }
}
```

Field notes:
- `confidence` is derived from rule distance, time proximity, and label overlap.
- `notes` records per-store degradations for transparency.
- All links are optional; include when deep-links are configured.

---

## Appendix C: UI Wireframe (textual)

Alert section (per alert):

```
### KubePodCrashLooping (critical)
Namespace: llm-serving | Timestamp: 2025-10-02 11:17 UTC

Impact: ...
Action: ...
Troubleshooting commands: ...

Correlated signals
- Resources: Deployment vllm-inference, Pod vllm-inference-7d6c9d6bfc-abc12
- Events: BackOff — Back-off restarting failed container (11:12–11:16)
- Logs: OOMKilled (sample) [View logs]
- Traces: c9b1… [Open trace]
```

Interaction details:
- “View logs” opens Grafana Explore with prefilled Loki query/time window.
- “Open trace” opens Tempo/Jaeger for the given `traceId`.
- Resource names link to OpenShift Console resource pages when configured.

---

## Appendix D: Configuration Keys (initial set)

```ini
# Feature flag
KORREL8R_ENABLED=false

# Service
KORREL8R_URL=
KORREL8R_TIMEOUT_SECONDS=8

# Time window around alert timestamp
KORREL8R_TIME_SKEW_SEC=600

# Deep-link bases (optional but recommended)
# OpenShift Console base, e.g., https://console-openshift-console.apps.<cluster-domain>
CONSOLE_BASE_URL=
# Grafana base, e.g., https://grafana.apps.<cluster-domain>
GRAFANA_BASE_URL=
# Native Tempo base, e.g., https://tempo.apps.<cluster-domain>
TEMPO_BASE_URL=
# Grafana Tempo datasource UID (for Explore links), e.g., ds_uid_Tempo
TEMPO_DATASOURCE_UID=
# Grafana Loki datasource UID (for Explore links), e.g., ds_uid_Loki
LOKI_DATASOURCE_UID=
```

---

## Appendix E: Deep-link URL Patterns (Tempo and OpenShift Console)

These patterns enable one-click navigation from correlated results. Use whichever destinations exist in your environment.

### Tempo deep links

- Native Tempo UI (simplest):
  - Pattern: `{TEMPO_BASE_URL}/trace/{traceId}`
  - Example: `https://tempo.apps.example.com/trace/c9b1abc1234def56`

- Grafana Explore (Tempo datasource):
  - Base: `{GRAFANA_BASE_URL}/explore`
  - Unencoded left parameter pattern:
    - `left=(datasource:'{TEMPO_DATASOURCE_UID}',queries:!((query:'{traceID="{traceId}"}')),range:(from:'{fromISO}',to:'{toISO}'))`
  - Full URL (note: URL-encode the `left` argument when generating links):
    - `{GRAFANA_BASE_URL}/explore?left=<urlencoded-left>`
  - Example (unencoded):
    - `https://grafana.apps.example.com/explore?left=(datasource:'ds_uid_Tempo',queries:!((query:'{traceID="c9b1abc1234def56"}')),range:(from:'2025-10-02T11:07:31Z',to:'2025-10-02T11:27:31Z'))`

Notes:
- Always URL-encode the `left` parameter. Keep time window aligned to the alert window for context.

### OpenShift Console resource links

- Base: `{CONSOLE_BASE_URL}` (e.g., `https://console-openshift-console.apps.example.com`)

- Namespace-scoped resources (core/apps kinds):
  - Pattern: `{CONSOLE_BASE_URL}/k8s/ns/{namespace}/{resourcePlural}/{name}`
  - Examples:
    - Pod: `/k8s/ns/{namespace}/pods/{name}`
    - Deployment: `/k8s/ns/{namespace}/deployments/{name}`
    - StatefulSet: `/k8s/ns/{namespace}/statefulsets/{name}`
    - DaemonSet: `/k8s/ns/{namespace}/daemonsets/{name}`
    - ReplicaSet: `/k8s/ns/{namespace}/replicasets/{name}`
    - Service: `/k8s/ns/{namespace}/services/{name}`

- Cluster-scoped resources:
  - Pattern: `{CONSOLE_BASE_URL}/k8s/cluster/{resourcePlural}/{name}`
  - Examples:
    - Namespace: `/k8s/cluster/namespaces/{name}`
    - Node: `/k8s/cluster/nodes/{name}`

- Generic GVK fallback (works for CRDs and explicit kinds):
  - Namespace-scoped: `{CONSOLE_BASE_URL}/k8s/ns/{namespace}/{group}~{version}~{kind}/{name}`
  - Cluster-scoped: `{CONSOLE_BASE_URL}/k8s/cluster/{group}~{version}~{kind}/{name}`
  - Examples:
    - Deployment (apps/v1): `/k8s/ns/llm-serving/apps~v1~Deployment/vllm-inference`
    - Pod (core/v1): `/k8s/ns/llm-serving/core~v1~Pod/vllm-inference-7d6c9d6bfc-abc12`

Implementation tips:
- Maintain a small mapping from common `kind` to `resourcePlural` for the simple patterns above.
- Fallback to the explicit `{group}~{version}~{kind}` pattern when mapping is unknown or for CRDs.

---

## Appendix F: Example link builders (Python snippets)

These examples show how to construct deep links safely. They can live in a small utility module used by the correlation formatter.

```python
import urllib.parse
from typing import Dict, Optional, Set


def build_console_resource_link(
    *,
    kind: str,
    name: str,
    namespace: Optional[str],
    console_base_url: str,
    group: Optional[str] = None,
    version: Optional[str] = None,
    resource_plural_map: Optional[Dict[str, str]] = None,
    cluster_scoped_kinds: Optional[Set[str]] = None,
) -> Optional[str]:
    """Return an OpenShift Console URL for a resource.

    Prefers simple plural patterns when known; otherwise falls back to GVK format.
    """
    if not console_base_url or not kind or not name:
        return None

    safe_base = console_base_url.rstrip('/')
    kind_norm = (kind or '').strip()
    is_cluster_scoped = kind_norm in (cluster_scoped_kinds or {"Node", "Namespace"})

    # Try simple plural pattern for common kinds
    if resource_plural_map and kind_norm in resource_plural_map:
        plural = resource_plural_map[kind_norm]
        if is_cluster_scoped:
            return f"{safe_base}/k8s/cluster/{plural}/{urllib.parse.quote(name)}"
        if not namespace:
            return None
        return f"{safe_base}/k8s/ns/{urllib.parse.quote(namespace)}/{plural}/{urllib.parse.quote(name)}"

    # Fallback to explicit GVK pattern (works for CRDs)
    group_val = (group or ("" if kind_norm in {"Pod", "Service", "Namespace", "Node"} else "apps")) or "core"
    version_val = version or "v1"
    gvk = f"{group_val}~{version_val}~{kind_norm}"
    if is_cluster_scoped:
        return f"{safe_base}/k8s/cluster/{gvk}/{urllib.parse.quote(name)}"
    if not namespace:
        return None
    return f"{safe_base}/k8s/ns/{urllib.parse.quote(namespace)}/{gvk}/{urllib.parse.quote(name)}"


def build_tempo_trace_link(*, trace_id: str, tempo_base_url: str) -> Optional[str]:
    """Native Tempo trace link."""
    if not tempo_base_url or not trace_id:
        return None
    return f"{tempo_base_url.rstrip('/')}/trace/{urllib.parse.quote(trace_id)}"


def build_grafana_tempo_explore_link(
    *,
    trace_id: str,
    grafana_base_url: str,
    tempo_datasource_uid: str,
    start_iso: str,
    end_iso: str,
) -> Optional[str]:
    """Grafana Explore link for a Tempo trace/time range. Ensure `left` is URL-encoded."""
    if not (grafana_base_url and tempo_datasource_uid and trace_id and start_iso and end_iso):
        return None
    left = (
        f"(datasource:'{tempo_datasource_uid}',"
        f"queries:!((query:'{{traceID=\\"{trace_id}\\"}}')),"
        f"range:(from:'{start_iso}',to:'{end_iso}'))"
    )
    left_enc = urllib.parse.quote(left, safe='')
    return f"{grafana_base_url.rstrip('/')}/explore?left={left_enc}"


def build_grafana_loki_explore_link(
    *,
    log_query: str,
    grafana_base_url: str,
    loki_datasource_uid: str,
    start_iso: str,
    end_iso: str,
) -> Optional[str]:
    """Grafana Explore link for a Loki log query/time range. Escapes single quotes in expr."""
    if not (grafana_base_url and loki_datasource_uid and log_query and start_iso and end_iso):
        return None
    expr = log_query.replace("'", "\\'")
    left = (
        f"(datasource:'{loki_datasource_uid}',"
        f"queries:!((expr:'{expr}')),"
        f"range:(from:'{start_iso}',to:'{end_iso}'))"
    )
    left_enc = urllib.parse.quote(left, safe='')
    return f"{grafana_base_url.rstrip('/')}/explore?left={left_enc}"
```

---

## Appendix G: Example Scenarios and Expected Results

These scenarios help validate the end-to-end flow (alerts → Korrel8r → summary + deep links). Replace base URLs and UIDs with your environment.

### Scenario 1: CrashLooping vLLM pod (critical)

- Inputs
  - Alert labels:
    - `alertname=KubePodCrashLooping`
    - `namespace=llm-serving`
    - `pod=vllm-inference-7d6c9d6bfc-abc12`
    - `severity=critical`
  - Time window: alert timestamp ± 10m
  - Config:
    - `CONSOLE_BASE_URL=https://console-openshift-console.apps.example.com`
    - `GRAFANA_BASE_URL=https://grafana.apps.example.com`
    - `TEMPO_BASE_URL=https://tempo.apps.example.com`
    - `TEMPO_DATASOURCE_UID=ds_uid_Tempo`
    - `LOKI_DATASOURCE_UID=ds_uid_Loki`

- Korrel8r request (provisional):
```json
{
  "start": {
    "class": "prom/alert",
    "labels": {
      "alertname": "KubePodCrashLooping",
      "namespace": "llm-serving",
      "pod": "vllm-inference-7d6c9d6bfc-abc12"
    },
    "timestamp": "2025-10-02T11:17:31Z"
  },
  "targets": ["k8s/object", "k8s/event", "loki/log", "tempo/trace"],
  "timeWindow": {"start": "2025-10-02T11:07:31Z", "end": "2025-10-02T11:27:31Z"},
  "limit": 50,
  "depth": 2
}
```

- Korrel8r sample response:
```json
{
  "results": {
    "k8s/object": [
      {"kind": "Deployment", "name": "vllm-inference", "namespace": "llm-serving"},
      {"kind": "Pod", "name": "vllm-inference-7d6c9d6bfc-abc12", "namespace": "llm-serving"}
    ],
    "k8s/event": [
      {"involvedObject": {"kind": "Pod", "name": "vllm-inference-7d6c9d6bfc-abc12"}, "reason": "BackOff", "message": "Back-off restarting failed container", "lastTimestamp": "2025-10-02T11:16:30Z"}
    ],
    "loki/log": [
      {"ts": "2025-10-02T11:16:15Z", "line": "OOMKilled", "stream": {"namespace": "llm-serving", "pod": "vllm-inference-7d6c9d6bfc-abc12"}}
    ],
    "tempo/trace": []
  }
}
```

- Expected deep links
  - Console Deployment:
    - `https://console-openshift-console.apps.example.com/k8s/ns/llm-serving/deployments/vllm-inference`
  - Console Pod:
    - `https://console-openshift-console.apps.example.com/k8s/ns/llm-serving/pods/vllm-inference-7d6c9d6bfc-abc12`
  - Grafana Loki Explore (unencoded left shown):
    - `https://grafana.apps.example.com/explore?left=(datasource:'ds_uid_Loki',queries:!((expr:'{namespace="llm-serving", pod="vllm-inference-7d6c9d6bfc-abc12"}')),range:(from:'2025-10-02T11:07:31Z',to:'2025-10-02T11:27:31Z'))`

- Expected summary snippet (human-readable):
```
Correlated signals
- Resources: Deployment vllm-inference, Pod vllm-inference-7d6c9d6bfc-abc12
- Events: BackOff — Back-off restarting failed container (last: 11:16:30Z)
- Logs: OOMKilled (sample) [View logs]
```

- Expected structured payload (excerpt):
```json
{
  "correlations": {
    "resources": [
      {"kind": "Deployment", "name": "vllm-inference", "namespace": "llm-serving", "link": "https://console-openshift-console.apps.example.com/k8s/ns/llm-serving/deployments/vllm-inference"},
      {"kind": "Pod", "name": "vllm-inference-7d6c9d6bfc-abc12", "namespace": "llm-serving", "link": "https://console-openshift-console.apps.example.com/k8s/ns/llm-serving/pods/vllm-inference-7d6c9d6bfc-abc12"}
    ],
    "events": [
      {"kind": "Event", "reason": "BackOff", "message": "Back-off restarting failed container", "lastTimestamp": "2025-10-02T11:16:30Z"}
    ],
    "logs": {
      "query": "{namespace=\"llm-serving\", pod=\"vllm-inference-7d6c9d6bfc-abc12\"}",
      "sampleLines": ["OOMKilled"],
      "link": "https://grafana.apps.example.com/explore?left=(...)"
    },
    "traces": []
  }
}
```

Validation checklist:
- Console links resolve to Deployment and Pod pages.
- Grafana link opens Explore with time range and pod logs.
- Summary contains event and log sample as shown.

---

### Scenario 2: Service connectivity issue (warning → critical escalation)

- Inputs
  - Alert labels:
    - `alertname=KubeProxyDown`
    - `namespace=ml-platform`
    - `severity=critical`
  - Time window: alert timestamp ± 10m

- Korrel8r sample response:
```json
{
  "results": {
    "k8s/object": [
      {"kind": "Service", "name": "model-gateway", "namespace": "ml-platform"},
      {"kind": "EndpointSlice", "name": "model-gateway-abc12", "namespace": "ml-platform"}
    ],
    "k8s/event": [
      {"involvedObject": {"kind": "EndpointSlice", "name": "model-gateway-abc12"}, "reason": "Unhealthy", "message": "Readiness probe failed", "lastTimestamp": "2025-10-02T09:03:12Z"}
    ],
    "loki/log": [],
    "tempo/trace": []
  }
}
```

- Expected deep links
  - Service:
    - `https://console-openshift-console.apps.example.com/k8s/ns/ml-platform/services/model-gateway`
  - EndpointSlice (GVK fallback):
    - `https://console-openshift-console.apps.example.com/k8s/ns/ml-platform/discovery.k8s.io~v1~EndpointSlice/model-gateway-abc12`

- Expected summary snippet:
```
Correlated signals
- Resources: Service model-gateway, EndpointSlice model-gateway-abc12
- Events: Unhealthy — Readiness probe failed (last: 09:03:12Z)
- Logs: No related log samples found in window
```

Validation checklist:
- Console links resolve to Service and EndpointSlice.
- Summary correctly reflects absence of logs and includes event detail.





