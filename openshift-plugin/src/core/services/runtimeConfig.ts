/**
 * Runtime Configuration
 * Fetched from MCP server's /config endpoint
 * Works in all deployment modes: console plugin, react-ui, and local dev
 */

import { getDeploymentMode } from '../../shared/config';

export interface RuntimeConfig {
  devMode: boolean;
}

let cachedConfig: RuntimeConfig | null = null;
let configPromise: Promise<RuntimeConfig> | null = null;

/**
 * Get config endpoint URL based on deployment mode
 */
function getConfigUrl(): string {
  const isLocalDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';

  if (isLocalDev) {
    // Local development: direct connection to MCP server
    console.log('[RuntimeConfig] Detected local development mode');
    return 'http://localhost:8085/config';
  }

  const mode = getDeploymentMode();
  console.log(`[RuntimeConfig] Detected deployment mode: ${mode}`);
  console.log(`[RuntimeConfig] window.location:`, {
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    href: window.location.href
  });

  if (mode === 'plugin') {
    // Console plugin uses console proxy
    return '/api/proxy/plugin/aiobs-console-plugin/mcp/config';
  } else {
    // React UI uses nginx proxy
    return '/api/config';
  }
}

/**
 * Fetch runtime configuration from MCP server
 * Uses promise caching to prevent race conditions when multiple components
 * call this function simultaneously during app initialization.
 */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  // Return in-flight promise if already fetching
  if (configPromise) {
    return configPromise;
  }

  // Create and cache the fetch promise
  configPromise = (async () => {
    try {
      const configUrl = getConfigUrl();
      console.log(`[RuntimeConfig] Fetching from MCP server: ${configUrl}`);

      const response = await fetch(configUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-cache',
      });

      if (response.ok) {
        const config: RuntimeConfig = await response.json();
        console.log(`[RuntimeConfig] Successfully loaded from MCP server:`, config);
        console.log(`[RuntimeConfig] Dev mode is: ${config.devMode ? 'ENABLED' : 'DISABLED'}`);
        return config;
      } else {
        const errorText = await response.text().catch(() => '(unable to read error)');
        console.error(`[RuntimeConfig] Failed to fetch from MCP server: ${response.status} ${response.statusText}`);
        console.error(`[RuntimeConfig] Response body:`, errorText);
        console.error(`[RuntimeConfig] Request URL was:`, configUrl);
      }

      // Fallback to defaults if fetch failed
      console.warn('[RuntimeConfig] Could not fetch config, using defaults (devMode: false)');
      return { devMode: false };
    } catch (error) {
      console.error('[RuntimeConfig] Error fetching config:', error);
      console.error('[RuntimeConfig] Falling back to devMode: false');
      return { devMode: false };
    }
  })();

  try {
    cachedConfig = await configPromise;
    return cachedConfig;
  } finally {
    // Clear promise after completion
    configPromise = null;
  }
}

/**
 * Get cached runtime config (must call fetchRuntimeConfig first)
 */
export function getRuntimeConfig(): RuntimeConfig {
  return cachedConfig || { devMode: false };
}

/**
 * Check if dev mode is enabled
 */
export function isDevMode(): boolean {
  const config = getRuntimeConfig();
  return config.devMode === true;
}

/**
 * Initialize runtime config on app startup
 * Call this once when the app loads
 */
export async function initializeRuntimeConfig(): Promise<void> {
  await fetchRuntimeConfig();

  const config = getRuntimeConfig();
  if (config.devMode) {
    console.log('[DevMode] ENABLED - API keys will be cached in browser session');
    console.log('[DevMode] Keys will not be saved to Kubernetes secrets');
  } else {
    console.log('[DevMode] DISABLED - API keys will be saved to Kubernetes secrets');
  }
}
