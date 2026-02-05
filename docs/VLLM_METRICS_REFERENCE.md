# vLLM Metrics Reference

**Version:** 1.0
**Last Updated:** 2026-02-05
**Status:** Production

## Overview

This document provides a comprehensive reference for all vLLM metrics implemented in the OpenShift AI Observability dashboard. Metrics are organized by functional categories and include detailed information about metric types, calculation formulas, and special considerations.

### Metric Type Legend

- **COUNTER**: Monotonically increasing values (requests, tokens, errors). Use `increase()` to show totals during time window.
- **GAUGE**: Instantaneous values (queue depth, cache %, temperature). Shows current value at query time.
- **HISTOGRAM**: Distribution metrics with buckets. Use `histogram_quantile()` with `rate()`.
- **SUMMARY**: Average metrics calculated from sum/count pairs. Use `rate(sum) / rate(count)`.

### Time Range Notation

- `[5m]` is a placeholder that gets replaced dynamically:
  - **COUNTER metrics**: Replaced with full selected duration (e.g., `[1h]` for 1-hour window)
  - **SUMMARY/HISTOGRAM metrics**: Replaced with proportional lookback window (e.g., `[5m]` for 1h, `[30m]` for 6h)
  - **GAUGE metrics**: No time range (instant values)

---

## Key Metrics

**Purpose:** High-priority metrics displayed prominently at the top of the dashboard for at-a-glance monitoring.

### GPU Temperature (°C)

- **Description:** GPU core temperature in degrees Celsius
- **Metric Type:** GAUGE
- **Unit:** °C
- **Calculation Formula:**
  ```promql
  avg(DCGM_FI_DEV_GPU_TEMP)
  # OR (for Intel Gaudi)
  avg(habanalabs_temperature_onchip)
  ```
- **Special Notes:**
  - Multi-vendor support (NVIDIA DCGM, Intel Habana)
  - Uses `max_over_time()` in sparklines to capture temperature spikes
  - Node-level metric (no model_name labels)

### GPU Power Usage (Watts)

- **Description:** GPU power consumption in watts
- **Metric Type:** GAUGE
- **Unit:** W
- **Calculation Formula:**
  ```promql
  avg(DCGM_FI_DEV_POWER_USAGE)
  # OR (for Intel Gaudi)
  avg(habanalabs_power_mW) / 1000
  ```
- **Special Notes:**
  - Multi-vendor support
  - Gaudi metrics converted from milliwatts to watts
  - Uses `max_over_time()` in sparklines to capture power spikes

### P95 Latency (s)

- **Description:** 95th percentile end-to-end request latency in seconds
- **Metric Type:** HISTOGRAM
- **Unit:** s
- **Calculation Formula:**
  ```promql
  histogram_quantile(0.95, sum(rate(vllm:e2e_request_latency_seconds_bucket[5m])) by (le))
  ```
- **Special Notes:**
  - Uses histogram quantile calculation over latency buckets
  - `[5m]` replaced with proportional lookback for smooth data
  - Key SLA monitoring metric

### GPU Usage (%)

- **Description:** GPU compute utilization percentage (consolidated metric for all vendors)
- **Metric Type:** GAUGE
- **Unit:** %
- **Calculation Formula:**
  ```promql
  avg(DCGM_FI_DEV_GPU_UTIL)
  # OR (for Intel Gaudi)
  avg(habanalabs_utilization)
  ```
- **Special Notes:**
  - **Consolidated metric** - replaces previous "GPU Utilization (%)"
  - Multi-vendor support (NVIDIA, Habana, AMD planned)
  - Uses `max_over_time()` in sparklines to capture utilization spikes
  - Critical for identifying GPU bottlenecks

### Output Tokens Created

