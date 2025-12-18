import { Provider, ProviderTemplate } from '../types/models';

export const PROVIDER_TEMPLATES: Record<Provider, ProviderTemplate> = {
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    description: 'GPT models from OpenAI including GPT-4, GPT-3.5',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    requiresApiKey: true,
    iconClass: 'fa-brain',
    color: '#10a37f',
    commonModels: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o'],
    documentationUrl: 'https://platform.openai.com/docs/api-reference',
  },
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models from Anthropic for advanced reasoning',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    requiresApiKey: true,
    iconClass: 'fa-robot',
    color: '#d97706',
    commonModels: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku', 'claude-3-5-sonnet'],
    documentationUrl: 'https://docs.anthropic.com/claude/reference/getting-started-with-the-api',
  },
  google: {
    provider: 'google',
    label: 'Google',
    description: 'Gemini and other Google AI models',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    requiresApiKey: true,
    iconClass: 'fa-google',
    color: '#4285f4',
    commonModels: ['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    documentationUrl: 'https://ai.google.dev/docs',
  },
  meta: {
    provider: 'meta',
    label: 'Meta',
    description: 'LLaMA and other Meta AI models',
    defaultEndpoint: 'https://api.llama-api.com/v1/chat/completions',
    requiresApiKey: true,
    iconClass: 'fa-meta',
    color: '#1877f2',
    commonModels: ['llama-2-7b', 'llama-2-13b', 'llama-2-70b', 'llama-3-8b'],
    documentationUrl: 'https://llama.meta.com/docs/',
  },
  internal: {
    provider: 'internal',
    label: 'Cluster Models',
    description: 'Models running on your OpenShift cluster',
    defaultEndpoint: '',
    requiresApiKey: false,
    iconClass: 'fa-server',
    color: '#06b6d4',
    commonModels: [],
    documentationUrl: '',
  },
  other: {
    provider: 'other',
    label: 'Custom Provider',
    description: 'Custom AI provider with configurable endpoint',
    defaultEndpoint: 'https://api.example.com/v1/chat/completions',
    requiresApiKey: true,
    iconClass: 'fa-cog',
    color: '#6b7280',
    commonModels: [],
    documentationUrl: '',
  },
};

export const getProviderTemplate = (provider: Provider): ProviderTemplate => {
  return PROVIDER_TEMPLATES[provider];
};

export const getAllProviders = (): ProviderTemplate[] => {
  return Object.values(PROVIDER_TEMPLATES);
};

export const getExternalProviders = (): ProviderTemplate[] => {
  return Object.values(PROVIDER_TEMPLATES).filter(p => p.requiresApiKey && p.provider !== 'other');
};

export const formatModelName = (provider: Provider, modelId: string): string => {
  return `${provider}/${modelId}`;
};

export const parseModelName = (modelName: string): { provider: Provider; modelId: string } => {
  const parts = modelName.split('/');
  if (parts.length >= 2) {
    return {
      provider: parts[0] as Provider,
      modelId: parts.slice(1).join('/'),
    };
  }
  
  // Fallback for models without provider prefix
  return {
    provider: 'internal',
    modelId: modelName,
  };
};

export const detectProvider = (modelName: string): Provider => {
  const lowerName = modelName.toLowerCase();
  
  if (lowerName.includes('gpt') || lowerName.includes('openai')) {
    return 'openai';
  }
  if (lowerName.includes('claude') || lowerName.includes('anthropic')) {
    return 'anthropic';
  }
  if (lowerName.includes('gemini') || lowerName.includes('google') || lowerName.includes('bard')) {
    return 'google';
  }
  if (lowerName.includes('llama') || lowerName.includes('meta')) {
    return 'meta';
  }
  
  return 'internal';
};

export const generateSecretName = (provider: Provider, modelId?: string): string => {
  const base = `ai-${provider}-credentials`;
  if (modelId) {
    return `${base}-${modelId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
  }
  return base;
};

export const isValidApiKey = (provider: Provider, apiKey: string): boolean => {
  if (!apiKey || apiKey.trim().length === 0) {
    return false;
  }
  
  switch (provider) {
    case 'openai':
      return apiKey.startsWith('sk-') && apiKey.length > 20;
    case 'anthropic':
      return apiKey.startsWith('sk-ant-') && apiKey.length > 30;
    case 'google':
      return apiKey.length > 20; // Google API keys vary in format
    case 'meta':
      return apiKey.length > 10; // Meta API keys vary in format
    default:
      return apiKey.length > 10; // Generic validation
  }
};