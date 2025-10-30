## Korrel8r Integration (Current Design and Implementation)

This document consolidates previous Korrel8r proposals into a single, up-to-date reference that reflects the current implementation across both vLLM and OpenShift analysis flows.

### Overview
- Korrel8r correlates observability signals across Prometheus, Kubernetes, Loki and Tempo.
- We enrich prompts with correlated log context:
  - vLLM: logs related to the vLLM deployment/pods
  - OpenShift: logs related to pods in Failed or CrashLoopBackOff

### Key implementation points
- `core/korrel8r_client.py`
  - `_get`/`_post` wrappers with bearer token forward and in-cluster CA handling.
  - `_simplify_log_objects`: normalizes Korrel8r log objects into `{namespace, pod, level, message, timestamp}`; strips ANSI; extracts level; deduplicates by `(namespace, pod, level, message)` keeping the latest `timestamp`.
  - `query_objects(query)`: returns simplified logs when applicable.
- `core/korrel8r_service.py`
  - `fetch_goal_query_objects(goals, query)`: calls `list_goals`, iterates returned queries, executes `query_objects`, aggregates results.

### vLLM flow
- `core/metrics.py` → `build_correlated_context_from_metrics(metric_dfs, model_name, start_ts, end_ts)`
  - Collects unique `(namespace, pod)` pairs from metrics (or from a provided DataFrame).
  - For each pair, builds a Korrel8r start query, fetches logs via `fetch_goal_query_objects` with goals `["log:application","log:infrastructure"]`.
  - Filters out entries with `DEBUG`, `INFO`, `UNKNOWN` levels.
  - Sorts aggregated logs by severity (CRITICAL/FATAL > ERROR > WARN/WARNING > INFO > DEBUG > TRACE), then by timestamp (newest first) using `sort_logs_by_severity_then_time`.
  - Formats up to `MAX_NUM_LOG_ROWS` lines: `- namespace=<ns> pod=<pod> level=<LEVEL> <message>`.
  - Optional test injection: if `INJECT_VLLM_ERROR_LOG_MSG` is set, appends one synthetic ERROR line.
- `mcp_server/tools/observability_vllm_tools.py`
  - Calls `build_correlated_context_from_metrics` and passes the string into the vLLM prompt.
- `core/llm_client.py` → `build_prompt(...)`
  - Includes the returned log context under the “LOGS/TRACES DATA” section.

### OpenShift flow
- `core/metrics.py` → `analyze_openshift_metrics(...)`
  - Fetches category metrics per scope.
  - Additionally runs PromQL to obtain candidate `(namespace, pod)` pairs:
    - `max by (namespace, pod) ((kube_pod_status_phase{phase="Failed"} == 1) or (kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} == 1))`
  - Wraps the result into a DataFrame, passes as `metric_dfs` to `build_correlated_context_from_metrics` to build the log context string.
- `core/llm_client.py` → `build_openshift_prompt(...)`
  - Accepts optional `log_trace_data` and renders a “Correlated Logs/Traces (top N)” section when present.

### Log selection and formatting
- Filtering: skip `DEBUG`, `INFO`, `UNKNOWN` levels.
- Sorting: severity then timestamp (desc), via `sort_logs_by_severity_then_time`.
- Limit: `MAX_NUM_LOG_ROWS` (default 10 via env/Helm) controls the number of lines appended.
- Format: `- namespace=<ns> pod=<pod> level=<LEVEL> <message>`.

### Configuration
- `KORREL8R_ENABLED`: enable/disable enrichment.
- `KORREL8R_URL`: Korrel8r base URL.
- `MAX_NUM_LOG_ROWS`: max number of lines in prompts (default 10; Helm exposed in mcp-server chart).
- `INJECT_VLLM_ERROR_LOG_MSG`: if set, appends a synthetic error line (testing only).

### Korrel8r Deployment via Console UIPlugin (Troubleshooting Panel)
Korrel8r is typically surfaced in OpenShift Console through the Troubleshooting Panel UIPlugin.

