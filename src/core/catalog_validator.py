"""
Catalog Validator Module.

Validates the bundled metrics catalog against the running Prometheus instance:
- Removes catalog metrics that don't exist in Prometheus
- Adds new Prometheus metrics that match known category prefixes
- Skips gpu_ai category (handled by GPU discovery)

Runs once at startup in a background thread, parallel to GPU discovery.
"""

import logging
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# Low-priority prefixes to skip when adding new metrics
SKIP_PREFIXES_FOR_ADDITION = frozenset({
    "go_",
    "process_",
    "promhttp_",
})


@dataclass
class CatalogValidationResult:
    """Result of catalog validation against Prometheus."""
    metrics_removed: List[Dict] = field(default_factory=list)
    metrics_added: List[Dict] = field(default_factory=list)
    total_prometheus_metrics: int = 0
    total_catalog_before: int = 0
    total_catalog_after: int = 0
    validation_time_ms: float = 0.0
    error: Optional[str] = None


class CatalogValidator:
    """
    Validates and updates the metrics catalog against a live Prometheus instance.

    - Fetches all metric names via GET /api/v1/label/__name__/values
    - Fetches all metadata via GET /api/v1/metadata (single call)
    - Removes catalog metrics not found in Prometheus
    - Adds Prometheus metrics not in catalog that match a category prefix
    - Skips gpu_ai category (handled by GPU discovery)
    """

    # Categories to skip during validation
    SKIP_CATEGORIES = frozenset({"gpu_ai"})

    def __init__(self, prometheus_url: str = "http://localhost:9090"):
        """
        Initialize catalog validator.

        Args:
            prometheus_url: URL of the Prometheus/Thanos endpoint.
        """
        self.prometheus_url = prometheus_url.rstrip("/")

    def validate(
        self,
        categories: List[Dict],
        lookup: Dict[str, Dict],
        skip_categories: Optional[Set[str]] = None,
        timeout: float = 10.0,
    ) -> CatalogValidationResult:
        """
        Validate catalog against Prometheus.

        Args:
            categories: The catalog's category list (from JSON).
            lookup: The catalog's metric lookup dict.
            skip_categories: Category IDs to skip (defaults to SKIP_CATEGORIES).
            timeout: Timeout for Prometheus API calls in seconds.

        Returns:
            CatalogValidationResult with metrics to remove and add.
        """
        start_time = time.perf_counter()
        skip = skip_categories if skip_categories is not None else self.SKIP_CATEGORIES

        try:
            import requests
        except ImportError:
            return CatalogValidationResult(
                error="requests library not installed",
                validation_time_ms=(time.perf_counter() - start_time) * 1000,
            )

        try:
            # Step 1: Fetch all metric names from Prometheus
            prometheus_metrics = self._fetch_metric_names(timeout)
            if not prometheus_metrics:
                elapsed = (time.perf_counter() - start_time) * 1000
                return CatalogValidationResult(
                    error="Prometheus returned 0 metrics (possible connectivity issue)",
                    validation_time_ms=elapsed,
                )

            prometheus_set = set(prometheus_metrics)
            logger.info(f"Catalog validation: Prometheus has {len(prometheus_set)} metrics")

            # Step 2: Fetch metadata (best-effort)
            all_metadata = self._fetch_metadata(timeout)

            # Step 3: Build prefix map from existing catalog
            prefix_map = self._build_prefix_map(categories, skip)

            # Step 4: Count catalog metrics before
            total_before = sum(
                len(cat["metrics"].get(p, []))
                for cat in categories
                for p in ("High", "Medium")
                if cat["id"] not in skip
            )

            # Step 5: Identify metrics to remove (in catalog but not in Prometheus)
            metrics_removed = []
            for cat in categories:
                if cat["id"] in skip:
                    continue
                for priority in ("High", "Medium"):
                    for metric in cat["metrics"].get(priority, []):
                        name = metric["name"]
                        if name not in prometheus_set:
                            metrics_removed.append({
                                "name": name,
                                "category_id": cat["id"],
                                "priority": priority,
                            })

            # Step 6: Identify metrics to add (in Prometheus but not in catalog)
            existing_names = set(lookup.keys())
            metrics_added = []
            for name in sorted(prometheus_set - existing_names):
                # Skip low-priority patterns
                if any(name.startswith(prefix) for prefix in SKIP_PREFIXES_FOR_ADDITION):
                    continue

                category_id = self._categorize_new_metric(name, prefix_map)
                if category_id is None:
                    continue  # No matching category, skip

                if category_id in skip:
                    continue

                meta = all_metadata.get(name, {})
                metric_type = meta.get("type", "unknown")
                help_text = meta.get("help", "")
                keywords = self._generate_keywords(name, help_text)

                metrics_added.append({
                    "name": name,
                    "category_id": category_id,
                    "priority": "Medium",
                    "type": metric_type,
                    "help": help_text,
                    "keywords": keywords,
                })

            total_after = total_before - len(metrics_removed) + len(metrics_added)
            elapsed = (time.perf_counter() - start_time) * 1000

            if metrics_removed:
                logger.info(
                    f"Catalog validation: metrics removed (not in Prometheus): "
                    f"{', '.join(e['name'] for e in metrics_removed)}"
                )
            if metrics_added:
                logger.info(
                    f"Catalog validation: metrics added (found in Prometheus): "
                    f"{', '.join(e['name'] for e in metrics_added)}"
                )

            logger.info(
                f"Catalog validation complete: "
                f"removed {len(metrics_removed)}, added {len(metrics_added)}, "
                f"time={elapsed:.1f}ms"
            )

            return CatalogValidationResult(
                metrics_removed=metrics_removed,
                metrics_added=metrics_added,
                total_prometheus_metrics=len(prometheus_set),
                total_catalog_before=total_before,
                total_catalog_after=total_after,
                validation_time_ms=elapsed,
                error=None,
            )

        except Exception as e:
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.error(f"Catalog validation failed: {e}")
            return CatalogValidationResult(
                error=str(e),
                validation_time_ms=elapsed,
            )

    def _fetch_metric_names(self, timeout: float) -> List[str]:
        """
        Fetch all metric names from Prometheus.

        Args:
            timeout: Request timeout in seconds.

        Returns:
            List of metric name strings, or empty list on failure.
        """
        import requests

        response = requests.get(
            f"{self.prometheus_url}/api/v1/label/__name__/values",
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()

        if data.get("status") != "success":
            raise ValueError(f"Prometheus API error: {data.get('error', 'unknown')}")

        return data.get("data", [])

    def _fetch_metadata(self, timeout: float) -> Dict[str, Dict]:
        """
        Fetch metadata for all metrics from Prometheus (single call).

        Args:
            timeout: Request timeout in seconds.

        Returns:
            Dict mapping metric name to {type, help}. Empty dict on failure.
        """
        import requests

        try:
            response = requests.get(
                f"{self.prometheus_url}/api/v1/metadata",
                timeout=timeout,
            )
            response.raise_for_status()
            data = response.json()

            if data.get("status") != "success":
                return {}

            raw = data.get("data", {})
            result: Dict[str, Dict] = {}
            for name, meta_list in raw.items():
                if meta_list:
                    result[name] = {
                        "type": meta_list[0].get("type", "unknown"),
                        "help": meta_list[0].get("help", ""),
                    }
            return result

        except Exception as e:
            logger.warning(f"Catalog validation: failed to fetch metadata: {e}")
            return {}

    def _build_prefix_map(
        self,
        categories: List[Dict],
        skip_categories: Set[str],
    ) -> Dict[str, str]:
        """
        Build a prefix-to-category_id map from existing catalog metrics.

        For each metric, extracts prefixes at depths 1-4 (splitting on '_').
        Only keeps prefixes that map to exactly 1 category (unambiguous).

        Args:
            categories: Catalog category list.
            skip_categories: Category IDs to skip.

        Returns:
            Dict mapping prefix string to category_id.
        """
        # prefix -> set of category_ids that have metrics with this prefix
        prefix_categories: Dict[str, Set[str]] = defaultdict(set)

        for cat in categories:
            if cat["id"] in skip_categories:
                continue

            for priority in ("High", "Medium"):
                for metric in cat["metrics"].get(priority, []):
                    parts = metric["name"].split("_")
                    # Extract prefixes at depths 1 through 4
                    for depth in range(1, min(5, len(parts) + 1)):
                        prefix = "_".join(parts[:depth])
                        prefix_categories[prefix].add(cat["id"])

        # Keep only unambiguous prefixes (exactly 1 category)
        prefix_map: Dict[str, str] = {}
        for prefix, cat_ids in prefix_categories.items():
            if len(cat_ids) == 1:
                prefix_map[prefix] = next(iter(cat_ids))

        logger.debug(f"Catalog validation: built prefix map with {len(prefix_map)} entries")
        return prefix_map

    def _categorize_new_metric(
        self,
        name: str,
        prefix_map: Dict[str, str],
    ) -> Optional[str]:
        """
        Categorize a new metric using longest-prefix-match.

        Tries 4-segment prefix first, then 3, 2, 1.

        Args:
            name: Metric name.
            prefix_map: Prefix-to-category_id map.

        Returns:
            category_id or None if no match.
        """
        parts = name.split("_")
        # Try longest prefix first (4 -> 3 -> 2 -> 1)
        for depth in range(min(4, len(parts)), 0, -1):
            prefix = "_".join(parts[:depth])
            if prefix in prefix_map:
                return prefix_map[prefix]
        return None

    def _generate_keywords(self, name: str, help_text: str) -> List[str]:
        """
        Generate keywords for a new metric.

        Follows the same approach as GPU discovery.

        Args:
            name: Metric name.
            help_text: Help/description text from metadata.

        Returns:
            List of keyword strings.
        """
        keywords: Set[str] = set()

        # Extract keywords from metric name
        name_parts = re.split(r"[_:]", name.lower())
        skip_words = {"total", "info", "sum", "count", "bucket", "created"}
        for part in name_parts:
            if len(part) > 2 and part not in skip_words:
                keywords.add(part)

        # Extract keywords from help text
        if help_text:
            help_words = re.findall(r"\b[a-z]{4,}\b", help_text.lower())
            stopwords = {
                "this", "that", "with", "from", "which", "when", "will",
                "been", "being", "have", "does", "each", "they", "them",
                "than", "then", "what", "were", "more", "some", "such",
                "only", "also", "into", "over", "most", "used", "uses",
            }
            for word in help_words[:10]:
                if word not in stopwords:
                    keywords.add(word)

        return list(keywords)[:12]
