# Model Configuration Design and Implementation Summary

**Status**: Implemented

**Last Updated**: 2025-12-22

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Key Components](#key-components)
- [Provider Integration](#provider-integration)
- [Configuration Management](#configuration-management)
- [Deployment and Operations](#deployment-and-operations)
- [Security Considerations](#security-considerations)
- [Usage Examples](#usage-examples)

## Overview

### Problem Solved

The model configuration system provides a dynamic, user-managed way to configure and switch between AI models in OpenShift AI Observability. It solves several key challenges:

1. **Dynamic Model Management**: Models can be added/removed at runtime without redeploying the MCP server
2. **ConfigMap as Source of Truth**: User modifications persist across Helm upgrades
3. **Multi-Provider Support**: Unified interface for OpenAI, Anthropic, Google, and Meta models
4. **Secure Credential Storage**: API keys stored in Kubernetes Secrets, not ConfigMaps
5. **User-Friendly UI**: Console plugin provides guided model selection and configuration

### Key Features

- **ConfigMap-based storage** for model configurations (user-managed, not Helm-managed)
- **Dynamic model discovery** from provider APIs (OpenAI, Google, Anthropic, Meta)
- **Intelligent endpoint routing** (GPT-5 uses `/v1/responses`, GPT-4 uses `/v1/chat/completions`)
- **API key management** via Kubernetes Secrets with namespace-scoped RBAC
- **Console plugin UI** with three tabs: Available Models, API Keys, Add Model
- **Error surfacing** from LLM providers to users for better debugging
- **Real-time configuration reload** with 60-second TTL cache

## Architecture

### ConfigMap-First Loading Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server Startup                        │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │  Load MODEL_CONFIG env var   │
        │  (Helm template defaults)     │
        └──────────────┬────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │ Try load ai-model-config CM  │
        └──────────────┬────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
       Found                   Not Found
           │                       │
           ▼                       ▼
    ┌─────────────┐      ┌──────────────────┐
    │  Use CM as  │      │  Create CM from  │
    │  source of  │      │  env defaults    │
    │   truth     │      └─────────┬────────┘
    └──────┬──────┘                │
           │                       │
           └───────────┬───────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │  Runtime config     │
            │  ready (cached for  │
            │  60s with refresh)  │
            └─────────────────────┘
```

### Data Flow: Adding a Model

```
┌──────────────────┐
│  Console Plugin  │
│  (Add Model Tab) │
└────────┬─────────┘
         │ 1. List available models
         ▼
┌─────────────────────────┐
│  MCP Tool:              │
│  list_provider_models   │
└────────┬────────────────┘
         │ 2. Query provider API
         │    (with API key from Secret)
         ▼
┌─────────────────────────┐
│  Provider API           │
│  (OpenAI/Google/etc)    │
└────────┬────────────────┘
         │ 3. Return model list
         │    (filtered for chat models)
         ▼
┌─────────────────────────┐
│  Console Plugin         │
│  (User selects model)   │
└────────┬────────────────┘
         │ 4. Add model to config
         ▼
┌─────────────────────────┐
│  MCP Tool:              │
│  add_model_to_config    │
└────────┬────────────────┘
         │ 5. Update ConfigMap
         │    (model-config.json)
         ▼
┌─────────────────────────┐
│  Kubernetes ConfigMap   │
│  ai-model-config        │
└────────┬────────────────┘
         │ 6. Force refresh cache
         ▼
┌─────────────────────────┐
│  Runtime Config Manager │
│  (model available)      │
└─────────────────────────┘
```

### Storage Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  ConfigMap: ai-model-config                    │    │
│  │  - NOT managed by Helm                         │    │
│  │  - Persists across upgrades                    │    │
│  │  - Contains model configurations               │    │
│  │                                                 │    │
│  │  {                                              │    │
│  │    "openai/gpt-4o": {                          │    │
│  │      "provider": "openai",                     │    │
│  │      "apiUrl": "https://.../chat/completions", │    │
│  │      "external": true,                         │    │
│  │      "requiresApiKey": true                    │    │
│  │    }                                            │    │
│  │  }                                              │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  Secrets (per provider)                        │    │
│  │  - ai-openai-credentials                       │    │
│  │  - ai-anthropic-credentials                    │    │
│  │  - ai-google-credentials                       │    │
│  │  - ai-meta-credentials                         │    │
│  │                                                 │    │
│  │  data:                                          │    │
│  │    api-key: <base64>                           │    │
│  │    provider: <base64>                          │    │
│  │    endpoint: <base64> (optional)               │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  MCP Server Pod                                │    │
│  │  - Reads ConfigMap via K8s API                 │    │
│  │  - Reads Secrets via K8s API (for API keys)    │    │
│  │  - Caches config for 60s                       │    │
│  │  - ServiceAccount: mcp-analyzer                │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Key Components

### Backend Components

#### 1. Model Config Manager (`src/core/model_config_manager.py`)

Core component managing runtime model configuration with ConfigMap as the source of truth.

**Key Functions**:
- `get_model_config(force_refresh=False)`: Returns current config with 60s TTL cache
- `load_runtime_model_config()`: Implements ConfigMap-first loading strategy
- `create_configmap_from_defaults(config)`: Creates ConfigMap if missing
- `reload_model_config()`: Forces immediate cache refresh

**Configuration Loading Priority**:
1. Read from ConfigMap `ai-model-config` (user-managed)
2. If not found, create ConfigMap from `MODEL_CONFIG` env var defaults
3. Fall back to env var if ConfigMap creation fails

**Caching Strategy**:
- 60-second TTL to avoid excessive K8s API calls
- Thread-safe with `RLock`
- Force refresh after ConfigMap updates

#### 2. Model Configuration Tools (`src/mcp_server/tools/model_config_tools.py`)

MCP tools for model discovery and configuration management.

**`list_provider_models(provider, api_key)`**:
- Queries provider APIs to list available models
- Filters to chat-capable models only
- Returns structured model list with metadata

**Provider-specific behavior**:
- **OpenAI**: Queries `/v1/models`, filters to GPT chat models (excludes embeddings, TTS, vision, fine-tuned)
- **Google**: Queries `/v1beta/models`, filters Gemini models with `generateContent` capability
- **Anthropic**: Returns curated list (no public API for model listing)
- **Meta**: Returns curated Llama model list

**Model filtering logic** (OpenAI example):
```python
# Only include known valid GPT chat models
valid_prefixes = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"]
for model in data.get("data", []):
    model_id = model.get("id", "")
    if any(model_id.startswith(prefix) for prefix in valid_prefixes) and ":" not in model_id:
        # Exclude non-chat models
        if not any(x in model_id.lower() for x in ["instruct", "vision", "embedding", ...]):
            models.append(model)
```

**`add_model_to_config(provider, model_id, ...)`**:
- Adds new model to ConfigMap
- Handles GPT-5 vs GPT-4 endpoint routing
- Forces runtime config reload after update

**GPT-5 endpoint selection**:
```python
def _is_gpt5_model(model_id: str) -> bool:
    """Check if a model is GPT-5 or later (uses /v1/responses endpoint)."""
    return model_id.lower().startswith("gpt-5")

# In add_model_to_config:
if provider_lower == "openai":
    if _is_gpt5_model(model_id):
        api_url = f"{api_url}/responses"  # GPT-5+ uses Responses API
    else:
        api_url = f"{api_url}/chat/completions"  # GPT-4 and earlier
```

#### 3. Credentials Tools (`src/mcp_server/tools/credentials_tools.py`)

MCP tools for API key validation and storage.

**`validate_api_key(provider, api_key, endpoint)`**:
- Server-side API key validation
- Minimal test requests to provider APIs
- Returns `{success: bool, details: {...}}`

**`save_api_key(provider, api_key, ...)`**:
- Creates/updates Kubernetes Secret: `ai-<provider>-credentials`
- Uses PATCH for updates, POST for creation
- Stores base64-encoded credentials

**Secret structure**:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ai-openai-credentials
type: Opaque
data:
  api-key: <base64>
  provider: <base64>
  endpoint: <base64>  # optional
  model-id: <base64>  # optional
  description: <base64>  # optional
```

#### 4. LLM Client (`src/core/llm_client.py`)

Handles LLM API requests with provider-specific logic.

**Response format handling**:
```python
def _validate_and_extract_response(response_json, is_external, provider):
    if provider == "openai":
        # GPT-5+ Responses API format
        if "output" in response_json:
            # Extract from output array
            for item in output:
                if "content" in item:
                    for content_item in item["content"]:
                        if "text" in content_item:
                            text_parts.append(content_item["text"])
        # GPT-4 Chat Completions format
        elif "choices" in response_json:
            return response_json["choices"][0]["message"]["content"]
```

**Request payload differences**:
- **GPT-5 Responses API**: Uses `input` field and `max_output_tokens`
- **GPT-4 Chat Completions**: Uses `messages` field and `max_tokens`

**Error logging**:
```python
def _make_api_request(url, headers, payload, verify_ssl):
    response = requests.post(url, headers=headers, json=payload, verify=verify_ssl)
    if response.status_code != 200:
        try:
            error_body = response.json()
            logger.error(f"API request failed with status {response.status_code}: {error_body}")
        except Exception:
            logger.error(f"API request failed with status {response.status_code}: {response.text}")
    response.raise_for_status()
```

### Frontend Components (Console Plugin)

#### 1. Main Component (`openshift-plugin/src/components/AIModelSettings/index.tsx`)

Orchestrates the three-tab interface and manages application state.

**State Management**:
```typescript
interface AIModelState {
  internalModels: Model[];      // No API key required
  externalModels: Model[];      // Require API key
  customModels: Model[];        // User-added models
  selectedModel: string | null;
  providers: {
    [key: string]: ProviderStatus;
  };
  loading: {
    models: boolean;
    secrets: boolean;
    testing: boolean;
    saving: boolean;
  };
  activeTab: 'models' | 'apikeys' | 'addmodel';
  error: string | null;
  success: string | null;
}
```

**Initialization Flow**:
1. Load available models from MCP server (`list_summarization_models`)
2. Load provider status (check for existing Secrets)
3. Determine which models are selectable
4. Display current model selection status

#### 2. Models Tab (`tabs/ModelsTab.tsx`)

Displays available models in a categorized dropdown.

**Model Categorization**:
- **Internal Models**: No API key required (always enabled)
- **External Models**: Require API key (disabled if not configured)
- **Custom Models**: User-added via Add Model tab

**Dropdown Structure**:
```tsx
<FormSelect>
  <FormSelectOption isPlaceholder value="" label="Select a model..." />

  {/* Internal Models */}
  <FormSelectOption isDisabled value="__grp__internal"
    label="— Internal Models (No API Key) —" />
  {internalModels.map(m => <FormSelectOption value={m.name} label={m.name} />)}

  {/* External Models */}
  <FormSelectOption isDisabled value="__grp__external"
    label="— External Models (API Key Required) —" />
  {externalModels.map(m =>
    <FormSelectOption
      value={m.name}
      label={providers[m.provider].status === 'configured' ? m.name : `${m.name} — API key required`}
      isDisabled={providers[m.provider].status !== 'configured'}
    />
  )}
</FormSelect>
```

#### 3. API Keys Tab (`tabs/APIKeysTab.tsx`)

Manages provider credentials with inline configuration UI.

**Provider Cards** (`components/ProviderInlineItem.tsx`):
- Compact inline sections for each provider
- Status indicators (configured/missing)
- Edit/Configure actions
- Validation feedback

**Workflow**:
1. User enters API key
2. Optional: Test key via `validate_api_key` MCP tool
3. Save key via `save_api_key` MCP tool (creates/updates Secret)
4. Refresh provider status
5. Update model availability

#### 4. Add Model Tab (`tabs/AddModelTab.tsx`)

Guided interface for adding models from provider catalogs.

**Workflow**:
```
1. Select Provider → Fetches available models from provider API
2. Filter Models → Removes already-configured models
3. Select Model → Auto-fills metadata (description, context length)
4. Add to Config → Updates ConfigMap via add_model_to_config
5. Refresh & Switch → Returns to Models tab with updated list
```

**Model Discovery**:
```typescript
const fetchAvailableModels = async (provider: Provider) => {
  // Get available models from provider
  const providerModels = await modelService.listProviderModels(provider);

  // Get currently configured models
  const configured = await modelService.getConfiguredModels();

  // Filter out already configured models
  const filtered = providerModels.filter(model => {
    const modelKey = formatModelName(provider, model.id);
    return !configured.includes(modelKey);
  });

  setAvailableModels(filtered);
};
```

**Error Handling**:
- API key missing: Prompts user to configure in API Keys tab
- Network errors: Displays error message with retry option
- Duplicate models: Filtered out automatically
- LLM provider errors: Surfaces error messages from provider APIs

#### 5. Model Service (`services/modelService.ts`)

Centralized service for model operations.

**Key Methods**:
- `loadAvailableModels()`: Fetches models from MCP server
- `listProviderModels(provider)`: Queries provider API via MCP tool
- `addModelToConfig(formData)`: Adds model to ConfigMap
- `getConfiguredModels()`: Lists all configured models (for duplicate checking)
- `getCurrentModel()` / `setCurrentModel()`: Session storage for selection
- `isModelReady(modelName)`: Checks if model is usable

**Single Source of Truth**:
```typescript
// Both displaying models AND checking duplicates use the same tool
async getConfiguredModels(): Promise<string[]> {
  // Use list_summarization_models for consistency
  return await listSummarizationModels();
}
```

## Provider Integration

### Supported Providers

#### OpenAI

**Configuration**:
```json
{
  "openai/gpt-4o": {
    "external": true,
    "requiresApiKey": true,
    "provider": "openai",
    "apiUrl": "https://api.openai.com/v1/chat/completions",
    "modelName": "gpt-4o"
  }
}
```

**Endpoint Routing**:
- **GPT-5+**: `https://api.openai.com/v1/responses` (Responses API)
- **GPT-4 and earlier**: `https://api.openai.com/v1/chat/completions` (Chat Completions API)

**Model Discovery**:
- API: `GET https://api.openai.com/v1/models`
- Filters: Only GPT-5.x, GPT-4.x, GPT-3.5-turbo prefixes
- Excludes: Fine-tuned models (`:` in name), vision, embeddings, TTS, audio models

**Supported Models** (as of implementation):
- gpt-5.2, gpt-5.2-chat-latest, gpt-5.2-pro
- gpt-5.1, gpt-5.1-chat-latest
- gpt-5, gpt-5-chat-latest, gpt-5-mini
- gpt-4o, gpt-4-turbo, gpt-4, gpt-3.5-turbo

#### Anthropic

**Configuration**:
```json
{
  "anthropic/claude-sonnet-4-5-20250929": {
    "external": true,
    "requiresApiKey": true,
    "provider": "anthropic",
    "apiUrl": "https://api.anthropic.com/v1/messages",
    "modelName": "claude-sonnet-4-5-20250929"
  }
}
```

**Model Discovery**:
- No public API for listing models
- Returns curated list of current Claude models

**Supported Models**:
- claude-opus-4-5-20250929
- claude-sonnet-4-5-20250929
- claude-3-5-haiku-20241022
- claude-opus-4-1-20250805
- claude-sonnet-4-20250514

**Authentication**:
- Header: `x-api-key: <api_key>`
- Header: `anthropic-version: 2023-06-01`

#### Google

**Configuration**:
```json
{
  "google/gemini-2.0-flash": {
    "external": true,
    "requiresApiKey": true,
    "provider": "google",
    "apiUrl": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    "modelName": "gemini-2.0-flash"
  }
}
```

**Model Discovery**:
- API: `GET https://generativelanguage.googleapis.com/v1beta/models?key={api_key}`
- Filters: Only Gemini models with `generateContent` capability
- Excludes: Embedding models, vision-only, code-only, AQA models

**Authentication**:
- Header: `x-goog-api-key: <api_key>`

#### Meta

**Configuration**:
```json
{
  "meta/llama-3.3-70b": {
    "external": true,
    "requiresApiKey": true,
    "provider": "meta",
    "apiUrl": "https://api.llama-api.com/v1",
    "modelName": "llama-3.3-70b"
  }
}
```

**Model Discovery**:
- Returns curated list of Llama models

**Supported Models**:
- llama-3.3-70b
- llama-3.1-70b, llama-3.1-8b
- llama-2-70b, llama-2-13b

### Response Format Handling

The system handles multiple response formats from different providers and API versions:

```python
# OpenAI GPT-5+ (Responses API)
{
  "output": [
    {
      "content": [
        {"text": "response text"}
      ]
    }
  ],
  "output_text": "response text"  # shortcut field
}

# OpenAI GPT-4 (Chat Completions)
{
  "choices": [
    {
      "message": {
        "content": "response text"
      }
    }
  ]
}

# Anthropic
{
  "content": [
    {"type": "text", "text": "response text"}
  ]
}

# Google
{
  "candidates": [
    {
      "content": {
        "parts": [
          {"text": "response text"}
        ]
      }
    }
  ]
}
```

## Configuration Management

### ConfigMap Structure

**Name**: `ai-model-config`
**Managed by**: mcp-server application (NOT Helm)
**Persistence**: Survives Helm upgrades

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-model-config
  namespace: <namespace>
  labels:
    app.kubernetes.io/name: mcp-server
    app.kubernetes.io/component: model-config
    app.kubernetes.io/managed-by: mcp-server  # NOT helm!
  annotations:
    config.kubernetes.io/created-by: mcp-server
    config.kubernetes.io/created-at: "2025-01-15T10:30:00Z"
    config.kubernetes.io/last-modified: "2025-01-15T14:20:00Z"
    config.kubernetes.io/description: |
      User-managed AI model configuration.
      This ConfigMap is not managed by Helm and will persist across upgrades.
data:
  model-config.json: |
    {
      "openai/gpt-4o": {
        "external": true,
        "requiresApiKey": true,
        "serviceName": null,
        "provider": "openai",
        "apiUrl": "https://api.openai.com/v1/chat/completions",
        "modelName": "gpt-4o",
        "cost": {
          "prompt_rate": 0.0000025,
          "output_rate": 0.00001
        }
      },
      "anthropic/claude-sonnet-4-5-20250929": {
        "external": true,
        "requiresApiKey": true,
        "serviceName": null,
        "provider": "anthropic",
        "apiUrl": "https://api.anthropic.com/v1/messages",
        "modelName": "claude-sonnet-4-5-20250929",
        "cost": {
          "prompt_rate": 0.000003,
          "output_rate": 0.000015
        },
        "_metadata": {
          "source": "user",
          "addedBy": "console-plugin",
          "addedAt": "2025-01-15T14:20:00Z"
        }
      }
    }
```

### Secret Structure (per provider)

**Name Pattern**: `ai-<provider>-credentials`
**Type**: Opaque

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ai-openai-credentials
  namespace: <namespace>
  labels:
    app.kubernetes.io/component: ai-model-config
type: Opaque
data:
  api-key: <base64-encoded-api-key>
  provider: <base64-encoded-provider-name>
  endpoint: <base64-encoded-endpoint>  # optional
  model-id: <base64-encoded-model-id>  # optional
  description: <base64-encoded-description>  # optional
```

### Adding a Model (Programmatic)

**Via MCP Tool**:
```python
from mcp_server.tools.model_config_tools import add_model_to_config

result = add_model_to_config(
    provider="openai",
    model_id="gpt-4o-mini",
    model_name="gpt-4o-mini",
    description="Efficient GPT-4 variant",
    context_length=128000,
    cost_prompt_rate=0.00000015,
    cost_output_rate=0.0000006
)
# Returns: {"success": True, "model_key": "openai/gpt-4o-mini", "message": "..."}
```

**Via Console Plugin**:
1. Navigate to **AI Model Configuration** > **Add Model** tab
2. Select provider (e.g., OpenAI)
3. Wait for model list to load (queries provider API)
4. Select model from dropdown
5. Click **Add Model**
6. ConfigMap is updated automatically
7. Model appears in **Available Models** tab

### Listing Models

**Via MCP Tool**:
```python
from mcp_server.tools.summarization_tools import list_summarization_models

models = list_summarization_models()
# Returns: ["openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929", ...]
```

**Via Console Plugin**:
- **Available Models** tab shows all models organized by category
- Models requiring unconfigured API keys are disabled with helper text

### Configuring API Keys

**Via MCP Tool**:
```python
from mcp_server.tools.credentials_tools import save_api_key

result = save_api_key(
    provider="openai",
    api_key="sk-...",
    endpoint="https://api.openai.com/v1/chat/completions",
    description="OpenAI API key for GPT models"
)
# Creates/updates Secret: ai-openai-credentials
```

**Via Console Plugin**:
1. Navigate to **AI Model Configuration** > **API Keys** tab
2. Find provider card (e.g., OpenAI)
3. Click **Configure** or **Edit**
4. Enter API key
5. Optional: Click **Test Key** to validate
6. Click **Save**
7. Secret is created/updated
8. Provider status updates to "configured"
9. Models for that provider become selectable

## Deployment and Operations

### Kubernetes Resources

#### ServiceAccount and RBAC

**ServiceAccount**: `mcp-analyzer`

**Role**: `mcp-read-ai-credentials` (namespace-scoped)
```yaml
rules:
  # Secrets - create (no resourceNames for create operations)
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create"]

  # Secrets - get/patch specific credentials
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames:
      - ai-openai-credentials
      - ai-anthropic-credentials
      - ai-google-credentials
      - ai-meta-credentials
    verbs: ["get", "patch"]

  # ConfigMap - create (no resourceNames)
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["create"]

  # ConfigMap - get/patch/update specific config
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames:
      - ai-model-config
    verbs: ["get", "patch", "update"]
```

**Security Notes**:
- RBAC `create` verbs cannot use `resourceNames` (K8s limitation)
- `create` is still namespace-scoped (no cluster-wide access)
- Only specific Secrets and ConfigMaps are accessible via `get`/`patch`

#### Deployment Configuration

**Environment Variables**:
```yaml
env:
  - name: NAMESPACE
    value: "{{ .Release.Namespace }}"
  - name: MODEL_CONFIG
    value: |
      {{ .Files.Get "model-config.json" | indent 16 }}
```

**Model Config Loading**:
1. Helm chart includes `model-config.json` as defaults
2. MCP server reads `MODEL_CONFIG` env var
3. On first startup, if `ai-model-config` ConfigMap doesn't exist, creates it from defaults
4. On subsequent startups, uses ConfigMap as source of truth
5. User modifications via console plugin update ConfigMap directly

**Lifecycle**:
- **First deployment**: ConfigMap created from `MODEL_CONFIG` defaults
- **Helm upgrade**: ConfigMap persists (not managed by Helm), user changes preserved
- **User modifications**: Updates ConfigMap, MCP server reloads within 60s
- **Pod restart**: Reads latest ConfigMap state

### Monitoring and Logging

**Key Log Messages**:
```
INFO: Loaded 3 models from ConfigMap
INFO: Model openai/gpt-4o-mini added to ConfigMap and runtime config refreshed
INFO: ConfigMap ai-model-config not found, creating from defaults
DEBUG: Refreshing model configuration
DEBUG: Using ConfigMap as model config source (3 models)
ERROR: Failed to get ConfigMap: 404
ERROR: API request failed with status 401: {"error": {"message": "Invalid API key"}}
```

**Cache Behavior**:
```python
# Cache TTL: 60 seconds
_config_cache_ttl_seconds = 60

# Force refresh after updates
def add_model_to_config(...):
    # ... update ConfigMap ...
    reload_model_config()  # Bypass cache
```

### Troubleshooting

**ConfigMap not created**:
```bash
# Check RBAC permissions
kubectl get role mcp-read-ai-credentials -n <namespace>
kubectl get rolebinding mcp-read-ai-credentials-binding -n <namespace>

# Check MCP server logs
kubectl logs -n <namespace> deployment/mcp-server | grep "ConfigMap"

# Manually create ConfigMap if needed
kubectl create configmap ai-model-config \
  --from-literal=model-config.json='{}' \
  -n <namespace>
```

**API key not working**:
```bash
# Verify Secret exists
kubectl get secret ai-openai-credentials -n <namespace>

# Check Secret contents (base64 decoded)
kubectl get secret ai-openai-credentials -n <namespace> -o jsonpath='{.data.api-key}' | base64 -d

# Test API key manually
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer sk-..."
```

**Model not appearing**:
```bash
# Check ConfigMap contents
kubectl get configmap ai-model-config -n <namespace> -o jsonpath='{.data.model-config\.json}' | jq .

# Force MCP server to refresh (restart pod)
kubectl rollout restart deployment/mcp-server -n <namespace>

# Check console plugin can reach MCP server
kubectl logs -n <namespace> deployment/openshift-ai-observability-plugin
```

**GPT-5 model using wrong endpoint**:
```python
# Verify model ID detection
from mcp_server.tools.model_config_tools import _is_gpt5_model

_is_gpt5_model("gpt-5.2")  # Should return True
_is_gpt5_model("gpt-4o")   # Should return False

# Check ConfigMap has correct apiUrl
# GPT-5+: https://api.openai.com/v1/responses
# GPT-4:  https://api.openai.com/v1/chat/completions
```

## Security Considerations

### API Key Storage

**Best Practices**:
- API keys stored in Kubernetes Secrets (base64 encoded, encrypted at rest if enabled)
- Never stored in ConfigMaps (ConfigMaps are not encrypted)
- Namespace-scoped RBAC prevents cross-namespace access
- Only specific Secrets accessible via RBAC resourceNames

**Secret Lifecycle**:
- Created/updated via MCP server tools only
- Not managed by Helm (user-owned)
- Persist across upgrades
- Can be manually created/updated via kubectl if needed

### RBAC Isolation

**Namespace Isolation**:
- ServiceAccount `mcp-analyzer` is namespace-scoped
- Role `mcp-read-ai-credentials` is namespace-scoped (not ClusterRole)
- No cluster-wide permissions granted

**Least Privilege**:
- Only necessary verbs granted (`get`, `patch`, `create`, `update`)
- `resourceNames` used wherever possible (Secrets, ConfigMaps)
- No `delete` permissions on Secrets or ConfigMaps
- No permissions on other resource types

### Network Security

**TLS/SSL**:
- All external API calls use HTTPS
- Certificate verification enabled by default
- Can be disabled via `VERIFY_SSL=false` for development

**API Key Transmission**:
- API keys sent via HTTPS headers only
- Never logged in plaintext (masked in logs)
- Not exposed in ConfigMaps or environment variables

## Usage Examples

### Example 1: Adding OpenAI GPT-4o via Console Plugin

1. **Configure API Key**:
   - Open **AI Model Configuration** modal
   - Navigate to **API Keys** tab
   - Find **OpenAI** provider
   - Click **Configure**
   - Enter API key: `sk-...`
   - Click **Test Key** (optional)
   - Click **Save**
   - Status changes to "configured"

2. **Add Model**:
   - Navigate to **Add Model** tab
   - Select **Provider**: OpenAI
   - Wait for model list to load
   - Select **Model**: gpt-4o
   - Preview shows: `openai/gpt-4o`
   - Click **Add Model**
   - Success message appears
   - Automatically switches to **Available Models** tab

3. **Select Model**:
   - In **Available Models** tab
   - Open dropdown
   - Find under "External Models" section
   - Select `openai/gpt-4o`
   - Success message: "Selected model: openai/gpt-4o"

### Example 2: Adding Anthropic Claude via MCP Tools

```python
# 1. Save API key
from mcp_server.tools.credentials_tools import save_api_key

save_api_key(
    provider="anthropic",
    api_key="sk-ant-...",
    description="Anthropic API key for Claude models"
)

# 2. Add model
from mcp_server.tools.model_config_tools import add_model_to_config

add_model_to_config(
    provider="anthropic",
    model_id="claude-sonnet-4-5-20250929",
    description="Claude Sonnet 4.5 - Balanced performance and speed",
    context_length=200000,
    cost_prompt_rate=0.000003,
    cost_output_rate=0.000015
)

# 3. Verify model is available
from mcp_server.tools.summarization_tools import list_summarization_models

models = list_summarization_models()
assert "anthropic/claude-sonnet-4-5-20250929" in models
```

### Example 3: Switching Between GPT-5 and GPT-4

The system automatically uses the correct endpoint based on model version:

```python
# GPT-5 model configuration (uses /v1/responses)
{
  "openai/gpt-5.2": {
    "provider": "openai",
    "apiUrl": "https://api.openai.com/v1/responses",  # Responses API
    "modelName": "gpt-5.2"
  }
}

# GPT-4 model configuration (uses /v1/chat/completions)
{
  "openai/gpt-4o": {
    "provider": "openai",
    "apiUrl": "https://api.openai.com/v1/chat/completions",  # Chat Completions API
    "modelName": "gpt-4o"
  }
}
```

**Automatic Request Formatting**:
```python
# GPT-5 request (Responses API)
{
  "model": "gpt-5.2",
  "input": [
    {"role": "user", "content": "Hello"}
  ],
  "max_output_tokens": 6000
}

# GPT-4 request (Chat Completions API)
{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "max_tokens": 6000
}
```

### Example 4: Handling Provider Errors

The system surfaces LLM provider errors to users:

```python
# Error from OpenAI (invalid API key)
# Logged in MCP server:
ERROR: API request failed with status 401: {
  "error": {
    "message": "Incorrect API key provided",
    "type": "invalid_request_error"
  }
}

# Error surfaced to console plugin:
"Invalid OpenAI API key. Please check your API key in the API Keys tab."
```

**Error Flow**:
1. User attempts to list models with invalid API key
2. Provider API returns 401/403 error
3. MCP tool catches error and logs detailed error body
4. Returns user-friendly error message
5. Console plugin displays error in alert
6. User can fix API key and retry

---

## Appendix

### Model Configuration Schema

```typescript
interface ModelConfig {
  external: boolean;              // true for cloud providers, false for internal
  requiresApiKey: boolean;        // true if API key needed
  serviceName: string | null;     // K8s service name (for internal models)
  provider: string;               // "openai" | "anthropic" | "google" | "meta" | "internal"
  apiUrl: string;                 // API endpoint URL
  modelName: string;              // Model identifier (e.g., "gpt-4o")
  cost?: {
    prompt_rate: number;          // Cost per input token
    output_rate: number;          // Cost per output token
  };
  description?: string;           // Optional description
  context_length?: number;        // Max context window
  _metadata?: {
    source: "default" | "user";   // How model was added
    addedBy?: string;             // Who added it
    addedAt?: string;             // When added (ISO 8601)
  };
}
```

### File Reference

**Backend**:
- `/src/core/model_config_manager.py` - Runtime config manager
- `/src/core/llm_client.py` - LLM API client with provider logic
- `/src/mcp_server/tools/model_config_tools.py` - Model discovery and management
- `/src/mcp_server/tools/credentials_tools.py` - API key validation and storage
- `/src/mcp_server/tools/summarization_tools.py` - Model listing for UI

**Frontend (Console Plugin)**:
- `/openshift-plugin/src/components/AIModelSettings/index.tsx` - Main component
- `/openshift-plugin/src/components/AIModelSettings/tabs/ModelsTab.tsx` - Model selection
- `/openshift-plugin/src/components/AIModelSettings/tabs/APIKeysTab.tsx` - API key management
- `/openshift-plugin/src/components/AIModelSettings/tabs/AddModelTab.tsx` - Add custom models
- `/openshift-plugin/src/components/AIModelSettings/services/modelService.ts` - Model operations
- `/openshift-plugin/src/components/AIModelSettings/services/secretManager.ts` - Secret operations
- `/openshift-plugin/src/components/AIModelSettings/services/providerTemplates.ts` - Provider metadata

**Deployment**:
- `/deploy/helm/mcp-server/templates/deployment.yaml` - MCP server deployment
- `/deploy/helm/mcp-server/templates/role-secrets.yaml` - RBAC for Secrets/ConfigMaps
- `/deploy/helm/mcp-server/model-config.json` - Default model configuration

### Key Commits

- `0361aa2` - Enhance console plugin settings page: dynamically reload the model list from configmap
- `fc38df3` - Enhance console plugin settings page: add custom model
- `ef69050` - Enhance console plugin settings page: support both GPT-5 and GPT-4 models
- `0ad3ce4` - Enhance console plugin settings page
- `6e8e72b` - Enhance console plugin settings page
- `24d7bdf` - Enhance console plugin settings page

### Related Documentation

- `docs/dynamic-model-config-proposal.md` - Original proposal (replaced by this document)
- `docs/add-model-implementation-summary.md` - Implementation notes (replaced by this document)
- `docs/add-model-enhancement-proposal.md` - Enhancement proposal for model filtering
