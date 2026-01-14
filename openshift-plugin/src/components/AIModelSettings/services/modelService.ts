import { Model, Provider, AIModelState, ModelFormData, ProviderModel } from '../types/models';
import { formatModelName, parseModelName } from './providerTemplates';
import { secretManager } from './secretManager';
import { listSummarizationModels, callMcpTool } from '../../../services/mcpClient';
import { isDevMode } from '../../../services/devCredentials';

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
   * Load all available models from MCP server
   */
  async loadAvailableModels(): Promise<{ internal: Model[]; external: Model[]; custom: Model[] }> {
    try {
      // Get models with metadata from MCP server (includes ConfigMap models)
      const mcpModelsData = await listSummarizationModels();

      // Transform and categorize models
      const transformedModels = mcpModelsData.map(modelData => this.transformMcpModelWithMetadata(modelData));

      // Load custom models from localStorage
      const customModels = this.loadCustomModels();

      // Separate into categories
      const internal: Model[] = [];
      const external: Model[] = [];

      transformedModels.forEach(model => {
        if (model.type === 'internal') {
          internal.push(model);
        } else {
          external.push(model);
        }
      });

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
   * Get configured models from ConfigMap (for duplicate checking)
   * Uses the same tool as loadAvailableModels - single source of truth
   */
  async getConfiguredModels(): Promise<string[]> {
    try {
      // Use list_summarization_models for consistency
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
   * Add a new model to ConfigMap (both dev and production modes)
   * Dev mode only affects where API keys are stored, not models
   */
  async addModelToConfig(formData: ModelFormData): Promise<{ success: boolean; model_key: string; message: string }> {
    try {
      // Always add to ConfigMap via MCP tool (dev and production)
      // The server needs the model config to know how to call the LLM
      const response = await callMcpTool<any>(
        'add_model_to_config',
        {
          provider: formData.provider,
          model_id: formData.modelId,
          model_name: formData.modelId, // Use modelId as name for now
          description: formData.description,
        }
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