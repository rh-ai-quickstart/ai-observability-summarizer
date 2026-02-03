# UI Custom Metrics Not in PDF Requirements

**Date**: 2024-02-03
**Purpose**: Identify metrics in the React UI that are not listed in MetricsFromIntel.pdf

---

## Custom Metrics in UI (Not in PDF)

### Category: Token Throughput
| # | UI Metric Name | Actual Prometheus Metric | Notes |
|---|----------------|--------------------------|-------|
| 1 | **Request Prompt Tokens Sum** | `vllm:request_prompt_tokens_sum` | Sum aggregation of prompt tokens per request |
| 2 | **Request Generation Tokens Sum** | `vllm:request_generation_tokens_sum` | Sum aggregation of generation tokens per request |

**Source**: Auto-discovered vLLM metrics for per-request token aggregations

---

### Category: Latency & Timing
| # | UI Metric Name | Actual Prometheus Metric | Notes |
|---|----------------|--------------------------|-------|
| 3 | **Inference Time (s)** | Computed: `sum(rate(vllm:request_inference_time_seconds_sum[5m])) / sum(rate(vllm:request_inference_time_seconds_count[5m]))` | Average inference time per request |

**Source**: Calculated from `vllm:request_inference_time_seconds_sum` and `vllm:request_inference_time_seconds_count`

**Note**: While the base metrics might exist, "Inference Time" as a computed average is not explicitly listed in the PDF

---

### Category: Memory & Cache
| # | UI Metric Name | Actual Prometheus Metric | Notes |
|---|----------------|--------------------------|-------|
| 4 | **Gpu Cache Usage Perc** | `vllm:gpu_cache_usage_perc` | GPU-specific cache percentage |
| 5 | **Prefix Cache Hits Total** | `vllm:prefix_cache_hits_total` | Total prefix cache hits (counter) |
| 6 | **Prefix Cache Queries Total** | `vllm:prefix_cache_queries_total` | Total prefix cache queries (counter) |
| 7 | **Gpu Prefix Cache Hits Total** | `vllm:gpu_prefix_cache_hits_total` | GPU-specific prefix cache hits (counter) |
| 8 | **Gpu Prefix Cache Queries Total** | `vllm:gpu_prefix_cache_queries_total` | GPU-specific prefix cache queries (counter) |
| 9 | **Gpu Prefix Cache Hits Created** | `vllm:gpu_prefix_cache_hits_created` | GPU cache hit rate (rate counter) |
| 10 | **Gpu Prefix Cache Queries Created** | `vllm:gpu_prefix_cache_queries_created` | GPU cache query rate (rate counter) |

**Source**: vLLM prefix caching feature metrics - available in vLLM v0.4.0+

**Note**: The PDF only lists basic KV cache metrics, not prefix cache-specific metrics. These are legitimate vLLM metrics for monitoring the prefix caching optimization feature.

---

### Category: Request Parameters
| # | UI Metric Name | Actual Prometheus Metric | Notes |
|---|----------------|--------------------------|-------|
| 11 | **Request Max Num Generation Tokens Sum** | `vllm:request_max_num_generation_tokens_sum` | Sum of max generation tokens parameter across requests |
| 12 | **Request Max Num Generation Tokens Count** | `vllm:request_max_num_generation_tokens_count` | Count of requests with max gen tokens parameter |
| 13 | **Request Params Max Tokens Sum** | `vllm:request_params_max_tokens_sum` | Sum of max_tokens API parameter |
| 14 | **Request Params Max Tokens Count** | `vllm:request_params_max_tokens_count` | Count of requests with max_tokens param |
| 15 | **Request Params N Sum** | `vllm:request_params_n_sum` | Sum of 'n' parameter (number of completions) |
| 16 | **Request Params N Count** | `vllm:request_params_n_count` | Count of requests with 'n' parameter |
| 17 | **Iteration Tokens Total Sum** | `vllm:iteration_tokens_total_sum` | Sum of tokens per iteration across all iterations |
| 18 | **Iteration Tokens Total Count** | `vllm:iteration_tokens_total_count` | Total number of iterations |

**Source**: vLLM request parameter tracking metrics - auto-discovered from Prometheus

**Note**: The entire "Request Parameters" category is not in the PDF. These metrics track how clients are configuring their requests, which is useful for capacity planning and understanding usage patterns.

---

## Summary

| Category | Custom Metrics | Notes |
|----------|----------------|-------|
| Token Throughput | 2 | Request-level token sums |
| Latency & Timing | 1 | Computed inference time average |
| Memory & Cache | 7 | Prefix cache metrics (vLLM v0.4.0+ feature) |
| Request Parameters | 8 | **Entire category not in PDF** |
| **TOTAL** | **18** | Auto-discovered from Prometheus |

## Complete List of 18 Custom Metrics

### Quick Reference (Prometheus Metric Names)

**Token Metrics (2):**
1. `vllm:request_prompt_tokens_sum`
2. `vllm:request_generation_tokens_sum`

**Latency Metrics (1):**
3. Computed: `sum(rate(vllm:request_inference_time_seconds_sum[5m])) / sum(rate(vllm:request_inference_time_seconds_count[5m]))`

