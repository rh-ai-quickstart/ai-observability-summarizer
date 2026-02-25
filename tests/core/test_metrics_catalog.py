"""
Unit tests for metrics_catalog module.

Tests the smart metrics catalog functionality including:
- Catalog loading and caching
- Category filtering
- Priority-based selection
- Smart metric discovery
"""

import pytest
import json
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

from core.metrics_catalog import (
    MetricsCatalog,
    MetricInfo,
    CategoryInfo,
    get_metrics_catalog
)


@pytest.fixture
def sample_catalog_data():
    """Sample catalog data for testing."""
    return {
        "metadata": {
            "generated": "2026-02-05 12:00:00",
            "source_date": "2026-02-05",
            "total_metrics": 10,
            "priority_distribution": {"High": 3, "Medium": 7},
            "categories": 2
        },
        "categories": [
            {
                "id": "gpu_ai",
                "name": "GPU & AI Accelerators",
                "description": "GPU metrics for AI/ML workloads",
                "icon": "🎮",
                "example_queries": ["DCGM_FI_DEV_GPU_TEMP"],
                "metrics": {
                    "High": [
                        {
                            "name": "DCGM_FI_DEV_GPU_TEMP",
                            "type": "gauge",
                            "help": "Current GPU temperature"
                        }
                    ],
                    "Medium": [
                        {
                            "name": "DCGM_FI_DEV_MEM_COPY_UTIL",
                            "type": "gauge",
                            "help": "Memory copy utilization percentage"
                        }
                    ]
                }
            },
            {
                "id": "cluster_health",
                "name": "Cluster Resources & Health",
                "description": "Cluster-wide resource metrics",
                "icon": "🏢",
                "example_queries": ["cluster_infrastructure_provider"],
                "metrics": {
                    "High": [
                        {
                            "name": "cluster_infrastructure_provider",
                            "type": "gauge",
                            "help": "Infrastructure provider type"
                        },
                        {
                            "name": "cluster_version",
                            "type": "gauge",
                            "help": "Current cluster version"
                        }
                    ],
                    "Medium": []
                }
            }
        ],
        "lookup": {
            "DCGM_FI_DEV_GPU_TEMP": {"category_id": "gpu_ai", "priority": "High"},
            "DCGM_FI_DEV_MEM_COPY_UTIL": {"category_id": "gpu_ai", "priority": "Medium"},
            "cluster_infrastructure_provider": {"category_id": "cluster_health", "priority": "High"},
            "cluster_version": {"category_id": "cluster_health", "priority": "High"}
        }
    }


@pytest.fixture
def temp_catalog_file(tmp_path, sample_catalog_data):
    """Create a temporary catalog file for testing."""
    catalog_file = tmp_path / "test-metrics-catalog.json"
    with open(catalog_file, 'w') as f:
        json.dump(sample_catalog_data, f)
    return catalog_file


