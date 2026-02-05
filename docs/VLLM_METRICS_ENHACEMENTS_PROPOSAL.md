# vLLM Metrics Reorganization Proposal

**Date**: 2024-02-03
**Purpose**: Reorganize vLLM metrics into logical categories for better UI presentation
**Source**: MetricsFromIntel.pdf requirements

---

## Executive Summary

This proposal reorganizes the PDF's 32 vLLM metrics into **8 logical categories** for improved UI usability:

- **Current UI**: Has 1 large "Latency & Timing" category with many mixed metrics
- **Proposed UI**: Splits into 8 focused categories with 2-7 metrics each
- **Coverage**: 18/32 metrics currently implemented (56%)
- **GPU Hardware**: Remains unchanged per requirements ✅
- **Scope Exclusions**: HTTP metrics (not vLLM-specific) and low priority metrics will not be implemented

---

## Proposed Category Structure

### Category 1: Request Tracking & Throughput
**Icon**: `ChartLineIcon` or `ActivityIcon`
**Priority**: Display first (Critical)
**Purpose**: Monitor request volume, status, and reliability

| # | Metric Name | PDF Metric | Status | Priority |
|---|-------------|------------|--------|----------|
| 1 | Total Requests | `vllm_requests_total` | ❌ Missing | CRITICAL |
| 2 | In-Progress Requests | `vllm_requests_in_progress` | ⚠️ Partial (exists as `Requests Running`) | CRITICAL |
| 3 | Request Errors | `vllm_request_errors_total` | ❌ Missing | CRITICAL |
| 4 | OOM Errors | `vllm_oom_errors_total` | ❌ Missing | HIGH |

**Metrics in Category**: 4
**Currently Implemented**: 1 (25%)
**PDF Source**: Category 1 (Inference Performance & Latency)

---

### Category 2: Token Metrics
**Icon**: `TachometerAltIcon`
**Priority**: 2
**Purpose**: Track token-level throughput and generation rates

| # | Metric Name | PDF Metric | Status | Priority |
|---|-------------|------------|--------|----------|
| 1 | Token Throughput | `vllm_tokens_generated_total` | ✅ Implemented (as `Generation Tokens Total`) | MEDIUM |
| 2 | Token Throughput Rate | `vllm_tokens_generated_per_second` | ❌ Missing | HIGH |
| 3 | Prompt Tokens | `vllm_prompt_tokens_total` | ✅ Implemented (as `Prompt Tokens Total`) | MEDIUM |
| 4 | Output Tokens | `vllm_completion_tokens_total` | ✅ Implemented (as `Generation Tokens Total`) | MEDIUM |

**Metrics in Category**: 4
**Currently Implemented**: 3 (75%)
**PDF Source**: Category 1 (Inference Performance & Latency)

---

### Category 3: Latency & Timing
**Icon**: `ClockIcon`
**Priority**: 3
**Purpose**: End-to-end performance and response time breakdown

| # | Metric Name | PDF Metric | Status | Priority |
|---|-------------|------------|--------|----------|
| 1 | TTFT | `vllm_ttft_seconds` | ✅ Implemented (as `Time To First Token Seconds Sum`) | HIGH |
| 2 | TPOT | `vllm_tpot_seconds` | ✅ Implemented (as `Time Per Output Token Seconds Sum`) | HIGH |
| 3 | Prefill Latency | `vllm_prefill_latency_seconds` | ✅ Implemented (as `Request Prefill Time Seconds Sum`) | MEDIUM |
| 4 | Decode Latency | `vllm_decode_latency_seconds` | ✅ Implemented (as `Request Decode Time Seconds Sum`) | MEDIUM |
| 5 | Request Latency Histogram | `vllm_request_latency_seconds_bucket` | ✅ Implemented (as `P95 Latency` + `E2E Total`) | CRITICAL |

