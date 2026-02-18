"""Tests for Korrel8r MCP tools — get_correlated_logs."""

import json
from unittest.mock import patch, MagicMock

import src.mcp_server.tools.korrel8r_tools as korrel8r_tools


def _text(result):
    """Extract first text content from MCP tool result."""
    assert isinstance(result, list)
    assert len(result) >= 1
    return result[0].get("text", "")


class TestGetCorrelatedLogs:
    """Tests for the get_correlated_logs convenience tool."""

    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_direct_query")
    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_correlation")
    def test_correlation_returns_logs_skips_direct(self, mock_corr, mock_direct):
        """When correlation returns logs, direct query is not called."""
        mock_corr.return_value = [
            {"namespace": "ns", "pod": "p1", "level": "ERROR",
             "message": "crash", "timestamp": "2026-02-18T10:00:00Z"},
        ]

        result = korrel8r_tools.get_correlated_logs(namespace="ns", pod="p1")

        mock_corr.assert_called_once_with("ns", "p1")
        mock_direct.assert_not_called()

        logs = json.loads(_text(result))
        assert len(logs) == 1
        assert logs[0]["level"] == "ERROR"

    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_direct_query")
    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_correlation")
    def test_correlation_empty_falls_back_to_direct(self, mock_corr, mock_direct):
        """When correlation returns nothing, falls back to direct query."""
        mock_corr.return_value = []
        mock_direct.return_value = [
            {"namespace": "ns", "pod": "my-app", "level": "INFO",
             "message": "Started server", "timestamp": "2026-02-18T10:00:00Z"},
        ]

        result = korrel8r_tools.get_correlated_logs(namespace="ns", pod="my-app")

        mock_corr.assert_called_once_with("ns", "my-app")
        mock_direct.assert_called_once_with("ns", "my-app")

        logs = json.loads(_text(result))
        assert len(logs) == 1
        assert logs[0]["level"] == "INFO"

    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_direct_query")
    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_correlation")
    def test_namespace_only_no_pod(self, mock_corr, mock_direct):
        """Namespace-only query passes None for pod_name."""
        mock_corr.return_value = []
        mock_direct.return_value = []

        korrel8r_tools.get_correlated_logs(namespace="llm-serving")

        mock_corr.assert_called_once_with("llm-serving", None)
        mock_direct.assert_called_once_with("llm-serving", None)

    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_direct_query")
    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_correlation")
    def test_empty_namespace_returns_error(self, mock_corr, mock_direct):
        """Empty namespace returns an input validation error."""
        result = korrel8r_tools.get_correlated_logs(namespace="")

        mock_corr.assert_not_called()
        mock_direct.assert_not_called()
        text = _text(result)
        assert "Error" in text or "INVALID_INPUT" in text

    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_direct_query")
    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_correlation")
    def test_none_namespace_returns_error(self, mock_corr, mock_direct):
        """None namespace returns an input validation error."""
        result = korrel8r_tools.get_correlated_logs(namespace=None)

        mock_corr.assert_not_called()
        mock_direct.assert_not_called()
        text = _text(result)
        assert "Error" in text or "INVALID_INPUT" in text

    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_direct_query")
    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_correlation")
    def test_whitespace_trimmed(self, mock_corr, mock_direct):
        """Leading/trailing whitespace in namespace and pod is trimmed."""
        mock_corr.return_value = []
        mock_direct.return_value = []

        korrel8r_tools.get_correlated_logs(namespace="  llm-serving  ", pod="  my-pod  ")

        mock_corr.assert_called_once_with("llm-serving", "my-pod")

    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_direct_query")
    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_correlation")
    def test_time_range_accepted(self, mock_corr, mock_direct):
        """time_range is accepted without error."""
        mock_corr.return_value = []
        mock_direct.return_value = []

        result = korrel8r_tools.get_correlated_logs(namespace="ns", time_range="24h")

        logs = json.loads(_text(result))
        assert logs == []

    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_direct_query")
    @patch("src.mcp_server.tools.korrel8r_tools._fetch_logs_via_correlation")
    def test_both_phases_fail_returns_empty(self, mock_corr, mock_direct):
        """When both phases return nothing, empty list is returned."""
        mock_corr.return_value = []
        mock_direct.return_value = []

        result = korrel8r_tools.get_correlated_logs(namespace="ns")

        logs = json.loads(_text(result))
        assert logs == []


