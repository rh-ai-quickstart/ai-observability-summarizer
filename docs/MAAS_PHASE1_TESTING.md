# MAAS Phase 1 Testing Guide

This guide explains how to test the Phase 1 implementation of MAAS (Model As A Service) integration.

## Prerequisites

1. **MAAS API Key**: Obtain a valid API key for the `qwen3-14b` model from Red Hat MAAS
2. **Kubernetes Access**: Access to the cluster where the MCP server is deployed
3. **kubectl**: Configured to access your namespace

---

## Option 1: Automated Testing (Recommended)

We've provided a testing script that automates the setup process.

### Quick Start

```bash
# Set your MAAS API key
export MAAS_API_KEY='your-actual-maas-api-key-here'

# Optional: Set namespace (defaults to aiobs-mcp-server)
export NAMESPACE='your-namespace'

# Run the test script
./test-maas-phase1.sh
```

### What the Script Does

1. ✅ Creates/updates `ai-maas-credentials` Secret with your API key
2. ✅ Verifies the Secret exists and has the correct field
3. ✅ Checks if the model config includes `maas/qwen3-14b`
4. ✅ Finds the MCP server pod
5. ✅ Checks logs for MAAS initialization
6. ✅ Provides next steps for manual UI testing

---

## Option 2: Manual Testing

### Step 1: Create Kubernetes Secret

Create the Secret with your MAAS API key:

```bash
# Replace with your actual values
NAMESPACE="aiobs-mcp-server"
MAAS_API_KEY="your-maas-api-key"

kubectl create secret generic ai-maas-credentials \
  --from-literal=qwen3-14b="$MAAS_API_KEY" \
  -n "$NAMESPACE"
```

**Verify the Secret:**
```bash
kubectl get secret ai-maas-credentials -n "$NAMESPACE"
kubectl describe secret ai-maas-credentials -n "$NAMESPACE"
```

You should see:
```
Name:         ai-maas-credentials
Namespace:    aiobs-mcp-server
Type:         Opaque

Data
====
qwen3-14b:  XX bytes
```

---

### Step 2: Deploy/Restart MCP Server

If you haven't deployed yet:

```bash
helm upgrade --install mcp-server deploy/helm/mcp-server -n "$NAMESPACE"
```

If already deployed, restart the pod to pick up changes:

```bash
kubectl rollout restart deployment/mcp-server -n "$NAMESPACE"
kubectl rollout status deployment/mcp-server -n "$NAMESPACE"
```

---

### Step 3: Verify Model Configuration

Check that the ConfigMap includes the MAAS model:

```bash
kubectl get configmap ai-model-config -n "$NAMESPACE" -o yaml
```

Look for the `maas/qwen3-14b` entry:
```json
{
  "maas/qwen3-14b": {
    "external": true,
    "requiresApiKey": true,
    "provider": "maas",
    "apiUrl": "https://litellm-prod.apps.maas.redhatworkshops.io/v1/chat/completions",
    "modelName": "qwen3-14b",
    "apiKeySecretField": "qwen3-14b",
    ...
  }
}
```

If not present, the ConfigMap will be created automatically on pod startup from the default `model-config.json`.

---

### Step 4: Monitor Pod Logs

Open a terminal to watch the logs:

```bash
# Get pod name
POD=$(kubectl get pods -n "$NAMESPACE" -l app=mcp-server -o jsonpath='{.items[0].metadata.name}')

# Follow logs with MAAS filtering
kubectl logs -f -n "$NAMESPACE" "$POD" | grep -i 'maas\|qwen\|openai\|base_url'
```

---

### Step 5: Test via UI

1. **Open the AI Observability Summarizer UI** in your browser

2. **Select the MAAS Model:**
   - Find the model dropdown/selector
   - Look for `maas/qwen3-14b` in the list
   - Select it

3. **Ask a Test Question:**

   Try a simple observability query:
   ```
   What is the CPU usage for pods in the openshift-monitoring namespace?
   ```

4. **Watch the Logs** (in the terminal from Step 4)

---

## Expected Log Messages

When the MAAS model is selected and a query is made, you should see these log entries:

### ✅ Successful Flow

