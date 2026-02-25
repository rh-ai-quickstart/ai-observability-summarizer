#!/usr/bin/env python3
"""
OpenShift Metrics CLI - Unified tool for fetching, categorizing, and optimizing metrics.

Usage:
    python scripts/metrics/cli.py -f              # Fetch from Prometheus
    python scripts/metrics/cli.py -c              # Categorize metrics
    python scripts/metrics/cli.py -m              # Optimize with keywords (full catalog)
    python scripts/metrics/cli.py -m --exclude-gpu # Create base catalog (no GPU)
    python scripts/metrics/cli.py -a              # Run all steps
    python scripts/metrics/cli.py -a -o out.json  # Custom output path

Options:
    -f, --fetch       Fetch metrics from Prometheus/Thanos
    -c, --categorize  Categorize metrics with priorities
    -m, --optimize    Create optimized JSON with keywords
    -a, --all         Run all steps (fetch → categorize → optimize)
    -o, --output      Output path for optimized JSON
    --exclude-gpu     Exclude GPU/AI metrics (creates base catalog for hybrid mode)
    --url             Prometheus/Thanos URL (default: http://localhost:9090)
    -v, --verbose     Verbose output
    -h, --help        Show this help message

Hybrid Catalog Mode (--exclude-gpu):
    Creates a base catalog without GPU/AI metrics. GPU metrics are then
    discovered at runtime by the MCP server, supporting any GPU vendor
    (NVIDIA, Intel, AMD) without rebuilding the container.

    Excluded patterns: DCGM_*, gpu_*, nvidia_*, vllm:*, habana_*, xpu_*,
                       intel_gpu_*, amdgpu_*, rocm_*
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Tuple, Set, Optional
from collections import defaultdict

try:
    import requests
except ImportError:
    requests = None  # Will fail gracefully if fetch is attempted


# =============================================================================
# CONFIGURATION
# =============================================================================

# Script paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_METRICS_DIR = Path("/tmp/metrics-data")  # Intermediate files (fetched, categories)
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "src/mcp_server/data"  # Final optimized JSON

# Default Prometheus URL
DEFAULT_PROMETHEUS_URL = "http://localhost:9090"


# =============================================================================
# KEYWORD GENERATION - Constants
# =============================================================================

# Curated keywords from gist (metric_name -> keywords)
GIST_KEYWORDS: Dict[str, List[str]] = {
    "vllm:e2e_request_latency_seconds_sum": ["latency", "response time", "slow", "p95", "p99", "percentile"],
    "vllm:num_requests_running": ["requests running", "inflight", "in flight", "running requests", "concurrency"],
    "vllm:num_requests_waiting": ["queue", "waiting", "backlog"],
    "vllm:num_requests_total": ["throughput", "rps", "request rate", "requests per second"],
    "vllm:request_prompt_tokens_created": ["prompt tokens", "prompt throughput"],
    "vllm:request_generation_tokens_created": ["generation tokens", "output tokens", "token throughput"],
    "DCGM_FI_DEV_GPU_UTIL": ["gpu utilization", "gpu usage", "nvidia utilization", "dcgm utilization"],
    "DCGM_FI_DEV_GPU_TEMP": ["gpu temperature", "temp", "overheating", "thermal"],
    "DCGM_FI_DEV_POWER_USAGE": ["gpu power", "power usage", "watts", "power consumption"],
    "DCGM_FI_DEV_FB_USED": ["gpu memory", "vram", "framebuffer", "fb used"],
    "ALERTS": ["alerts", "firing", "critical", "warning"],
    "kube_pod_status_phase": ["pods", "pod status", "running pods", "failed pods", "pending pods"],
    "kube_pod_info": ["total pods", "pod count", "how many pods", "pods in namespace"],
    "kube_deployment_status_replicas_available": ["deployment", "replicas available", "availability"],
    "kube_pod_container_status_restarts_total": ["restarts", "crashloop", "crash", "crashloopbackoff"],
    "kube_node_status_condition": ["nodes", "node ready", "notready", "ready"],
    "container_cpu_usage_seconds_total": ["cpu", "cpu usage", "utilization", "hot pods"],
    "container_memory_usage_bytes": ["memory", "ram", "oom", "memory usage"],
    "container_network_receive_bytes_total": ["network", "traffic", "rx", "receive bandwidth"],
    "kubelet_volume_stats_used_bytes": ["storage", "pvc", "disk", "volume usage"],
}

# Stopwords to filter out
STOPWORDS: Set[str] = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "of", "for", "in", "to", "and", "or", "but", "if", "then", "else",
    "when", "where", "why", "how", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just", "also",
    "with", "from", "by", "on", "at", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "again",
    "this", "that", "these", "those", "am", "its", "it", "per", "via",
}

# Units to filter out (replaced by conceptual terms)
UNITS_TO_FILTER: Set[str] = {
    "seconds", "second", "sec", "secs", "ms", "milliseconds", "millisecond",
    "bytes", "byte", "kb", "mb", "gb", "tb",
    "nanoseconds", "nanosecond", "ns", "us", "microseconds", "microsecond",
    "hz", "mhz", "ghz",
}

# Pattern-based keyword expansion (regex pattern -> keywords to add)
PATTERN_EXPANSIONS: List[tuple] = [
    # Latency/duration patterns
    (r"(latency|duration|time)", ["latency", "duration", "slow", "delay", "response time"]),
    (r"_seconds", ["duration", "time", "latency"]),
    (r"histogram|bucket|quantile", ["p50", "p90", "p95", "p99", "percentile"]),

    # Size/memory patterns
    (r"_bytes", ["size", "storage"]),
    (r"memory|mem_", ["memory", "ram"]),
    (r"(oom|out.of.memory)", ["oom", "memory pressure", "killed"]),

    # CPU patterns
    (r"cpu", ["cpu", "processor", "compute", "cores"]),
    (r"throttl", ["throttling", "throttled", "cpu limit"]),

    # Rate/throughput patterns (counters ending in _total typically represent rates)
    (r"_total$", ["total", "count", "cumulative", "rate"]),
    (r"(rate|throughput|rps)", ["rate", "throughput", "per second"]),
    (r"requests?", ["requests", "req"]),

    # Error/failure patterns
    (r"(error|fail)", ["error", "failure", "failed"]),
    (r"reject", ["rejection", "rejected", "error", "failed"]),
    (r"(crash|restart)", ["crash", "restart", "crashloop"]),

    # Temperature patterns
    (r"temp", ["temperature", "thermal", "heat", "overheating"]),

    # Utilization patterns
    (r"util", ["utilization", "usage", "percent"]),

    # GPU patterns
    (r"(gpu|dcgm|nvidia|cuda)", ["gpu", "nvidia", "accelerator"]),
    (r"(vram|framebuffer|fb_)", ["vram", "gpu memory"]),

    # Network patterns
    (r"network|net_", ["network", "traffic"]),
    (r"(receive|rx)", ["receive", "rx", "inbound", "ingress"]),
    (r"(transmit|tx)", ["transmit", "tx", "outbound", "egress"]),
    (r"(packet|pkt)", ["packets", "packet loss"]),
    (r"(bandwidth|bps)", ["bandwidth", "throughput"]),

    # Storage patterns
    (r"(disk|volume|pv|pvc)", ["disk", "storage", "volume"]),
    (r"(filesystem|fs_)", ["filesystem", "disk"]),
    (r"(iops|io_)", ["iops", "io", "read", "write"]),

    # Kubernetes patterns
    (r"^kube_pod", ["pod", "pods"]),
    (r"^kube_node", ["node", "nodes"]),
    (r"^kube_deployment", ["deployment", "deployments"]),
    (r"^kube_service", ["service", "services"]),
    (r"^container_", ["container", "containers"]),
    (r"kubelet", ["kubelet", "node agent"]),

    # etcd patterns
    (r"etcd", ["etcd", "datastore", "key-value"]),
    (r"(wal|write.ahead)", ["wal", "write ahead log"]),
    (r"(raft|consensus)", ["raft", "consensus", "leader"]),

    # API server patterns
    (r"apiserver", ["api", "apiserver", "kube-api"]),
    (r"admission", ["admission", "webhook", "validation"]),

    # Scheduler patterns
    (r"scheduler", ["scheduler", "scheduling", "pending"]),

    # Operator patterns
    (r"operator", ["operator", "controller"]),
    (r"cluster_operator", ["cluster operator", "operator health"]),

    # vLLM/inference patterns
    (r"vllm", ["vllm", "inference", "llm", "model serving"]),
    (r"(token|tokens)", ["tokens", "tokenization"]),
    (r"(prompt|generation)", ["prompt", "generation", "inference"]),
    (r"(queue|waiting|pending)", ["queue", "backlog", "waiting"]),

    # Observability patterns
    (r"prometheus", ["prometheus", "metrics", "monitoring"]),
    (r"(alert|firing)", ["alert", "alerting", "firing"]),

    # Health patterns
    (r"(health|ready|live)", ["health", "healthy", "ready", "liveness"]),
    (r"(up|down|available)", ["up", "down", "available", "unavailable"]),
]

# Category-level keywords
CATEGORY_KEYWORDS: Dict[str, List[str]] = {
    "cluster_health": ["cluster", "health", "operators", "version", "infrastructure"],
    "node_hardware": ["node", "hardware", "cpu", "memory", "disk", "host", "machine"],
    "pod_container": ["pod", "container", "workload", "deployment", "restart"],
    "api_server": ["api", "apiserver", "request", "latency", "admission"],
    "networking": ["network", "traffic", "service", "ingress", "egress", "dns"],
    "storage": ["storage", "volume", "pvc", "disk", "persistent"],
    "observability": ["prometheus", "metrics", "monitoring", "alerts", "thanos"],
    "etcd": ["etcd", "datastore", "raft", "consensus", "leader"],
    "gpu_ai": ["gpu", "nvidia", "dcgm", "habana", "gaudi", "intel", "amd", "rocm", "vllm", "inference", "ai", "ml", "ttft", "tpot", "tokens", "model serving", "latency", "throughput"],
    "image_registry": ["registry", "image", "build", "container image"],
    "kubelet": ["kubelet", "node", "pod lifecycle", "cri"],
    "controller_manager": ["controller", "reconcile", "workqueue"],
    "openshift_specific": ["openshift", "route", "scc", "oauth"],
    "scheduler": ["scheduler", "scheduling", "pending", "preemption"],
    "security": ["security", "auth", "oauth", "rbac", "identity"],
    "backup_dr": ["backup", "disaster recovery", "velero"],
    "go_runtime": ["go", "runtime", "gc", "goroutines"],
    "http_grpc": ["http", "grpc", "rest", "api"],
    "other": ["misc", "internal"],
}


# =============================================================================
# KEYWORD GENERATION - Functions
# =============================================================================

def _extract_words_from_name(metric_name: str) -> Set[str]:
    """Extract meaningful words from metric name."""
    parts = re.split(r'[_:]+', metric_name)
    words = set()
    for part in parts:
        camel_split = re.findall(r'[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|\d+', part)
        words.update(w.lower() for w in camel_split if len(w) > 1)
        words.add(part.lower())
    return words


def _extract_words_from_help(help_text: str) -> Set[str]:
    """Extract meaningful words from help text."""
    if not help_text:
        return set()
    cleaned = re.sub(r'[^a-zA-Z0-9\s]', ' ', help_text)
    return {w for w in cleaned.lower().split() if len(w) > 2}


def _apply_pattern_expansions(metric_name: str, help_text: str) -> Set[str]:
    """Apply pattern-based keyword expansions."""
    keywords = set()
    # Check patterns against metric name and help text separately
    # to preserve $ anchors (end of string) for metric name patterns
    name_lower = metric_name.lower()
    help_lower = help_text.lower() if help_text else ""

    for pattern, expansion_keywords in PATTERN_EXPANSIONS:
        if re.search(pattern, name_lower, re.IGNORECASE):
            keywords.update(expansion_keywords)
        elif help_lower and re.search(pattern, help_lower, re.IGNORECASE):
            keywords.update(expansion_keywords)
    return keywords


def _filter_keywords(keywords: Set[str]) -> Set[str]:
    """Filter out stopwords and units."""
    filtered = set()
    for keyword in keywords:
        kw = keyword.lower().strip()
        if len(kw) < 2:
            continue
        if kw in STOPWORDS:
            continue
        if kw in UNITS_TO_FILTER:
            continue
        if kw.isdigit():
            continue
        filtered.add(kw)
    return filtered


def generate_keywords_for_metric(
    metric_name: str,
    help_text: str = "",
    metric_type: str = ""
) -> List[str]:
    """
    Generate keywords for a single metric. Caps at 12 keywords.

    Priority order (highest to lowest):
    1. Curated gist keywords
    2. Type-based keywords (count, rate for counters, etc.)
    3. Pattern-based keywords (error, failed, latency, etc.)
    4. Keywords from metric name
    5. Keywords from help text (can be noisy)
    """
    # Track keywords by priority tier
    tier1_gist = set()
    tier2_type = set()
    tier3_pattern = set()
    tier4_name = set()
    tier5_help = set()

    # 1. Curated gist keywords (highest priority)
    if metric_name in GIST_KEYWORDS:
        tier1_gist.update(kw.lower() for kw in GIST_KEYWORDS[metric_name])

    # 2. Type-based keywords
    if metric_type:
        type_lower = metric_type.lower()
        if type_lower == "counter":
            tier2_type.update(["total", "count", "rate"])
        elif type_lower == "gauge":
            tier2_type.update(["current", "value"])
        elif type_lower == "histogram":
            tier2_type.update(["distribution", "percentile", "p95", "p99"])

    # 3. Pattern-based keywords
    tier3_pattern.update(_apply_pattern_expansions(metric_name, help_text))

    # 4. Keywords from metric name
    tier4_name.update(_extract_words_from_name(metric_name))

    # 5. Keywords from help text (lowest priority)
    tier5_help.update(_extract_words_from_help(help_text))

    # Combine and filter, maintaining priority order
    result = []
    seen = set()

    for tier in [tier1_gist, tier2_type, tier3_pattern, tier4_name, tier5_help]:
        filtered_tier = _filter_keywords(tier)
        for kw in sorted(filtered_tier):
            if kw not in seen:
                result.append(kw)
                seen.add(kw)
                if len(result) >= 12:
                    return result

    return result


def get_category_keywords(category_id: str) -> List[str]:
    """Get keywords for a category."""
    return CATEGORY_KEYWORDS.get(category_id, [])


# =============================================================================
# FETCH FUNCTIONALITY
# =============================================================================

class MetricsFetcher:
    """Fetches metrics from Prometheus/Thanos."""

    def __init__(self, base_url: str, verbose: bool = False):
        self.base_url = base_url.rstrip('/')
        self.verbose = verbose

    def _log(self, msg: str):
        if self.verbose:
            print(f"  [fetch] {msg}")

    def check_connection(self) -> bool:
        """Check if Prometheus/Thanos is reachable."""
        if requests is None:
            print("Error: 'requests' library not installed. Run: pip install requests")
            return False

        url = f"{self.base_url}/api/v1/status/config"
        self._log(f"Checking connection to {url}")

        try:
            response = requests.get(url, timeout=5)
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False

    def fetch_metric_names(self) -> List[str]:
        """Fetch all metric names from Prometheus."""
        if requests is None:
            print("Error: 'requests' library not installed. Run: pip install requests")
            sys.exit(1)

        url = f"{self.base_url}/api/v1/label/__name__/values"
        self._log(f"Fetching metric names from {url}")

        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()

        if data.get("status") != "success":
            raise Exception(f"API error: {data.get('error', 'Unknown error')}")

        return sorted(data.get("data", []))

    def fetch_metric_metadata(self) -> Dict[str, List[Dict]]:
        """
        Fetch metadata for all metrics.

        Raises:
            Exception: If metadata cannot be fetched (metadata is required for keyword generation).
        """
        # Use /api/v1/metadata (works with both Prometheus and Thanos)
        # NOT /api/v1/targets/metadata (Prometheus-only)
        url = f"{self.base_url}/api/v1/metadata"
        self._log(f"Fetching metadata from {url}")

        response = requests.get(url, timeout=60)
        response.raise_for_status()
        data = response.json()

        if data.get("status") != "success":
            raise Exception(f"Metadata API error: {data.get('error', 'Unknown error')}")

        # /api/v1/metadata returns {data: {metric_name: [{type, help, unit}, ...]}}
        raw_metadata = data.get("data", {})
        metadata = {}
        for name, items in raw_metadata.items():
            metadata[name] = [
                {
                    "type": item.get("type", "unknown"),
                    "help": item.get("help", ""),
                    "unit": item.get("unit", "")
                }
                for item in items
            ]

        if not metadata:
            raise Exception("No metadata returned from API. Metadata is required for keyword generation.")

        return metadata

    def fetch_all(self, output_dir: Path) -> Path:
        """Fetch all metrics and save to output directory."""
        print("📥 Fetching metrics from Prometheus...")

        # Check connection first
        print(f"  Checking connection to {self.base_url}...")
        if not self.check_connection():
            raise ConnectionError(
                f"Cannot connect to Prometheus/Thanos at {self.base_url}\n"
                "  Make sure port-forwarding is running:\n"
                "  ./scripts/local-dev.sh -n <namespace>"
            )
        print("  ✅ Connected successfully")

        metric_names = self.fetch_metric_names()
        print(f"  Found {len(metric_names)} metrics")

        metadata = self.fetch_metric_metadata()
        print(f"  Found metadata for {len(metadata)} metrics")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        metrics = []

        for name in metric_names:
            metrics.append({
                "name": name,
                "metadata": metadata.get(name, [])
            })

        report = {
            "timestamp": timestamp,
            "source": self.base_url,
            "total_metrics": len(metrics),
            "metrics": metrics
        }

        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / f"metrics-report-{timestamp}.json"

        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)

        print(f"  ✅ Saved to {output_file.name}")
        return output_file


# =============================================================================
# CATEGORIZE FUNCTIONALITY
# =============================================================================

class MetricsCategorizer:
    """Categorizes OpenShift metrics into logical groups with priorities."""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self._init_categories()
        self._init_priority_patterns()

    def _log(self, msg: str):
        if self.verbose:
            print(f"  [categorize] {msg}")

    def _init_categories(self):
        """Initialize category definitions."""
        self.categories = {
            "cluster_health": {
                "name": "Cluster Resources & Health",
                "icon": "🏢",
                "priority": 1,
                "purpose": "Monitor overall cluster state, resource capacity, and health",
                "patterns": [
                    r"^cluster_", r"^kube_node_status", r"^kube_daemonset",
                    r"^kube_deployment", r"^kube_statefulset", r"^kube_replicaset",
                ]
            },
            "node_hardware": {
                "name": "Node & Hardware Resources",
                "icon": "🖥️",
                "priority": 2,
                "purpose": "Track node-level resources: CPU, memory, disk, network",
                "patterns": [r"^node_", r"^machine_", r"^system_"]
            },
            "pod_container": {
                "name": "Pod & Container Performance",
                "icon": "📦",
                "priority": 3,
                "purpose": "Monitor pod and container lifecycle, resources, and performance",
                "patterns": [
                    r"^pod_", r"^container_", r"^kube_pod_",
                    r"^kube_container_", r"^kubelet_running_",
                ]
            },
            "api_server": {
                "name": "Kubernetes API Server",
                "icon": "🔌",
                "priority": 4,
                "purpose": "API server performance, requests, admission control",
                "patterns": [r"^apiserver_", r"^apiextensions_"]
            },
            "networking": {
                "name": "Networking & Service Mesh",
                "icon": "🌐",
                "priority": 5,
                "purpose": "Network traffic, service mesh, load balancing, DNS",
                "patterns": [
                    r"^envoy_", r"^haproxy_", r"^coredns_", r"^ovn_",
                    r"^ovnkube_", r"^ovs_", r"^pilot_", r"^istio_",
                    r"^kube_service_", r"^kube_endpoint",
                ]
            },
            "storage": {
                "name": "Storage & Persistent Volumes",
                "icon": "💾",
                "priority": 6,
                "purpose": "Persistent volume claims, storage classes, volume health",
                "patterns": [
                    r"^kube_persistentvolume", r"^kubelet_volume_",
                    r"^storage_operation_", r"^volume_manager_",
                ]
            },
            "observability": {
                "name": "Observability Stack",
                "icon": "📊",
                "priority": 7,
                "purpose": "Prometheus, Alertmanager, Thanos metrics",
                "patterns": [r"^prometheus_", r"^alertmanager_", r"^thanos_", r"^cortex_"]
            },
            "etcd": {
                "name": "etcd & Data Store",
                "icon": "🗄️",
                "priority": 8,
                "purpose": "etcd cluster health, performance, and operations",
                "patterns": [r"^etcd_"]
            },
            "scheduler": {
                "name": "Scheduling & Workload Management",
                "icon": "⚙️",
                "priority": 9,
                "purpose": "Scheduler decisions, queue depth, preemption",
                "patterns": [r"^scheduler_", r"^kube_scheduler_"]
            },
            "security": {
                "name": "Security & Authentication",
                "icon": "🔐",
                "priority": 10,
                "purpose": "Authentication, authorization, certificates",
                "patterns": [
                    r"^authentication_", r"^authorization_",
                    r"^apiserver_authorization_", r"^apiserver_certificates_",
                ]
            },
            "gpu_ai": {
                "name": "GPU & AI/ML Workloads",
                "icon": "🎮",
                "priority": 11,
                "purpose": "GPU utilization, temperature, memory, AI workload performance",
                "patterns": [r"^DCGM_", r"^gpu_", r"^nvidia_", r"^vllm:"]
            },
            "image_registry": {
                "name": "Image Registry & Builds",
                "icon": "🐳",
                "priority": 12,
                "purpose": "Image registry operations, build pipelines",
                "patterns": [r"^imageregistry_", r"^registry_"]
            },
            "kubelet": {
                "name": "Kubelet Operations",
                "icon": "🔧",
                "priority": 13,
                "purpose": "Kubelet agent operations, runtime, PLEG",
                "patterns": [r"^kubelet_"]
            },
            "controller_manager": {
                "name": "Controller Manager",
                "icon": "🎛️",
                "priority": 14,
                "purpose": "Controller manager operations and reconciliation",
                "patterns": [r"^controller_runtime_", r"^endpoint_slice_controller_"]
            },
            "openshift_specific": {
                "name": "OpenShift Specific",
                "icon": "🔴",
                "priority": 15,
                "purpose": "OpenShift-specific features and operators",
                "patterns": [r"^openshift_", r"^cvo_", r"^csv_", r"^olm_"]
            },
            "backup_dr": {
                "name": "Backup & Disaster Recovery",
                "icon": "💼",
                "priority": 16,
                "purpose": "Backup operations, recovery metrics",
                "patterns": [r"^velero_", r"^backup_"]
            },
            "go_runtime": {
                "name": "Go Runtime & Process",
                "icon": "⚡",
                "priority": 17,
                "purpose": "Go runtime stats, process metrics",
                "patterns": [r"^go_", r"^process_"]
            },
            "http_grpc": {
                "name": "HTTP/gRPC Requests",
                "icon": "🌍",
                "priority": 18,
                "purpose": "HTTP and gRPC request metrics",
                "patterns": [r"^http_", r"^grpc_", r"^rest_client_"]
            },
            "other": {
                "name": "Uncategorized / Other",
                "icon": "📋",
                "priority": 99,
                "purpose": "Metrics that don't fit other categories",
                "patterns": []
            }
        }

    def _init_priority_patterns(self):
        """Initialize priority assignment patterns."""
        self.high_priority_patterns = [
            # Cluster health
            r"^cluster_(operator|version|infrastructure)",
            r"^up$",

            # Node hardware
            r"^node_(cpu|memory|disk|network)_",
            r"^kube_node_status",

            # Pod/container
            r"^container_(cpu|memory|fs)_",
            r"^pod_status_",
            r"^kube_pod_(status|container_status)",

            # etcd
            r"^etcd_(server|disk|network)_",

            # API server
            r"^apiserver_(request|storage|cache)_",

            # GPU/AI
            r"^DCGM_FI_DEV_(GPU_UTIL|GPU_TEMP|MEMORY_TEMP|POWER_USAGE)",
            r"^vllm:.*_(latency|throughput|errors)",

            # Kubelet
            r"^kubelet_(node_|running_|volume_stats_|pleg_)",

            # Networking - CoreDNS, OVN
            r"^coredns_dns_(requests_total|request_duration|responses_total)",
            r"^coredns_forward_(requests_total|responses_total|healthcheck)",
            r"^ovn_controller_(southbound|northbound)",

            # Scheduler
            r"^scheduler_(pending_pods|scheduling_duration|queue_)",

            # Controller Manager
            r"^controller_runtime_reconcile_(total|errors_total)",

            # Observability - Alertmanager, Prometheus
            r"^alertmanager_alerts$",
            r"^alertmanager_notifications_total",
            r"^prometheus_tsdb_(head_|compactions_)",

            # Security
            r"^authentication_(attempts|duration)",
            r"^authorization_(attempts|duration)",

            # Image Registry
            r"^imageregistry_http_requests_total",

            # OpenShift specific
            r"^csv_(count|succeeded|abnormal)",
            r"^openshift_apps_deploymentconfigs_",
        ]

        self.medium_priority_patterns = [
            r".*_(total|count|seconds|bytes|usage)$",
            r"^kube_(deployment|statefulset|daemonset)_",
            r"^scheduler_", r"^workqueue_",
            r"^alertmanager_(alerts|notifications)",
            r"^prometheus_(tsdb|rule)",
            r"^DCGM_FI_DEV_",
            r"^container_", r"^node_",
        ]

        self.low_priority_patterns = [
            r"^go_(gc|goroutines|threads|memstats)",
            r"^process_(cpu|resident|virtual|open)_",
            r".*_bucket$",
            r"^rest_client_",
            r"^workqueue_longest_running",
            r"^apiserver_admission_step_",
            r".*_build_info$",
            r"^grpc_", r"^http_request",
        ]

    def _get_category(self, metric_name: str) -> str:
        """Determine category for a metric."""
        for cat_id, cat_info in self.categories.items():
            for pattern in cat_info.get("patterns", []):
                if re.search(pattern, metric_name, re.IGNORECASE):
                    return cat_id
        return "other"

    def _get_priority(self, metric_name: str, category_id: str) -> str:
        """Determine priority for a metric."""
        for pattern in self.high_priority_patterns:
            if re.search(pattern, metric_name, re.IGNORECASE):
                return "High"

        for pattern in self.low_priority_patterns:
            if re.search(pattern, metric_name, re.IGNORECASE):
                return "Low"

        for pattern in self.medium_priority_patterns:
            if re.search(pattern, metric_name, re.IGNORECASE):
                return "Medium"

        if category_id in ["cluster_health", "node_hardware", "pod_container", "etcd", "gpu_ai"]:
            return "Medium"

        return "Low"

    def categorize(self, metrics: List[Dict]) -> Dict:
        """Categorize all metrics."""
        print("📊 Categorizing metrics...")

        categorized = {cat_id: [] for cat_id in self.categories}

        for metric in metrics:
            name = metric["name"]
            category_id = self._get_category(name)
            priority = self._get_priority(name, category_id)

            categorized[category_id].append({
                "name": name,
                "priority": priority,
                "metadata": metric.get("metadata", [])
            })

        categories_list = []
        for cat_id, cat_info in sorted(self.categories.items(), key=lambda x: x[1]["priority"]):
            if categorized[cat_id]:
                categories_list.append({
                    "id": cat_id,
                    "name": cat_info["name"],
                    "icon": cat_info["icon"],
                    "purpose": cat_info["purpose"],
                    "metrics": categorized[cat_id]
                })

        priority_counts = {"High": 0, "Medium": 0, "Low": 0}
        for cat_metrics in categorized.values():
            for m in cat_metrics:
                priority_counts[m["priority"]] += 1

        print(f"  Categories: {len(categories_list)}")
        print(f"  High: {priority_counts['High']}, Medium: {priority_counts['Medium']}, Low: {priority_counts['Low']}")

        return {
            "generated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "total_metrics": len(metrics),
            "priority_distribution": priority_counts,
            "categories": categories_list
        }

    def save(self, data: Dict, output_dir: Path) -> Path:
        """Save categorized data."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = output_dir / f"openshift-metrics-categories-{timestamp}.json"

        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2)

        print(f"  ✅ Saved to {output_file.name}")
        return output_file


