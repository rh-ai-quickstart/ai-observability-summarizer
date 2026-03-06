# MAAS (Model As A Service) Integration Plan (Revised)

## Context

The OpenShift AI Observability Summarizer currently supports two categories of models:
1. **Internal models** via LlamaStack (OpenAI-compatible local endpoint)
2. **External models** via native SDKs (OpenAI, Anthropic, Google)

Red Hat now provides **MAAS (Model As A Service)** - hosted AI models accessible via OpenAI-compatible API endpoints.

**CRITICAL ARCHITECTURAL DIFFERENCE**: Unlike other providers (OpenAI, Anthropic, Google) where one API key works for all models from that provider, **each MAAS model requires its own API key and base URL**.

This plan adds MAAS support in **two phases**:
- **Phase 1**: Hardcoded MAAS model to validate the integration pattern works
- **Phase 2**: Full user-configurable MAAS models via UI and MCP tools

---

## Key Architectural Differences: MAAS vs Other Providers

### Current Providers (OpenAI, Anthropic, Google)
- **One API key per provider** (stored in `ai-{provider}-credentials` Secret)
- **Shared base URL** for all models from that provider
- **Shared credentials** across all models
- Example: One OpenAI key → access to gpt-4o, gpt-4o-mini, o1-mini

### MAAS (New Model)
- **One API key per model** (each model has unique credentials)
- **Unique base URL per model** (each model may have different endpoint)
- **No credential sharing** across MAAS models
- Example: `maas/qwen3-14b` has key1 + url1, `maas/granite-3.1-8b` has key2 + url2

**Default MAAS Base URL**: `https://litellm-prod.apps.maas.redhatworkshops.io/v1`

---

## Architecture Decision: Reuse OpenAI SDK Pattern

**Key Insight**: MAAS is OpenAI-compatible (like LlamaStack), so we should **reuse the existing `OpenAIChatBot`** class with a custom `base_url` parameter, rather than creating a new chatbot class.

**Benefits**:
- Minimal code duplication
- Proven pattern (LlamaStack does this)
- Easy maintenance
- Clear separation via provider type

**Pattern**:
```python
# MAAS uses OpenAI SDK with per-model base_url and API key
client = OpenAI(
    api_key=model_specific_api_key,  # From ai-maas-credentials Secret (model-specific field)
    base_url=model_specific_base_url  # From model config apiUrl
)
```

---

## Per-Model API Key Storage Strategy

### Recommended Approach: Single Secret with Multiple Fields

**Secret Structure**:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ai-maas-credentials
  namespace: <namespace>
type: Opaque
data:
  # Each model gets its own field (model ID as key)
  qwen3-14b: <base64-encoded-key-1>
  granite-3.1-8b-instruct: <base64-encoded-key-2>
  llama-3.1-8b-instruct: <base64-encoded-key-3>
```

**Benefits**:
- Maintains current pattern (one secret per provider)
- Easier for users to manage than N separate secrets
- Atomic updates to MAAS credentials
- Clean RBAC (grant access to entire MAAS, not per-model)

**Model Config Reference**:
```json
{
  "maas/qwen3-14b": {
    "provider": "maas",
    "apiUrl": "https://litellm-prod.apps.maas.redhatworkshops.io/v1/chat/completions",
    "modelName": "qwen3-14b",
    "apiKeySecretField": "qwen3-14b",
    "external": true,
    "requiresApiKey": true
  }
}
```

---

## Phase 1: Hardcoded MAAS Model Validation

**Goal**: Prove MAAS integration works with per-model credentials (1 day effort)

### Files to Modify

#### 1. `src/chatbots/factory.py` - Add MAAS Provider Detection

**Location**: Line 105-109 (PROVIDER_PATTERNS dict)

**Change**:
```python
PROVIDER_PATTERNS = {
    "maas": [("maas/", False)],  # NEW: Route maas/* models
    "anthropic": [("anthropic/", False), ("claude", False)],
    "openai": [("openai/", False), ("gpt-", True), ("o1-", True)],
    "google": [("google/", False), ("gemini", False)]
}
```

**Location**: Line 125-134 (Provider routing)

**Change**:
```python
if is_external:
    if provider == "maas":  # NEW
        logger.info(f"Creating OpenAIChatBot for MAAS model {model_name}")
        return OpenAIChatBot(model_name, api_key, tool_executor)
    elif provider == "anthropic":
        # ... existing code
