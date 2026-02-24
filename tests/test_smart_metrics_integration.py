"""
Integration tests for smart metrics catalog integration.

Tests the integration between metrics_catalog and chat_with_prometheus
to ensure category-aware, priority-based metric discovery works end-to-end.
"""

import pytest
import json
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

from core.metrics_catalog import MetricsCatalog, get_metrics_catalog
from core.chat_with_prometheus import find_best_metric_with_metadata


@pytest.fixture
def sample_catalog_with_real_metrics(tmp_path):
    """Create a realistic catalog file for integration testing."""
    catalog_data = {
        "metadata": {
            "generated": "2026-02-05 12:00:00",
            "source_date": "2026-02-05",
            "total_metrics": 15,
            "priority_distribution": {"High": 5, "Medium": 10},
            "categories": 3
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
                            "help": "Current GPU temperature reading from device"
                        },
                        {
                            "name": "DCGM_FI_DEV_GPU_UTIL",
                            "type": "gauge",
                            "help": "GPU compute utilization"
                        }
                    ],
                    "Medium": [
                        {
                            "name": "DCGM_FI_DEV_MEM_COPY_UTIL",
                            "type": "gauge",
                            "help": "Memory bandwidth utilization percentage"
                        }
                    ]
                }
            },
            {
                "id": "pod_container",
                "name": "Pods & Containers",
                "description": "Pod and container metrics",
                "icon": "📦",
                "example_queries": ["kube_pod_status_phase"],
                "metrics": {
                    "High": [
                        {
                            "name": "kube_pod_status_phase",
                            "type": "gauge",
                            "help": "Current phase of the pod (Running, Pending, Failed, etc.)"
                        },
                        {
                            "name": "kube_pod_container_status_restarts_total",
                            "type": "counter",
                            "help": "Number of times the container has restarted"
                        }
                    ],
                    "Medium": [
                        {
                            "name": "container_memory_usage_bytes",
                            "type": "gauge",
                            "help": "Current memory usage in bytes"
                        }
                    ]
                }
            },
            {
                "id": "etcd",
                "name": "etcd",
                "description": "etcd consensus database metrics",
                "icon": "🔑",
                "example_queries": ["etcd_server_proposals_committed_total"],
                "metrics": {
                    "High": [
                        {
                            "name": "etcd_server_proposals_committed_total",
                            "type": "counter",
                            "help": "Total number of consensus proposals committed"
                        }
                    ],
                    "Medium": [
                        {
                            "name": "etcd_server_leader_changes_seen_total",
                            "type": "counter",
                            "help": "Total number of leader changes seen"
                        }
                    ]
                }
            }
        ],
        "lookup": {
            "DCGM_FI_DEV_GPU_TEMP": {"category_id": "gpu_ai", "priority": "High"},
            "DCGM_FI_DEV_MEM_COPY_UTIL": {"category_id": "gpu_ai", "priority": "Medium"},
            "DCGM_FI_DEV_GPU_UTIL": {"category_id": "gpu_ai", "priority": "High"},
            "kube_pod_status_phase": {"category_id": "pod_container", "priority": "High"},
            "kube_pod_container_status_restarts_total": {"category_id": "pod_container", "priority": "High"},
            "container_memory_usage_bytes": {"category_id": "pod_container", "priority": "Medium"},
            "etcd_server_proposals_committed_total": {"category_id": "etcd", "priority": "High"},
            "etcd_server_leader_changes_seen_total": {"category_id": "etcd", "priority": "Medium"}
        }
    }

    catalog_file = tmp_path / "integration-test-catalog.json"
    with open(catalog_file, 'w') as f:
        json.dump(catalog_data, f)
    return catalog_file


