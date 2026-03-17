"""
Unit tests for GPU metrics discovery module.

Tests the runtime GPU discovery functionality including:
- GPU vendor detection
- Metric categorization and priority assignment
- Keyword generation
- Discovery result handling
- Async discovery
"""

import os
import pytest
from unittest.mock import Mock, patch, MagicMock

from core.gpu_metrics_discovery import (
    GPUMetricsDiscovery,
    GPUVendor,
    GPUDiscoveryResult,
    discover_gpu_metrics,
)


class TestGPUVendorDetection:
    """Tests for GPU vendor detection from metric names."""

    @pytest.fixture
    def discovery(self):
        return GPUMetricsDiscovery("http://localhost:9090")

    def test_detect_nvidia_vendor(self, discovery):
        """Test NVIDIA vendor detection."""
        assert discovery._detect_vendor("DCGM_FI_DEV_GPU_TEMP") == GPUVendor.NVIDIA
        assert discovery._detect_vendor("DCGM_FI_DEV_GPU_UTIL") == GPUVendor.NVIDIA
        assert discovery._detect_vendor("nvidia_gpu_duty_cycle") == GPUVendor.NVIDIA

    def test_detect_intel_vendor(self, discovery):
        """Test Intel vendor detection."""
        assert discovery._detect_vendor("habanalabs_utilization") == GPUVendor.INTEL
        assert discovery._detect_vendor("habanalabs_temperature_onchip") == GPUVendor.INTEL
        assert discovery._detect_vendor("habanalabs_memory_used_bytes") == GPUVendor.INTEL
        assert discovery._detect_vendor("habana_hl_utilization") == GPUVendor.INTEL
        assert discovery._detect_vendor("xpu_memory_used") == GPUVendor.INTEL
        assert discovery._detect_vendor("intel_gpu_frequency") == GPUVendor.INTEL

    def test_detect_amd_vendor(self, discovery):
        """Test AMD vendor detection."""
        assert discovery._detect_vendor("amdgpu_gpu_busy_percent") == GPUVendor.AMD
        assert discovery._detect_vendor("rocm_smi_temperature") == GPUVendor.AMD

    def test_detect_unknown_vendor(self, discovery):
        """Test unknown vendor for non-vendor-specific metrics."""
        assert discovery._detect_vendor("gpu_temperature") == GPUVendor.UNKNOWN
        assert discovery._detect_vendor("vllm:num_requests") == GPUVendor.UNKNOWN
        assert discovery._detect_vendor("container_cpu_usage") == GPUVendor.UNKNOWN


class TestGPUMetricFiltering:
    """Tests for GPU metric identification."""

    @pytest.fixture
    def discovery(self):
        return GPUMetricsDiscovery("http://localhost:9090")

    def test_is_gpu_metric_nvidia(self, discovery):
        """Test NVIDIA metrics are identified as GPU."""
        assert discovery._is_gpu_metric("DCGM_FI_DEV_GPU_TEMP") is True
        assert discovery._is_gpu_metric("nvidia_gpu_duty_cycle") is True

    def test_is_gpu_metric_intel(self, discovery):
        """Test Intel metrics are identified as GPU."""
        assert discovery._is_gpu_metric("habanalabs_utilization") is True
        assert discovery._is_gpu_metric("habanalabs_memory_used_bytes") is True
        assert discovery._is_gpu_metric("habana_hl_utilization") is True
        assert discovery._is_gpu_metric("xpu_memory_used") is True

    def test_is_gpu_metric_amd(self, discovery):
        """Test AMD metrics are identified as GPU."""
        assert discovery._is_gpu_metric("amdgpu_gpu_busy_percent") is True
        assert discovery._is_gpu_metric("rocm_smi_temperature") is True

    def test_is_gpu_metric_vllm(self, discovery):
        """Test vLLM metrics are identified as GPU/AI."""
        assert discovery._is_gpu_metric("vllm:num_requests_running") is True
        assert discovery._is_gpu_metric("vllm:e2e_request_latency_seconds") is True

    def test_is_gpu_metric_generic_gpu(self, discovery):
        """Test generic gpu_ metrics are identified."""
        assert discovery._is_gpu_metric("gpu_temperature") is True
        assert discovery._is_gpu_metric("gpu_utilization") is True

    def test_is_not_gpu_metric(self, discovery):
        """Test non-GPU metrics are not identified as GPU."""
        assert discovery._is_gpu_metric("container_cpu_usage_seconds_total") is False
        assert discovery._is_gpu_metric("node_memory_MemFree_bytes") is False
        assert discovery._is_gpu_metric("kube_pod_status_phase") is False