# =============================================================================
# OPTIMIZE FUNCTIONALITY
# =============================================================================

class MetricsOptimizer:
    """Creates optimized metrics file with keywords."""

    # GPU/AI metric patterns to exclude when creating base catalog
    GPU_PATTERNS = [
        r"^DCGM_",       # NVIDIA Data Center GPU Manager
        r"^gpu_",        # Generic GPU metrics
        r"^nvidia_",     # NVIDIA specific
        r"^vllm:",       # vLLM inference framework
        r"^habana_",     # Intel Gaudi/Habana
        r"^xpu_",        # Intel XPU
        r"^intel_gpu_",  # Intel GPU specific
        r"^amdgpu_",     # AMD GPU
        r"^rocm_",       # AMD ROCm
    ]

    def __init__(self, verbose: bool = False, exclude_gpu: bool = False):
        self.verbose = verbose
        self.exclude_gpu = exclude_gpu
        if exclude_gpu:
            self._gpu_regex = re.compile("|".join(self.GPU_PATTERNS))
        else:
            self._gpu_regex = None

    def _log(self, msg: str):
        if self.verbose:
            print(f"  [optimize] {msg}")

    def _is_gpu_metric(self, metric_name: str) -> bool:
        """Check if a metric is GPU/AI related."""
        if self._gpu_regex is None:
            return False
        return bool(self._gpu_regex.match(metric_name))

    def find_latest_categories(self, metrics_dir: Path) -> Path:
        """Find the most recent categories file."""
        pattern = re.compile(r"^openshift-metrics-categories-\d{8}_\d{6}\.json$")
        files = [f for f in metrics_dir.glob("openshift-metrics-categories-*.json")
                 if pattern.match(f.name)]

        if not files:
            raise FileNotFoundError(f"No categories file found in {metrics_dir}")

        files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        return files[0]

    def optimize(self, categories_file: Path, output_file: Path) -> Dict:
        """Create optimized metrics file with keywords."""
        print("⚡ Optimizing metrics...")

        with open(categories_file) as f:
            data = json.load(f)

        categories = data.get("categories", [])
        self._log(f"Loaded {len(categories)} categories")

        optimized_categories = []
        lookup = {}
        total_metrics = 0
        keywords_added = 0
        gpu_metrics_excluded = 0

        for category in categories:
            category_id = category.get("id", "other")

            # For base catalog: keep gpu_ai category structure but empty
            # This allows runtime GPU discovery to populate it later
            if self.exclude_gpu and category_id == "gpu_ai":
                # Add empty gpu_ai category as placeholder for runtime discovery
                cat_entry = {
                    "id": category_id,
                    "name": category.get("name", ""),
                    "icon": category.get("icon", ""),
                    "purpose": "GPU metrics discovered at runtime (vendor-agnostic)",
                    "runtime_discovery": True,  # Flag for runtime population
                    "metrics": {"High": [], "Medium": []}
                }
                cat_keywords = get_category_keywords(category_id)
                if cat_keywords:
                    cat_entry["keywords"] = cat_keywords
                optimized_categories.append(cat_entry)
                gpu_metrics_excluded += len(category.get("metrics", []))
                self._log(f"Excluded gpu_ai category ({gpu_metrics_excluded} metrics) - will be discovered at runtime")
                continue

            metrics_by_priority = {"High": [], "Medium": []}

            for metric in category.get("metrics", []):
                name = metric["name"]
                priority = metric.get("priority", "Medium")

                if priority == "Low":
                    continue

                # For base catalog: skip GPU metrics in any category
                if self.exclude_gpu and self._is_gpu_metric(name):
                    gpu_metrics_excluded += 1
                    self._log(f"Excluded GPU metric: {name}")
                    continue

                help_text = ""
                metric_type = ""
                if metric.get("metadata"):
                    meta = metric["metadata"][0]
                    metric_type = meta.get("type", "unknown")
                    help_text = meta.get("help", "")

                keywords = generate_keywords_for_metric(name, help_text, metric_type)

                entry = {"name": name}
                if metric_type:
                    entry["type"] = metric_type
                if help_text:
                    entry["help"] = help_text
                if keywords:
                    entry["keywords"] = keywords
                    keywords_added += 1

                metrics_by_priority[priority].append(entry)
                lookup[name] = {"category_id": category_id, "priority": priority}
                total_metrics += 1

            if metrics_by_priority["High"] or metrics_by_priority["Medium"]:
                cat_entry = {
                    "id": category_id,
                    "name": category.get("name", ""),
                    "icon": category.get("icon", ""),
                    "purpose": category.get("purpose", ""),
                }

                cat_keywords = get_category_keywords(category_id)
                if cat_keywords:
                    cat_entry["keywords"] = cat_keywords

                cat_entry["metrics"] = metrics_by_priority
                optimized_categories.append(cat_entry)

        print(f"  Metrics: {total_metrics} (High + Medium)")
        print(f"  Keywords added: {keywords_added}")
        if self.exclude_gpu:
            print(f"  GPU metrics excluded: {gpu_metrics_excluded} (will be discovered at runtime)")

        # Build metadata
        metadata = {
            "generated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source_file": categories_file.name,
            "total_metrics": total_metrics,
        }

        if self.exclude_gpu:
            metadata["catalog_type"] = "base"
            metadata["description"] = "Base OpenShift metrics catalog (GPU metrics discovered at runtime)"
            metadata["gpu_metrics_excluded"] = gpu_metrics_excluded
            metadata["gpu_discovery"] = "runtime"
        else:
            metadata["catalog_type"] = "full"
            metadata["description"] = "Optimized OpenShift metrics with keywords for Chat with Prometheus"

        optimized = {
            "metadata": metadata,
            "categories": optimized_categories,
            "lookup": lookup
        }

        self._save_hybrid(optimized, output_file)
        return optimized

    def _save_hybrid(self, data: Dict, filepath: Path):
        """Save JSON with compact keywords arrays."""
        json_str = json.dumps(data, indent=2)

        def compact_keywords(match):
            content = match.group(1)
            items = re.findall(r'"[^"]*"', content)
            return '"keywords": [' + ', '.join(items) + ']'

        pattern = r'"keywords": \[\s*\n((?:\s*"[^"]*",?\s*\n?)+)\s*\]'
        json_str = re.sub(pattern, compact_keywords, json_str)

        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, 'w') as f:
            f.write(json_str)

        print(f"  ✅ Saved to {filepath} ({filepath.stat().st_size // 1024}KB)")


