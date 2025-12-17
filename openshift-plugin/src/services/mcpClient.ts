/**
 * MCP Client for OpenShift Console Plugin
 * Communicates with the MCP server via the console's proxy (production)
 * or directly via localhost (local development)
 * Uses stateless HTTP mode - no session management needed
 */

// Determine MCP server URL based on environment
// - Production: Use OpenShift Console proxy (path starts with /api/proxy/)
// - Local dev: Use localhost directly (when running yarn start + start-console)
function getMcpServerUrl(): string {
  // Check if we're running in local development mode
  // In local dev, window.location.origin is http://localhost:9000 (console container)
  // The browser makes requests, so we need to use localhost:8085 directly
  const isLocalDev = window.location.hostname === 'localhost' || 
                     window.location.hostname === '127.0.0.1';
  
  if (isLocalDev) {
    // Local development: connect directly to MCP server on host
    return 'http://localhost:8085/mcp';
  }
  
  // Production: Use OpenShift Console's proxy to reach the MCP server
  // The proxy is configured in the ConsolePlugin CR via Helm chart
  // Format: /api/proxy/plugin/<plugin-name>/<alias>/<path>
  return '/api/proxy/plugin/openshift-ai-observability/mcp/mcp';
}

const MCP_SERVER_URL = getMcpServerUrl();

// ============ Session Config (localStorage) ============

export interface SessionConfig {
  ai_model: string;
  api_key?: string;
}

const SESSION_CONFIG_KEY = 'openshift_ai_observability_config';

export function getSessionConfig(): SessionConfig {
  try {
    const stored = localStorage.getItem(SESSION_CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to parse session config:', e);
  }
  return { ai_model: '' };
}

export function setSessionConfig(config: SessionConfig): void {
  localStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify(config));
}

export function clearSessionConfig(): void {
  localStorage.removeItem(SESSION_CONFIG_KEY);
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
  const response = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'X-Session-ID': 'browser-session',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
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
  const response = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'X-Session-ID': 'browser-session',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
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
  // Format 2: structuredContent.result is an array with text objects
  else if (Array.isArray(result.structuredContent?.result) && result.structuredContent.result[0]?.text) {
    text = result.structuredContent.result[0].text;
  }
  // Format 3: content array with text objects
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
 * List available summarization models
 */
export async function listSummarizationModels(): Promise<string[]> {
  try {
    const text = await callMcpToolText('list_summarization_models');
    return parseMCPListResponse(text);
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
 * Chat with AI about observability
 */
export async function chat(
  modelName: string,
  message: string,
  options?: {
    namespace?: string;
    scope?: string;
    apiKey?: string;
  }
): Promise<string> {
  try {
    const text = await callMcpToolText('chat', {
      model_name: modelName,
      message,
      namespace: options?.namespace,
      scope: options?.scope,
      api_key: options?.apiKey,
    });
    return text;
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
