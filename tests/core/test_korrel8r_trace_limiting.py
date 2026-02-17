"""Unit tests for trace ID extraction with timestamp-based sorting and limiting."""
import pytest
from src.core.korrel8r_service import (
    _extract_timestamp_from_trace_obj,
    _extract_unique_trace_ids,
)


class TestExtractTimestampFromTraceObj:
    """Test timestamp extraction from various trace object formats."""

    def test_extract_from_context_start_time_unix_nano(self):
        """Test extraction from context.startTimeUnixNano (OTLP standard)."""
        obj = {
            "context": {
                "startTimeUnixNano": 1609459200000000000,  # 2021-01-01 00:00:00 in nanoseconds
                "traceID": "trace1"
            }
        }
        result = _extract_timestamp_from_trace_obj(obj)
        # Should convert nanoseconds to microseconds
        assert result == 1609459200000000

    def test_extract_from_attributes_start_time_unix_nano(self):
        """Test extraction from attributes.startTimeUnixNano."""
        obj = {
            "attributes": {
                "startTimeUnixNano": 1609459200000000000,
            },
            "context": {"traceID": "trace1"}
        }
        result = _extract_timestamp_from_trace_obj(obj)
        assert result == 1609459200000000

    def test_extract_from_attributes_start_time(self):
        """Test extraction from attributes.startTime."""
        obj = {
            "attributes": {
                "startTime": 1609459200000000,  # Microseconds
            },
            "context": {"traceID": "trace1"}
        }
        result = _extract_timestamp_from_trace_obj(obj)
        assert result == 1609459200000000

    def test_extract_from_attributes_timestamp(self):
        """Test extraction from attributes.timestamp."""
        obj = {
            "attributes": {
                "timestamp": 1609459200000,  # Milliseconds
            },
            "context": {"traceID": "trace1"}
        }
        result = _extract_timestamp_from_trace_obj(obj)
        # Should convert milliseconds to microseconds
        assert result == 1609459200000000

    def test_extract_nanoseconds_normalization(self):
        """Test that nanoseconds are properly converted to microseconds."""
        obj = {
            "attributes": {
                "time": 1609459200123456789,  # Nanoseconds
            }
        }
        result = _extract_timestamp_from_trace_obj(obj)
        assert result == 1609459200123456  # Microseconds (divided by 1000)

    def test_extract_microseconds_unchanged(self):
        """Test that microseconds are kept as-is."""
        obj = {
            "attributes": {
                "time": 1609459200123456,  # Microseconds
            }
        }
        result = _extract_timestamp_from_trace_obj(obj)
        assert result == 1609459200123456

    def test_extract_milliseconds_to_microseconds(self):
        """Test that milliseconds are converted to microseconds."""
        obj = {
            "attributes": {
                "time": 1609459200123,  # Milliseconds
            }
        }
        result = _extract_timestamp_from_trace_obj(obj)
        assert result == 1609459200123000  # Converted to microseconds

    def test_extract_seconds_to_microseconds(self):
        """Test that seconds are converted to microseconds."""
        obj = {
            "attributes": {
                "time": 1609459200,  # Seconds (Unix epoch)
            }
        }
        result = _extract_timestamp_from_trace_obj(obj)
        assert result == 1609459200000000  # Converted to microseconds (× 1,000,000)

    def test_missing_timestamp_returns_none(self):
        """Test that missing timestamp returns None."""
        obj = {
            "context": {"traceID": "trace1"},
            "attributes": {"other": "data"}
        }
        result = _extract_timestamp_from_trace_obj(obj)
        assert result is None

    def test_invalid_timestamp_returns_none(self):
        """Test that invalid timestamp formats return None."""
        obj = {
            "attributes": {
                "startTime": "not-a-number",
            }
        }
        result = _extract_timestamp_from_trace_obj(obj)
        assert result is None

    def test_context_takes_precedence(self):
        """Test that context.startTimeUnixNano takes precedence over attributes."""
        obj = {
            "context": {
                "startTimeUnixNano": 2000000000000000000,
            },
            "attributes": {
                "startTimeUnixNano": 1000000000000000000,
            }
        }
        result = _extract_timestamp_from_trace_obj(obj)
        # Should use context value
        assert result == 2000000000000000

    def test_malformed_object_returns_none(self):
        """Test that malformed objects don't crash."""
        result = _extract_timestamp_from_trace_obj({})
        assert result is None

        result = _extract_timestamp_from_trace_obj({"context": None})
        assert result is None

        result = _extract_timestamp_from_trace_obj({"attributes": None})
        assert result is None