class TestMetricsCatalog:
    """Test MetricsCatalog class."""

    def test_catalog_initialization(self, temp_catalog_file):
        """Test catalog initialization with custom path."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        assert not catalog._loaded
        assert catalog._catalog_path == temp_catalog_file

    def test_catalog_loading(self, temp_catalog_file):
        """Test catalog loading from file."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        assert catalog._load_catalog()
        assert catalog._loaded
        assert catalog._catalog is not None
        assert catalog._lookup is not None
        assert catalog._categories is not None

    def test_catalog_metadata(self, temp_catalog_file):
        """Test getting catalog metadata."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        metadata = catalog.get_metadata()

        assert metadata["total_metrics"] == 10
        assert metadata["categories"] == 2
        assert metadata["priority_distribution"]["High"] == 3
        assert metadata["priority_distribution"]["Medium"] == 7

    def test_get_all_categories(self, temp_catalog_file):
        """Test getting all categories."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        categories = catalog.get_all_categories()

        assert len(categories) == 2
        assert isinstance(categories[0], CategoryInfo)

        # Check GPU category
        gpu_cat = next(c for c in categories if c.id == "gpu_ai")
        assert gpu_cat.name == "GPU & AI Accelerators"
        assert gpu_cat.icon == "🎮"
        assert gpu_cat.metric_count == 2
        assert gpu_cat.priority_distribution["High"] == 1
        assert gpu_cat.priority_distribution["Medium"] == 1

    def test_get_category_by_id(self, temp_catalog_file):
        """Test getting category by ID."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        gpu_cat = catalog.get_category_by_id("gpu_ai")
        assert gpu_cat is not None
        assert gpu_cat["id"] == "gpu_ai"
        assert len(gpu_cat["metrics"]) == 2

        # Test non-existent category
        assert catalog.get_category_by_id("non_existent") is None

    def test_search_metrics_by_category(self, temp_catalog_file):
        """Test searching metrics by category."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        # Search GPU metrics only
        gpu_metrics = catalog.search_metrics_by_category(
            category_ids=["gpu_ai"],
            priorities=["High", "Medium"]
        )
        assert len(gpu_metrics) == 2
        assert all(m.category_id == "gpu_ai" for m in gpu_metrics)

        # Search High priority only
        high_metrics = catalog.search_metrics_by_category(
            category_ids=None,
            priorities=["High"]
        )
        assert len(high_metrics) == 3
        assert all(m.priority == "High" for m in high_metrics)

    def test_get_metric_info(self, temp_catalog_file):
        """Test getting metric information."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        metric = catalog.get_metric_info("DCGM_FI_DEV_GPU_TEMP")
        assert metric is not None
        assert isinstance(metric, MetricInfo)
        assert metric.name == "DCGM_FI_DEV_GPU_TEMP"
        assert metric.category_id == "gpu_ai"
        assert metric.priority == "High"
        assert metric.type == "gauge"

        # Test non-existent metric
        assert catalog.get_metric_info("non_existent_metric") is None

    def test_extract_category_hints(self, temp_catalog_file):
        """Test category hint extraction from queries."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        # GPU queries
        hints = catalog.extract_category_hints("What is the GPU temperature?")
        assert "gpu_ai" in hints

        hints = catalog.extract_category_hints("Show me nvidia cuda metrics")
        assert "gpu_ai" in hints

        # Cluster queries
        hints = catalog.extract_category_hints("What's the cluster capacity?")
        assert "cluster_health" in hints

        # Multi-category queries
        hints = catalog.extract_category_hints("Show GPU and node metrics")
        assert "gpu_ai" in hints
        assert "node_hardware" in hints

    def test_get_smart_metric_list(self, temp_catalog_file):
        """Test smart metric list generation."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        # GPU-related query
        metrics = catalog.get_smart_metric_list("GPU temperature", max_metrics=10)
        assert len(metrics) > 0
        assert "DCGM_FI_DEV_GPU_TEMP" in metrics

        # Cluster-related query
        metrics = catalog.get_smart_metric_list("cluster version", max_metrics=10)
        assert len(metrics) > 0
        assert "cluster_version" in metrics

    def test_catalog_caching(self, temp_catalog_file):
        """Test that catalog is cached after first load."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        # First load
        assert catalog._load_catalog()
        assert catalog._loaded

        # Second call should use cache
        assert catalog._load_catalog()
        assert catalog._loaded

    def test_catalog_not_found_fallback(self):
        """Test fallback when catalog file doesn't exist."""
        catalog = MetricsCatalog(catalog_path=Path("/nonexistent/path.json"))
        assert not catalog._load_catalog()
        assert not catalog.is_available()

    def test_singleton_pattern(self):
        """Test that get_metrics_catalog returns singleton."""
        catalog1 = get_metrics_catalog()
        catalog2 = get_metrics_catalog()
        assert catalog1 is catalog2


class TestMetricInfo:
    """Test MetricInfo dataclass."""

    def test_metric_info_creation(self):
        """Test MetricInfo creation."""
        metric = MetricInfo(
            name="test_metric",
            category_id="test_cat",
            category_name="Test Category",
            priority="High",
            type="gauge",
            description="Test metric"
        )
        assert metric.name == "test_metric"
        assert metric.priority == "High"
        assert metric.help == ""  # Default value


