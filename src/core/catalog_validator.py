"""
Catalog Validator Module.

Validates the bundled metrics catalog against the running Prometheus instance:
- Removes catalog metrics that don't exist in Prometheus
- Adds new Prometheus metrics that match known category patterns
- Skips gpu_ai category (handled by GPU discovery)

Runs once at startup in a background thread, parallel to GPU discovery.
"""

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

import requests

from .config import DISCOVERY_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Priority classification — mirrored from scripts/metrics/cli.py.
# The base catalog only includes High and Medium metrics. The validator must
# apply the same classification so it doesn't re-add Low priority metrics.
# --------------------------------------------------------------------------

# Checked first — if matched, metric is High priority
_HIGH_PRIORITY_PATTERNS = [re.compile(p, re.IGNORECASE) for p in [
    r"^cluster_(operator|version|infrastructure)",
    r"^up$",
    r"^node_(cpu|memory|disk|network)_",
    r"^kube_node_status",
    r"^container_(cpu|memory|fs)_",
    r"^pod_status_",
    r"^kube_pod_(status|container_status)",
    r"^etcd_(server|disk|network)_",
    r"^apiserver_(request|storage|cache)_",
    r"^DCGM_FI_DEV_(GPU_UTIL|GPU_TEMP|MEMORY_TEMP|POWER_USAGE)",
    r"^vllm:.*_(latency|throughput|errors)",
    r"^kubelet_(node_|running_|volume_stats_|pleg_)",
    r"^coredns_dns_(requests_total|request_duration|responses_total)",
    r"^coredns_forward_(requests_total|responses_total|healthcheck)",
    r"^ovn_controller_(southbound|northbound)",
    r"^scheduler_(pending_pods|scheduling_duration|queue_)",
    r"^controller_runtime_reconcile_(total|errors_total)",
    r"^alertmanager_alerts$",
    r"^alertmanager_notifications_total",
    r"^prometheus_tsdb_(head_|compactions_)",
    r"^authentication_(attempts|duration)",
    r"^authorization_(attempts|duration)",
    r"^imageregistry_http_requests_total",
    r"^csv_(count|succeeded|abnormal)",
    r"^openshift_apps_deploymentconfigs_",
]]

# Checked second — if matched, metric is Low priority (skip)
_LOW_PRIORITY_PATTERNS = [re.compile(p, re.IGNORECASE) for p in [
    r"^go_(gc|goroutines|threads|memstats)",
    r"^process_(cpu|resident|virtual|open)_",
    r".*_bucket$",
    r"^rest_client_",
    r"^workqueue_longest_running",
    r"^apiserver_admission_step_",
    r".*_build_info$",
    r"^grpc_",
    r"^http_request",
]]

# Checked third — if matched, metric is Medium priority
_MEDIUM_PRIORITY_PATTERNS = [re.compile(p, re.IGNORECASE) for p in [
    r".*_(total|count|seconds|bytes|usage)$",
    r"^kube_(deployment|statefulset|daemonset)_",
    r"^scheduler_",
    r"^workqueue_",
    r"^alertmanager_(alerts|notifications)",
    r"^prometheus_(tsdb|rule)",
    r"^DCGM_FI_DEV_",
    r"^container_",
    r"^node_",
]]

# Categories that default to Medium when no pattern matches
_MEDIUM_DEFAULT_CATEGORIES = frozenset({
    "cluster_health", "node_hardware", "pod_container", "etcd", "gpu_ai",
})


def _classify_priority(metric_name: str, category_id: str) -> str:
    """Classify a metric's priority using the same logic as cli.py."""
    for p in _HIGH_PRIORITY_PATTERNS:
        if p.search(metric_name):
            return "High"
    for p in _LOW_PRIORITY_PATTERNS:
        if p.search(metric_name):
            return "Low"
    for p in _MEDIUM_PRIORITY_PATTERNS:
        if p.search(metric_name):
            return "Medium"
    if category_id in _MEDIUM_DEFAULT_CATEGORIES:
        return "Medium"
    return "Low"


# --------------------------------------------------------------------------
# Category classification — mirrored from scripts/metrics/cli.py.
# Uses the same explicit regex patterns as the CLI to categorize metrics,
# rather than inferring categories from prefix overlap in the existing catalog.
# --------------------------------------------------------------------------

