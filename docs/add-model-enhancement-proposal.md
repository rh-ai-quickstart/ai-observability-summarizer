# Add Model Tab Enhancement Proposal

**Date:** 2025-12-19
**Status:** Draft for Review
**Authors:** AI Development Team

---

## Executive Summary

This proposal outlines enhancements to the "Add Model" tab in the OpenShift AI Observability Console Plugin. The key improvements include:

1. **Dynamic Model Discovery**: Replace manual model ID input with a provider-specific dropdown populated by querying provider APIs
2. **Smart Filtering**: Automatically exclude already-configured models from the dropdown
3. **Persistent Storage**: Save newly added models to the MODEL_CONFIG environment variable (backed by ConfigMap) instead of browser localStorage

---

## Current State Analysis

### Current Implementation

**Model Addition Flow:**
1. User selects a provider from dropdown (OpenAI, Anthropic, Google, Meta)
2. User manually types model ID in a text input field
3. System shows preview in "provider/model-id" format
4. User can optionally add API key (now removed per recent changes)
5. Model is saved to browser localStorage (`ai_custom_models` key)
6. Custom models are merged with backend models at runtime

**Limitations:**
- Users must know exact model IDs (e.g., `gpt-4o-mini`, `claude-opus-4-1-20250805`)
- No validation that the model exists or is accessible
- Models stored only in browser localStorage are not cluster-wide
- No way to discover what models are available from each provider
- Custom models don't persist across browser sessions or users
- Custom models aren't included in backend MODEL_CONFIG for LLM client usage

### Storage Architecture

**Current Storage Layers:**

1. **Backend MODEL_CONFIG** (Environment Variable)
   - Source: `deploy/helm/model-config.json` or Helm values override
   - Converted to JSON string in environment variable
   - Used by Python backend for LLM client initialization
   - Currently static, loaded at pod startup

2. **Browser localStorage** (Frontend Only)
   - Key: `ai_custom_models`
   - Managed by `modelService.ts`
   - Only available in current browser session
   - Not shared across users or browser instances

3. **OpenShift Secrets** (API Keys)
   - Pattern: `ai-<provider>-credentials`
   - Stores encrypted API keys
   - Managed by MCP tools via Kubernetes API
   - Cluster-wide and persistent

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Console Plugin)               │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Add Model Tab                                      │    │
│  │  1. Select Provider → Trigger API Query            │    │
│  │  2. Display Available Models (filtered dropdown)   │    │
│  │  3. Save Model → Call MCP Tool                     │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            ↓ MCP JSON-RPC
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (Backend)                     │
│  ┌────────────────────────────────────────────────────┐    │
│  │  New MCP Tools:                                     │    │
│  │  • list_provider_models(provider, api_key)         │    │
│  │  • add_model_to_config(model_spec)                 │    │
│  │  • get_current_model_config()                      │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            ↓ Kubernetes API
┌─────────────────────────────────────────────────────────────┐
│                    OpenShift Cluster                        │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │  ConfigMap       │  │  Secrets         │               │
│  │  ai-model-config │  │  ai-*-credentials│               │
│  │  (MODEL_CONFIG)  │  │  (API Keys)      │               │
│  └──────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### Component Design

#### 1. Frontend Changes

**File: `openshift-plugin/src/components/AIModelSettings/tabs/AddModelTab.tsx`**

**Changes:**
- Replace `TextInput` for model ID with `FormSelect` (dropdown)
- Add loading state for fetching available models from provider
- Implement model filtering to exclude already-configured models
- Remove "Popular models" suggestion buttons (replaced by dropdown)

**New Props/State:**
```typescript
interface AddModelTabState {
  // Existing
  formData: ModelFormData;
  saving: boolean;
  error: string | null;

  // New
  availableModels: ProviderModel[];  // Models from provider API
  loadingModels: boolean;            // Fetching models from provider
  selectedProvider: Provider;         // Current provider selection
}

interface ProviderModel {
  id: string;              // Model ID from provider
  name: string;            // Display name
  description?: string;    // Model description
  context_length?: number; // Token limit
  created?: string;        // Release date
  owned_by?: string;       // Owner/organization
}
```

