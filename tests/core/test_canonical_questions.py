"""Tests for canonical question set support (Item 1).

Parametrized tests covering:
- extract_key_concepts() with new intent types
- extract_category_hints() with vLLM keywords
- generate_metadata_driven_promql() with new intents
- calculate_semantic_score() with vLLM patterns
"""

import pytest

from core.chat_with_prometheus import (
    extract_key_concepts,
    generate_metadata_driven_promql,
    calculate_semantic_score,
)
from core.metrics_catalog import MetricsCatalog


# =============================================================================
# extract_key_concepts — new intent types
# =============================================================================

class TestExtractKeyConcepts:
    """Test extract_key_concepts with new intent types and measurement patterns."""

    @pytest.mark.parametrize("question,expected_intent", [
        ("Show me the top 5 GPU consumers", "top_n"),
        ("Which pods have the highest memory usage?", "top_n"),
        ("What are the busiest nodes?", "top_n"),
        ("Compare latency across models", "comparison"),
        ("Model A vs Model B throughput", "comparison"),
        ("How has GPU utilization changed over time?", "trend"),
        ("Is latency increasing?", "trend"),
        ("Show trend of memory usage", "trend"),
        ("What is the token throughput rate?", "rate"),
        ("Show me tokens per second", "rate"),
        ("What is the request rate?", "rate"),
        ("What is the p95 latency?", "percentile"),
        ("How many pods are running?", "count"),
        ("What is the average CPU usage?", "average"),
        ("What is the current GPU temperature?", "current_value"),
    ])
    def test_intent_detection(self, question, expected_intent):
        """Test that new intent types are correctly detected."""
        concepts = extract_key_concepts(question)
        assert concepts["intent_type"] == expected_intent, (
            f"Question '{question}' should have intent '{expected_intent}', "
            f"got '{concepts['intent_type']}'"
        )

    @pytest.mark.parametrize("question,expected_measurement", [
        ("What is the TTFT?", "ttft"),
        ("Show me time to first token", "ttft"),
        ("What is the TPOT?", "tpot"),
        ("Show time per output token", "tpot"),
        ("How full is the KV cache?", "cache"),
        ("What is the prefix cache hit rate?", "cache"),
        ("How many tokens are being generated?", "tokens"),
        ("What is the token throughput?", "tokens"),
        ("How many requests are in the queue?", "queue"),
        ("Are requests waiting?", "queue"),
    ])
    def test_measurement_detection(self, question, expected_measurement):
        """Test that vLLM-specific measurements are detected."""
        concepts = extract_key_concepts(question)
        assert expected_measurement in concepts["measurements"], (
            f"Question '{question}' should detect measurement '{expected_measurement}', "
            f"got {concepts['measurements']}"
        )


# =============================================================================
# extract_category_hints — vLLM keywords
# =============================================================================

class TestExtractCategoryHintsVLLM:
    """Test category hint extraction with vLLM-specific keywords."""

    @pytest.fixture
    def catalog(self, tmp_path):
        """Create a minimal catalog for hint testing."""
        import json
        catalog_data = {
            "metadata": {"generated": "2026-02-10", "total_metrics": 1,
                         "priority_distribution": {"High": 1}, "categories": 1},
            "categories": [
                {"id": "gpu_ai", "name": "GPU & AI", "description": "",
                 "icon": "", "example_queries": [],
                 "metrics": {"High": [], "Medium": []}}
            ],
            "lookup": {}
        }
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps(catalog_data))
        return MetricsCatalog(catalog_path=path)

    @pytest.mark.parametrize("query,expected_category", [
        ("What is the TTFT?", "gpu_ai"),
        ("Show TPOT for my model", "gpu_ai"),
        ("How full is the KV cache?", "gpu_ai"),
        ("What is the prefix cache hit rate?", "gpu_ai"),
        ("Are there any preemptions?", "gpu_ai"),
        ("How many tokens per second?", "gpu_ai"),
        ("Show model serving latency", "gpu_ai"),
        ("What is the decode phase time?", "gpu_ai"),
        ("Show prefill latency", "gpu_ai"),
        ("What is the queue time?", "gpu_ai"),
        ("Show generation tokens throughput", "gpu_ai"),
        ("What is the prompt tokens rate?", "gpu_ai"),
        ("Show vLLM metrics", "gpu_ai"),
        ("LLM inference performance", "gpu_ai"),
        ("What is the e2e latency?", "gpu_ai"),
        ("What is the cache usage?", "gpu_ai"),
        ("Show first token latency", "gpu_ai"),
        ("What is the cache hit rate?", "gpu_ai"),
    ])
    def test_vllm_keywords_map_to_gpu_ai(self, catalog, query, expected_category):
        """Test that vLLM-related keywords map to gpu_ai category."""
        hints = catalog.extract_category_hints(query)
        assert expected_category in hints, (
            f"Query '{query}' should hint '{expected_category}', got {hints}"
        )

    def test_no_dangling_vllm_category(self, catalog):
        """Test that there is no separate 'vllm' category (bug fix verification)."""
        # The word "vllm" should map to gpu_ai, NOT to a separate 'vllm' category
        hints = catalog.extract_category_hints("vllm metrics")
        assert "vllm" not in hints, (
            "There should be no separate 'vllm' category; "
            "vLLM queries should map to 'gpu_ai'"
        )
        assert "gpu_ai" in hints