class TestFetchLogsViaCorrelation:
    """Tests for _fetch_logs_via_correlation helper."""

    @patch("src.mcp_server.tools.korrel8r_tools.fetch_goal_query_objects")
    def test_pod_query_uses_k8s_pod(self, mock_fetch):
        """Pod-level query uses k8s:Pod as start."""
        mock_fetch.return_value = {"logs": [{"level": "ERROR"}], "traces": []}

        result = korrel8r_tools._fetch_logs_via_correlation("ns", "my-pod")

        _, query_arg = mock_fetch.call_args[0]
        expected_selector = json.dumps({"namespace": "ns", "name": "my-pod"})
        assert query_arg == f"k8s:Pod:{expected_selector}"
        assert len(result) == 1

    @patch("src.mcp_server.tools.korrel8r_tools.fetch_goal_query_objects")
    def test_namespace_query_uses_k8s_namespace(self, mock_fetch):
        """Namespace-level query uses k8s:Namespace as start."""
        mock_fetch.return_value = {"logs": [], "traces": []}

        korrel8r_tools._fetch_logs_via_correlation("llm-serving", None)

        _, query_arg = mock_fetch.call_args[0]
        expected_selector = json.dumps({"name": "llm-serving"})
        assert query_arg == f"k8s:Namespace:{expected_selector}"

    @patch("src.mcp_server.tools.korrel8r_tools.fetch_goal_query_objects")
    def test_correlation_failure_returns_empty(self, mock_fetch):
        """Korrel8r failure returns empty list, not exception."""
        mock_fetch.side_effect = RuntimeError("connection refused")

        result = korrel8r_tools._fetch_logs_via_correlation("ns", "pod")

        assert result == []


class TestFetchLogsViaDirectQuery:
    """Tests for _fetch_logs_via_direct_query helper."""

    @patch("src.mcp_server.tools.korrel8r_tools.Korrel8rClient")
    def test_pod_query_queries_both_domains(self, mock_client_cls):
        """Pod-level direct query uses both log:application and log:infrastructure."""
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        mock_client.query_objects.return_value = [
            {"body": "INFO: ok", "k8s_namespace_name": "ns", "k8s_pod_name": "p1",
             "timestamp": "t1"},
        ]
        mock_client.simplify_log_objects.return_value = [
            {"namespace": "ns", "pod": "p1", "level": "INFO",
             "message": "ok", "timestamp": "t1"},
        ]

        result = korrel8r_tools._fetch_logs_via_direct_query("ns", "p1")

        expected_selector = json.dumps({"namespace": "ns", "name": "p1"})
        assert mock_client.query_objects.call_count == 2
        mock_client.query_objects.assert_any_call(f"log:application:{expected_selector}")
        mock_client.query_objects.assert_any_call(f"log:infrastructure:{expected_selector}")
        # Each domain returns 1 simplified log, so 2 total
        assert len(result) == 2

    @patch("src.mcp_server.tools.korrel8r_tools.Korrel8rClient")
    def test_namespace_only_query(self, mock_client_cls):
        """Namespace-only direct query omits pod selector."""
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        mock_client.query_objects.return_value = []
        mock_client.simplify_log_objects.return_value = None

        korrel8r_tools._fetch_logs_via_direct_query("llm-serving", None)

        expected_selector = json.dumps({"namespace": "llm-serving"})
        mock_client.query_objects.assert_any_call(f"log:application:{expected_selector}")
        mock_client.query_objects.assert_any_call(f"log:infrastructure:{expected_selector}")

    @patch("src.mcp_server.tools.korrel8r_tools.Korrel8rClient")
    def test_direct_query_failure_returns_empty(self, mock_client_cls):
        """Korrel8r failure returns empty list, not exception."""
        mock_client_cls.side_effect = RuntimeError("not configured")

        result = korrel8r_tools._fetch_logs_via_direct_query("ns", "pod")

        assert result == []

    @patch("src.mcp_server.tools.korrel8r_tools.Korrel8rClient")
    def test_single_domain_failure_still_returns_other(self, mock_client_cls):
        """If one domain fails, logs from the other domain are still returned."""
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        app_logs = [{"namespace": "ns", "pod": "p1", "level": "INFO",
                     "message": "ok", "timestamp": "t1"}]

        def side_effect(query):
            if "log:infrastructure" in query:
                raise RuntimeError("infra logs unavailable")
            return [{"body": "INFO: ok"}]

        mock_client.query_objects.side_effect = side_effect
        mock_client.simplify_log_objects.return_value = app_logs

        result = korrel8r_tools._fetch_logs_via_direct_query("ns", "p1")

        assert len(result) == 1
        assert result[0]["level"] == "INFO"