- **Description:** Total output tokens generated during the selected time window
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  increase(vllm:request_generation_tokens_sum[5m])
  # OR (fallback)
  sum(increase(vllm:generation_tokens_total[5m]))
  ```
- **Special Notes:**
  - `[5m]` replaced with full selected duration (e.g., `[1h]`)
  - Shows total tokens generated during window, not rate
  - Multiple fallback metrics for compatibility

### Prompt Tokens Created

- **Description:** Total prompt tokens processed during the selected time window
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  increase(vllm:request_prompt_tokens_sum[5m])
  # OR (fallback)
  sum(increase(vllm:prompt_tokens_total[5m]))
  ```
- **Special Notes:**
  - `[5m]` replaced with full selected duration
  - Shows total input tokens during window
  - Multiple fallback metrics for compatibility

---

## Request Tracking & Throughput

**Purpose:** Monitor request volume, status, and reliability.

### Requests Total

- **Description:** Total inference requests processed during the time window
- **Metric Type:** COUNTER
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:num_requests_total[5m]))
  # OR (fallback)
  sum(increase(vllm:request_success_total[5m])) + sum(increase(vllm:request_errors_total[5m]))
  ```
- **Special Notes:**
  - Priority fallback logic for compatibility
  - Includes both successful and failed requests
  - Time window adjusted based on selection

### Requests Running

- **Description:** Active ongoing inference requests (current queue depth)
- **Metric Type:** GAUGE
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  vllm:num_requests_running
  ```
- **Special Notes:**
  - Instant value (no time range)
  - Useful for monitoring system load
  - May spike during traffic bursts

### Request Errors Total

- **Description:** Total failed inference requests during the time window
- **Metric Type:** COUNTER
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:num_requests_total[5m])) - sum(increase(vllm:request_success_total[5m]))
  # OR (fallback)
  sum(increase(vllm:request_errors_total[5m]))
  ```
- **Special Notes:**
  - Calculated as total - success when both available
  - Time window adjusted based on selection
  - Key reliability metric

### Oom Errors Total

- **Description:** Out-of-memory errors during the time window
- **Metric Type:** COUNTER
- **Unit:** errors
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:oom_errors_total[5m]))
  # OR (fallback)
  sum(increase(vllm:request_oom_total[5m]))
  ```
- **Special Notes:**
  - Critical for capacity planning
  - Indicates insufficient GPU memory for workload
  - Should trigger alerts if non-zero

### Num Requests Waiting

- **Description:** Requests waiting in queue (not yet scheduled)
- **Metric Type:** GAUGE
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  vllm:num_requests_waiting
  ```
- **Special Notes:**
  - Instant value
  - Indicates backpressure when high
  - Different from "Scheduler Pending Requests"

### Scheduler Pending Requests

- **Description:** Requests pending in scheduler queue
- **Metric Type:** GAUGE
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  vllm:scheduler_pending_requests
  # OR (fallback)
  vllm:num_scheduler_pending
  ```
- **Special Notes:**
  - May differ from "Num Requests Waiting" depending on vLLM version
  - Indicates scheduler queue depth

---

## Token Throughput

**Purpose:** Monitor token processing performance and rates.

### Tokens Generated Per Second

- **Description:** Token generation rate in tokens per second
- **Metric Type:** SUMMARY
- **Unit:** t/s
- **Calculation Formula:**
  ```promql
  rate(vllm:request_generation_tokens_sum[5m])
  # OR (fallback)
  rate(vllm:generation_tokens_total[5m])
  ```
- **Special Notes:**
  - Shows rate (tokens/sec), not total
  - `[5m]` replaced with proportional lookback
  - Key throughput metric

### Prompt Tokens Total

- **Description:** Total prompt tokens processed during the time window
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:prompt_tokens_total[5m]))
  # OR (fallback)
  sum(increase(vllm:request_prompt_tokens_sum[5m]))
  ```
- **Special Notes:**
  - Different from "Prompt Tokens Created" (Key Metric)
  - Shows cumulative input tokens
  - Time window adjusted based on selection

### Generation Tokens Total

- **Description:** Total generated tokens during the time window
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:generation_tokens_total[5m]))
  # OR (fallback)
  sum(increase(vllm:request_generation_tokens_sum[5m]))
  ```