```

---

#### 2. `src/chatbots/openai_bot.py` - Support Custom Base URL

**Location**: Line 39-45 (Client initialization in `__init__`)

**Current Code**:
```python
if self.api_key:
    self.client = OpenAI(api_key=self.api_key)
else:
    self.client = None
```

**Enhanced Code**:
```python
if self.api_key:
    # Check if model config specifies custom base_url (for MAAS, custom endpoints)
    base_url = self._get_base_url_from_config()
    if base_url:
        logger.info(f"Using custom base_url for {self.model_name}: {base_url}")
        self.client = OpenAI(api_key=self.api_key, base_url=base_url)
    else:
        self.client = OpenAI(api_key=self.api_key)
else:
    self.client = None
```

**New Method to Add**:
```python
def _get_base_url_from_config(self) -> Optional[str]:
    """Get custom base URL from model config (for MAAS, custom endpoints)."""
    try:
        from core.model_config_manager import get_model_config
        config = get_model_config()
        model_config = config.get(self.model_name, {})
        api_url = model_config.get("apiUrl", "")

        if api_url:
            # Extract base URL by removing /chat/completions suffix
            for suffix in ["/chat/completions", "/v1/chat/completions"]:
                if api_url.endswith(suffix):
                    return api_url[:-len(suffix)]
            return api_url  # Return as-is if no known suffix
        return None
    except Exception as e:
        logger.warning(f"Could not get base_url from config: {e}")
        return None
```

---

#### 3. `src/core/api_key_manager.py` - Add Per-Model MAAS API Key Retrieval

**Location**: Add new function after `fetch_api_key_from_secret()`

**New Function**:
```python
def fetch_maas_model_api_key(model_id: str) -> Optional[str]:
    """
    Fetch API key for a specific MAAS model from ai-maas-credentials Secret.

    MAAS models require per-model API keys (unlike other providers).
    The secret field name is derived from the model ID.

    Args:
        model_id: Full model ID (e.g., "maas/qwen3-14b")

    Returns:
        API key string or None if not found

    Example Secret Structure:
        apiVersion: v1
        kind: Secret
        metadata:
          name: ai-maas-credentials
        data:
          qwen3-14b: <base64-key>
          granite-3.1-8b-instruct: <base64-key>
    """
    try:
        # Extract model name from full ID (maas/qwen3-14b -> qwen3-14b)
        model_name = model_id.replace("maas/", "").strip()

        # Check if model config specifies custom secret field
        from core.model_config_manager import get_model_config
        config = get_model_config()
        model_config = config.get(model_id, {})
        secret_field = model_config.get("apiKeySecretField", model_name)

        # Read from Kubernetes Secret
        ns = os.getenv("NAMESPACE", "default")
        secret_name = "ai-maas-credentials"

        # Service account token for K8s API
        token = ""
        with open(K8S_SA_TOKEN_PATH, "r") as f:
            token = f.read().strip()

        headers = {"Authorization": f"Bearer {token}"}
        verify = os.getenv("VERIFY_SSL", "true").lower() == "true"
        url = f"{K8S_API_URL}/api/v1/namespaces/{ns}/secrets/{secret_name}"

        resp = requests.get(url, headers=headers, timeout=5, verify=verify)
        if resp.status_code != 200:
            logger.warning(f"Could not fetch MAAS secret {secret_name}: {resp.status_code}")
            return None

        # Extract and decode API key from specific field
        secret_data = resp.json().get("data", {})
        api_key_b64 = secret_data.get(secret_field, "")
        if not api_key_b64:
            logger.warning(f"MAAS model {model_id} API key not found in secret field '{secret_field}'")
            return None

        api_key = base64.b64decode(api_key_b64).decode("utf-8").strip()
        logger.info(f"Successfully fetched MAAS API key for {model_id} from field '{secret_field}'")
        return api_key

    except Exception as e:
        logger.error(f"Error fetching MAAS API key for {model_id}: {e}")
        return None
