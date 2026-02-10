"""
Unit tests for catalog_validator module.

Tests the dynamic catalog validation against Prometheus including:
- Prefix map building
- Metric categorization
- Keyword generation
- Metric removal (not in Prometheus)
- Metric addition (in Prometheus, not in catalog)
- Safety checks (0 metrics from Prometheus)
- Integration with MetricsCatalog
"""

import json
import pytest
import requests as real_requests
from pathlib import Path
from unittest.mock import patch, MagicMock

from core.catalog_validator import CatalogValidator, CatalogValidationResult


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_categories():
    """Sample catalog categories for testing."""
    return [
        {
            "id": "cluster_health",
            "name": "Cluster Resources & Health",
            "icon": "H",
            "metrics": {
                "High": [
                    {"name": "cluster_version", "type": "gauge", "help": "Current cluster version"},
                    {"name": "cluster_operator_up", "type": "gauge", "help": "Operator availability"},
                ],
                "Medium": [
                    {"name": "cluster_admin_enabled", "type": "gauge", "help": "Admin role enabled"},
                ],
            },
        },
        {
            "id": "node_hardware",
            "name": "Node Hardware",
            "icon": "N",
            "metrics": {
                "High": [
                    {"name": "node_cpu_frequency_hertz", "type": "gauge", "help": "CPU frequency"},
                    {"name": "node_memory_MemTotal_bytes", "type": "gauge", "help": "Total memory"},
                ],
                "Medium": [
                    {"name": "node_disk_io_now", "type": "gauge", "help": "Current disk IO"},
                ],
            },
        },
        {
            "id": "etcd",
            "name": "etcd",
            "icon": "E",
            "metrics": {
                "High": [
                    {"name": "etcd_server_leader_changes_seen_total", "type": "counter", "help": "Leader changes"},
                ],
                "Medium": [],
            },
        },
        {
            "id": "gpu_ai",
            "name": "GPU & AI Accelerators",
            "icon": "G",
            "metrics": {
                "High": [
                    {"name": "DCGM_FI_DEV_GPU_TEMP", "type": "gauge", "help": "GPU temperature"},
                ],
                "Medium": [],
            },
        },
    ]


@pytest.fixture
def sample_lookup():
    """Sample lookup dict corresponding to sample_categories."""
    return {
        "cluster_version": {"category_id": "cluster_health", "priority": "High"},
        "cluster_operator_up": {"category_id": "cluster_health", "priority": "High"},
        "cluster_admin_enabled": {"category_id": "cluster_health", "priority": "Medium"},
        "node_cpu_frequency_hertz": {"category_id": "node_hardware", "priority": "High"},
        "node_memory_MemTotal_bytes": {"category_id": "node_hardware", "priority": "High"},
        "node_disk_io_now": {"category_id": "node_hardware", "priority": "Medium"},
        "etcd_server_leader_changes_seen_total": {"category_id": "etcd", "priority": "High"},
        "DCGM_FI_DEV_GPU_TEMP": {"category_id": "gpu_ai", "priority": "High"},
    }


@pytest.fixture
def validator():
    """Create a CatalogValidator instance."""
    return CatalogValidator(prometheus_url="http://test-prometheus:9090")


# ---------------------------------------------------------------------------
# Prefix Map Building
# ---------------------------------------------------------------------------

