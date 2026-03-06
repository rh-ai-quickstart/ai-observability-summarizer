# MAAS Phase 2 Testing Guide

This guide explains how to test the Phase 2 implementation of MAAS (Model As A Service) integration, which adds full UI support for user-configurable MAAS models.

## What's New in Phase 2

Phase 2 adds:
- ✅ **UI support for adding MAAS models** via the Add Model tab
- ✅ **Per-model API key configuration** in the UI
- ✅ **Curated MAAS models list** (no live API query needed)
- ✅ **Custom endpoint configuration** for each model
- ✅ **Informational messaging** about MAAS's unique per-model key requirement

---

## Prerequisites

1. **Phase 1 completed** - Backend changes from Phase 1 deployed
2. **Frontend built** - openshift-plugin rebuilt with Phase 2 changes
3. **MAAS API credentials** - At least one MAAS model API key for testing

---

## Testing the Complete User Flow

### Step 1: Open AI Model Settings

1. Navigate to the AI Observability Summarizer UI
2. Open the **Settings** or **AI Model Settings** panel
3. You should see multiple tabs:
   - Models
   - API Keys
   - Add Model
   - (others...)

---

### Step 2: Check API Keys Tab (MAAS Info)

1. Click on the **API Keys** tab
2. **Expected**: You should see an informational alert at the top:

```
ℹ️ Red Hat MAAS uses per-model API keys

Unlike other providers, each MAAS model requires its own API key.
Configure API keys when adding individual models in the Add Model tab.

You can view configured MAAS model credentials in the Kubernetes secret: ai-maas-credentials
```

3. **Expected**: "Red Hat MAAS" appears in the providers list but with special instructions

---

### Step 3: Add a MAAS Model

1. Click on the **Add Model** tab

2. **Select MAAS Provider**:
   - In the "Provider" dropdown, select "Red Hat MAAS"

3. **Expected Changes**:
   - Model list loads (curated list - no API call needed)
   - Available models shown:
     - Qwen 3 14B
     - Granite 3.1 8B Instruct
     - Granite 3.1 3B Instruct
     - Llama 3.1 8B Instruct

4. **Select a Model**:
   - Choose "qwen3-14b" from the dropdown
   - Model preview should update to: `maas/qwen3-14b`

5. **Expected**: Two additional fields appear:

   **Model API Key** (required):
   - Text input (password type)
   - Placeholder: "Enter API key for this specific model"
   - Helper text: "MAAS models require individual API keys. Each model has unique credentials."

   **Model Endpoint** (optional):
   - Text input
   - Placeholder: `https://litellm-prod.apps.maas.redhatworkshops.io/v1`
   - Helper text: "Optional: Override default MAAS endpoint for this model"

6. **Enter MAAS API Key**:
   - Paste your MAAS API key for qwen3-14b
   - Leave endpoint as default (or customize if needed)

7. **Click "Add Model"**:
   - Button should only be enabled if:
     - Model is selected
     - API key is entered (for MAAS)

8. **Expected Success**:
   - Success message appears
   - Form resets but keeps MAAS provider selected
   - Model removed from available list (already configured)

---

### Step 4: Verify Model in Models Tab

1. Switch to the **Models** tab
2. **Expected**: `maas/qwen3-14b` appears in the external models list
3. Check the model details:
   - Provider: maas
   - Requires API Key: Yes

---

### Step 5: Verify ConfigMap

```bash
kubectl get configmap ai-model-config -n <namespace> -o yaml
```

**Expected Entry**:
```yaml
data:
  model-config.json: |
    {
      "maas/qwen3-14b": {
        "external": true,
        "requiresApiKey": true,
        "serviceName": null,
        "provider": "maas",
        "apiUrl": "https://litellm-prod.apps.maas.redhatworkshops.io/v1/chat/completions",
        "modelName": "qwen3-14b",
        "apiKeySecretField": "qwen3-14b",
        "_metadata": {
          "source": "user",
          "addedBy": "console-plugin",
          "addedAt": "2026-03-05T..."
        }
      },
      ...
    }
```

