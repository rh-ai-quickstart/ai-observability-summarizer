# vLLM Metrics Gap Analysis

**Date**: 2024-02-03
**Source**: Comparison of React UI implementation vs. PDF requirements (MetricsFromIntel.pdf)

## Executive Summary

The current React UI implementation in `VLLMMetricsPage.tsx` covers approximately **40-50%** of the vLLM metrics specified in the PDF requirements. The implementation focuses heavily on latency/timing and token throughput but is missing critical operational metrics for request tracking, error monitoring, and system health.

---

## 1. vLLM – Inference Performance & Latency

### ✅ Implemented Metrics

| PDF Metric | UI Implementation | Notes |
|------------|-------------------|-------|
| `vllm_prompt_tokens_total` | ✅ Prompt Tokens Total | Available in Token Throughput section |
| `vllm_completion_tokens_total` | ✅ Generation Tokens Total | Available in Token Throughput section |
| `vllm_ttft_seconds` | ✅ Time To First Token Seconds Sum | Available in Latency & Timing |
| `vllm_tpot_seconds` | ✅ Time Per Output Token Seconds Sum | Available in Latency & Timing |
| `vllm_prefill_latency_seconds` | ✅ Request Prefill Time Seconds Sum | Available in Latency & Timing |
| `vllm_decode_latency_seconds` | ✅ Request Decode Time Seconds Sum | Available in Latency & Timing |
| `vllm_request_latency_seconds_bucket` | ✅ E2E Request Latency Seconds Sum + P95 Latency | Available as Key Metric + Latency section |
| `vllm_scheduler_queue_time_seconds` | ✅ Request Queue Time Seconds Sum | Available in Latency & Timing |

### ❌ Missing Metrics (HIGH PRIORITY)

| PDF Metric | Description | Impact | Priority |
|------------|-------------|--------|----------|
| `vllm_tokens_generated_per_second` | Tokens generated per second (rate) | Cannot track throughput velocity | **HIGH** |
| `vllm_requests_total` | Total inference requests | Cannot track request volume | **CRITICAL** |
| `vllm_requests_in_progress` | Active ongoing requests | Cannot monitor concurrent load | **CRITICAL** |
| `vllm_request_errors_total` | Total failed inference requests | Cannot track reliability | **CRITICAL** |
| `vllm_oom_errors_total` | GPU/HPU out-of-memory failures | Cannot detect OOM issues | **HIGH** |
| `vllm_batch_size` | Dynamic batch size used by vLLM | Cannot optimize batching | **MEDIUM** |
| `vllm_num_scheduled_requests` | Requests waiting to be scheduled | Cannot see scheduling backlog | **MEDIUM** |
| `vllm_batching_idle_time_seconds` | Scheduler idle time between batches | Cannot optimize scheduler efficiency | **LOW** |
| `vllm_engine_loop_duration_seconds` | Time per internal scheduling loop | Cannot diagnose scheduling bottlenecks | **LOW** |
| `vllm_model_load_time_seconds` | Time to load the model | Cannot track initialization performance | **LOW** |

### Impact Assessment
- **Cannot monitor request success/failure rates** - No error tracking
- **Cannot track system load** - No active request count
- **Cannot measure throughput rate** - Only total token counts
- **Cannot detect OOM issues** - No memory failure alerts

---

## 2. vLLM – KV Cache Metrics

### ✅ Implemented Metrics

| PDF Metric | UI Implementation | Notes |
|------------|-------------------|-------|
| `vllm_kv_cache_usage_ratio` | ✅ Kv Cache Usage Perc | Available in Memory & Cache section |

### ❌ Missing Metrics (MEDIUM PRIORITY)

| PDF Metric | Description | Impact | Priority |
|------------|-------------|--------|----------|
| `vllm_kv_cache_usage_bytes` | Actual KV cache usage in bytes | Cannot track absolute memory consumption | **MEDIUM** |
| `vllm_kv_cache_capacity_bytes` | Total KV cache size in bytes | Cannot see total capacity limits | **MEDIUM** |
| `vllm_kv_cache_free_bytes` | Free KV memory in bytes | Cannot calculate available headroom | **MEDIUM** |
| `vllm_kv_cache_fragmentation_ratio` | KV cache fragmentation ratio | Cannot detect memory fragmentation issues | **HIGH** |
| `vllm_kv_block_reuse_total` | Count of KV blocks reused | Cannot measure cache efficiency | **LOW** |

### Impact Assessment
- **Cannot track absolute memory usage** - Only percentage available
- **Cannot detect fragmentation** - May miss performance degradation
- **Cannot measure cache reuse efficiency** - No optimization insights

