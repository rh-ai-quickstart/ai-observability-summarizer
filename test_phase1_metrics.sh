#!/bin/bash
# Test script for Phase 1 metric implementation
# Usage: ./test_phase1_metrics.sh [mcp_server_url]

set -e

MCP_URL="${1:-http://localhost:8000}"
echo "Testing Phase 1 metrics implementation against $MCP_URL"
echo "================================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Function to test metric discovery
test_metric_discovery() {
    local metric_name=$1
    echo -n "Testing discovery of '$metric_name'... "

    RESPONSE=$(curl -s -X POST "$MCP_URL/mcp/call_tool" \
        -H "Content-Type: application/json" \
        -d "{\"tool_name\": \"get_vllm_metrics\", \"arguments\": {}}")

    if echo "$RESPONSE" | grep -q "$metric_name"; then
        echo -e "${GREEN}✓ FOUND${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ NOT FOUND${NC}"
        ((FAILED++))
        return 1
    fi
}

echo ""
echo "1. Testing Request Tracking & Throughput Metrics"
echo "-------------------------------------------------"
test_metric_discovery "Requests Total"
test_metric_discovery "Requests Running"
test_metric_discovery "Request Errors Total"
test_metric_discovery "Num Requests Waiting"

echo ""
echo "2. Testing Networking & API Metrics"
echo "------------------------------------"
test_metric_discovery "Http Requests Total Status Not 2Xx"
test_metric_discovery "Http Server Request Duration Seconds"
test_metric_discovery "Vllm Rpc Server Error Count"
test_metric_discovery "Vllm Rpc Server Connection Total"

echo ""
echo "3. Testing Full Metric List Response"
echo "-------------------------------------"
echo -n "Checking MCP server response format... "
RESPONSE=$(curl -s -X POST "$MCP_URL/mcp/call_tool" \
    -H "Content-Type: application/json" \
    -d '{"tool_name": "get_vllm_metrics", "arguments": {}}')

if echo "$RESPONSE" | jq -e '.content[0].text' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Valid JSON response${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Invalid response format${NC}"
    ((FAILED++))
fi

echo ""
echo "4. Counting New Metrics"
echo "-----------------------"
METRIC_COUNT=$(echo "$RESPONSE" | jq -r '.content[0].text' | grep -c "Request\|Http\|Rpc" || true)
echo "Found $METRIC_COUNT Phase 1 related metrics"

if [ "$METRIC_COUNT" -ge 8 ]; then
    echo -e "${GREEN}✓ Expected metric count (≥8)${NC}"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠ Lower than expected metric count (found $METRIC_COUNT, expected ≥8)${NC}"
    echo "  This may be normal if some metrics aren't available in your Prometheus"
fi

echo ""
echo "5. Testing Metric Categories in Response"
echo "-----------------------------------------"
echo "$RESPONSE" | jq -r '.content[0].text' | grep -E "(Request Tracking|Networking)" | head -5

echo ""
echo "================================================================"
echo "Test Summary"
echo "================================================================"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo "Phase 1 metrics are properly configured in the backend."
    echo ""
    echo "Next steps:"
    echo "1. Open the UI at http://localhost:9000/vllm (or your UI URL)"
    echo "2. Check for 'Request Tracking & Throughput' category"
    echo "3. Check for 'Networking & API' category"
    echo "4. Verify metrics display correctly (or show N/A if not in Prometheus)"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    echo "Please check:"
    echo "1. MCP server is running at $MCP_URL"
    echo "2. Backend changes were applied (src/core/metrics.py)"
    echo "3. Server was restarted after code changes"
    echo ""
    echo "Debug with:"
    echo "  curl -X POST $MCP_URL/mcp/call_tool -H 'Content-Type: application/json' \\"
    echo "    -d '{\"tool_name\": \"get_vllm_metrics\", \"arguments\": {}}' | jq"
    exit 1
fi
