# vLLM Metrics Medium Priority Fixes - Summary

## Date: 2026-02-05

## Issues Fixed

### 1. ✅ FIXED: Created Explicit Metric Type Registry

**Issue:** Metric types were detected via string matching (`if 'increase(' in query`) instead of explicit metadata
- Brittle and error-prone
- No central registry of metric types
- Hard to maintain as metrics evolve
- Difficult to validate query correctness

**Fix:** Created comprehensive metric type registry in `src/core/metrics.py` (lines ~41-177):

```python
METRIC_TYPES = {
    'COUNTER': {
        'Requests Total',
        'Request Errors Total',
        'Prompt Tokens Total',
        'Generation Tokens Total',
        # ... 30+ counter metrics
    },
    'GAUGE': {
        'Requests Running',
        'GPU Usage (%)',
        'Kv Cache Usage Perc',
        # ... 20+ gauge metrics
    },
    'HISTOGRAM': {
        'P95 Latency (s)',
        'P99 Latency (s)',
    },
    'SUMMARY': {
        'Inference Time (s)',
        'Tokens Generated Per Second',
        # ... summary/average metrics
    },
}
```

Added helper functions:
- `get_metric_type(metric_label)` - Returns metric type for a given label
- `get_metrics_by_type(metric_type)` - Returns all metrics of a specific type

**Impact:**
- ✅ Explicit, self-documenting metric classification
- ✅ Easy to add new metrics with proper typing
- ✅ Enables validation (catches misclassifications early)
- ✅ Central source of truth for metric semantics

**Benefits:**
- Validation now happens at query adjustment time
- Warnings logged if query function doesn't match metric type
- Future-proof: new metric types can be added easily

---

### 2. ✅ FIXED: Documented Histogram Quantile Lookback Logic

**Issue:** Complex time range adjustment logic lacked documentation
- String matching to determine metric type was unclear
- No explanation why `increase()` gets full duration vs others get lookback
- Unclear behavior for gauge metrics

**Fix:** Added comprehensive 70-line documentation block in `src/mcp_server/tools/observability_vllm_tools.py` (lines ~437-507):

```python
# ========================================================================
# Dynamic Time Range Adjustment Logic
# ========================================================================
# Adjust query time ranges based on metric type to ensure correct semantics
# and prevent data quality issues (sparse data, overlapping windows).
#
# Three types of queries require different time range handling:
#
# 1. COUNTER metrics with increase():
#    Purpose: Show total count during the selected time window
#    Time range: Use full selected duration (e.g., [1h] for 1-hour window)
#    Example: increase(vllm:request_success_total[1h])
#             Returns: 1000 requests during that specific 1-hour period
#    Why: Each time point shows increase over the SAME duration window...
#
# 2. SUMMARY/HISTOGRAM metrics with rate():
#    Purpose: Show average rate or percentile over time
#    Time range: Use calculated lookback window (proportional to duration)
#    Example: rate(tokens_sum[5m]) for 1h window
#             rate(tokens_sum[30m]) for 6h window
#    Why: Prevents sparse data in long time ranges...
#
# 3. GAUGE metrics (no time range):
#    Purpose: Show instantaneous value at query time
#    Time range: None (gauges don't have [Xm] suffix)
#    Example: vllm:num_requests_running
#    Why: Gauges are point-in-time snapshots...
# ========================================================================
```

**Enhanced Implementation:**
- Added metric type validation using the new registry
- Warnings logged when query function doesn't match registered type
- Better debug logging with metric type included

```python
# Validate that query function matches metric type
if metric_type == 'COUNTER' and 'increase(' not in query:
    logger.warning(
        f"Metric '{label}' is registered as COUNTER but query doesn't use increase(): {query}"
    )
```

**Impact:**
- ✅ Developers can understand the logic without reverse-engineering
- ✅ Clear explanation of overlapping windows issue for counters
- ✅ Documented why proportional lookback prevents sparse data
- ✅ Early detection of query/type mismatches

---

### 3. ✅ FIXED: Consolidated GPU Usage vs Utilization Metrics