```
INFO - Detected maas model from name: maas/qwen3-14b
INFO - Creating OpenAIChatBot for MAAS model maas/qwen3-14b
INFO - Using custom base_url for maas/qwen3-14b: https://litellm-prod.apps.maas.redhatworkshops.io/v1
INFO - ✅ Successfully fetched MAAS API key for maas/qwen3-14b from field 'qwen3-14b'
INFO - 🎯 OpenAIChatBot.chat() - Using OpenAI API with model: maas/qwen3-14b
INFO - 🤖 OpenAI tool calling iteration 1
INFO - 🤖 OpenAI requesting 1 tool(s)
INFO - 🔧 Using tool: query_prometheus
...
INFO - OpenAI tool calling completed in 2 iterations
```

### Key Indicators:

1. **Provider Detection**: `Detected maas model from name`
2. **Correct Routing**: `Creating OpenAIChatBot for MAAS model`
3. **Custom Endpoint**: `Using custom base_url for maas/qwen3-14b`
4. **API Key Retrieved**: `Successfully fetched MAAS API key`
5. **Tool Calling Works**: `OpenAI requesting X tool(s)`
6. **Response Received**: `OpenAI tool calling completed`

---

## Troubleshooting

### Problem: Model Not in Dropdown

**Symptoms**: `maas/qwen3-14b` doesn't appear in the model selection list

**Solutions**:
1. Check ConfigMap:
   ```bash
   kubectl get configmap ai-model-config -n "$NAMESPACE" -o jsonpath='{.data.model-config\.json}' | jq '.["maas/qwen3-14b"]'
   ```

2. If missing, update the ConfigMap:
   ```bash
   # Force update from Helm chart
   helm upgrade --install mcp-server deploy/helm/mcp-server -n "$NAMESPACE" --force
   ```

3. Restart the pod:
   ```bash
   kubectl delete pod -l app=mcp-server -n "$NAMESPACE"
   ```

---

### Problem: API Key Not Found

**Symptoms**: Logs show `MAAS model maas/qwen3-14b API key not found in secret field 'qwen3-14b'`

**Solutions**:
1. Verify Secret exists:
   ```bash
   kubectl get secret ai-maas-credentials -n "$NAMESPACE"
   ```

2. Check Secret fields:
   ```bash
   kubectl get secret ai-maas-credentials -n "$NAMESPACE" -o jsonpath='{.data}' | jq 'keys'
   ```

   Should output: `["qwen3-14b"]`

3. Recreate Secret if needed:
   ```bash
   kubectl delete secret ai-maas-credentials -n "$NAMESPACE"
   kubectl create secret generic ai-maas-credentials \
     --from-literal=qwen3-14b="$MAAS_API_KEY" \
     -n "$NAMESPACE"
   ```

---

### Problem: 401 Unauthorized Error

**Symptoms**: Logs show `401` status code or authentication errors

**Solutions**:
1. **Verify API Key is Valid**:
   - Contact Red Hat to confirm your MAAS API key is active
   - Check the key has access to the `qwen3-14b` model

2. **Test API Key Manually**:
   ```bash
   curl -X POST https://litellm-prod.apps.maas.redhatworkshops.io/v1/chat/completions \
     -H "Authorization: Bearer $MAAS_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "qwen3-14b",
       "messages": [{"role": "user", "content": "Hello"}]
     }'
   ```

3. **Update Secret with Correct Key**:
   ```bash
   kubectl create secret generic ai-maas-credentials \
     --from-literal=qwen3-14b="$NEW_MAAS_API_KEY" \
     -n "$NAMESPACE" \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

---

### Problem: Wrong Base URL

**Symptoms**: Connection errors or wrong endpoint being used

**Solutions**:
1. **Check Model Config**:
   ```bash
   kubectl get configmap ai-model-config -n "$NAMESPACE" -o jsonpath='{.data.model-config\.json}' | jq '.["maas/qwen3-14b"].apiUrl'
   ```

   Should output: `"https://litellm-prod.apps.maas.redhatworkshops.io/v1/chat/completions"`

2. **Verify Logs Show Correct URL**:
   Look for: `Using custom base_url for maas/qwen3-14b: https://litellm-prod.apps.maas.redhatworkshops.io/v1`

3. **Update ConfigMap if Wrong**:
   Edit the ConfigMap manually or update `deploy/helm/mcp-server/model-config.json` and redeploy.

---

### Problem: Tool Calling Fails

**Symptoms**: Model responds but doesn't use tools correctly

**Possible Causes**:
1. **MAAS doesn't support OpenAI function calling**: Some models/endpoints may not support tool use
2. **Model hallucinating tool calls**: Check if model is actually making valid tool call requests