**User Flow:**
1. User selects provider → Frontend calls `list_provider_models` MCP tool
2. Dropdown populates with available models (filtered to exclude configured ones)
3. User selects model from dropdown
4. User clicks "Add Model" → Frontend calls `add_model_to_config` MCP tool
5. System saves to ConfigMap and reloads backend config

---

#### 2. Backend MCP Tools

**File: `src/mcp_server/tools/model_config_tools.py` (NEW)**

**Tool 1: `list_provider_models`**

```python
def list_provider_models(
    provider: str,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Query provider API to list available models.

    Args:
        provider: Provider name (openai, anthropic, google, meta)
        api_key: API key for authentication (optional, reads from secret if not provided)

    Returns:
        List of available models with metadata
        [
            {
                "id": "gpt-4o-mini",
                "name": "GPT-4o Mini",
                "description": "Affordable and intelligent small model",
                "context_length": 128000,
                "created": "2024-07-18"
            },
            ...
        ]
    """
```

**Implementation Details:**

- **OpenAI:** `GET https://api.openai.com/v1/models`
  - Returns list of model objects with `id`, `created`, `owned_by`
  - Filter to chat completion models only (exclude embeddings, audio, etc.)

- **Anthropic:** Hardcoded list (no public models list API)
  - Return curated list: claude-opus-4, claude-sonnet-4, claude-haiku-3.5
  - Include version dates and context lengths

- **Google:** `GET https://generativelanguage.googleapis.com/v1beta/models`
  - Returns models with `name`, `displayName`, `description`, `inputTokenLimit`
  - Filter to generative models only

- **Meta:** Provider-specific implementation
  - Llama API gateway may vary, use common Llama 2/3 models list

**Error Handling:**
- If API key not provided, attempt to read from secret `ai-<provider>-credentials`
- If API call fails (401, 403), return error suggesting API key configuration
- If provider not supported, return error
- Timeout: 10 seconds

---

**Tool 2: `add_model_to_config`**

```python
def add_model_to_config(
    provider: str,
    model_id: str,
    model_name: str,
    description: Optional[str] = None,
    context_length: Optional[int] = None,
    cost_prompt_rate: Optional[float] = None,
    cost_output_rate: Optional[float] = None
) -> Dict[str, Any]:
    """
    Add a new model to MODEL_CONFIG by updating ConfigMap.

    Args:
        provider: Provider name
        model_id: Model identifier (e.g., 'gpt-4o-mini')
        model_name: Display name for the model
        description: Optional description
        context_length: Max tokens
        cost_prompt_rate: Cost per input token (optional)
        cost_output_rate: Cost per output token (optional)

    Returns:
        {
            "success": true,
            "model_key": "openai/gpt-4o-mini",
            "configmap_name": "ai-model-config",
            "status": "created" | "updated"
        }
    """
```

**Implementation Steps:**

1. **Generate Model Key**: `f"{provider}/{model_id}"`

2. **Build Model Config Object**:
   ```python
   model_config = {
       "external": True,
       "requiresApiKey": True,
       "serviceName": None,
       "provider": provider,
       "apiUrl": get_provider_api_url(provider),
       "modelName": model_id,
       "cost": {
           "prompt_rate": cost_prompt_rate or 0.0,
           "output_rate": cost_output_rate or 0.0
       }
   }
   if description:
       model_config["description"] = description
   if context_length:
       model_config["context_length"] = context_length
   ```

3. **Read Current ConfigMap** (`ai-model-config` in namespace)
   - If doesn't exist, create new ConfigMap
   - If exists, read current `model-config.json` data

4. **Merge New Model**:
   - Parse JSON from ConfigMap data
   - Add/update model entry with generated key
   - Serialize back to JSON

5. **Update ConfigMap**:
   ```python
   # Kubernetes API PATCH request
   PATCH /api/v1/namespaces/{namespace}/configmaps/ai-model-config
   {
       "data": {
           "model-config.json": json.dumps(updated_config, indent=2)
       }
   }
   ```