**Issue:** Duplicate/confusing GPU metrics with unclear distinction
- Frontend had both "GPU Usage (%)" and "GPU Utilization (%)"
- Backend discovered metrics as "GPU Utilization (%)" but mapped to "GPU Usage (%)"
- Unclear if these were the same metric or different

**Decision:** Consolidate to single "GPU Usage (%)" metric

**Changes Made:**

1. **Backend (`src/core/metrics.py`):**
   - Removed "GPU Utilization (%)" from `GAUGE_METRICS` list (line ~306)
   - Added comment explaining consolidation (lines ~308-310):
     ```python
     GAUGE_METRICS = [
         "GPU Usage (%)",  # Consolidated GPU compute utilization (NVIDIA, AMD, Habana, etc.)
         "GPU Temperature (°C)",
         # ... other metrics
     ]
     ```
   - Internal discovery still finds vendor-specific metrics (DCGM_FI_DEV_GPU_UTIL, habanalabs_utilization)
   - All vendor metrics map to the single "GPU Usage (%)" name

2. **Frontend (`openshift-plugin/src/core/pages/VLLMMetricsPage.tsx`):**
   - Removed "GPU Utilization (%)" from GPU Hardware category (line ~148)
   - Kept "GPU Usage (%)" in Key Metrics section (line ~53)
   - GPU compute utilization now shown only once, in the prominent Key Metrics section

3. **Metric Type Registry:**
   - Only "GPU Usage (%)" listed in GAUGE metrics (line ~136)
   - Clear comment: "Consolidated GPU compute utilization (NVIDIA, AMD, Habana, etc.)"

**Impact:**
- ✅ Single, consistent metric name across UI
- ✅ No confusion about duplicate metrics
- ✅ Multi-vendor support maintained (NVIDIA, Habana, AMD via internal mapping)
- ✅ GPU Usage shown prominently in Key Metrics (not buried in GPU Hardware)

---

### 4. ✅ FIXED: Validated Label Injection for Non-vLLM Metrics

**Issue:** Label injection could accidentally modify global cluster metrics
- Only checked for 'DCGM_' and 'habana' strings
- Could miss other GPU exporters (nvidia_smi, nvml_, etc.)
- No validation that injected labels actually exist on the metric
- Risk of breaking queries for metrics that don't have model_name labels

**Fix:** Enhanced validation in `src/mcp_server/tools/observability_vllm_tools.py` (lines ~296-329):

```python
def _inject_labels_into_query(query: str, label_clause: str) -> str:
    """Inject labels into a Prometheus query at the correct position.

    Global metrics (DCGM, Habana, cluster-wide) are skipped - they don't have model/namespace labels.
    Only vLLM metrics support model_name and namespace label filtering.

    Safety: Only injects labels into queries containing vLLM metrics (vllm: prefix).
    This prevents accidentally adding labels to global cluster metrics.
    """

    # Skip global GPU/cluster metrics - comprehensive list
    global_metric_patterns = [
        'DCGM_',           # NVIDIA DCGM metrics (node-level)
        'habana',          # Habana Gaudi metrics (node-level)
        'nvidia_smi_',     # nvidia-smi exporter (node-level)
        'nvml_',           # NVML metrics (node-level)
        'kube_',           # Kubernetes metrics (cluster-wide)
        'node_',           # Node exporter metrics (node-level)
        'container_',      # cAdvisor metrics (may or may not have namespace)
    ]

    if any(pattern in query for pattern in global_metric_patterns):
        return result

    # Only inject labels if query contains vLLM metrics
    if 'vllm:' not in query:
        return result
```

**Safety Improvements:**
- ✅ Comprehensive list of global metric patterns (7 patterns vs 2 before)
- ✅ Positive validation: only inject if query contains 'vllm:' prefix
- ✅ Clear documentation of which metrics are node-level vs cluster-wide
- ✅ Prevents accidental modification of non-vLLM queries

