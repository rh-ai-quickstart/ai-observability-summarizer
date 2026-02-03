# vLLM Metrics Implementation Reference

**Location**: `/Users/zhangj/devt/src/openshift-ai-observability-summarizer/src/core/metrics.py`

This document describes where and how vLLM metrics are currently implemented in the codebase.

---

## Metrics Discovery Function

**Function**: `discover_vllm_metrics()` (lines 694-857 in `src/core/metrics.py`)

This function:
1. Queries Prometheus/Thanos for all available metrics
2. Dynamically discovers vLLM metrics (those starting with `vllm:`)
3. Creates friendly names and PromQL queries for UI display
4. Includes GPU metrics (NVIDIA DCGM or Intel Gaudi)
5. Caches results for 5 minutes (via `get_vllm_metrics()`)

---

## Currently Implemented vLLM Metrics

### Core vLLM Metrics (Hardcoded Mappings)

The function explicitly maps these vLLM Prometheus metrics to friendly names:

| Friendly Name | PromQL Query | Source Metrics | Lines |
|---------------|--------------|----------------|-------|
| **Prompt Tokens Created** | `increase(vllm:request_prompt_tokens_sum[5m])` | Falls back through:<br>- `vllm:request_prompt_tokens_sum`<br>- `vllm:prompt_tokens_total`<br>- `vllm:request_prompt_tokens_created`<br>- `vllm:request_prompt_tokens_total` | 786-793 |
| **Output Tokens Created** | `increase(vllm:request_generation_tokens_sum[5m])` | Falls back through:<br>- `vllm:request_generation_tokens_sum`<br>- `vllm:generation_tokens_total`<br>- `vllm:request_generation_tokens_created`<br>- `vllm:request_generation_tokens_total` | 795-802 |
| **Requests Running** | `vllm:num_requests_running` | `vllm:num_requests_running` (gauge) | 805-806 |
| **P95 Latency (s)** | `histogram_quantile(0.95, sum(rate(vllm:e2e_request_latency_seconds_bucket[5m])) by (le))` | `vllm:e2e_request_latency_seconds_bucket` | 809-812 |
| **Inference Time (s)** | `sum(rate(vllm:request_inference_time_seconds_sum[5m])) / sum(rate(vllm:request_inference_time_seconds_count[5m]))` | `vllm:request_inference_time_seconds_sum`<br>`vllm:request_inference_time_seconds_count` | 815-822 |

### GPU Metrics (Multi-Vendor Support)

The function includes GPU metrics with NVIDIA DCGM (primary) and Intel Gaudi (fallback):

| Friendly Name | NVIDIA DCGM Query | Intel Gaudi Query | Lines |
|---------------|-------------------|-------------------|-------|
| **GPU Temperature (°C)** | `avg(DCGM_FI_DEV_GPU_TEMP)` | `avg(habanalabs_temperature_onchip)` | 712-729, 733-765 |
| **GPU Power Usage (Watts)** | `avg(DCGM_FI_DEV_POWER_USAGE)` | `avg(habanalabs_power_mW) / 1000` | 712-729, 733-765 |
| **GPU Memory Usage (GB)** | `avg(DCGM_FI_DEV_FB_USED) / (1024*1024*1024)` | `avg(habanalabs_memory_used_bytes) / (1024*1024*1024)` | 712-729, 733-765 |
| **GPU Energy Consumption (Joules)** | `avg(DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION)` | `avg(habanalabs_energy)` | 712-729, 733-765 |
| **GPU Memory Temperature (°C)** | `avg(DCGM_FI_DEV_MEMORY_TEMP)` | `avg(habanalabs_temperature_threshold_memory)` | 712-729, 733-765 |
| **GPU Utilization (%)** | `avg(DCGM_FI_DEV_GPU_UTIL)` | `avg(habanalabs_utilization)` | 712-729, 733-765 |
| **GPU Usage (%)** | `avg(DCGM_FI_DEV_GPU_UTIL)` | `avg(habanalabs_utilization)` | 768-778 |

### Dynamic Discovery (Generic Mapping)

**Lines 825-839**: Any other `vllm:` metrics found in Prometheus are automatically added with:
- Friendly name: `metric.replace("vllm:", "").replace("_", " ").title()`
- Query: The raw metric name (e.g., `vllm:some_metric_name`)

