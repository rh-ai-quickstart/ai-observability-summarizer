"""Shared OpenTelemetry tracer for manual instrumentation.

Provides a single tracer instance used across the application for adding
custom spans (tool invocations, LLM calls, backend queries). The tracer
is always available — when no TracerProvider is configured, spans are
no-ops and add zero overhead.
"""

import logging
from opentelemetry import trace

logger = logging.getLogger(__name__)

tracer = trace.get_tracer("ai-observability-summarizer", "1.0.0")

_provider = trace.get_tracer_provider()
logger.info(
    "OTel tracer initialized: provider=%s, tracer=%s",
    type(_provider).__name__,
    type(tracer).__name__,
)