### Note on Current Implementation
The UI currently shows:
- `Kv Cache Usage Perc` - Percentage utilization ✅
- `Gpu Cache Usage Perc` - GPU-specific cache percentage ✅
- Various prefix cache hit/query metrics (may be custom metrics not in PDF)

---

## 3. vLLM – Networking (API/RPC)

### ❌ Missing Metrics (HIGH PRIORITY)

**All networking metrics from the PDF are missing:**

| PDF Metric | Description | Impact | Priority |
|------------|-------------|--------|----------|
| `http_server_request_duration_seconds` | Latency of API requests | Cannot monitor API performance | **HIGH** |
| `http_requests_total{status!~"2.."}` | Non-2xx HTTP errors | Cannot track API failures | **CRITICAL** |
| `vllm_rpc_server_connection_total` | Total RPC connections | Cannot monitor RPC connectivity | **MEDIUM** |
| `vllm_rpc_server_request_count` | RPC request count | Cannot track RPC volume | **MEDIUM** |
| `vllm_rpc_server_error_count` | RPC failures | Cannot detect RPC issues | **HIGH** |
| `vllm_scheduler_pending_requests` | Internal inference queue depth | Cannot monitor queue buildup | **HIGH** |
| `vllm_streaming_time_to_first_token_seconds` | TTFT for streaming requests | Cannot track streaming performance | **MEDIUM** |

### Impact Assessment
- **No API/RPC monitoring** - Complete gap in networking observability
- **Cannot detect HTTP errors** - No failure tracking for API layer
- **Cannot monitor queue depth** - May miss backlog issues
- **Cannot track streaming performance** - Streaming use cases not covered

---

## 4. Additional Observations

### ✅ Strengths of Current Implementation

1. **Excellent Latency Coverage**: TTFT, TPOT, Prefill, Decode, Queue times all covered
2. **Token Tracking**: Good coverage of prompt/generation token metrics
3. **GPU Metrics**: Strong GPU hardware monitoring (though these are Gaudi metrics, not vLLM)
4. **Visualization**: Sparklines, trends, and key metrics dashboard provide good UX
5. **Cache Monitoring**: Basic KV cache percentage tracking

### ⚠️ Metrics in UI Not Found in PDF

The UI implements several metrics not explicitly listed in the PDF's vLLM categories:

**Request Parameters Section:**
- Request Max Num Generation Tokens Sum/Count
- Request Params Max Tokens Sum/Count
- Request Params N Sum/Count
- Iteration Tokens Total Sum/Count

**GPU Hardware Section (These are actually Intel Gaudi metrics - Category 4 in PDF):**
- GPU Temperature (°C)
- GPU Power Usage (Watts)
- GPU Energy Consumption (Joules)
- GPU Utilization (%)
- GPU Memory Usage (GB)
- GPU Memory Temperature (°C)

**Prefix Cache Metrics (Not in PDF):**
- Prefix Cache Hits Total
- Prefix Cache Queries Total
- Gpu Prefix Cache Hits Total
- Gpu Prefix Cache Queries Total
- Gpu Prefix Cache Hits Created
- Gpu Prefix Cache Queries Created

These may be valid vLLM metrics not included in the PDF, or they may be custom metrics specific to this implementation.

---

## 5. Priority Recommendations

### Critical (Must Have)

1. **Request Tracking**
   - Add `vllm_requests_total` - Total request counter
   - Add `vllm_requests_in_progress` - Active requests gauge
   - Add `vllm_request_errors_total` - Error counter
   - Add `http_requests_total{status!~"2.."}` - HTTP error counter

2. **Error Monitoring**
   - Add `vllm_oom_errors_total` - OOM failure tracking
   - Add `vllm_rpc_server_error_count` - RPC error tracking

### High Priority

3. **Throughput Rate**
   - Add `vllm_tokens_generated_per_second` - Token generation rate

4. **Queue Monitoring**
   - Add `vllm_scheduler_pending_requests` - Queue depth

5. **Cache Fragmentation**
   - Add `vllm_kv_cache_fragmentation_ratio` - Memory fragmentation

6. **HTTP Performance**
   - Add `http_server_request_duration_seconds` - API latency

### Medium Priority

7. **Cache Details**
   - Add `vllm_kv_cache_usage_bytes` - Absolute memory usage
   - Add `vllm_kv_cache_capacity_bytes` - Total capacity
   - Add `vllm_kv_cache_free_bytes` - Free memory

8. **Batching**
   - Add `vllm_batch_size` - Batch size tracking
   - Add `vllm_num_scheduled_requests` - Scheduled request count

9. **RPC Monitoring**
   - Add `vllm_rpc_server_connection_total` - RPC connections
   - Add `vllm_rpc_server_request_count` - RPC requests

10. **Streaming**
    - Add `vllm_streaming_time_to_first_token_seconds` - Streaming TTFT

