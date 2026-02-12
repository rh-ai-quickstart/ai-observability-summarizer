/**
 * MCP Client for OpenShift Console Plugin and React UI
 * Communicates with the MCP server via the console's proxy (plugin mode)
 * or directly via nginx proxy/localhost (React UI mode / local development)
 * Uses stateless HTTP mode - no session management needed
 */

import { getDevCredentials } from './devCredentials';
import { fetchRuntimeConfig, isDevMode as checkDevMode } from './runtimeConfig';
import config from '../../shared/config';

const MCP_SERVER_URL = config.mcpServerUrl;

// ============ Session Config ============
// Uses sessionStorage in dev mode (cleared on tab close)
// Uses localStorage in production mode (persists across sessions)

export interface SessionConfig {
  ai_model: string;
  api_key?: string;
}

const SESSION_CONFIG_KEY = 'openshift_ai_observability_config';

/**
 * Get the appropriate storage mechanism based on dev mode
 */
function getStorage(): Storage {
  return checkDevMode() ? sessionStorage : localStorage;
}

export function getSessionConfig(): SessionConfig {
  try {
    const stored = getStorage().getItem(SESSION_CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to parse session config:', e);
  }
  return { ai_model: '' };
}

export function setSessionConfig(config: SessionConfig): void {
  getStorage().setItem(SESSION_CONFIG_KEY, JSON.stringify(config));
}

export function clearSessionConfig(): void {
  getStorage().removeItem(SESSION_CONFIG_KEY);
}

// ============ Dev Mode Credential Injection ============

/**
 * Detect provider from model ID or name
 */
export function detectProviderFromModelId(modelId: string): string | null {
  const patterns: Record<string, RegExp> = {
    openai: /^(openai\/|gpt-)/,
    anthropic: /^(anthropic\/|claude-)/,
    google: /^(google\/|gemini-)/,
    meta: /^(meta\/|llama-)/,
  };

  for (const [provider, pattern] of Object.entries(patterns)) {
    if (pattern.test(modelId)) {
      return provider;
    }
  }
  return null;
}

/**
 * Auto-inject dev credentials into MCP tool arguments
 * In dev mode, adds cached API keys to tool calls that support them
 */
async function injectDevCredentials(toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Ensure runtime config is loaded before checking dev mode
  await fetchRuntimeConfig();

  if (!checkDevMode()) {
    return args;
  }

  // Skip credential injection for tools that don't need API keys
  const skipTools = ['add_model_to_config', 'save_provider_credentials', 'delete_secret'];
  if (skipTools.includes(toolName)) {
    return args;
  }

  // If api_key already provided, don't override
  if (args.api_key) {
    return args;
  }

  const devCreds = getDevCredentials();

  // Try to detect provider from various parameters
  let provider: string | null = null;

  // Check explicit provider parameter first
  if (typeof args.provider === 'string') {
    provider = args.provider.toLowerCase();
  }
  // Try to detect from model_id parameters
  else {
    const modelId = (args.summarize_model_id as string) || (args.model_name as string);
    if (modelId) {
      provider = detectProviderFromModelId(modelId);
    }
  }

  // Inject the key if provider detected and key available
  if (provider && devCreds[provider]?.apiKey) {
    console.log(`[DevMode] Auto-injecting API key for ${provider}`);
    return {
      ...args,
      api_key: devCreds[provider].apiKey,
    };
  }

  return args;
}

// ============ MCP Tool Calls (Stateless) ============

let requestId = 0;

/**
 * Call an MCP tool directly via HTTP (stateless, JSON response)
 */
export async function callMcpTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  // Auto-inject dev credentials if in dev mode
  const enhancedArgs = await injectDevCredentials(toolName, args);

  const response = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': 'browser-session',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: enhancedArgs,
      },
      id: ++requestId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MCP request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`MCP error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const result = data.result;
  if (!result) {
    throw new Error('Empty MCP response');
  }

  // Extract text from structuredContent or content
  if (result.structuredContent?.result) {
    const structured = result.structuredContent.result;

    // Format 1: structuredContent.result is a string (JSON)
    if (typeof structured === 'string') {
      try {
        return JSON.parse(structured) as T;
      } catch {
        return structured as T;
      }
    }

    // Format 2: structuredContent.result is an array with text objects
    if (Array.isArray(structured) && structured[0]?.text) {
      try {
        return JSON.parse(structured[0].text) as T;
      } catch {
        return structured[0].text as T;
      }
    }

    // Format 3: structuredContent.result is already parsed object
    return structured as T;
  }

  if (result.content && result.content.length > 0) {
    const textContent = result.content.find((c: { type: string; text?: string }) => c.type === 'text');
    if (textContent?.text) {
      try {
        return JSON.parse(textContent.text) as T;
      } catch {
        return textContent.text as T;
      }
    }
  }

  return result as T;
}

/**
 * Call MCP tool and get raw text response
 */
export async function callMcpToolText(toolName: string, args: Record<string, unknown> = {}): Promise<string> {
  // Auto-inject dev credentials if in dev mode
  const enhancedArgs = await injectDevCredentials(toolName, args);

  const response = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': 'browser-session',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: enhancedArgs,
      },
      id: ++requestId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MCP request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`MCP error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const result = data.result;
  if (!result) {
    throw new Error('Empty MCP response');
  }

  // Extract text content - handle different response formats
  let text = '';

  // Format 1: structuredContent.result is a string (direct JSON)
  if (typeof result.structuredContent?.result === 'string') {
    text = result.structuredContent.result;
  }
  // Format 2: structuredContent.result is an array with text objects (check BEFORE generic object!)
  else if (Array.isArray(result.structuredContent?.result) && result.structuredContent.result[0]?.text) {
    text = result.structuredContent.result[0].text;
  }
  // Format 3: structuredContent.result is an object (already parsed)
  else if (result.structuredContent?.result && typeof result.structuredContent.result === 'object') {
    // If it's already an object with a response field, stringify it so we can parse it again in chat()
    text = JSON.stringify(result.structuredContent.result);
  }
  // Format 4: content array with text objects
  else if (result.content?.[0]?.text) {
    text = result.content[0].text;
  }

  return text;
}

