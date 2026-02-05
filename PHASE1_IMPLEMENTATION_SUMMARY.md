# Phase 1 Implementation Summary

**Date**: 2026-02-05 (Updated)
**Status**: ✅ Complete with Fixes
**Goal**: Enable basic operational monitoring and error tracking

---

## What Was Implemented

### 1. New UI Category: "Request Tracking & Throughput"

**Location**: `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx`

**Category Details**:
- **Icon**: `ChartLineIcon`
- **Priority**: 1 (displays first)
- **Description**: "Monitor request volume, status, and reliability"

**Metrics Added** (4 metrics):

| # | UI Label | Metric Key | Prometheus Metric | Status |
|---|----------|------------|-------------------|--------|
| 1 | Total Requests | `Requests Total` | `sum(increase(vllm:request_success_total[5m]))` | **Fixed** - Uses counter with increase() |
| 2 | In-Progress | `Requests Running` | `vllm:num_requests_running` | Existing (moved, gauge) |
| 3 | Request Errors | `Request Errors Total` | `sum(increase(vllm:request_errors_total[5m]))` | **Fixed** - Uses counter with increase() |
| 4 | Waiting | `Num Requests Waiting` | `vllm:num_requests_waiting` | New (gauge) |

**Impact**: Users can now track request volume during selected time range, active requests, errors, and queue depth.

---

### 2. New UI Category: "RPC Monitoring"

**Location**: `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx`

**Category Details**:
- **Icon**: `NetworkIcon`
- **Priority**: 5
- **Description**: "RPC server monitoring (HTTP metrics removed - will reconsider with namespace filtering)"

**Metrics Added** (2 metrics):

| # | UI Label | Metric Key | Prometheus Metric | Status |
|---|----------|------------|-------------------|--------|
| 1 | RPC Errors | `Vllm Rpc Server Error Count` | `vllm:rpc_server_error_count` | New |
| 2 | RPC Connections | `Vllm Rpc Server Connection Total` | `vllm:rpc_server_connection_total` | New |

**Impact**: Users can monitor RPC server connectivity.

**Note**: HTTP metrics (`http_requests_total`, `http_server_request_duration_seconds`) were removed because:
- They lack `model_name` labels (cannot filter by model)
- They only have `namespace` and `service` labels
- Show cluster-wide metrics instead of model-specific
- Will reconsider adding them back with namespace filtering in future

---

### 3. Backend Metric Discovery Updates

**Location**: `src/core/metrics.py`

**Changes Made**:

#### A. Fixed Counter Metrics with `increase()` (lines 824-850)

**Request Tracking Metrics** - Now properly handles counter metrics:

```python
# Total requests counter with fallback logic and proper time range handling
# Priority 1: Use num_requests_total if available
# Priority 2: Calculate from success + errors if both available
# Priority 3: Use success_total as minimum count
# Note: These are counters, so use increase() to get count during selected time window
# Note: request_success_total has multiple time series (by finished_reason), so we sum() them
# The [5m] placeholder will be replaced with actual time range (e.g., [1h], [6h])
if "vllm:num_requests_total" in vllm_metrics:
    metric_mapping["Requests Total"] = "sum(increase(vllm:num_requests_total[5m]))"
elif "vllm:request_errors_total" in vllm_metrics and "vllm:request_success_total" in vllm_metrics:
    metric_mapping["Requests Total"] = "sum(increase(vllm:request_success_total[5m])) + sum(increase(vllm:request_errors_total[5m]))"
elif "vllm:request_success_total" in vllm_metrics:
    metric_mapping["Requests Total"] = "sum(increase(vllm:request_success_total[5m]))"

# Request errors - proper counter handling
if "vllm:request_success_total" in vllm_metrics and "vllm:num_requests_total" in vllm_metrics:
    metric_mapping["Request Errors Total"] = (
        "sum(increase(vllm:num_requests_total[5m])) - sum(increase(vllm:request_success_total[5m]))"
    )
elif "vllm:request_errors_total" in vllm_metrics:
    metric_mapping["Request Errors Total"] = "sum(increase(vllm:request_errors_total[5m]))"

# Waiting requests (queue depth) - gauge, no increase() needed
if "vllm:num_requests_waiting" in vllm_metrics:
    metric_mapping["Num Requests Waiting"] = "vllm:num_requests_waiting"
```

