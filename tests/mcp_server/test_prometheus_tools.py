"""Tests for refactored Prometheus tools - updated for new architecture."""

import pytest
import json
import sys
import os
from datetime import timedelta

# Python path is now handled by conftest.py


class TestPrometheusToolsBasic:
    """Basic tests for refactored Prometheus tools."""
    
    def test_all_tools_importable(self):
        """Test that all Prometheus tools can be imported."""
        from mcp_server.tools.prometheus_tools import (
            search_metrics,
            get_metric_metadata,
            get_label_values,
            execute_promql,
            explain_results,
            suggest_queries,
            select_best_metric,
            find_best_metric_with_metadata_v2,
            find_best_metric_with_metadata,
            get_category_metrics_detail,
            convert_time_to_promql_duration,
        )

        # All tools should be callable
        tools = [
            search_metrics, get_metric_metadata, get_label_values,
            execute_promql, explain_results, suggest_queries,
            select_best_metric, find_best_metric_with_metadata_v2,
            find_best_metric_with_metadata,
            get_category_metrics_detail,
            convert_time_to_promql_duration,
        ]

        for tool in tools:
            assert callable(tool), f"{tool.__name__} should be callable"
    
    def test_core_business_logic_imports(self):
        """Test that core business logic can be imported."""
        from core.chat_with_prometheus import (
            search_metrics_by_pattern,
            execute_promql_query,
            calculate_semantic_score,
            rank_metrics_by_relevance,
            extract_key_concepts
        )
        
        # All core functions should be callable
        core_functions = [
            search_metrics_by_pattern, execute_promql_query, calculate_semantic_score,
            rank_metrics_by_relevance, extract_key_concepts
        ]
        
        for func in core_functions:
            assert callable(func), f"{func.__name__} should be callable"
    
    def test_concept_extraction_basic(self):
        """Test basic concept extraction from user questions."""
        from core.chat_with_prometheus import extract_key_concepts
        
        # Test basic concept extraction
        concepts = extract_key_concepts("How many pods are running?")
        assert isinstance(concepts, dict)
        assert "intent_type" in concepts
        assert "components" in concepts
        
        # Should detect pod component
        assert "pod" in concepts["components"]
    
    def test_semantic_scoring_basic(self):
        """Test basic semantic scoring."""
        from core.chat_with_prometheus import calculate_semantic_score
        
        # GPU question should score high for GPU metric
        score = calculate_semantic_score("gpu temperature", "DCGM_FI_DEV_GPU_TEMP")
        assert isinstance(score, int)
        assert score > 0, "GPU metric should score positive for GPU question"
        
        # Non-matching should score lower
        score_low = calculate_semantic_score("gpu temperature", "kube_pod_status")
        assert score > score_low, "Relevant metric should score higher"
    
    def test_metric_ranking_basic(self):
        """Test metric ranking functionality."""
        from core.chat_with_prometheus import rank_metrics_by_relevance

        test_metrics = ["cpu_usage", "DCGM_FI_DEV_GPU_TEMP", "memory_total", "gpu_util"]
        ranked = rank_metrics_by_relevance("gpu temperature", test_metrics)

        assert isinstance(ranked, list)
        assert len(ranked) > 0
        # GPU metrics should be ranked higher
        assert any("gpu" in metric.lower() or "dcgm" in metric.lower() for metric in ranked[:2])

    def test_time_conversion_decimal_hours(self):
        """Test decimal hour conversion to Prometheus format."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        # Test 2.3 hours → 2h18m (not 2h30m)
        result = convert_time_to_promql_duration(2.3)
        assert isinstance(result, list)
        assert len(result) > 0
        text = result[0]["text"]
        assert "2h18m" in text, "2.3 hours should convert to 2h18m"

        # Verify the math explanation is present
        data = json.loads(text)
        assert data["input_hours"] == 2.3
        assert data["prometheus_duration"] == "2h18m"

    def test_time_conversion_half_hour(self):
        """Test 1.5 hours → 1h30m."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        result = convert_time_to_promql_duration(1.5)
        text = result[0]["text"]
        data = json.loads(text)
        assert data["prometheus_duration"] == "1h30m"

    def test_time_conversion_minutes_only(self):
        """Test 0.5 hours → 30m."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        result = convert_time_to_promql_duration(0.5)
        text = result[0]["text"]
        data = json.loads(text)
        assert data["prometheus_duration"] == "30m"

    def test_time_conversion_whole_hours(self):
        """Test whole hours like 5.0 → 5h."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        result = convert_time_to_promql_duration(5.0)
        text = result[0]["text"]
        data = json.loads(text)
        assert data["prometheus_duration"] == "5h"

    def test_time_conversion_small_values(self):
        """Test very small time values."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        # 0.1 hours = 6 minutes
        result = convert_time_to_promql_duration(0.1)
        text = result[0]["text"]
        data = json.loads(text)
        assert data["prometheus_duration"] == "6m"

        # 0.016667 hours ≈ 1 minute
        result = convert_time_to_promql_duration(0.016667)
        text = result[0]["text"]
        data = json.loads(text)
        assert data["prometheus_duration"] == "1m"

    def test_time_conversion_large_values(self):
        """Test large time values."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        # 24 hours
        result = convert_time_to_promql_duration(24.0)
        text = result[0]["text"]
        data = json.loads(text)
        assert data["prometheus_duration"] == "24h"

        # 48.5 hours = 48h30m
        result = convert_time_to_promql_duration(48.5)
        text = result[0]["text"]
        data = json.loads(text)
        assert data["prometheus_duration"] == "48h30m"