class TestExtractUniqueTraceIds:
    """Test trace ID extraction with sorting and limiting."""

    def test_extract_with_timestamps_and_limit(self):
        """Test extraction with timestamps, limiting to most recent."""
        # Create 10 traces with timestamps, most recent should be first
        obj_result = {
            "data": [
                {
                    "context": {"traceID": f"trace{i}", "startTimeUnixNano": (1000 + i) * 1000000000},
                }
                for i in range(10)
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=5)

        # Should return the 5 most recent (highest timestamps)
        assert len(result) == 5
        assert result == ["trace9", "trace8", "trace7", "trace6", "trace5"]

    def test_extract_without_timestamps_limits_to_first_n(self):
        """Test extraction without timestamps limits to first N traces."""
        obj_result = {
            "data": [
                {"context": {"traceID": f"trace{i}"}}
                for i in range(10)
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=5)

        # Should return first 5 in original order
        assert len(result) == 5
        assert result == ["trace0", "trace1", "trace2", "trace3", "trace4"]

    def test_extract_mixed_timestamps_prioritizes_timestamped(self):
        """Test that timestamped traces come first when mixed."""
        obj_result = {
            "data": [
                # 5 traces without timestamps
                {"context": {"traceID": f"no-ts-{i}"}} for i in range(5)
            ] + [
                # 5 traces with timestamps
                {
                    "context": {
                        "traceID": f"with-ts-{i}",
                        "startTimeUnixNano": (2000 + i) * 1000000000
                    }
                }
                for i in range(5)
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=7)

        # Should get all 5 timestamped (sorted by timestamp desc) + 2 non-timestamped
        assert len(result) == 7
        # First 5 should be timestamped, sorted by recency
        assert result[:5] == ["with-ts-4", "with-ts-3", "with-ts-2", "with-ts-1", "with-ts-0"]
        # Last 2 should be non-timestamped in original order
        assert result[5:] == ["no-ts-0", "no-ts-1"]

    def test_extract_no_limit_returns_all_sorted(self):
        """Test that max_traces=None returns all traces sorted by timestamp."""
        obj_result = {
            "data": [
                {
                    "context": {
                        "traceID": f"trace{i}",
                        "startTimeUnixNano": (1000 + i) * 1000000000
                    }
                }
                for i in range(10)
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=None)

        # Should return all 10 sorted by timestamp desc
        assert len(result) == 10
        assert result == [f"trace{i}" for i in range(9, -1, -1)]

    def test_extract_limit_zero_returns_empty(self):
        """Test that max_traces=0 returns empty list."""
        obj_result = {
            "data": [
                {"context": {"traceID": f"trace{i}"}}
                for i in range(10)
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=0)
        assert result == []

    def test_extract_limit_exceeds_available(self):
        """Test that limit > available traces returns all available."""
        obj_result = {
            "data": [
                {
                    "context": {
                        "traceID": f"trace{i}",
                        "startTimeUnixNano": (1000 + i) * 1000000000
                    }
                }
                for i in range(5)
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=100)

        # Should return all 5 available
        assert len(result) == 5
        assert result == ["trace4", "trace3", "trace2", "trace1", "trace0"]

    def test_extract_deduplicates_trace_ids(self):
        """Test that duplicate trace IDs are removed, keeping most recent timestamp."""
        obj_result = {
            "data": [
                {"context": {"traceID": "trace1", "startTimeUnixNano": 1000000000000}},
                {"context": {"traceID": "trace2", "startTimeUnixNano": 2000000000000}},
                {"context": {"traceID": "trace1", "startTimeUnixNano": 3000000000000}},  # Duplicate with newer timestamp
                {"context": {"traceID": "trace3", "startTimeUnixNano": 4000000000000}},
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=None)

        # Should only include unique trace IDs
        assert len(result) == 3
        assert set(result) == {"trace1", "trace2", "trace3"}
        # Verify deduplication keeps most recent timestamp for trace1
        # Expected order: trace3 (4000000000000), trace1 (3000000000000), trace2 (2000000000000)
        assert result == ["trace3", "trace1", "trace2"]

    def test_extract_handles_list_input(self):
        """Test extraction from list input format."""
        obj_result = [
            {"context": {"traceID": f"trace{i}", "startTimeUnixNano": (1000 + i) * 1000000000}}
            for i in range(5)
        ]

        result = _extract_unique_trace_ids(obj_result, max_traces=3)

        assert len(result) == 3
        assert result == ["trace4", "trace3", "trace2"]

    def test_extract_handles_various_trace_id_locations(self):
        """Test extraction from different trace ID field locations."""
        obj_result = {
            "data": [
                {"context": {"traceID": "trace1", "startTimeUnixNano": 1000000000000}},
                {"context": {"traceId": "trace2", "startTimeUnixNano": 2000000000000}},
                {"traceID": "trace3", "attributes": {"startTime": 3000000000}},
                {"id": "trace4", "attributes": {"startTime": 4000000000}},
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=None)

        assert len(result) == 4
        # Should be sorted by timestamp desc
        assert result == ["trace4", "trace3", "trace2", "trace1"]

    def test_extract_empty_input(self):
        """Test extraction from empty input."""
        assert _extract_unique_trace_ids({"data": []}, max_traces=10) == []
        assert _extract_unique_trace_ids([], max_traces=10) == []
        assert _extract_unique_trace_ids({}, max_traces=10) == []

    def test_extract_malformed_input_doesnt_crash(self):
        """Test that malformed input doesn't crash."""
        # Various malformed inputs
        result = _extract_unique_trace_ids(None, max_traces=10)
        assert result == []

        result = _extract_unique_trace_ids({"data": None}, max_traces=10)
        assert result == []

        result = _extract_unique_trace_ids({"data": [None, {}, "string"]}, max_traces=10)
        assert result == []

    def test_timestamp_sorting_correctness(self):
        """Test that timestamp sorting is correct with various values."""
        obj_result = {
            "data": [
                {"context": {"traceID": "oldest", "startTimeUnixNano": 1000000000000000000}},
                {"context": {"traceID": "newest", "startTimeUnixNano": 3000000000000000000}},
                {"context": {"traceID": "middle", "startTimeUnixNano": 2000000000000000000}},
            ]
        }

        result = _extract_unique_trace_ids(obj_result, max_traces=None)

        # Should be ordered newest to oldest
        assert result == ["newest", "middle", "oldest"]

    def test_limit_with_negative_value(self):
        """Test that negative limit is handled gracefully."""
        obj_result = {
            "data": [
                {"context": {"traceID": f"trace{i}"}}
                for i in range(5)
            ]
        }

        # Negative limit should return all (treated as no limit)
        result = _extract_unique_trace_ids(obj_result, max_traces=-1)
        # Based on the code, negative max_traces will not trigger the limiting logic
        assert len(result) == 5