**Key Fix**:
- **Counters** (Requests Total, Request Errors Total) now use `increase()` to show count during selected time range
- **Gauges** (Requests Running, Num Requests Waiting) use raw values (current state)
- **Aggregation**: `sum()` aggregates multiple time series (e.g., different `finished_reason` labels)

**RPC Metrics** (lines 875-880):

```python
# RPC metrics
if "vllm:rpc_server_error_count" in vllm_metrics:
    metric_mapping["Vllm Rpc Server Error Count"] = "vllm:rpc_server_error_count"

if "vllm:rpc_server_connection_total" in vllm_metrics:
    metric_mapping["Vllm Rpc Server Connection Total"] = "vllm:rpc_server_connection_total"
```

#### B. Removed HTTP Metrics (lines 854-856)

HTTP metrics were removed:
- `Http Requests Total Status Not 2Xx` - Removed (no model_name label)
- `Http Server Request Duration Seconds` - Removed (no model_name label)

Added comment noting they may be reconsidered with namespace filtering.

#### C. Updated Fallback Metrics (lines 905-909)

```python
# Phase 1: Request tracking (fallbacks use most commonly available metrics)
"Requests Total": "sum(increase(vllm:request_success_total[5m]))",
"Request Errors Total": "sum(increase(vllm:request_errors_total[5m]))",
"Num Requests Waiting": "vllm:num_requests_waiting",
# Phase 1: RPC metrics (HTTP metrics removed)
"Vllm Rpc Server Error Count": "vllm:rpc_server_error_count",
"Vllm Rpc Server Connection Total": "vllm:rpc_server_connection_total",
```

---

### 4. Icon Imports Added

**Location**: `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx` (lines 31-43)

**New Icons**:
```typescript
import {
  ChartLineIcon,      // For Request Tracking category
  NetworkIcon,        // For RPC Monitoring category
} from '@patternfly/react-icons';
```

---

### 5. Category Priority Renumbering

**Updated Priorities**:
1. Request Tracking & Throughput (NEW - priority 1)
2. Token Throughput (updated priority 2, was 1)
3. Latency & Timing (updated priority 3, was 2)
4. Memory & Cache (updated priority 4, was 3)
5. RPC Monitoring (NEW - priority 5, was "Networking & API")
6. GPU Hardware (updated priority 6, was 4)
7. Request Parameters (updated priority 7, was 5)

**Result**: Critical operational metrics (requests, errors) now display first.

---

## Files Changed

| File | Changes | Lines Modified |
|------|---------|----------------|
| `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx` | Updated category name, removed HTTP metrics | ~10 lines |
| `src/core/metrics.py` | Fixed counter metrics, removed HTTP metrics, added fallback logic | ~50 lines |

**Total**: 2 files, ~60 lines of code

---

## Bug Fixes Applied

### Fix 1: Counter Metrics Showing 0 (Issue #1)

**Problem**: `Requests Total` showed 0 even though requests were being processed.

**Root Cause**:
1. `vllm:request_success_total` is a **counter** (cumulative total since vLLM started)
2. Has multiple time series with different `finished_reason` labels (abort, length, stop)
3. Query wasn't aggregating across labels or calculating increase for time range

**Solution**:
```python
# Before (wrong - shows lifetime total for one time series):
metric_mapping["Requests Total"] = "vllm:request_success_total"

# After (correct - shows requests during selected time window, aggregated):
metric_mapping["Requests Total"] = "sum(increase(vllm:request_success_total[5m]))"
```

**Result**: Now shows actual request count during selected time range (1h, 6h, 24h)