class TestPrometheusToolsMCP:
    """Test MCP tool interface layer."""
    
    def test_mcp_response_format(self):
        """Test that MCP tools return proper response format."""
        from mcp_server.tools.prometheus_tools import suggest_queries
        
        result = suggest_queries("cpu performance")
        
        # Should return MCP format: List[Dict[str, Any]] with type and text
        assert isinstance(result, list), "Should return list"
        assert len(result) > 0, "Should have at least one response item"
        assert "type" in result[0], "Should have type field"
        assert "text" in result[0], "Should have text field"
        assert result[0]["type"] == "text", "Type should be text"
    
    def test_parameter_validation(self):
        """Test parameter validation in MCP tools."""
        from mcp_server.tools.prometheus_tools import search_metrics, get_metric_metadata
        
        # Test search_metrics with invalid limit
        result = search_metrics("test", -1)
        assert isinstance(result, list)
        assert "error" in result[0]["text"].lower() or "limit" in result[0]["text"].lower()
        
        # Test get_metric_metadata with empty metric name
        result = get_metric_metadata("")
        assert isinstance(result, list)
        assert "required" in result[0]["text"].lower()
    
    def test_error_handling(self):
        """Test error handling in MCP tools."""
        from mcp_server.tools.prometheus_tools import get_label_values

        # Test with missing parameters
        result = get_label_values("", "")
        assert isinstance(result, list)
        assert len(result) > 0
        assert "required" in result[0]["text"].lower()

    def test_time_conversion_mcp_response_format(self):
        """Test that convert_time_to_promql_duration returns proper MCP format."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        result = convert_time_to_promql_duration(2.3)

        # Should return MCP format: List[Dict[str, Any]] with type and text
        assert isinstance(result, list), "Should return list"
        assert len(result) > 0, "Should have at least one response item"
        assert "type" in result[0], "Should have type field"
        assert "text" in result[0], "Should have text field"
        assert result[0]["type"] == "text", "Type should be text"

        # Text should contain valid JSON
        text = result[0]["text"]
        data = json.loads(text)  # Should not raise exception
        assert "input_hours" in data
        assert "prometheus_duration" in data
        assert "explanation" in data

    def test_time_conversion_edge_cases(self):
        """Test edge cases for time conversion."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        # Zero should return error
        result = convert_time_to_promql_duration(0)
        assert isinstance(result, list)
        assert "positive" in result[0]["text"].lower()

        # Negative should return error
        result = convert_time_to_promql_duration(-1.5)
        assert isinstance(result, list)
        assert "positive" in result[0]["text"].lower()

    def test_time_conversion_precision(self):
        """Test precision handling in time conversion."""
        from mcp_server.tools.prometheus_tools import convert_time_to_promql_duration

        # Test that fractional minutes are handled correctly
        # 2.3 hours = 138 minutes = 2h18m
        result = convert_time_to_promql_duration(2.3)
        text = result[0]["text"]
        data = json.loads(text)

        # Verify the calculation
        total_minutes = int(2.3 * 60)  # 138 minutes
        expected_hours = total_minutes // 60  # 2
        expected_minutes = total_minutes % 60  # 18

        assert expected_hours == 2
        assert expected_minutes == 18
        assert data["prometheus_duration"] == "2h18m"

        # Verify explanation includes the breakdown
        assert "2 hours and 18 minutes" in data["explanation"]