**Key Fields**:
- ✅ `provider: "maas"`
- ✅ `apiKeySecretField: "qwen3-14b"` (references Secret field)
- ✅ `apiUrl` includes full endpoint with `/chat/completions`

---

### Step 6: Verify Secret Created

```bash
kubectl get secret ai-maas-credentials -n <namespace> -o yaml
```

**Expected**:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ai-maas-credentials
  namespace: <namespace>
type: Opaque
data:
  qwen3-14b: <base64-encoded-api-key>
```

**Decode to verify**:
```bash
kubectl get secret ai-maas-credentials -n <namespace> -o jsonpath='{.data.qwen3-14b}' | base64 -d
```

Should output your API key.

---

### Step 7: Test Chat with MAAS Model

1. Navigate to the Chat interface
2. Select `maas/qwen3-14b` from the model dropdown
3. Ask a test question:
   ```
   What is 2 + 2?
   ```

4. **Expected**:
   - Model responds correctly
   - No API key errors

5. Test with observability query:
   ```
   What is the CPU usage for pods in the openshift-monitoring namespace?
   ```

6. **Expected**:
   - Tool calling works
   - Prometheus queries execute
   - Results returned

---

### Step 8: Add Another MAAS Model

1. Return to **Add Model** tab
2. MAAS provider should still be selected
3. Choose **Granite 3.1 8B Instruct**
4. Enter a different API key (or same one if you're testing)
5. Override endpoint (optional test):
   ```
   https://custom-maas-endpoint.example.com/v1
   ```
6. Click **Add Model**

**Expected**:
- Model added successfully
- ConfigMap now has TWO MAAS models
- Secret now has TWO fields:
  - `qwen3-14b`
  - `granite-3.1-8b-instruct`

---

## Validation Checklist

### Backend Integration
- [ ] **MCP Tool Updated**: `add_model_to_config` accepts `api_key` and `api_url` params
- [ ] **Per-Model API Keys**: Secret `ai-maas-credentials` created with model-specific fields
- [ ] **Custom Endpoints**: Model config includes correct `apiUrl` from user input
- [ ] **Curated List**: `list_provider_models` returns curated MAAS models (no API call)

### Frontend Integration
- [ ] **Provider Type**: MAAS added to TypeScript `Provider` type
- [ ] **Provider Template**: Red Hat MAAS appears in provider dropdown
- [ ] **Model List**: Curated models displayed when MAAS selected
- [ ] **API Key Input**: Per-model API key field appears for MAAS
- [ ] **Endpoint Input**: Custom endpoint field appears for MAAS
- [ ] **Validation**: Add button disabled without API key for MAAS
- [ ] **Info Alert**: API Keys tab shows MAAS-specific message
- [ ] **Submit**: Form passes `api_key` and `api_url` to MCP tool

### End-to-End Flow
- [ ] **Model Addition**: User can add MAAS models via UI
- [ ] **Secret Creation**: API keys saved to correct Secret fields
- [ ] **ConfigMap Update**: Models added to ConfigMap with correct metadata
- [ ] **Model Selection**: MAAS models appear in chat model dropdown
- [ ] **Chat Works**: Can chat with MAAS models
- [ ] **Tool Calling**: Observability tools work with MAAS models
- [ ] **Multiple Models**: Can add multiple MAAS models with different keys

---

## Common Issues & Solutions

### Issue: MAAS Provider Not in Dropdown

**Symptoms**: "Red Hat MAAS" doesn't appear when adding models

**Solutions**:
1. **Check TypeScript Build**:
   ```bash
   cd openshift-plugin
   npm run build
   ```

2. **Verify Provider Template**:
   - Check `providerTemplates.ts` has `maas` entry
   - Restart the console plugin pod

3. **Clear Browser Cache**:
   - Hard refresh (Cmd+Shift+R or Ctrl+F5)
   - Clear cache and reload

---

### Issue: API Key Field Not Showing

**Symptoms**: When MAAS selected, no API key input appears

**Solutions**:
1. **Check Conditional Rendering**:
   - Verify `formData.provider === 'maas'` condition in AddModelTab.tsx

2. **Check React State**:
   - Open browser DevTools → React DevTools
   - Inspect AddModelTab component
   - Verify `formData.provider` equals `'maas'`

3. **Rebuild Frontend**:
   ```bash
   cd openshift-plugin
   npm run build
   ```

---

### Issue: "API key is required" Error

**Symptoms**: Can't submit form even with API key entered

**Solutions**:
1. **Check Field Value**:
   - Verify input is not empty
   - Check for whitespace-only input

2. **Check Validation Logic**:
   - Button should be disabled if: `formData.provider === 'maas' && !formData.apiKey?.trim()`
   - Form validation should catch: `formData.provider === 'maas' && !formData.apiKey?.trim()`

---

### Issue: API Key Not Saved to Secret

**Symptoms**: Model added but Secret doesn't have the field

**Solutions**:
1. **Check Backend Logs**:
   ```bash
   kubectl logs -f -n <namespace> <mcp-pod> | grep -i "maas\|api_key"
   ```

2. **Verify MCP Tool**:
   - Check `_save_maas_model_api_key` function executed
   - Look for "Successfully saved MAAS API key" log message

3. **Check RBAC Permissions**:
   ```bash
   kubectl auth can-i create secrets -n <namespace> --as=system:serviceaccount:<namespace>:mcp-server
   kubectl auth can-i update secrets -n <namespace> --as=system:serviceaccount:<namespace>:mcp-server
   ```

---

### Issue: Wrong Secret Field Name

**Symptoms**: Secret created but field name doesn't match model ID

**Solutions**:
1. **Check Field Extraction**:
   - Backend: `secret_field = model_id.replace("maas/", "").strip()`
   - Should be: `qwen3-14b` (not `maas/qwen3-14b`)

2. **Check ConfigMap**:
   - `apiKeySecretField` should match Secret data field name

3. **Fix Manually if Needed**:
   ```bash
   # Delete wrong field
   kubectl patch secret ai-maas-credentials -n <namespace> --type=json \
     -p='[{"op": "remove", "path": "/data/wrong-field-name"}]'

   # Add correct field
   kubectl patch secret ai-maas-credentials -n <namespace> --type=json \
     -p='[{"op": "add", "path": "/data/qwen3-14b", "value":"<base64-key>"}]'
   ```

---

### Issue: Models List Not Loading

**Symptoms**: "Loading available models..." never completes

**Solutions**:
1. **Check Browser Console**:
   - Look for JavaScript errors
   - Check network tab for failed requests

2. **Check MCP Tool Response**:
   - For MAAS, should return curated list immediately
   - Not dependent on API key

3. **Verify Curated List**:
   - Backend: `_get_curated_maas_models()` function exists
   - Returns list of 4 models

---

## Advanced Testing

### Test 1: Custom Endpoint

1. Add a MAAS model with custom endpoint:
   ```
   https://custom-region.maas.example.com/v1
   ```

2. Verify ConfigMap shows:
   ```json
   "apiUrl": "https://custom-region.maas.example.com/v1/chat/completions"
   ```

3. Check logs show:
   ```
   Using custom base_url for maas/model: https://custom-region.maas.example.com/v1
   ```

---

### Test 2: Multiple Models, Same Key

1. Add two different MAAS models
2. Use the SAME API key for both
3. Verify:
   - Secret has two fields with same value
   - Both models work in chat
   - No conflicts

---

### Test 3: Remove and Re-add Model

1. Delete a MAAS model from ConfigMap:
   ```bash
   # Edit ConfigMap and remove the model entry
   kubectl edit configmap ai-model-config -n <namespace>
   ```

2. Re-add via UI with different API key
3. Verify:
   - Secret field updated with new key
   - Model works with new credentials

---

### Test 4: Provider Switching

1. Start adding an OpenAI model
2. Switch provider to MAAS mid-flow
3. Verify:
   - API key field appears
   - Endpoint field appears
   - Previous selections cleared

---

## Performance Testing

### Curated List Load Time

1. Select MAAS provider
2. Measure time to display models
3. **Expected**: < 500ms (no API call needed)

### Model Addition Time

1. Fill out form completely
2. Click "Add Model"
3. Measure time to success
4. **Expected**: 2-5 seconds (includes Secret write and ConfigMap update)

---

## Security Testing

### API Key Handling

1. **Browser Storage**: Verify API keys NOT stored in localStorage/sessionStorage
2. **Network Traffic**: Verify API keys sent to backend securely (HTTPS)
3. **Secret Encoding**: Verify keys base64-encoded in Secret
4. **Log Leakage**: Check logs don't expose full API keys

```bash
# Check logs for API key leaks
kubectl logs -n <namespace> <mcp-pod> | grep -i "sk-" || echo "No API keys found in logs (good!)"
```

---

## Rollback

If Phase 2 has issues:

### Frontend Rollback

```bash
# Rebuild with Phase 1 code
cd openshift-plugin
git revert <phase-2-commit>
npm run build
# Redeploy console plugin
```

### Backend Rollback

```bash
# Revert Python changes
git revert <phase-2-backend-commit>

