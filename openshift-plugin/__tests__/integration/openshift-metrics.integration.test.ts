/**
 * Integration tests for OpenShift Metrics functionality
 * Tests the interaction between components and MCP client services
 * 
 * TODO: These tests need to be updated to match the actual MCP client implementation:
 * 1. The client uses callMcpToolText which parses text responses, not JSON
 * 2. The URL format and response structure need to match the actual API
 * 3. The mock setup needs to properly intercept the actual fetch calls
 */

import { fetchOpenShiftMetrics, analyzeOpenShift, listOpenShiftNamespaces } from '../../src/core/services/mcpClient';

// Mock fetch for MCP server communication
global.fetch = jest.fn();
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// Mock runtime config
jest.mock('../../src/core/services/runtimeConfig', () => ({
  getRuntimeConfig: jest.fn(() => ({
    mcp_server_url: 'http://localhost:8000',
    debug: false,
  })),
}));

// TODO: Fix integration tests - currently skipped because they use incorrect mock format
describe.skip('OpenShift Metrics Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Namespace Operations', () => {
    it('should fetch OpenShift namespaces successfully', async () => {
      const mockNamespaces = ['default', 'kube-system', 'openshift-ai', 'my-app'];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            namespaces: mockNamespaces,
          },
        }),
      } as Response);

      const result = await listOpenShiftNamespaces();

      expect(result).toEqual(mockNamespaces);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/mcp/call',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('list_openshift_namespaces'),
        })
      );
    });

    it('should handle namespace fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(listOpenShiftNamespaces()).rejects.toThrow('Network error');
    });

    it('should handle empty namespace list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            namespaces: [],
          },
        }),
      } as Response);

      const result = await listOpenShiftNamespaces();
      expect(result).toEqual([]);
    });
  });

  describe('Metrics Fetching', () => {
    const sampleMetricsResponse = {
      metrics: {
        'Total Pods Running': {
          latest_value: 42,
          time_series: [
            { timestamp: '2024-01-01T10:00:00Z', value: 40 },
            { timestamp: '2024-01-01T10:05:00Z', value: 42 },
          ],
        },
        'Cluster CPU Usage (%)': {
          latest_value: 75.5,
          time_series: [
            { timestamp: '2024-01-01T10:00:00Z', value: 70.0 },
            { timestamp: '2024-01-01T10:05:00Z', value: 75.5 },
          ],
        },
        'GPU Count': {
          latest_value: 4,
          time_series: [],
        },
      },
    };

    it('should fetch cluster-wide metrics successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: sampleMetricsResponse,
        }),
      } as Response);

      const result = await fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h');

      expect(result).toEqual(sampleMetricsResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/mcp/call',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('fetch_openshift_metrics'),
        })
      );

      // Verify the correct parameters were sent
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(requestBody.params.arguments).toEqual({
        category: 'Fleet Overview',
        scope: 'cluster_wide',
        time_range: '1h',
        namespace: undefined,
      });
    });

    it('should fetch namespace-scoped metrics successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: sampleMetricsResponse,
        }),
      } as Response);

      const result = await fetchOpenShiftMetrics(
        'Pod & Container Metrics',
        'namespace_scoped',
        '6h',
        'my-app'
      );

      expect(result).toEqual(sampleMetricsResponse);

      // Verify namespace parameter was included
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(requestBody.params.arguments).toEqual({
        category: 'Pod & Container Metrics',
        scope: 'namespace_scoped',
        time_range: '6h',
        namespace: 'my-app',
      });
    });

    it('should handle different time ranges', async () => {
      const timeRanges = ['15m', '1h', '6h', '24h', '7d'];

      for (const timeRange of timeRanges) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { metrics: {} } }),
        } as Response);

        await fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', timeRange);

        const requestBody = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1]?.body as string);
        expect(requestBody.params.arguments.time_range).toBe(timeRange);
      }
    });

    it('should handle all metric categories', async () => {
      const categories = [
        'Fleet Overview',
        'Jobs & Workloads',
        'Storage & Config',
        'Node Metrics',
        'GPU & Accelerators',
        'Autoscaling & Scheduling',
        'Pod & Container Metrics',
        'Network Metrics',
        'Storage I/O',
        'Services & Networking',
        'Application Services',
      ];

      for (const category of categories) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { metrics: {} } }),
        } as Response);

        await fetchOpenShiftMetrics(category, 'cluster_wide', '1h');

        const requestBody = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1]?.body as string);
        expect(requestBody.params.arguments.category).toBe(category);
      }
    });

    it('should handle metrics fetch errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      await expect(fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h'))
        .rejects.toThrow('MCP request failed: 500 Internal Server Error');
    });

    it('should handle empty metrics response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            metrics: {},
          },
        }),
      } as Response);

      const result = await fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h');
      expect(result).toEqual({ metrics: {} });
    });
  });

  describe('AI Analysis Integration', () => {
    const sampleAnalysisResponse = {
      summary: `# Fleet Overview Analysis

## 1. What's the current state of fleet overview performance and health?

The cluster appears to be in good health with stable pod counts and CPU usage within normal ranges.

## 2. Are there any performance or reliability concerns?

No immediate concerns detected. All metrics are within acceptable thresholds.

## 3. What actions should be taken?

Continue monitoring. Consider scaling if pod counts increase significantly.

## 4. Any optimization recommendations?

Review resource requests to optimize cluster utilization.`,
      category: 'Fleet Overview',
      scope: 'cluster_wide',
      namespace: undefined,
    };

    it('should perform AI analysis successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: sampleAnalysisResponse,
        }),
      } as Response);

      const result = await analyzeOpenShift(
        'Fleet Overview',
        'cluster_wide',
        undefined,
        'gpt-4',
        'test-api-key',
        '1h'
      );

      expect(result).toEqual(sampleAnalysisResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/mcp/call',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('analyze_openshift_metrics'),
        })
      );

      // Verify all parameters were sent correctly
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(requestBody.params.arguments).toEqual({
        category: 'Fleet Overview',
        scope: 'cluster_wide',
        model: 'gpt-4',
        api_key: 'test-api-key',
        namespace: undefined,
        time_range: '1h',
      });
    });

    it('should handle namespace-scoped AI analysis', async () => {
      const namespaceAnalysisResponse = {
        ...sampleAnalysisResponse,
        scope: 'namespace_scoped',
        namespace: 'production',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: namespaceAnalysisResponse,
        }),
      } as Response);

      const result = await analyzeOpenShift(
        'Pod & Container Metrics',
        'namespace_scoped',
        'production',
        'claude-3-sonnet',
        undefined, // No API key (using session config)
        '6h'
      );

      expect(result.namespace).toBe('production');
      expect(result.scope).toBe('namespace_scoped');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(requestBody.params.arguments.namespace).toBe('production');
      expect(requestBody.params.arguments.api_key).toBeUndefined();
    });

    it('should handle AI analysis errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request: Invalid model specified',
      } as Response);

      await expect(analyzeOpenShift(
        'Fleet Overview',
        'cluster_wide',
        undefined,
        'invalid-model',
        'test-key',
        '1h'
      )).rejects.toThrow('MCP request failed: 400 Bad Request: Invalid model specified');
    });

    it('should handle different AI models', async () => {
      const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-3-sonnet', 'claude-haiku-4-5'];

      for (const model of models) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { ...sampleAnalysisResponse, model } }),
        } as Response);

        await analyzeOpenShift('Fleet Overview', 'cluster_wide', undefined, model, 'test-key', '1h');

        const requestBody = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1]?.body as string);
        expect(requestBody.params.arguments.model).toBe(model);
      }
    });

    it('should validate analysis response format', async () => {
      const incompleteResponse = {
        summary: 'Short analysis without proper sections',
        category: 'Fleet Overview',
        // Missing scope and other fields
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: incompleteResponse }),
      } as Response);

      const result = await analyzeOpenShift(
        'Fleet Overview',
        'cluster_wide',
        undefined,
        'gpt-4',
        'test-key',
        '1h'
      );

      expect(result.summary).toBe('Short analysis without proper sections');
      expect(result.category).toBe('Fleet Overview');
      // Should handle missing fields gracefully
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle concurrent requests', async () => {
      // Setup multiple mock responses
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { metrics: { [`metric${i}`]: { latest_value: i } } } }),
        } as Response);
      }

      const promises = Array.from({ length: 5 }, (_, i) =>
        fetchOpenShiftMetrics(`Category${i}`, 'cluster_wide', '1h')
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      expect(mockFetch).toHaveBeenCalledTimes(5);
      results.forEach((result, i) => {
        expect(result.metrics[`metric${i}`].latest_value).toBe(i);
      });
    });

    it('should handle network timeouts gracefully', async () => {
      mockFetch.mockImplementationOnce(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      );

      await expect(fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h'))
        .rejects.toThrow('Timeout');
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      } as any);

      await expect(fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h'))
        .rejects.toThrow('Invalid JSON');
    });

    it('should handle large metrics datasets', async () => {
      // Generate a large dataset
      const largeMetricsResponse = {
        metrics: Object.fromEntries(
          Array.from({ length: 1000 }, (_, i) => [
            `metric_${i}`,
            {
              latest_value: Math.random() * 100,
              time_series: Array.from({ length: 100 }, (_, j) => ({
                timestamp: new Date(Date.now() - j * 60000).toISOString(),
                value: Math.random() * 100,
              })),
            },
          ])
        ),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: largeMetricsResponse }),
      } as Response);

      const result = await fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h');

      expect(Object.keys(result.metrics)).toHaveLength(1000);
      expect(result.metrics.metric_0.time_series).toHaveLength(100);
    });
  });

  describe('Data Validation and Edge Cases', () => {
    it('should handle null and undefined values in metrics', async () => {
      const metricsWithNulls = {
        metrics: {
          'Valid Metric': { latest_value: 42, time_series: [] },
          'Null Metric': { latest_value: null, time_series: [] },
          'Undefined Metric': { latest_value: undefined, time_series: [] },
          'Missing Time Series': { latest_value: 10 }, // No time_series field
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: metricsWithNulls }),
      } as Response);

      const result = await fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h');

      expect(result.metrics['Valid Metric'].latest_value).toBe(42);
      expect(result.metrics['Null Metric'].latest_value).toBeNull();
      expect(result.metrics['Undefined Metric'].latest_value).toBeUndefined();
      expect(result.metrics['Missing Time Series'].latest_value).toBe(10);
    });

    it('should handle invalid timestamp formats in time series', async () => {
      const metricsWithBadTimestamps = {
        metrics: {
          'Bad Timestamps': {
            latest_value: 50,
            time_series: [
              { timestamp: '2024-01-01T10:00:00Z', value: 40 }, // Valid
              { timestamp: 'invalid-timestamp', value: 45 }, // Invalid
              { timestamp: null, value: 50 }, // Null
              { value: 55 }, // Missing timestamp
            ],
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: metricsWithBadTimestamps }),
      } as Response);

      const result = await fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h');

      expect(result.metrics['Bad Timestamps'].time_series).toHaveLength(4);
      // Should return the data as-is, let the frontend handle validation
    });

    it('should handle extremely large numbers in metrics', async () => {
      const metricsWithLargeNumbers = {
        metrics: {
          'Large Number': { latest_value: Number.MAX_SAFE_INTEGER, time_series: [] },
          'Very Small Number': { latest_value: Number.MIN_SAFE_INTEGER, time_series: [] },
          'Infinity': { latest_value: Infinity, time_series: [] },
          'NaN': { latest_value: NaN, time_series: [] },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: metricsWithLargeNumbers }),
      } as Response);

      const result = await fetchOpenShiftMetrics('Fleet Overview', 'cluster_wide', '1h');

      expect(result.metrics['Large Number'].latest_value).toBe(Number.MAX_SAFE_INTEGER);
      expect(result.metrics['Very Small Number'].latest_value).toBe(Number.MIN_SAFE_INTEGER);
      expect(result.metrics['Infinity'].latest_value).toBe(Infinity);
      expect(Number.isNaN(result.metrics['NaN'].latest_value)).toBe(true);
    });
  });
});