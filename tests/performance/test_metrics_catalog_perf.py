"""
Performance tests for metrics catalog.

Validates that the metrics catalog meets performance requirements:
- Loading time: < 25ms (cold start)
- Cached access: < 0.1ms
- Filtering time: < 10ms
- Memory footprint: < 10MB
"""

import pytest
import time
import sys
import json
from pathlib import Path

from core.metrics_catalog import MetricsCatalog, get_metrics_catalog


@pytest.fixture
def real_catalog_file():
    """Get path to real optimized metrics catalog."""
    # Try to find the real catalog file
    potential_paths = [
        Path("src/mcp_server/data/openshift-metrics-optimized.json"),
        Path("../src/mcp_server/data/openshift-metrics-optimized.json"),
    ]

    for path in potential_paths:
        if path.exists():
            return path

    pytest.skip("Real metrics catalog file not found")


class TestCatalogLoadingPerformance:
    """Test catalog loading performance."""

    def test_cold_start_load_time(self, real_catalog_file):
        """Test that cold start loading takes < 25ms."""
        # Create new catalog instance (cold start)
        catalog = MetricsCatalog(catalog_path=real_catalog_file)

        # Measure load time
        start_time = time.perf_counter()
        success = catalog._load_catalog()
        load_time = (time.perf_counter() - start_time) * 1000  # Convert to ms

        assert success, "Catalog should load successfully"
        assert load_time < 25, f"Cold start load time should be < 25ms, got {load_time:.2f}ms"

        print(f"\n✅ Cold start load time: {load_time:.2f}ms (target: < 25ms)")

    def test_cached_access_time(self, real_catalog_file):
        """Test that cached access takes < 0.1ms."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)

        # First load
        catalog._load_catalog()

        # Measure cached access time
        start_time = time.perf_counter()
        success = catalog._load_catalog()
        access_time = (time.perf_counter() - start_time) * 1000  # Convert to ms

        assert success, "Cached access should succeed"
        assert access_time < 0.1, f"Cached access should be < 0.1ms, got {access_time:.2f}ms"

        print(f"\n✅ Cached access time: {access_time:.4f}ms (target: < 0.1ms)")

    def test_metadata_access_time(self, real_catalog_file):
        """Test that metadata access is fast."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        # Measure metadata access time
        start_time = time.perf_counter()
        metadata = catalog.get_metadata()
        access_time = (time.perf_counter() - start_time) * 1000  # Convert to ms

        assert metadata is not None
        assert access_time < 1, f"Metadata access should be < 1ms, got {access_time:.2f}ms"

        print(f"\n✅ Metadata access time: {access_time:.4f}ms (target: < 1ms)")


class TestCatalogFilteringPerformance:
    """Test catalog filtering performance."""

    def test_category_search_time(self, real_catalog_file):
        """Test that category search takes < 10ms."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        # Measure category search time
        start_time = time.perf_counter()
        metrics = catalog.search_metrics_by_category(
            category_ids=["gpu_ai"],
            priorities=["High", "Medium"]
        )
        search_time = (time.perf_counter() - start_time) * 1000  # Convert to ms

        assert len(metrics) > 0, "Should find GPU metrics"
        assert search_time < 10, f"Category search should be < 10ms, got {search_time:.2f}ms"

        print(f"\n✅ Category search time: {search_time:.2f}ms (target: < 10ms)")
        print(f"   Found {len(metrics)} metrics")

    def test_priority_filtering_time(self, real_catalog_file):
        """Test that priority filtering takes < 10ms."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        # Measure priority filtering time
        start_time = time.perf_counter()
        metrics = catalog.search_metrics_by_category(
            category_ids=None,
            priorities=["High"]
        )
        filter_time = (time.perf_counter() - start_time) * 1000  # Convert to ms

        assert len(metrics) > 0, "Should find High priority metrics"
        assert filter_time < 10, f"Priority filtering should be < 10ms, got {filter_time:.2f}ms"

        print(f"\n✅ Priority filtering time: {filter_time:.2f}ms (target: < 10ms)")
        print(f"   Found {len(metrics)} High priority metrics")

    def test_smart_metric_list_time(self, real_catalog_file):
        """Test that smart metric list generation takes < 50ms."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        # Measure smart metric list time
        start_time = time.perf_counter()
        metrics = catalog.get_smart_metric_list("GPU temperature", max_metrics=100)
        list_time = (time.perf_counter() - start_time) * 1000  # Convert to ms

        assert len(metrics) > 0, "Should find GPU-related metrics"
        assert list_time < 50, f"Smart metric list should be < 50ms, got {list_time:.2f}ms"

        print(f"\n✅ Smart metric list time: {list_time:.2f}ms (target: < 50ms)")
        print(f"   Found {len(metrics)} relevant metrics")

    def test_get_all_categories_time(self, real_catalog_file):
        """Test that getting all categories takes < 5ms."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        # Measure get all categories time
        start_time = time.perf_counter()
        categories = catalog.get_all_categories()
        get_time = (time.perf_counter() - start_time) * 1000  # Convert to ms

        assert len(categories) > 0, "Should have categories"
        assert get_time < 5, f"Get all categories should be < 5ms, got {get_time:.2f}ms"

        print(f"\n✅ Get all categories time: {get_time:.2f}ms (target: < 5ms)")
        print(f"   Found {len(categories)} categories")