# Redeploy
helm upgrade mcp-server deploy/helm/mcp-server -n <namespace>
```

### Clean Up Test Data

```bash
# Remove MAAS models from ConfigMap
kubectl edit configmap ai-model-config -n <namespace>
# Delete the maas/* entries

# Remove Secret
kubectl delete secret ai-maas-credentials -n <namespace>
```

---

## Success Criteria

Phase 2 is successful when:

- [x] Users can add MAAS models via UI without kubectl commands
- [x] Per-model API keys configured through UI
- [x] Multiple MAAS models coexist with different credentials
- [x] Chat works with all configured MAAS models
- [x] Tool calling works (Prometheus, Tempo queries)
- [x] Informational messaging clear about MAAS requirements
- [x] No API key leakage in logs or network traffic
- [x] Error handling graceful and user-friendly

---

## Next Steps

After Phase 2 validation:

1. **Documentation**: Update user documentation with MAAS setup guide
2. **Training**: Train users on per-model key requirement
3. **Monitoring**: Set up alerts for MAAS API errors
4. **Optimization**: Consider caching curated model list
5. **Expansion**: Add more MAAS models to curated list as available

---

## Quick Reference Commands

```bash
# View all MAAS models in config
kubectl get configmap ai-model-config -n <namespace> -o jsonpath='{.data.model-config\.json}' | jq 'to_entries | map(select(.key | startswith("maas/"))) | from_entries'

# View all MAAS API keys
kubectl get secret ai-maas-credentials -n <namespace> -o jsonpath='{.data}' | jq 'keys'

# Test specific MAAS model API key
MAAS_KEY=$(kubectl get secret ai-maas-credentials -n <namespace> -o jsonpath='{.data.qwen3-14b}' | base64 -d)
curl -X POST https://litellm-prod.apps.maas.redhatworkshops.io/v1/chat/completions \
  -H "Authorization: Bearer $MAAS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3-14b", "messages": [{"role": "user", "content": "test"}]}'

# Watch MCP server logs for MAAS activity
kubectl logs -f -n <namespace> $(kubectl get pods -n <namespace> -l app=mcp-server -o jsonpath='{.items[0].metadata.name}') | grep -i maas
```

---

For complete implementation details, see:
- 📖 **docs/MAAS_INTEGRATION.md** - Full proposal
- 📖 **docs/MAAS_PHASE1_TESTING.md** - Phase 1 testing guide
