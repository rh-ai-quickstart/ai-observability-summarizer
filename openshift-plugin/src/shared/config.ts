/**
 * Environment configuration for dual deployment mode
 * Supports both Console Plugin and React UI deployments
 */

export interface AppConfig {
  mode: 'plugin' | 'react-ui';
  mcpServerUrl: string;
  apiTimeout: number;
  enableDebug: boolean;
}

/**
 * Detect deployment mode based on runtime environment
 */
export const getDeploymentMode = (): 'plugin' | 'react-ui' => {
  // Check if running in console plugin context
  if (typeof window !== 'undefined') {
    // Console plugin runs under /observe/ai-observability path
    const isPluginContext = window.location.pathname.startsWith('/observe/ai-observability');
    // Also check for console plugin API
    const hasConsoleAPI = !!(window as any).OPENSHIFT_CONSOLE_PLUGIN_API;

    if (isPluginContext || hasConsoleAPI) {
      return 'plugin';
    }
  }
  return 'react-ui';
};

/**
 * Get MCP Server URL based on deployment mode and environment
 */
export const getMcpServerUrl = (): string => {
  const mode = getDeploymentMode();

  if (typeof window === 'undefined') {
    return '/mcp';
  }

  const isLocalDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';

  if (isLocalDev) {
    // Local development: direct connection to MCP server
    return 'http://localhost:8085/mcp';
  }

  if (mode === 'plugin') {
    // Console plugin uses console proxy
    return '/api/proxy/plugin/aiobs-console-plugin/mcp/mcp';
  } else {
    // React UI uses nginx proxy or direct connection
    return '/api/mcp';
  }
};

/**
 * Application configuration singleton
 */
export const config: AppConfig = {
  mode: getDeploymentMode(),
  mcpServerUrl: getMcpServerUrl(),
  apiTimeout: 30000,
  enableDebug: process.env.NODE_ENV === 'development',
};

export default config;
