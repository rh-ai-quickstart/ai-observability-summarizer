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
8. [Architecture Decision Records](#architecture-decision-records)
9. [Configuration Reference](#configuration-reference)
10. [Appendix: File Reference](#appendix-file-reference)

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
      "icon": "\ud83c\udfe2",
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

The catalog is generated from a live Prometheus/Thanos instance using `scripts/metrics/metrics_cli.py`.

### Prerequisites

- Port-forward Prometheus or Thanos to `localhost:9090` (or set `--url`)
- Python 3.x with `requests` library

### Quick start

```bash
# Run all steps: fetch -> categorize -> optimize
python scripts/metrics/metrics_cli.py -a

# Or run individual steps:
python scripts/metrics/metrics_cli.py -f              # Step 1: Fetch from Prometheus
python scripts/metrics/metrics_cli.py -c              # Step 2: Categorize with priorities
python scripts/metrics/metrics_cli.py -m              # Step 3: Optimize with keywords

# Options:
python scripts/metrics/metrics_cli.py -a --url http://thanos:9090
python scripts/metrics/metrics_cli.py -a --exclude-gpu   # Base catalog (GPU discovered at runtime)
python scripts/metrics/metrics_cli.py -a -v               # Verbose output
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
| `cluster_health` | Cluster Resources & Health | \ud83c\udfe2 | 14 |
| `node_hardware` | Node & Hardware | \ud83d\udda5\ufe0f | 107 |
| `pod_container` | Pods & Containers | \ud83d\udce6 | 54 |
| `api_server` | API Server | \ud83d\udd0c | 39 |
| `etcd` | etcd | \ud83d\uddc3\ufe0f | 51 |
| `networking` | Networking | \ud83c\udf10 | 7 |
| `storage` | Storage | \ud83d\udcbe | 6 |
| `observability` | Observability Stack | \ud83d\udd2d | 25 |
| `gpu_ai` | GPU & AI/ML | \ud83c\udfae | 12 (static) + dynamic |
| `kubelet` | Kubelet | \u2699\ufe0f | 14 |
| `scheduler` | Scheduler | \ud83d\udcc5 | 2 |
| `security` | Security | \ud83d\udd12 | 8 |
| `controller_manager` | Controller Manager | \ud83c\udfae | 2 |
| `openshift_specific` | OpenShift Specific | \ud83c\udfe2 | 5 |
| `image_registry` | Image Registry | \ud83d\uddbc\ufe0f | 1 |
| `backup_dr` | Backup & DR | \ud83d\udcbe | 0 |
| `go_runtime` | Go Runtime | \u2699\ufe0f | 0 |

### How categories are assigned

Each category has a set of regex patterns that match metric names. During categorization (`metrics_cli.py` Step 2):

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

### MCP tools available to the AI

| Tool | Purpose |
|------|---------|
| `search_metrics` | Pattern-based metric search (broad exploration) |
| `search_metrics_by_category` | Category and priority-filtered search |
| `get_metrics_categories` | List all 17 categories with summary stats |
| `execute_promql` | Execute a PromQL query and return results |
| `get_metric_metadata` | Get type, help text, unit for a specific metric |
| `get_label_values` | Get all values for a label on a metric |
| `find_best_metric_with_metadata` | Full smart discovery pipeline (category hints + scoring + PromQL generation) |
| `suggest_queries` | Generate related PromQL queries from user intent |
| `explain_results` | Natural language explanation of query results |

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
| `PROMETHEUS_URL` | Prometheus/Thanos endpoint | `http://localhost:9090` |
| `GPU_METRICS_PREFIX_NVIDIA` | Additional NVIDIA metric prefixes (comma-separated) | (empty) |
| `GPU_METRICS_PREFIX_INTEL` | Additional Intel metric prefixes (comma-separated) | (empty) |
| `GPU_METRICS_PREFIX_AMD` | Additional AMD metric prefixes (comma-separated) | (empty) |

### MetricsCatalog initialization parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `catalog_path` | `Optional[Path]` | Auto-detected | Path to catalog JSON |
| `prometheus_url` | `Optional[str]` | From env | Prometheus URL for discovery |
| `enable_gpu_discovery` | `bool` | `True` | Enable async GPU discovery |
| `gpu_discovery_timeout` | `float` | `10.0` | GPU discovery timeout (seconds) |
| `enable_catalog_validation` | `bool` | `True` | Enable catalog validation against live Prometheus |
| `catalog_validation_timeout` | `float` | `10.0` | Validation timeout (seconds) |

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
| `src/mcp_server/tools/prometheus_tools.py` | MCP tool definitions (11 tools) |
| `src/mcp_server/observability_mcp.py` | Tool registration with FastMCP |
| `src/mcp_server/data/openshift-metrics-optimized.json` | Bundled metrics catalog (~840KB, ~2,000 metrics) |

### Scripts

| File | Purpose |
|------|---------|
| `scripts/metrics/metrics_cli.py` | CLI to fetch, categorize, and optimize metrics from Prometheus |

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

### Architecture decisions

| File | Topic |
|------|-------|
| `docs/plan/adr-001-storage-strategy.md` | Bundle catalog in container image |
| `docs/plan/adr-002-hybrid-catalog.md` | Hybrid static + dynamic GPU discovery |
| `docs/plan/adr-003-gpu-prefixes.md` | Configurable GPU metric prefixes via env vars |