**Metrics in Category**: 5
**Currently Implemented**: 5 (100%) ✅
**PDF Source**: Category 1 (Inference Performance & Latency)

**Notes**: This category is complete - no changes needed!

---

### Category 4: Scheduling & Queueing
**Icon**: `ListIcon` or `ClockIcon`
**Priority**: 4
**Purpose**: Scheduler performance, batching efficiency, and queue management

| # | Metric Name | PDF Metric | Status | Priority |
|---|-------------|------------|--------|----------|
| 1 | Queueing Time | `vllm_scheduler_queue_time_seconds` | ✅ Implemented (as `Request Queue Time Seconds Sum`) | MEDIUM |
| 2 | Scheduler Idle Time | `vllm_batching_idle_time_seconds` | ❌ Missing | LOW |
| 3 | Batch Size | `vllm_batch_size` | ❌ Missing | MEDIUM |
| 4 | Scheduled Requests | `vllm_num_scheduled_requests` | ❌ Missing | MEDIUM |

**Metrics in Category**: 4
**Currently Implemented**: 1 (25%)
**PDF Source**: Category 1 (Inference Performance & Latency)

---

### Category 5: Engine Internals
**Icon**: `CogIcon`
**Priority**: 5
**Purpose**: Low-level vLLM engine performance diagnostics

| # | Metric Name | PDF Metric | Status | Priority |
|---|-------------|------------|--------|----------|
| 1 | Engine Loop Duration | `vllm_engine_loop_duration_seconds` | ❌ Low priority - Not implemented | LOW |
| 2 | Model Load Time | `vllm_model_load_time_seconds` | ❌ Low priority - Not implemented | LOW |

**Metrics in Category**: 2
**Currently Implemented**: 0 (0%)
**PDF Source**: Category 1 (Inference Performance & Latency)

**Notes**: Low priority - mainly for advanced debugging. These metrics will not be implemented.

---

### Category 6: KV Cache Metrics
**Icon**: `MemoryIcon`
**Priority**: 6
**Purpose**: Cache efficiency and memory utilization

| # | Metric Name | PDF Metric | Status | Priority |
|---|-------------|------------|--------|----------|
| 1 | KV Cache Used | `vllm_kv_cache_usage_bytes` | ❌ Missing | MEDIUM |
| 2 | KV Cache Capacity | `vllm_kv_cache_capacity_bytes` | ❌ Missing | MEDIUM |
| 3 | KV Cache Free | `vllm_kv_cache_free_bytes` | ❌ Missing | MEDIUM |
| 4 | KV Cache Usage Ratio | `vllm_kv_cache_usage_ratio` | ✅ Implemented (as `Kv Cache Usage Perc`) | MEDIUM |
| 5 | KV Cache Fragmentation | `vllm_kv_cache_fragmentation_ratio` | ❌ Missing | HIGH |
| 6 | KV Block Reuse | `vllm_kv_block_reuse_total` | ❌ Missing | LOW |

**Metrics in Category**: 6
**Currently Implemented**: 1 (17%)
**PDF Source**: Category 2 (KV Cache Metrics)

**Additional Metrics in Current UI** (not in PDF):
- ✅ Gpu Cache Usage Perc
- ✅ Prefix Cache Hits Total
- ✅ Prefix Cache Queries Total
- ✅ Gpu Prefix Cache Hits Total
- ✅ Gpu Prefix Cache Queries Total
- ✅ Gpu Prefix Cache Hits Created
- ✅ Gpu Prefix Cache Queries Created

---

### Category 7: Networking & API
**Icon**: `NetworkIcon` or `GlobeIcon`
**Priority**: 7
**Purpose**: HTTP/RPC monitoring and API performance

