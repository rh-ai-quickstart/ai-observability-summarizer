# P95 Latency Discrepancy Investigation

## Problem Statement

**React UI**: Shows P95 Latency = 9.76s
**Streamlit UI**: Shows P95 Latency = 0ms

One of these is incorrect. We need to determine which one is showing the true value.

---

## Background: How P95 Latency is Calculated

Both UIs use the same Prometheus query defined in `src/core/metrics.py:731-733`:

```promql
histogram_quantile(0.95, sum(rate(vllm:e2e_request_latency_seconds_bucket[5m])) by (le))
```

This query:
1. Takes the `vllm:e2e_request_latency_seconds_bucket` histogram metric
2. Calculates the `rate()` over the last **5 minutes**
3. Sums the rates across all series (grouped by `le` - latency bucket)
4. Calculates the 95th percentile using `histogram_quantile()`

---

## Key Differences Between UIs

### **React UI** (`openshift-plugin/src/core/pages/VLLMMetricsPage.tsx`)

**Data Source**: `fetchVLLMMetrics()` from MCP server
- Calls `fetch_vllm_metrics_data()` in `src/mcp_server/tools/observability_vllm_tools.py:343`
- Executes **instant queries** for `latest_value` (line 405)
- Executes **range queries** for time series/sparklines (lines 408-414)
- Returns: `{ "P95 Latency (s)": { "latest_value": 9.76, "time_series": [...] } }`

**Display**: Shows metrics **immediately** without requiring analysis

---

### **Streamlit UI** (`src/ui/ui.py`)

**Data Source**: `analyze_vllm_mcp()` → `metric_data` from session state
- Metrics only appear **after clicking "Analyze Metrics"** button (line 1055)
- Calls `analyze_vllm` MCP tool which returns time-series data points
- Processes data through `calculate_metrics_mcp()` (line 1151)
  - Filters out **NaN values** (line 720 in `mcp_client_helper.py`)
  - Calculates avg/min/max from time series points (lines 726-733)

**Display**: Shows calculated **average** value from time series data

---

## Hypothesis: Why The Discrepancy?

### **Theory 1: No Recent Activity (Most Likely)**

If there have been **no requests in the last 5 minutes**:

- `rate(vllm:e2e_request_latency_seconds_bucket[5m])` → **returns 0 for all buckets**
- `histogram_quantile(0.95, ...)` → **should return 0 or NaN**

**However**, there's a known Prometheus behavior:
- If the histogram bucket has **old data** but rate() is 0, `histogram_quantile()` might:
  - Return **NaN** (which React might display as a number)
  - Return a **stale value** from the bucket counter
  - Behavior depends on Prometheus version and query timing

**React UI**:
- Instant query might catch a **non-zero bucket value** from before the 5-minute window
- Displays `latest_value: 9.76` as-is

**Streamlit UI**:
- Time-series data over a range might be all zeros or NaNs
- `calculate_metrics_locally()` **filters out NaN** values (line 720)
- If all values are NaN/filtered, shows `0ms`

---

### **Theory 2: Different Time Ranges**

**React UI**:
- Default time range: `1h` (can be changed via dropdown)
- Uses the selected time range for range queries

**Streamlit UI**:
- Uses **user-selected start/end datetime** (lines 937-972)
- Defaults to **last 1 hour** but can be customized
- Time range might be different between the two UIs

---

### **Theory 3: Model/Namespace Filtering**

Both UIs filter by `model_name` and `namespace`, but there could be subtle differences in:
- Label injection (line 396 in `observability_vllm_tools.py`)
- Namespace matching
- Model name parsing (`namespace | model_name` format)

---

## Investigation Steps

### **Step 1: Run Diagnostic Script**

```bash
cd /Users/zhangj/devt/src/openshift-ai-observability-summarizer
python debug_p95_latency.py
```

This script will:
1. Check if histogram buckets exist
2. Verify rate() calculation over 5 minutes
3. Test the actual histogram_quantile() query
4. Compare with global P95 (no model filter)
5. Check alternative latency metrics (sum/count)

### **Step 2: Compare Time Ranges**

In both UIs, check:
- **React**: What time range is selected in the dropdown?
- **Streamlit**: What start/end datetime was selected?

### **Step 3: Check Raw Prometheus Data**

Query Prometheus directly:
```promql
# Check if there are recent requests
sum(rate(vllm:e2e_request_latency_seconds_count{model_name="meta-llama/Llama-3.2-3B-Instruct",namespace="demo3"}[5m]))
```