```

**Update `resolve_api_key()` function** to handle MAAS:
```python
def resolve_api_key(api_key: Optional[str] = None, model_id: Optional[str] = None) -> str:
    """Priority order:
    1. Explicitly provided api_key parameter (from UI)
    2. For MAAS models: per-model key from ai-maas-credentials Secret
    3. For other providers: provider-level key from ai-{provider}-credentials Secret
    """
    # Priority 1: Explicitly provided API key
    if api_key:
        return api_key

    # Priority 2: Kubernetes secret based on model
    if model_id:
        # MAAS models need per-model API key lookup
        if model_id.startswith("maas/") or "maas" in model_id.lower():
            maas_key = fetch_maas_model_api_key(model_id)
            if maas_key:
                return maas_key
        else:
            # Other providers: provider-level key
            provider = detect_provider_from_model_id(model_id)
            if provider:
                secret_key = fetch_api_key_from_secret(provider)
                if secret_key:
                    return secret_key

    return ""
```

**Update `detect_provider_from_model_id()`**:
```python
# Add MAAS detection (around line 62)
if "llama" in m_lower or "meta" in m_lower:
    return "meta"
if "maas" in m_lower or m_lower.startswith("maas/"):  # NEW
    return "maas"
```

---

#### 4. `deploy/helm/mcp-server/model-config.json` - Add Hardcoded MAAS Model

**Add Entry**:
```json
{
  "maas/qwen3-14b": {
    "external": true,
    "requiresApiKey": true,
    "serviceName": null,
    "provider": "maas",
    "apiUrl": "https://litellm-prod.apps.maas.redhatworkshops.io/v1/chat/completions",
    "modelName": "qwen3-14b",
    "apiKeySecretField": "qwen3-14b",
    "cost": {
      "prompt_rate": 0.0,
      "output_rate": 0.0
    },
    "_metadata": {
      "source": "default",
      "description": "Alibaba Qwen 14B model via Red Hat MAAS"
    }
  },
  ...existing models...
}
```

**New Field**: `"apiKeySecretField"` - Specifies which field in `ai-maas-credentials` Secret contains this model's API key

---

### Configuration Setup for Phase 1

**Create Kubernetes Secret with Per-Model API Keys**:
```bash
# Create secret with model-specific API keys
kubectl create secret generic ai-maas-credentials \
  --from-literal=qwen3-14b=<api-key-for-qwen3-14b> \
  -n <namespace>

# Add more models to existing secret
kubectl patch secret ai-maas-credentials \
  -p '{"data":{"granite-3.1-8b-instruct":"<base64-encoded-key>"}}' \
  -n <namespace>
```

---

### Phase 1 Validation

**Test Checklist**:
- [ ] Factory detects `maas/qwen3-14b` pattern correctly
- [ ] Routes to `OpenAIChatBot` (check logs)
- [ ] Per-model API key loaded from `ai-maas-credentials` Secret field
- [ ] Custom `base_url` set from model config's `apiUrl`
- [ ] MAAS endpoint receives requests (network logs)
- [ ] Chat responses rendered in UI
- [ ] Tool calling works (test with Prometheus query)
- [ ] Graceful error when model's API key field missing in Secret

**Without Real MAAS Credentials**:
- Create unit test with mock MAAS endpoint
- Verify per-model API key retrieval logic
- Test graceful error handling when Secret or field missing

---

## Phase 2: Full User-Configurable MAAS Support

**Goal**: Enable users to configure MAAS models with per-model API keys via UI (2-3 days effort)

### Key Changes for Per-Model Credentials

Unlike other providers, users must provide:
1. **Model ID** (e.g., `qwen3-14b`)
2. **API Key** (unique to this model)
3. **Base URL** (may vary per model, or use default)

### Files to Modify

#### Backend (Python)

**1. `src/mcp_server/tools/model_config_tools.py`** - Update for Per-Model MAAS Keys

**Update `add_model_to_config()` function** - Add MAAS-specific handling:

```python
def add_model_to_config(
    provider: str,
    model_id: str,
    description: Optional[str] = None,
    context_length: Optional[int] = None,
    cost_prompt_rate: Optional[float] = None,
    cost_output_rate: Optional[float] = None,
    api_url: Optional[str] = None,  # Required for MAAS
    api_key: Optional[str] = None,  # Required for MAAS
) -> Dict[str, Any]:
    """Add a model to the configuration.

    For MAAS models, api_key and api_url are REQUIRED per-model parameters.
    """
    provider_lower = provider.lower()

    # ... existing validation ...

    if provider_lower == "maas":
        # MAAS requires per-model API key and URL
        if not api_key:
            return {
                "success": False,
                "error": "MAAS models require an API key. Each MAAS model has unique credentials."
            }
        if not api_url:
            # Use default MAAS base URL if not provided
            api_url = "https://litellm-prod.apps.maas.redhatworkshops.io/v1"

        # Save API key to Secret (specific field for this model)
        secret_field = model_id.replace("maas/", "").strip()
        save_result = _save_maas_model_api_key(secret_field, api_key)
        if not save_result["success"]:
            return save_result

        # Construct model config entry
        full_model_id = f"maas/{model_id}" if not model_id.startswith("maas/") else model_id
        model_config = {
            "external": True,
            "requiresApiKey": True,
            "serviceName": None,
            "provider": "maas",
            "apiUrl": f"{api_url.rstrip('/')}/chat/completions",
            "modelName": model_id.replace("maas/", ""),
            "apiKeySecretField": secret_field,
            "cost": {
                "prompt_rate": cost_prompt_rate or 0.0,
                "output_rate": cost_output_rate or 0.0
            },
            "_metadata": {
                "source": "user",
                "addedAt": datetime.utcnow().isoformat(),
                "description": description or ""
            }
        }

        # Add to ConfigMap
        return _update_config_map_with_model(full_model_id, model_config)

    elif provider_lower in ["openai", "anthropic", "meta", "google"]:
        # ... existing provider logic ...