6. **Trigger Config Reload**:
   - Add annotation to ConfigMap: `config.kubernetes.io/last-modified: <timestamp>`
   - Backend watches ConfigMap and reloads MODEL_CONFIG on change
   - OR: Require pod restart (simpler initial implementation)

**RBAC Requirements:**
- Add ConfigMap permissions to `mcp-analyzer` ServiceAccount role:
  ```yaml
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["ai-model-config"]
    verbs: ["get", "create", "patch"]
  ```

---

**Tool 3: `get_current_model_config`**

```python
def get_current_model_config() -> Dict[str, Any]:
    """
    Retrieve current MODEL_CONFIG from ConfigMap.

    Returns:
        Current model configuration as JSON object
    """
```

**Purpose:**
- Allow frontend to fetch configured models for filtering
- Provide single source of truth for model configuration

---

#### 3. Configuration Storage

**ConfigMap Specification**

**Name:** `ai-model-config`
**Namespace:** Same as MCP server deployment
**Data Key:** `model-config.json`

**Creation via Helm:**

**File: `deploy/helm/mcp-server/templates/configmap-model-config.yaml` (NEW)**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-model-config
  namespace: {{ .Release.Namespace }}
  labels:
    app.kubernetes.io/name: mcp-server
    app.kubernetes.io/component: model-config
data:
  model-config.json: |
{{ .Files.Get "model-config.json" | indent 4 }}
```

**Deployment Changes:**

**File: `deploy/helm/mcp-server/templates/deployment.yaml`**

Update environment variable source:

```yaml
# OLD: Read from static file or values override
- name: MODEL_CONFIG
  {{- if .Values.modelConfig }}
  value: '{{ .Values.modelConfig | toJson }}'
  {{- else }}
  value: {{ .Files.Get "model-config.json" | fromJson | toJson | squote }}
  {{- end }}

# NEW: Read from ConfigMap
- name: MODEL_CONFIG
  valueFrom:
    configMapKeyRef:
      name: ai-model-config
      key: model-config.json
```

**Benefits:**
- Dynamic updates without pod restart (if backend supports config reload)
- Persistent across deployments
- Cluster-wide consistency
- Kubernetes-native storage

---

#### 4. Model Filtering Logic

Model filtering happens at two levels:

1. **Backend Filtering**: Filter out invalid/non-chat models from provider APIs
2. **Frontend Filtering**: Filter out already-configured models from dropdown

---

##### 4.1 Backend Provider-Specific Filtering

**Purpose**: Prevent invalid, non-chat, or incompatible models from appearing in the dropdown by filtering responses from provider APIs.

**OpenAI Provider Filtering** (`model_config_tools.py:154-168`):

```python
# Only include known valid GPT chat model prefixes
valid_prefixes = ["gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"]

for model in data.get("data", []):
    model_id = model.get("id", "")

    # Only include models that start with known valid chat model prefixes
    # Exclude fine-tuned models (contain ':')
    if any(model_id.startswith(prefix) for prefix in valid_prefixes) and ":" not in model_id:
        # Further exclude specific non-chat models
        exclude_keywords = ["instruct", "vision", "embedding", "tts", "whisper",
                           "dall-e", "audio", "realtime"]
        if not any(x in model_id.lower() for x in exclude_keywords):
            models.append({...})
```

**Why OpenAI Filtering is Needed**:
- OpenAI's `/v1/models` endpoint returns ALL models including embeddings, TTS, vision, audio
- Fine-tuned models (containing `:`) are user-specific and not generally available
- Non-chat models like `gpt-4-vision-preview` or `text-embedding-ada-002` don't work with chat completions
- Without filtering, users could select models like `gpt-5-mini` which don't exist, causing 404 errors

**Google Provider Filtering** (`model_config_tools.py:226-250`):

```python
for model in data.get("models", []):
    name = model.get("name", "")
    if name.startswith("models/"):
        model_id = name[7:]  # Remove "models/" prefix
        model_id_lower = model_id.lower()

        # Filter to Gemini generative models only
        if "gemini" in model_id_lower:
            # Exclude non-chat models
            exclude_keywords = ["embedding", "vision-only", "imagen", "code-only", "aqa"]
            if not any(keyword in model_id_lower for keyword in exclude_keywords):
                # Verify it supports generateContent (text generation)
                supported_methods = model.get("supportedGenerationMethods", [])
                if not supported_methods or "generateContent" in supported_methods:
                    models.append({...})