// Helper to parse bulleted list responses from MCP
function parseMCPListResponse(text: string): string[] {
  const modelNamePattern = /^([a-z]+\/)?[A-Za-z0-9._-]+$/;
  return text
    .split('\n')
    .map(line => line.replace(/•\s*/, '').trim())
    // Drop obvious headings/separators
    .filter(line => line.length > 0 && !line.endsWith(':'))
    .filter(line => !/available.+models/i.test(line))
    // Keep only plausible model identifiers (provider/model or single token without spaces)
    .filter(line => modelNamePattern.test(line));
}

// ============ MCP API Calls ============

export interface ModelInfo {
  name: string;
  namespace: string;
  status: string;
}

export interface NamespaceInfo {
  name: string;
  hasVllm?: boolean;
}

export interface MetricData {
  name: string;
  value: number;
  unit?: string;
  changePercent?: number;
}

export interface AlertInfo {
  name: string;
  severity: string;
  message: string;
  timestamp: string;
  labels?: Record<string, string>;
}

/**
 * Health check for MCP server
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const healthUrl = MCP_SERVER_URL.replace(/\/mcp$/, '/health');
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.warn('Health endpoint failed:', response.status);
      return false;
    }

    const data = await response.json();
    return data.status === 'healthy';
  } catch (error) {
    console.error('Health check failed:', error);
    return false;
  }
}

/**
 * List available vLLM models
 */
export async function listModels(): Promise<ModelInfo[]> {
  try {
    const text = await callMcpToolText('list_models');
    const models: ModelInfo[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/•\s*(\S+)\s*\|\s*(.+)/);
      if (match) {
        models.push({
          name: match[2].trim(),
          namespace: match[1].trim(),
          status: 'running',
        });
      }
    }
    return models;
  } catch (error) {
    console.error('Failed to list models:', error);
    return [];
  }
}

/**
 * List namespaces with vLLM deployments
 */