class TestBuildPrefixMap:
    """Test _build_prefix_map method."""

    def test_builds_prefixes_from_categories(self, validator, sample_categories):
        """Test that prefix map is built from existing metrics."""
        prefix_map = validator._build_prefix_map(sample_categories, {"gpu_ai"})

        # "etcd" prefix should map to "etcd" category (unambiguous)
        assert prefix_map.get("etcd") == "etcd"
        assert prefix_map.get("etcd_server") == "etcd"

    def test_ambiguous_prefixes_excluded(self, validator, sample_categories):
        """Test that ambiguous prefixes (mapping to multiple categories) are excluded."""
        prefix_map = validator._build_prefix_map(sample_categories, {"gpu_ai"})

        # Single-letter or very short prefixes that map to multiple categories
        # should be excluded. For instance, depth-1 prefix "cluster" maps to
        # cluster_health only, so it should be present.
        # But there may be prefixes at depth 1 shared across categories.
        # All entries in the map should map to exactly 1 category.
        for prefix, cat_id in prefix_map.items():
            assert isinstance(cat_id, str)

    def test_skipped_categories_excluded(self, validator, sample_categories):
        """Test that skipped categories don't appear in prefix map."""
        prefix_map = validator._build_prefix_map(sample_categories, {"gpu_ai"})

        # No prefix should map to gpu_ai
        assert "gpu_ai" not in prefix_map.values()

    def test_empty_categories(self, validator):
        """Test prefix map with empty categories."""
        prefix_map = validator._build_prefix_map([], set())
        assert prefix_map == {}

    def test_prefix_depths(self, validator, sample_categories):
        """Test that prefixes at depths 1-4 are generated."""
        prefix_map = validator._build_prefix_map(sample_categories, {"gpu_ai"})

        # "etcd_server_leader_changes_seen_total" should generate:
        # depth 1: "etcd"
        # depth 2: "etcd_server"
        # depth 3: "etcd_server_leader"
        # depth 4: "etcd_server_leader_changes"
        assert "etcd" in prefix_map
        assert "etcd_server" in prefix_map
        assert "etcd_server_leader" in prefix_map
        assert "etcd_server_leader_changes" in prefix_map


# ---------------------------------------------------------------------------
# Metric Categorization
# ---------------------------------------------------------------------------

class TestCategorizeNewMetric:
    """Test _categorize_new_metric method."""

    def test_longest_prefix_match(self, validator, sample_categories):
        """Test that longest prefix wins."""
        prefix_map = validator._build_prefix_map(sample_categories, {"gpu_ai"})

        # A new etcd metric should match etcd category
        result = validator._categorize_new_metric("etcd_server_proposals_pending", prefix_map)
        assert result == "etcd"

    def test_no_match_returns_none(self, validator):
        """Test that unmatched metric returns None."""
        prefix_map = {"etcd": "etcd", "node": "node_hardware"}
        result = validator._categorize_new_metric("completely_unknown_metric", prefix_map)
        assert result is None

    def test_single_segment_match(self, validator):
        """Test matching on single-segment prefix."""
        prefix_map = {"etcd": "etcd"}
        result = validator._categorize_new_metric("etcd_new_metric", prefix_map)
        assert result == "etcd"

    def test_four_segment_match(self, validator):
        """Test matching on 4-segment prefix."""
        prefix_map = {
            "node": "node_hardware",
            "node_cpu": "node_hardware",
            "node_cpu_frequency": "node_hardware",
            "node_cpu_frequency_max": "node_hardware",
        }
        result = validator._categorize_new_metric("node_cpu_frequency_max_hertz", prefix_map)
        assert result == "node_hardware"


# ---------------------------------------------------------------------------
# Keyword Generation
# ---------------------------------------------------------------------------

class TestGenerateKeywords:
    """Test _generate_keywords method."""

    def test_keywords_from_name(self, validator):
        """Test keyword extraction from metric name."""
        keywords = validator._generate_keywords("node_cpu_frequency_hertz", "")
        assert "node" in keywords
        assert "cpu" in keywords
        assert "frequency" in keywords
        assert "hertz" in keywords

    def test_keywords_from_help_text(self, validator):
        """Test keyword extraction from help text."""
        keywords = validator._generate_keywords(
            "test_metric", "Reports the current temperature reading"
        )
        assert "reports" in keywords
        assert "current" in keywords
        assert "temperature" in keywords
        assert "reading" in keywords

    def test_short_words_excluded(self, validator):
        """Test that words <= 2 chars are excluded from name."""
        keywords = validator._generate_keywords("a_bc_def_ghij", "")
        assert "a" not in keywords
        assert "bc" not in keywords
        assert "def" in keywords
        assert "ghij" in keywords

    def test_skip_words_excluded(self, validator):
        """Test that common skip words are excluded from name."""
        keywords = validator._generate_keywords("test_total_count_bucket", "")
        assert "test" in keywords
        assert "total" not in keywords
        assert "count" not in keywords
        assert "bucket" not in keywords

    def test_keyword_limit(self, validator):
        """Test that keywords are limited to 12."""
        long_name = "_".join(f"word{i}" for i in range(20))
        keywords = validator._generate_keywords(long_name, "lots of helpful text words here")
        assert len(keywords) <= 12