- **Special Notes:**
  - Different from "Output Tokens Created" (Key Metric)
  - Shows cumulative output tokens
  - Time window adjusted based on selection

### Request Prompt Tokens Sum

- **Description:** Total prompt tokens from all requests (cumulative sum)
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_prompt_tokens_sum[5m]))
  ```
- **Special Notes:**
  - Used to calculate average prompt size
  - Divide by Request Prompt Tokens Count for average
  - Time window adjusted based on selection

### Request Generation Tokens Sum

- **Description:** Total generation tokens from all requests (cumulative sum)
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_generation_tokens_sum[5m]))
  ```
- **Special Notes:**
  - Used to calculate average generation size
  - Divide by Request Generation Tokens Count for average
  - Time window adjusted based on selection

---

## Latency & Timing

**Purpose:** Response time breakdown and analysis for performance tuning.

### Inference Time (s)

- **Description:** Average inference time per request in seconds
- **Metric Type:** SUMMARY
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(rate(vllm:request_inference_time_seconds_sum[5m])) / sum(rate(vllm:request_inference_time_seconds_count[5m]))
  ```
- **Special Notes:**
  - Calculated as average from sum/count pairs
  - `[5m]` replaced with proportional lookback
  - Total inference time (prefill + decode)

### Streaming Ttft Seconds

- **Description:** Average time to first token for streaming requests
- **Metric Type:** SUMMARY
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(rate(vllm:time_to_first_token_seconds_sum[5m])) / sum(rate(vllm:time_to_first_token_seconds_count[5m]))
  ```
- **Special Notes:**
  - Critical for streaming latency perception
  - Lower is better for user experience
  - Only includes streaming requests

### Time To First Token Seconds Sum

- **Description:** Total time to first token across all requests (cumulative)
- **Metric Type:** COUNTER
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:time_to_first_token_seconds_sum[5m]))
  ```
- **Special Notes:**
  - Shows total TTFT time during window
  - Use with count to calculate average
  - Time window adjusted based on selection

### Time Per Output Token Seconds Sum

- **Description:** Total time per output token across all requests (cumulative)
- **Metric Type:** COUNTER
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:time_per_output_token_seconds_sum[5m]))
  ```
- **Special Notes:**
  - Shows total TPOT time during window
  - Indicates token generation efficiency
  - Time window adjusted based on selection

### Request Prefill Time Seconds Sum

- **Description:** Total prompt processing time across all requests (cumulative)
- **Metric Type:** COUNTER
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_prefill_time_seconds_sum[5m]))
  ```
- **Special Notes:**
  - Prefill = processing the input prompt
  - Often bottleneck for long prompts
  - Time window adjusted based on selection

### Request Decode Time Seconds Sum

- **Description:** Total token generation time across all requests (cumulative)
- **Metric Type:** COUNTER
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_decode_time_seconds_sum[5m]))
  ```
- **Special Notes:**
  - Decode = generating output tokens
  - Typically larger than prefill for long outputs
  - Time window adjusted based on selection

### Request Queue Time Seconds Sum

- **Description:** Total time spent waiting in queue across all requests
- **Metric Type:** COUNTER
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_queue_time_seconds_sum[5m]))
  ```
- **Special Notes:**
  - High values indicate system overload
  - Should be minimized for good UX
  - Time window adjusted based on selection

### E2E Request Latency Seconds Sum

- **Description:** Total end-to-end latency across all requests (cumulative)
- **Metric Type:** COUNTER
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:e2e_request_latency_seconds_sum[5m]))
  ```
- **Special Notes:**
  - E2E = queue + prefill + decode time
  - Most comprehensive latency metric
  - Time window adjusted based on selection

---

## Memory & Cache

**Purpose:** Monitor cache efficiency and memory utilization for optimal performance.

### Kv Cache Usage Perc

- **Description:** Key-Value cache utilization percentage
- **Metric Type:** GAUGE
- **Unit:** %
- **Calculation Formula:**
  ```promql
  vllm:kv_cache_usage_perc
  ```