export async function listNamespaces(): Promise<NamespaceInfo[]> {
  try {
    const text = await callMcpToolText('list_vllm_namespaces');
    const namespaces: NamespaceInfo[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/•\s*(\S+)/);
      if (match) {
        namespaces.push({
          name: match[1].trim(),
          hasVllm: true,
        });
      }
    }
    return namespaces;
  } catch (error) {
    console.error('Failed to list namespaces:', error);
    return [];
  }
}

/**
 * List OpenShift namespaces
 */
export async function listOpenShiftNamespaces(): Promise<string[]> {
  try {
    const text = await callMcpToolText('list_openshift_namespaces');
    return parseMCPListResponse(text);
  } catch (error) {
    console.error('Failed to list OpenShift namespaces:', error);
    return [];
  }
}

/**
 * List OpenShift metric groups for a scope
 */
export async function listOpenShiftMetricGroups(scope: 'cluster_wide' | 'namespace_scoped'): Promise<string[]> {
  try {
    const toolName = scope === 'cluster_wide' ? 'list_openshift_metric_groups' : 'list_openshift_namespace_metric_groups';
    const text = await callMcpToolText(toolName);
    return parseMCPListResponse(text);
  } catch (error) {
    console.error(`Failed to list OpenShift metric groups for scope ${scope}:`, error);
    return [];
  }
}

/**
 * Fetch OpenShift metrics data for a category (structured response)
 */
export interface OpenShiftMetricValue {
  latest_value: number | null;
  time_series: Array<{ timestamp: string; value: number }>;
}

export interface OpenShiftMetricsDataResponse {
  category: string;
  scope: string;
  namespace: string | null;
  start_ts: number;
  end_ts: number;
  metrics: Record<string, OpenShiftMetricValue>;
}

export async function fetchOpenShiftMetrics(
  category: string,
  scope: 'cluster_wide' | 'namespace_scoped',
  timeRange: string = '1h',
  namespace?: string
): Promise<OpenShiftMetricsDataResponse | null> {
  try {
    console.log('[OpenShift] Fetching metrics:', { category, scope, timeRange, namespace });
    const text = await callMcpToolText('fetch_openshift_metrics_data', {
      metric_category: category,
      scope,
      time_range: timeRange,
      namespace: namespace || undefined,
    });

    const data = JSON.parse(text) as OpenShiftMetricsDataResponse;
    console.log('[OpenShift] Metrics received:', Object.keys(data.metrics || {}).length, 'metrics');
    return data;
  } catch (error) {
    console.error('[OpenShift] Failed to fetch metrics:', error);
    return null;
  }
}

/**
 * Get alerts (TODO: Implement get_alerts MCP tool)
 * Currently returns empty array - alerts functionality pending
 */
export async function getAlerts(_namespace?: string): Promise<AlertInfo[]> {
  // TODO: Implement get_alerts MCP tool to fetch from Prometheus AlertManager
  console.log('[Alerts] get_alerts tool not yet implemented, returning empty');
  return [];
}

/**
 * List available summarization models with metadata
 */
export async function listSummarizationModels(): Promise<any[]> {
  try {
    const text = await callMcpToolText('list_summarization_models');

    // Try to parse as JSON first (new format with metadata)
    try {
      const data = JSON.parse(text);
      if (data.models && Array.isArray(data.models)) {
        return data.models;
      }
    } catch (e) {
      // Not JSON, fall back to old text format
    }

    // Fallback to old text format (list of names)
    const modelNames = parseMCPListResponse(text);
    return modelNames.map(name => ({ name }));
  } catch (error) {
    console.error('Failed to list summarization models:', error);
    return [];
  }
}

/**
 * Analyze OpenShift metrics with AI
 */
export interface OpenShiftAnalysisResult {
  summary: string;
  category: string;
  scope: string;
  namespace?: string;
}

