"""
GPU Metrics Runtime Discovery Module.

Discovers GPU/AI metrics at runtime from Prometheus, supporting multiple vendors:
- NVIDIA (DCGM metrics)
- Intel (Habana/Gaudi, XPU metrics)
- AMD (ROCm, amdgpu metrics)
- vLLM inference framework (any vendor)

This module is used by MetricsCatalog to populate the gpu_ai category
dynamically, enabling vendor-agnostic GPU support without rebuilding containers.
"""

import logging
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Set
from enum import Enum

import requests

from .config import DISCOVERY_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)


class GPUVendor(Enum):
    """Supported GPU vendors."""
    NVIDIA = "nvidia"
    INTEL = "intel"
    AMD = "amd"
    UNKNOWN = "unknown"


@dataclass
class GPUDiscoveryResult:
    """Result of GPU metrics discovery."""
    vendor: GPUVendor
    metrics_high: List[Dict]
    metrics_medium: List[Dict]
    total_discovered: int
    discovery_time_ms: float
    error: Optional[str] = None


class GPUMetricsDiscovery:
    """
    Discovers GPU/AI metrics from Prometheus at runtime.

    Features:
    - Auto-detects GPU vendor from available metrics
    - Fetches and categorizes GPU-specific metrics
    - Generates keywords for AI chat integration
    - Thread-safe for async discovery
    """

    # Default GPU vendor detection patterns
    DEFAULT_VENDOR_PATTERNS: Dict[GPUVendor, List[str]] = {
        GPUVendor.NVIDIA: [
            r"^DCGM_",           # NVIDIA Data Center GPU Manager
            r"^nvidia_",         # Generic NVIDIA metrics
        ],
        GPUVendor.INTEL: [
            r"^habanalabs_",     # Intel Gaudi/Habana (habanalabs exporter)
            r"^habana_",         # Intel Gaudi/Habana (habana exporter)
            r"^xpu_",            # Intel XPU
            r"^intel_gpu_",      # Intel GPU specific
        ],
        GPUVendor.AMD: [
            r"^amdgpu_",         # AMD GPU
            r"^rocm_",           # AMD ROCm
        ],
    }

    # Framework patterns (vendor-agnostic)
    FRAMEWORK_PATTERNS: List[str] = [
        r"^vllm:",               # vLLM inference framework
        r"^gpu_",                # Generic GPU metrics
    ]

    # High priority patterns for GPU metrics
    HIGH_PRIORITY_PATTERNS: List[str] = [
        # NVIDIA high priority
        r"^DCGM_FI_DEV_(GPU_UTIL|GPU_TEMP|MEMORY_TEMP|POWER_USAGE|FB_USED|FB_FREE)",
        r"^DCGM_FI_DEV_(MEM_COPY_UTIL|ENC_UTIL|DEC_UTIL|SM_CLOCK|MEM_CLOCK)",
        # Intel high priority
        r"^habanalabs_(utilization|energy|power_mW|power_default_limit_mW)",
        r"^habanalabs_temperature_(onboard|onchip|threshold_gpu|threshold_memory)",
        r"^habanalabs_memory_(used_bytes|free_bytes|total_bytes)",
        r"^habana_hl_(utilization|memory_used|temperature|power)",
        r"^xpu_(utilization|memory|temperature|power)",
        # AMD high priority
        r"^amdgpu_(gpu_busy_percent|vram_used|temperature|power)",
        r"^rocm_smi_(gpu_busy|memory_used|temperature|power)",
        # vLLM high priority
        r"^vllm:.*_(latency|throughput|errors|running|waiting)",
        r"^vllm:(num_requests|e2e_request_latency|time_to_first_token)",
        r"^vllm:(kv_cache_usage|gpu_cache_usage|cpu_cache_usage)",
        r"^vllm:(prompt_tokens|generation_tokens)",
        r"^vllm:num_preemptions",
        r"^vllm:request_success",
        r"^vllm:(request_queue_time|request_prefill_time|request_decode_time)",
        r"^vllm:inter_token_latency",
        r"^vllm:prefix_cache",
    ]

    # Keywords by vendor
    VENDOR_KEYWORDS: Dict[GPUVendor, List[str]] = {
        GPUVendor.NVIDIA: ["nvidia", "dcgm", "cuda", "gpu", "accelerator"],
        GPUVendor.INTEL: ["intel", "gaudi", "habana", "xpu", "gpu", "accelerator"],
        GPUVendor.AMD: ["amd", "rocm", "gpu", "accelerator"],
        GPUVendor.UNKNOWN: ["gpu", "accelerator"],
    }

    # Curated keywords for specific metrics
    CURATED_KEYWORDS: Dict[str, List[str]] = {
        # NVIDIA DCGM — High priority
        "DCGM_FI_DEV_GPU_UTIL": ["gpu utilization", "gpu usage", "nvidia utilization"],
        "DCGM_FI_DEV_GPU_TEMP": ["gpu temperature", "temp", "overheating", "thermal"],
        "DCGM_FI_DEV_POWER_USAGE": ["gpu power", "power usage", "watts", "power consumption"],
        "DCGM_FI_DEV_FB_USED": ["gpu memory", "vram", "framebuffer", "fb used"],
        "DCGM_FI_DEV_FB_FREE": ["gpu memory free", "vram available", "framebuffer free"],
        "DCGM_FI_DEV_MEMORY_TEMP": ["memory temperature", "vram temp", "hbm temperature", "thermal"],
        "DCGM_FI_DEV_MEM_COPY_UTIL": ["memory copy utilization", "mem copy", "memory bandwidth", "dma utilization"],
        "DCGM_FI_DEV_MEM_CLOCK": ["memory clock", "mem clock", "memory frequency", "vram clock"],
        "DCGM_FI_DEV_SM_CLOCK": ["sm clock", "gpu clock", "gpu frequency", "streaming multiprocessor clock"],
        "DCGM_FI_DEV_ENC_UTIL": ["encoder utilization", "nvenc", "video encode", "encoder usage"],
        "DCGM_FI_DEV_DEC_UTIL": ["decoder utilization", "nvdec", "video decode", "decoder usage"],
        # NVIDIA DCGM — Medium priority
        "DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION": ["energy consumption", "total energy", "gpu energy", "power consumed"],
        "DCGM_FI_DEV_PCIE_REPLAY_COUNTER": ["pcie replay", "pcie errors", "pcie retransmit"],
        "DCGM_FI_DEV_FB_RESERVED": ["reserved memory", "vram reserved", "framebuffer reserved"],
        "DCGM_FI_DEV_CORRECTABLE_REMAPPED_ROWS": ["remapped rows", "ecc correctable", "memory errors", "row remap"],
        "DCGM_FI_DEV_UNCORRECTABLE_REMAPPED_ROWS": ["uncorrectable errors", "ecc uncorrectable", "memory errors"],
        "DCGM_FI_DEV_ROW_REMAP_FAILURE": ["row remap failure", "remap failure", "memory reliability"],
        "DCGM_FI_PROF_DRAM_ACTIVE": ["dram active", "memory controller active", "dram utilization"],
        "DCGM_FI_PROF_GR_ENGINE_ACTIVE": ["graphics engine active", "gr engine", "compute active"],
        "DCGM_FI_PROF_PCIE_RX_BYTES": ["pcie rx", "pcie receive", "pcie bandwidth", "pcie throughput"],
        "DCGM_FI_PROF_PCIE_TX_BYTES": ["pcie tx", "pcie transmit", "pcie bandwidth", "pcie throughput"],
        "DCGM_FI_PROF_PIPE_TENSOR_ACTIVE": ["tensor core active", "tensor utilization", "tensor pipe", "tensor core usage"],
        # Intel Gaudi — Core / Compute
        "habanalabs_utilization": ["gaudi utilization", "hpu utilization", "device utilization", "gaudi usage"],
        "habanalabs_energy": ["gaudi energy", "device energy", "energy usage", "power consumption"],
        "habanalabs_power_mW": ["gaudi power", "power usage", "milliwatts", "power consumption"],
        "habanalabs_power_default_limit_mW": ["power cap", "power limit", "default power limit"],
        "habanalabs_temperature_onboard": ["board temperature", "gaudi temperature", "thermal", "overheating"],
        "habanalabs_temperature_onchip": ["chip temperature", "asic temperature", "gaudi temp", "thermal"],
        "habanalabs_temperature_threshold_gpu": ["gpu temp threshold", "temperature limit", "thermal threshold"],
        "habanalabs_temperature_threshold_memory": ["memory temp threshold", "hbm temperature limit"],
        # Intel Gaudi — Memory (HBM)
        "habanalabs_memory_used_bytes": ["gaudi memory", "hbm used", "memory usage", "device memory"],
        "habanalabs_memory_free_bytes": ["gaudi memory free", "hbm free", "memory available"],
        "habanalabs_memory_total_bytes": ["gaudi memory total", "hbm capacity", "total memory"],
        # Intel Gaudi — Interconnect (PCIe / HL-Link)
        "habanalabs_pcie_receive_throughput": ["pcie rx throughput", "pcie receive", "pcie bandwidth"],
        "habanalabs_pcie_transmit_throughput": ["pcie tx throughput", "pcie transmit", "pcie bandwidth"],
        "habanalabs_pcie_rx": ["pcie receive traffic", "pcie rx"],
        "habanalabs_pcie_tx": ["pcie transmit traffic", "pcie tx"],
        "habanalabs_pcie_replay_count": ["pcie replay", "pcie errors", "pcie retransmit"],
        "habanalabs_pci_link_speed": ["pcie link speed", "pcie speed"],
        "habanalabs_pci_link_width": ["pcie link width", "pcie lanes"],
        # vLLM inference framework
        "vllm:e2e_request_latency_seconds": ["latency", "response time", "slow", "p95", "p99", "e2e latency", "end to end"],
        "vllm:num_requests_running": ["requests running", "inflight", "concurrency", "active requests"],
        "vllm:num_requests_waiting": ["queue", "waiting", "backlog", "pending requests"],
        "vllm:num_requests_total": ["throughput", "rps", "request rate", "total requests"],
        "vllm:time_to_first_token_seconds": ["ttft", "time to first token", "first token latency", "first token"],
        "vllm:inter_token_latency_seconds": ["tpot", "time per output token", "inter-token", "itl", "inter token latency"],
        "vllm:gpu_cache_usage_perc": ["kv cache", "cache utilization", "cache full", "gpu cache", "cache usage"],
        "vllm:cpu_cache_usage_perc": ["cpu cache", "cpu kv cache"],
        "vllm:prefix_cache_hits_total": ["prefix cache", "cache hit rate", "prefix cache hit"],
        "vllm:prefix_cache_queries_total": ["prefix cache queries", "cache queries"],
        "vllm:request_queue_time_seconds": ["queue time", "wait time", "queueing", "queue latency"],
        "vllm:request_prefill_time_seconds": ["prefill phase", "prompt processing", "prefill time", "prefill latency"],
        "vllm:request_decode_time_seconds": ["decode phase", "generation phase", "decode time", "decode latency"],
        "vllm:prompt_tokens_total": ["prompt throughput", "prompt tokens", "input tokens", "tokens per second"],
        "vllm:generation_tokens_total": ["generation throughput", "output tokens", "generation tokens", "tokens generated"],
        "vllm:num_preemptions_total": ["preemption", "eviction", "preemptions", "scheduling pressure"],
        "vllm:request_success_total": ["success rate", "successful requests", "completion rate"],
        "vllm:time_per_output_token_seconds": ["tpot", "time per output token", "decode speed", "token generation time"],
        "vllm:kv_cache_usage_perc": ["kv cache", "cache utilization", "kv usage", "cache capacity"],
    }

    def __init__(
        self,
        prometheus_url: str,
        ssl_verify=True,
        auth_token: Optional[str] = None,
    ):
        """
        Initialize GPU metrics discovery.

        Args:
            prometheus_url: URL of Prometheus/Thanos endpoint.
            ssl_verify: SSL verification setting (bool or CA bundle path string).
            auth_token: Bearer token for Prometheus/Thanos authentication.
        """
        self.prometheus_url = prometheus_url.rstrip("/")
        self._ssl_verify = ssl_verify
        self._auth_token = auth_token
        self._high_priority_regex = re.compile("|".join(self.HIGH_PRIORITY_PATTERNS))
        vendor_patterns = self._build_vendor_patterns()
        self._vendor_regexes = {
            vendor: re.compile("|".join(patterns))
            for vendor, patterns in vendor_patterns.items()
        }
        self._framework_regex = re.compile("|".join(self.FRAMEWORK_PATTERNS))

    def _request_headers(self) -> Dict[str, str]:
        """Build HTTP headers with Bearer token if configured."""
        headers: Dict[str, str] = {}
        token = (self._auth_token or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _build_vendor_patterns(self) -> Dict[GPUVendor, List[str]]:
        """
        Build vendor patterns by merging defaults with custom prefixes from env vars.

        Custom prefixes are additive - they extend the default patterns, not replace them.
        Environment variables:
            GPU_METRICS_PREFIX_NVIDIA - comma-separated extra NVIDIA metric prefixes
            GPU_METRICS_PREFIX_INTEL  - comma-separated extra Intel metric prefixes
            GPU_METRICS_PREFIX_AMD    - comma-separated extra AMD metric prefixes
        """
        patterns = {k: list(v) for k, v in self.DEFAULT_VENDOR_PATTERNS.items()}
        env_mappings = {
            GPUVendor.NVIDIA: "GPU_METRICS_PREFIX_NVIDIA",
            GPUVendor.INTEL: "GPU_METRICS_PREFIX_INTEL",
            GPUVendor.AMD: "GPU_METRICS_PREFIX_AMD",
        }
        for vendor, env_var in env_mappings.items():
            custom = os.environ.get(env_var, "").strip()
            if custom:
                for prefix in custom.split(","):
                    prefix = prefix.strip()
                    if prefix:
                        patterns[vendor].append(f"^{prefix}")
        return patterns

    def _detect_vendor(self, metric_name: str) -> GPUVendor:
        """Detect GPU vendor from metric name."""
        for vendor, regex in self._vendor_regexes.items():
            if regex.match(metric_name):
                return vendor
        return GPUVendor.UNKNOWN

    def _is_gpu_metric(self, metric_name: str) -> bool:
        """Check if metric is GPU/AI related."""
        # Check vendor patterns
        for regex in self._vendor_regexes.values():
            if regex.match(metric_name):
                return True
        # Check framework patterns
        if self._framework_regex.match(metric_name):
            return True
        return False

    def _is_high_priority(self, metric_name: str) -> bool:
        """Check if metric is high priority."""
        return bool(self._high_priority_regex.match(metric_name))

    def _generate_keywords(self, metric_name: str, help_text: str, vendor: GPUVendor) -> List[str]:
        """Generate keywords for a GPU metric.

        Keywords are added in priority order: curated > vendor > name-derived > help-text.
        When the 12-keyword limit is reached, lower-priority keywords are dropped.
        """
        seen: Set[str] = set()
        ordered: List[str] = []

        def _add(words):
            for w in words:
                if w not in seen:
                    seen.add(w)
                    ordered.append(w)

        # Priority 1: curated keywords (hand-written, highest quality)
        if metric_name in self.CURATED_KEYWORDS:
            _add(self.CURATED_KEYWORDS[metric_name])
        else:
            base_name = re.sub(r"_(bucket|count|sum|total)$", "", metric_name)
            if base_name in self.CURATED_KEYWORDS:
                _add(self.CURATED_KEYWORDS[base_name])

        # Priority 2: vendor keywords
        _add(self.VENDOR_KEYWORDS.get(vendor, []))

        # Priority 3: keywords extracted from metric name
        name_parts = re.split(r"[_:]", metric_name.lower())
        skip_words = {"dcgm", "fi", "dev", "vllm", "habana", "habanalabs", "hl", "amdgpu", "rocm", "smi"}
        _add(part for part in name_parts if len(part) > 2 and part not in skip_words)

        # Priority 4: keywords extracted from help text
        if help_text:
            help_words = re.findall(r"\b[a-z]{4,}\b", help_text.lower())
            stopwords = {"this", "that", "with", "from", "which", "when", "will", "been", "being"}
            _add(w for w in help_words[:10] if w not in stopwords)

        # Limit total keywords
        return ordered[:12]

    def discover(self, timeout_seconds: float = DISCOVERY_TIMEOUT_SECONDS) -> GPUDiscoveryResult:
        """
        Discover GPU metrics from Prometheus.

        Args:
            timeout_seconds: Timeout for Prometheus API calls

        Returns:
            GPUDiscoveryResult with discovered metrics
        """
        import time
        start_time = time.perf_counter()

        try:
            # Step 1: Get all metric names
            response = requests.get(
                f"{self.prometheus_url}/api/v1/label/__name__/values",
                headers=self._request_headers(),
                verify=self._ssl_verify,
                timeout=timeout_seconds,
            )
            response.raise_for_status()
            data = response.json()

            if data.get("status") != "success":
                raise ValueError(f"Prometheus API error: {data.get('error', 'unknown')}")

            all_metrics = data.get("data", [])
            logger.info(f"GPU discovery: found {len(all_metrics)} total metrics")

            # Step 2: Filter GPU metrics
            gpu_metrics = [m for m in all_metrics if self._is_gpu_metric(m)]
            logger.info(f"GPU discovery: found {len(gpu_metrics)} GPU/AI metrics")

            if not gpu_metrics:
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                return GPUDiscoveryResult(
                    vendor=GPUVendor.UNKNOWN,
                    metrics_high=[],
                    metrics_medium=[],
                    total_discovered=0,
                    discovery_time_ms=elapsed_ms,
                    error=None  # No error, just no GPU metrics found
                )

            # Step 3: Detect primary vendor
            vendor_counts: Dict[GPUVendor, int] = {v: 0 for v in GPUVendor}
            for metric in gpu_metrics:
                vendor = self._detect_vendor(metric)
                vendor_counts[vendor] += 1

            # Primary vendor is the one with most metrics (excluding UNKNOWN)
            primary_vendor = max(
                (v for v in GPUVendor if v != GPUVendor.UNKNOWN),
                key=lambda v: vendor_counts[v],
                default=GPUVendor.UNKNOWN
            )
            logger.info(f"GPU discovery: primary vendor detected as {primary_vendor.value}")

            # Step 4: Get metadata for GPU metrics
            metadata = self._fetch_metadata(gpu_metrics, timeout_seconds)

            # Step 5: Categorize by priority
            metrics_high: List[Dict] = []
            metrics_medium: List[Dict] = []

            for metric_name in gpu_metrics:
                vendor = self._detect_vendor(metric_name)
                meta = metadata.get(metric_name, {})
                metric_type = meta.get("type", "unknown")
                help_text = meta.get("help", "")

                priority = "High" if self._is_high_priority(metric_name) else "Medium"
                keywords = self._generate_keywords(metric_name, help_text, vendor)

                entry = {
                    "name": metric_name,
                    "type": metric_type,
                    "help": help_text,
                    "keywords": keywords,
                    "vendor": vendor.value,
                }

                if priority == "High":
                    metrics_high.append(entry)
                else:
                    metrics_medium.append(entry)

            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"GPU discovery complete: {len(metrics_high)} High, "
                f"{len(metrics_medium)} Medium, {elapsed_ms:.1f}ms"
            )

            return GPUDiscoveryResult(
                vendor=primary_vendor,
                metrics_high=metrics_high,
                metrics_medium=metrics_medium,
                total_discovered=len(gpu_metrics),
                discovery_time_ms=elapsed_ms,
                error=None
            )

        except Exception as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.error(f"GPU discovery failed: {e}")
            return GPUDiscoveryResult(
                vendor=GPUVendor.UNKNOWN,
                metrics_high=[],
                metrics_medium=[],
                total_discovered=0,
                discovery_time_ms=elapsed_ms,
                error=str(e)
            )

    def _fetch_metadata(
        self,
        metric_names: List[str],
        timeout_seconds: float
    ) -> Dict[str, Dict]:
        """
        Fetch metadata for metrics from Prometheus.

        Args:
            metric_names: List of metric names
            timeout_seconds: Timeout for API call

        Returns:
            Dict mapping metric name to metadata (type, help)
        """
        try:
            # Use /api/v1/metadata endpoint
            response = requests.get(
                f"{self.prometheus_url}/api/v1/metadata",
                headers=self._request_headers(),
                verify=self._ssl_verify,
                timeout=timeout_seconds,
            )
            response.raise_for_status()
            data = response.json()

            if data.get("status") != "success":
                return {}

            all_metadata = data.get("data", {})

            # Extract metadata for our metrics
            result: Dict[str, Dict] = {}
            for name in metric_names:
                if name in all_metadata:
                    meta_list = all_metadata[name]
                    if meta_list:
                        result[name] = {
                            "type": meta_list[0].get("type", "unknown"),
                            "help": meta_list[0].get("help", ""),
                        }

            return result

        except Exception as e:
            logger.warning(f"Failed to fetch metadata: {e}")
            return {}


# Convenience function for direct discovery
def discover_gpu_metrics(
    prometheus_url: str,
    timeout_seconds: float = DISCOVERY_TIMEOUT_SECONDS,
    ssl_verify=True,
    auth_token: Optional[str] = None,
) -> GPUDiscoveryResult:
    """
    Discover GPU metrics from Prometheus.

    Args:
        prometheus_url: URL of Prometheus/Thanos endpoint
        timeout_seconds: Timeout for API calls
        ssl_verify: SSL verification setting (bool or CA bundle path string).
        auth_token: Bearer token for Prometheus/Thanos authentication.

    Returns:
        GPUDiscoveryResult with discovered metrics
    """
    discovery = GPUMetricsDiscovery(prometheus_url, ssl_verify=ssl_verify, auth_token=auth_token)
    return discovery.discover(timeout_seconds)
