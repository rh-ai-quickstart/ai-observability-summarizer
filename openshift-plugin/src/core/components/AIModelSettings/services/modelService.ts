import { Model, Provider, AIModelState, ModelFormData, ProviderModel } from '../types/models';
import { formatModelName, parseModelName } from './providerTemplates';
import { secretManager } from './secretManager';
import { listSummarizationModels, callMcpTool } from '../../../services/mcpClient';
import { saveDevModel, getDevModels, DevModelConfig } from '../../../services/devCredentials';
import { isDevMode } from '../../../services/runtimeConfig';

/**
 * Get the appropriate storage mechanism based on dev mode
 * - sessionStorage in dev mode (cleared on tab close)
 * - localStorage in production mode (persists across sessions)
 */
function getStorage(): Storage {
  return isDevMode() ? sessionStorage : localStorage;
}

class ModelService {
  /**
   * Load all available models from MCP server (production) or browser storage (dev mode)
   * In DEV mode: tries browser storage first, falls back to MCP server if empty
   */
  async loadAvailableModels(): Promise<{ internal: Model[]; external: Model[]; custom: Model[] }> {
    try {
      const internal: Model[] = [];
      const external: Model[] = [];

      // In DEV mode, load models from both MCP server and browser sessionStorage
      if (isDevMode()) {
        console.log('[ModelService] DEV MODE: Loading models from MCP server and dev storage');

        // First, fetch base models from MCP server (internal + default external models)
        const mcpModelsData = await listSummarizationModels();
        const transformedModels = mcpModelsData.map(modelData => this.transformMcpModelWithMetadata(modelData));

        transformedModels.forEach(model => {
          if (model.type === 'internal') {
            internal.push(model);
          } else {
            external.push(model);
          }
        });

        console.log(`[ModelService] Fetched ${internal.length} internal and ${external.length} external models from MCP server`);

        // Then, add user-added models from dev storage
        const devModels = getDevModels();
        const devModelCount = Object.keys(devModels).length;

        if (devModelCount > 0) {
          console.log(`[ModelService] Found ${devModelCount} user-added models in dev storage`);

          // Get existing model names to avoid duplicates
          const existingNames = new Set([...internal, ...external].map(m => m.name));

          Object.values(devModels).forEach((devModel: DevModelConfig) => {
            // Only add if not already in the list (avoid duplicates)
            if (!existingNames.has(devModel.name)) {
              const model: Model = {
                id: devModel.name,
                name: devModel.name,
                provider: devModel.provider as Provider,
                modelId: devModel.modelId,
                type: 'external', // Dev models are external by default
                requiresApiKey: true,
                isAvailable: true,
                description: devModel.description,
                endpoint: devModel.endpoint,
              };
              external.push(model);
              console.log(`[ModelService] Added user model: ${devModel.name}`);
            }
          });
        }
      } else {
        // Production mode: Get models from MCP server (ConfigMap)
        const mcpModelsData = await listSummarizationModels();

        // Transform and categorize models
        const transformedModels = mcpModelsData.map(modelData => this.transformMcpModelWithMetadata(modelData));

        transformedModels.forEach(model => {
          if (model.type === 'internal') {
            internal.push(model);
          } else {
            external.push(model);
          }
        });
      }

      // Load custom models from browser storage (works in both modes)
      const customModels = this.loadCustomModels();

      return { internal, external, custom: customModels };
    } catch (error) {
      console.error('Error loading available models:', error);
      throw new Error('Failed to load available models from server');
    }
  }

  /**
   * Transform MCP model data with metadata to our Model interface
   */
  private transformMcpModelWithMetadata(modelData: any): Model {
    // Use metadata from backend instead of detecting
    const modelName = modelData.name;
    const external = modelData.external !== false; // Default to true if not specified
    const requiresApiKey = modelData.requiresApiKey !== false; // Default to true if not specified
    const provider = modelData.provider || 'unknown';

    let modelId: string;
    // Extract modelId from the name
    if (modelName.includes('/')) {
      const parsed = parseModelName(modelName);
      modelId = parsed.modelId;
    } else {
      modelId = modelData.modelName || modelName;
    }

    return {
      id: modelName,
      name: modelName,
      provider: provider as Provider,
      modelId,
      type: external ? 'external' : 'internal',
      requiresApiKey,
      isAvailable: true,
      description: modelData.description,
    };
  }

  /**
   * Load custom models from browser storage
   * Uses sessionStorage in dev mode, localStorage in production
   */
  loadCustomModels(): Model[] {
    try {
      const stored = getStorage().getItem('ai_custom_models');
      if (!stored) {
        return [];
      }

      const customModels: Model[] = JSON.parse(stored);
      return customModels.map(model => ({
        ...model,
        type: 'custom' as const,
        isAvailable: true,
      }));
    } catch (error) {
      console.error('Error loading custom models:', error);
      return [];
    }
  }