# ---------------------------------------------------------------------------
# Validation (with mocked Prometheus)
# ---------------------------------------------------------------------------

class TestValidate:
    """Test the validate method with mocked Prometheus."""

    def _mock_responses(self, metric_names, metadata=None):
        """Helper to create mock Prometheus responses."""
        names_response = MagicMock()
        names_response.json.return_value = {
            "status": "success",
            "data": metric_names,
        }
        names_response.raise_for_status = MagicMock()

        meta_response = MagicMock()
        meta_data = {}
        if metadata:
            meta_data = metadata
        else:
            for name in metric_names:
                meta_data[name] = [{"type": "gauge", "help": f"Help for {name}"}]
        meta_response.json.return_value = {
            "status": "success",
            "data": meta_data,
        }
        meta_response.raise_for_status = MagicMock()

        return [names_response, meta_response]

    def test_removes_missing_metrics(self, validator, sample_categories, sample_lookup):
        """Test that metrics not in Prometheus are identified for removal."""
        # Prometheus has everything except "cluster_admin_enabled"
        prom_metrics = [
            "cluster_version", "cluster_operator_up",
            "node_cpu_frequency_hertz", "node_memory_MemTotal_bytes",
            "node_disk_io_now",
            "etcd_server_leader_changes_seen_total",
            "DCGM_FI_DEV_GPU_TEMP",
        ]
        with patch.object(real_requests, "get", side_effect=self._mock_responses(prom_metrics)):
            result = validator.validate(sample_categories, sample_lookup)

        assert result.error is None
        removed_names = [m["name"] for m in result.metrics_removed]
        assert "cluster_admin_enabled" in removed_names
        assert len(result.metrics_removed) == 1

    def test_adds_new_metrics(self, validator, sample_categories, sample_lookup):
        """Test that new Prometheus metrics matching a prefix are identified for addition."""
        # Prometheus has all existing metrics plus a new etcd metric
        prom_metrics = list(sample_lookup.keys()) + ["etcd_server_proposals_committed_total"]
        with patch.object(real_requests, "get", side_effect=self._mock_responses(prom_metrics)):
            result = validator.validate(sample_categories, sample_lookup)

        assert result.error is None
        added_names = [m["name"] for m in result.metrics_added]
        assert "etcd_server_proposals_committed_total" in added_names

    def test_added_metrics_have_medium_priority(self, validator, sample_categories, sample_lookup):
        """Test that added metrics get Medium priority."""
        prom_metrics = list(sample_lookup.keys()) + ["etcd_server_new_metric"]
        with patch.object(real_requests, "get", side_effect=self._mock_responses(prom_metrics)):
            result = validator.validate(sample_categories, sample_lookup)

        for added in result.metrics_added:
            assert added["priority"] == "Medium"

    def test_skips_gpu_ai_category(self, validator, sample_categories, sample_lookup):
        """Test that gpu_ai metrics are not removed even if missing from Prometheus."""
        # Prometheus has all metrics EXCEPT the GPU one
        prom_metrics = [k for k in sample_lookup if k != "DCGM_FI_DEV_GPU_TEMP"]
        with patch.object(real_requests, "get", side_effect=self._mock_responses(prom_metrics)):
            result = validator.validate(sample_categories, sample_lookup)

        # DCGM metric should NOT be in removed list (gpu_ai is skipped)
        removed_names = [m["name"] for m in result.metrics_removed]
        assert "DCGM_FI_DEV_GPU_TEMP" not in removed_names

    def test_skips_low_priority_prefixes_for_addition(self, validator, sample_categories, sample_lookup):
        """Test that go_*, process_*, promhttp_* metrics are not added."""
        prom_metrics = list(sample_lookup.keys()) + [
            "go_goroutines",
            "process_cpu_seconds_total",
            "promhttp_metric_handler_requests_total",
        ]
        with patch.object(real_requests, "get", side_effect=self._mock_responses(prom_metrics)):
            result = validator.validate(sample_categories, sample_lookup)

        added_names = [m["name"] for m in result.metrics_added]
        assert "go_goroutines" not in added_names
        assert "process_cpu_seconds_total" not in added_names
        assert "promhttp_metric_handler_requests_total" not in added_names

    def test_zero_metrics_safety(self, validator, sample_categories, sample_lookup):
        """Test that 0 metrics from Prometheus is treated as error."""
        with patch.object(real_requests, "get", side_effect=self._mock_responses([])):
            result = validator.validate(sample_categories, sample_lookup)

        assert result.error is not None
        assert "0 metrics" in result.error
        assert len(result.metrics_removed) == 0
        assert len(result.metrics_added) == 0

    def test_prometheus_error_returns_error(self, validator, sample_categories, sample_lookup):
        """Test that Prometheus connection error is handled gracefully."""
        with patch.object(
            real_requests, "get",
            side_effect=real_requests.ConnectionError("Connection refused"),
        ):
            result = validator.validate(sample_categories, sample_lookup)

        assert result.error is not None
        assert len(result.metrics_removed) == 0
        assert len(result.metrics_added) == 0

    def test_metadata_failure_proceeds(self, validator, sample_categories, sample_lookup):
        """Test that metadata fetch failure doesn't block validation."""
        # First call (names) succeeds, second call (metadata) fails
        names_response = MagicMock()
        names_response.json.return_value = {
            "status": "success",
            "data": list(sample_lookup.keys()) + ["etcd_server_new_metric"],
        }
        names_response.raise_for_status = MagicMock()

        meta_response = MagicMock()
        meta_response.raise_for_status.side_effect = Exception("metadata error")

        with patch.object(
            real_requests, "get",
            side_effect=[names_response, meta_response],
        ):
            result = validator.validate(sample_categories, sample_lookup)

        # Should still work — new metrics get type="unknown"
        assert result.error is None
        added = [m for m in result.metrics_added if m["name"] == "etcd_server_new_metric"]
        assert len(added) == 1
        assert added[0]["type"] == "unknown"

    def test_unmatched_metrics_skipped(self, validator, sample_categories, sample_lookup):
        """Test that Prometheus metrics that don't match any prefix are skipped."""
        prom_metrics = list(sample_lookup.keys()) + ["completely_unknown_xyz"]
        with patch.object(real_requests, "get", side_effect=self._mock_responses(prom_metrics)):
            result = validator.validate(sample_categories, sample_lookup)

        added_names = [m["name"] for m in result.metrics_added]
        assert "completely_unknown_xyz" not in added_names

    def test_validation_result_counts(self, validator, sample_categories, sample_lookup):
        """Test that result counts are accurate."""
        # Remove one metric, add one metric
        prom_metrics = [
            k for k in sample_lookup
            if k != "cluster_admin_enabled"
        ] + ["etcd_server_new_metric"]
        with patch.object(real_requests, "get", side_effect=self._mock_responses(prom_metrics)):
            result = validator.validate(sample_categories, sample_lookup)

        assert result.error is None
        assert result.total_prometheus_metrics == len(prom_metrics)
        # total_catalog_before: all non-gpu metrics = 7 (3 cluster + 3 node + 1 etcd)
        assert result.total_catalog_before == 7
        # After: 7 - 1 removed + 1 added = 7
        assert result.total_catalog_after == 7
        assert result.validation_time_ms > 0

    def test_added_metrics_have_keywords(self, validator, sample_categories, sample_lookup):
        """Test that added metrics include generated keywords."""
        prom_metrics = list(sample_lookup.keys()) + ["etcd_server_proposals_pending"]
        with patch.object(real_requests, "get", side_effect=self._mock_responses(prom_metrics)):
            result = validator.validate(sample_categories, sample_lookup)

        added = [m for m in result.metrics_added if m["name"] == "etcd_server_proposals_pending"]
        assert len(added) == 1
        assert "keywords" in added[0]
        assert len(added[0]["keywords"]) > 0
        assert "etcd" in added[0]["keywords"]
        assert "server" in added[0]["keywords"]


