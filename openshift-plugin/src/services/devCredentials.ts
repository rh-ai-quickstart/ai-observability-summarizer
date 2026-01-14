/**
 * Dev Mode Credentials Manager
 * Stores API keys in browser sessionStorage when DEV_MODE env var is enabled
 */

import { isDevMode as isDevModeFromConfig } from './runtimeConfig';

export interface DevCredentials {
  [provider: string]: {
    apiKey: string;
    modelId?: string;
    savedAt: string;
  };
}

const DEV_CREDENTIALS_KEY = 'ai_observability_dev_credentials';

/**
 * Check if running in dev mode (reads from runtime config)
 */
export function isDevMode(): boolean {
  return isDevModeFromConfig();
}

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