- **Special Notes:**
  - Instant value
  - Uses `max_over_time()` in sparklines to capture spikes
  - High values (>90%) may cause OOM errors

### Gpu Cache Usage Perc

- **Description:** GPU cache utilization percentage
- **Metric Type:** GAUGE
- **Unit:** %
- **Calculation Formula:**
  ```promql
  vllm:gpu_cache_usage_perc
  ```
- **Special Notes:**
  - Instant value
  - Uses `max_over_time()` in sparklines
  - May differ from KV Cache depending on implementation

### Cache Fragmentation Ratio

- **Description:** KV cache fragmentation ratio (lower is better)
- **Metric Type:** GAUGE
- **Unit:** %
- **Calculation Formula:**
  ```promql
  100 - vllm:gpu_cache_usage_perc
  ```
- **Special Notes:**
  - Derived metric (calculated from GPU cache usage)
  - Higher fragmentation = less efficient memory use
  - Values >20% may indicate fragmentation issues

### Kv Cache Usage Bytes

- **Description:** KV cache memory currently used
- **Metric Type:** GAUGE
- **Unit:** GB
- **Calculation Formula:**
  ```promql
  vllm:kv_cache_usage_bytes / (1024*1024*1024)
  # OR (fallback)
  vllm:gpu_cache_usage_bytes / (1024*1024*1024)
  ```
- **Special Notes:**
  - Converted from bytes to GB for readability
  - Instant value
  - Critical for capacity planning

### Kv Cache Capacity Bytes

- **Description:** Total KV cache capacity available
- **Metric Type:** GAUGE
- **Unit:** GB
- **Calculation Formula:**
  ```promql
  vllm:kv_cache_capacity_bytes / (1024*1024*1024)
  # OR (fallback)
  vllm:cache_config_total_gpu_memory / (1024*1024*1024)
  ```
- **Special Notes:**
  - Converted from bytes to GB
  - Fixed value (depends on GPU memory and config)
  - Compare with Usage to determine headroom

### Kv Cache Free Bytes

- **Description:** KV cache memory currently available
- **Metric Type:** GAUGE
- **Unit:** GB
- **Calculation Formula:**
  ```promql
  vllm:kv_cache_free_bytes / (1024*1024*1024)
  # OR (fallback)
  vllm:gpu_cache_free_bytes / (1024*1024*1024)
  ```
- **Special Notes:**
  - Converted from bytes to GB
  - Should equal Capacity - Usage
  - Low values (<1GB) may cause OOM

### Prefix Cache Hits Total

- **Description:** Total prefix cache hits during the time window
- **Metric Type:** COUNTER
- **Unit:** hits
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:prefix_cache_hit_total[5m]))
  # OR (fallback)
  sum(increase(vllm:cache_prefix_hits_total[5m]))
  ```
- **Special Notes:**
  - Prefix caching improves performance for repeated prompts
  - Higher is better (indicates cache effectiveness)
  - Time window adjusted based on selection

### Prefix Cache Queries Total

- **Description:** Total prefix cache queries during the time window
- **Metric Type:** COUNTER
- **Unit:** queries
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:prefix_cache_query_total[5m]))
  # OR (fallback)
  sum(increase(vllm:cache_prefix_queries_total[5m]))
  ```
- **Special Notes:**
  - Total cache lookups attempted
  - Compare with Hits to calculate hit rate
  - Time window adjusted based on selection

### Gpu Prefix Cache Hits Total

- **Description:** GPU-specific prefix cache hits during the time window
- **Metric Type:** COUNTER
- **Unit:** hits
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:gpu_prefix_cache_hit_total[5m]))
  # OR (fallback)
  sum(increase(vllm:gpu_cache_prefix_hits_total[5m]))
  ```
- **Special Notes:**
  - GPU-level cache hits
  - May differ from general prefix cache in multi-tier setups
  - Time window adjusted based on selection

### Gpu Prefix Cache Queries Total

- **Description:** GPU-specific prefix cache queries during the time window
- **Metric Type:** COUNTER
- **Unit:** queries
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:gpu_prefix_cache_query_total[5m]))
  # OR (fallback)
  sum(increase(vllm:gpu_cache_prefix_queries_total[5m]))
  ```
