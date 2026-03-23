"""
OpenShift Metrics Catalog with Smart Priority-Based Filtering.

Provides centralized access to the optimized metrics catalog with:
- Category-aware metric discovery
- Priority-based filtering (High, Medium, Low)
- Fast in-memory caching
- Runtime GPU discovery for vendor-agnostic GPU support
- Dynamic catalog validation against live Prometheus
- Backward compatibility with dynamic Prometheus API discovery
"""

import json
import logging
import threading
from pathlib import Path
from typing import Dict, List, Optional, Set
from dataclasses import dataclass

from .config import DISCOVERY_TIMEOUT_SECONDS, PROMETHEUS_URL, VERIFY_SSL, THANOS_TOKEN

logger = logging.getLogger(__name__)


@dataclass
class MetricInfo:
    """Information about a single metric."""
    name: str
    category_id: str
    category_name: str
    priority: str
    type: str
    description: str
    help: str = ""


@dataclass
class CategoryInfo:
    """Information about a metric category."""
    id: str
    name: str
    description: str
    icon: str
    metric_count: int
    priority_distribution: Dict[str, int]
    example_queries: List[str]


class MetricsCatalog:
    """
    Centralized catalog for OpenShift metrics with smart priority filtering.

    Features:
    - Loads base metrics from bundled JSON (~1,800 metrics)
    - Runtime GPU discovery for vendor-agnostic support (NVIDIA, Intel, AMD)
    - Dynamic catalog validation against live Prometheus
    - Category-aware filtering
    - Priority-based selection
    - In-memory caching for fast access
    - Graceful fallback to dynamic discovery
    """

    def __init__(
        self,
        catalog_path: Optional[Path] = None,
        prometheus_url: Optional[str] = None,
        enable_gpu_discovery: bool = True,
        gpu_discovery_timeout: float = DISCOVERY_TIMEOUT_SECONDS,
        enable_catalog_validation: bool = True,
        catalog_validation_timeout: float = DISCOVERY_TIMEOUT_SECONDS,
    ):
        """
        Initialize metrics catalog.

        Args:
            catalog_path: Optional path to catalog JSON. If None, uses bundled default.
            prometheus_url: URL for Prometheus/Thanos (for GPU discovery and validation).
                           Defaults to PROMETHEUS_URL from config.
            enable_gpu_discovery: If True, discover GPU metrics at startup (async).
            gpu_discovery_timeout: Timeout for GPU discovery in seconds.
            enable_catalog_validation: If True, validate catalog against Prometheus at startup.
            catalog_validation_timeout: Timeout for catalog validation in seconds.
        """
        self._catalog_path = catalog_path
        self._catalog: Optional[Dict] = None
        self._lookup: Optional[Dict] = None
        self._categories: Optional[List[Dict]] = None
        self._loaded = False

        # GPU discovery settings
        self._prometheus_url = prometheus_url or PROMETHEUS_URL
        self._enable_gpu_discovery = enable_gpu_discovery
        self._gpu_discovery_timeout = gpu_discovery_timeout

        # GPU discovery state
        self._gpu_discovery_error: Optional[str] = None
        self._gpu_discovery_thread: Optional[threading.Thread] = None
        self._catalog_lock = threading.RLock()

        # Catalog validation settings
        self._enable_catalog_validation = enable_catalog_validation
        self._catalog_validation_timeout = catalog_validation_timeout

        # Catalog validation state
        self._catalog_validation_error: Optional[str] = None
        self._catalog_validation_thread: Optional[threading.Thread] = None

    def _get_default_catalog_path(self) -> Path:
        """Get default path to bundled metrics catalog."""
        # Base catalog — GPU/vLLM metrics are discovered at runtime,
        # and catalog validation reconciles against live Prometheus.
        potential_paths = [
            Path("/app/mcp_server/data/openshift-metrics-base.json"),  # Production
            Path(__file__).parent.parent / "mcp_server/data/openshift-metrics-base.json",  # Development
        ]

        for path in potential_paths:
            if path.exists():
                return path

        raise FileNotFoundError(
            f"Metrics catalog not found. Tried: {[str(p) for p in potential_paths]}"
        )

    def _load_catalog(self) -> bool:
        """
        Load metrics catalog from JSON file.

        Returns:
            True if loaded successfully, False otherwise.
        """
        if self._loaded:
            return True

        with self._catalog_lock:
            # Double-check after acquiring lock
            if self._loaded:
                return True

            try:
                # Determine catalog path
                if self._catalog_path is None:
                    self._catalog_path = self._get_default_catalog_path()

                logger.info(f"Loading metrics catalog from {self._catalog_path}")

                # Load JSON
                with open(self._catalog_path, 'r') as f:
                    self._catalog = json.load(f)

                # Extract components
                self._lookup = self._catalog.get("lookup", {})
                self._categories = self._catalog.get("categories", [])

                # Log stats
                metadata = self._catalog.get("metadata", {})
                catalog_type = metadata.get("catalog_type", "full")
                logger.info(
                    f"Loaded metrics catalog ({catalog_type}): "
                    f"{metadata.get('total_metrics', 0)} metrics, "
                    f"{len(self._categories)} categories"
                )

                self._loaded = True

                # Start GPU discovery if this is a base catalog
                if catalog_type == "base" and self._enable_gpu_discovery:
                    self._start_gpu_discovery()

                # Start catalog validation (runs for all catalog types)
                if self._enable_catalog_validation:
                    self._start_catalog_validation()

                return True

            except FileNotFoundError:
                logger.warning(
                    f"Metrics catalog not found at {self._catalog_path}. "
                    "Falling back to dynamic discovery."
                )
                return False
            except Exception as e:
                logger.error(f"Error loading metrics catalog: {e}", exc_info=True)
                return False

    def _start_gpu_discovery(self) -> None:
        """Start background GPU metrics discovery."""
        if self._gpu_discovery_thread is not None:
            return  # Already started

        logger.info(f"Starting GPU discovery from {self._prometheus_url}")

        def _discover():
            try:
                from .gpu_metrics_discovery import GPUMetricsDiscovery

                discovery = GPUMetricsDiscovery(
                    self._prometheus_url,
                    ssl_verify=VERIFY_SSL,
                    auth_token=THANOS_TOKEN,
                )
                result = discovery.discover(timeout_seconds=self._gpu_discovery_timeout)

                if result.error:
                    self._gpu_discovery_error = result.error
                    logger.warning(f"GPU discovery failed: {result.error}")
                    return

                if result.total_discovered == 0:
                    logger.info("GPU discovery: no GPU metrics found (cluster may not have GPUs)")
                    return

                # Merge GPU metrics into catalog
                self._merge_gpu_metrics(result)

                logger.info(
                    f"GPU discovery complete: {len(result.metrics_high)} High, "
                    f"{len(result.metrics_medium)} Medium, "
                    f"vendor={result.vendor.value}, "
                    f"time={result.discovery_time_ms:.1f}ms"
                )

            except ImportError as e:
                self._gpu_discovery_error = f"GPU discovery module not available: {e}"
                logger.warning(self._gpu_discovery_error)
            except Exception as e:
                self._gpu_discovery_error = str(e)
                logger.error(f"GPU discovery error: {e}", exc_info=True)

        self._gpu_discovery_thread = threading.Thread(target=_discover, daemon=True)
        self._gpu_discovery_thread.start()

    def _merge_gpu_metrics(self, result) -> None:
        """
        Merge discovered GPU metrics into the catalog.

        Args:
            result: GPUDiscoveryResult from gpu_metrics_discovery
        """
        with self._catalog_lock:
            # Find gpu_ai category
            gpu_category = None
            for cat in self._categories:
                if cat["id"] == "gpu_ai":
                    gpu_category = cat
                    break

            if gpu_category is None:
                logger.warning("gpu_ai category not found in catalog, cannot merge GPU metrics")
                return

            # Update metrics
            gpu_category.setdefault("metrics", {})["High"] = result.metrics_high or []
            gpu_category["metrics"]["Medium"] = result.metrics_medium or []
            gpu_category["runtime_discovery"] = False  # Mark as populated
            gpu_category["gpu_vendor"] = result.vendor.value

            # Update lookup table
            for metric in result.metrics_high or []:
                self._lookup[metric["name"]] = {
                    "category_id": "gpu_ai",
                    "priority": "High"
                }
            for metric in result.metrics_medium or []:
                self._lookup[metric["name"]] = {
                    "category_id": "gpu_ai",
                    "priority": "Medium"
                }

            # Update metadata
            if self._catalog and "metadata" in self._catalog:
                self._catalog["metadata"]["gpu_metrics_discovered"] = result.total_discovered
                self._catalog["metadata"]["gpu_vendor"] = result.vendor.value
                self._catalog["metadata"]["total_metrics"] = (
                    self._catalog["metadata"].get("total_metrics", 0) + result.total_discovered
                )

            logger.info(f"Merged {result.total_discovered} GPU metrics into catalog")

    def _start_catalog_validation(self) -> None:
        """Start background catalog validation against Prometheus."""
        if self._catalog_validation_thread is not None:
            return  # Already started

        logger.info(f"Starting catalog validation from {self._prometheus_url}")

        def _validate():
            try:
                from .catalog_validator import CatalogValidator

                validator = CatalogValidator(
                    self._prometheus_url,
                    ssl_verify=VERIFY_SSL,
                    auth_token=THANOS_TOKEN,
                )
                # Snapshot lookup to avoid RuntimeError if GPU discovery
                # mutates self._lookup concurrently during iteration.
                with self._catalog_lock:
                    lookup_snapshot = dict(self._lookup)
                result = validator.validate(
                    categories=self._categories,
                    lookup=lookup_snapshot,
                    timeout=self._catalog_validation_timeout,
                )

                if result.error:
                    self._catalog_validation_error = result.error
                    logger.warning(f"Catalog validation failed: {result.error}")
                    return

                # Apply results
                self._apply_validation_result(result)

            except ImportError as e:
                self._catalog_validation_error = f"Catalog validator module not available: {e}"
                logger.warning(self._catalog_validation_error)
            except Exception as e:
                self._catalog_validation_error = str(e)
                logger.error(f"Catalog validation error: {e}", exc_info=True)

        self._catalog_validation_thread = threading.Thread(target=_validate, daemon=True)
        self._catalog_validation_thread.start()

    def _apply_validation_result(self, result) -> None:
        """
        Apply catalog validation result — remove/add metrics under lock.

        Args:
            result: CatalogValidationResult from catalog_validator.
        """
        with self._catalog_lock:
            # --- Remove metrics not in Prometheus ---
            removed_by_cat: Dict[str, Set[str]] = {}
            for entry in result.metrics_removed:
                removed_by_cat.setdefault(entry["category_id"], set()).add(entry["name"])

            for cat in self._categories:
                names_to_remove = removed_by_cat.get(cat["id"])
                if not names_to_remove:
                    continue
                for priority in ("High", "Medium"):
                    cat["metrics"][priority] = [
                        m for m in cat["metrics"].get(priority, [])
                        if m["name"] not in names_to_remove
                    ]
                # Remove from lookup
                for name in names_to_remove:
                    self._lookup.pop(name, None)

            # --- Add metrics found in Prometheus ---
            added_by_cat: Dict[str, List[Dict]] = {}
            for entry in result.metrics_added:
                added_by_cat.setdefault(entry["category_id"], []).append(entry)

            for cat in self._categories:
                entries = added_by_cat.get(cat["id"])
                if not entries:
                    continue
                for entry in entries:
                    metric_entry = {
                        "name": entry["name"],
                        "type": entry.get("type", "unknown"),
                        "help": entry.get("help", ""),
                        "keywords": entry.get("keywords", []),
                    }
                    priority = entry.get("priority", "Medium")
                    cat["metrics"].setdefault(priority, []).append(metric_entry)
                    self._lookup[entry["name"]] = {
                        "category_id": entry["category_id"],
                        "priority": priority,
                    }

            # --- Update metadata ---
            if self._catalog and "metadata" in self._catalog:
                self._catalog["metadata"]["catalog_validated"] = True
                self._catalog["metadata"]["validation_removed"] = len(result.metrics_removed)
                self._catalog["metadata"]["validation_added"] = len(result.metrics_added)
                current_total = self._catalog["metadata"].get("total_metrics", 0)
                self._catalog["metadata"]["total_metrics"] = (
                    current_total - len(result.metrics_removed) + len(result.metrics_added)
                )

    def is_available(self) -> bool:
        """Check if catalog is loaded and available."""
        return self._load_catalog()

    def get_metadata(self) -> Dict:
        """Get catalog metadata."""
        if not self._load_catalog():
            return {}
        return self._catalog.get("metadata", {})

    def get_all_categories(self) -> List[CategoryInfo]:
        """
        Get all metric categories with summary information.

        Returns:
            List of CategoryInfo objects.
        """
        if not self._load_catalog():
            return []

        categories = []
        for cat in self._categories:
            # Calculate priority distribution (metrics are grouped by priority)
            metrics_dict = cat.get("metrics", {})
            priority_dist = {
                "High": len(metrics_dict.get("High", [])),
                "Medium": len(metrics_dict.get("Medium", [])),
            }
            total_metrics = priority_dist["High"] + priority_dist["Medium"]

            categories.append(CategoryInfo(
                id=cat["id"],
                name=cat["name"],
                description=cat.get("description", ""),
                icon=cat.get("icon", "📊"),
                metric_count=total_metrics,
                priority_distribution=priority_dist,
                example_queries=cat.get("example_queries", [])
            ))

        return categories

    def get_category_by_id(self, category_id: str) -> Optional[Dict]:
        """
        Get category information by ID.

        Args:
            category_id: Category identifier (e.g., "gpu_ai", "cluster_health")

        Returns:
            Category dict or None if not found.
        """
        if not self._load_catalog():
            return None

        for cat in self._categories:
            if cat["id"] == category_id:
                return cat

        return None

    def get_category_metrics_detail(self, category_id: str) -> Optional[Dict]:
        """
        Get full metric details for a single category, including keywords.

        Returns a dict with category info and metrics grouped by priority,
        where each metric includes name, type, help, and keywords.

        Args:
            category_id: Category identifier (e.g., "gpu_ai", "cluster_health")

        Returns:
            Dict with category details and metrics, or None if not found.
        """
        if not self._load_catalog():
            return None

        category = self.get_category_by_id(category_id)
        if not category:
            return None

        metrics_dict = category.get("metrics", {})
        metrics_by_priority = {}

        for priority in ("High", "Medium"):
            raw_metrics = metrics_dict.get(priority, [])
            metrics_by_priority[priority] = [
                {
                    "name": m["name"],
                    "type": m.get("type", "unknown"),
                    "help": m.get("help", ""),
                    "keywords": m.get("keywords", []),
                }
                for m in raw_metrics
            ]

        total = sum(len(v) for v in metrics_by_priority.values())

        return {
            "id": category["id"],
            "name": category["name"],
            "description": category.get("description", ""),
            "icon": category.get("icon", ""),
            "purpose": category.get("purpose", ""),
            "total_metrics": total,
            "metrics": metrics_by_priority,
        }

    def search_metrics_by_category(
        self,
        category_ids: Optional[List[str]] = None,
        priorities: Optional[List[str]] = None,
    ) -> List[MetricInfo]:
        """
        Search metrics by category and priority.

        Args:
            category_ids: List of category IDs to filter by. None = all categories.
            priorities: List of priorities to include ("High", "Medium"). None = defaults to both.

        Returns:
            List of MetricInfo objects matching the criteria.

        Note:
            Low priority metrics are excluded from the bundled catalog by design
            (see design-details.md Decision 4). Only High and Medium are available.
        """
        if not self._load_catalog():
            return []

        # Only High and Medium priorities exist in the bundled catalog
        if priorities is None:
            priorities = ["High", "Medium"]

        results = []

        # Filter categories
        categories_to_search = self._categories
        if category_ids:
            categories_to_search = [
                cat for cat in self._categories
                if cat["id"] in category_ids
            ]

        # Extract metrics by iterating through priority groups
        for cat in categories_to_search:
            metrics_dict = cat.get("metrics", {})

            for priority in priorities:
                # Direct access to priority group (no filtering needed!)
                for metric in metrics_dict.get(priority, []):
                    results.append(MetricInfo(
                        name=metric["name"],
                        category_id=cat["id"],
                        category_name=cat["name"],
                        priority=priority,  # We know priority from the group
                        type=metric.get("type", "unknown"),
                        description=metric.get("help", ""),  # Use help as description
                        help=metric.get("help", "")
                    ))

        return results

    def get_metric_info(self, metric_name: str) -> Optional[MetricInfo]:
        """
        Get detailed information about a specific metric.

        Args:
            metric_name: Name of the metric

        Returns:
            MetricInfo object or None if not found.
        """
        if not self._load_catalog():
            return None

        # Lookup category and priority
        lookup_entry = self._lookup.get(metric_name)
        if not lookup_entry:
            return None

        category_id = lookup_entry.get("category_id")
        priority = lookup_entry.get("priority")

        # Find full metric details
        category = self.get_category_by_id(category_id)
        if not category:
            return None

        # Direct access to the priority group (using lookup!)
        metrics_dict = category.get("metrics", {})
        for metric in metrics_dict.get(priority, []):
            if metric["name"] == metric_name:
                return MetricInfo(
                    name=metric["name"],
                    category_id=category["id"],
                    category_name=category["name"],
                    priority=priority,
                    type=metric.get("type", "unknown"),
                    description=metric.get("help", ""),  # Use help as description
                    help=metric.get("help", "")
                )

        return None

    def extract_category_hints(self, query: str) -> List[str]:
        """
        Extract category hints from user query using keyword matching.

        Args:
            query: User's question or search query

        Returns:
            List of category IDs that are likely relevant.
        """
        query_lower = query.lower()

        # Category keyword mapping — IDs must match the catalog JSON exactly
        category_keywords = {
            "gpu_ai": [
                "gpu", "nvidia", "cuda", "dcgm",  # NVIDIA
                "gaudi", "habana", "intel", "xpu",  # Intel
                "amd", "rocm", "amdgpu",  # AMD
                "accelerator", "vllm", "inference",  # General AI/ML
                "ttft", "tpot", "itl", "kv cache", "prefix cache",  # vLLM abbreviations
                "preemption", "tokens per second", "model serving",  # vLLM concepts
                "decode", "prefill", "queue time",  # Latency phases
                "generation tokens", "prompt tokens",  # Token throughput
                "llm", "serving", "e2e latency",  # Model serving
                "first token", "cache hit", "cache usage",  # Cache & latency
            ],
            "cluster_health": ["cluster", "capacity", "quota", "resource"],
            "node_hardware": ["node", "cpu", "memory", "disk", "hardware"],
            "pod_container": ["pod", "container", "restart", "oom", "deploy"],
            "etcd": ["etcd", "consensus", "key-value", "database"],
            "api_server": ["api", "apiserver", "kubernetes api"],
            "scheduler": ["schedule", "scheduling", "pending"],
            "networking": ["network", "tcp", "udp", "packet", "bandwidth", "ingress", "egress",
                           "mesh", "istio", "service mesh", "route", "router"],
            "storage": ["storage", "pv", "pvc", "volume", "persistent"],
            "observability": ["monitor", "prometheus", "alert", "alertmanager", "grafana", "thanos"],
            "security": ["auth", "authentication", "authorization", "rbac", "oauth", "security"],
            "image_registry": ["registry", "image", "container image", "build", "buildconfig", "imageregistry"],
            "kubelet": ["kubelet"],
            "controller_manager": ["controller", "controller manager", "reconcile"],
            "openshift_specific": ["openshift", "csv", "operator", "olm", "deploymentconfig"],
            "backup_dr": ["backup", "restore", "velero", "disaster recovery"],
            "go_runtime": ["go runtime", "goroutine", "gc", "garbage collection"],
            "http_grpc": ["http", "grpc", "request duration", "proxy"],
        }

        # Find matching categories
        matching_categories = []
        for category_id, keywords in category_keywords.items():
            if any(keyword in query_lower for keyword in keywords):
                matching_categories.append(category_id)

        return matching_categories

    def get_smart_metric_list(
        self,
        query: str,
        max_metrics: int = 100,
    ) -> List[str]:
        """
        Get smart metric list based on query with category-aware filtering.

        This is the main integration point for enhanced metric discovery.
        Only High and Medium priority metrics are searched (Low priority metrics
        are excluded from the bundled catalog by design).

        Args:
            query: User's question
            max_metrics: Maximum number of metrics to return

        Returns:
            List of metric names, prioritized by relevance.
        """
        if not self._load_catalog():
            logger.warning("Catalog not available, returning empty list")
            return []

        # Extract category hints from query
        category_hints = self.extract_category_hints(query)

        # Determine priority levels
        if category_hints:
            # If we have category hints, include High + Medium from those categories
            priorities = ["High", "Medium"]
        else:
            # For general queries, focus on High priority only
            priorities = ["High"]

        # Search metrics
        if category_hints:
            metrics = self.search_metrics_by_category(
                category_ids=category_hints,
                priorities=priorities,
            )
        else:
            # No hints, search all categories with High priority
            metrics = self.search_metrics_by_category(
                category_ids=None,
                priorities=priorities,
            )

        # Sort by priority (High first)
        priority_order = {"High": 0, "Medium": 1}
        metrics.sort(key=lambda m: priority_order.get(m.priority, 999))

        # Extract names and limit
        metric_names = [m.name for m in metrics[:max_metrics]]

        logger.info(
            f"Smart metric selection: query='{query[:50]}...', "
            f"categories={category_hints}, priorities={priorities}, "
            f"returned {len(metric_names)} metrics"
        )

        return metric_names


# Global singleton instance
_catalog_instance: Optional[MetricsCatalog] = None


def get_metrics_catalog(
    prometheus_url: Optional[str] = None,
    enable_gpu_discovery: bool = True,
    enable_catalog_validation: bool = True,
) -> MetricsCatalog:
    """
    Get global metrics catalog instance (singleton pattern).

    Args:
        prometheus_url: Optional Prometheus URL for GPU discovery and validation.
                       Only used when creating the singleton.
        enable_gpu_discovery: Whether to enable GPU discovery.
                             Only used when creating the singleton.
        enable_catalog_validation: Whether to enable catalog validation.
                                  Only used when creating the singleton.

    Returns:
        Shared MetricsCatalog instance.
    """
    global _catalog_instance
    if _catalog_instance is None:
        _catalog_instance = MetricsCatalog(
            prometheus_url=prometheus_url,
            enable_gpu_discovery=enable_gpu_discovery,
            enable_catalog_validation=enable_catalog_validation,
        )
    return _catalog_instance


def reset_metrics_catalog() -> None:
    """
    Reset the global catalog instance.

    Useful for testing or when configuration changes.
    """
    global _catalog_instance
    _catalog_instance = None