**Debug Steps**:
1. Check logs for tool call format:
   ```bash
   kubectl logs -n "$NAMESPACE" "$POD" | grep -A 5 "tool_calls"
   ```

2. Try a simple non-tool query first:
   ```
   Hello, can you introduce yourself?
   ```

3. If tools don't work, document as a limitation for this MAAS endpoint

---

## Validation Checklist

Use this checklist to ensure Phase 1 is working correctly:

- [ ] **Secret Created**: `ai-maas-credentials` exists with `qwen3-14b` field
- [ ] **ConfigMap Updated**: `ai-model-config` includes `maas/qwen3-14b` entry
- [ ] **Pod Running**: MCP server pod is in `Running` state
- [ ] **Model in Dropdown**: UI shows `maas/qwen3-14b` in model selection
- [ ] **Factory Detection**: Logs show `Detected maas model from name`
- [ ] **Correct Routing**: Logs show `Creating OpenAIChatBot for MAAS model`
- [ ] **Custom Base URL**: Logs show `Using custom base_url for maas/qwen3-14b`
- [ ] **API Key Retrieved**: Logs show `Successfully fetched MAAS API key`
- [ ] **Chat Works**: Model responds to basic queries
- [ ] **Tool Calling Works**: Model can execute Prometheus/Tempo queries
- [ ] **No Errors**: No 401, 403, or 500 errors in logs

---

## Testing Without Real MAAS Credentials

If you don't have a MAAS API key yet, you can still verify the code paths:

### 1. Mock Secret (Invalid Key)

```bash
kubectl create secret generic ai-maas-credentials \
  --from-literal=qwen3-14b="mock-key-for-testing" \
  -n "$NAMESPACE"
```

### 2. Check Routing Logic

Select the `maas/qwen3-14b` model in the UI and watch logs:

```bash
kubectl logs -f -n "$NAMESPACE" "$POD" | grep -i maas
```

### 3. Expected Behavior

You should see:
- ✅ Provider detection working
- ✅ Routing to OpenAIChatBot
- ✅ Custom base_url being used
- ✅ API key retrieval from Secret
- ❌ 401 error from MAAS endpoint (expected with mock key)

This confirms the code integration is correct, just waiting for a real API key.

---

## Next Steps

Once Phase 1 is validated:

1. **Document Findings**:
   - Does MAAS support OpenAI function calling?
   - What's the typical response time?
   - Any limitations or quirks?

2. **Prepare for Phase 2**:
   - Gather list of available MAAS models
   - Understand API key provisioning process
   - Plan UI mockups for per-model key configuration

3. **Share Results**:
   - Update the team on Phase 1 success
   - Provide feedback to Red Hat if issues found
   - Get approval to proceed with Phase 2

---

## Quick Reference Commands

```bash
# Check Secret
kubectl get secret ai-maas-credentials -n "$NAMESPACE" -o yaml

# Check ConfigMap
kubectl get configmap ai-model-config -n "$NAMESPACE" -o jsonpath='{.data.model-config\.json}' | jq .

# Get Pod Name
kubectl get pods -n "$NAMESPACE" -l app=mcp-server

# Watch Logs
kubectl logs -f -n "$NAMESPACE" $(kubectl get pods -n "$NAMESPACE" -l app=mcp-server -o jsonpath='{.items[0].metadata.name}') | grep -i maas

# Test API Key Manually
curl -X POST https://litellm-prod.apps.maas.redhatworkshops.io/v1/chat/completions \
  -H "Authorization: Bearer $MAAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3-14b", "messages": [{"role": "user", "content": "Hello"}]}'

# Restart Pod
kubectl rollout restart deployment/mcp-server -n "$NAMESPACE"
```

---

## Support

If you encounter issues not covered in this guide:

1. **Check Application Logs**:
   ```bash
   kubectl logs -n "$NAMESPACE" "$POD" --tail=500
   ```

2. **Check Pod Events**:
   ```bash
   kubectl describe pod -n "$NAMESPACE" "$POD"
   ```

3. **Verify Network Connectivity**:
   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- curl -I https://litellm-prod.apps.maas.redhatworkshops.io/v1/models
   ```

4. **Review Phase 1 Implementation**:
   - `src/chatbots/factory.py` - Provider detection
   - `src/chatbots/openai_bot.py` - Custom base URL
   - `src/core/api_key_manager.py` - Per-model API keys
   - `deploy/helm/mcp-server/model-config.json` - Model config