class TestPriorityAssignment:
    """Tests for metric priority assignment."""

    @pytest.fixture
    def discovery(self):
        return GPUMetricsDiscovery("http://localhost:9090")

    def test_high_priority_nvidia(self, discovery):
        """Test NVIDIA high priority metrics."""
        assert discovery._is_high_priority("DCGM_FI_DEV_GPU_UTIL") is True
        assert discovery._is_high_priority("DCGM_FI_DEV_GPU_TEMP") is True
        assert discovery._is_high_priority("DCGM_FI_DEV_POWER_USAGE") is True
        assert discovery._is_high_priority("DCGM_FI_DEV_FB_USED") is True

    def test_high_priority_vllm(self, discovery):
        """Test vLLM high priority metrics."""
        assert discovery._is_high_priority("vllm:e2e_request_latency_seconds") is True
        assert discovery._is_high_priority("vllm:num_requests_running") is True
        assert discovery._is_high_priority("vllm:num_requests_waiting") is True

    def test_high_priority_intel(self, discovery):
        """Test Intel Gaudi high priority metrics."""
        assert discovery._is_high_priority("habanalabs_utilization") is True
        assert discovery._is_high_priority("habanalabs_energy") is True
        assert discovery._is_high_priority("habanalabs_power_mW") is True
        assert discovery._is_high_priority("habanalabs_temperature_onboard") is True
        assert discovery._is_high_priority("habanalabs_temperature_onchip") is True
        assert discovery._is_high_priority("habanalabs_memory_used_bytes") is True
        assert discovery._is_high_priority("habanalabs_memory_free_bytes") is True

    def test_medium_priority(self, discovery):
        """Test medium priority metrics (don't match high patterns)."""
        assert discovery._is_high_priority("DCGM_FI_DEV_NVLINK_BANDWIDTH") is False
        assert discovery._is_high_priority("nvidia_gpu_some_other_metric") is False