  /**
   * Save custom models to browser storage
   * Uses sessionStorage in dev mode, localStorage in production
   */
  saveCustomModels(models: Model[]): void {
    try {
      const customModels = models.filter(m => m.type === 'custom');
      getStorage().setItem('ai_custom_models', JSON.stringify(customModels));
    } catch (error) {
      console.error('Error saving custom models:', error);
      throw new Error('Failed to save custom models');
    }
  }

  /**
   * Add a new custom model
   */
  async addCustomModel(formData: ModelFormData): Promise<Model> {
    const modelName = formatModelName(formData.provider, formData.modelId);
    
    // Check for duplicates across all models
    const { internal, external, custom } = await this.loadAvailableModels();
    const allModels = [...internal, ...external, ...custom];
    
    if (allModels.some(m => m.name === modelName)) {
      throw new Error(`Model ${modelName} already exists`);
    }
    
    // Create new model
    const newModel: Model = {
      id: `custom-${Date.now()}`,
      name: modelName,
      provider: formData.provider,
      modelId: formData.modelId,
      type: 'custom',
      requiresApiKey: formData.provider !== 'internal',
      endpoint: formData.endpoint,
      description: formData.description,
      isAvailable: true,
    };
    
    // Save API key if provided (always to OpenShift secret)
    if (formData.apiKey && newModel.requiresApiKey) {
      try {
        await secretManager.saveProviderSecret({
          provider: formData.provider,
          apiKey: formData.apiKey,
          endpoint: formData.endpoint,
          modelId: formData.modelId,
          metadata: {
            description: formData.description || `Custom model: ${modelName}`,
            createdBy: 'ai-model-settings',
            lastUpdated: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.warn('Failed to save API key to secret, model added without credentials:', error);
      }
    }
    
    // Add to custom models list
    const updatedCustomModels = [...custom, newModel];
    this.saveCustomModels(updatedCustomModels);
    
    return newModel;
  }

  /**
   * Remove a custom model
   */
  async removeCustomModel(modelId: string): Promise<void> {
    const customModels = this.loadCustomModels();
    const modelToRemove = customModels.find(m => m.id === modelId);
    
    if (!modelToRemove) {
      throw new Error('Custom model not found');
    }
    
    // Remove from localStorage
    const updatedModels = customModels.filter(m => m.id !== modelId);
    this.saveCustomModels(updatedModels);
    
    // Optionally clean up associated secrets
    // Note: This is conservative - we don't auto-delete secrets in case they're shared
    console.log(`Custom model ${modelToRemove.name} removed. Associated secrets (if any) were not automatically deleted.`);
  }

  /**
   * Get current selected model from session config
   * Uses sessionStorage in dev mode, localStorage in production
   */
  getCurrentModel(): string | null {
    try {
      const config = getStorage().getItem('openshift_ai_observability_config');
      if (config) {
        const parsed = JSON.parse(config);
        return parsed.ai_model || null;
      }
    } catch (error) {
      console.error('Error loading current model:', error);
    }
    return null;
  }

  /**
   * Set current selected model in session config
   * Uses sessionStorage in dev mode, localStorage in production
   */
  setCurrentModel(modelName: string): void {
    try {
      let config: any = {};

      // Load existing config
      const existingConfig = getStorage().getItem('openshift_ai_observability_config');
      if (existingConfig) {
        config = JSON.parse(existingConfig);
      }

      // Update model selection
      config.ai_model = modelName;

      // Save updated config
      getStorage().setItem('openshift_ai_observability_config', JSON.stringify(config));
    } catch (error) {
      console.error('Error saving current model:', error);
      throw new Error('Failed to save model selection');
    }
  }

  /**
   * Check if a model is available and properly configured
   */
  async isModelReady(modelName: string): Promise<{ ready: boolean; reason?: string }> {
    try {
      const { internal, external, custom } = await this.loadAvailableModels();
      const allModels = [...internal, ...external, ...custom];

      const model = allModels.find(m => m.name === modelName);
      if (!model) {
        return { ready: false, reason: 'Model not found' };
      }

      if (!model.requiresApiKey) {
        return { ready: true };
      }

      // MAAS models use per-model API keys stored when the model is added
      // If a MAAS model exists in the config, it has its API key configured
      if (model.provider === 'maas') {
        return { ready: true };
      }

      // Check if API key is available in OpenShift secret
      const secretStatus = await secretManager.checkProviderSecret(model.provider);

      if (!secretStatus.exists) {
        return { ready: false, reason: 'API key required' };
      }

      return { ready: true };
    } catch (error) {
      console.error('Error checking model readiness:', error);
      return { ready: false, reason: 'Error checking model status' };
    }
  }

  /**
   * Get configured models from ConfigMap (production) or browser storage (dev mode)
   * Used for duplicate checking
   */
  async getConfiguredModels(): Promise<string[]> {
    try {
      // In DEV mode, get models from browser sessionStorage
      if (isDevMode()) {
        const devModels = getDevModels();
        return Object.keys(devModels);
      }

      // Production mode: Use list_summarization_models
      const modelsData = await listSummarizationModels();
      // Extract just the names
      return modelsData.map(m => m.name || m);
    } catch (error) {
      console.error('Failed to fetch configured models:', error);
      return [];
    }
  }

  /**
   * List available models from a provider
   */
  async listProviderModels(provider: Provider, apiKey?: string): Promise<ProviderModel[]> {
    try {
      const response = await callMcpTool<any>(
        'list_provider_models',
        { provider, api_key: apiKey }
      );

      console.log('Raw MCP response:', response);

      // Handle different response formats
      let data: any;

      if (typeof response === 'string') {
        // If it's a string, try to parse it
        try {
          data = JSON.parse(response);
        } catch (parseError) {
          console.error('Failed to parse response string:', response);
          throw new Error(`Invalid response format: ${response.substring(0, 100)}`);
        }
      } else if (response && typeof response === 'object') {
        // If it's already an object, use it directly
        data = response;
      } else {
        console.error('Unexpected response type:', typeof response, response);
        throw new Error('Unexpected response format from server');
      }

      // Check for error response
      if (data.error) {
        throw new Error(data.message || 'Unknown error from server');
      }

      // Validate data structure
      if (!data.models || !Array.isArray(data.models)) {
        console.error('Invalid data structure:', data);
        throw new Error('Server returned invalid data structure');
      }

      return data.models;
    } catch (error) {
      console.error('Failed to list provider models:', error);
      throw new Error(`Failed to fetch models from ${provider}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add a new model to ConfigMap (production) or browser storage (dev mode)
   */
  async addModelToConfig(formData: ModelFormData): Promise<{ success: boolean; model_key: string; message: string }> {
    try {
      const modelKey = formatModelName(formData.provider, formData.modelId);

      // DEV MODE: Save to browser sessionStorage
      if (isDevMode()) {
        console.log(`[ModelService] DEV MODE: Saving model ${modelKey} to browser storage`);

        // Normalize endpoint URL to match backend behavior
        let normalizedEndpoint = formData.endpoint;
        if (normalizedEndpoint) {
          // For MAAS, append /chat/completions if not already present
          if (formData.provider === 'maas' && !normalizedEndpoint.includes('/chat/completions')) {
            normalizedEndpoint = `${normalizedEndpoint.replace(/\/$/, '')}/chat/completions`;
          }
          // For other OpenAI-compatible providers, ensure /chat/completions path
          else if (['openai', 'meta', 'other'].includes(formData.provider) && !normalizedEndpoint.includes('/chat/completions') && !normalizedEndpoint.includes('/responses')) {
            normalizedEndpoint = `${normalizedEndpoint.replace(/\/$/, '')}/chat/completions`;
          }
          // For Google, keep as-is (uses different format)
          // For Anthropic, keep as-is (uses different format)
        }

        // Save model configuration to dev storage
        const devModelConfig: DevModelConfig = {
          name: modelKey,
          provider: formData.provider,
          modelId: formData.modelId,
          description: formData.description,
          endpoint: normalizedEndpoint,
          apiKey: formData.apiKey, // Store API key in model config for dev mode
          savedAt: new Date().toISOString(),
        };

        saveDevModel(devModelConfig);

        return {
          success: true,
          model_key: modelKey,
          message: `Model ${modelKey} saved to browser storage (dev mode)`
        };
      }

      // PRODUCTION MODE: Add to ConfigMap via MCP tool
      const params: any = {
        provider: formData.provider,
        model_id: formData.modelId,
        model_name: formData.modelId, // Use modelId as name for now
        description: formData.description,
      };

      // For MAAS models, include per-model API key and custom endpoint
      if (formData.provider === 'maas') {
        if (formData.apiKey) {
          params.api_key = formData.apiKey;
        }
        if (formData.endpoint) {
          params.api_url = formData.endpoint;
        }
      }

      const response = await callMcpTool<any>(
        'add_model_to_config',
        params
      );

      console.log('Add model response:', response);

      // Handle MCP text response format
      let data: any;
      if (typeof response === 'string') {
        // Direct string response
        try {
          data = JSON.parse(response);
        } catch (parseError) {
          console.error('Failed to parse add model response:', response);
          throw new Error('Invalid response from server');
        }
      } else if (response && typeof response === 'object') {
        // MCP response format: {type: "text", text: "..."}
        if (response.type === 'text' && typeof response.text === 'string') {
          try {
            data = JSON.parse(response.text);
          } catch (parseError) {
            console.error('Failed to parse MCP text response:', response.text);
            throw new Error('Invalid response from server');
          }
        } else if (response.success !== undefined) {
          // Already parsed object
          data = response;
        } else {
          console.error('Unexpected response format:', response);
          throw new Error('Unexpected response format from server');
        }
      } else {
        throw new Error('Invalid response from server');
      }

      return {
        success: data.success,
        model_key: data.model_key,
        message: data.message || `Model ${data.model_key} added successfully`
      };
    } catch (error) {
      console.error('Failed to add model to config:', error);
      throw new Error(`Failed to add model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update API key (and optionally endpoint) for an existing MAAS model
   */
  async updateMaasModelApiKey(formData: ModelFormData): Promise<{ success: boolean; model_key: string; message: string }> {
    try {
      const modelKey = formatModelName(formData.provider, formData.modelId);

      // DEV MODE: Update sessionStorage
      if (isDevMode()) {
        console.log(`[ModelService] DEV MODE: Updating MAAS model ${modelKey} in browser storage`);

        const devModels = getDevModels();
        if (!devModels[modelKey]) {
          throw new Error(`Model ${modelKey} not found in dev storage`);
        }

        // Update the model config
        let normalizedEndpoint = formData.endpoint;
        if (normalizedEndpoint && !normalizedEndpoint.includes('/chat/completions')) {
          normalizedEndpoint = `${normalizedEndpoint.replace(/\/$/, '')}/chat/completions`;
        }

        const updatedConfig: DevModelConfig = {
          ...devModels[modelKey],
          apiKey: formData.apiKey, // Update API key
          endpoint: normalizedEndpoint || devModels[modelKey].endpoint, // Update endpoint if provided
          savedAt: new Date().toISOString(),
        };

        saveDevModel(updatedConfig);

        return {
          success: true,
          model_key: modelKey,
          message: `Model ${modelKey} updated in browser storage (dev mode)`
        };
      }

      // PRODUCTION MODE: Update via MCP tool
      const params: any = {
        model_id: formData.modelId,
        api_key: formData.apiKey,
      };

      if (formData.endpoint) {
        params.api_url = formData.endpoint;
      }

      const response = await callMcpTool<any>(
        'update_maas_model_api_key',
        params
      );

      console.log('Update MAAS model response:', response);

      // Parse response
      let data: any;
      if (typeof response === 'string') {
        try {
          data = JSON.parse(response);
        } catch (parseError) {
          console.error('Failed to parse update response:', response);
          throw new Error('Invalid response from server');
        }
      } else if (response && typeof response === 'object') {
        if (response.type === 'text' && typeof response.text === 'string') {
          try {
            data = JSON.parse(response.text);
          } catch (parseError) {
            console.error('Failed to parse MCP text response:', response.text);
            throw new Error('Invalid response from server');
          }
        } else if (response.success !== undefined) {
          data = response;
        } else {
          console.error('Unexpected response format:', response);
          throw new Error('Unexpected response format from server');
        }
      } else {
        throw new Error('Invalid response from server');
      }

      if (!data.success) {
        throw new Error(data.message || 'Failed to update MAAS model');
      }

      return {
        success: data.success,
        model_key: data.model_key,
        message: data.message || `Model ${data.model_key} updated successfully`
      };
    } catch (error) {
      console.error('Failed to update MAAS model:', error);
      throw new Error(`Failed to update model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Initialize default state
   */
  getInitialState(): AIModelState {
    return {
      internalModels: [],
      externalModels: [],
      customModels: [],
      selectedModel: this.getCurrentModel(),
      providers: {
        openai: { provider: 'openai', status: 'missing', storage: 'none' },
        anthropic: { provider: 'anthropic', status: 'missing', storage: 'none' },
        google: { provider: 'google', status: 'missing', storage: 'none' },
        meta: { provider: 'meta', status: 'missing', storage: 'none' },
        maas: { provider: 'maas', status: 'missing', storage: 'none' },
        internal: { provider: 'internal', status: 'configured', storage: 'none' },
        other: { provider: 'other', status: 'missing', storage: 'none' },
      },
      loading: {
        models: false,
        secrets: false,
        testing: false,
        saving: false,
      },
      activeTab: 'models',
      error: null,
      success: null,
    };
  }
}

// Export singleton instance
export const modelService = new ModelService();

// Export the class for testing
export { ModelService };