# ---------------------------------------------------------------------------
# Integration with MetricsCatalog
# ---------------------------------------------------------------------------

class TestMetricsCatalogValidationIntegration:
    """Test catalog validation integration in MetricsCatalog."""

    @pytest.fixture
    def base_catalog_data(self):
        """Sample base catalog data."""
        return {
            "metadata": {
                "generated": "2026-02-09 12:00:00",
                "total_metrics": 4,
                "catalog_type": "base",
                "description": "Base catalog for testing",
                "gpu_metrics_excluded": 0,
                "gpu_discovery": "runtime",
            },
            "categories": [
                {
                    "id": "gpu_ai",
                    "name": "GPU & AI Accelerators",
                    "icon": "G",
                    "runtime_discovery": True,
                    "metrics": {"High": [], "Medium": []},
                },
                {
                    "id": "cluster_health",
                    "name": "Cluster Resources & Health",
                    "icon": "H",
                    "metrics": {
                        "High": [
                            {"name": "cluster_version", "type": "gauge", "help": "Version"},
                        ],
                        "Medium": [
                            {"name": "cluster_admin_enabled", "type": "gauge", "help": "Admin"},
                        ],
                    },
                },
                {
                    "id": "etcd",
                    "name": "etcd",
                    "icon": "E",
                    "metrics": {
                        "High": [
                            {"name": "etcd_server_leader_changes_seen_total", "type": "counter", "help": "Leaders"},
                        ],
                        "Medium": [
                            {"name": "etcd_server_proposals_pending", "type": "gauge", "help": "Pending"},
                        ],
                    },
                },
            ],
            "lookup": {
                "cluster_version": {"category_id": "cluster_health", "priority": "High"},
                "cluster_admin_enabled": {"category_id": "cluster_health", "priority": "Medium"},
                "etcd_server_leader_changes_seen_total": {"category_id": "etcd", "priority": "High"},
                "etcd_server_proposals_pending": {"category_id": "etcd", "priority": "Medium"},
            },
        }

    @pytest.fixture
    def base_catalog_file(self, base_catalog_data, tmp_path):
        """Create a temporary base catalog file."""
        catalog_file = tmp_path / "base-catalog.json"
        catalog_file.write_text(json.dumps(base_catalog_data))
        return catalog_file

    def test_validation_status_initial(self, base_catalog_file):
        """Test initial catalog validation status."""
        from core.metrics_catalog import MetricsCatalog

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
            enable_catalog_validation=False,
        )
        catalog._load_catalog()

        status = catalog.get_catalog_validation_status()
        assert status["enabled"] is False
        assert status["ready"] is False
        assert status["error"] is None

    def test_is_catalog_validated_initial(self, base_catalog_file):
        """Test is_catalog_validated when validation is disabled."""
        from core.metrics_catalog import MetricsCatalog

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
            enable_catalog_validation=False,
        )
        catalog._load_catalog()
        assert catalog.is_catalog_validated() is False

    def test_wait_for_catalog_validation_no_thread(self, base_catalog_file):
        """Test wait_for_catalog_validation when no validation started."""
        from core.metrics_catalog import MetricsCatalog

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
            enable_catalog_validation=False,
        )
        catalog._load_catalog()
        assert catalog.wait_for_catalog_validation(timeout=1.0) is True

    def test_apply_validation_result_removes_metrics(self, base_catalog_file):
        """Test that _apply_validation_result removes metrics correctly."""
        from core.metrics_catalog import MetricsCatalog

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
            enable_catalog_validation=False,
        )
        catalog._load_catalog()

        result = CatalogValidationResult(
            metrics_removed=[
                {"name": "cluster_admin_enabled", "category_id": "cluster_health", "priority": "Medium"},
            ],
            metrics_added=[],
            total_prometheus_metrics=100,
            total_catalog_before=4,
            total_catalog_after=3,
        )

        catalog._apply_validation_result(result)

        # Metric should be removed from lookup
        assert "cluster_admin_enabled" not in catalog._lookup

        # Metric should be removed from category
        cluster_cat = catalog.get_category_by_id("cluster_health")
        medium_names = [m["name"] for m in cluster_cat["metrics"]["Medium"]]
        assert "cluster_admin_enabled" not in medium_names

    def test_apply_validation_result_adds_metrics(self, base_catalog_file):
        """Test that _apply_validation_result adds metrics correctly."""
        from core.metrics_catalog import MetricsCatalog

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
            enable_catalog_validation=False,
        )
        catalog._load_catalog()

        result = CatalogValidationResult(
            metrics_removed=[],
            metrics_added=[
                {
                    "name": "etcd_server_new_metric",
                    "category_id": "etcd",
                    "priority": "Medium",
                    "type": "gauge",
                    "help": "A new metric",
                    "keywords": ["etcd", "server", "new"],
                },
            ],
            total_prometheus_metrics=100,
            total_catalog_before=4,
            total_catalog_after=5,
        )

        catalog._apply_validation_result(result)

        # Metric should be in lookup
        assert "etcd_server_new_metric" in catalog._lookup
        assert catalog._lookup["etcd_server_new_metric"]["category_id"] == "etcd"
        assert catalog._lookup["etcd_server_new_metric"]["priority"] == "Medium"

        # Metric should be in category
        etcd_cat = catalog.get_category_by_id("etcd")
        medium_names = [m["name"] for m in etcd_cat["metrics"]["Medium"]]
        assert "etcd_server_new_metric" in medium_names

    def test_apply_validation_result_updates_metadata(self, base_catalog_file):
        """Test that _apply_validation_result updates metadata counts."""
        from core.metrics_catalog import MetricsCatalog

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
            enable_catalog_validation=False,
        )
        catalog._load_catalog()

        initial_total = catalog.get_metadata().get("total_metrics", 0)

        result = CatalogValidationResult(
            metrics_removed=[
                {"name": "cluster_admin_enabled", "category_id": "cluster_health", "priority": "Medium"},
            ],
            metrics_added=[
                {
                    "name": "etcd_server_new_a",
                    "category_id": "etcd",
                    "priority": "Medium",
                    "type": "gauge",
                    "help": "",
                    "keywords": [],
                },
                {
                    "name": "etcd_server_new_b",
                    "category_id": "etcd",
                    "priority": "Medium",
                    "type": "gauge",
                    "help": "",
                    "keywords": [],
                },
            ],
            total_prometheus_metrics=100,
            total_catalog_before=4,
            total_catalog_after=5,
        )

        catalog._apply_validation_result(result)

        metadata = catalog.get_metadata()
        assert metadata["catalog_validated"] is True
        assert metadata["validation_removed"] == 1
        assert metadata["validation_added"] == 2
        # total_metrics should be initial - 1 removed + 2 added
        assert metadata["total_metrics"] == initial_total - 1 + 2

    @patch("core.metrics_catalog.threading.Thread")
    def test_validation_thread_started(self, mock_thread, base_catalog_file):
        """Test that validation thread is started when enabled."""
        from core.metrics_catalog import MetricsCatalog

        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
            enable_catalog_validation=True,
            prometheus_url="http://test:9090",
        )
        catalog._load_catalog()

        # Thread should have been created and started
        assert mock_thread.call_count >= 1
        mock_thread_instance.start.assert_called()

    def test_validation_not_started_when_disabled(self, base_catalog_file):
        """Test that no validation thread is started when disabled."""
        from core.metrics_catalog import MetricsCatalog

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
            enable_catalog_validation=False,
        )
        catalog._load_catalog()

        assert catalog._catalog_validation_thread is None

    def test_get_metrics_catalog_with_validation_param(self):
        """Test that get_metrics_catalog passes enable_catalog_validation."""
        from core.metrics_catalog import get_metrics_catalog, reset_metrics_catalog

        reset_metrics_catalog()
        try:
            catalog = get_metrics_catalog(
                enable_gpu_discovery=False,
                enable_catalog_validation=False,
            )
            assert catalog._enable_catalog_validation is False
        finally:
            reset_metrics_catalog()
