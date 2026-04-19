"""
Tests for LLM client model ID resolution.

This module tests the llama-stack 0.6.0+ model ID candidate resolution logic.
"""

import pytest
from unittest.mock import patch, MagicMock

from src.core.llm_client import get_llamastack_model_id_candidates


class TestLlamaStackModelIDCandidates:
    """Test llama-stack 0.6.0+ model ID candidate resolution"""

    def test_model_id_candidates_with_service_name(self):
        """Should generate provider-prefixed ID when serviceName is present"""
        mock_config = {
            "meta-llama/Llama-3.1-8B-Instruct": {
                "serviceName": "llama-3-1-8b-instruct",
                "external": False
            }
        }

        with patch('src.core.model_config_manager.get_model_config', return_value=mock_config):
            candidates = get_llamastack_model_id_candidates("meta-llama/Llama-3.1-8B-Instruct")

            # Should have provider-prefixed as first candidate
            assert len(candidates) >= 2
            assert candidates[0] == "llama-3-1-8b-instruct/meta-llama/Llama-3.1-8B-Instruct"
            assert candidates[1] == "llama-3-1-8b-instruct"
            assert "meta-llama/Llama-3.1-8B-Instruct" in candidates

    def test_model_id_candidates_with_model_name(self):
        """Should include modelName in candidates when present"""
        mock_config = {
            "meta-llama/Llama-3.1-8B-Instruct": {
                "serviceName": "llama-3-1-8b-instruct",
                "modelName": "llama-8b",
                "external": False
            }
        }

        with patch('src.core.model_config_manager.get_model_config', return_value=mock_config):
            candidates = get_llamastack_model_id_candidates("meta-llama/Llama-3.1-8B-Instruct")

            assert "llama-8b" in candidates

    def test_model_id_candidates_without_service_name(self):
        """Should return model_id only when serviceName is missing"""
        mock_config = {
            "meta-llama/Llama-3.1-8B-Instruct": {
                "external": False
            }
        }

        with patch('src.core.model_config_manager.get_model_config', return_value=mock_config):
            candidates = get_llamastack_model_id_candidates("meta-llama/Llama-3.1-8B-Instruct")

            # Should only have original model_id (no provider-prefixed)
            assert candidates == ["meta-llama/Llama-3.1-8B-Instruct"]

    def test_model_id_candidates_model_not_in_config(self):
        """Should return model_id only when model is not in config"""
        mock_config = {}

        with patch('src.core.model_config_manager.get_model_config', return_value=mock_config):
            candidates = get_llamastack_model_id_candidates("unknown-model")

            assert candidates == ["unknown-model"]

    def test_model_id_candidates_no_duplicates(self):
        """Should not include duplicate candidates"""
        mock_config = {
            "test-model": {
                "serviceName": "test-model",  # Same as model_id
                "external": False
            }
        }

        with patch('src.core.model_config_manager.get_model_config', return_value=mock_config):
            candidates = get_llamastack_model_id_candidates("test-model")

            # Should have provider-prefixed and original, but no duplicates
            assert len(candidates) == 2
            assert candidates[0] == "test-model/test-model"  # provider-prefixed
            assert candidates[1] == "test-model"

    def test_model_id_candidates_priority_order(self):
        """Should return candidates in correct priority order"""
        mock_config = {
            "meta-llama/Llama-3.1-8B-Instruct": {
                "serviceName": "llama-3-1-8b-instruct",
                "modelName": "llama-8b",
                "external": False
            }
        }

        with patch('src.core.model_config_manager.get_model_config', return_value=mock_config):
            candidates = get_llamastack_model_id_candidates("meta-llama/Llama-3.1-8B-Instruct")

            # Priority order: provider-prefixed, serviceName, modelName, original
            assert candidates[0] == "llama-3-1-8b-instruct/meta-llama/Llama-3.1-8B-Instruct"
            assert candidates[1] == "llama-3-1-8b-instruct"
            assert candidates[2] == "llama-8b"
            assert candidates[3] == "meta-llama/Llama-3.1-8B-Instruct"

    def test_model_id_candidates_external_model(self):
        """Should handle external models correctly"""
        mock_config = {
            "anthropic/claude-sonnet-4": {
                "external": True,
                "provider": "anthropic",
                "modelName": "claude-sonnet-4-20250514"
            }
        }

        with patch('src.core.model_config_manager.get_model_config', return_value=mock_config):
            candidates = get_llamastack_model_id_candidates("anthropic/claude-sonnet-4")

            # External models don't have serviceName, so no provider-prefixed ID
            assert "claude-sonnet-4-20250514" in candidates
            assert "anthropic/claude-sonnet-4" in candidates