export async function chatOpenShift(
  category: string,
  question: string,
  scope: string,
  namespace: string | undefined,
  timeRange: string,
  model: string,
  apiKey?: string
): Promise<{ response: string; promql?: string }> {
  try {
    console.log('[OpenShift] Chat:', { category, question, scope, namespace, timeRange, model });

    // Convert timeRange to start/end timestamps
    let start: number, end: number;
    const now = Math.floor(Date.now() / 1000);

    if (timeRange.startsWith('custom:')) {
      // Parse custom range format: "custom:START_ISO:END_ISO"
      const parts = timeRange.split(':');
      if (parts.length >= 3) {
        start = Math.floor(new Date(parts[1]).getTime() / 1000);
        end = Math.floor(new Date(parts[2]).getTime() / 1000);
      } else {
        // Fallback to 1 hour
        start = now - 3600;
        end = now;
      }
    } else {
      // Handle preset ranges
      const rangeSeconds = {
        '15m': 15 * 60,
        '1h': 60 * 60,
        '6h': 6 * 60 * 60,
        '24h': 24 * 60 * 60,
        '7d': 7 * 24 * 60 * 60,
      }[timeRange] || 3600; // Default 1 hour

      start = now - rangeSeconds;
      end = now;
    }

    // Use the same MCP call pattern as analyzeOpenShift
    const text = await callMcpToolText('chat_openshift', {
      metric_category: category,
      question: question,
      scope: scope,
      namespace: namespace || '',
      start_datetime: new Date(start * 1000).toISOString(),
      end_datetime: new Date(end * 1000).toISOString(),
      summarize_model_id: model,
      api_key: apiKey,
    });

    console.log('[OpenShift] Chat response length:', text.length);

    // Parse response - try JSON first, fallback to plain text
    let responseText = '';
    let promqlText = '';

    try {
      const parsed = JSON.parse(text);
      responseText = parsed.summary || parsed.response || text;
      promqlText = parsed.promql || '';
    } catch {
      // If not JSON, treat as plain text response
      responseText = text;
    }

    return {
      response: responseText,
      promql: promqlText || undefined,
    };

  } catch (error) {
    console.error('OpenShift chat error:', error);
    throw error;
  }
}

export async function analyzeOpenShift(
  category: string,
  scope: 'cluster_wide' | 'namespace_scoped',
  namespace?: string,
  summarizeModelId?: string,
  apiKey?: string,
  timeRange?: string
): Promise<OpenShiftAnalysisResult> {
  try {
    console.log('[OpenShift] Analyzing:', { category, scope, namespace, summarizeModelId });
    const text = await callMcpToolText('analyze_openshift', {
      metric_category: category,
      scope,
      namespace: namespace || undefined,
      summarize_model_id: summarizeModelId || undefined,
      api_key: apiKey || undefined,
      time_range: timeRange || '1h',
    });

    console.log('[OpenShift] Analysis response length:', text.length);

    // The response might contain STRUCTURED_DATA at the end, extract just the summary
    let summary = text;
    const structuredIndex = text.indexOf('STRUCTURED_DATA:');
    if (structuredIndex > 0) {
      summary = text.substring(0, structuredIndex).trim();
    }

    // Remove the header line if present (e.g., "OpenShift Analysis (Fleet Overview) — cluster_wide")
    const lines = summary.split('\n');
    if (lines[0]?.startsWith('OpenShift Analysis')) {
      summary = lines.slice(1).join('\n').trim();
    }

    return {
      summary,
      category,
      scope,
      namespace,
    };
  } catch (error) {
    console.error('[OpenShift] Failed to analyze:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      summary: `Analysis failed: ${errorMessage}`,
      category,
      scope,
      namespace,
    };
  }
}

/**
 * Analyze vLLM metrics with AI
 * Returns clean structured response with summary and metrics
 */
export interface AnalysisResult {
  model_name: string;
  summary: string;
  time_range?: string;
}

export async function analyzeVLLM(
  modelName: string,
  summarizeModelId: string,
  timeRange: string = '1h',
  apiKey?: string
): Promise<AnalysisResult> {
  try {
    const result = await callMcpTool<AnalysisResult>('analyze_vllm', {
      model_name: modelName,
      summarize_model_id: summarizeModelId,
      time_range: timeRange,
      api_key: apiKey || undefined,
    });

    return result;
  } catch (error) {
    console.error('Failed to analyze vLLM:', error);

    // Check if error message contains error details
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Return error as summary for display
    return {
      model_name: modelName,
      summary: `Analysis failed: ${errorMessage}`,
    };
  }
}