# =============================================================================
# generate_metadata_driven_promql — new intent types
# =============================================================================

class TestGeneratePromQLNewIntents:
    """Test PromQL generation for new intent types."""

    @pytest.mark.parametrize("intent,metric_type,expected_fragment", [
        ("rate", "counter", "sum(rate("),
        ("rate", "histogram", "histogram_quantile(0.95, rate("),
        ("rate", "gauge", "rate("),
        ("trend", "counter", "rate("),
        ("trend", "gauge", "avg_over_time("),
        ("top_n", "counter", "topk(5, rate("),
        ("top_n", "gauge", "topk(5, "),
        ("comparison", "counter", "sum by (model_name)"),
        ("comparison", "gauge", "avg by (model_name)"),
        ("comparison", "histogram", "histogram_quantile(0.95, sum by (model_name, le)"),
    ])
    def test_new_intent_promql_generation(self, intent, metric_type, expected_fragment):
        """Test that new intents generate correct PromQL patterns."""
        metric_analysis = {
            "name": "vllm:test_metric",
            "metadata": {"type": metric_type}
        }
        concepts = {"intent_type": intent, "measurements": set()}

        query = generate_metadata_driven_promql(metric_analysis, concepts)
        assert expected_fragment in query, (
            f"Intent '{intent}' with type '{metric_type}' should produce "
            f"'{expected_fragment}', got '{query}'"
        )

    def test_percentile_histogram_uses_rate(self):
        """Test that percentile intent for histograms wraps with rate()."""
        metric_analysis = {
            "name": "vllm:e2e_request_latency_seconds",
            "metadata": {"type": "histogram"}
        }
        concepts = {"intent_type": "percentile", "measurements": set()}

        query = generate_metadata_driven_promql(metric_analysis, concepts)
        assert "rate(" in query
        assert "histogram_quantile(0.95" in query


# =============================================================================
# calculate_semantic_score — vLLM patterns
# =============================================================================

class TestSemanticScoreVLLM:
    """Test semantic scoring for vLLM-related patterns."""

    def test_vllm_intent_matches_vllm_metric(self):
        """vLLM/inference terms should boost vLLM metrics."""
        score = calculate_semantic_score(
            "vllm inference latency",
            "vllm:e2e_request_latency_seconds"
        )
        assert score >= 15

    def test_token_intent_matches_token_metric(self):
        """Token-related terms should boost token metrics."""
        score = calculate_semantic_score(
            "token throughput",
            "vllm:generation_tokens_total"
        )
        assert score >= 12

    def test_cache_intent_matches_cache_metric(self):
        """Cache terms should boost cache metrics."""
        score = calculate_semantic_score(
            "kv cache usage",
            "vllm:gpu_cache_usage_perc"
        )
        assert score >= 12

    def test_ttft_abbreviation_exact_match(self):
        """TTFT abbreviation should get high score on time_to_first_token metric."""
        score = calculate_semantic_score(
            "ttft",
            "vllm:time_to_first_token_seconds"
        )
        assert score >= 20

    def test_tpot_abbreviation_exact_match(self):
        """TPOT abbreviation should get high score on inter_token_latency metric."""
        score = calculate_semantic_score(
            "tpot",
            "vllm:inter_token_latency_seconds"
        )
        assert score >= 20

    def test_itl_abbreviation_exact_match(self):
        """ITL abbreviation should get high score on inter_token_latency metric."""
        score = calculate_semantic_score(
            "itl",
            "vllm:inter_token_latency_seconds"
        )
        assert score >= 20

    def test_vllm_intent_does_not_match_kube_metric(self):
        """vLLM intent should not boost unrelated Kubernetes metrics."""
        score = calculate_semantic_score(
            "vllm inference",
            "kube_pod_status_phase"
        )
        # Should not get vLLM-specific bonus
        assert score < 15

    def test_non_vllm_intent_on_vllm_metric(self):
        """Generic intent should not get vLLM-specific bonus on vLLM metric."""
        score = calculate_semantic_score(
            "cpu usage",
            "vllm:e2e_request_latency_seconds"
        )
        # "cpu usage" has no vLLM keywords, so the score should be low
        # (no 15-point vLLM bonus applied)
        assert score < 15
