"""Centralized error handling and classification for observability services."""

import re
from enum import Enum
from typing import Optional


class ErrorType(Enum):
    """Enumeration of different error types for better error classification."""
    CONNECTION_REFUSED = "connection_refused"
    DNS_RESOLUTION_FAILED = "dns_resolution_failed"
    HTTP_ERROR = "http_error"
    TIMEOUT = "timeout"
    AUTHENTICATION_FAILED = "authentication_failed"
    SERVICE_UNAVAILABLE = "service_unavailable"
    RATE_LIMITED = "rate_limited"
    UNKNOWN = "unknown"


class ServiceErrorClassifier:
    """Classifies service-related errors for better error handling and user messaging."""

    # Define error patterns with their corresponding error types
    ERROR_PATTERNS = {
        ErrorType.CONNECTION_REFUSED: [
            r"Connection refused",
            r"Connection reset",
            r"Connection aborted",
            r"Connection broken"
        ],
        ErrorType.DNS_RESOLUTION_FAILED: [
            r"nodename nor servname provided",
            r"Name or service not known",
            r"Temporary failure in name resolution",
            r"Name resolution failed"
        ],
        ErrorType.HTTP_ERROR: [
            r"HTTP\s+[45]\d{2}",  # Match HTTP 4xx and 5xx errors
            r"Bad Gateway",
            r"Gateway Timeout"
        ],
        ErrorType.TIMEOUT: [
            r"timeout",
            r"timed out",
            r"Request timeout"
        ],
        ErrorType.AUTHENTICATION_FAILED: [
            r"HTTP\s+401",
            r"\b401\b",
            r"Unauthorized",
            r"Authentication failed",
            r"Invalid credentials"
        ],
        ErrorType.SERVICE_UNAVAILABLE: [
            r"HTTP\s+503",
            r"\b503\b",
            r"Service Unavailable",
            r"service not available"
        ],
        ErrorType.RATE_LIMITED: [
            r"HTTP\s+429",
            r"\b429\b",
            r"Too Many Requests",
            r"Rate limit exceeded"
        ]
    }

    # HTTP status code to error type mapping
    HTTP_STATUS_MAPPING = {
        401: ErrorType.AUTHENTICATION_FAILED,
        403: ErrorType.AUTHENTICATION_FAILED,
        429: ErrorType.RATE_LIMITED,
        503: ErrorType.SERVICE_UNAVAILABLE,
        504: ErrorType.TIMEOUT,
    }

    @classmethod
    def classify_error(cls, error_message: str, status_code: Optional[int] = None) -> ErrorType:
        """
        Classify an error message into a specific error type.

        Args:
            error_message: The error message to classify
            status_code: Optional HTTP status code for direct classification

        Returns:
            ErrorType: The classified error type
        """
        # Check HTTP status code first if provided
        if status_code and status_code in cls.HTTP_STATUS_MAPPING:
            return cls.HTTP_STATUS_MAPPING[status_code]

        error_lower = error_message.lower()

        for error_type, patterns in cls.ERROR_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, error_lower, re.IGNORECASE):
                    return error_type

        return ErrorType.UNKNOWN

    @classmethod
    def get_user_friendly_message(cls, error_type: ErrorType, service_name: str, service_url: str) -> str:
        """
        Get a user-friendly error message based on the error type.

        Args:
            error_type: The classified error type
            service_name: The name of the service (e.g., "Tempo", "Prometheus", "LLM")
            service_url: The service URL that was being accessed

        Returns:
            str: A user-friendly error message
        """
        messages = {
            ErrorType.CONNECTION_REFUSED: f"{service_name} service refused connection at {service_url}. Check if {service_name} is running.",
            ErrorType.DNS_RESOLUTION_FAILED: f"{service_name} service not reachable at {service_url}. This is expected when running locally. Deploy to OpenShift to access {service_name}.",
            ErrorType.HTTP_ERROR: f"HTTP error accessing {service_name} at {service_url}. Check if the service is properly configured.",
            ErrorType.TIMEOUT: f"Request to {service_name} timed out at {service_url}. The service may be overloaded or unreachable.",
            ErrorType.AUTHENTICATION_FAILED: f"Authentication failed when accessing {service_name} at {service_url}. Check your credentials.",
            ErrorType.SERVICE_UNAVAILABLE: f"{service_name} service is temporarily unavailable at {service_url}. Please try again later.",
            ErrorType.RATE_LIMITED: f"Rate limit exceeded for {service_name} at {service_url}. Please wait before making more requests.",
            ErrorType.UNKNOWN: f"Unexpected error accessing {service_name} at {service_url}"
        }

        return messages.get(error_type, messages[ErrorType.UNKNOWN])


# Service-specific error classifiers for backward compatibility
class TempoErrorClassifier(ServiceErrorClassifier):
    """Tempo-specific error classifier for backward compatibility."""
    
    @classmethod
    def get_user_friendly_message(cls, error_type: ErrorType, tempo_url: str) -> str:
        """Get Tempo-specific user-friendly error message."""
        return super().get_user_friendly_message(error_type, "Tempo", tempo_url)


