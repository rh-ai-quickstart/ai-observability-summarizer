"""
OpenShift Metrics Catalog with Smart Priority-Based Filtering.

Provides centralized access to the optimized metrics catalog with:
- Category-aware metric discovery
- Priority-based filtering (High, Medium, Low)
- Fast in-memory caching
- Backward compatibility with dynamic Prometheus API discovery
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Set
from functools import lru_cache
from dataclasses import dataclass

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
    - Loads optimized metrics from bundled JSON (2,037 High+Medium priority metrics)
    - Category-aware filtering
    - Priority-based selection
    - In-memory caching for fast access
    - Graceful fallback to dynamic discovery
    """

    def __init__(self, catalog_path: Optional[Path] = None):
        """
        Initialize metrics catalog.

        Args:
            catalog_path: Optional path to catalog JSON. If None, uses bundled default.
        """
        self._catalog_path = catalog_path
        self._catalog: Optional[Dict] = None
        self._lookup: Optional[Dict] = None
        self._categories: Optional[List[Dict]] = None
        self._loaded = False

    def _get_default_catalog_path(self) -> Path:
        """Get default path to bundled metrics catalog."""
        # Try multiple potential locations
        potential_paths = [
            Path("/app/mcp_server/data/openshift-metrics-optimized.json"),  # Production (container)
            Path(__file__).parent.parent / "mcp_server/data/openshift-metrics-optimized.json",  # Development
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
            logger.info(
                f"Loaded metrics catalog: {metadata.get('total_metrics', 0)} metrics, "
                f"{metadata.get('categories', 0)} categories"
            )

            self._loaded = True
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
                "Low": 0
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

    def search_metrics_by_category(
        self,
        category_ids: Optional[List[str]] = None,
        priorities: Optional[List[str]] = None,
        include_low_priority: bool = False
    ) -> List[MetricInfo]:
        """
        Search metrics by category and priority.

        Args:
            category_ids: List of category IDs to filter by. None = all categories.
            priorities: List of priorities to include ("High", "Medium", "Low"). None = auto.
            include_low_priority: If True, include Low priority metrics (requires dynamic API call).

        Returns:
            List of MetricInfo objects matching the criteria.
        """
        if not self._load_catalog():
            return []

        # Auto-determine priorities if not specified
        if priorities is None:
            if include_low_priority:
                priorities = ["High", "Medium", "Low"]
            else:
                priorities = ["High", "Medium"]

        # Note: Low priority metrics are excluded from optimized catalog
        if "Low" in priorities:
            logger.warning(
                "Low priority metrics requested but not available in optimized catalog. "
                "Use dynamic discovery for complete Low priority metrics."
            )

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

        # Category keyword mapping
        category_keywords = {
            "gpu_ai": ["gpu", "nvidia", "cuda", "gaudi", "habana", "accelerator", "ai", "ml"],
            "cluster_health": ["cluster", "capacity", "quota", "resource"],
            "node_hardware": ["node", "cpu", "memory", "disk", "hardware"],
            "pod_container": ["pod", "container", "restart", "oom", "deploy"],
            "etcd": ["etcd", "consensus", "key-value", "database"],
            "api_server": ["api", "apiserver", "kubernetes api"],
            "scheduler": ["schedule", "scheduling", "pending"],
            "networking": ["network", "tcp", "udp", "packet", "bandwidth", "ingress", "egress"],
            "storage": ["storage", "pv", "pvc", "volume", "persistent"],
            "registry": ["registry", "image", "container image"],
            "authentication": ["auth", "authentication", "rbac", "oauth"],
            "build": ["build", "buildconfig", "builder"],
            "route": ["route", "router", "openshift router"],
            "service_mesh": ["mesh", "istio", "service mesh"],
            "monitoring": ["monitor", "prometheus", "alert"],
            "operator": ["operator", "olm"],
            "kubelet": ["kubelet"],
            "controller": ["controller"],
            "vllm": ["vllm", "llm", "inference"]
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
        include_low_priority: bool = False
    ) -> List[str]:
        """
        Get smart metric list based on query with category-aware filtering.

        This is the main integration point for enhanced metric discovery.

        Args:
            query: User's question
            max_metrics: Maximum number of metrics to return
            include_low_priority: Include Low priority metrics (requires API fallback)

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
                include_low_priority=include_low_priority
            )
        else:
            # No hints, search all categories with High priority
            metrics = self.search_metrics_by_category(
                category_ids=None,
                priorities=priorities,
                include_low_priority=include_low_priority
            )

        # Sort by priority (High first)
        priority_order = {"High": 0, "Medium": 1, "Low": 2}
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


def get_metrics_catalog() -> MetricsCatalog:
    """
    Get global metrics catalog instance (singleton pattern).

    Returns:
        Shared MetricsCatalog instance.
    """
    global _catalog_instance
    if _catalog_instance is None:
        _catalog_instance = MetricsCatalog()
    return _catalog_instance
