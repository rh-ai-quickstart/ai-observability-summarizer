"""
Centralized time range extraction and manipulation utilities.

This module provides common time-related functions used across
the observability summarizer for parsing user questions and
converting time ranges to appropriate formats.
"""

from typing import Tuple
from datetime import datetime, timedelta


def extract_time_range_from_question(question: str) -> str:
    """
    Extract time range from user question for trace analysis.
    
    This is a simplified version focused on common trace analysis patterns.
    For more complex time parsing, use the enhanced functions in llm_client.py.
    
    Args:
        question: User's question containing time references
        
    Returns:
        Time range string in a standardized format
    """
    question_lower = question.lower()

    # Check for specific time ranges
    if "last 24 hours" in question_lower or "last 24h" in question_lower or "yesterday" in question_lower:
        return "last 24h"
    elif "last week" in question_lower or "last 7 days" in question_lower:
        return "last 7d"
    elif "last month" in question_lower or "last 30 days" in question_lower:
        return "last 30d"
    elif "last 2 hours" in question_lower or "last 2h" in question_lower:
        return "last 2h"
    elif "last 6 hours" in question_lower or "last 6h" in question_lower:
        return "last 6h"
    elif "last 12 hours" in question_lower or "last 12h" in question_lower:
        return "last 12h"
    elif "last hour" in question_lower or "last 1h" in question_lower or "last 1 hour" in question_lower:
        return "last 1h"
    elif "last 30 minutes" in question_lower or "last 30m" in question_lower:
        return "last 30m"
    elif "last 15 minutes" in question_lower or "last 15m" in question_lower:
        return "last 15m"
    elif "last 5 minutes" in question_lower or "last 5m" in question_lower:
        return "last 5m"
    elif "today" in question_lower:
        return "last 24h"
    elif "this week" in question_lower:
        return "last 7d"
    elif "this month" in question_lower:
        return "last 30d"
    else:
        # Default to last 24 hours if no specific time range found
        return "last 24h"


def convert_time_range_to_iso(time_range: str) -> Tuple[str, str]:
    """
    Convert time range string to ISO format start and end times.
    
    Args:
        time_range: Time range string (e.g., "last 24h", "last 7d")
        
    Returns:
        Tuple of (start_time_iso, end_time_iso)
    """
    now = datetime.now()
    
    if time_range == "last 24h":
        start_time = now - timedelta(hours=24)
    elif time_range == "last 7d":
        start_time = now - timedelta(days=7)
    elif time_range == "last 30d":
        start_time = now - timedelta(days=30)
    elif time_range == "last 2h":
        start_time = now - timedelta(hours=2)
    elif time_range == "last 6h":
        start_time = now - timedelta(hours=6)
    elif time_range == "last 12h":
        start_time = now - timedelta(hours=12)
    elif time_range == "last 1h":
        start_time = now - timedelta(hours=1)
    elif time_range == "last 30m":
        start_time = now - timedelta(minutes=30)
    elif time_range == "last 15m":
        start_time = now - timedelta(minutes=15)
    elif time_range == "last 5m":
        start_time = now - timedelta(minutes=5)
    else:
        # Default to last 24 hours
        start_time = now - timedelta(hours=24)
    
    return start_time.isoformat() + "Z", now.isoformat() + "Z"


def calculate_duration_ms(trace: dict) -> int:
    """
    Calculate trace duration in milliseconds from various duration field formats.
    
    Args:
        trace: Trace data dictionary
        
    Returns:
        Duration in milliseconds
    """
    duration = 0
    
    if "durationMs" in trace:
        duration = trace.get("durationMs", 0)
    elif "duration" in trace:
        # Convert microseconds to milliseconds if needed
        duration = trace.get("duration", 0) / 1000
    elif "durationNanos" in trace:
        # Convert nanoseconds to milliseconds
        duration = trace.get("durationNanos", 0) / 1000000
    
    return int(duration)


def convert_duration_to_milliseconds(duration_value: int, duration_unit: str) -> int:
    """
    Convert a duration value with unit to milliseconds.
    
    Args:
        duration_value: The numeric duration value
        duration_unit: The unit ('s' for seconds, 'm' for minutes, 'h' for hours)
        
    Returns:
        Duration in milliseconds
    """
    if duration_unit == 's':
        return duration_value * 1000
    elif duration_unit == 'm':
        return duration_value * 60 * 1000
    elif duration_unit == 'h':
        return duration_value * 60 * 60 * 1000
    else:
        # Default to seconds
        return duration_value * 1000