**Prefix Cache Metrics (7):**
4. `vllm:gpu_cache_usage_perc`
5. `vllm:prefix_cache_hits_total`
6. `vllm:prefix_cache_queries_total`
7. `vllm:gpu_prefix_cache_hits_total`
8. `vllm:gpu_prefix_cache_queries_total`
9. `vllm:gpu_prefix_cache_hits_created`
10. `vllm:gpu_prefix_cache_queries_created`

**Request Parameter Metrics (8):**
11. `vllm:request_max_num_generation_tokens_sum`
12. `vllm:request_max_num_generation_tokens_count`
13. `vllm:request_params_max_tokens_sum`
14. `vllm:request_params_max_tokens_count`
15. `vllm:request_params_n_sum`
16. `vllm:request_params_n_count`
17. `vllm:iteration_tokens_total_sum`
18. `vllm:iteration_tokens_total_count`

---

## Why These Exist in UI

These metrics are **auto-discovered** from Prometheus using the dynamic discovery mechanism in `discover_vllm_metrics()` (src/core/metrics.py, lines 825-839):

```python
# Add any other vLLM metrics with a generic friendly name if not already mapped
for metric in vllm_metrics:
    if metric in (...already_mapped...):
        continue
    friendly_name = metric.replace("vllm:", "").replace("_", " ").title()
    if friendly_name not in metric_mapping:
        metric_mapping[friendly_name] = metric
```

This code automatically adds any `vllm:` metrics found in Prometheus that aren't explicitly hardcoded.

---

## Are These Metrics Useful?

### ✅ Should Keep

**Prefix Cache Metrics (7 metrics)**:
- Very useful for monitoring vLLM's prefix caching efficiency
- Helps optimize cache hit rates
- Important for performance tuning
- **Recommendation**: Keep these, they provide valuable insights

**Request Parameter Metrics (8 metrics)**:
- Useful for understanding request patterns
- Helps with capacity planning (average token limits requested)
- Tracks how users configure generation parameters
- **Recommendation**: Keep as a separate category (already implemented)

**Computed Metrics**:
- Inference Time (s) is a useful high-level metric
- **Recommendation**: Keep it

### ⚠️ Might Be Redundant

**Request Token Sums (2 metrics)**:
- `Request Prompt Tokens Sum` vs `Prompt Tokens Total` - might be similar
- `Request Generation Tokens Sum` vs `Generation Tokens Total` - might be similar
- **Recommendation**: Review if these provide unique value or are duplicates

---

## Comparison: PDF vs UI

| Source | vLLM Metrics Count | Notes |
|--------|-------------------|-------|
| **PDF Requirements** | 32 | 19 + 6 + 7 (across 3 categories) |
| **UI Implementation** | 37 | 31 unique metrics + 6 in Key Metrics section |
| **Overlap** | ~19 | Metrics that appear in both |
| **PDF Only** | ~13 | Missing from UI (errors, OOM, HTTP, RPC, etc.) |
| **UI Only** | ~18 | Auto-discovered (prefix cache, request params) |

---

## Recommendation for Proposal

### Option 1: Include UI-Only Metrics (Recommended)
Keep all 37 existing UI metrics and add the 13 missing PDF metrics for a total of **50 metrics**.

**Pros**:
- Preserves all existing functionality
- No breaking changes for users
- Richer monitoring with both PDF + vLLM auto-discovered metrics

**Cons**:
- More metrics to maintain
- Some potential duplication

### Option 2: PDF-Only (Not Recommended)
Remove the 18 UI-only metrics and only show the 32 PDF metrics.

**Pros**:
- Strictly follows PDF requirements
- Cleaner alignment with spec

**Cons**:
- Loses valuable prefix cache monitoring
- Loses request parameter insights
- Breaking change for existing users

---

## Updated Category Proposal (Option 1)

If we keep all UI metrics + add PDF missing metrics:

| Category | UI Metrics | PDF Metrics | Total |
|----------|------------|-------------|-------|
| 1. Request Tracking | 0 | +4 new | 4 |
| 2. Token Metrics | 4 | +1 new | 5 |
| 3. Latency & Timing | 7 | 0 new | 7 |
| 4. Scheduling & Queueing | 1 | +3 new | 4 |
| 5. Engine Internals | 0 | +2 new | 2 |
| 6. KV Cache Metrics | 8 | +5 new | 13 |
| 7. Networking & API | 0 | +7 new | 7 |
| 8. GPU Hardware | 7 | +4 (optional) | 7-11 |
| 9. Request Parameters | 8 | 0 new | 8 |
| **TOTAL** | **35** | **+26 new** | **~57** |

This would provide the most comprehensive monitoring coverage.

---

## Conclusion

The 18 "custom" metrics are:
1. Legitimate vLLM metrics auto-discovered from Prometheus
2. Not listed in the PDF (which may be incomplete or based on older vLLM version)
3. Provide valuable monitoring insights (especially prefix cache metrics)
4. Should be retained in the new proposal

**Recommendation**: Keep all existing UI metrics and add the missing PDF metrics for complete coverage.
