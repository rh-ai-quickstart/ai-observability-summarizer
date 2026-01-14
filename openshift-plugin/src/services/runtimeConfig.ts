/**
 * Runtime Configuration
 * Fetched from MCP server's /config endpoint
 */

export interface RuntimeConfig {
  devMode: boolean;
}

let cachedConfig: RuntimeConfig | null = null;
let configPromise: Promise<RuntimeConfig> | null = null;

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
      // Fetch config from MCP server
      const isLocalDev = window.location.hostname === 'localhost' ||
                         window.location.hostname === '127.0.0.1';

      const configUrl = isLocalDev
        ? 'http://localhost:8085/config'
        : '/api/proxy/plugin/openshift-ai-observability/mcp/config';

      console.log(`[RuntimeConfig] Fetching from MCP server: ${configUrl}`);
      const response = await fetch(configUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-cache',
      });

      if (response.ok) {
        const config: RuntimeConfig = await response.json();
        console.log(`[RuntimeConfig] Successfully loaded from MCP server:`, config);
        return config;
      } else {
        console.warn(`[RuntimeConfig] Failed to fetch from MCP server: ${response.status}`);
      }

      // Fallback to defaults if fetch failed
      console.warn('[RuntimeConfig] Could not fetch config, using defaults');
      return { devMode: false };
    } catch (error) {
      console.error('[RuntimeConfig] Error fetching config:', error);
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
