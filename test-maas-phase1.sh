#!/bin/bash
# MAAS Phase 1 Testing Script

set -e

# Configuration
NAMESPACE="${NAMESPACE:-aiobs-mcp-server}"
MAAS_API_KEY="${MAAS_API_KEY:-}"

echo "======================================================================"
echo "MAAS Phase 1 Testing Script"
echo "======================================================================"
echo ""

# Check if MAAS_API_KEY is set
if [ -z "$MAAS_API_KEY" ]; then
    echo "❌ Error: MAAS_API_KEY environment variable not set"
    echo ""
    echo "Usage:"
    echo "  export MAAS_API_KEY='your-maas-api-key-here'"
    echo "  export NAMESPACE='your-namespace'  # optional, defaults to aiobs-mcp-server"
    echo "  ./test-maas-phase1.sh"
    echo ""
    exit 1
fi

echo "📋 Configuration:"
echo "  Namespace: $NAMESPACE"
echo "  MAAS API Key: ${MAAS_API_KEY:0:10}... (hidden)"
echo ""

# Step 1: Create or update the MAAS credentials secret
echo "Step 1: Creating/updating ai-maas-credentials Secret..."
kubectl create secret generic ai-maas-credentials \
  --from-literal=qwen3-14b="$MAAS_API_KEY" \
  -n "$NAMESPACE" \
  --dry-run=client -o yaml | kubectl apply -f -

if [ $? -eq 0 ]; then
    echo "✅ Secret created/updated successfully"
else
    echo "❌ Failed to create/update secret"
    exit 1
fi
echo ""

# Step 2: Verify the secret exists
echo "Step 2: Verifying Secret..."
kubectl get secret ai-maas-credentials -n "$NAMESPACE" &>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ Secret exists"
    kubectl get secret ai-maas-credentials -n "$NAMESPACE" -o jsonpath='{.data}' | jq 'keys'
else
    echo "❌ Secret not found"
    exit 1
fi
echo ""

# Step 3: Check if model config includes MAAS model
echo "Step 3: Checking model configuration..."
kubectl get configmap ai-model-config -n "$NAMESPACE" &>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ ConfigMap exists"
    HAS_MAAS=$(kubectl get configmap ai-model-config -n "$NAMESPACE" -o jsonpath='{.data.model-config\.json}' | jq 'has("maas/qwen3-14b")')
    if [ "$HAS_MAAS" = "true" ]; then
        echo "✅ MAAS model (maas/qwen3-14b) found in ConfigMap"
    else
        echo "⚠️  MAAS model not in ConfigMap - will be created on first pod startup"
    fi
else
    echo "⚠️  ConfigMap not found - will be created on pod startup"
fi
echo ""

# Step 4: Get MCP server pod
echo "Step 4: Finding MCP server pod..."
POD=$(kubectl get pods -n "$NAMESPACE" -l app=mcp-server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -z "$POD" ]; then
    echo "⚠️  No MCP server pod found. You may need to deploy first:"
    echo "    helm upgrade --install mcp-server deploy/helm/mcp-server -n $NAMESPACE"
    echo ""
    echo "After deployment, the pod will pick up the MAAS credentials automatically."
    exit 0
fi

echo "✅ Found pod: $POD"
echo ""

# Step 5: Check pod logs for MAAS-related messages
echo "Step 5: Checking pod logs for MAAS initialization..."
echo "Looking for recent MAAS-related log entries..."
echo ""

kubectl logs -n "$NAMESPACE" "$POD" --tail=100 | grep -i "maas\|qwen" || echo "(No MAAS logs found yet - this is normal if model hasn't been selected)"
echo ""

# Step 6: Print testing instructions
echo "======================================================================"
echo "✅ Phase 1 Setup Complete!"
echo "======================================================================"
echo ""
echo "Next Steps to Test:"
echo ""
echo "1. Open the UI in your browser"
echo "   - Navigate to the AI Observability Summarizer UI"
echo ""
echo "2. Select MAAS Model:"
echo "   - In the model dropdown, select 'maas/qwen3-14b'"
echo "   - You should see it in the available models list"
echo ""
echo "3. Ask a Test Question:"
echo "   - Try: 'What is the CPU usage for pods in the openshift-monitoring namespace?'"
echo ""
echo "4. Monitor Logs (in another terminal):"
echo "   kubectl logs -f -n $NAMESPACE $POD | grep -i 'maas\|qwen\|openai'"
echo ""
echo "What to Look For in Logs:"
echo "  ✓ 'Detected maas model from name: maas/qwen3-14b'"
echo "  ✓ 'Creating OpenAIChatBot for MAAS model maas/qwen3-14b'"
echo "  ✓ 'Using custom base_url for maas/qwen3-14b: https://litellm-prod...'"
echo "  ✓ 'Successfully fetched MAAS API key for maas/qwen3-14b from field qwen3-14b'"
echo "  ✓ Response content from the model"
echo ""
echo "Troubleshooting:"
echo "  - If you see 'API key not found': Check the secret was created correctly"
echo "  - If you see 401 errors: Verify your MAAS API key is valid"
echo "  - If model not in dropdown: Check ConfigMap or restart the pod"
echo ""
echo "To view all logs:"
echo "  kubectl logs -n $NAMESPACE $POD --tail=200"
echo ""
