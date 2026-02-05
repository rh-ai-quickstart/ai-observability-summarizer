#!/bin/bash
# Direct check of Prometheus metadata API

PROMETHEUS_URL="${1:-http://localhost:9090}"
METRIC="${2:-vllm:request_success_total}"

echo "Checking metadata for: $METRIC"
echo "Prometheus URL: $PROMETHEUS_URL"
echo "=============================================="
echo ""

# Query Prometheus metadata API
curl -s "${PROMETHEUS_URL}/api/v1/metadata?metric=${METRIC}" | jq '.'

echo ""
echo "=============================================="

# Also show sample values with labels
echo ""
echo "Sample values with labels:"
echo "-------------------------------------------"
curl -s "${PROMETHEUS_URL}/api/v1/query?query=${METRIC}" | jq '.data.result[] | {metric: .metric, value: .value}'