- **Special Notes:**
  - GPU-level cache queries
  - Time window adjusted based on selection

### Gpu Prefix Cache Hits Created

- **Description:** GPU cache hit rate (hits per second)
- **Metric Type:** SUMMARY
- **Unit:** /s
- **Calculation Formula:**
  ```promql
  rate(vllm:gpu_prefix_cache_hit_total[5m])
  # OR (fallback)
  rate(vllm:gpu_cache_prefix_hits_total[5m])
  ```
- **Special Notes:**
  - Shows hit rate, not total
  - `[5m]` replaced with proportional lookback
  - Useful for real-time cache performance monitoring

### Gpu Prefix Cache Queries Created

- **Description:** GPU cache query rate (queries per second)
- **Metric Type:** SUMMARY
- **Unit:** /s
- **Calculation Formula:**
  ```promql
  rate(vllm:gpu_prefix_cache_query_total[5m])
  # OR (fallback)
  rate(vllm:gpu_cache_prefix_queries_total[5m])
  ```
- **Special Notes:**
  - Shows query rate, not total
  - `[5m]` replaced with proportional lookback

---

## Scheduling & Queueing

**Purpose:** Monitor scheduler performance and batching efficiency.

### Batch Size

- **Description:** Current batch size being processed
- **Metric Type:** GAUGE
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  vllm:batch_size
  # OR (fallback)
  vllm:avg_batch_size
  ```
- **Special Notes:**
  - Instant value
  - Higher batch size = better GPU utilization
  - Constrained by KV cache capacity

### Num Scheduled Requests

- **Description:** Number of requests currently scheduled for execution
- **Metric Type:** GAUGE
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  vllm:num_scheduled_requests
  # OR (fallback)
  vllm:scheduler_scheduled_count
  ```
- **Special Notes:**
  - Instant value
  - Shows scheduler's current workload

### Batching Idle Time Seconds

- **Description:** Average time scheduler waits to fill batches
- **Metric Type:** SUMMARY
- **Unit:** s
- **Calculation Formula:**
  ```promql
  sum(rate(vllm:batching_idle_time_seconds_sum[5m])) / sum(rate(vllm:batching_idle_time_seconds_count[5m]))
  # OR (fallback)
  vllm:scheduler_idle_time_seconds
  ```
- **Special Notes:**
  - Calculated as average from sum/count pairs
  - High values indicate underutilization
  - Low values indicate high load

---

## RPC Monitoring

**Purpose:** Monitor RPC server health and connectivity.

### Vllm Rpc Server Error Count

- **Description:** RPC server errors (current count)
- **Metric Type:** GAUGE
- **Unit:** errors
- **Calculation Formula:**
  ```promql
  vllm:rpc_server_error_count
  ```
- **Special Notes:**
  - Instant value (error gauge, not counter)
  - Should be monitored for spikes
  - Non-zero indicates communication issues

### Vllm Rpc Server Connection Total

- **Description:** Total RPC server connections (current count)
- **Metric Type:** GAUGE
- **Unit:** connections
- **Calculation Formula:**
  ```promql
  vllm:rpc_server_connection_total
  ```
- **Special Notes:**
  - Instant value (connection gauge, not counter)
  - Shows active connections
  - Useful for monitoring client connectivity

### Vllm Rpc Server Request Count