```

**New Helper Function**:
```python
def _save_maas_model_api_key(secret_field: str, api_key: str) -> Dict[str, Any]:
    """
    Save API key for a specific MAAS model to ai-maas-credentials Secret.

    Args:
        secret_field: Field name in secret (e.g., "qwen3-14b")
        api_key: API key to save

    Returns:
        Success/error dict
    """
    try:
        import base64
        from kubernetes import client, config

        ns = os.getenv("NAMESPACE", "default")
        secret_name = "ai-maas-credentials"

        # Load K8s config
        config.load_incluster_config()
        v1 = client.CoreV1Api()

        try:
            # Try to get existing secret
            secret = v1.read_namespaced_secret(secret_name, ns)
            secret_data = secret.data or {}
        except client.exceptions.ApiException as e:
            if e.status == 404:
                # Secret doesn't exist, create new
                secret_data = {}
            else:
                raise

        # Add/update model's API key field
        secret_data[secret_field] = base64.b64encode(api_key.encode()).decode()

        # Create or update secret
        secret_body = client.V1Secret(
            metadata=client.V1ObjectMeta(name=secret_name),
            type="Opaque",
            data=secret_data
        )

        try:
            v1.replace_namespaced_secret(secret_name, ns, secret_body)
            logger.info(f"Updated MAAS secret field '{secret_field}'")
        except client.exceptions.ApiException as e:
            if e.status == 404:
                v1.create_namespaced_secret(ns, secret_body)
                logger.info(f"Created MAAS secret with field '{secret_field}'")
            else:
                raise

        return {"success": True, "message": f"API key saved for MAAS model"}

    except Exception as e:
        logger.error(f"Error saving MAAS API key: {e}")
        return {"success": False, "error": f"Failed to save API key: {str(e)}"}
```

**REMOVE `list_provider_models()` for MAAS** - Cannot list models without per-model keys:
```python
elif provider_lower == "maas":
    # MAAS requires per-model API keys, so cannot generically list models
    # Return curated list instead
    models = _get_curated_maas_models()
```

**Add Curated MAAS Models List**:
```python
def _get_curated_maas_models() -> List[Dict[str, Any]]:
    """
    Curated list of available MAAS models.

    Since MAAS requires per-model API keys, we cannot query a generic
    /models endpoint. Users must configure each model individually.
    """
    return [
        {
            "id": "qwen3-14b",
            "name": "Qwen 3 14B",
            "description": "Alibaba Qwen 14B parameter model for general-purpose tasks",
            "context_length": 32768,
        },
        {
            "id": "granite-3.1-8b-instruct",
            "name": "Granite 3.1 8B Instruct",
            "description": "IBM Granite 8B parameter model for instruction following",
            "context_length": 8192,
        },
        {
            "id": "granite-3.1-3b-instruct",
            "name": "Granite 3.1 3B Instruct",
            "description": "Compact 3B parameter model for efficient inference",
            "context_length": 8192,
        },
        {
            "id": "llama-3.1-8b-instruct",
            "name": "Llama 3.1 8B Instruct",
            "description": "Meta Llama 3.1 hosted on Red Hat MAAS",
            "context_length": 128000,
        },
        # Add more as Red Hat provides them
    ]