| # | Metric Name | PDF Metric | Status | Priority |
|---|-------------|------------|--------|----------|
| 1 | HTTP Request Latency | `http_server_request_duration_seconds` | ❌ Not vLLM-specific - Excluded | HIGH |
| 2 | HTTP Error Count | `http_requests_total{status!~"2.."}` | ❌ Not vLLM-specific - Excluded | CRITICAL |
| 3 | RPC Connections | `vllm_rpc_server_connection_total` | ❌ Missing | MEDIUM |
| 4 | RPC Request Count | `vllm_rpc_server_request_count` | ❌ Missing | MEDIUM |
| 5 | RPC Error Count | `vllm_rpc_server_error_count` | ❌ Missing | HIGH |
| 6 | Queue Depth | `vllm_scheduler_pending_requests` | ❌ Missing | HIGH |
| 7 | Stream TTFT | `vllm_streaming_time_to_first_token_seconds` | ❌ Missing | MEDIUM |

**Metrics in Category**: 7 (5 vLLM-specific, 2 HTTP excluded)
**Currently Implemented**: 0 (0%)
**PDF Source**: Category 3 (Networking - API/RPC)

**Notes**: HTTP metrics (#1, #2) excluded as they are not vLLM-specific

---

### Category 8: GPU Hardware ✅ **KEEP UNCHANGED**
**Icon**: `CubesIcon`
**Priority**: 8
**Purpose**: GPU hardware monitoring and resource usage

| # | Metric Name | PDF Metric | Status | Priority |
|---|-------------|------------|--------|----------|
| 1 | Device Energy Usage | `habanalabs_energy` | ✅ Implemented (as `GPU Energy Consumption (Joules)`) | MEDIUM |
| 2 | Device Utilization | `habanalabs_utilization` | ✅ Implemented (as `GPU Utilization (%)`) | HIGH |
| 3 | Power Cap | `habanalabs_power_default_limit_mW` | ⚠️ Not displayed (available in Prometheus) | LOW |
| 4 | Power Usage | `habanalabs_power_mW` | ✅ Implemented (as `GPU Power Usage (Watts)`) | HIGH |
| 5 | Temperature Onboard | `habanalabs_temperature_onboard` | ⚠️ Not displayed | LOW |
| 6 | Temperature Onchip | `habanalabs_temperature_onchip` | ✅ Implemented (as `GPU Temperature (°C)`) | HIGH |
| 7 | Temp Threshold GPU | `habanalabs_temperature_threshold_gpu` | ⚠️ Not displayed | LOW |
| 8 | Temp Threshold Memory | `habanalabs_temperature_threshold_memory` | ✅ Implemented (as `GPU Memory Temperature (°C)`) | MEDIUM |
| 9 | Memory Free | `habanalabs_memory_free_bytes` | ⚠️ Not displayed | MEDIUM |
| 10 | Memory Total | `habanalabs_memory_total_bytes` | ⚠️ Not displayed | MEDIUM |
| 11 | Memory Used | `habanalabs_memory_used_bytes` | ✅ Implemented (as `GPU Memory Usage (GB)`) | HIGH |

**Metrics in Category**: 11 (Intel Gaudi metrics from PDF Category 4)
**Currently Implemented**: 7 core metrics (64%)
**PDF Source**: Category 4 (Intel Gaudi - Core/Compute + Memory Metrics)

**Notes**:
- Multi-vendor support: NVIDIA DCGM or Intel Gaudi
- Current implementation shows 7 key metrics
- Additional 4 metrics available but not displayed (thresholds, free/total memory)
- **Keep this category unchanged per requirements**

---

## Summary Tables

### Metrics by Category

| Category | Total Metrics | Implemented | Missing | Coverage |
|----------|---------------|-------------|---------|----------|
| 1. Request Tracking & Throughput | 4 | 1 | 3 | 25% |
| 2. Token Metrics | 4 | 3 | 1 | 75% |
| 3. Latency & Timing | 5 | 5 | 0 | **100%** ✅ |
| 4. Scheduling & Queueing | 4 | 1 | 3 | 25% |
| 5. Engine Internals | 2 | 0 | 2 | 0% |
| 6. KV Cache Metrics | 6 | 1 | 5 | 17% |
| 7. Networking & API | 7 | 0 | 7 | 0% |
| 8. GPU Hardware | 11 | 7 | 4 | 64% |
| **TOTAL** | **43** | **18** | **25** | **42%** |

**Note**: Total is 43 because GPU Hardware includes Intel Gaudi metrics (11) which are separate from the 32 vLLM metrics

### PDF Category Mapping

| PDF Category | Metrics | Maps to Proposed Categories |
|--------------|---------|----------------------------|
| 1. vLLM - Inference Performance & Latency | 19 | → Categories 1, 2, 3, 4, 5 |
| 2. vLLM - KV Cache | 6 | → Category 6 |
| 3. vLLM - Networking | 7 | → Category 7 |
| 4. Intel Gaudi - Core/Compute & Memory | 11 | → Category 8 (GPU Hardware) |
| **TOTAL** | **43** | **8 categories** |

---

## Implementation Priority

### Phase 1: Critical (Week 1) 🔴

**Goal**: Enable basic operational monitoring and error tracking

**Add these metrics**:
- Category 1: `vllm_requests_total`, `vllm_request_errors_total`, `vllm_oom_errors_total`

**Effort**: 3 metrics (HTTP metrics excluded as not vLLM-specific)
**Impact**: Enables request volume tracking and error monitoring

---

### Phase 2: High Priority (Week 2) 🟡

**Goal**: Complete throughput monitoring and API visibility

**Add these metrics**:
- Category 2: `vllm_tokens_generated_per_second`
- Category 7: `vllm_rpc_server_error_count`, `vllm_scheduler_pending_requests`
- Category 6: `vllm_kv_cache_fragmentation_ratio`

**Effort**: 4 metrics (HTTP metrics excluded as not vLLM-specific)
**Impact**: Token rate tracking, RPC monitoring, cache health

---

### Phase 3: Medium Priority (Week 3-4) 🟢

**Goal**: Scheduling optimization and memory visibility

**Add these metrics**:
- Category 4: `vllm_batch_size`, `vllm_num_scheduled_requests`, `vllm_batching_idle_time_seconds`
- Category 6: `vllm_kv_cache_usage_bytes`, `vllm_kv_cache_capacity_bytes`, `vllm_kv_cache_free_bytes`
- Category 7: `vllm_rpc_server_connection_total`, `vllm_rpc_server_request_count`, `vllm_streaming_time_to_first_token_seconds`

**Effort**: 9 metrics
**Impact**: Scheduler insights, memory capacity planning, RPC monitoring

---

### Phase 4: Low Priority (Not Implemented) ⚫

**Status**: Not being implemented

**Excluded metrics**:
- Category 5: `vllm_engine_loop_duration_seconds`, `vllm_model_load_time_seconds`
- Category 6: `vllm_kv_block_reuse_total`
- Category 8: Optional Intel Gaudi metrics (thresholds, free/total memory)

**Reason**: Low priority metrics - mainly for advanced debugging and not critical for operational monitoring

---

## UI Mockup Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Key Metrics (6 metrics - Keep Current)                      │
│ [GPU Temp] [GPU Power] [P95 Latency] [GPU Usage]           │
│ [Output Tokens] [Prompt Tokens]                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▼ Request Tracking & Throughput (4 metrics)          [NEW] │
│   [Total Requests] [In-Progress] [Errors] [OOM Errors]     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▶ Token Metrics (4 metrics)                       [ENHANCED]│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▶ Latency & Timing (5 metrics)                    [KEEP AS-IS]│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▶ Scheduling & Queueing (4 metrics)                   [NEW] │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▶ Engine Internals (2 metrics)                        [NEW] │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▶ KV Cache Metrics (6+ metrics)                  [ENHANCED] │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▶ Networking & API (7 metrics)                        [NEW] │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▶ GPU Hardware (7 metrics)                      [UNCHANGED] │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ▶ Request Parameters (8 metrics)          [KEEP - NOT IN PDF]│
└─────────────────────────────────────────────────────────────┘
```

**Notes**:
- ▼ = Expanded by default
- ▶ = Collapsed by default
- Categories ordered by operational priority

---

## Dynamic Discovery Implementation

### Backend Pattern Matching

```python
# src/core/metrics.py - discover_vllm_metrics()

def categorize_metric(metric_name: str) -> str:
    """Auto-categorize metrics by name pattern"""

    # Request tracking patterns
    if any(pattern in metric_name for pattern in [
        'requests_total', 'requests_in_progress',
        'request_errors', 'oom_errors'
    ]):
        return 'request_tracking'

    # Token patterns
    if any(pattern in metric_name for pattern in [
        'tokens_total', 'tokens_generated', 'prompt_tokens', 'completion_tokens'
    ]):
        return 'tokens'

    # Latency patterns
    if any(pattern in metric_name for pattern in [
        'ttft', 'tpot', 'latency', '_time_seconds',
        'prefill', 'decode'
    ]):
        return 'latency'

    # Scheduling patterns
    if any(pattern in metric_name for pattern in [
        'scheduler', 'batch', 'queue', 'scheduled_requests'
    ]):
        return 'scheduling'

    # Cache patterns
    if 'cache' in metric_name or 'kv_' in metric_name:
        return 'cache'

    # Networking patterns
    if any(pattern in metric_name for pattern in [
        'http_', 'rpc_', 'streaming'
    ]):
        return 'networking'

    # Engine patterns
    if any(pattern in metric_name for pattern in [
        'engine', 'model_load'
    ]):
        return 'engine'

    return 'other'
```

---

## Verification Checklist

Before implementation:

### Backend Verification
- [ ] Query Prometheus: `{__name__=~"vllm_.*"}` to see available metrics
- [ ] Verify metric names match PDF (check for naming variations)
- [ ] Test MCP tool: `get_vllm_metrics` to see discovery results
- [ ] Check vLLM version and metric compatibility

### UI Verification
- [ ] Review current category structure in `VLLMMetricsPage.tsx`
- [ ] Identify which metrics need to be moved between categories
- [ ] Plan icon selections for new categories
- [ ] Determine default expanded/collapsed state for each category

### Data Flow
- [ ] Verify MCP server can fetch all new metrics
- [ ] Test label injection for `model_name` and `namespace` filters
- [ ] Confirm sparkline data populates correctly
- [ ] Check error handling for missing metrics

---

## Success Criteria

After implementing this proposal:

1. **Organization**: Metrics grouped into 8 logical categories with 2-7 metrics each
2. **Coverage**: Achieve 75%+ coverage of PDF requirements (32/43 metrics)
3. **UX**: No category has more than 7 metrics for easy scanning
4. **Performance**: Page load time remains under 2 seconds
5. **Maintainability**: Dynamic discovery works for future vLLM versions
6. **Completeness**: Critical operational metrics (requests, errors) are visible

---

## Appendix: Metric Name Variations

vLLM metric names may vary between versions. The dynamic discovery should handle:

| PDF Metric | Possible Variations |
|------------|---------------------|
| `vllm_requests_total` | `vllm:num_requests_total`, `vllm:request_count` |
| `vllm_prompt_tokens_total` | `vllm:request_prompt_tokens_total`, `vllm:prompt_tokens` |
| `vllm_completion_tokens_total` | `vllm:generation_tokens_total`, `vllm:request_generation_tokens_total` |
| `vllm_ttft_seconds` | `vllm:time_to_first_token_seconds`, `vllm:ttft` |
| `vllm_tpot_seconds` | `vllm:time_per_output_token_seconds`, `vllm:tpot` |

The implementation should query Prometheus dynamically and map to friendly names using pattern matching, not exact name matching.