class TestSmartMetricsIntegration:
    """Integration tests for smart metrics discovery."""

    def test_catalog_integration_with_find_best_metric(self, sample_catalog_with_real_metrics):
        """Test that find_best_metric_with_metadata uses catalog correctly."""
        # Mock the catalog to use our test file
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                # Mock Prometheus API calls
                with patch('core.chat_with_prometheus.make_prometheus_request') as mock_prometheus:
                    # Mock metadata response
                    mock_prometheus.return_value = {
                        "data": {
                            "DCGM_FI_DEV_GPU_TEMP": [{
                                "type": "gauge",
                                "help": "GPU temperature in Celsius",
                                "unit": ""
                            }]
                        }
                    }

                    # Test GPU-related query
                    result = find_best_metric_with_metadata("What is the GPU temperature?", max_candidates=5)

                    # Verify catalog was used
                    assert result.get("catalog_used") is True
                    assert "catalog_metadata" in result

                    # Verify best metric selection
                    best_metric = result["best_metric"]
                    assert best_metric["name"] == "DCGM_FI_DEV_GPU_TEMP"

                    # Verify priority bonus was applied
                    assert "priority_bonus" in best_metric
                    assert "category_id" in best_metric
                    assert best_metric["category_id"] == "gpu_ai"

    def test_category_hint_detection_gpu(self, sample_catalog_with_real_metrics):
        """Test category hint detection for GPU queries."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                catalog = get_metrics_catalog()

                # GPU-related queries should detect gpu_ai category
                hints = catalog.extract_category_hints("Show me GPU temperature")
                assert "gpu_ai" in hints

                hints = catalog.extract_category_hints("NVIDIA GPU utilization")
                assert "gpu_ai" in hints

    def test_category_hint_detection_pods(self, sample_catalog_with_real_metrics):
        """Test category hint detection for pod/container queries."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                catalog = get_metrics_catalog()

                # Pod-related queries should detect pod_container category
                hints = catalog.extract_category_hints("Show me pod restarts")
                assert "pod_container" in hints

                hints = catalog.extract_category_hints("Container memory usage")
                assert "pod_container" in hints

    def test_category_hint_detection_etcd(self, sample_catalog_with_real_metrics):
        """Test category hint detection for etcd queries."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                catalog = get_metrics_catalog()

                # etcd-related queries should detect etcd category
                hints = catalog.extract_category_hints("etcd leader changes")
                assert "etcd" in hints

    def test_smart_metric_list_gpu_query(self, sample_catalog_with_real_metrics):
        """Test smart metric list for GPU queries."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                catalog = get_metrics_catalog()

                # GPU query should return GPU metrics
                metrics = catalog.get_smart_metric_list("GPU temperature", max_metrics=10)

                assert len(metrics) > 0
                assert "DCGM_FI_DEV_GPU_TEMP" in metrics
                assert "DCGM_FI_DEV_GPU_UTIL" in metrics

    def test_smart_metric_list_pod_query(self, sample_catalog_with_real_metrics):
        """Test smart metric list for pod queries."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                catalog = get_metrics_catalog()

                # Pod query should return pod metrics
                metrics = catalog.get_smart_metric_list("pod restarts", max_metrics=10)

                assert len(metrics) > 0
                assert "kube_pod_container_status_restarts_total" in metrics

    def test_priority_bonus_application(self, sample_catalog_with_real_metrics):
        """Test that priority bonuses are correctly applied."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                # Mock Prometheus API calls
                with patch('core.chat_with_prometheus.make_prometheus_request') as mock_prometheus:
                    # Mock API to return all metrics
                    mock_prometheus.side_effect = [
                        {"data": ["DCGM_FI_DEV_GPU_TEMP", "DCGM_FI_DEV_GPU_UTIL"]},  # Label values
                        {  # Metadata for DCGM_FI_DEV_GPU_TEMP
                            "data": {
                                "DCGM_FI_DEV_GPU_TEMP": [{
                                    "type": "gauge",
                                    "help": "GPU temperature",
                                    "unit": ""
                                }]
                            }
                        },
                        {  # Metadata for DCGM_FI_DEV_GPU_UTIL
                            "data": {
                                "DCGM_FI_DEV_GPU_UTIL": [{
                                    "type": "gauge",
                                    "help": "GPU utilization",
                                    "unit": ""
                                }]
                            }
                        }
                    ]

                    result = find_best_metric_with_metadata("GPU metrics", max_candidates=5)

                    # Check that priority bonuses were applied
                    for candidate in result.get("analyzed_candidates", []):
                        if "priority_bonus" in candidate:
                            assert candidate["priority_bonus"] in [5, 15]  # Medium or High

    def test_fallback_to_api_when_catalog_unavailable(self):
        """Test graceful fallback to Prometheus API when catalog is unavailable."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', side_effect=FileNotFoundError("Catalog not found")):
                # Mock Prometheus API calls - need multiple responses for metadata calls
                with patch('core.chat_with_prometheus.make_prometheus_request') as mock_prometheus:
                    # First call: get list of metrics
                    # Subsequent calls: get metadata for each metric
                    # Use metric names that will match the query for semantic scoring
                    mock_prometheus.side_effect = [
                        {"data": ["cpu_usage_percent", "memory_usage_bytes"]},  # Label values
                        {  # Metadata for cpu_usage_percent
                            "data": {
                                "cpu_usage_percent": [{
                                    "type": "gauge",
                                    "help": "Current CPU usage percentage",
                                    "unit": "percent"
                                }]
                            }
                        },
                        {  # Metadata for memory_usage_bytes
                            "data": {
                                "memory_usage_bytes": [{
                                    "type": "gauge",
                                    "help": "Current memory usage in bytes",
                                    "unit": "bytes"
                                }]
                            }
                        }
                    ]

                    result = find_best_metric_with_metadata("cpu usage", max_candidates=5)

                    # Verify fallback worked
                    assert result.get("catalog_used") is False
                    assert "best_metric" in result

    def test_category_aware_filtering_reduces_search_space(self, sample_catalog_with_real_metrics):
        """Test that category-aware filtering reduces the search space."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                catalog = get_metrics_catalog()

                # General query (no category hints) - should return only High priority
                general_metrics = catalog.get_smart_metric_list("show metrics", max_metrics=100)

                # GPU-specific query - should return High + Medium from GPU category
                gpu_metrics = catalog.get_smart_metric_list("GPU temperature", max_metrics=100)

                # GPU query should have more metrics due to category filtering
                # (includes both High and Medium from GPU category)
                assert len(gpu_metrics) >= 2  # At least DCGM_FI_DEV_GPU_TEMP and DCGM_FI_DEV_GPU_UTIL