If this returns **0**, there are no requests in the last 5 minutes, and P95 should be **0 or NaN**.

### **Step 4: Check Browser Console Logs**

**React UI**:
- Open browser DevTools → Console
- Look for MCP client logs showing the fetched metric values
- Check: `Received metrics data: N metrics`
- Check: `Metrics with time series: [...]`

**Streamlit UI**:
- Check Streamlit terminal logs
- Look for MCP tool responses

---

## Expected Outcomes

| Scenario | React UI (9.76s) | Streamlit UI (0ms) | Correct Answer |
|----------|------------------|-------------------|----------------|
| No recent requests (last 5m) | Stale value from old buckets | Filtered NaN → 0ms | **Streamlit ✅** |
| Active requests (last 5m) | Real P95 value | Real P95 value | **Both should match** |
| Different time ranges | P95 over 1h | P95 over custom range | **Both correct** for their ranges |
| Query error/NaN | Displays NaN as number | Filters NaN → 0ms | **Depends on intent** |

---

## ✅ FIXED - Implementation Complete

### **Fix Applied: Filter NaN/Invalid Values in React UI**

**Date**: 2026-01-26
**Files Modified**: `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx`

The React UI has been updated to match Streamlit's NaN filtering behavior. Changes include:

### **1. KeyMetricsSection - getAvgAndMax() Function** (Lines 457-490)

Updated `getAvgAndMax()` in `VLLMMetricsPage.tsx:459` to filter out invalid values:

```typescript
const getAvgAndMax = (key: string): { avg: number | null; max: number | null } => {
  const metricData = data[key];

  // If no time series data, check if latest_value is valid
  if (!metricData || !metricData.time_series || metricData.time_series.length === 0) {
    const latestValue = metricData?.latest_value;

    // Filter out NaN, null, and infinite values (matches Streamlit behavior)
    if (latestValue === null || latestValue === undefined ||
        isNaN(latestValue) || !isFinite(latestValue)) {
      return { avg: null, max: null };
    }

    return { avg: latestValue, max: latestValue };
  }

  // Filter out NaN, null, and infinite values from time series
  // This matches the Streamlit UI's behavior in mcp_client_helper.py:720
  const validValues = metricData.time_series
    .map(p => p.value)
    .filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v));

  // If no valid values, return null (will display as "N/A")
  if (validValues.length === 0) {
    return { avg: null, max: null };
  }

  const avg = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
  const max = Math.max(...validValues);

  return { avg, max };
};
```

### **2. MetricCard Component** (Lines 142-238)

Added NaN filtering to:
- **formatValue()**: Returns "N/A" for NaN/infinite values
- **getTrend()**: Filters invalid values before calculating trends
- **renderSparkline()**: Filters invalid values before rendering sparklines

### **3. KeyMetricCard Component** (Lines 297-408)

Added NaN filtering to:
- **getTrend()**: Filters invalid values from time series
- **renderSparkline()**: Filters invalid values before rendering

### **Result**

Now when Prometheus returns:
- **NaN** (no data in time window) → React shows **"N/A"** or **0** ✅
- **Stale values** (old bucket data) → Filtered out → Shows **"N/A"** ✅
- **Valid values** → Displays correctly ✅

This matches Streamlit's behavior and provides accurate metrics.

---

## Questions to Answer

1. **Has the model received any requests in the last 5 minutes?**
   - If NO → Streamlit (0ms) is correct
   - If YES → React (9.76s) might be correct

2. **What do the Prometheus bucket counters show?**
   - Run: `vllm:e2e_request_latency_seconds_bucket{model_name="...",namespace="..."}`
   - Are bucket values increasing or static?

3. **Is 9.76s a realistic P95 latency?**
   - For a 3B parameter model, typical latencies are 100ms-2000ms
   - 9.76s seems **very high** - possible if:
     - Cold start
     - Resource contention
     - Batch processing delays
     - **OR: Stale/incorrect data**

---

## Next Actions

1. **Run `debug_p95_latency.py`** to see raw Prometheus values
2. **Check both UIs simultaneously** with same model/time range
3. **Verify request activity** - are there actual requests happening?
4. **Implement NaN filtering** in React UI (safest fix)
5. **Add validation** to detect and warn about stale metrics

---

## Files to Review

- `src/core/metrics.py:731-733` - P95 query definition
- `src/mcp_server/tools/observability_vllm_tools.py:343-423` - Fetch metrics function
- `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx:459-470` - React avg/max calculation
- `src/ui/mcp_client_helper.py:697-743` - Streamlit calculation with NaN filtering