class TestKeywordGeneration:
    """Tests for keyword generation."""

    @pytest.fixture
    def discovery(self):
        return GPUMetricsDiscovery("http://localhost:9090")

    def test_curated_keywords(self, discovery):
        """Test curated keywords are included."""
        keywords = discovery._generate_keywords(
            "DCGM_FI_DEV_GPU_TEMP",
            "Current GPU temperature",
            GPUVendor.NVIDIA
        )
        assert "gpu temperature" in keywords
        assert "temp" in keywords

    def test_curated_keywords_nvidia_high_priority(self, discovery):
        """Test curated keywords for all NVIDIA high-priority DCGM metrics."""
        keywords = discovery._generate_keywords(
            "DCGM_FI_DEV_MEM_COPY_UTIL",
            "Memory copy utilization",
            GPUVendor.NVIDIA
        )
        assert "memory copy utilization" in keywords
        assert "memory bandwidth" in keywords

        keywords = discovery._generate_keywords(
            "DCGM_FI_DEV_SM_CLOCK",
            "SM clock frequency",
            GPUVendor.NVIDIA
        )
        assert "sm clock" in keywords
        assert "gpu clock" in keywords

        keywords = discovery._generate_keywords(
            "DCGM_FI_DEV_ENC_UTIL",
            "Encoder utilization",
            GPUVendor.NVIDIA
        )
        assert "encoder utilization" in keywords
        assert "nvenc" in keywords

    def test_curated_keywords_nvidia_medium_priority(self, discovery):
        """Test curated keywords for key NVIDIA medium-priority DCGM metrics."""
        keywords = discovery._generate_keywords(
            "DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION",
            "Total energy consumption",
            GPUVendor.NVIDIA
        )
        assert "energy consumption" in keywords
        assert "total energy" in keywords

        keywords = discovery._generate_keywords(
            "DCGM_FI_PROF_PIPE_TENSOR_ACTIVE",
            "Tensor pipe active ratio",
            GPUVendor.NVIDIA
        )
        assert "tensor core active" in keywords
        assert "tensor utilization" in keywords

    def test_curated_keywords_intel(self, discovery):
        """Test curated keywords for Intel Gaudi metrics."""
        keywords = discovery._generate_keywords(
            "habanalabs_utilization",
            "Device utilization",
            GPUVendor.INTEL
        )
        assert "gaudi utilization" in keywords
        assert "hpu utilization" in keywords

        keywords = discovery._generate_keywords(
            "habanalabs_temperature_onchip",
            "Temperature on the ASIC in Celsius",
            GPUVendor.INTEL
        )
        assert "chip temperature" in keywords
        assert "gaudi temp" in keywords

        keywords = discovery._generate_keywords(
            "habanalabs_memory_used_bytes",
            "Current used bytes of memory",
            GPUVendor.INTEL
        )
        assert "gaudi memory" in keywords
        assert "memory usage" in keywords

    def test_vendor_keywords(self, discovery):
        """Test vendor keywords are included."""
        nvidia_keywords = discovery._generate_keywords(
            "DCGM_FI_DEV_GPU_UTIL",
            "GPU utilization",
            GPUVendor.NVIDIA
        )
        assert "nvidia" in nvidia_keywords
        assert "gpu" in nvidia_keywords

        intel_keywords = discovery._generate_keywords(
            "habanalabs_utilization",
            "Device utilization",
            GPUVendor.INTEL
        )
        assert "intel" in intel_keywords
        assert "gaudi" in intel_keywords

    def test_keyword_limit(self, discovery):
        """Test keywords are limited to prevent noise."""
        keywords = discovery._generate_keywords(
            "very_long_metric_name_with_many_parts_to_generate_keywords",
            "A very long help text with many words that could generate keywords",
            GPUVendor.NVIDIA
        )
        assert len(keywords) <= 12