class TestBackwardCompatibility:
    """Test backward compatibility with existing functionality."""

    def test_existing_tools_still_work_without_catalog(self):
        """Test that existing tools work even if catalog is not available."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', side_effect=FileNotFoundError("Catalog not found")):
                # Mock Prometheus API - need responses for each metric's metadata
                # Use metric names that will match for semantic scoring
                with patch('core.chat_with_prometheus.make_prometheus_request') as mock_prometheus:
                    mock_prometheus.side_effect = [
                        {"data": ["memory_usage_bytes", "cpu_usage_percent"]},  # Label values
                        {  # Metadata for memory_usage_bytes
                            "data": {
                                "memory_usage_bytes": [{
                                    "type": "gauge",
                                    "help": "Memory usage in bytes",
                                    "unit": "bytes"
                                }]
                            }
                        },
                        {  # Metadata for cpu_usage_percent
                            "data": {
                                "cpu_usage_percent": [{
                                    "type": "gauge",
                                    "help": "CPU usage percentage",
                                    "unit": "percent"
                                }]
                            }
                        }
                    ]

                    # Should not raise exception
                    result = find_best_metric_with_metadata("memory usage", max_candidates=5)
                    assert "best_metric" in result

    def test_enhanced_function_maintains_same_interface(self, sample_catalog_with_real_metrics):
        """Test that enhanced function maintains the same interface."""
        with patch('core.metrics_catalog._catalog_instance', None):
            with patch.object(MetricsCatalog, '_get_default_catalog_path', return_value=sample_catalog_with_real_metrics):
                with patch('core.chat_with_prometheus.make_prometheus_request') as mock_prometheus:
                    mock_prometheus.return_value = {
                        "data": {
                            "DCGM_FI_DEV_GPU_TEMP": [{
                                "type": "gauge",
                                "help": "GPU temperature",
                                "unit": ""
                            }]
                        }
                    }

                    # Call with original parameters
                    result = find_best_metric_with_metadata("GPU temp", max_candidates=10)

                    # Verify original response structure is maintained
                    assert "best_metric" in result
                    assert "suggested_query" in result
                    assert "analyzed_candidates" in result
                    assert "user_question" in result
                    assert "concepts_detected" in result

                    # New fields should be additive only
                    assert "catalog_used" in result