```

---

#### Frontend (TypeScript)

**2. `openshift-plugin/src/core/components/AIModelSettings/types/models.ts`**

**Update Provider type**:
```typescript
export type Provider = 'openai' | 'anthropic' | 'google' | 'meta' | 'maas' | 'internal' | 'other';
```

**Add ModelConfig interface update** (if needed):
```typescript
export interface ModelConfig {
  external: boolean;
  requiresApiKey: boolean;
  provider: Provider;
  apiUrl: string;
  modelName: string;
  apiKeySecretField?: string;  // NEW: For MAAS per-model keys
  cost?: {
    prompt_rate: number;
    output_rate: number;
  };
  // ... existing fields
}
```

---

**3. `openshift-plugin/src/core/components/AIModelSettings/services/providerTemplates.ts`**

**Add MAAS provider template**:
```typescript
maas: {
  provider: 'maas',
  label: 'Red Hat MAAS',
  description: 'Model as a Service from Red Hat. Each model requires its own API key and endpoint.',
  defaultEndpoint: 'https://litellm-prod.apps.maas.redhatworkshops.io/v1',
  requiresApiKey: true,
  requiresPerModelApiKey: true,  // NEW: Flag for per-model credentials
  iconClass: 'fa-redhat',
  color: '#ee0000',  // Red Hat red
  commonModels: [
    'qwen3-14b',
    'granite-3.1-8b-instruct',
    'granite-3.1-3b-instruct',
    'llama-3.1-8b-instruct',
  ],
  documentationUrl: 'https://docs.redhat.com/maas',
},
```

**Update `isValidApiKey()`**:
```typescript
case 'maas':
  return apiKey.length > 20;  // Adjust based on actual MAAS key format
```

---

**4. `openshift-plugin/src/core/components/AIModelSettings/tabs/AddModelTab.tsx`**

**Modify to support per-model API key input for MAAS**:

This component needs to show an API key input field when adding MAAS models:

```typescript
// Add state for per-model API key
const [modelApiKey, setModelApiKey] = useState('');
const [modelEndpoint, setModelEndpoint] = useState('');

// Check if selected provider requires per-model API key
const requiresPerModelKey = selectedProvider === 'maas';

// In the form, add conditional API key input
{requiresPerModelKey && (
  <>
    <FormGroup label="Model API Key" isRequired>
      <TextInput
        type="password"
        value={modelApiKey}
        onChange={setModelApiKey}
        placeholder="Enter API key for this specific model"
      />
      <FormHelperText>
        <HelperText>
          <HelperTextItem>
            MAAS models require individual API keys. Each model has unique credentials.
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
    </FormGroup>

    <FormGroup label="Model Endpoint" isRequired>
      <TextInput
        value={modelEndpoint}
        onChange={setModelEndpoint}
        placeholder={providerTemplates.maas.defaultEndpoint}
      />
      <FormHelperText>
        <HelperText>
          <HelperTextItem>
            Optional: Override default MAAS endpoint for this model
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
    </FormGroup>
  </>
)}