**Edge Cases Handled:**
- nvidia-smi exporters (community exporters)
- NVML metrics (alternative NVIDIA exporter)
- Kubernetes metrics (kube_*)
- Node exporter metrics (node_*)
- cAdvisor container metrics

**Impact:**
- ✅ Prevents query errors from invalid label injection
- ✅ Safe to add new exporters without code changes
- ✅ Clear separation: vLLM metrics get labels, global metrics don't

---

## Files Modified

1. **src/core/metrics.py**
   - Added metric type registry (COUNTER, GAUGE, HISTOGRAM, SUMMARY)
   - Added helper functions: `get_metric_type()`, `get_metrics_by_type()`
   - Consolidated GPU metrics (removed "GPU Utilization (%)" from GAUGE_METRICS)
   - Added documentation for metric classification

2. **src/mcp_server/tools/observability_vllm_tools.py**
   - Added 70-line documentation block for time range adjustment logic
   - Enhanced `_inject_labels_into_query()` with comprehensive global metric patterns
   - Added validation: warns when query function doesn't match metric type
   - Integrated metric type registry for better logging

3. **openshift-plugin/src/core/pages/VLLMMetricsPage.tsx**
   - Removed duplicate "GPU Utilization (%)" from GPU Hardware section
   - Kept "GPU Usage (%)" in Key Metrics section only

## Testing Recommendations

### 1. Test Metric Type Validation
```bash
# Check logs for validation warnings when fetching metrics
tail -f /var/log/mcp-server.log | grep "registered as COUNTER but query doesn't use increase"
```

Expected: No warnings (all metrics should have correct query functions)

### 2. Test GPU Metric Consolidation
- Load vLLM Metrics page
- Verify "GPU Usage" appears in Key Metrics section
- Verify "GPU Usage" does NOT appear in GPU Hardware section
- Verify GPU Usage shows actual utilization percentage (0-100%)

### 3. Test Label Injection Safety
```bash
# Test that DCGM metrics aren't modified
curl -X POST http://localhost:8000/mcp \
  -d '{"method":"tools/call","params":{"name":"fetch_vllm_metrics_data","arguments":{"model_name":"test-model"}}}'
```

Expected: GPU metrics (DCGM_*) queries should NOT have model_name labels injected

### 4. Test Time Range Adjustment Documentation
- Review logs when fetching metrics with different time ranges
- Verify debug logs show correct adjustment type (COUNTER vs SUMMARY)
- Check that counters use full duration, summaries use lookback window

## Expected Behavior Changes

**Before Fixes:**
- Metric types detected via brittle string matching
- No documentation of time range adjustment logic
- Duplicate GPU metrics causing confusion
- Risk of breaking queries with incorrect label injection

**After Fixes:**
- Explicit metric type registry with validation
- Comprehensive documentation (70+ lines) of time range logic
- Single, consolidated "GPU Usage (%)" metric
- Safe label injection with comprehensive global metric filtering
- Validation warnings when query/type mismatch detected

## Benefits Summary

| Fix | Maintainability | Robustness | Clarity | Safety |
|-----|----------------|------------|---------|--------|
| Metric Type Registry | ✅✅✅ | ✅✅✅ | ✅✅✅ | ✅✅ |
| Documented Lookback Logic | ✅✅✅ | ✅ | ✅✅✅ | - |
| GPU Metric Consolidation | ✅✅ | ✅ | ✅✅✅ | - |
| Label Injection Validation | ✅✅ | ✅✅✅ | ✅✅ | ✅✅✅ |

**Overall Impact:**
- **More maintainable:** Central registry makes adding metrics straightforward
- **More robust:** Validation catches errors early, prevents query failures
- **Clearer:** Documentation and consolidation reduce confusion
- **Safer:** Comprehensive label injection validation prevents breaking global metrics

## Backward Compatibility

- ✅ No breaking changes
- ✅ GPU Usage metric name unchanged (used by frontend)
- ✅ All existing metrics work as before
- ✅ New validation only logs warnings, doesn't block execution
- ✅ Label injection changes only add safety, don't modify vLLM metric behavior