# =============================================================================
# MAIN CLI
# =============================================================================

def find_latest_report(metrics_dir: Path) -> Path:
    """Find the most recent metrics report."""
    pattern = re.compile(r"^metrics-report-\d{8}_\d{6}\.json$")
    files = [f for f in metrics_dir.glob("metrics-report-*.json")
             if pattern.match(f.name)]

    if not files:
        raise FileNotFoundError(f"No metrics report found in {metrics_dir}")

    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    return files[0]


def main():
    parser = argparse.ArgumentParser(
        description="OpenShift Metrics CLI - Fetch, categorize, and optimize metrics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s -f                          Fetch metrics from Prometheus
  %(prog)s -c                          Categorize fetched metrics
  %(prog)s -m                          Create optimized JSON with keywords
  %(prog)s -a                          Run all steps (fetch → categorize → optimize)
  %(prog)s -a --url http://thanos:9090 Fetch from custom Prometheus URL
  %(prog)s -m -o /path/to/out.json     Custom output path for optimized JSON
  %(prog)s -c -m -v                    Categorize + optimize with verbose output
        """
    )

    # Action flags
    parser.add_argument("-f", "--fetch", action="store_true",
                        help="Fetch metrics from Prometheus/Thanos")
    parser.add_argument("-c", "--categorize", action="store_true",
                        help="Categorize metrics with priorities")
    parser.add_argument("-m", "--optimize", action="store_true",
                        help="Create optimized JSON with keywords")
    parser.add_argument("-a", "--all", action="store_true",
                        help="Run all steps: fetch → categorize → optimize")

    # Options
    parser.add_argument("-o", "--output", type=str,
                        help=f"Output path for optimized JSON (default: {DEFAULT_OUTPUT_DIR}/openshift-metrics-optimized.json)")
    parser.add_argument("--url", type=str, default=DEFAULT_PROMETHEUS_URL,
                        help=f"Prometheus/Thanos URL (default: {DEFAULT_PROMETHEUS_URL})")
    parser.add_argument("--metrics-dir", type=str, default=str(DEFAULT_METRICS_DIR),
                        help=f"Metrics data directory (default: {DEFAULT_METRICS_DIR})")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Verbose output")
    parser.add_argument("--exclude-gpu", action="store_true",
                        help="Exclude GPU/AI metrics (creates base catalog for hybrid mode)")

    args = parser.parse_args()

    # Validate: at least one action required
    if not any([args.fetch, args.categorize, args.optimize, args.all]):
        parser.print_help()
        print("\nError: At least one action (-f, -c, -m, or -a) is required")
        sys.exit(1)

    # Setup paths
    metrics_dir = Path(args.metrics_dir)
    metrics_dir.mkdir(parents=True, exist_ok=True)  # Create temp dir if needed

    # Determine output filename based on --exclude-gpu flag
    if args.output:
        output_file = Path(args.output)
    elif args.exclude_gpu:
        output_file = DEFAULT_OUTPUT_DIR / "openshift-metrics-base.json"
    else:
        output_file = DEFAULT_OUTPUT_DIR / "openshift-metrics-optimized.json"

    print("=" * 70)
    print("🚀 OpenShift Metrics CLI")
    print("=" * 70)

    try:
        if args.all or args.fetch:
            print("\n📥 Step 1: Fetch Metrics")
            print("-" * 40)
            fetcher = MetricsFetcher(args.url, args.verbose)
            fetcher.fetch_all(metrics_dir)

        if args.all or args.categorize:
            print("\n📊 Step 2: Categorize Metrics")
            print("-" * 40)
            report_file = find_latest_report(metrics_dir)
            print(f"  Using: {report_file.name}")

            with open(report_file) as f:
                report = json.load(f)

            categorizer = MetricsCategorizer(args.verbose)
            categorized = categorizer.categorize(report["metrics"])
            categorizer.save(categorized, metrics_dir)

        if args.all or args.optimize:
            print("\n⚡ Step 3: Optimize Metrics")
            print("-" * 40)
            if args.exclude_gpu:
                print("  Mode: BASE CATALOG (excluding GPU/AI metrics)")
            optimizer = MetricsOptimizer(args.verbose, exclude_gpu=args.exclude_gpu)
            categories_file = optimizer.find_latest_categories(metrics_dir)
            print(f"  Using: {categories_file.name}")
            optimizer.optimize(categories_file, output_file)

        print("\n" + "=" * 70)
        print("✅ Done!")
        print("=" * 70)

    except FileNotFoundError as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