_CATEGORY_PATTERNS: List[Tuple[str, List[re.Pattern]]] = [
    ("cluster_health", [re.compile(p, re.IGNORECASE) for p in [
        r"^cluster_", r"^kube_node_status", r"^kube_daemonset",
        r"^kube_deployment", r"^kube_statefulset", r"^kube_replicaset",
    ]]),
    ("node_hardware", [re.compile(p, re.IGNORECASE) for p in [
        r"^node_", r"^machine_", r"^system_",
    ]]),
    ("pod_container", [re.compile(p, re.IGNORECASE) for p in [
        r"^pod_", r"^container_", r"^kube_pod_",
        r"^kube_container_", r"^kubelet_running_",
    ]]),
    ("api_server", [re.compile(p, re.IGNORECASE) for p in [
        r"^apiserver_", r"^apiextensions_",
    ]]),
    ("networking", [re.compile(p, re.IGNORECASE) for p in [
        r"^envoy_", r"^haproxy_", r"^coredns_", r"^ovn_",
        r"^ovnkube_", r"^ovs_", r"^pilot_", r"^istio_",
        r"^kube_service_", r"^kube_endpoint",
    ]]),
    ("storage", [re.compile(p, re.IGNORECASE) for p in [
        r"^kube_persistentvolume", r"^kubelet_volume_",
        r"^storage_operation_", r"^volume_manager_",
    ]]),
    ("observability", [re.compile(p, re.IGNORECASE) for p in [
        r"^prometheus_", r"^alertmanager_", r"^thanos_", r"^cortex_",
    ]]),
    ("etcd", [re.compile(p, re.IGNORECASE) for p in [
        r"^etcd_",
    ]]),
    ("scheduler", [re.compile(p, re.IGNORECASE) for p in [
        r"^scheduler_", r"^kube_scheduler_",
    ]]),
    ("security", [re.compile(p, re.IGNORECASE) for p in [
        r"^authentication_", r"^authorization_",
        r"^apiserver_authorization_", r"^apiserver_certificates_",
    ]]),
    ("gpu_ai", [re.compile(p, re.IGNORECASE) for p in [
        r"^DCGM_", r"^gpu_", r"^nvidia_", r"^vllm:",
    ]]),
    ("image_registry", [re.compile(p, re.IGNORECASE) for p in [
        r"^imageregistry_", r"^registry_",
    ]]),
    ("kubelet", [re.compile(p, re.IGNORECASE) for p in [
        r"^kubelet_",
    ]]),
    ("controller_manager", [re.compile(p, re.IGNORECASE) for p in [
        r"^controller_runtime_", r"^endpoint_slice_controller_",
    ]]),
    ("openshift_specific", [re.compile(p, re.IGNORECASE) for p in [
        r"^openshift_", r"^cvo_", r"^csv_", r"^olm_",
    ]]),
    ("backup_dr", [re.compile(p, re.IGNORECASE) for p in [
        r"^velero_", r"^backup_",
    ]]),
    ("go_runtime", [re.compile(p, re.IGNORECASE) for p in [
        r"^go_", r"^process_",
    ]]),
    ("http_grpc", [re.compile(p, re.IGNORECASE) for p in [
        r"^http_", r"^grpc_", r"^rest_client_",
    ]]),
    # "other" has no patterns — it's the fallback
]


def _classify_category(metric_name: str) -> str:
    """Classify a metric into a category using the same logic as cli.py."""
    for category_id, patterns in _CATEGORY_PATTERNS:
        for p in patterns:
            if p.search(metric_name):
                return category_id
    return "other"


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

    def __init__(
        self,
        prometheus_url: str,
        ssl_verify=True,
        auth_token: Optional[str] = None,
    ):
        """
        Initialize catalog validator.

        Args:
            prometheus_url: URL of the Prometheus/Thanos endpoint.
            ssl_verify: SSL verification setting (bool or CA bundle path string).
            auth_token: Bearer token for Prometheus/Thanos authentication.
        """
        self.prometheus_url = prometheus_url.rstrip("/")
        self._ssl_verify = ssl_verify
        self._auth_token = auth_token

    def validate(
        self,
        categories: List[Dict],
        lookup: Dict[str, Dict],
        skip_categories: Optional[Set[str]] = None,
        timeout: float = DISCOVERY_TIMEOUT_SECONDS,
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

            # Step 3: Count catalog metrics before
            total_before = sum(
                len(cat["metrics"].get(p, []))
                for cat in categories
                for p in ("High", "Medium")
                if cat["id"] not in skip
            )

            # Step 4: Identify metrics to remove (in catalog but not in Prometheus)
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

            # Step 5: Identify metrics to add (in Prometheus but not in catalog)
            existing_names = set(lookup.keys())
            metrics_added = []
            for name in sorted(prometheus_set - existing_names):
                # Categorize using the same explicit patterns as cli.py
                category_id = _classify_category(name)

                if category_id in skip:
                    continue

                # Apply the same priority classification as the CLI.
                # The base catalog only includes High and Medium metrics.
                priority = _classify_priority(name, category_id)
                if priority == "Low":
                    continue

                meta = all_metadata.get(name, {})
                metric_type = meta.get("type", "unknown")
                help_text = meta.get("help", "")
                keywords = self._generate_keywords(name, help_text)

                metrics_added.append({
                    "name": name,
                    "category_id": category_id,
                    "priority": priority,
                    "type": metric_type,
                    "help": help_text,
                    "keywords": keywords,
                })

            total_after = total_before - len(metrics_removed) + len(metrics_added)
            elapsed = (time.perf_counter() - start_time) * 1000

            if metrics_removed:
                # Group removed metrics by category for readable logging
                removed_by_cat: Dict[str, List[str]] = {}
                for e in metrics_removed:
                    removed_by_cat.setdefault(e["category_id"], []).append(e["name"])
                for cat_id, names in sorted(removed_by_cat.items()):
                    logger.info(
                        f"Catalog validation: removed from [{cat_id}] "
                        f"(not in Prometheus): {', '.join(names)}"
                    )
            if metrics_added:
                # Group added metrics by category for readable logging
                added_by_cat: Dict[str, List[str]] = {}
                for e in metrics_added:
                    added_by_cat.setdefault(e["category_id"], []).append(e["name"])
                for cat_id, names in sorted(added_by_cat.items()):
                    logger.info(
                        f"Catalog validation: added to [{cat_id}] "
                        f"(found in Prometheus): {', '.join(names)}"
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

    def _request_headers(self) -> Dict[str, str]:
        """Build HTTP headers with Bearer token if configured."""
        headers: Dict[str, str] = {}
        token = (self._auth_token or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _fetch_metric_names(self, timeout: float) -> List[str]:
        """
        Fetch all metric names from Prometheus.

        Args:
            timeout: Request timeout in seconds.

        Returns:
            List of metric name strings, or empty list on failure.
        """
        response = requests.get(
            f"{self.prometheus_url}/api/v1/label/__name__/values",
            headers=self._request_headers(),
            verify=self._ssl_verify,
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
        try:
            response = requests.get(
                f"{self.prometheus_url}/api/v1/metadata",
                headers=self._request_headers(),
                verify=self._ssl_verify,
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