class TestCatalogMemoryFootprint:
    """Test catalog memory footprint."""

    def test_memory_usage(self, real_catalog_file):
        """Test that catalog memory usage is < 10MB."""
        import tracemalloc

        # Start tracing memory
        tracemalloc.start()

        # Create and load catalog
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        # Get memory usage
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        # Convert to MB
        current_mb = current / 1024 / 1024
        peak_mb = peak / 1024 / 1024

        assert peak_mb < 10, f"Memory usage should be < 10MB, got {peak_mb:.2f}MB"

        print(f"\n✅ Memory usage: {current_mb:.2f}MB current, {peak_mb:.2f}MB peak (target: < 10MB)")

    def test_file_size(self, real_catalog_file):
        """Test that catalog file size is reasonable."""
        file_size = real_catalog_file.stat().st_size
        file_size_kb = file_size / 1024

        assert file_size_kb < 2000, f"File size should be < 2MB, got {file_size_kb:.2f}KB"

        print(f"\n✅ Catalog file size: {file_size_kb:.2f}KB (target: < 2MB)")


class TestCatalogScalability:
    """Test catalog scalability with large queries."""

    def test_large_category_search(self, real_catalog_file):
        """Test searching multiple categories simultaneously."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        # Get all category IDs
        categories = catalog.get_all_categories()
        category_ids = [cat.id for cat in categories[:5]]  # Test with 5 categories

        # Measure search time
        start_time = time.perf_counter()
        metrics = catalog.search_metrics_by_category(
            category_ids=category_ids,
            priorities=["High", "Medium"]
        )
        search_time = (time.perf_counter() - start_time) * 1000  # Convert to ms

        assert len(metrics) > 0, "Should find metrics"
        assert search_time < 20, f"Multi-category search should be < 20ms, got {search_time:.2f}ms"

        print(f"\n✅ Multi-category search ({len(category_ids)} categories): {search_time:.2f}ms (target: < 20ms)")
        print(f"   Found {len(metrics)} metrics")

    def test_repeated_queries_performance(self, real_catalog_file):
        """Test performance of repeated queries (simulating real usage)."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        queries = [
            "GPU temperature",
            "pod restarts",
            "etcd latency",
            "cluster capacity",
            "network bandwidth"
        ]

        total_time = 0
        for query in queries:
            start_time = time.perf_counter()
            metrics = catalog.get_smart_metric_list(query, max_metrics=50)
            query_time = (time.perf_counter() - start_time) * 1000
            total_time += query_time

        avg_time = total_time / len(queries)

        assert avg_time < 30, f"Average query time should be < 30ms, got {avg_time:.2f}ms"

        print(f"\n✅ Average query time ({len(queries)} queries): {avg_time:.2f}ms (target: < 30ms)")
        print(f"   Total time: {total_time:.2f}ms")


class TestPerformanceComparison:
    """Test performance improvements vs. dynamic discovery."""

    def test_catalog_vs_dynamic_discovery_simulation(self, real_catalog_file):
        """Simulate performance comparison between catalog and dynamic discovery."""
        catalog = MetricsCatalog(catalog_path=real_catalog_file)
        catalog._load_catalog()

        # Simulate catalog-based search
        start_catalog = time.perf_counter()
        catalog_metrics = catalog.get_smart_metric_list("GPU temperature", max_metrics=30)
        catalog_time = (time.perf_counter() - start_catalog) * 1000

        # Simulate dynamic discovery (would need to make API calls for each metric)
        # Assume 3.7 seconds for 3680 metrics (as per plan)
        estimated_dynamic_time = 3700  # ms

        # Calculate improvement
        improvement = ((estimated_dynamic_time - catalog_time) / estimated_dynamic_time) * 100

        print(f"\n📊 Performance Comparison:")
        print(f"   Catalog-based: {catalog_time:.2f}ms")
        print(f"   Dynamic (estimated): {estimated_dynamic_time:.2f}ms")
        print(f"   Improvement: {improvement:.1f}%")
        print(f"   Speedup: {estimated_dynamic_time / catalog_time:.1f}x faster")

        assert improvement > 50, f"Should be at least 50% faster, got {improvement:.1f}%"


def run_performance_suite():
    """Run complete performance test suite and print summary."""
    print("\n" + "=" * 70)
    print("🚀 Metrics Catalog Performance Test Suite")
    print("=" * 70)

    pytest.main([__file__, "-v", "-s"])


if __name__ == "__main__":
    run_performance_suite()
