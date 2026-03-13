/**
 * Dev Mode Credentials Manager
 * Stores API keys in browser sessionStorage when DEV_MODE env var is enabled
 */

import { isDevMode } from './runtimeConfig';

export interface DevCredentials {
  [provider: string]: {
    apiKey: string;
    modelId?: string;
    savedAt: string;
  };
}

export interface DevModelConfig {
  name: string;
  provider: string;
  modelId: string;
  description?: string;
  endpoint?: string;
  apiKey?: string;
  savedAt: string;
}

const DEV_CREDENTIALS_KEY = 'ai_observability_dev_credentials';
const DEV_MODELS_KEY = 'ai_observability_dev_models';

/**
 * Save API key to browser session
 */
export function saveDevCredential(provider: string, apiKey: string, modelId?: string): void {
  if (!isDevMode()) {
    console.warn('[DevMode] Attempted to save dev credential but dev mode is disabled');
    return;
  }

  const creds = getDevCredentials();
  creds[provider] = {
    apiKey,
    modelId,
    savedAt: new Date().toISOString(),
  };

  sessionStorage.setItem(DEV_CREDENTIALS_KEY, JSON.stringify(creds));
  console.log(`[DevMode] Cached ${provider} API key in browser session`);
}

/**
 * Get API key from browser session
 */
export function getDevCredential(provider: string): string | null {
  if (!isDevMode()) {
    return null;
  }

  const creds = getDevCredentials();
  return creds[provider]?.apiKey || null;
}

/**
 * Get all dev credentials
 */
export function getDevCredentials(): DevCredentials {
  if (!isDevMode()) {
    return {};
  }

  try {
    const stored = sessionStorage.getItem(DEV_CREDENTIALS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('[DevMode] Failed to parse credentials:', e);
    return {};
  }
}

/**
 * Check if provider has cached credential
 */
export function hasDevCredential(provider: string): boolean {
  return getDevCredential(provider) !== null;
}

/**
 * Clear all dev credentials
 */
export function clearDevCredentials(): void {
  sessionStorage.removeItem(DEV_CREDENTIALS_KEY);
  console.log('[DevMode] Cleared all cached credentials');
}

/**
 * List all cached providers
 */
export function listDevProviders(): string[] {
  const creds = getDevCredentials();
  return Object.keys(creds);
}

/**
 * Save model configuration to browser session (DEV mode only)
 */
export function saveDevModel(config: DevModelConfig): void {
  if (!isDevMode()) {
    console.warn('[DevMode] Attempted to save dev model but dev mode is disabled');
    return;
  }

  const models = getDevModels();
  const modelKey = config.name;
  models[modelKey] = {
    ...config,
    savedAt: new Date().toISOString(),
  };

  sessionStorage.setItem(DEV_MODELS_KEY, JSON.stringify(models));
  console.log(`[DevMode] Cached model ${modelKey} in browser session`);
}

/**
 * Get all dev model configurations
 */
export function getDevModels(): Record<string, DevModelConfig> {
  if (!isDevMode()) {
    return {};
  }

  try {
    const stored = sessionStorage.getItem(DEV_MODELS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('[DevMode] Failed to parse model configs:', e);
    return {};
  }
}

/**
 * Get a specific dev model configuration
 */
export function getDevModel(modelName: string): DevModelConfig | null {
  if (!isDevMode()) {
    return null;
  }

  const models = getDevModels();
  return models[modelName] || null;
}

/**
 * Check if a model exists in dev storage
 */
export function hasDevModel(modelName: string): boolean {
  return getDevModel(modelName) !== null;
}

/**
 * Delete a model from dev storage
 */
export function deleteDevModel(modelName: string): void {
  if (!isDevMode()) {
    return;
  }

  const models = getDevModels();
  delete models[modelName];
  sessionStorage.setItem(DEV_MODELS_KEY, JSON.stringify(models));
  console.log(`[DevMode] Deleted model ${modelName} from browser session`);
}

/**
 * Clear all dev models
 */
export function clearDevModels(): void {
  sessionStorage.removeItem(DEV_MODELS_KEY);
  console.log('[DevMode] Cleared all cached models');
}