- Deploy Cluster Observability Operator (COO) in OpenShift.
- Deploy/enable the UIPlugin that integrates the Troubleshooting Panel.
- Verify the Korrel8r Console configuration ConfigMap includes the correct domain configuration (stores/classes, URL/route, etc.).
  - Ensure the domains and backends (e.g., `k8s`, `loki/log`, `tempo/trace`, `metric/metric`) match your cluster endpoints.
  - Validate that the Korrel8r service/route referenced by the plugin is reachable from the Console namespace.

When correctly configured, the Troubleshooting Panel can pivot from a selected resource to correlated logs/traces via Korrel8r, and the same Korrel8r endpoint is used by this project for enrichment.

### MCP tools (current state)
- Available: `korrel8r_query_objects`, `korrel8r_get_correlated`.

### Behavior and guardrails
- Respect `KORREL8R_ENABLED`; degrade gracefully when disabled/unavailable.
- Keep HTTP timeouts short; cap lines to avoid prompt bloat.
- Avoid logging sensitive data; use structured logs.

### Future work (optional)
- Add `trace:span` goal and deep-links when Tempo is available.
- Provide structured correlation payloads for UI drill-downs if needed.


### MCP implementation

The MCP server exposes both Korrel8r and Prometheus helpers as tools for UI/agents. Tools are registered in `src/mcp_server/observability_mcp.py`.

#### Korrel8r tools (current)
- `korrel8r_query_objects(query: string)`
  - Calls Korrel8r objects API. When objects are logs, returns simplified entries with fields: `namespace`, `pod`, `level`, `message`, `timestamp` (deduplicated, latest timestamp kept).
  - Example input: `k8s:Pod.v1:{"namespace":"dev","name":"my-pod"}`
  - Example output (excerpt):
    ```
    [{"namespace":"dev","pod":"my-pod","level":"ERROR","message":"OOMKilled","timestamp":"2025-10-22T19:05:22Z"}]
    ```
- `korrel8r_get_correlated(goals: string[], query: string)`
  - Runs `list_goals` then each returned query via `query_objects`; aggregates results (primarily logs for goals `["log:application","log:infrastructure"]`).
  - Used by vLLM/OpenShift enrichment to build prompt context.

Removed tools: `korrel8r_find_related`, `korrel8r_health` (and registration) were removed; functionality is covered by goal‐based queries and health is inferred via request success.

### Anthropic SDK (Claude) integration with Korrel8r
Claude-based “chat” sessions use our MCP tools via a thin adapter so the model can call Korrel8r directly when answering questions.

- Where it lives: `src/mcp_server/claude_integration.py`
  - Instantiates `ObservabilityMCPServer` (registers all MCP tools).
  - Converts MCP tools to Anthropic tool schemas (`_convert_mcp_tools_to_claude_format`).
  - Routes Claude tool invocations back to MCP handlers (`_route_tool_call_to_mcp`).

- Exposed Korrel8r tools to Claude
  - `korrel8r_query_objects(query: string)`: calls Korrel8r objects API and returns simplified logs `{namespace,pod,level,message,timestamp}` when applicable.
  - `korrel8r_get_correlated(goals: string[], query: string)`: runs `list_goals` then `query_objects` per returned query and aggregates results (used to build log context).

- How Korrel8r is used during chat
  1) Claude uses Prometheus tools to discover context (e.g., namespace/pod, time range).
  2) Claude invokes `korrel8r_get_correlated` with goals `["log:application","log:infrastructure"]` and a start query such as `k8s:Pod.v1:{"namespace":"<ns>","name":"<pod>"}`.
  3) The Claude adapter routes the call to our MCP handler, which executes `list_goals` → `query_objects` in Korrel8r.
  4) The handler returns simplified, deduplicated log entries; Claude summarizes/incorporates the lines in its response.

- Example Claude tool call (arguments)
```
{
  "goals": ["log:application", "log:infrastructure"],
  "query": "k8s:Pod.v1:{\"namespace\":\"dev\",\"name\":\"my-pod\"}"
}
```

- Example returned items (excerpt)
```
[{"namespace":"dev","pod":"my-pod","level":"ERROR","message":"OOMKilled","timestamp":"2025-10-22T19:05:22Z"}]
```

Make sure these values match your cluster setup (service names/namespaces, routes, and desired line limits). After changing values, redeploy the chart to propagate updates to the running mcp-server.