class TestCategoryInfo:
    """Test CategoryInfo dataclass."""

    def test_category_info_creation(self):
        """Test CategoryInfo creation."""
        category = CategoryInfo(
            id="test_cat",
            name="Test Category",
            description="Test description",
            icon="🧪",
            metric_count=10,
            priority_distribution={"High": 3, "Medium": 7},
            example_queries=["query1", "query2"]
        )
        assert category.id == "test_cat"
        assert category.metric_count == 10
        assert len(category.example_queries) == 2


class TestCategoryHintExtraction:
    """Test category hint extraction logic."""

    def test_gpu_keywords(self, temp_catalog_file):
        """Test GPU-related keyword detection."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        test_cases = [
            ("GPU temperature", ["gpu_ai"]),
            ("NVIDIA CUDA usage", ["gpu_ai"]),
            ("Habana accelerator", ["gpu_ai"]),
            ("AI model inference", ["gpu_ai"]),
        ]

        for query, expected_categories in test_cases:
            hints = catalog.extract_category_hints(query)
            for cat in expected_categories:
                assert cat in hints, f"Expected {cat} in hints for query: {query}"

    def test_cluster_keywords(self, temp_catalog_file):
        """Test cluster-related keyword detection."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        test_cases = [
            ("cluster capacity", ["cluster_health"]),
            ("resource quota", ["cluster_health"]),
        ]

        for query, expected_categories in test_cases:
            hints = catalog.extract_category_hints(query)
            for cat in expected_categories:
                assert cat in hints, f"Expected {cat} in hints for query: {query}"

    def test_pod_keywords(self, temp_catalog_file):
        """Test pod-related keyword detection."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        test_cases = [
            ("pod restarts", ["pod_container"]),
            ("container status", ["pod_container"]),
        ]

        for query, expected_categories in test_cases:
            hints = catalog.extract_category_hints(query)
            for cat in expected_categories:
                assert cat in hints, f"Expected {cat} in hints for query: {query}"

    def test_corrected_category_ids(self, temp_catalog_file):
        """Test that category IDs match actual catalog entries."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        # observability (was incorrectly "monitoring")
        hints = catalog.extract_category_hints("prometheus alert rules")
        assert "observability" in hints
        assert "monitoring" not in hints

        hints = catalog.extract_category_hints("alertmanager notifications")
        assert "observability" in hints

        # security (was incorrectly "authentication")
        hints = catalog.extract_category_hints("authentication rbac policies")
        assert "security" in hints
        assert "authentication" not in hints

        hints = catalog.extract_category_hints("oauth authorization")
        assert "security" in hints

        # image_registry (was incorrectly "registry"; also absorbed "build")
        hints = catalog.extract_category_hints("container image registry")
        assert "image_registry" in hints
        assert "registry" not in hints

        hints = catalog.extract_category_hints("buildconfig pipeline")
        assert "image_registry" in hints
        assert "build" not in hints

        # controller_manager (was incorrectly "controller")
        hints = catalog.extract_category_hints("controller reconcile errors")
        assert "controller_manager" in hints
        assert "controller" not in hints

        # networking absorbed route and service_mesh
        hints = catalog.extract_category_hints("istio service mesh")
        assert "networking" in hints
        assert "service_mesh" not in hints

        hints = catalog.extract_category_hints("openshift router")
        assert "networking" in hints
        assert "route" not in hints

    def test_new_category_keywords(self, temp_catalog_file):
        """Test keywords for newly added categories."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        # openshift_specific (absorbed "operator"/"olm")
        hints = catalog.extract_category_hints("operator olm subscription")
        assert "openshift_specific" in hints
        assert "operator" not in hints

        hints = catalog.extract_category_hints("openshift deploymentconfig")
        assert "openshift_specific" in hints

        # backup_dr
        hints = catalog.extract_category_hints("velero backup status")
        assert "backup_dr" in hints

        hints = catalog.extract_category_hints("disaster recovery restore")
        assert "backup_dr" in hints

        # go_runtime
        hints = catalog.extract_category_hints("goroutine count")
        assert "go_runtime" in hints

        hints = catalog.extract_category_hints("garbage collection pauses")
        assert "go_runtime" in hints

        # http_grpc
        hints = catalog.extract_category_hints("grpc request errors")
        assert "http_grpc" in hints

    def test_no_fabricated_category_ids_returned(self, temp_catalog_file):
        """Verify that no old/fabricated category IDs are ever returned."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        # These category IDs should never appear in hints
        fabricated_ids = {"monitoring", "authentication", "registry",
                         "controller", "build", "route", "service_mesh", "operator"}

        test_queries = [
            "prometheus monitoring alert",
            "authentication oauth rbac",
            "container image registry",
            "controller reconcile",
            "buildconfig builder",
            "openshift router route",
            "istio service mesh",
            "operator olm",
        ]

        for query in test_queries:
            hints = catalog.extract_category_hints(query)
            returned_fabricated = fabricated_ids.intersection(hints)
            assert not returned_fabricated, (
                f"Query '{query}' returned fabricated category IDs: {returned_fabricated}"
            )