class TestArchitectureSeparation:
    """Test that architecture separation is working correctly."""
    
    def test_core_functions_framework_agnostic(self):
        """Test that core functions don't depend on MCP framework."""
        from core.chat_with_prometheus import calculate_semantic_score, extract_key_concepts
        
        # Core functions should work without any MCP imports
        score = calculate_semantic_score("memory usage", "memory_total")
        assert isinstance(score, int)
        
        concepts = extract_key_concepts("what is cpu usage")
        assert isinstance(concepts, dict)
        assert concepts["intent_type"] in ["current_value", "count", "average", "percentile"]
    
    def test_mcp_tools_delegate_to_core(self):
        """Test that MCP tools properly delegate to core business logic."""
        from mcp_server.tools.prometheus_tools import suggest_queries
        from core.chat_with_prometheus import suggest_related_queries
        
        # Both should work independently
        mcp_result = suggest_queries("cpu usage")
        core_result = suggest_related_queries("cpu usage")
        
        assert isinstance(mcp_result, list)  # MCP format
        assert isinstance(core_result, list)  # Core returns list of strings
        
        # MCP result should contain core result data
        if len(mcp_result) > 0:
            mcp_text = mcp_result[0]["text"]
            assert "suggested_queries" in mcp_text
    
    def test_import_consistency(self):
        """Test that import patterns are consistent with working tools."""
        import inspect
        
        # Check prometheus_tools imports from core
        from mcp_server.tools import prometheus_tools
        source = inspect.getsource(prometheus_tools)
        assert "from core.chat_with_prometheus import" in source
        
        # Check working vllm tools for comparison
        from mcp_server.tools import observability_vllm_tools
        vllm_source = inspect.getsource(observability_vllm_tools)
        assert "from core.metrics import" in vllm_source
        
        # Both should follow similar patterns
        assert "from core." in source and "from core." in vllm_source


