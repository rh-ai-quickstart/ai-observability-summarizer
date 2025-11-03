import os
import sys
import time
import threading
import signal
from fastapi import FastAPI, Response

# OpenTelemetry setup
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
from opentelemetry.trace import Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
import requests
from requests.sessions import Session


def get_config_path() -> str:
    p = os.getenv("CONFIG_PATH")
    if not p:
        return "/etc/alert-example/config.yaml"
    return p


def read_config() -> str:
    path = get_config_path()
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def emit_error_span(config_data: str) -> None:
    """Emit a root-level error span when config contains 'Error'."""
    try:
        tracer = trace.get_tracer("alert-example")
        
        # Create a root span by using start_span (not start_as_current_span)
        # This creates a new trace rather than a child span
        span = tracer.start_span("config_error")
        
        # Set span attributes
        span.set_attribute("config.path", get_config_path())
        span.set_attribute("config.contains_error", True)
        preview = config_data[:200] if isinstance(config_data, str) else ""
        span.set_attribute("config.preview", preview)
        
        # Add error indicators
        span.set_attribute("otel.status_code", "ERROR")
        span.set_attribute("status.code", "Error") 
        span.set_attribute("error", True)
        
        try:
            # Record an exception to enrich the span context
            raise ValueError("Config contains 'Error' keyword")
        except Exception as ex:
            span.record_exception(ex)
        
        # Set canonical error status for the span
        span.set_status(Status(StatusCode.ERROR, description="Config contains 'Error'"))
        
        # End the span to export it
        span.end()
        
#        print(f"DEBUG: Created root config_error span with trace_id={span.get_span_context().trace_id:032x}", file=sys.stderr)
    except Exception as otel_e:
        # Best-effort: tracing not fatal to request handling
        print(f"WARN: failed to record trace span for config error: {otel_e}", file=sys.stderr)


app = FastAPI()


# Global flag to prevent double initialization
_otel_initialized = False

def _setup_otel_tracing() -> None:
    global _otel_initialized
    if _otel_initialized:
        return
        
    try:
        # Detect likely auto-instrumentation (Operator injects k8s.* resource attrs)
        resource_attrs = os.getenv("OTEL_RESOURCE_ATTRIBUTES", "")
        auto_instrumented_env = "k8s." in resource_attrs

        service_name = os.getenv("OTEL_SERVICE_NAME", "alert-example")
        service_version = os.getenv("OTEL_SERVICE_VERSION", "0.1.0")
        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector-collector.observability-hub.svc.cluster.local:4318")

        # Check if tracer provider is already configured
        current_provider = trace.get_tracer_provider()
        # Only set SDK provider if one isn't already installed (avoids override warning)
        if not isinstance(current_provider, TracerProvider):
            resource = Resource.create({"service.name": service_name, "service.version": service_version})
            provider = TracerProvider(resource=resource)
            exporter = OTLPSpanExporter(endpoint=endpoint)
            processor = BatchSpanProcessor(exporter)
            provider.add_span_processor(processor)
            trace.set_tracer_provider(provider)

        # Skip manual instrumentation if auto-instrumentation is detected
        if not auto_instrumented_env:
            # Check if app is already instrumented
            fastapi_already_instrumented = any(
                getattr(m, "cls", None) is OpenTelemetryMiddleware for m in getattr(app, "user_middleware", [])
            )
            if not fastapi_already_instrumented and not getattr(app, '_otel_instrumented', False):
                FastAPIInstrumentor.instrument_app(app)
                app._otel_instrumented = True
                
            # Check if requests is already instrumented
            try:
                # Heuristic: if requests instrumentation added an attribute/marker, skip; fallback to best-effort
                if not getattr(requests, "_opentelemetry_instrumented", False):
                    RequestsInstrumentor().instrument()
                    setattr(requests, "_opentelemetry_instrumented", True)
            except Exception:
                pass  # Best-effort; ignore if already instrumented
            
        _otel_initialized = True
        print(f"INFO: OpenTelemetry tracing initialized, endpoint={endpoint}, service={service_name}")
    except Exception as e:
        print(f"WARN: failed to initialize OpenTelemetry tracing: {e}", file=sys.stderr)


@app.on_event("startup")
def startup_check() -> None:
    _setup_otel_tracing()
    try:
        data = read_config()
        if "Crash" in data:
            print("ERROR: config contained Crash keyword on startup, terminating", file=sys.stderr)
            # Exit non-zero like the Go example
            sys.exit(1)
    except Exception as e:
        print(f"WARN: could not read config on startup: {e}", file=sys.stderr)
        # Mirror Go example behavior: exit if startup read fails
        sys.exit(1)


@app.get("/healthz")
def healthz() -> Response:
    return Response(content="ok", media_type="text/plain; charset=utf-8")


@app.get("/config")
def get_config() -> Response:
    try:
        data = read_config()
    except Exception as e:
        print(f"ERROR: failed to read config file {get_config_path()}: {e}", file=sys.stderr)
        return Response(content="failed to read config", status_code=500)

    # Emit a root-level trace span when config contains "Error"
    if "Error" in data:
        emit_error_span(data)
        # Exit non-zero shortly after returning, to allow HTTP response and span export
        def _exit_after_flush() -> None:
            try:
                time.sleep(5.0)
            finally:
                os._exit(1)
        threading.Thread(target=_exit_after_flush, daemon=True).start()
        return Response(content="config triggered error; exiting", status_code=500)

    if "Crash" in data:
        print("ERROR: config contained Crash keyword, terminating", file=sys.stderr)

        def _delayed_exit() -> None:
            time.sleep(0.5)
            os._exit(1)

        threading.Thread(target=_delayed_exit, daemon=True).start()
        return Response(content="config triggered crash", status_code=500)

    return Response(content=data, media_type="text/plain; charset=utf-8")