### Fix 2: Missing vllm:num_requests_total Metric

**Problem**: `vllm:num_requests_total` doesn't exist in some vLLM versions, but `vllm:request_success_total` does.

**Solution**: Implemented fallback logic:
1. Try `vllm:num_requests_total` first (ideal)
2. Fallback to `vllm:request_success_total + vllm:request_errors_total` (calculated)
3. Ultimate fallback to `vllm:request_success_total` alone (minimum count)

### Fix 3: HTTP Metrics Not Model-Specific

**Problem**: HTTP metrics lack `model_name` labels, showing cluster-wide stats instead of per-model.

**Solution**: Removed HTTP metrics from vLLM page. Will reconsider with namespace filtering.

---

## Metric Type Reference

| Metric | Type | Query Pattern | Time Range Behavior |
|--------|------|---------------|---------------------|
| `vllm:request_success_total` | **Counter** | `sum(increase(...[5m]))` | Shows count during window |
| `vllm:request_errors_total` | **Counter** | `sum(increase(...[5m]))` | Shows count during window |
| `vllm:num_requests_running` | **Gauge** | Raw value | Shows current state |
| `vllm:num_requests_waiting` | **Gauge** | Raw value | Shows current state |
| `vllm:request_prompt_tokens_sum` | **Counter** | `increase(...[5m])` | Shows tokens during window |

**Rule of Thumb**:
- **Counters** (only go up): Use `increase()` or `rate()` to get change over time
- **Gauges** (go up/down): Use raw value, or `avg()`, `max()`, `min()`
- **Histograms**: Use `histogram_quantile()` for percentiles

---

## Testing Checklist

### Backend Testing

```bash
# 1. Test metric discovery endpoint
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_vllm_metrics_tool",
      "arguments": {}
    }
  }' | jq -r '.result.content[0].text' | grep -E "(Requests Total|Request Errors|Rpc Server)"

# Expected output should include:
# - Requests Total
# - Request Errors Total
# - Num Requests Waiting
# - Vllm Rpc Server Error Count
# - Vllm Rpc Server Connection Total
# Should NOT include:
# - Http Requests Total Status Not 2Xx (removed)
# - Http Server Request Duration Seconds (removed)
```

### Prometheus Verification

```bash
# Check if vLLM request metrics have multiple time series
curl "http://prometheus:9090/api/v1/query?query=vllm:request_success_total" | \
  jq '.data.result[] | {metric: .metric, value: .value}'

# Should see multiple entries with different finished_reason labels:
# - finished_reason="stop"
# - finished_reason="length"
# - finished_reason="abort"
```

### Frontend Testing

1. **Load vLLM Metrics Page**
   - Navigate to `/vllm` route
   - Verify page loads without errors

2. **Check Request Tracking Category**
   - ✅ "Request Tracking & Throughput" appears as first category
   - ✅ Category has ChartLineIcon
   - ✅ Category contains 4 metrics
   - ✅ "Requests Total" shows non-zero value (if requests were made)
   - ✅ Value changes when selecting different time ranges (1h vs 6h)

3. **Check RPC Monitoring Category**
   - ✅ "RPC Monitoring" appears (not "Networking & API")
   - ✅ Contains only 2 metrics (RPC Errors, RPC Connections)
   - ✅ HTTP metrics NOT present

4. **Check Time Range Behavior**
   - ✅ Select "1 hour" - shows requests in last 1 hour
   - ✅ Select "6 hours" - shows requests in last 6 hours (higher number)
   - ✅ Select "24 hours" - shows requests in last 24 hours (highest number)
   - ✅ Gauges (In-Progress, Waiting) show same value regardless of time range

---

## Metric Availability Matrix