class TestCategoryHintsVLLMKeywords:
    """Test that vLLM-specific keywords correctly map to gpu_ai."""

    def test_vllm_keywords_no_dangling_category(self, temp_catalog_file):
        """Verify no dangling 'vllm' category exists (bug fix)."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        hints = catalog.extract_category_hints("vllm inference metrics")
        assert "vllm" not in hints, "Dangling 'vllm' category should be removed"
        assert "gpu_ai" in hints

    def test_ttft_maps_to_gpu_ai(self, temp_catalog_file):
        """TTFT keyword should map to gpu_ai."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        hints = catalog.extract_category_hints("What is the TTFT?")
        assert "gpu_ai" in hints

    def test_tpot_maps_to_gpu_ai(self, temp_catalog_file):
        """TPOT keyword should map to gpu_ai."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        hints = catalog.extract_category_hints("Show me the TPOT")
        assert "gpu_ai" in hints

    def test_kv_cache_maps_to_gpu_ai(self, temp_catalog_file):
        """KV cache keyword should map to gpu_ai."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        hints = catalog.extract_category_hints("How full is the kv cache?")
        assert "gpu_ai" in hints

    def test_prefix_cache_maps_to_gpu_ai(self, temp_catalog_file):
        """Prefix cache keyword should map to gpu_ai."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        hints = catalog.extract_category_hints("What is the prefix cache hit rate?")
        assert "gpu_ai" in hints

    def test_model_serving_maps_to_gpu_ai(self, temp_catalog_file):
        """Model serving keyword should map to gpu_ai."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        hints = catalog.extract_category_hints("Show model serving metrics")
        assert "gpu_ai" in hints

    def test_tokens_per_second_maps_to_gpu_ai(self, temp_catalog_file):
        """Tokens per second keyword should map to gpu_ai."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        hints = catalog.extract_category_hints("What is the tokens per second?")
        assert "gpu_ai" in hints


class TestPriorityFiltering:
    """Test priority-based filtering."""

    def test_high_priority_only(self, temp_catalog_file):
        """Test filtering for High priority metrics only."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        metrics = catalog.search_metrics_by_category(
            category_ids=None,
            priorities=["High"]
        )

        assert all(m.priority == "High" for m in metrics)
        assert len(metrics) == 3  # 1 GPU + 2 Cluster = 3 High priority

    def test_high_and_medium_priority(self, temp_catalog_file):
        """Test filtering for High and Medium priority metrics."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        metrics = catalog.search_metrics_by_category(
            category_ids=None,
            priorities=["High", "Medium"]
        )

        assert len(metrics) == 4  # 2 GPU + 2 Cluster = 4 total

    def test_category_with_priority(self, temp_catalog_file):
        """Test combining category and priority filters."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)

        # GPU High priority only
        metrics = catalog.search_metrics_by_category(
            category_ids=["gpu_ai"],
            priorities=["High"]
        )

        assert len(metrics) == 1
        assert metrics[0].name == "DCGM_FI_DEV_GPU_TEMP"
        assert metrics[0].priority == "High"