/**
 * Chat with AI about vLLM metrics
 * Uses the general chat tool which can fetch metrics as needed
 */
export async function chatVLLM(
  modelName: string,
  namespace: string | undefined,
  question: string,
  timeRange: string,
  summarizeModelId: string,
  apiKey?: string
): Promise<{ response: string }> {
  try {
    console.log('[vLLM] Chat:', { modelName, question, timeRange, summarizeModelId });

    // Build context message that guides the AI to fetch vLLM metrics
    // Note: The backend chat tool doesn't accept time_range as a parameter,
    // so we include it in the message prompt instead
    const contextMessage = `You are helping analyze vLLM metrics for model "${modelName}"${namespace ? ` in namespace "${namespace}"` : ''}.

IMPORTANT Instructions:
1. Use ONLY the fetch_vllm_metrics_data tool to get metrics
   - Parameters: model_name="${modelName}", time_range="${timeRange}"${namespace ? `, namespace="${namespace}"` : ''}
2. DO NOT use analyze_vllm (it's too slow)
3. Analyze the raw metrics data yourself and provide insights
4. Focus on relevant metrics for the user's question
5. Provide specific, data-driven insights based on actual metric values

User question: ${question}`;

    // Use the general chat tool which has access to all MCP tools
    // Only pass namespace if it's defined (not 'all')
    const result = await chat(
      summarizeModelId,
      contextMessage,
      {
        ...(namespace ? { namespace } : {}),
        scope: 'vllm',
        apiKey,
      }
    );

    return {
      response: result.response,
    };

  } catch (error) {
    console.error('vLLM chat error:', error);
    throw error;
  }
}

/**
 * Chat with AI about observability
 * Returns both the response and progress log for replay
 *
 * Note: The backend chat tool does NOT accept time_range as a parameter.
 * If you need to specify a time range, include it in the message text.
 */
export async function chat(
  modelName: string,
  message: string,
  options?: {
    namespace?: string;
    scope?: string;
    apiKey?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
  }
): Promise<{ response: string; progressLog: Array<{ timestamp: string; message: string }> }> {
  try {
    const text = await callMcpToolText('chat', {
      model_name: modelName,
      message,
      namespace: options?.namespace,
      scope: options?.scope,
      api_key: options?.apiKey,
      conversation_history: options?.conversationHistory,
    });

    // The backend returns a JSON response with {response, progress_log, model, iterations}
    try {
      const parsed = JSON.parse(text);
      console.log('[Chat] Parsed response:', {
        hasResponse: !!parsed?.response,
        progressLogEntries: parsed?.progress_log?.length || 0
      });

      if (parsed && typeof parsed.response === 'string') {
        return {
          response: parsed.response,
          progressLog: parsed.progress_log || [],
        };
      }

      // If parsed but no response field, return original
      console.warn('[Chat] Parsed JSON but no response field found');
      return {
        response: text,
        progressLog: [],
      };
    } catch (parseError) {
      // If parsing fails, return the original text
      console.debug('[Chat] Response is not JSON, returning as-is:', parseError);
      return {
        response: text,
        progressLog: [],
      };
    }
  } catch (error) {
    console.error('Failed to chat:', error);
    throw error;
  }
}

/**
 * Fetch vLLM metrics data for a model
 */
export interface VLLMMetricValue {
  latest_value: number;
  time_series: Array<{ timestamp: string; value: number }>;
}

export interface VLLMMetricsResponse {
  model_name: string;
  start_ts: number;
  end_ts: number;
  metrics: Record<string, VLLMMetricValue>;
}

export async function fetchVLLMMetrics(
  modelName: string,
  timeRange: string = '1h',
  namespace?: string
): Promise<VLLMMetricsResponse | null> {
  try {
    const text = await callMcpToolText('fetch_vllm_metrics_data', {
      model_name: modelName,
      time_range: timeRange,
      namespace: namespace || undefined,
    });

    // Parse the JSON response
    const data = JSON.parse(text) as VLLMMetricsResponse;
    return data;
  } catch (error) {
    console.error('Failed to fetch vLLM metrics:', error);
    return null;
  }
}