This means metrics like these are auto-discovered:
- `vllm:request_prompt_tokens_sum` → "Request Prompt Tokens Sum"
- `vllm:request_generation_tokens_sum` → "Request Generation Tokens Sum"
- `vllm:time_to_first_token_seconds_sum` → "Time To First Token Seconds Sum"
- `vllm:time_per_output_token_seconds_sum` → "Time Per Output Token Seconds Sum"
- `vllm:request_prefill_time_seconds_sum` → "Request Prefill Time Seconds Sum"
- `vllm:request_decode_time_seconds_sum` → "Request Decode Time Seconds Sum"
- `vllm:request_queue_time_seconds_sum` → "Request Queue Time Seconds Sum"
- `vllm:e2e_request_latency_seconds_sum` → "E2E Request Latency Seconds Sum"
- And many others...

---

## How the UI Gets Metrics

### Data Flow

1. **Frontend Request** (`VLLMMetricsPage.tsx`)
   - Calls `fetchVLLMMetrics(model, timeRange, namespace)` from `mcpClient.ts`

2. **MCP Client** (`src/core/services/mcpClient.ts`)
   - Makes HTTP POST to `/mcp/call_tool`
   - Tool: `fetch_vllm_metrics_data`

3. **MCP Server** (`src/mcp_server/tools/observability_vllm_tools.py`)
   - Function: `fetch_vllm_metrics_data()` (lines 344-476)
   - Calls `get_vllm_metrics()` to get metric definitions

4. **Core Metrics Module** (`src/core/metrics.py`)
   - Function: `get_vllm_metrics()` (lines 1213-1226)
   - Returns cached result from `discover_vllm_metrics()`
   - Cache TTL: 5 minutes (300 seconds)

5. **Metric Discovery** (`src/core/metrics.py`)
   - Function: `discover_vllm_metrics()` (lines 694-857)
   - Queries Prometheus: `GET /api/v1/label/__name__/values`
   - Builds metric mapping with friendly names
   - Returns `Dict[str, str]` mapping friendly name → PromQL query

6. **Query Execution** (`src/core/metrics.py`)
   - Function: `execute_instant_queries_parallel()` (lines 71-108)
     - Executes instant queries for current values
     - Uses ThreadPoolExecutor with 10 workers
   - Function: `execute_range_queries_parallel()` (lines 111-241)
     - Executes range queries for sparklines
     - Returns ~15 data points per metric

7. **Response Formatting** (`observability_vllm_tools.py`)
   - Returns JSON with structure:
     ```json
     {
       "model_name": "namespace | model",
       "start_ts": 1234567890,
       "end_ts": 1234567899,
       "metrics": {
         "Prompt Tokens Created": {
           "latest_value": 12345.0,
           "time_series": [
             {"timestamp": "2024-01-01T10:00:00", "value": 12000.0},
             {"timestamp": "2024-01-01T10:04:00", "value": 12345.0}
           ]
         },
         ...
       }
     }
     ```

8. **UI Rendering** (`VLLMMetricsPage.tsx`)
   - Maps friendly names to UI categories
   - Displays in Key Metrics section or category sections
   - Renders sparklines from time_series data

---

## Configuration Points

### 1. Prometheus URL
- **Location**: `src/core/config.py`
- **Variable**: `PROMETHEUS_URL`
- **Default**: `http://thanos-querier.openshift-monitoring.svc.cluster.local:9090`

### 2. Cache TTL
- **Location**: `src/core/metrics.py`
- **Variable**: `CACHE_TTL`
- **Default**: 300 seconds (5 minutes)
- **Line**: Around line 691

### 3. Metric Label Injection
- **Location**: `src/mcp_server/tools/observability_vllm_tools.py`
- **Function**: `_inject_labels_into_query()` (lines 296-341)
- **Purpose**: Adds `model_name` and `namespace` filters to queries

### 4. Dynamic Lookback Window
- **Location**: `src/core/metrics.py`
- **Function**: `calculate_histogram_quantile_optimal_lookback()` (lines 244-265)
- **Purpose**: Adjusts `[5m]` windows based on time range
  - 1h → 5m
  - 1-3h → 15m
  - 3-12h → 1h
  - 12-48h → 4h
  - >48h → 12h

---

## Adding New Metrics

### Option 1: Automatic Discovery (Recommended)

If the metric exists in Prometheus with `vllm:` prefix, it will be auto-discovered.

**No code changes needed!** Just ensure the metric is:
1. Scraped by Prometheus
2. Named with `vllm:` prefix
3. Available in Prometheus/Thanos

The metric will appear in the UI with a generic friendly name.

### Option 2: Custom Mapping (For Better Names/Queries)

To add a specific metric with a custom friendly name or complex query:

**File**: `src/core/metrics.py`
**Function**: `discover_vllm_metrics()` (after line 822)

Example:
```python
# Add after line 822 (after Inference Time mapping)

# Request error tracking
if "vllm:request_success_total" in vllm_metrics and "vllm:request_total" in vllm_metrics:
    metric_mapping["Request Error Rate"] = (
        "(sum(rate(vllm:request_total[5m])) - sum(rate(vllm:request_success_total[5m]))) / "
        "sum(rate(vllm:request_total[5m]))"
    )

# Token generation rate
if "vllm:generation_tokens_total" in vllm_metrics:
    metric_mapping["Token Generation Rate (tokens/s)"] = (
        "sum(rate(vllm:generation_tokens_total[5m]))"
    )

# Queue depth
if "vllm:num_requests_waiting" in vllm_metrics:
    metric_mapping["Requests Waiting in Queue"] = "vllm:num_requests_waiting"
```

### Option 3: UI Category Mapping

After adding metrics to `discover_vllm_metrics()`, map them to UI categories:

**File**: `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx`
**Constant**: `METRIC_CATEGORIES` (lines 55-125)

Example:
```typescript
'Request Tracking': {
  icon: ExclamationCircleIcon,
  priority: 2,
  description: 'Request volume and error tracking',
  metrics: [
    { key: 'Requests Total', label: 'Total Requests', unit: '', description: 'Total inference requests' },
    { key: 'Request Error Rate', label: 'Error Rate', unit: '%', description: 'Percentage of failed requests' },
    { key: 'Requests Waiting in Queue', label: 'Queue Depth', unit: '', description: 'Requests waiting to be processed' },
  ]
}
```

---

## Testing Metrics

### 1. Check Available Metrics in Prometheus

Query Prometheus directly to see what metrics exist:

```bash
# Get all vLLM metrics
curl -H "Authorization: Bearer $TOKEN" \
  "http://prometheus-url:9090/api/v1/label/__name__/values" | \
  jq '.data[] | select(startswith("vllm:"))'
```

### 2. Test MCP Tool

Use the MCP tool to see discovered metrics:

```bash
# Via MCP server
curl -X POST http://localhost:8000/mcp/call_tool \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "get_vllm_metrics",
    "arguments": {}
  }'
```

### 3. Check UI Data

Look at browser DevTools Network tab when viewing vLLM Metrics page:
- Request: `POST /mcp/call_tool` with tool `fetch_vllm_metrics_data`
- Response: JSON with all metrics and their values

### 4. Backend Logs

Check MCP server logs for metric discovery:

```bash
# In development
tail -f logs/mcp_server.log | grep "vllm"

# In production
kubectl logs -f deployment/mcp-server -n your-namespace | grep "vllm"
```

---

## Prometheus Metric Naming

The code looks for these vLLM metric patterns (from vLLM exporter):

### Token Metrics
- `vllm:request_prompt_tokens_sum` - Total prompt tokens (counter)
- `vllm:request_prompt_tokens_total` - Alternative name
- `vllm:request_generation_tokens_sum` - Total generation tokens (counter)
- `vllm:request_generation_tokens_total` - Alternative name

### Latency Metrics
- `vllm:e2e_request_latency_seconds_bucket` - Histogram for latency quantiles
- `vllm:request_inference_time_seconds_sum` - Total inference time
- `vllm:request_inference_time_seconds_count` - Number of requests
- `vllm:time_to_first_token_seconds_sum` - TTFT total
- `vllm:time_per_output_token_seconds_sum` - TPOT total
- `vllm:request_prefill_time_seconds_sum` - Prefill latency
- `vllm:request_decode_time_seconds_sum` - Decode latency
- `vllm:request_queue_time_seconds_sum` - Queue wait time

### Request Metrics
- `vllm:num_requests_running` - Active requests (gauge)
- `vllm:num_requests_waiting` - Queued requests (gauge)

**Note**: Metric names may vary depending on vLLM version. The code uses fallbacks to handle naming variations.

---

## Summary

**To find currently implemented metrics**, check:

1. **Code**: `src/core/metrics.py` function `discover_vllm_metrics()` (lines 694-857)
2. **Runtime**: Call MCP tool `get_vllm_metrics` to see live discovery results
3. **UI Categories**: `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx` constant `METRIC_CATEGORIES` (lines 55-125)
4. **Prometheus**: Query `/api/v1/label/__name__/values` and filter for `vllm:` prefix

The system is designed to **automatically discover** most vLLM metrics, so adding new metrics to Prometheus will make them available in the UI without code changes.