class TestGPUDiscoveryIntegration:
    """Test GPU discovery integration in MetricsCatalog."""

    @pytest.fixture
    def base_catalog_data(self):
        """Sample base catalog data (without GPU metrics)."""
        return {
            "metadata": {
                "generated": "2026-02-07 12:00:00",
                "total_metrics": 2,
                "catalog_type": "base",
                "description": "Base catalog for testing",
                "gpu_metrics_excluded": 5,
                "gpu_discovery": "runtime"
            },
            "categories": [
                {
                    "id": "gpu_ai",
                    "name": "GPU & AI Accelerators",
                    "icon": "🎮",
                    "purpose": "GPU metrics discovered at runtime",
                    "runtime_discovery": True,
                    "metrics": {"High": [], "Medium": []}
                },
                {
                    "id": "cluster_health",
                    "name": "Cluster Resources & Health",
                    "icon": "🏢",
                    "metrics": {
                        "High": [
                            {"name": "cluster_version", "type": "gauge", "help": "Cluster version"}
                        ],
                        "Medium": [
                            {"name": "cluster_operator_conditions", "type": "gauge", "help": "Operator conditions"}
                        ]
                    }
                }
            ],
            "lookup": {
                "cluster_version": {"category_id": "cluster_health", "priority": "High"},
                "cluster_operator_conditions": {"category_id": "cluster_health", "priority": "Medium"}
            }
        }

    @pytest.fixture
    def base_catalog_file(self, base_catalog_data, tmp_path):
        """Create a temporary base catalog file."""
        catalog_file = tmp_path / "base-catalog.json"
        catalog_file.write_text(json.dumps(base_catalog_data))
        return catalog_file

    def test_base_catalog_detection(self, base_catalog_file):
        """Test that base catalog type is detected."""
        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False  # Disable for this test
        )

        metadata = catalog.get_metadata()
        assert metadata.get("catalog_type") == "base"
        assert metadata.get("gpu_discovery") == "runtime"

    def test_gpu_discovery_status_initial(self, base_catalog_file):
        """Test initial GPU discovery status."""
        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False
        )
        catalog._load_catalog()

        status = catalog.get_gpu_discovery_status()
        assert status["enabled"] is False
        assert status["ready"] is False
        assert status["error"] is None

    def test_is_gpu_catalog_ready_no_discovery(self, base_catalog_file):
        """Test is_gpu_catalog_ready when discovery is disabled."""
        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False
        )
        catalog._load_catalog()

        # Without discovery, it should report not ready initially
        assert catalog.is_gpu_catalog_ready() is False

    def test_gpu_category_empty_in_base_catalog(self, base_catalog_file):
        """Test that gpu_ai category is empty in base catalog."""
        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False
        )

        # Search for GPU metrics
        metrics = catalog.search_metrics_by_category(
            category_ids=["gpu_ai"],
            priorities=["High", "Medium"]
        )

        # Should be empty (no GPU metrics in base catalog)
        assert len(metrics) == 0

    def test_gpu_category_keywords(self, base_catalog_file):
        """Test that GPU category keywords include multiple vendors."""
        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False
        )

        # Test various GPU vendor queries
        test_cases = [
            ("nvidia gpu temperature", ["gpu_ai"]),
            ("intel gaudi utilization", ["gpu_ai"]),
            ("amd rocm gpu", ["gpu_ai"]),
            ("habana accelerator", ["gpu_ai"]),
            ("vllm inference latency", ["gpu_ai"]),
        ]

        for query, expected_categories in test_cases:
            hints = catalog.extract_category_hints(query)
            for cat in expected_categories:
                assert cat in hints, f"Expected {cat} in hints for query: {query}"

    @patch('core.metrics_catalog.threading.Thread')
    def test_gpu_discovery_started_for_base_catalog(self, mock_thread, base_catalog_file):
        """Test that GPU discovery is started for base catalog."""
        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=True,
            enable_catalog_validation=False,
            prometheus_url="http://test:9090"
        )
        catalog._load_catalog()

        # Thread should have been created and started
        mock_thread.assert_called_once()
        mock_thread_instance.start.assert_called_once()

    def test_merge_gpu_metrics(self, base_catalog_file):
        """Test merging GPU metrics into catalog."""
        from core.gpu_metrics_discovery import GPUDiscoveryResult, GPUVendor

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False
        )
        catalog._load_catalog()

        # Create mock discovery result
        result = GPUDiscoveryResult(
            vendor=GPUVendor.NVIDIA,
            metrics_high=[
                {"name": "DCGM_FI_DEV_GPU_TEMP", "type": "gauge", "help": "GPU temp", "keywords": ["gpu", "temp"]}
            ],
            metrics_medium=[
                {"name": "DCGM_FI_DEV_NVLINK", "type": "gauge", "help": "NVLink", "keywords": ["nvlink"]}
            ],
            total_discovered=2,
            discovery_time_ms=100.0,
            error=None
        )

        # Merge GPU metrics
        catalog._merge_gpu_metrics(result)

        # Verify GPU metrics are now in catalog
        metrics = catalog.search_metrics_by_category(
            category_ids=["gpu_ai"],
            priorities=["High", "Medium"]
        )
        assert len(metrics) == 2

        # Verify lookup table is updated
        assert "DCGM_FI_DEV_GPU_TEMP" in catalog._lookup
        assert catalog._lookup["DCGM_FI_DEV_GPU_TEMP"]["category_id"] == "gpu_ai"
        assert catalog._lookup["DCGM_FI_DEV_GPU_TEMP"]["priority"] == "High"

    def test_wait_for_gpu_discovery_no_thread(self, base_catalog_file):
        """Test wait_for_gpu_discovery when no discovery was started."""
        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False
        )
        catalog._load_catalog()

        # Should return immediately
        result = catalog.wait_for_gpu_discovery(timeout=1.0)
        assert result is True

    def test_concurrent_gpu_merge_and_lookup_iteration(self, base_catalog_file):
        """Test that iterating _lookup while GPU discovery merges doesn't raise.

        Without the snapshot fix in _start_catalog_validation, iterating
        self._lookup (via set(lookup.keys())) while _merge_gpu_metrics
        inserts keys concurrently would raise RuntimeError:
        'dictionary changed size during iteration'.
        """
        import threading
        from core.gpu_metrics_discovery import GPUDiscoveryResult, GPUVendor

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
        )
        catalog._load_catalog()

        # Build a large GPU result so the merge takes measurable time
        gpu_metrics = [
            {"name": f"gpu_metric_{i}", "type": "gauge",
             "help": f"GPU metric {i}", "keywords": ["gpu"]}
            for i in range(500)
        ]
        gpu_result = GPUDiscoveryResult(
            vendor=GPUVendor.NVIDIA,
            metrics_high=gpu_metrics,
            metrics_medium=[],
            total_discovered=len(gpu_metrics),
            discovery_time_ms=0.0,
            error=None,
        )

        errors = []

        def iterate_lookup():
            """Simulate what CatalogValidator.validate() does."""
            try:
                for _ in range(200):
                    # This is the line (catalog_validator.py:293) that would
                    # fail without the snapshot fix.
                    _ = set(catalog._lookup.keys())
            except RuntimeError as e:
                errors.append(e)

        def merge_gpu():
            """Simulate GPU discovery merging metrics."""
            try:
                catalog._merge_gpu_metrics(gpu_result)
            except RuntimeError as e:
                errors.append(e)

        # Run both concurrently — repeat several times to increase the
        # chance of hitting the race window.
        for _ in range(10):
            t_iter = threading.Thread(target=iterate_lookup)
            t_merge = threading.Thread(target=merge_gpu)
            t_iter.start()
            t_merge.start()
            t_iter.join(timeout=5)
            t_merge.join(timeout=5)

        assert errors == [], f"Race condition triggered: {errors}"

    def test_validation_uses_lookup_snapshot(self, base_catalog_file):
        """Test that _start_catalog_validation snapshots _lookup under lock.

        Patches CatalogValidator.validate to capture the lookup arg and
        verify it's a copy (different identity) of catalog._lookup.
        """
        from core.catalog_validator import CatalogValidator, CatalogValidationResult

        captured_lookups = []
        original_validate = CatalogValidator.validate

        def spy_validate(self_val, categories, lookup, **kwargs):
            """Intercept validate() to capture the lookup arg."""
            captured_lookups.append(lookup)
            return CatalogValidationResult(error="test-skip")

        catalog = MetricsCatalog(
            catalog_path=base_catalog_file,
            enable_gpu_discovery=False,
        )
        catalog._load_catalog()

        # Patch the validate method on the class itself so the local
        # import inside _validate() still resolves to our spy.
        with patch.object(CatalogValidator, 'validate', spy_validate):
            catalog._prometheus_url = "http://test:9090"
            catalog._catalog_validation_timeout = 30
            catalog._start_catalog_validation()
            catalog._catalog_validation_thread.join(timeout=5)

        assert len(captured_lookups) == 1, (
            f"Expected validate() to be called once, got {len(captured_lookups)} calls"
        )
        # The validator must receive a different dict object (a snapshot),
        # not the same reference as catalog._lookup.
        assert captured_lookups[0] is not catalog._lookup
        # But the contents should match what was in _lookup at snapshot time.
        assert captured_lookups[0] == catalog._lookup


