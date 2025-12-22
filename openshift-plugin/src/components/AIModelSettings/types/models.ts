export type Provider = 'openai' | 'anthropic' | 'google' | 'meta' | 'internal' | 'other';

export type StorageType = 'secret' | 'none';

export type CredentialStatus = 'configured' | 'missing' | 'invalid' | 'testing';

export interface Model {
  id: string;
  name: string;
  provider: Provider;
  modelId: string;
  type: 'internal' | 'external' | 'custom';
  requiresApiKey: boolean;
  endpoint?: string;
  description?: string;
  isAvailable?: boolean;
}

export interface ProviderCredential {
  provider: Provider;
  status: CredentialStatus;
  storage: StorageType;
  secretName?: string;
  lastTested?: string;
  isValid?: boolean;
  lastUpdated?: string;
  createdBy?: string;
}

export interface SecretConfig {
  provider: Provider;
  apiKey: string;
  endpoint?: string;
  modelId?: string;
  metadata?: {
    description?: string;
    createdBy?: string;
    lastUpdated?: string;
  };
}

export interface SecretStatus {
  exists: boolean;
  secretName: string;
  lastUpdated?: string;
  isValid?: boolean;
  error?: string;
}

export interface AIModelState {
  // Available models from MCP and custom
  internalModels: Model[];
  externalModels: Model[];
  customModels: Model[];
  
  // Selected model
  selectedModel: string | null;
  
  // Provider credentials status
  providers: Record<Provider, ProviderCredential>;
  
  // UI state
  loading: {
    models: boolean;
    secrets: boolean;
    testing: boolean;
    saving: boolean;
  };
  
  // Current active tab
  activeTab: 'models' | 'apikeys' | 'addmodel';
  
  // Error and success messages
  error: string | null;
  success: string | null;
}

export interface ProviderTemplate {
  provider: Provider;
  label: string;
  description: string;
  defaultEndpoint: string;
  requiresApiKey: boolean;
  iconClass?: string;
  color?: string;
  commonModels?: string[];
  documentationUrl?: string;
}

export interface ModelFormData {
  provider: Provider;
  modelId: string;
  endpoint?: string;
  description?: string;
  apiKey?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  details?: {
    responseTime?: number;
    modelCount?: number;
    supportedFeatures?: string[];
  };
}

export interface ProviderModel {
  id: string;              // Model ID from provider
  name: string;            // Display name
  description?: string;    // Model description
  context_length?: number; // Token limit
  created?: number;        // Release date (timestamp)
  owned_by?: string;       // Owner/organization
}