// Update add model call to include API key and endpoint for MAAS
const handleAddModel = async () => {
  const params: any = {
    provider: selectedProvider,
    model_id: selectedModel.id,
    description: selectedModel.description,
  };

  if (selectedProvider === 'maas') {
    if (!modelApiKey) {
      setError('API key is required for MAAS models');
      return;
    }
    params.api_key = modelApiKey;
    params.api_url = modelEndpoint || providerTemplates.maas.defaultEndpoint;
  }

  // Call MCP tool
  await mcpClient.callTool('add_model_to_config', params);
};
```

---

**5. `openshift-plugin/src/core/components/AIModelSettings/tabs/APIKeysTab.tsx`**

**Add informational message for MAAS**:

```typescript
// In the provider API key configuration section, add special handling for MAAS
{selectedProvider === 'maas' && (
  <Alert variant="info" title="MAAS uses per-model API keys" isInline>
    <p>
      Unlike other providers, each MAAS model requires its own API key.
      Configure API keys when adding individual models in the "Add Model" tab.
    </p>
    <p>
      You can view configured MAAS model credentials in the Kubernetes secret:
      <code>ai-maas-credentials</code>
    </p>
  </Alert>
)}
```

---

### Phase 2 User Flow (Updated)

**MAAS Model Configuration Flow**:

1. **Navigate to Add Model Tab**:
   - User opens Settings modal → Add Model tab
   - Selects "Red Hat MAAS" provider
   - Sees curated list of available MAAS models (cannot query without keys)

2. **Select and Configure Model**:
   - User selects model (e.g., "qwen3-14b")
   - Form shows:
     - Model ID (pre-filled)
     - **API Key input** (required, per-model)
     - **Endpoint URL** (optional, defaults to Red Hat MAAS)
     - Description, context length (optional)

3. **Add Model**:
   - User enters model-specific API key
   - Clicks "Add Model"
   - System:
     - Validates inputs
     - Calls MCP tool `add_model_to_config` with `api_key` and `api_url` parameters
     - MCP tool saves API key to `ai-maas-credentials` Secret (field: `qwen3-14b`)
     - MCP tool updates ConfigMap with model config (including `apiKeySecretField`)
   - Model appears in Available Models tab

4. **Use Model**:
   - User selects MAAS model in Chat page
   - System:
     - Factory routes to `OpenAIChatBot`
     - `resolve_api_key()` calls `fetch_maas_model_api_key(model_id)`
     - Retrieves API key from Secret field `qwen3-14b`
     - Extracts `base_url` from model config's `apiUrl`
     - Creates OpenAI client with model-specific credentials
   - Chat works end-to-end

**Comparison with Other Providers**:

| Step | OpenAI/Anthropic | MAAS |
|------|------------------|------|
| **Configure API Key** | One key in API Keys tab | Per-model key in Add Model tab |
| **List Models** | Query provider API with key | Show curated list (no generic key) |
| **Add Model** | Select from list, no key needed | Select + provide model-specific key |
| **Secret Storage** | `ai-openai-credentials` with `api-key` field | `ai-maas-credentials` with model-specific fields |
| **Key Resolution** | `fetch_api_key_from_secret("openai")` | `fetch_maas_model_api_key("maas/qwen3-14b")` |

---

### Phase 2 Validation

**Full Integration Test**:
- [ ] MAAS appears in provider dropdown with Red Hat branding
- [ ] Add Model form shows API key input for MAAS
- [ ] Curated MAAS models list displayed (qwen3-14b shown first)
- [ ] User can enter model-specific API key and endpoint
- [ ] API key saved to correct Secret field (`ai-maas-credentials.qwen3-14b`)
- [ ] Model config includes `apiKeySecretField` and `apiUrl`
- [ ] ConfigMap updated correctly
- [ ] Model appears in Available Models tab
- [ ] Chat with MAAS model works end-to-end
- [ ] Per-model API key retrieved correctly from Secret
- [ ] Custom base URL used from model config
- [ ] Tool calling functional (Prometheus, Tempo queries)
- [ ] Error handling graceful (missing key field, network errors)
- [ ] Multiple MAAS models can coexist with different keys

---

## Critical Files Summary

### Phase 1 (Minimal - 4 files)
1. `src/chatbots/factory.py` - Add MAAS routing (~10 lines)
2. `src/chatbots/openai_bot.py` - Custom base_url support (~25 lines)
3. `src/core/api_key_manager.py` - Per-model key retrieval (~60 lines new function)
4. `deploy/helm/mcp-server/model-config.json` - Hardcoded model with `apiKeySecretField` (~18 lines)

### Phase 2 (Full UI - 5 files)
5. `src/mcp_server/tools/model_config_tools.py` - MAAS-specific add model logic (~100 lines)
6. `openshift-plugin/src/core/components/AIModelSettings/types/models.ts` - Add MAAS type, `apiKeySecretField` (~2 lines)
7. `openshift-plugin/src/core/components/AIModelSettings/services/providerTemplates.ts` - MAAS provider template (~20 lines)
8. `openshift-plugin/src/core/components/AIModelSettings/tabs/AddModelTab.tsx` - Per-model API key input (~50 lines)
9. `openshift-plugin/src/core/components/AIModelSettings/tabs/APIKeysTab.tsx` - MAAS informational message (~10 lines)

---

## Prerequisites

**Information Needed from Red Hat**:
1. ✅ MAAS API endpoint URL: `https://litellm-prod.apps.maas.redhatworkshops.io/v1`
2. API key format/validation pattern (for UI validation)
3. Available models list (for curated catalog)
4. Per-model credential requirements confirmation
5. API compatibility confirmation (OpenAI `/v1/chat/completions` format)
6. Function calling support (OpenAI tools format)
7. Rate limits and quotas per model
8. Documentation links