class TestGetCategoryMetricsDetail:
    """Test get_category_metrics_detail method."""

    def test_valid_category(self, temp_catalog_file):
        """Test getting details for a valid category."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        detail = catalog.get_category_metrics_detail("gpu_ai")

        assert detail is not None
        assert detail["id"] == "gpu_ai"
        assert detail["name"] == "GPU & AI Accelerators"
        assert detail["total_metrics"] == 2
        assert "metrics" in detail
        assert len(detail["metrics"]["High"]) == 1
        assert len(detail["metrics"]["Medium"]) == 1

        # Check metric structure includes keywords field
        high_metric = detail["metrics"]["High"][0]
        assert high_metric["name"] == "DCGM_FI_DEV_GPU_TEMP"
        assert high_metric["type"] == "gauge"
        assert high_metric["help"] == "Current GPU temperature"
        assert "keywords" in high_metric
        assert isinstance(high_metric["keywords"], list)

    def test_nonexistent_category(self, temp_catalog_file):
        """Test getting details for a non-existent category returns None."""
        catalog = MetricsCatalog(catalog_path=temp_catalog_file)
        detail = catalog.get_category_metrics_detail("nonexistent_category")
        assert detail is None

    def test_unloaded_catalog(self):
        """Test getting details when catalog is not loadable."""
        catalog = MetricsCatalog(catalog_path=Path("/nonexistent/path.json"))
        detail = catalog.get_category_metrics_detail("gpu_ai")
        assert detail is None

    def test_category_with_keywords(self, tmp_path):
        """Test that keywords from metrics are preserved in detail output."""
        catalog_data = {
            "metadata": {"total_metrics": 1, "categories": 1},
            "categories": [
                {
                    "id": "test_cat",
                    "name": "Test Category",
                    "description": "A test category",
                    "icon": "T",
                    "purpose": "Testing keywords",
                    "metrics": {
                        "High": [
                            {
                                "name": "test_metric",
                                "type": "counter",
                                "help": "Test help text",
                                "keywords": ["test", "keyword", "example"],
                            }
                        ],
                        "Medium": [],
                    },
                }
            ],
            "lookup": {"test_metric": {"category_id": "test_cat", "priority": "High"}},
        }
        catalog_file = tmp_path / "kw-catalog.json"
        with open(catalog_file, "w") as f:
            json.dump(catalog_data, f)

        catalog = MetricsCatalog(catalog_path=catalog_file)
        detail = catalog.get_category_metrics_detail("test_cat")

        assert detail is not None
        assert detail["purpose"] == "Testing keywords"
        metric = detail["metrics"]["High"][0]
        assert metric["keywords"] == ["test", "keyword", "example"]


class TestResetCatalog:
    """Test catalog reset functionality."""

    def test_reset_metrics_catalog(self, temp_catalog_file):
        """Test resetting the global catalog instance."""
        from core.metrics_catalog import reset_metrics_catalog

        # Create instance
        catalog1 = get_metrics_catalog()

        # Reset
        reset_metrics_catalog()

        # Create new instance
        catalog2 = get_metrics_catalog()

        # Should be different instances (but we can't easily test this
        # without modifying global state, so just verify no error)
        assert catalog2 is not None
