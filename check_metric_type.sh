#!/bin/bash
# Check metric type and description for vLLM metrics

echo "Checking vLLM metric types and descriptions..."
echo "=============================================="
echo ""

# List of Phase 1 metrics to check
metrics=(
    "vllm:num_requests_total"
    "vllm:request_success_total"
    "vllm:request_errors_total"
    "vllm:num_requests_running"
    "vllm:num_requests_waiting"
    "vllm:request_prompt_tokens_sum"
    "vllm:request_generation_tokens_sum"
)

MCP_URL="${1:-http://localhost:8000}"

for metric in "${metrics[@]}"; do
    echo "📊 Checking: $metric"
    echo "-------------------------------------------"

    # Use MCP get_metric_metadata tool
    response=$(curl -s -X POST "$MCP_URL/mcp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": 1,
            \"method\": \"tools/call\",
            \"params\": {
                \"name\": \"get_metric_metadata\",
                \"arguments\": {
                    \"metric_name\": \"$metric\"
                }
            }
        }")

    # Extract and display result
    if echo "$response" | jq -e '.result.content[0].text' > /dev/null 2>&1; then
        echo "$response" | jq -r '.result.content[0].text' | head -20
    else
        echo "❌ Could not fetch metadata for $metric"
    fi

    echo ""
    echo ""
done

echo "=============================================="
echo "✅ Metric type check complete!"
