# P95 Latency Debug Instructions

## Issue Report
- **Streamlit UI**: P95 Latency = 2.34s (Avg), Max = 9.75s ✅
- **React UI**: P95 Latency = 9.75s (Avg), Max = 9.75s ❌

**Hypothesis**: React UI might be using `latest_value` fallback instead of calculating from `time_series`.

---

## Debug Logging Added

I've added comprehensive debug logging to the React UI to help diagnose the issue.

### File Modified
`openshift-plugin/src/core/pages/VLLMMetricsPage.tsx` (lines 493-544)

### Debug Logs
When you load the vLLM Metrics page and select a model, the browser console will show:

```javascript
[P95 Debug] Key: P95 Latency (s)
[P95 Debug] metricData: {latest_value: 9.75, time_series: [...]}
[P95 Debug] latest_value: 9.75
[P95 Debug] time_series length: 15
[P95 Debug] time_series: [{timestamp: "...", value: 2.1}, ...]
[P95 Debug] Valid values after filtering: [2.1, 3.4, 9.75, ...]
[P95 Debug] Valid values count: 15
[P95 Debug] Calculated avg: 2.34
[P95 Debug] Calculated max: 9.75
```

---

## How to Debug

### Step 1: Open React UI with Browser Console

1. **Navigate to**: React vLLM Metrics page
2. **Open DevTools**: Press `F12` or right-click → Inspect
3. **Go to Console tab**
4. **Select a model** from the dropdown

### Step 2: Check Debug Output

Look for logs starting with `[P95 Debug]`:

#### **Scenario A: Time Series is Empty** ❌
```javascript
[P95 Debug] time_series length: 0
[P95 Debug] No time series, using latest_value as fallback: 9.75
```
**Diagnosis**: MCP server is not returning time_series data
**Fix needed**: Check `execute_range_queries_parallel()` in MCP server

#### **Scenario B: Time Series Has Only 1 Point** ❌
```javascript
[P95 Debug] time_series length: 1
[P95 Debug] Valid values after filtering: [9.75]
[P95 Debug] Calculated avg: 9.75
[P95 Debug] Calculated max: 9.75
```
**Diagnosis**: Time range is too narrow or MCP is only returning 1 point
**Fix needed**: Check `max_points=15` parameter in `fetch_vllm_metrics_data()`

#### **Scenario C: All Values are NaN/Invalid** ❌
```javascript
[P95 Debug] time_series length: 15
[P95 Debug] Valid values after filtering: []
[P95 Debug] No valid values, returning null
```
**Diagnosis**: Time series has data but all values are NaN
**Fix needed**: Check Prometheus query for P95 Latency

#### **Scenario D: Correct Calculation** ✅
```javascript
[P95 Debug] time_series length: 15
[P95 Debug] Valid values after filtering: [2.1, 3.4, 2.5, ..., 9.75]
[P95 Debug] Calculated avg: 2.34
[P95 Debug] Calculated max: 9.75
```
**Diagnosis**: Working correctly!
**No fix needed** - avg should show 2.34s, max should show 9.75s

---

## Step 3: Compare with MCP Server Response

To verify what the MCP server is actually returning, check the Network tab:

1. **Open DevTools** → **Network tab**
2. **Filter**: `fetchVLLMMetrics`
3. **Click on the request** → **Response tab**
4. **Look for** `"P95 Latency (s)"` in the JSON response

Expected structure:
```json
{
  "metrics": {
    "P95 Latency (s)": {
      "latest_value": 9.75,
      "time_series": [
        {"timestamp": "2026-01-26T10:00:00Z", "value": 2.1},
        {"timestamp": "2026-01-26T10:05:00Z", "value": 3.4},
        ...
        {"timestamp": "2026-01-26T11:00:00Z", "value": 9.75}
      ]
    }
  }
}
```

### What to Check:
- ✅ `time_series` array should have **~15 points** (configured as `max_points=15`)
- ✅ Each point should have `timestamp` and `value`
- ✅ Values should be **varied** (not all the same)
- ✅ No NaN values in the array

---

## Possible Root Causes

### 1. **Empty Time Series** (Most Likely)
**Symptom**: `time_series: []`
**Cause**: `execute_range_queries_parallel()` is failing or returning no data
**Location**: `src/mcp_server/tools/observability_vllm_tools.py:408-414`
**Fix**: Check Prometheus range query execution

### 2. **Single Data Point**
**Symptom**: `time_series: [{...}]` (length = 1)
**Cause**: Time range too narrow or step size too large
**Fix**: Adjust `max_points=15` or check time range resolution

### 3. **NaN Values in Time Series**
**Symptom**: `time_series: [{value: NaN}, {value: NaN}, ...]`
**Cause**: Prometheus query returning NaN for P95 histogram_quantile
**Fix**: Same as previous P95 Latency investigation - no data in time window

### 4. **Frontend Not Using Time Series**
**Symptom**: Debug logs show `No time series, using latest_value as fallback`
**Cause**: Time series data structure mismatch
**Fix**: Check that `metricData.time_series` is an array of `{timestamp, value}` objects

---

## Next Steps

### After checking the debug logs:

1. **Share the console output** with the debug logs
2. **Share the Network response** for the `fetchVLLMMetrics` API call
3. **Compare time ranges** between Streamlit and React UIs

This will help identify exactly why React is showing avg=max=9.75s instead of avg=2.34s, max=9.75s.

---

## Temporary Workaround

If you need a quick fix while debugging, you can:

1. Use the **Streamlit UI** for accurate P95 Latency values
2. The values in Streamlit are correct (avg=2.34s, max=9.75s)

---

## Removing Debug Logs

Once the issue is identified and fixed, we'll remove the debug logs from the production code.

**File to clean up**: `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx` (lines 493-544)
