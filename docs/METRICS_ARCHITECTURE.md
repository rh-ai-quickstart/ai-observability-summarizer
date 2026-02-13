# Metrics Architecture Guide

This document describes the metrics catalog system: how metrics are pre-loaded, discovered dynamically, validated against live Prometheus, and used by the AI chat to answer user questions.

---

## Table of Contents

1. [Overview](#overview)
2. [Pre-Loaded Metrics Catalog](#pre-loaded-metrics-catalog)
3. [Generating the Catalog JSON](#generating-the-catalog-json)
4. [Dynamic GPU Metrics Discovery](#dynamic-gpu-metrics-discovery)
5. [Non-GPU Catalog Validation (Sync)](#non-gpu-catalog-validation-sync)
6. [Categories and Keywords](#categories-and-keywords)
7. [Query Flow: From User Question to PromQL](#query-flow-from-user-question-to-promql)
8. [Canonical Questions and Chat Enhancements](#canonical-questions-and-chat-enhancements)
9. [Frontend — Metrics Catalog Search & Caching](#frontend--metrics-catalog-search--caching)
10. [Frontend — Metric Categories in AI Chat](#frontend--metric-categories-in-ai-chat)
11. [Architecture Decision Records](#architecture-decision-records)
12. [Configuration Reference](#configuration-reference)
13. [Appendix: File Reference](#appendix-file-reference)

---

## Overview

The metrics system uses a **hybrid static + dynamic** architecture:

```
                        Startup
                          |
          +---------------+---------------+
          |                               |
    [Load Base Catalog]           [Background Threads]
    ~1,800 metrics from JSON      |               |
    (High + Medium priority)      |               |
          |                       |               |
          v                       v               v
    Server READY           GPU Discovery    Catalog Validation
    (~15ms)                (~1-2s)          (~1-2s)
                                |               |
                                v               v
                          Merge GPU        Remove stale /
                          metrics into     Add new metrics
                          gpu_ai category  from Prometheus
                                |               |
                                +-------+-------+
                                        |
                                        v
                                  Full Catalog
                                  (~2,000 metrics)
```

**Key principles:**
- Server is ready immediately after loading the static catalog
- GPU discovery and catalog validation run asynchronously and merge results when complete
- The system remains functional even if background threads fail

---

## Pre-Loaded Metrics Catalog

### What it is

A JSON file bundled in the container image containing ~1,800 pre-categorized OpenShift metrics with metadata, keywords, and priority levels. Low-priority metrics (debug, internal Go runtime, histogram buckets, build info) are excluded to reduce noise and file size.

### File location

- **Production (container):** `/app/mcp_server/data/openshift-metrics-optimized.json`
- **Development:** `src/mcp_server/data/openshift-metrics-optimized.json`

The file is included in the container image via the existing `COPY mcp_server /app/mcp_server` directive in the Dockerfile -- no special handling required.

### JSON structure

```json
{
  "metadata": {
    "generated": "2026-02-07 17:33:05",
    "total_metrics": 1992,
    "catalog_type": "full",
    "description": "Optimized OpenShift metrics with keywords..."
  },
  "categories": [
    {
      "id": "cluster_health",
      "name": "Cluster Resources & Health",
      "icon": "🏢",
      "purpose": "Monitor overall cluster state...",
      "keywords": ["cluster", "health", "operators", "version"],
      "metrics": {
        "High": [
          {
            "name": "cluster_operator_up",
            "type": "gauge",
            "help": "1 if a cluster operator is Available=True...",
            "keywords": ["available", "cluster operator", "operator health", "up"]
          }
        ],
        "Medium": [ ... ]
      }
    }
  ],
  "lookup": {
    "cluster_operator_up": {
      "category_id": "cluster_health",
      "priority": "High"
    }
  }
}
```

**Key sections:**
- **metadata** -- generation timestamp, total count, catalog type (`full` or `base`)
- **categories** -- 17 categories, each with metrics grouped by priority (`High` / `Medium`)
- **lookup** -- flat map of metric name to category and priority for O(1) access

### How it is loaded

`MetricsCatalog` (singleton in `src/core/metrics_catalog.py`) loads the JSON on first access:

1. Tries the base catalog path first (`openshift-metrics-base.json`) for hybrid mode
2. Falls back to the full catalog (`openshift-metrics-optimized.json`)
3. Builds in-memory lookup table and category index
4. If the catalog type is `base`, spawns background threads for GPU discovery and catalog validation

Loading takes ~15ms and is cached for the process lifetime via the singleton pattern.

---

## Generating the Catalog JSON

The catalog is generated from a live Prometheus/Thanos instance using `scripts/metrics/cli.py`.

### Prerequisites

- Port-forward Prometheus or Thanos to `localhost:9090` (or set `--url`)
- Python 3.x with `requests` library

### Quick start

```bash
# Run all steps: fetch -> categorize -> optimize
python scripts/metrics/cli.py -a

# Or run individual steps:
python scripts/metrics/cli.py -f              # Step 1: Fetch from Prometheus
python scripts/metrics/cli.py -c              # Step 2: Categorize with priorities
python scripts/metrics/cli.py -m              # Step 3: Optimize with keywords

# Options:
python scripts/metrics/cli.py -a --url http://thanos:9090
python scripts/metrics/cli.py -a --exclude-gpu   # Base catalog (GPU discovered at runtime)
python scripts/metrics/cli.py -a -v               # Verbose output
```

### Step 1: Fetch (`-f`)

**Class:** `MetricsFetcher`

Connects to Prometheus and fetches:
- All metric names via `/api/v1/label/__name__/values`
- Full metadata (type, help text, unit) via `/api/v1/metadata`

**Output:** `/tmp/metrics-data/metrics-report-{timestamp}.json`

### Step 2: Categorize (`-c`)

**Class:** `MetricsCategorizer`

Assigns each metric to one of 17 categories using regex patterns and assigns priority:

| Priority | Criteria | Examples |
|----------|----------|----------|
| **High** | Critical operational metrics matched by ~40 regex patterns | `cluster_operator_up`, `container_cpu_usage_seconds_total`, `DCGM_FI_DEV_GPU_UTIL` |
| **Medium** | Important metrics matching general patterns or in key categories | `kube_deployment_status_replicas`, `node_disk_io_time_seconds_total` |
| **Low** | Debug/internal metrics (excluded from bundled catalog) | `go_gc_duration_seconds`, `process_cpu_seconds_total`, histogram `_bucket` metrics |

**Output:** `/tmp/metrics-data/openshift-metrics-categories-{timestamp}.json`

### Step 3: Optimize (`-m`)

**Class:** `MetricsOptimizer`

Generates search keywords for each metric using a 5-tier priority system:

| Tier | Source | Example |
|------|--------|---------|
| 1 (highest) | Curated keywords for ~18 well-known metrics | `DCGM_FI_DEV_GPU_UTIL` -> `["gpu utilization", "gpu usage", "nvidia utilization"]` |
| 2 | Type-based keywords | Counter -> `["total", "count", "rate"]` |
| 3 | Pattern-based expansions (~30 patterns) | `_bytes` -> `["size", "storage"]`; `cpu` -> `["cpu", "processor", "compute"]` |
| 4 | Keywords extracted from metric name | `etcd_server_leader_changes` -> `["etcd", "server", "leader", "changes"]` |
| 5 (lowest) | Keywords from help text | Filtered for noise, used as fallback |

Each metric gets up to 12 keywords. Stopwords and unit terms are filtered out.

When `--exclude-gpu` is used, all GPU-related metrics (`DCGM_*`, `nvidia_*`, `vllm:*`, `habana_*`, `amdgpu_*`, `rocm_*`, etc.) are excluded from the output, producing a base catalog for hybrid mode.

**Output:** `src/mcp_server/data/openshift-metrics-optimized.json`

---

## Dynamic GPU Metrics Discovery

### Why dynamic?

GPU metrics vary by vendor and deployment. A cluster may have NVIDIA, Intel Gaudi, AMD, or no GPUs at all. Static bundling would either miss metrics or include irrelevant ones. Runtime discovery solves this by detecting what is actually available.

### Supported vendors

| Vendor | Default Prefixes | Env Var for Custom Prefixes |
|--------|-----------------|---------------------------|
| NVIDIA | `DCGM_*`, `nvidia_gpu_*` | `GPU_METRICS_PREFIX_NVIDIA` |
| Intel | `habanalabs_*`, `xpu_*`, `intel_gpu_*` | `GPU_METRICS_PREFIX_INTEL` |
| AMD | `amdgpu_*`, `rocm_*` | `GPU_METRICS_PREFIX_AMD` |
| Framework | `vllm:*`, `gpu_*` | (always included) |

Custom prefixes are **additive** -- they extend the defaults, never replace them. This ensures zero-config correctness while allowing extension for custom exporters.

```bash
# Example: add a custom NVIDIA exporter prefix
GPU_METRICS_PREFIX_NVIDIA="my_custom_gpu_,nvidia_smi_"
```

### Discovery flow

**Module:** `src/core/gpu_metrics_discovery.py` (`GPUMetricsDiscovery` class)

1. **Query Prometheus** for all metric names via `/api/v1/label/__name__/values`
2. **Filter** metrics matching any vendor or framework prefix pattern
3. **Detect vendor** -- the vendor with the most matching metrics is designated primary
4. **Assign priority** using 89 High-priority patterns across all vendors:
   - NVIDIA: GPU utilization, temperature, memory, power, encoder/decoder
   - Intel: Habana utilization, memory, temperature, power
   - AMD: GPU busy %, VRAM, temperature
   - vLLM: Latency (e2e, TTFT, ITL), throughput, cache utilization, preemptions
5. **Generate keywords** for each metric using curated keywords (144 entries) + name-based extraction
6. **Fetch metadata** from Prometheus (`/api/v1/metadata`) for type and help text
7. **Return** `GPUDiscoveryResult` with High and Medium priority lists

### Integration with catalog

When GPU discovery completes, `MetricsCatalog._merge_gpu_metrics()`:
- Replaces the `gpu_ai` category's High and Medium metric lists with discovered results
- Updates the lookup table with all discovered GPU metrics
- Records the detected vendor in catalog metadata

If discovery fails or times out (10s default), the catalog continues without GPU metrics and logs a warning.

### Key GPU metrics by vendor

**NVIDIA DCGM (High Priority):**
- `DCGM_FI_DEV_GPU_UTIL` -- GPU utilization %
- `DCGM_FI_DEV_GPU_TEMP` -- GPU temperature
- `DCGM_FI_DEV_POWER_USAGE` -- Power consumption (watts)
- `DCGM_FI_DEV_FB_USED` / `FB_FREE` -- Framebuffer (VRAM) usage

**vLLM Inference (High Priority):**
- `vllm:e2e_request_latency_seconds` -- End-to-end request latency (histogram)
- `vllm:time_to_first_token_seconds` -- TTFT / prompt processing (histogram)
- `vllm:inter_token_latency_seconds` -- TPOT / ITL / per-token latency (histogram)
- `vllm:gpu_cache_usage_perc` -- KV cache utilization (gauge, 0-1)
- `vllm:num_requests_running` / `waiting` -- Active and queued requests (gauges)
- `vllm:generation_tokens_total` -- Output token throughput (counter, use `rate()`)

---

## Non-GPU Catalog Validation (Sync)

### Problem

The bundled catalog is generated from a specific OCP version. Different clusters may have:
- **Missing metrics** -- older OCP versions lack some catalog metrics
- **New metrics** -- newer OCP versions expose additional metrics not in the catalog

### Solution

At startup, `CatalogValidator` (`src/core/catalog_validator.py`) validates the catalog against the live Prometheus instance.

### Validation flow

1. **Fetch all metric names** from Prometheus via `/api/v1/label/__name__/values`
2. **Fetch metadata** via `/api/v1/metadata` (single API call for all metrics)
3. **Build prefix map** from existing catalog metrics:
   - Extracts name prefixes at depths 1-4 (split on `_`)
   - Example: `etcd_server_leader_changes` produces prefixes `etcd`, `etcd_server`, `etcd_server_leader`, `etcd_server_leader_changes`
   - Only keeps **unambiguous** prefixes (those mapping to exactly one category)
   - GPU metrics are excluded from the prefix map (handled by GPU discovery)

4. **Identify stale metrics** -- catalog metrics not found in Prometheus:
   - Removed from the lookup table and category metric lists
   - GPU category is never pruned (even if metrics are temporarily unavailable)

5. **Identify new metrics** -- Prometheus metrics not in the catalog:
   - Filters out known low-value prefixes (`go_*`, `process_*`, `promhttp_*`)
   - Categorizes using longest-prefix-match against the prefix map
   - Metrics with no category match are skipped
   - All new metrics are assigned **Medium** priority (conservative)
   - Keywords generated from metric name and help text (max 12)

### Behavior

- Runs once at startup in a **background daemon thread**
- Times out after 10 seconds (configurable) to avoid blocking
- Errors are logged but do not prevent system operation
- Results are applied atomically under a thread lock

### Example

```
Catalog has: etcd_server_leader_changes_seen_total (category: etcd)
Prefix map:  "etcd_server" -> "etcd"

New Prometheus metric: etcd_server_proposals_committed_total
  -> Matches prefix "etcd_server" -> assigned to category "etcd", priority "Medium"
  -> Keywords generated from name: ["etcd", "server", "proposals", "committed"]

Missing metric: etcd_mvcc_db_open_read_transactions
  -> Not found in Prometheus -> removed from catalog
```

---

## Categories and Keywords

### Category taxonomy

The catalog organizes metrics into 17 categories (plus an `other` fallback):

| Category ID | Name | Icon | Typical High Priority Count |
|-------------|------|------|---------------------------|
| `cluster_health` | Cluster Resources & Health | 🏢 | 14 |
| `node_hardware` | Node & Hardware | 🖥️ | 107 |
| `pod_container` | Pods & Containers | 📦 | 54 |
| `api_server` | API Server | 🔌 | 39 |
| `etcd` | etcd | 🗃️ | 51 |
| `networking` | Networking | 🌐 | 7 |
| `storage` | Storage | 💾 | 6 |
| `observability` | Observability Stack | 🔭 | 25 |
| `gpu_ai` | GPU & AI/ML | 🎮 | 12 (static) + dynamic |
| `kubelet` | Kubelet | ⚙️ | 14 |
| `scheduler` | Scheduler | 📅 | 2 |
| `security` | Security | 🔒 | 8 |
| `controller_manager` | Controller Manager | 🎮 | 2 |
| `openshift_specific` | OpenShift Specific | 🏢 | 5 |
| `image_registry` | Image Registry | 🖼️ | 1 |
| `backup_dr` | Backup & DR | 💾 | 0 |
| `go_runtime` | Go Runtime | ⚙️ | 0 |

### How categories are assigned

Each category has a set of regex patterns that match metric names. During categorization (`cli.py` Step 2):

```
cluster_health:  ^cluster_, ^kube_node_status, ^kube_daemonset
node_hardware:   ^node_, ^machine_, ^system_
pod_container:   ^pod_, ^container_, ^kube_pod_, ^kubelet_running_
api_server:      ^apiserver_, ^apiextensions_
etcd:            ^etcd_
gpu_ai:          ^DCGM_, ^gpu_, ^nvidia_, ^vllm:
...
```

Metrics are matched against patterns in priority order (category priority 1-99). The first match wins. Unmatched metrics go to `other`.

### How keywords work

Each metric has up to 12 keywords for search relevance. At query time, `extract_category_hints()` maps user question keywords to categories:

```python
CATEGORY_KEYWORDS = {
    "gpu_ai": ["gpu", "nvidia", "cuda", "dcgm", "gaudi", "habana", "vllm",
               "ttft", "tpot", "itl", "kv cache", "inference", "serving", ...],
    "cluster_health": ["cluster", "capacity", "quota", "resource"],
    "node_hardware": ["node", "cpu", "memory", "disk"],
    "pod_container": ["pod", "container", "restart", "oom"],
    "etcd": ["etcd", "consensus", "raft"],
    ...
}
```

When a user asks "What's the GPU temperature?", the keyword `gpu` matches the `gpu_ai` category. The catalog then returns only High + Medium metrics from that category, reducing candidates from ~2,000 to ~50.

### Priority-based filtering

| Priority | Usage | Count |
|----------|-------|-------|
| **High** | First-choice metrics for general queries | ~350 |
| **Medium** | Included for category-specific or comprehensive queries | ~1,650 |
| **Low** | Excluded from bundled catalog entirely | N/A |

When category hints are found, both High and Medium metrics from those categories are returned. When no hints match (generic questions), only High priority metrics from all categories are returned to keep the candidate set manageable.

---

## Query Flow: From User Question to PromQL

The full flow from user question to executed PromQL query:

```
User: "What's the P95 latency for vLLM requests?"
                    |
                    v
         1. EXTRACT KEY CONCEPTS
            (chat_with_prometheus.py)
            -> intent_type: "percentile"
            -> measurements: ["latency"]
            -> components: []
                    |
                    v
         2. EXTRACT CATEGORY HINTS
            (metrics_catalog.py)
            -> keywords "vllm", "latency" match "gpu_ai"
            -> hints: ["gpu_ai"]
                    |
                    v
         3. GET SMART METRIC LIST
            (metrics_catalog.py)
            -> Filter gpu_ai category, High + Medium priority
            -> Returns ~50 GPU/vLLM metrics
                    |
                    v
         4. RANK BY RELEVANCE
            (chat_with_prometheus.py)
            -> Semantic scoring: name match, type match, keyword match
            -> vLLM latency metrics score highest
                    |
                    v
         5. ANALYZE TOP CANDIDATES
            (chat_with_prometheus.py)
            -> Try catalog first for metadata (fast, no API call)
            -> Fall back to Prometheus API if needed
            -> Apply priority bonuses: High +15, Medium +5
                    |
                    v
         6. SELECT BEST METRIC
            -> vllm:e2e_request_latency_seconds (highest total score)
                    |
                    v
         7. GENERATE PROMQL
            (chat_with_prometheus.py)
            -> intent "percentile" + type "histogram"
            -> histogram_quantile(0.95,
                 rate(vllm:e2e_request_latency_seconds_bucket[5m]))
                    |
                    v
         8. EXECUTE VIA MCP TOOL
            (prometheus_tools.py -> execute_promql)
            -> Returns structured results
```

### Semantic scoring breakdown

The scoring system in `calculate_semantic_score()` assigns points based on keyword matches:

| Pattern | Score Bonus |
|---------|-------------|
| GPU/CUDA/DCGM/vLLM keywords | +15 |
| TTFT/TPOT/ITL exact match | +20 |
| Temperature keywords | +15 |
| Memory/token/cache keywords | +12 |
| CPU/network keywords | +12 |
| Latency/error keywords | +10 |
| Kubernetes patterns (pod, kube_) | +8 |

Additional scoring from `calculate_type_relevance()` (metric type vs intent) and `calculate_specificity_score()` (subsystem-specific names score higher than generic ones).

### MCP tools — Metrics Catalog

All MCP tools are registered with the FastMCP server in `observability_mcp.py`. Both the AI chatbot (LLM) and the frontend UI consume tools through the same registry, but via different adapters:

- **AI chatbot (LLM)**: Calls tools via `MCPServerAdapter` (`mcp_tools_adapter.py`), which looks up registered tools by name from FastMCP and executes them in-process. The LLM decides which tools to call based on the system prompt in `base.py`.
- **Frontend UI**: Calls tools via HTTP using `callMcpTool()` (`mcpClient.ts`), which sends JSON-RPC requests to the MCP server endpoint.

Because both consumers dispatch tools **by name through the FastMCP registry**, a function must be registered as an MCP tool to be callable by either consumer.

#### AI chatbot tools (LLM consumption)

These tools return markdown-formatted responses optimized for LLM reasoning:

| Tool | Purpose |
|------|---------|
| `search_metrics` | Pattern-based metric search (broad exploration) |
| `search_metrics_by_category` | Category and priority-filtered search |
| `get_metrics_categories` | List all categories with summary stats (markdown + embedded JSON) |
| `execute_promql` | Execute a PromQL query and return results |
| `get_metric_metadata` | Get type, help text, unit for a specific metric |
| `get_label_values` | Get all values for a label on a metric |
| `find_best_metric_with_metadata` | Full smart discovery pipeline (category hints + scoring + PromQL generation) |
| `suggest_queries` | Generate related PromQL queries from user intent |
| `explain_results` | Natural language explanation of query results |

#### UI tools (frontend consumption)

These tools return clean JSON responses for direct use by frontend components:

| Tool | Purpose |
|------|---------|
| `get_category_metrics_detail` | When called **without** `category_id`: returns JSON array of all category summaries (id, name, icon, metric count, priority distribution). When called **with** `category_id`: returns that category's detailed metrics including name, type, help text, and keywords, grouped by priority. Used by the Metrics Catalog tab in Settings. |

> **Note:** `get_metrics_categories` (AI) and `get_category_metrics_detail` (UI) serve similar data but in different formats. The AI tool includes markdown formatting and example queries for LLM reasoning. The UI tool returns structured JSON for rendering in PatternFly components. They are intentionally separate to keep each consumer's contract clean.

---

## Canonical Questions and Chat Enhancements

This section covers how `chat_with_prometheus.py` handles a defined set of canonical question patterns and the vLLM-specific enhancements that improve metric discovery and PromQL generation for inference workloads.

### Intent detection

`extract_key_concepts()` analyzes the user's question and classifies it into one of 8 intent types. The original 4 intents (`current_value`, `count`, `average`, `percentile`) were extended with 4 new intents to cover common operational queries:

| Intent Type | Trigger Keywords | Example Question |
|-------------|-----------------|------------------|
| `current_value` | "current", "now", "latest", "what is" | "What is the GPU temperature?" |
| `count` | "how many", "count", "total" | "How many pods are running?" |
| `average` | "average", "avg", "mean" | "What is the average CPU usage?" |
| `percentile` | "p95", "p99", "percentile", "distribution" | "What is the P95 latency?" |
| `top_n` | "top", "highest", "lowest", "busiest", "ranking" | "Which pods have the highest memory?" |
| `comparison` | "compare", "vs", "versus", "difference between" | "Compare latency across models" |
| `trend` | "over time", "changed", "increasing", "decreasing", "trend" | "How has GPU utilization changed?" |
| `rate` | "rate", "per second", "throughput", "tokens per second" | "What is the token throughput rate?" |

### Measurement types

`extract_key_concepts()` also extracts measurement types from the question. In addition to the original types (temperature, memory, cpu, gpu, network, latency, usage), 5 vLLM-specific measurement types were added:

| Measurement | Trigger Keywords | Maps to Metrics |
|-------------|-----------------|-----------------|
| `tokens` | "token", "tokens", "throughput" | `vllm:generation_tokens_total`, `vllm:prompt_tokens_total` |
| `cache` | "cache", "kv cache", "prefix cache" | `vllm:gpu_cache_usage_perc`, `vllm:prefix_cache_*` |
| `queue` | "queue", "waiting", "pending" | `vllm:num_requests_waiting`, `vllm:request_queue_time_seconds` |
| `ttft` | "ttft", "time to first token" | `vllm:time_to_first_token_seconds` |
| `tpot` | "tpot", "time per output token" | `vllm:inter_token_latency_seconds` |

### vLLM-specific semantic scoring

`calculate_semantic_score()` includes scoring rules that boost vLLM metrics when the user's question contains inference-related terms:

| Pattern Match | Score Bonus | Example |
|--------------|-------------|---------|
| TTFT/TPOT/ITL abbreviation exact match | +20 | "ttft" intent + `vllm:time_to_first_token_seconds` |
| vLLM/inference/model serving + `vllm:` metric | +15 | "vllm inference latency" + `vllm:e2e_request_latency_seconds` |
| Token/throughput + token/generation metric | +12 | "token throughput" + `vllm:generation_tokens_total` |
| Cache/kv cache + cache metric | +12 | "kv cache usage" + `vllm:gpu_cache_usage_perc` |

These bonuses stack with the existing scoring (name match, type relevance, specificity), so a question like "What is the TTFT?" correctly selects `vllm:time_to_first_token_seconds` over other latency metrics.

### PromQL generation for new intents

`generate_metadata_driven_promql()` generates appropriate PromQL for each intent type based on the selected metric's type (counter, gauge, histogram):

| Intent | Counter | Gauge | Histogram |
|--------|---------|-------|-----------|
| `rate` | `sum(rate(M[5m]))` | `rate(M[5m])` | `histogram_quantile(0.95, rate(M_bucket[5m]))` |
| `trend` | `rate(M[5m])` | `avg_over_time(M[1h])` | `M` |
| `top_n` | `topk(5, rate(M[5m]))` | `topk(5, M)` | `topk(5, M)` |
| `comparison` | `sum by (model_name) (rate(M[5m]))` | `avg by (model_name) (M)` | `histogram_quantile(0.95, sum by (model_name, le) (rate(M_bucket[5m])))` |

The `comparison` intent uses `model_name` as the default group-by label since the most common comparison is across vLLM model deployments.

### Category hint extraction for vLLM

`extract_category_hints()` in `metrics_catalog.py` maps user query keywords to metric categories. The `gpu_ai` category's keyword list was expanded to include vLLM-specific terms:

- **Abbreviations:** ttft, tpot, itl, kv cache, prefix cache
- **Latency phases:** decode, prefill, queue time, e2e latency, first token
- **Throughput:** tokens per second, generation tokens, prompt tokens
- **Model serving:** model serving, llm, serving, inference, cache hit, cache usage
- **Scheduling:** preemption

This ensures questions like "What is the TTFT?" or "Show prefix cache hit rate" correctly route to the `gpu_ai` category and return only GPU/inference metrics as candidates.

### System prompt vLLM domain knowledge

The system prompt in `base.py` includes a dedicated vLLM domain knowledge section that gives the LLM context about:

- **Latency phases:** E2E, TTFT, queue time, prefill, decode -- and how they decompose (Queue + Prefill + Decode = E2E)
- **Throughput metrics:** prompt tokens, generation tokens, and how to calculate tokens/sec with `rate()`
- **KV cache and scheduling:** cache utilization gauges, running/waiting request counts, preemptions
- **Prefix caching:** cache hit rate formula using `rate()` division
- **Common abbreviations:** TTFT, TPOT, ITL, KV, E2E
- **PromQL patterns:** P95 latency with `histogram_quantile`, per-model comparisons with `by (model_name)`, cache saturation checks

This domain knowledge helps the LLM interpret metric results correctly and provide contextual explanations (e.g., "TTFT measures prompt processing + scheduling overhead").

### Test coverage

`tests/core/test_canonical_questions.py` provides parametrized tests covering the canonical question pipeline:

| Test Class | What it Tests | Test Count |
|------------|--------------|------------|
| `TestExtractKeyConcepts` | Intent detection for all 8 types + measurement detection for vLLM types | ~25 |
| `TestExtractCategoryHintsVLLM` | vLLM keywords mapping to `gpu_ai` category + no dangling `vllm` category | ~19 |
| `TestGeneratePromQLNewIntents` | PromQL generation for 4 new intents across counter/gauge/histogram types + percentile rate wrapping | ~11 |
| `TestSemanticScoreVLLM` | vLLM scoring bonuses (TTFT/TPOT/ITL +20, inference +15, token/cache +12) + negative cases | ~7 |

The "no dangling vllm category" test verifies a bug fix: earlier, the keyword "vllm" mapped to a nonexistent `vllm` category instead of `gpu_ai`. The test confirms `extract_category_hints("vllm metrics")` returns `["gpu_ai"]` and does not include `"vllm"`.

### Frontend — Consolidated Metrics Settings Tab

The Settings modal groups all three metrics tabs under a single **"Metrics"** parent tab with three subtabs:

| Subtab | Source | Description |
|--------|--------|-------------|
| **Chat Metrics Catalog** | MCP `get_category_metrics_detail` tool | Browse the AI chat metrics catalog (loaded from MCP server) |
| **vLLM Metrics** | `vllmMetricsConfig.ts` | Read-only view of vLLM Metrics page metrics (6 key + 8 categories) |
| **OpenShift Metrics** | `openshiftMetricsConfig.ts` | Read-only view of OpenShift Metrics page metrics (11 categories) |

The wrapper component (`MetricsSettingsTab.tsx`) manages:
- **Subtab state** — which of the 3 subtabs is active
- **Shared download button** — a single download button in the parent header delegates to whichever subtab is active via `downloadRef` props
- **Hidden sub-headers** — each sub-component receives `hideHeader={true}` to suppress its individual header/download button when rendered inside the wrapper

Each sub-component accepts two optional props for wrapper integration:
- `downloadRef?: React.MutableRefObject<(() => void) | null>` — registers its download handler so the parent can trigger it
- `hideHeader?: boolean` — hides the individual header+download button

These props are optional, so the sub-components remain usable standalone (e.g., in tests).

### Frontend — Metrics Catalog Search & Caching

The `MetricsCatalogTab` in Settings uses a multi-layer performance optimization for browsing and searching ~1,877 metrics:

```
Tab opens
    |
    v
[Load from cache?] --yes--> Render immediately
    |no
    v
[Fetch category summaries]  (1 API call)
    |
    v
[Fetch all category details in parallel]  (Promise.allSettled, N API calls)
    |
    v
[Store in module-level cache]  (persists for page session lifetime)
    |
    v
[Render categories + SearchInput]

User types in SearchInput
    |
    v
[searchTerm updates instantly]  (input stays responsive)
    |
    v
[200ms debounce timer]
    |
    v
[debouncedSearch triggers useMemo filtering]
    - Matches category name/description
    - Matches individual metric name, help text, keywords
    |
    v
[filteredCategories + metricMatches]
    - Categories with metric-level matches show "X matches" badge
    - Auto-expand only if ≤ 2 categories match
    - Lazy content rendering: DOM only for expanded categories
```

**Cache behavior:** The metrics catalog is static after MCP server startup (metrics sync only at startup time). The module-level cache has no TTL -- it persists for the page session lifetime and is cleared on page refresh. For test isolation, `resetMetricsCatalogCache()` is exported and called in `beforeEach`.

### Frontend — Metric Categories in AI Chat

Metric categories can be displayed in the chat page in two locations (configurable via Chat Settings):

| Mode | Component | Behavior |
|------|-----------|----------|
| **Header** (default) | `MetricCategoriesPopover` | Button in chat header, opens popover with category list → click category → see pre-defined questions → click question → sends to chat |
| **Inline** | `MetricCategoriesInline` | Expandable section in chat body with category dropdown → select category → see question cards → click question → sends to chat |

**Inline section behavior:**
- **Mutual exclusion:** When both Suggested Questions and Metric Categories are inline, expanding one collapses the other
- **Collapse on send:** Both inline sections collapse when a question is sent
- **Category context:** Selecting a category shows a purple badge above the input; typing a manual message auto-prefixes with "Regarding {category} metrics: ..."
- **Category clearing:** The category badge clears after any message is sent

**Pre-defined questions:** `CATEGORY_QUESTIONS` in `MetricCategoriesPopover.tsx` maps 18 category IDs to 4-8 pre-defined questions each. Categories without entries get a default "Show me the key {name} metrics" question via `getQuestionsForCategory()`.

---

## Architecture Decision Records

Three ADRs document the key design decisions. Full details are in `docs/plan/`.

### ADR-001: Bundle Catalog in Container Image

**Decision:** Bundle the metrics JSON in the container image rather than using a ConfigMap.

**Rationale:** The catalog is reference data (not configuration), tightly coupled to the application version. At ~840KB it adds negligible overhead to the image. Bundling provides reliability (no external dependencies), performance (~15ms load vs 50-200ms ConfigMap mount), and atomic versioning with the application.

**Trade-off:** Catalog changes require an image rebuild.

### ADR-002: Hybrid Catalog with Runtime GPU Discovery

**Decision:** Use a static base catalog for stable metrics (OpenShift core, Kubernetes, networking, storage, etcd, etc.) combined with runtime GPU discovery for vendor-specific metrics.

**Rationale:** GPU metrics vary by vendor (NVIDIA DCGM, Intel Habana, AMD ROCm) and deployment. Static bundling would either miss vendor-specific metrics or include irrelevant ones. Runtime discovery detects what is actually available on the cluster.

**Architecture:** The base catalog loads synchronously (~15ms), making the server immediately ready. GPU discovery runs asynchronously (~1-2s) and merges results into the `gpu_ai` category when complete.

### ADR-003: Configurable GPU Metric Prefixes

**Decision:** Allow custom GPU metric prefixes via environment variables (`GPU_METRICS_PREFIX_NVIDIA`, `GPU_METRICS_PREFIX_INTEL`, `GPU_METRICS_PREFIX_AMD`). Custom prefixes are **additive** -- they extend the hardcoded defaults, never replace them.

**Rationale:** Supports custom GPU exporters without container rebuilds while maintaining zero-config correctness. The hardcoded defaults ensure the system works out-of-box for standard deployments.

**Usage via Helm:**
```bash
make install-mcp-server NAMESPACE=my-ns GPU_PREFIX_NVIDIA="my_custom_gpu_"
```

---

## Configuration Reference

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PROMETHEUS_URL` | Prometheus/Thanos endpoint | Auto-detected: in-cluster uses Thanos service URL, local dev uses `http://localhost:9090` |
| `GPU_METRICS_PREFIX_NVIDIA` | Additional NVIDIA metric prefixes (comma-separated) | (empty) |
| `GPU_METRICS_PREFIX_INTEL` | Additional Intel metric prefixes (comma-separated) | (empty) |
| `GPU_METRICS_PREFIX_AMD` | Additional AMD metric prefixes (comma-separated) | (empty) |
| `DISCOVERY_TIMEOUT_SECONDS` | Timeout for GPU discovery and catalog validation (seconds) | `10.0` |

### MetricsCatalog initialization parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `catalog_path` | `Optional[Path]` | Auto-detected | Path to catalog JSON |
| `prometheus_url` | `Optional[str]` | From `config.PROMETHEUS_URL` | Prometheus URL for discovery and validation |
| `enable_gpu_discovery` | `bool` | `True` | Enable async GPU discovery |
| `gpu_discovery_timeout` | `float` | `DISCOVERY_TIMEOUT_SECONDS` | GPU discovery timeout (seconds) |
| `enable_catalog_validation` | `bool` | `True` | Enable catalog validation against live Prometheus |
| `catalog_validation_timeout` | `float` | `DISCOVERY_TIMEOUT_SECONDS` | Validation timeout (seconds) |

### Performance characteristics

| Metric | Value |
|--------|-------|
| Cold start catalog load | ~15ms |
| Cached catalog access | ~0.05ms |
| Category filtering | ~3-5ms |
| GPU discovery | ~1-2s (async) |
| Catalog validation | ~1-2s (async) |
| Smart discovery (catalog path) | ~1.1s |
| Smart discovery (API fallback) | ~3.7s |

---

## Appendix: File Reference

### Core modules

| File | Purpose |
|------|---------|
| `src/core/metrics_catalog.py` | `MetricsCatalog` singleton -- loads JSON, manages GPU discovery, catalog validation, category/keyword search |
| `src/core/gpu_metrics_discovery.py` | `GPUMetricsDiscovery` -- runtime GPU metric detection for NVIDIA, Intel, AMD |
| `src/core/catalog_validator.py` | `CatalogValidator` -- validates bundled catalog against live Prometheus |
| `src/core/chat_with_prometheus.py` | Query pipeline -- concept extraction, semantic scoring, metric selection, PromQL generation |
| `src/chatbots/base.py` | System prompt with catalog/GPU/vLLM domain knowledge |

### MCP server

| File | Purpose |
|------|---------|
| `src/mcp_server/tools/prometheus_tools.py` | MCP tool definitions (12 tools) |
| `src/mcp_server/observability_mcp.py` | Tool registration with FastMCP |
| `src/mcp_server/mcp_tools_adapter.py` | `MCPServerAdapter` -- allows LLM chatbots to call MCP tools by name in-process |
| `src/mcp_server/data/openshift-metrics-optimized.json` | Bundled metrics catalog (~840KB, ~2,000 metrics) |

### Frontend (Metrics UI)

| File | Purpose |
|------|---------|
| `openshift-plugin/src/core/data/vllmMetricsConfig.ts` | Shared vLLM metric constants (`KEY_METRICS_CONFIG`, `METRIC_CATEGORIES`) -- imported by VLLMMetricsPage and VLLMMetricsSettingsTab |
| `openshift-plugin/src/core/data/openshiftMetricsConfig.ts` | Shared OpenShift metric constants (`CLUSTER_WIDE_CATEGORIES`) -- imported by OpenShiftMetricsPage and OpenShiftMetricsSettingsTab |
| `openshift-plugin/src/core/utils/downloadFile.ts` | Shared `downloadAsFile()` utility for exporting metrics as markdown files |
| `openshift-plugin/src/core/components/AIModelSettings/tabs/MetricsSettingsTab.tsx` | Consolidated Metrics wrapper tab -- manages subtab state (catalog/vLLM/OpenShift), shared download button via `downloadRef`, renders sub-components with `hideHeader` |
| `openshift-plugin/src/core/components/AIModelSettings/tabs/MetricsCatalogTab.tsx` | Chat Metrics Catalog subtab -- browse MCP catalog categories with deep search, session-lifetime caching, debounced filtering; accepts `downloadRef`/`hideHeader` props |
| `openshift-plugin/src/core/components/AIModelSettings/tabs/VLLMMetricsSettingsTab.tsx` | vLLM Metrics subtab -- read-only view of vLLM metrics (6 key + 8 categories) with search; accepts `downloadRef`/`hideHeader` props |
| `openshift-plugin/src/core/components/AIModelSettings/tabs/OpenShiftMetricsSettingsTab.tsx` | OpenShift Metrics subtab -- read-only view of OpenShift metrics (11 categories) with search; accepts `downloadRef`/`hideHeader` props |
| `openshift-plugin/src/core/components/AIModelSettings/tabs/ChatSettingsTab.tsx` | Chat Settings tab -- includes `metricCategoriesLocation` and `suggestedQuestionsLocation` radio groups |
| `openshift-plugin/src/core/components/AIModelSettings/index.tsx` | Settings modal -- registers 5 tabs: Models, API Keys, Add Model, Chat Settings, Metrics |
| `openshift-plugin/src/core/components/MetricCategoriesPopover.tsx` | Header popover for metric categories with pre-defined questions per category (`CATEGORY_QUESTIONS` map) |
| `openshift-plugin/src/core/components/MetricCategoriesInline.tsx` | Inline expandable section with category dropdown and clickable question cards |
| `openshift-plugin/src/core/hooks/useChatSettings.ts` | Chat settings hook -- includes `metricCategoriesLocation: 'header' \| 'inline'` |
| `openshift-plugin/src/core/services/mcpClient.ts` | `callMcpTool()` -- HTTP client for calling MCP tools from the frontend |
| `openshift-plugin/src/core/pages/AIChatPage.tsx` | Chat page -- conditional rendering of header/inline metric categories, mutual exclusion with suggested questions |

### Scripts

| File | Purpose |
|------|---------|
| `scripts/metrics/cli.py` | CLI to fetch, categorize, and optimize metrics from Prometheus |

### Tests

| File | Purpose |
|------|---------|
| `tests/core/test_metrics_catalog.py` | Unit tests for catalog loading, filtering, keyword search |
| `tests/core/test_catalog_validator.py` | Unit tests for catalog validation and sync |
| `tests/core/test_chat_with_prometheus.py` | Tests for query pipeline and semantic scoring |
| `tests/core/test_gpu_discovery.py` | GPU discovery tests including env var prefix configuration |
| `tests/core/test_canonical_questions.py` | Parametrized tests for canonical question set (Q1-Q20, SQ1-SQ3) |
| `tests/test_smart_metrics_integration.py` | Integration tests for end-to-end discovery |
| `tests/performance/test_metrics_catalog_perf.py` | Performance benchmarks |
| `openshift-plugin/__tests__/components/MetricsSettingsTab.test.tsx` | Frontend tests for consolidated Metrics wrapper (subtab rendering, switching, download delegation) |
| `openshift-plugin/__tests__/components/MetricsCatalogTab.test.tsx` | Frontend tests for Metrics Catalog subtab (search, caching, debounce, download) |
| `openshift-plugin/__tests__/components/VLLMMetricsSettingsTab.test.tsx` | Frontend tests for vLLM Metrics subtab |
| `openshift-plugin/__tests__/components/OpenShiftMetricsSettingsTab.test.tsx` | Frontend tests for OpenShift Metrics subtab |
| `openshift-plugin/__tests__/components/MetricCategoriesInline.test.tsx` | Frontend tests for inline metric categories component |
| `openshift-plugin/__tests__/components/MetricCategoriesPopover.test.tsx` | Frontend tests for header popover metric categories |
| `openshift-plugin/__tests__/pages/AIChatPage.test.tsx` | Chat page tests including metric categories integration |

### Architecture decisions

| File | Topic |
|------|-------|
| `docs/plan/adr-001-storage-strategy.md` | Bundle catalog in container image |
| `docs/plan/adr-002-hybrid-catalog.md` | Hybrid static + dynamic GPU discovery |
| `docs/plan/adr-003-gpu-prefixes.md` | Configurable GPU metric prefixes via env vars |