- **Description:** Total RPC requests processed during the time window
- **Metric Type:** COUNTER
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:rpc_server_request_count[5m]))
  # OR (fallback)
  sum(increase(vllm:rpc_requests_total[5m]))
  ```
- **Special Notes:**
  - Shows RPC throughput
  - Time window adjusted based on selection
  - Distinct from inference requests (lower-level metric)

---

## GPU Hardware

**Purpose:** Monitor GPU hardware health and resource usage.

### GPU Energy Consumption (Joules)

- **Description:** Total GPU energy consumed
- **Metric Type:** GAUGE
- **Unit:** J
- **Calculation Formula:**
  ```promql
  avg(DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION)
  # OR (for Intel Gaudi)
  avg(habanalabs_energy)
  ```
- **Special Notes:**
  - Cumulative energy counter
  - Useful for power/cost analysis
  - Multi-vendor support

### GPU Memory Usage (GB)

- **Description:** GPU VRAM currently allocated
- **Metric Type:** GAUGE
- **Unit:** GB
- **Calculation Formula:**
  ```promql
  avg(DCGM_FI_DEV_FB_USED) / (1024*1024*1024)
  # OR (for Intel Gaudi)
  avg(habanalabs_memory_used_bytes) / (1024*1024*1024)
  ```
- **Special Notes:**
  - Converted from bytes to GB
  - Includes KV cache + model weights + activations
  - Multi-vendor support

### GPU Memory Temperature (°C)

- **Description:** GPU memory temperature
- **Metric Type:** GAUGE
- **Unit:** °C
- **Calculation Formula:**
  ```promql
  avg(DCGM_FI_DEV_MEMORY_TEMP)
  # OR (for Intel Gaudi)
  avg(habanalabs_temperature_threshold_memory)
  ```
- **Special Notes:**
  - Separate from GPU core temperature
  - High values may indicate cooling issues
  - Uses `max_over_time()` in sparklines

---

## Request Parameters

**Purpose:** Analyze request configuration patterns and parameter distributions.

### Request Max Num Generation Tokens Sum

- **Description:** Sum of max_tokens parameter values across all requests
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_max_num_generation_tokens_sum[5m]))
  ```
- **Special Notes:**
  - Cumulative sum of max generation tokens requested
  - Divide by count to get average max_tokens per request
  - Time window adjusted based on selection

### Request Max Num Generation Tokens Count

- **Description:** Number of requests with max_tokens parameter set
- **Metric Type:** COUNTER
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_max_num_generation_tokens_count[5m]))
  ```
- **Special Notes:**
  - Count of requests specifying max generation limit
  - Time window adjusted based on selection

### Request Params Max Tokens Sum

- **Description:** Sum of max_tokens parameter values from request params
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_params_max_tokens_sum[5m]))
  ```
- **Special Notes:**
  - May differ from "Max Num Generation Tokens" depending on vLLM version
  - Time window adjusted based on selection

### Request Params Max Tokens Count

- **Description:** Number of requests with max_tokens in request params
- **Metric Type:** COUNTER
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_params_max_tokens_count[5m]))
  ```
- **Special Notes:**
  - Time window adjusted based on selection

### Request Params N Sum

- **Description:** Sum of 'n' parameter values (number of completions per request)
- **Metric Type:** COUNTER
- **Unit:** completions
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_params_n_sum[5m]))
  ```
- **Special Notes:**
  - n parameter specifies how many completions to generate
  - Time window adjusted based on selection

### Request Params N Count

- **Description:** Number of requests with 'n' parameter set
- **Metric Type:** COUNTER
- **Unit:** requests
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:request_params_n_count[5m]))
  ```
- **Special Notes:**
  - Time window adjusted based on selection

### Iteration Tokens Total Sum

- **Description:** Total tokens processed across all iterations
- **Metric Type:** COUNTER
- **Unit:** tokens
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:iteration_tokens_total_sum[5m]))
  ```
- **Special Notes:**
  - Cumulative tokens across decode iterations
  - Time window adjusted based on selection

### Iteration Tokens Total Count

- **Description:** Total number of decode iterations
- **Metric Type:** COUNTER
- **Unit:** iterations
- **Calculation Formula:**
  ```promql
  sum(increase(vllm:iteration_tokens_total_count[5m]))
  ```
- **Special Notes:**
  - Each iteration generates one or more tokens
  - Time window adjusted based on selection

---

## Metric Categories Summary

