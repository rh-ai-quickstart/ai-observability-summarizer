import { chat, getSessionConfig, setSessionConfig, clearSessionConfig } from '../../src/services/mcpClient';

// Mock fetch
global.fetch = jest.fn();

describe('mcpClient', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
    localStorage.clear();
  });

  describe('SessionConfig', () => {
    it('should save and retrieve session config', () => {
      const config = {
        ai_model: 'test-model',
        api_key: 'test-key',
      };

      setSessionConfig(config);
      const retrieved = getSessionConfig();

      expect(retrieved).toEqual(config);
    });

    it('should return empty config when no config exists', () => {
      const config = getSessionConfig();
      expect(config).toEqual({ ai_model: '' });
    });

    it('should clear session config', () => {
      setSessionConfig({ ai_model: 'test-model' });
      clearSessionConfig();

      const config = getSessionConfig();
      expect(config).toEqual({ ai_model: '' });
    });

    it('should handle corrupted localStorage gracefully', () => {
      localStorage.setItem('openshift_ai_observability_config', 'invalid json');
      const config = getSessionConfig();
      expect(config).toEqual({ ai_model: '' });
    });
  });

  describe('chat', () => {
    it('should send chat request with correct parameters', async () => {
      const mockResponse = {
        response: 'AI response text',
        progress_log: [
          { timestamp: '10:00:00', message: 'Step 1' },
          { timestamp: '10:00:01', message: 'Step 2' },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            structuredContent: {
              result: JSON.stringify(mockResponse),
            },
          },
        }),
      });

      const result = await chat('test-model', 'Test question', {
        scope: 'cluster_wide',
        apiKey: 'test-key',
      });

      expect(result.response).toBe('AI response text');
      expect(result.progressLog).toHaveLength(2);
      expect(result.progressLog[0].message).toBe('Step 1');

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('test-model'),
        })
      );
    });

    it('should handle response without progress log', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            structuredContent: {
              result: JSON.stringify({
                response: 'Simple response',
              }),
            },
          },
        }),
      });

      const result = await chat('test-model', 'Test question');

      expect(result.response).toBe('Simple response');
      expect(result.progressLog).toEqual([]);
    });

    it('should handle plain text response (non-JSON)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            structuredContent: {
              result: 'Plain text response',
            },
          },
        }),
      });

      const result = await chat('test-model', 'Test question');

      expect(result.response).toBe('Plain text response');
      expect(result.progressLog).toEqual([]);
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      await expect(chat('test-model', 'Test question')).rejects.toThrow(
        'MCP request failed: 500'
      );
    });

    it('should handle MCP error responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: {
            message: 'MCP error occurred',
          },
        }),
      });

      await expect(chat('test-model', 'Test question')).rejects.toThrow(
        'MCP error: MCP error occurred'
      );
    });

    it('should handle empty response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(chat('test-model', 'Test question')).rejects.toThrow(
        'Empty MCP response'
      );
    });

    it('should send namespace and scope if provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            structuredContent: {
              result: JSON.stringify({ response: 'Test' }),
            },
          },
        }),
      });

      await chat('test-model', 'Test question', {
        namespace: 'test-namespace',
        scope: 'namespace_scoped',
      });

      const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callBody.params.arguments.namespace).toBe('test-namespace');
      expect(callBody.params.arguments.scope).toBe('namespace_scoped');
    });

    it('should include API key when provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            structuredContent: {
              result: JSON.stringify({ response: 'Test' }),
            },
          },
        }),
      });

      await chat('test-model', 'Test question', {
        apiKey: 'my-secret-key',
      });

      const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callBody.params.arguments.api_key).toBe('my-secret-key');
    });

    it('should use correct MCP server URL for local dev', async () => {
      // Mock window.location for local dev
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            structuredContent: {
              result: JSON.stringify({ response: 'Test' }),
            },
          },
        }),
      });

      await chat('test-model', 'Test question');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8085/mcp',
        expect.any(Object)
      );
    });

    it('should handle array response format', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            structuredContent: {
              result: [
                {
                  text: JSON.stringify({
                    response: 'Array format response',
                    progress_log: [],
                  }),
                },
              ],
            },
          },
        }),
      });

      const result = await chat('test-model', 'Test question');

      expect(result.response).toBe('Array format response');
    });

    it('should handle object response format', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            structuredContent: {
              result: {
                response: 'Object format response',
                progress_log: [{ timestamp: '10:00:00', message: 'Test' }],
              },
            },
          },
        }),
      });

      const result = await chat('test-model', 'Test question');

      expect(result.response).toBe('Object format response');
      expect(result.progressLog).toHaveLength(1);
    });
  });
});