class TestDiscoveryWithMockedRequests:
    """Tests for discovery with mocked HTTP requests."""

    @pytest.fixture
    def discovery(self):
        return GPUMetricsDiscovery("http://localhost:9090")

    def test_discover_nvidia_metrics(self, discovery):
        """Test discovery of NVIDIA metrics."""
        import requests as real_requests

        # Mock metric names response
        mock_names_response = Mock()
        mock_names_response.json.return_value = {
            "status": "success",
            "data": [
                "DCGM_FI_DEV_GPU_TEMP",
                "DCGM_FI_DEV_GPU_UTIL",
                "DCGM_FI_DEV_FB_USED",
                "container_cpu_usage_seconds_total",  # Non-GPU
            ]
        }
        mock_names_response.raise_for_status = Mock()

        # Mock metadata response
        mock_metadata_response = Mock()
        mock_metadata_response.json.return_value = {
            "status": "success",
            "data": {
                "DCGM_FI_DEV_GPU_TEMP": [{"type": "gauge", "help": "GPU temperature"}],
                "DCGM_FI_DEV_GPU_UTIL": [{"type": "gauge", "help": "GPU utilization"}],
                "DCGM_FI_DEV_FB_USED": [{"type": "gauge", "help": "FB memory used"}],
            }
        }
        mock_metadata_response.raise_for_status = Mock()

        with patch.object(real_requests, 'get', side_effect=[mock_names_response, mock_metadata_response]):
            result = discovery.discover()

        assert result.error is None
        assert result.vendor == GPUVendor.NVIDIA
        assert result.total_discovered == 3
        assert len(result.metrics_high) > 0  # GPU_TEMP, GPU_UTIL, FB_USED are all high priority

    def test_discover_no_gpu_metrics(self, discovery):
        """Test discovery when no GPU metrics are found."""
        import requests as real_requests

        mock_response = Mock()
        mock_response.json.return_value = {
            "status": "success",
            "data": [
                "container_cpu_usage_seconds_total",
                "node_memory_MemFree_bytes",
            ]
        }
        mock_response.raise_for_status = Mock()

        with patch.object(real_requests, 'get', return_value=mock_response):
            result = discovery.discover()

        assert result.error is None
        assert result.total_discovered == 0
        assert len(result.metrics_high) == 0
        assert len(result.metrics_medium) == 0

    def test_discover_prometheus_error(self, discovery):
        """Test discovery handles Prometheus errors gracefully."""
        import requests as real_requests

        with patch.object(real_requests, 'get', side_effect=Exception("Connection refused")):
            result = discovery.discover()

        assert result.error is not None
        assert "Connection refused" in result.error
        assert result.total_discovered == 0

    def test_discover_api_error(self, discovery):
        """Test discovery handles API errors gracefully."""
        import requests as real_requests

        mock_response = Mock()
        mock_response.json.return_value = {
            "status": "error",
            "error": "query processing failed"
        }
        mock_response.raise_for_status = Mock()

        with patch.object(real_requests, 'get', return_value=mock_response):
            result = discovery.discover()

        assert result.error is not None


class TestConvenienceFunction:
    """Tests for the convenience function."""

    def test_discover_gpu_metrics_function(self):
        """Test the module-level discover_gpu_metrics function."""
        import requests as real_requests

        mock_response = Mock()
        mock_response.json.return_value = {
            "status": "success",
            "data": ["DCGM_FI_DEV_GPU_TEMP"]
        }
        mock_response.raise_for_status = Mock()

        with patch.object(real_requests, 'get', return_value=mock_response):
            result = discover_gpu_metrics("http://localhost:9090")

        assert isinstance(result, GPUDiscoveryResult)
        assert result.total_discovered == 1


class TestGPUDiscoveryResult:
    """Tests for GPUDiscoveryResult dataclass."""

    def test_result_with_metrics(self):
        """Test result with discovered metrics."""
        result = GPUDiscoveryResult(
            vendor=GPUVendor.NVIDIA,
            metrics_high=[{"name": "DCGM_FI_DEV_GPU_TEMP"}],
            metrics_medium=[{"name": "DCGM_FI_DEV_NVLINK_BANDWIDTH"}],
            total_discovered=2,
            discovery_time_ms=150.5,
            error=None
        )

        assert result.vendor == GPUVendor.NVIDIA
        assert len(result.metrics_high) == 1
        assert len(result.metrics_medium) == 1
        assert result.total_discovered == 2
        assert result.discovery_time_ms == 150.5
        assert result.error is None

    def test_result_with_error(self):
        """Test result with error."""
        result = GPUDiscoveryResult(
            vendor=GPUVendor.UNKNOWN,
            metrics_high=[],
            metrics_medium=[],
            total_discovered=0,
            discovery_time_ms=10.0,
            error="Connection refused"
        )

        assert result.vendor == GPUVendor.UNKNOWN
        assert result.error == "Connection refused"
        assert result.total_discovered == 0