```

**Why Google Filtering is Needed**:
- Google's API returns embedding models (`embedding-001`), image models (`imagen`), and specialized models
- Some models only support specific generation methods (not text chat)
- The `supportedGenerationMethods` field indicates capabilities; we need `generateContent` for chat
- Prevents non-chat models like `text-embedding-004` or AQA (Attributed Question Answering) models

**Anthropic & Meta Providers**:
- **Anthropic**: Uses curated hardcoded list (no public API) - all models are pre-validated
- **Meta**: Uses curated hardcoded list of known Llama models - all models are pre-validated

---

##### 4.2 Frontend Configuration Filtering

**Frontend Service: `modelService.ts`**

**New Method: `getConfiguredModels()`**

```typescript
async getConfiguredModels(): Promise<string[]> {
  try {
    const config = await mcpClient.callMcpTool<{ [key: string]: any }>(
      'get_current_model_config',
      {}
    );
    return Object.keys(config);  // ["openai/gpt-4o-mini", "anthropic/claude-opus-4", ...]
  } catch (error) {
    logger.error('Failed to fetch configured models:', error);
    return [];
  }
}
```

**Filtering in AddModelTab:**

```typescript
const fetchAvailableModels = async (provider: Provider) => {
  setLoadingModels(true);
  setError(null);

  try {
    // Get available models from provider (already filtered by backend)
    const providerModels = await mcpClient.callMcpTool<ProviderModel[]>(
      'list_provider_models',
      { provider }
    );

    // Get currently configured models
    const configuredModels = await modelService.getConfiguredModels();

    // Filter out already configured models
    const filtered = providerModels.filter(model => {
      const modelKey = formatModelName(provider, model.id);
      return !configuredModels.includes(modelKey);
    });

    setAvailableModels(filtered);
  } catch (error) {
    setError(`Failed to fetch models: ${error.message}`);
    setAvailableModels([]);
  } finally {
    setLoadingModels(false);
  }
};
```

**Two-Level Filtering Result**:
1. Backend filters out invalid model types (embeddings, TTS, vision, etc.)
2. Frontend filters out already-configured models
3. User only sees valid, chat-capable, not-yet-configured models

---

## Implementation Plan

### Phase 1: Backend Foundation (Week 1)

**Tasks:**
1. Create `model_config_tools.py` with three MCP tools
2. Implement provider API integration for listing models
3. Add ConfigMap RBAC permissions to role-secrets.yaml
4. Create ConfigMap template in Helm chart
5. Update deployment to use ConfigMap for MODEL_CONFIG
6. Add unit tests for new MCP tools

**Deliverables:**
- Working MCP tools accessible from frontend
- ConfigMap-based MODEL_CONFIG storage
- Test coverage for model listing and config updates

**Risks:**
- Provider API rate limits (mitigation: cache results for 1 hour)
- Anthropic doesn't have models list API (mitigation: use hardcoded list)
- Pod restart may be required for config reload (mitigation: document requirement)

---

### Phase 2: Frontend Integration (Week 2)

**Tasks:**
1. Update AddModelTab.tsx to use dropdown instead of text input
2. Implement provider model fetching on provider selection
3. Add loading states and error handling
4. Implement model filtering logic
5. Update form submission to call new MCP tool
6. Replace localStorage-based custom model storage with ConfigMap persistence
7. Add user feedback (success/error messages)

**Deliverables:**
- Functional dropdown with dynamic model list
- Filtered model options (excluding configured models)
- ConfigMap persistence for new models

**UI/UX Considerations:**
- Show loading spinner while fetching models
- Display empty state if no new models available
- Show error state if API key missing or invalid
- Provide helpful messages (e.g., "Configure API key first")

---

### Phase 3: Testing & Documentation (Week 3)

**Tasks:**
1. End-to-end testing: Add model via UI → Verify in ConfigMap → Use in summarization
2. Test all supported providers (OpenAI, Anthropic, Google, Meta)
3. Test edge cases (no API key, invalid provider, API errors)
4. Update user documentation
5. Update operator documentation

**Deliverables:**
- Comprehensive test suite
- User guide for adding models
- Operator guide for ConfigMap management

---

## Security Considerations

1. **API Key Handling**
   - Never log API keys in plaintext
   - Retrieve from secrets, don't require user to re-enter
   - Validate API key before querying provider APIs

2. **RBAC Permissions**
   - Limit ConfigMap access to specific ConfigMap name
   - Use least-privilege principle for Kubernetes API access
   - Audit ConfigMap modifications

3. **Input Validation**
   - Validate provider name against allowlist
   - Sanitize model IDs and names
   - Prevent injection attacks in JSON serialization

4. **Rate Limiting**
   - Cache provider model lists (1-hour TTL)
   - Implement exponential backoff for API failures
   - Limit frequency of ConfigMap updates

---

## Alternative Approaches Considered

### Alternative 1: Keep localStorage, Add Sync to ConfigMap

**Approach:**
- Continue using localStorage for custom models
- Add background sync to ConfigMap
- Frontend writes to both localStorage and ConfigMap

**Pros:**
- Backward compatible
- Faster local reads

**Cons:**
- Dual storage increases complexity
- Sync conflicts possible
- localStorage still not shared across users

**Decision:** Rejected due to complexity and limited benefits

---

### Alternative 2: Use CRD (Custom Resource Definition)

**Approach:**
- Create Kubernetes CRD for AI model configurations
- Use operator pattern to watch and reconcile models
- Frontend creates CR instances via MCP

**Pros:**
- Native Kubernetes resource management
- Built-in validation and versioning
- Enables GitOps workflows

**Cons:**
- Requires operator development
- More complex deployment
- Overkill for simple config storage

**Decision:** Rejected as over-engineered for current needs; revisit in future

---

### Alternative 3: REST API Instead of MCP Tools

**Approach:**
- Create dedicated REST API endpoints for model management
- Frontend calls REST API directly
- Backend API manages ConfigMap

**Pros:**
- Standard REST patterns
- Easier to test with curl/Postman

**Cons:**
- Requires new API service or extending existing
- Breaks current MCP-based architecture
- Additional authentication/authorization layer

**Decision:** Rejected to maintain architectural consistency

---

## Success Metrics

**User Experience:**
- Time to add new model reduced by 70% (no manual ID lookup)
- Zero user-reported issues with model availability
- 90% of users can successfully add models without documentation

**Technical:**
- Model configuration persists across browser sessions (100%)
- Models added by one user visible to all cluster users (cluster-wide)
- ConfigMap updates complete within 2 seconds (p95 latency)

**Operational:**
- ConfigMap size remains under 1MB (supports 100+ models)
- Model list API calls cached, reducing external API calls by 90%
- No manual pod restarts required for config updates (stretch goal)

---

## Open Questions

1. **Config Reload Mechanism**
   - Should backend auto-reload MODEL_CONFIG on ConfigMap change?
   - Or require pod restart? (Simpler but less dynamic)
   - **Recommendation:** Start with pod restart requirement, add hot-reload in future

2. **Cost Information**
   - Should we fetch cost info from provider APIs or user-provided?
   - Providers rarely expose pricing via API
   - **Recommendation:** Allow optional manual entry, default to 0.0

3. **Model Validation**
   - Should we validate model works before adding to config?
   - Makes flow slower but prevents invalid configs
   - **Recommendation:** Add "Test Model" optional step, not required

4. **Multi-Namespace Support**
   - Should ConfigMap be namespace-scoped or cluster-wide?
   - **Recommendation:** Namespace-scoped for security isolation

5. **Versioning**
   - How to handle model config schema changes?
   - **Recommendation:** Add `schemaVersion` field to ConfigMap for future migrations

---

## Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Provider API rate limits | Users can't fetch models | Medium | Cache results 1 hour; provide fallback static lists |
| ConfigMap size limit (1MB) | Can't add more models | Low | Monitor size; implement cleanup for unused models |
| ConfigMap update failures | Model not saved | Medium | Retry logic with exponential backoff; show clear error |
| API key missing/invalid | Can't list models | High | Show clear error; link to API Keys tab; allow manual entry |
| Pod restart required | Config not active immediately | Medium | Document requirement; add hot-reload in future phase |

---

## Appendix A: API Response Examples

### OpenAI Models List

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "created": 1721172717,
      "owned_by": "system"
    },
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1715367049,
      "owned_by": "system"
    }
  ]
}
```

