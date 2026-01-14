import { Provider, SecretConfig, SecretStatus, ConnectionTestResult } from '../types/models';
import { callMcpTool } from '../../../services/mcpClient';
import { generateSecretName, getProviderTemplate, isValidApiKey } from './providerTemplates';
import { isDevMode, saveDevCredential, getDevCredential, hasDevCredential } from '../../../services/devCredentials';
import { fetchRuntimeConfig } from '../../../services/runtimeConfig';

interface K8sSecret {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  type: string;
  data: Record<string, string>;
}

class AISecretManager {
  private cachedNamespace?: string;
  private getCsrfToken(): string | undefined {
    try {
      const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
      return match ? decodeURIComponent(match[1]) : undefined;
    } catch {
      return undefined;
    }
  }
  private async getNamespace(): Promise<string> {
    if (this.cachedNamespace) {
      return this.cachedNamespace;
    }
    try {
      // Read ConsolePlugin to discover the MCP proxy namespace (same ns we want to store secrets in)
      const resp = await fetch('/api/kubernetes/apis/console.openshift.io/v1/consoleplugins/openshift-ai-observability', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (resp.ok) {
        const cp = await resp.json();
        const proxies: Array<any> = cp?.spec?.proxy ?? [];
        const mcp = proxies.find((p) => p?.alias === 'mcp');
        const ns = mcp?.endpoint?.service?.namespace;
        if (typeof ns === 'string' && ns.length > 0) {
          this.cachedNamespace = ns;
          return ns;
        }
      }
    } catch {
      // ignore and fallback
    }
    // Fallback for legacy deployments
    this.cachedNamespace = 'openshift-ai-observability';
    return this.cachedNamespace;
  }
  
  /**
   * Check if secret exists for provider
   * In dev mode, checks browser cache instead
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

    // PRODUCTION MODE: Original K8s Secret logic
    const secretName = generateSecretName(provider);
    const namespace = await this.getNamespace();

    try {
      // Use OpenShift Console's k8s API proxy
      const response = await fetch(`/api/kubernetes/api/v1/namespaces/${namespace}/secrets/${secretName}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.status === 404) {
        return {
          exists: false,
          secretName,
        };
      }

      if (!response.ok) {
        throw new Error(`Failed to check secret: ${response.status} ${response.statusText}`);
      }

      const secret: K8sSecret = await response.json();

      return {
        exists: true,
        secretName,
        lastUpdated: secret.metadata.annotations?.['ai.observability/last-updated'],
        isValid: undefined, // Will be determined by connection test
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
   * In dev mode, saves to browser cache instead
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
    const devMode = isDevMode();
    console.log(`[SecretManager] saveProviderSecret - devMode: ${devMode}`);

    if (devMode) {
      console.log(`[SecretManager] Saving ${config.provider} API key to browser session`);
      saveDevCredential(config.provider, config.apiKey, config.modelId);
      return `dev-${config.provider}-credentials`;
    }

    // PRODUCTION MODE: Original MCP tool call to save to K8s Secret
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
   * Get secret data (API key)
   * In dev mode, retrieves from browser cache
   */
  async getProviderSecret(provider: Provider): Promise<string | null> {
    // Ensure runtime config is loaded before checking dev mode
    await fetchRuntimeConfig();

    // DEV MODE: Get from browser cache
    if (isDevMode()) {
      const key = getDevCredential(provider);
      console.log(`[SecretManager] getProviderSecret - devMode, provider: ${provider}, hasKey: ${!!key}`);
      return key;
    }

    // PRODUCTION MODE: Original K8s Secret logic
    const secretName = generateSecretName(provider);
    const namespace = await this.getNamespace();

    try {
      const response = await fetch(`/api/kubernetes/api/v1/namespaces/${namespace}/secrets/${secretName}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Failed to get secret: ${response.status} ${response.statusText}`);
      }

      const secret: K8sSecret = await response.json();
      const apiKeyBase64 = secret.data['api-key'];

      if (!apiKeyBase64) {
        return null;
      }

      return atob(apiKeyBase64);
    } catch (error) {
      console.error('Error getting provider secret:', error);
      return null;
    }
  }

  /**
   * Test API key validity by making a test connection
   */
  async testConnection(provider: Provider, apiKey?: string): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    let keyToTest = apiKey;
    
    // If no API key provided, try to get from secret
    if (!keyToTest) {
      keyToTest = await this.getProviderSecret(provider);
    }
    
    if (!keyToTest) {
      return {
        success: false,
        error: 'No API key found',
      };
    }

    const template = getProviderTemplate(provider);
    
    try {
      // Test connection based on provider
      let testResult: boolean;
      let details: ConnectionTestResult['details'] = {};

      switch (provider) {
        case 'openai':
          testResult = await this.testOpenAIConnection(keyToTest, details);
          break;
        case 'anthropic':
          testResult = await this.testAnthropicConnection(keyToTest, details);
          break;
        case 'google':
          testResult = await this.testGoogleConnection(keyToTest, details);
          break;
        case 'meta':
          testResult = await this.testMetaConnection(keyToTest, details);
          break;
        default:
          testResult = await this.testGenericConnection(keyToTest, template.defaultEndpoint, details);
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
   * List all AI-related secrets
   */
  async listSecrets(): Promise<SecretStatus[]> {
    try {
      const namespace = await this.getNamespace();
      const response = await fetch(`/api/kubernetes/api/v1/namespaces/${namespace}/secrets?labelSelector=app.kubernetes.io/component=ai-model-config`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list secrets: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const secrets: K8sSecret[] = data.items || [];

      return secrets.map(secret => ({
        exists: true,
        secretName: secret.metadata.name,
        lastUpdated: secret.metadata.annotations?.['ai.observability/last-updated'],
        isValid: undefined, // Would need individual testing
      }));
    } catch (error) {
      console.error('Error listing secrets:', error);
      return [];
    }
  }

  /**
   * Delete secret (production) or clear cached credential (dev mode)
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

    // PRODUCTION MODE: Delete from Kubernetes
    try {
      const namespace = await this.getNamespace();
      const response = await fetch(`/api/kubernetes/api/v1/namespaces/${namespace}/secrets/${secretName}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          ...(this.getCsrfToken() ? { 'X-CSRFToken': this.getCsrfToken() as string } : {}),
        },
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete secret: ${response.status} ${response.statusText}`);
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