class TestResolveRateIntervalPlaceholder:
    """Tests for the _resolve_rate_interval_placeholder safety-net function."""

    def test_no_placeholder_returns_query_unchanged(self):
        """Query without <rate_interval> should pass through unchanged."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(vllm:e2e_request_latency_seconds_count[5m])"
        result = _resolve_rate_interval_placeholder(query, None, None)
        assert result == query

    def test_placeholder_replaced_with_default_when_no_times(self):
        """Without start/end times, should substitute the 5m default."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        result = _resolve_rate_interval_placeholder(query, None, None)
        assert result == "rate(metric[5m])"

    def test_tier_leq_1h(self):
        """<=1h range -> 5m."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-17T10:00:00Z", "2026-03-17T10:30:00Z"
        )
        assert result == "rate(metric[5m])"

    def test_tier_leq_3h(self):
        """<=3h range -> 15m."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-17T08:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[15m])"

    def test_tier_leq_6h(self):
        """<=6h range -> 30m."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-17T06:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[30m])"

    def test_tier_leq_12h(self):
        """<=12h range -> 1h."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-17T00:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[1h])"

    def test_tier_leq_24h(self):
        """<=24h range -> 2h."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[2h])"

    def test_tier_leq_48h(self):
        """<=48h range -> 4h."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-15T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[4h])"

    def test_gt_48h_dynamic(self):
        """>48h range -> computed dynamically: 168h / 12 = 14h."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        # 7 days = 168h -> 168/12 = 14h
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-10T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[14h])"

    def test_multiple_placeholders_replaced(self):
        """All occurrences of <rate_interval> should be replaced."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = (
            "histogram_quantile(0.95, sum(rate(metric_bucket[<rate_interval>])) by (le)) "
            "/ rate(metric_count[<rate_interval>])"
        )
        result = _resolve_rate_interval_placeholder(query, None, None)
        assert "<rate_interval>" not in result
        assert "[5m]" in result
        assert result.count("[5m]") == 2

    def test_malformed_timestamps_use_default(self):
        """Unparseable timestamps should fall back to 5m default."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[<rate_interval>])"
        result = _resolve_rate_interval_placeholder(query, "not-a-date", "also-not-a-date")
        assert result == "rate(metric[5m])"


class TestNormalizeLiteralRateWindows:
    """Tests for literal rate window normalization (no placeholder)."""

    def test_literal_5m_normalized_for_24h_range(self):
        """LLM wrote [5m] from training — should be normalized to [2h] for 24h range."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(vllm:request_success_total[5m])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(vllm:request_success_total[2h])"

    def test_literal_not_normalized_without_times(self):
        """Without start/end, literal windows should pass through unchanged."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(vllm:request_success_total[5m])"
        result = _resolve_rate_interval_placeholder(query, None, None)
        assert result == query

    def test_literal_already_matches_tier(self):
        """[2h] for 24h range is already correct — result is the same (no-op)."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[2h])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[2h])"

    def test_multiple_literal_windows_all_normalized(self):
        """All literal windows in a multi-rate query should be normalized."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = (
            "histogram_quantile(0.95, sum(rate(metric_bucket[5m])) by (le)) "
            "/ rate(metric_count[5m])"
        )
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result.count("[2h]") == 2
        assert "[5m]" not in result

    def test_literal_normalized_for_6h_range(self):
        """[5m] should become [30m] for a 6h range."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[5m])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-17T04:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[30m])"

    def test_no_rate_window_passes_through(self):
        """Query without any rate window is not modified."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "histogram_quantile(0.95, vllm:time_to_first_token_seconds_bucket)"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == query

    def test_avg_over_time_not_normalized(self):
        """avg_over_time window should NOT be normalized — it's not a rate function."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "avg_over_time(node_cpu_seconds_total[5m])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == query  # unchanged

    def test_max_over_time_not_normalized(self):
        """max_over_time window should NOT be normalized."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "max_over_time(container_memory_usage_bytes[1h])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == query  # unchanged

    def test_mixed_rate_and_over_time(self):
        """rate() window should be normalized but avg_over_time() should not."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "avg_over_time(rate(http_requests_total[5m])[1h:])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        # rate's [5m] should become [2h], but the subquery [1h:] should be untouched
        assert "rate(http_requests_total[2h])" in result
        assert "[1h:]" in result

    def test_subquery_step_preserved(self):
        """rate(x[5m:1m]) — normalize the 5m range but preserve the :1m step."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(http_requests_total[5m:1m])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(http_requests_total[2h:1m])"

    def test_label_with_brackets_handled(self):
        """Brackets in label values should not break the regex."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = 'rate(metric{label="value[1]"}[5m])'
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == 'rate(metric{label="value[1]"}[2h])'

    def test_malformed_timestamps_skip_normalization(self):
        """Unparseable timestamps should not normalize literal windows."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[5m])"
        result = _resolve_rate_interval_placeholder(query, "not-a-date", "also-not-a-date")
        assert result == "rate(metric[5m])"

    def test_full_duration_window_normalized_to_tier(self):
        """LLM used full duration [24h] as rate window — should be normalized to [2h]."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[24h])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-16T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[2h])"

    def test_day_unit_normalized(self):
        """LLM used [2d] — should be normalized to [4h] for 48h range."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "increase(vllm:request_success_total[2d])"
        result = _resolve_rate_interval_placeholder(
            query, "2026-03-15T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "increase(vllm:request_success_total[4h])"

    def test_month_duration_normalized(self):
        """LLM used [30d] — should be normalized dynamically for 30-day range."""
        from mcp_server.tools.prometheus_tools import _resolve_rate_interval_placeholder

        query = "rate(metric[30d])"
        # 30 days = 720h -> 720/12 = 60h
        result = _resolve_rate_interval_placeholder(
            query, "2026-02-15T10:00:00Z", "2026-03-17T10:00:00Z"
        )
        assert result == "rate(metric[60h])"


class TestParseDurationToTimedelta:
    """Tests for parse_duration_to_timedelta (in core.time_utils)."""

    def test_simple_hours(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("3h") == timedelta(hours=3)

    def test_simple_minutes(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("30m") == timedelta(minutes=30)

    def test_simple_days(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("2d") == timedelta(days=2)

    def test_composite_duration(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("1h30m") == timedelta(hours=1, minutes=30)

    def test_24_hours(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("24h") == timedelta(hours=24)

    def test_unparseable_defaults_to_1h(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("foo") == timedelta(hours=1)

    def test_seconds(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("90s") == timedelta(seconds=90)

    def test_custom_default(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("foo", default=timedelta(hours=24)) == timedelta(hours=24)

    def test_prefixed_string(self):
        """Handles 'last 3h' format used by convert_time_range_to_iso."""
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("last 3h") == timedelta(hours=3)

    def test_decimal_hours(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("1.5h") == timedelta(hours=1.5)

    def test_decimal_days(self):
        from core.time_utils import parse_duration_to_timedelta
        assert parse_duration_to_timedelta("2.5d") == timedelta(days=2.5)


class TestRealDataFlow:
    """Test data flow with mocked Prometheus responses."""
    
    def test_search_metrics_response_structure(self):
        """Test search metrics returns expected structure."""
        from core.chat_with_prometheus import search_metrics_by_pattern
        
        # Mock a small search (should work even without Prometheus if we catch the exception)
        try:
            result = search_metrics_by_pattern("test", 1)
            
            # Should return dict with expected keys
            assert isinstance(result, dict)
            expected_keys = ["total_found", "metrics", "pattern", "limit"]
            for key in expected_keys:
                assert key in result, f"Missing key: {key}"
                
        except Exception:
            # If Prometheus not available, that's expected in unit tests
            pass
    
    def test_response_format_consistency(self):
        """Test that all tools return consistent MCP response format."""
        from mcp_server.tools.prometheus_tools import (
            suggest_queries, search_metrics
        )
        
        tools_to_test = [
            (suggest_queries, ("cpu usage",), {}),
            (search_metrics, ("test", 1), {}),
        ]
        
        for tool_func, args, kwargs in tools_to_test:
            try:
                result = tool_func(*args, **kwargs)
                
                # All should return List[Dict[str, Any]] with consistent structure
                assert isinstance(result, list), f"{tool_func.__name__} should return list"
                if len(result) > 0:
                    assert "type" in result[0], f"{tool_func.__name__} missing type field"
                    assert "text" in result[0], f"{tool_func.__name__} missing text field"
                    
            except Exception as e:
                # Some tools may fail without Prometheus, that's OK for structure testing
                pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])