### Google Models List

```json
{
  "models": [
    {
      "name": "models/gemini-2.5-flash",
      "displayName": "Gemini 2.5 Flash",
      "description": "Fast and versatile performance",
      "inputTokenLimit": 1048576,
      "outputTokenLimit": 8192
    }
  ]
}
```

### Anthropic Models (Hardcoded)

```json
[
  {
    "id": "claude-opus-4-1-20250805",
    "name": "Claude Opus 4.1",
    "description": "Most capable model",
    "context_length": 200000
  },
  {
    "id": "claude-sonnet-4-20250514",
    "name": "Claude Sonnet 4",
    "description": "Balanced performance",
    "context_length": 200000
  }
]
```

---

## Appendix B: ConfigMap Example

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-model-config
  namespace: ai-observability
  annotations:
    config.kubernetes.io/last-modified: "2025-12-19T10:30:00Z"
  labels:
    app.kubernetes.io/name: mcp-server
    app.kubernetes.io/component: model-config
data:
  model-config.json: |
    {
      "openai/gpt-4o-mini": {
        "external": true,
        "requiresApiKey": true,
        "serviceName": null,
        "provider": "openai",
        "apiUrl": "https://api.openai.com/v1/chat/completions",
        "modelName": "gpt-4o-mini",
        "cost": {
          "prompt_rate": 0.00000015,
          "output_rate": 0.0000006
        }
      },
      "anthropic/claude-opus-4-1-20250805": {
        "external": true,
        "requiresApiKey": true,
        "serviceName": null,
        "provider": "anthropic",
        "apiUrl": "https://api.anthropic.com/v1/messages",
        "modelName": "claude-opus-4-1-20250805",
        "cost": {
          "prompt_rate": 0.000015,
          "output_rate": 0.000075
        }
      }
    }