**Development Environment**:
- Python 3.11+ (already installed)
- OpenAI SDK (already installed via `pip install openai`)
- Kubernetes cluster with Secret management
- MAAS API keys for testing (one per model)

---

## Risk Mitigation

### Risk: Per-Model Key Management Complexity
- **Likelihood**: Medium (new pattern for this system)
- **Impact**: Medium (more complex than provider-level keys)
- **Mitigation**:
  - Clear UI messaging about per-model requirements
  - Single Secret with multiple fields (easier than N secrets)
  - Automatic Secret creation/update in MCP tools
  - Good error messages when keys missing

### Risk: MAAS API Not 100% OpenAI-Compatible
- **Likelihood**: Low (uses LiteLLM proxy, OpenAI-compatible)
- **Impact**: High (breaks functionality)
- **Mitigation**: Phase 1 validates compatibility; fallback is creating `MaaSChatBot` (low effort)

### Risk: Tool Calling Not Supported
- **Likelihood**: Medium
- **Impact**: High (no observability tools)
- **Mitigation**: Test in Phase 1; document limitations; consider deterministic parsing fallback

### Risk: Secret Field Name Collisions
- **Likelihood**: Low (model IDs are unique)
- **Impact**: Low (one model's key overwrites another)
- **Mitigation**: Use full model ID as field name; validate uniqueness in MCP tools

---

## Timeline (Updated)

### Phase 1: Hardcoded Model with Per-Model Key
- Implementation: 3-5 hours (more API key logic)
- Testing: 2-4 hours
- Documentation: 1 hour
- **Total**: 1-1.5 days

### Phase 2: Full UI Support with Per-Model Keys
- Backend: 5-6 hours (MCP tools complexity)
- Frontend: 4-5 hours (new UI for per-model keys)
- Integration testing: 4-6 hours
- Documentation: 2 hours
- **Total**: 2-3 days

**Overall**: 3-4 days with testing and documentation

---

## Success Criteria

### Phase 1
- [ ] MAAS model routes through factory to `OpenAIChatBot`
- [ ] Per-model API key retrieved from Secret field
- [ ] Custom `base_url` extracted from model config
- [ ] Basic chat functionality works with MAAS endpoint
- [ ] Graceful error when API key field missing in Secret

### Phase 2
- [ ] MAAS provider visible in UI with Red Hat branding
- [ ] Add Model form includes API key input for MAAS
- [ ] Curated MAAS models list displayed
- [ ] Users can configure per-model API keys and endpoints
- [ ] API keys saved to correct Secret fields
- [ ] Model configs include `apiKeySecretField` reference
- [ ] Chat with user-configured MAAS models works
- [ ] Multiple MAAS models with different keys coexist
- [ ] Tool calling functional for observability queries
- [ ] Clear error messages for missing/invalid keys

---

## Architecture Summary Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAAS Integration Flow                        │
└─────────────────────────────────────────────────────────────────┘

User Adds MAAS Model
    ↓
UI: Add Model Tab
    ├─ Provider: MAAS
    ├─ Model: qwen3-14b
    ├─ API Key: <user-enters-model-specific-key>
    └─ Endpoint: https://litellm-prod.apps.maas.redhatworkshops.io/v1
    ↓
MCP Tool: add_model_to_config()
    ├─ Save API key → ai-maas-credentials Secret (field: qwen3-14b)
    └─ Update ConfigMap → ai-model-config
        {
          "maas/qwen3-14b": {
            "apiUrl": "https://...",
            "apiKeySecretField": "qwen3-14b"
          }
        }
    ↓
User Selects Model in Chat
    ↓
Factory: create_chatbot("maas/qwen3-14b")
    ↓
API Key Resolution: resolve_api_key(model_id="maas/qwen3-14b")
    ├─ Detects MAAS model
    ├─ Calls fetch_maas_model_api_key()
    ├─ Reads model config → apiKeySecretField = "qwen3-14b"
    └─ Fetches from Secret: ai-maas-credentials.qwen3-14b
    ↓
OpenAIChatBot Initialization
    ├─ API Key: <from Secret field>
    ├─ Base URL: <from model config apiUrl>
    └─ client = OpenAI(api_key=..., base_url=...)
    ↓
Chat Request → MAAS Endpoint → Response
```
