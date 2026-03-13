import { Provider, SecretConfig, SecretStatus, ConnectionTestResult } from '../types/models';
import { callMcpTool } from '../../../services/mcpClient';
import { generateSecretName, getProviderTemplate, isValidApiKey } from './providerTemplates';
import { saveDevCredential, hasDevCredential } from '../../../services/devCredentials';
import { fetchRuntimeConfig, isDevMode } from '../../../services/runtimeConfig';

class AISecretManager {
  /**
   * Check if secret exists for provider
   * In dev mode, checks browser cache; in production, uses MCP tool
   * Works in all deployment modes: console plugin, react-ui, and dev
   */
  async checkProviderSecret(provider: Provider): Promise<SecretStatus> {
    // Ensure runtime config is loaded before checking dev mode
    await fetchRuntimeConfig();

    // DEV MODE: Check browser cache
    if (isDevMode()) {
      const hasKey = hasDevCredential(provider);
      console.log(`[SecretManager] checkProviderSecret - devMode, provider: ${provider}, hasKey: ${hasKey}`);
      return {
        exists: hasKey,
        secretName: `dev-${provider}-credentials`,
        lastUpdated: hasKey ? new Date().toISOString() : undefined,
        isValid: undefined,
      };
    }

    // PRODUCTION MODE: Use MCP tool to check K8s Secret
    const secretName = generateSecretName(provider);

    try {
      const result = await callMcpTool<{
        exists: boolean;
        secret_name: string;
        last_updated?: string;
        is_valid?: boolean;
      }>('check_provider_secret', { provider });

      return {
        exists: result.exists,
        secretName: result.secret_name,
        lastUpdated: result.last_updated,
        isValid: result.is_valid,
      };
    } catch (error) {
      console.error('Error checking provider secret:', error);
      return {
        exists: false,
        secretName,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create or update provider secret
   * In dev mode, saves to browser cache; in production, uses MCP tool to save to K8s Secret
   */
  async saveProviderSecret(config: SecretConfig): Promise<string> {
    // Ensure runtime config is loaded before checking dev mode
    await fetchRuntimeConfig();

    const template = getProviderTemplate(config.provider);

    // Validate API key format
    if (!isValidApiKey(config.provider, config.apiKey)) {
      throw new Error(`Invalid API key format for ${template.label}`);
    }

    // DEV MODE: Save to browser cache
    if (isDevMode()) {
      console.log(`[SecretManager] Saving ${config.provider} API key to browser session`);
      saveDevCredential(config.provider, config.apiKey, config.modelId);
      return `dev-${config.provider}-credentials`;
    }

    // PRODUCTION MODE: Use MCP tool to save to K8s Secret
    const secretName = generateSecretName(config.provider, config.modelId);

    try {
      const result = await callMcpTool<{ secret_name: string }>('save_api_key', {
        provider: config.provider,
        api_key: config.apiKey,
        model_id: config.modelId || undefined,
        description: config.metadata?.description || undefined,
      });
      return result.secret_name || secretName;
    } catch (error) {
      console.error('Error saving provider secret:', error);
      throw new Error(`Failed to save API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Test API key validity by making a test connection using MCP tool
   * Works in all deployment modes: console plugin, react-ui, and dev
   */
  async testConnection(provider: Provider, apiKey?: string): Promise<ConnectionTestResult> {
    const startTime = Date.now();

    if (!apiKey) {
      return {
        success: false,
        error: 'API key is required for testing',
      };
    }

    const template = getProviderTemplate(provider);

    try {
      // Test connection based on provider
      let testResult: boolean;
      let details: ConnectionTestResult['details'] = {};

      switch (provider) {
        case 'openai':
          testResult = await this.testOpenAIConnection(apiKey, details);
          break;
        case 'anthropic':
          testResult = await this.testAnthropicConnection(apiKey, details);
          break;
        case 'google':
          testResult = await this.testGoogleConnection(apiKey, details);
          break;
        case 'meta':
          testResult = await this.testMetaConnection(apiKey, details);
          break;
        default:
          testResult = await this.testGenericConnection(apiKey, template.defaultEndpoint, details);
          break;
      }

      details.responseTime = Date.now() - startTime;

      return {
        success: testResult,
        details,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
        details: {
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  private async testOpenAIConnection(apiKey: string, details: ConnectionTestResult['details'] = {}): Promise<boolean> {
    try {
      const res = await callMcpTool<{ success: boolean }>('validate_api_key', {
        provider: 'openai',
        api_key: apiKey,
      });
      return !!res.success;
    } catch {
      return false;
    }
  }

  private async testAnthropicConnection(apiKey: string, details: ConnectionTestResult['details'] = {}): Promise<boolean> {
    try {
      const res = await callMcpTool<{ success: boolean }>('validate_api_key', {
        provider: 'anthropic',
        api_key: apiKey,
      });
      return !!res.success;
    } catch {
      return false;
    }
  }

  private async testGoogleConnection(apiKey: string, details: ConnectionTestResult['details'] = {}): Promise<boolean> {
    try {
      const res = await callMcpTool<{ success: boolean }>('validate_api_key', {
        provider: 'google',
        api_key: apiKey,
      });
      return !!res.success;
    } catch {
      return false;
    }
  }

  private async testMetaConnection(apiKey: string, details: ConnectionTestResult['details'] = {}): Promise<boolean> {
    // Meta/LLaMA API endpoints vary, this is a generic test
    return this.testGenericConnection(apiKey, 'https://api.llama-api.com/v1/models', details);
  }

  private async testGenericConnection(apiKey: string, endpoint: string, details: ConnectionTestResult['details'] = {}): Promise<boolean> {
    try {
      const res = await callMcpTool<{ success: boolean }>('validate_api_key', {
        provider: 'other',
        api_key: apiKey,
        endpoint,
      });
      return !!res.success;
    } catch {
      return false;
    }
  }

  /**
   * Delete secret using MCP tool (production) or clear cached credential (dev mode)
   * Works in all deployment modes: console plugin, react-ui, and dev
   */
  async deleteSecret(secretName: string): Promise<void> {
    // Ensure runtime config is loaded before checking dev mode
    await fetchRuntimeConfig();

    // DEV MODE: Clear from browser cache
    if (isDevMode()) {
      console.log(`[SecretManager] Clearing cached credential: ${secretName}`);

      // Parse provider from secret name (e.g., "dev-openai-credentials" -> "openai")
      const match = secretName.match(/dev-(\w+)-credentials/);
      if (match) {
        const provider = match[1];
        const creds = JSON.parse(sessionStorage.getItem('ai_observability_dev_credentials') || '{}');
        delete creds[provider];
        sessionStorage.setItem('ai_observability_dev_credentials', JSON.stringify(creds));
        console.log(`[SecretManager] Cleared ${provider} from browser cache`);
      }
      return;
    }

    // PRODUCTION MODE: Use MCP tool to delete from Kubernetes
    try {
      // Extract provider from secret name (format: ai-{provider}-credentials)
      const match = secretName.match(/^ai-([^-]+)-credentials$/);
      if (!match) {
        throw new Error(`Invalid secret name format: ${secretName}`);
      }

      const provider = match[1] as Provider;

      const result = await callMcpTool<{
        success: boolean;
        secret_name: string;
        message: string;
      }>('delete_provider_secret', { provider });

      if (!result.success) {
        throw new Error(result.message || 'Failed to delete secret');
      }
    } catch (error) {
      console.error('Error deleting secret:', error);
      throw new Error(`Failed to delete secret: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Migration: Move from browser storage to secret
   */
  async migrateToSecret(provider: Provider, browserApiKey: string): Promise<string> {
    const config: SecretConfig = {
      provider,
      apiKey: browserApiKey,
      metadata: {
        description: `Migrated from browser storage`,
        createdBy: 'migration-tool',
        lastUpdated: new Date().toISOString(),
      },
    };

    return this.saveProviderSecret(config);
  }
}

// Export singleton instance
export const secretManager = new AISecretManager();

// Export the class for testing
export { AISecretManager };