### Low Priority

11. **Engine Internals**
    - Add `vllm_batching_idle_time_seconds` - Scheduler idle time
    - Add `vllm_engine_loop_duration_seconds` - Engine loop duration
    - Add `vllm_model_load_time_seconds` - Model load time
    - Add `vllm_kv_block_reuse_total` - Block reuse counter

---

## 6. Suggested UI Structure After Improvements

### Key Metrics (6 metrics) - Keep Current
- GPU Temperature, GPU Power, P95 Latency, GPU Usage, Output Tokens, Prompt Tokens

### 1. Request & Error Tracking (NEW SECTION - HIGH PRIORITY)
- **Icon**: ExclamationCircleIcon
- **Metrics**:
  - Total Requests (`vllm_requests_total`)
  - In-Progress Requests (`vllm_requests_in_progress`)
  - Request Errors (`vllm_request_errors_total`)
  - OOM Errors (`vllm_oom_errors_total`)
  - HTTP Errors (`http_requests_total{status!~"2.."}`)
  - RPC Errors (`vllm_rpc_server_error_count`)

### 2. Token Throughput (ENHANCED)
- Keep existing metrics
- **Add**: Token Generation Rate (`vllm_tokens_generated_per_second`)

### 3. Latency & Timing (Keep Current)
- Already comprehensive

### 4. Memory & Cache (ENHANCED)
- Keep existing metrics
- **Add**:
  - KV Cache Usage (Bytes) (`vllm_kv_cache_usage_bytes`)
  - KV Cache Capacity (Bytes) (`vllm_kv_cache_capacity_bytes`)
  - KV Cache Free (Bytes) (`vllm_kv_cache_free_bytes`)
  - KV Cache Fragmentation (`vllm_kv_cache_fragmentation_ratio`)
  - KV Block Reuse (`vllm_kv_block_reuse_total`)

### 5. Networking & API (NEW SECTION - HIGH PRIORITY)
- **Icon**: NetworkIcon or GlobeIcon
- **Metrics**:
  - HTTP Request Latency (`http_server_request_duration_seconds`)
  - RPC Connections (`vllm_rpc_server_connection_total`)
  - RPC Requests (`vllm_rpc_server_request_count`)
  - Streaming TTFT (`vllm_streaming_time_to_first_token_seconds`)

### 6. Scheduling & Batching (NEW SECTION - MEDIUM PRIORITY)
- **Icon**: ClockIcon or ListIcon
- **Metrics**:
  - Batch Size (`vllm_batch_size`)
  - Scheduled Requests (`vllm_num_scheduled_requests`)
  - Pending Requests (`vllm_scheduler_pending_requests`)
  - Scheduler Idle Time (`vllm_batching_idle_time_seconds`)
  - Engine Loop Duration (`vllm_engine_loop_duration_seconds`)

### 7. GPU Hardware (Keep Current)
- Already implemented

### 8. Request Parameters (Keep Current)
- Already implemented

---

## 7. Implementation Checklist

### Phase 1: Critical Metrics (Week 1)
- [ ] Add Request Tracking section with total/in-progress/error counters
- [ ] Add OOM error tracking
- [ ] Add HTTP error tracking
- [ ] Add token generation rate metric

### Phase 2: High Priority (Week 2)
- [ ] Add Networking & API section
- [ ] Add queue depth monitoring
- [ ] Add KV cache fragmentation metric
- [ ] Add HTTP request latency metric

### Phase 3: Medium Priority (Week 3-4)
- [ ] Add Scheduling & Batching section
- [ ] Enhance KV Cache section with byte-level metrics
- [ ] Add RPC monitoring metrics
- [ ] Add streaming TTFT

### Phase 4: Low Priority (Future)
- [ ] Add engine internal metrics (idle time, loop duration, model load time)
- [ ] Add KV block reuse tracking

---

## 8. Backend Considerations

**Note**: This gap analysis assumes all metrics listed in the PDF are available from the backend/MCP server. Before implementing UI changes, verify:

1. Are these Prometheus metrics actually being collected?
2. Does the MCP server expose these metrics via its API?
3. Are there naming differences between PDF and actual implementation?

Check files:
- Backend metric collection configuration
- MCP server metric query implementation
- Prometheus scraping configuration

---

## Conclusion

The current vLLM metrics UI provides solid coverage of **latency and token tracking** but has significant gaps in:

1. **Request & Error Monitoring** (CRITICAL)
2. **HTTP/RPC Networking** (CRITICAL)
3. **KV Cache Details** (MEDIUM)
4. **Scheduling & Batching** (MEDIUM)

Implementing the Critical and High Priority metrics would bring coverage to approximately **75-80%** of the PDF requirements and significantly improve operational visibility.