| Category | Metrics Count | Primary Purpose |
|----------|---------------|-----------------|
| Key Metrics | 6 | At-a-glance monitoring |
| Request Tracking & Throughput | 6 | Request volume and reliability |
| Token Throughput | 5 | Token processing performance |
| Latency & Timing | 8 | Response time analysis |
| Memory & Cache | 12 | Cache efficiency monitoring |
| Scheduling & Queueing | 3 | Scheduler performance |
| RPC Monitoring | 3 | RPC health monitoring |
| GPU Hardware | 3 | GPU resource monitoring |
| Request Parameters | 8 | Request pattern analysis |
| **Total** | **54** | **Comprehensive observability** |

---

## Time Range Behavior

### COUNTER Metrics
- **Behavior:** Values scale proportionally with time window
- **Example:**
  - 1 hour: 1000 requests
  - 6 hours: 6000 requests (6x more)
- **Time Range Replacement:** `[5m]` → `[1h]`, `[6h]`, etc. (full duration)

### GAUGE Metrics
- **Behavior:** Values show instant state (don't scale with time window)
- **Example:**
  - 1 hour: 10 requests running
  - 6 hours: 10 requests running (same value)
- **Time Range Replacement:** None (no `[Xm]` in query)

### SUMMARY/HISTOGRAM Metrics
- **Behavior:** Values show averages/rates (don't scale with time window)
- **Example:**
  - 1 hour: 100 tokens/sec
  - 6 hours: 100 tokens/sec (same rate)
- **Time Range Replacement:** `[5m]` → proportional lookback (`[5m]` for 1h, `[30m]` for 6h)

---

## Multi-Vendor GPU Support

The dashboard supports multiple GPU vendors with automatic detection:

| Vendor | Metrics Prefix | Supported Metrics |
|--------|----------------|-------------------|
| NVIDIA | `DCGM_FI_DEV_*` | Temperature, Power, Memory, Utilization, Energy |
| Intel Gaudi | `habanalabs_*` | Temperature, Power, Memory, Utilization, Energy |
| AMD (Planned) | `amd_smi_*` | Future support planned |

All GPU metrics are normalized to consistent names (e.g., "GPU Usage (%)" for all vendors).

---

## Best Practices

### Monitoring Critical Metrics
1. **GPU Usage (%)**: Should be >60% for good utilization, <95% to avoid bottlenecks
2. **P95 Latency**: Monitor against SLA targets
3. **Oom Errors Total**: Should be zero; non-zero indicates capacity issues
4. **Kv Cache Usage Perc**: Keep <90% to avoid OOM errors
5. **Request Errors Total**: Monitor error rate (errors / total requests)

### Alerting Recommendations
- **Critical**: OOM errors, GPU temperature >85°C, Error rate >5%
- **Warning**: GPU usage >95%, KV cache >90%, Queue time >5s
- **Info**: Batch size <4, Cache fragmentation >20%

### Performance Tuning
- **Low GPU Usage**: Increase batch size, reduce max_tokens
- **High Latency**: Check queue time, prefill time, cache efficiency
- **High OOM Errors**: Reduce KV cache size, limit concurrent requests
- **Low Cache Hit Rate**: Enable prefix caching, optimize prompt patterns

---

## Changelog

### Version 1.0 (2026-02-05)
- Initial comprehensive documentation
- Added 54 metrics across 9 categories
- Included metric type classification (COUNTER, GAUGE, HISTOGRAM, SUMMARY)
- Added calculation formulas and special notes for all metrics
- Documented multi-vendor GPU support
- Added time range behavior documentation
- Included best practices and alerting recommendations

---

## References

- **Implementation**: `src/core/metrics.py`
- **Frontend**: `openshift-plugin/src/core/pages/VLLMMetricsPage.tsx`
- **Metric Type Registry**: `src/core/metrics.py:METRIC_TYPES`
- **MCP Tools**: `src/mcp_server/tools/observability_vllm_tools.py`

For questions or issues, please refer to the main project documentation or open an issue in the GitHub repository.