```

---

## Appendix C: RBAC Updates

```yaml
# Add to deploy/helm/mcp-server/templates/role-secrets.yaml

apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: mcp-read-ai-credentials
  namespace: {{ .Release.Namespace }}
rules:
  # Existing secret permissions
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create"]
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames:
      - ai-openai-credentials
      - ai-anthropic-credentials
      - ai-google-credentials
      - ai-meta-credentials
    verbs: ["get", "patch"]

  # NEW: ConfigMap permissions for model config
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames:
      - ai-model-config
    verbs: ["get", "create", "patch", "update"]
```

---

## Conclusion

This proposal provides a comprehensive plan to enhance the Add Model functionality with:

- **User-friendly dropdown** populated from provider APIs
- **Smart filtering** to prevent duplicate models
- **Cluster-wide persistence** via Kubernetes ConfigMap
- **Secure API key handling** with existing secret management

The phased implementation approach allows for incremental delivery and testing while minimizing risk. The ConfigMap-based storage aligns with Kubernetes best practices and provides a foundation for future enhancements like GitOps integration.

**Next Steps:**
1. Review and approve this proposal
2. Begin Phase 1 implementation (Backend MCP tools)
3. Schedule design review for UI changes
4. Plan testing strategy with QA team

---

**Document Version:** 1.2
**Last Updated:** 2025-12-19
**Changes:**
- v1.1: Removed migration strategy section (not applicable for new development)
- v1.2: Added detailed backend provider-specific filtering logic for OpenAI and Google providers
**Review By:** [To be assigned]