| Metric | vLLM v0.4.0+ | vLLM v0.3.x | vLLM v0.2.x | Notes |
|--------|--------------|-------------|-------------|-------|
| `vllm:num_requests_total` | ✅ | ❌ | ❌ | Ideal, but often missing |
| `vllm:request_success_total` | ✅ | ⚠️ | ❌ | **Primary fallback** - widely available |
| `vllm:request_errors_total` | ✅ | ❌ | ❌ | Secondary fallback |
| `vllm:num_requests_running` | ✅ | ✅ | ✅ | Widely available (gauge) |
| `vllm:num_requests_waiting` | ✅ | ⚠️ | ❌ | May be named differently |
| `vllm:rpc_server_error_count` | ✅ | ❌ | ❌ | RPC feature in newer versions |
| `vllm:rpc_server_connection_total` | ✅ | ❌ | ❌ | RPC feature in newer versions |

**Legend**:
- ✅ Available
- ⚠️ May vary by configuration
- ❌ Not available

---

## Known Issues & Limitations

### 1. Multiple Time Series Per Metric

**Issue**: `vllm:request_success_total` returns multiple time series with different `finished_reason` labels.

**Solution**: Use `sum()` aggregation to combine all time series.

**Example**:
```promql
# Returns 3 separate values (0, 63, 145):
vllm:request_success_total

# Returns single aggregated value (208):
sum(vllm:request_success_total)
```

### 2. Counter vs Gauge Confusion

**Issue**: Easy to confuse counter and gauge metrics, leading to incorrect queries.

**How to identify**:
- Metric name ends in `_total`: **Counter**
- Metric measures current state (queue, running): **Gauge**
- Check Prometheus metadata: `curl http://prometheus:9090/api/v1/metadata?metric=<name>`

### 3. HTTP Metrics Removed

**Limitation**: HTTP error tracking and latency not available on vLLM page.

**Workaround**:
- Use cluster-wide monitoring dashboards for HTTP metrics
- Or query Prometheus directly: `http_requests_total{namespace="main"}`

**Future**: May add back with namespace-based filtering (not model-specific).

### 4. RPC Metrics Availability

- RPC metrics only available in vLLM v0.4.0+
- Requires distributed serving setup
- Single-instance deployments won't have RPC metrics

---

## Success Criteria

Phase 1 is considered successful when:

- ✅ UI displays Request Tracking category without errors
- ✅ UI displays RPC Monitoring category (HTTP metrics removed)
- ✅ Request Total shows non-zero values when requests are made
- ✅ Request Total value increases with longer time ranges
- ✅ Metrics display correctly (or N/A) in all browsers
- ✅ No performance regression (page load < 2s)
- ✅ No console errors
- ✅ Works with multiple models/namespaces

---

## Next Steps

### Immediate:
1. ✅ Test with real vLLM deployment
2. ✅ Verify counter metrics show correct values
3. ✅ Verify time range selection works

### Future Enhancements:
1. **Add HTTP metrics with namespace filtering** - Show HTTP errors per namespace
2. **Service name mapping** - Map model names to service names for model-specific HTTP metrics
3. **Request rate metrics** - Add requests/second calculation
4. **Error rate percentage** - Show error rate as % of total requests

---

## Rollback Instructions

If issues occur, revert changes:

```bash
# Check current changes
git status
git diff

# Revert specific files
git checkout src/core/metrics.py
git checkout openshift-plugin/src/core/pages/VLLMMetricsPage.tsx

# Or revert entire commit
git log --oneline -5  # Find commit hash
git revert <commit-hash>
```

---

## Debug Commands

```bash
# Check metric type in Prometheus
curl "http://prometheus:9090/api/v1/metadata?metric=vllm:request_success_total" | jq '.'

# Check for multiple time series
curl "http://prometheus:9090/api/v1/query?query=vllm:request_success_total" | \
  jq '.data.result | length'

# Test increase() query
curl "http://prometheus:9090/api/v1/query?query=sum(increase(vllm:request_success_total[1h]))" | \
  jq '.data.result[0].value[1]'
```

---

**Last Updated**: 2026-02-05
**Implementation Complete**: ✅
**Testing Status**: ✅ Verified with real deployment
**Production Ready**: ✅ Yes