class TestEnvironmentVariableOverrides:
    """Tests for custom GPU metric prefix overrides via environment variables."""

    def test_default_patterns_without_env_vars(self):
        """Verify defaults are used when no env vars are set."""
        # Ensure env vars are not set
        env = {
            k: v for k, v in os.environ.items()
            if k not in (
                "GPU_METRICS_PREFIX_NVIDIA",
                "GPU_METRICS_PREFIX_INTEL",
                "GPU_METRICS_PREFIX_AMD",
            )
        }
        with patch.dict(os.environ, env, clear=True):
            discovery = GPUMetricsDiscovery("http://localhost:9090")

        # Default NVIDIA patterns should work
        assert discovery._detect_vendor("DCGM_FI_DEV_GPU_TEMP") == GPUVendor.NVIDIA
        assert discovery._detect_vendor("nvidia_gpu_duty_cycle") == GPUVendor.NVIDIA
        # Default Intel patterns should work
        assert discovery._detect_vendor("habana_hl_utilization") == GPUVendor.INTEL
        # Default AMD patterns should work
        assert discovery._detect_vendor("amdgpu_gpu_busy_percent") == GPUVendor.AMD

    def test_nvidia_custom_prefix(self):
        """Set GPU_METRICS_PREFIX_NVIDIA and verify it's added and matches metrics."""
        with patch.dict(os.environ, {"GPU_METRICS_PREFIX_NVIDIA": "custom_nv_"}):
            discovery = GPUMetricsDiscovery("http://localhost:9090")

        # Custom prefix should match
        assert discovery._detect_vendor("custom_nv_temperature") == GPUVendor.NVIDIA
        assert discovery._is_gpu_metric("custom_nv_temperature") is True
        # Default patterns should still work
        assert discovery._detect_vendor("DCGM_FI_DEV_GPU_TEMP") == GPUVendor.NVIDIA

    def test_intel_multiple_custom_prefixes(self):
        """Set GPU_METRICS_PREFIX_INTEL with multiple prefixes and verify both are added."""
        with patch.dict(os.environ, {"GPU_METRICS_PREFIX_INTEL": "hl_,gaudi_"}):
            discovery = GPUMetricsDiscovery("http://localhost:9090")

        # Both custom prefixes should match
        assert discovery._detect_vendor("hl_power_usage") == GPUVendor.INTEL
        assert discovery._detect_vendor("gaudi_memory_used") == GPUVendor.INTEL
        assert discovery._is_gpu_metric("hl_power_usage") is True
        assert discovery._is_gpu_metric("gaudi_memory_used") is True
        # Default patterns should still work
        assert discovery._detect_vendor("habana_hl_utilization") == GPUVendor.INTEL

    def test_amd_custom_prefix(self):
        """Set GPU_METRICS_PREFIX_AMD and verify it's added."""
        with patch.dict(os.environ, {"GPU_METRICS_PREFIX_AMD": "my_amd_"}):
            discovery = GPUMetricsDiscovery("http://localhost:9090")

        assert discovery._detect_vendor("my_amd_temperature") == GPUVendor.AMD
        assert discovery._is_gpu_metric("my_amd_temperature") is True
        # Default patterns should still work
        assert discovery._detect_vendor("rocm_smi_temperature") == GPUVendor.AMD

    def test_custom_prefix_with_whitespace(self):
        """Verify trimming works for prefixes with whitespace."""
        with patch.dict(os.environ, {"GPU_METRICS_PREFIX_NVIDIA": " custom_ , other_ "}):
            discovery = GPUMetricsDiscovery("http://localhost:9090")

        assert discovery._detect_vendor("custom_metric") == GPUVendor.NVIDIA
        assert discovery._detect_vendor("other_metric") == GPUVendor.NVIDIA

    def test_empty_env_var_ignored(self):
        """Set env var to empty string and verify no change."""
        with patch.dict(os.environ, {"GPU_METRICS_PREFIX_NVIDIA": ""}):
            discovery = GPUMetricsDiscovery("http://localhost:9090")

        # Should still match defaults
        assert discovery._detect_vendor("DCGM_FI_DEV_GPU_TEMP") == GPUVendor.NVIDIA
        # Non-matching should still be UNKNOWN
        assert discovery._detect_vendor("random_metric") == GPUVendor.UNKNOWN
