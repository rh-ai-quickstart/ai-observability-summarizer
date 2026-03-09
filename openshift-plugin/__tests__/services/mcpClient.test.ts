import { chat, getSessionConfig, setSessionConfig, clearSessionConfig } from '../../src/core/services/mcpClient';

// Mock fetch
global.fetch = jest.fn();

// Mock the runtimeConfig module - use inline jest.fn() to avoid hoisting issues
jest.mock('../../src/core/services/runtimeConfig', () => ({
  isDevMode: jest.fn(() => false),
  getRuntimeConfig: jest.fn(() => ({ devMode: false })),
  fetchRuntimeConfig: jest.fn(async () => ({ devMode: false })),
  initializeRuntimeConfig: jest.fn(async () => {}),
}));

// Import the mocked functions to control them in tests
import { isDevMode as mockIsDevMode, getRuntimeConfig as mockGetRuntimeConfig, fetchRuntimeConfig as mockFetchRuntimeConfig } from '../../src/core/services/runtimeConfig';

describe('mcpClient', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
    localStorage.clear();

    // Default mock for config endpoint (will be called by RuntimeConfig)
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ devMode: false }),
        });
      }
      // Default fallback
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
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

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        // MCP chat endpoint
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify(mockResponse),
              },
            },
          }),
        });
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
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
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
      });

      const result = await chat('test-model', 'Test question');

      expect(result.response).toBe('Simple response');
      expect(result.progressLog).toEqual([]);
    });

    it('should handle plain text response (non-JSON)', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: 'Plain text response',
              },
            },
          }),
        });
      });

      const result = await chat('test-model', 'Test question');

      expect(result.response).toBe('Plain text response');
      expect(result.progressLog).toEqual([]);
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () => 'Server error',
        });
      });

      await expect(chat('test-model', 'Test question')).rejects.toThrow(
        'MCP request failed: 500'
      );
    });

    it('should handle MCP error responses', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            error: {
              message: 'MCP error occurred',
            },
          }),
        });
      });

      await expect(chat('test-model', 'Test question')).rejects.toThrow(
        'MCP error: MCP error occurred'
      );
    });

    it('should handle empty response', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      await expect(chat('test-model', 'Test question')).rejects.toThrow(
        'Empty MCP response'
      );
    });

    it('should send namespace and scope if provided', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify({ response: 'Test' }),
              },
            },
          }),
        });
      });

      await chat('test-model', 'Test question', {
        namespace: 'test-namespace',
        scope: 'namespace_scoped',
      });

      // Find the MCP call (skip config call)
      const mcpCall = (global.fetch as jest.Mock).mock.calls.find(call =>
        !call[0].includes('/config')
      );
      const callBody = JSON.parse(mcpCall[1].body);
      expect(callBody.params.arguments.namespace).toBe('test-namespace');
      expect(callBody.params.arguments.scope).toBe('namespace_scoped');
    });

    it('should include API key when provided', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify({ response: 'Test' }),
              },
            },
          }),
        });
      });

      await chat('test-model', 'Test question', {
        apiKey: 'my-secret-key',
      });

      // Find the MCP call (skip config call)
      const mcpCall = (global.fetch as jest.Mock).mock.calls.find(call =>
        !call[0].includes('/config')
      );
      const callBody = JSON.parse(mcpCall[1].body);
      expect(callBody.params.arguments.api_key).toBe('my-secret-key');
    });

    it('should include conversation history when provided', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify({ response: 'Test response' }),
              },
            },
          }),
        });
      });

      const conversationHistory = [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ];

      await chat('test-model', 'New question', {
        conversationHistory,
      });

      // Find the MCP call (skip config call)
      const mcpCall = (global.fetch as jest.Mock).mock.calls.find(call =>
        !call[0].includes('/config')
      );
      const callBody = JSON.parse(mcpCall[1].body);
      expect(callBody.params.arguments.conversation_history).toEqual(conversationHistory);
    });

    it('should send empty array when conversation history is not provided', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify({ response: 'Test' }),
              },
            },
          }),
        });
      });

      await chat('test-model', 'Test question');

      // Find the MCP call (skip config call)
      const mcpCall = (global.fetch as jest.Mock).mock.calls.find(call =>
        !call[0].includes('/config')
      );
      const callBody = JSON.parse(mcpCall[1].body);
      // Should not include conversation_history or should be undefined/null
      expect(callBody.params.arguments.conversation_history).toBeUndefined();
    });

    it('should use correct MCP server URL for local dev', async () => {
      // Mock window.location for local dev
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
      });

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify({ response: 'Test' }),
              },
            },
          }),
        });
      });

      await chat('test-model', 'Test question');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8085/mcp',
        expect.any(Object)
      );
    });

    it('should handle array response format', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
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
      });

      const result = await chat('test-model', 'Test question');

      expect(result.response).toBe('Array format response');
    });

    it('should handle object response format', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                structuredContent: {
                  result: JSON.stringify({}),
                },
              },
            }),
          });
        }
        return Promise.resolve({
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
      });

      const result = await chat('test-model', 'Test question');

      expect(result.response).toBe('Object format response');
      expect(result.progressLog).toHaveLength(1);
    });
  });

  describe('DEV Mode - api_url parameter propagation', () => {
    beforeEach(() => {
      sessionStorage.clear();
      // Enable DEV mode via mock
      (mockIsDevMode as jest.Mock).mockReturnValue(true);
      (mockGetRuntimeConfig as jest.Mock).mockReturnValue({ devMode: true });
      (mockFetchRuntimeConfig as jest.Mock).mockResolvedValue({ devMode: true });
    });

    afterEach(() => {
      // Reset to default (disabled)
      (mockIsDevMode as jest.Mock).mockReturnValue(false);
      (mockGetRuntimeConfig as jest.Mock).mockReturnValue({ devMode: false });
      (mockFetchRuntimeConfig as jest.Mock).mockResolvedValue({ devMode: false });
    });

    it('should inject api_url from dev storage for MAAS models', async () => {
      // Save a MAAS model with custom endpoint in dev storage
      const devModel = {
        name: 'maas/qwen3-14b',
        provider: 'maas',
        modelId: 'qwen3-14b',
        endpoint: 'https://custom-maas.example.com/v1/chat/completions',
        apiKey: 'sk-maas-test',
        savedAt: '2026-03-08T00:00:00.000Z',
      };
      sessionStorage.setItem('ai_observability_dev_models', JSON.stringify({ 'maas/qwen3-14b': devModel }));

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          // Mock /config endpoint to return correct structure (not used due to module mock, but kept for consistency)
          return Promise.resolve({
            ok: true,
            json: async () => ({ devMode: true }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify({ response: 'MAAS response' }),
              },
            },
          }),
        });
      });

      await chat('maas/qwen3-14b', 'Test question');

      // Find the MCP call (skip config call)
      const mcpCall = (global.fetch as jest.Mock).mock.calls.find(call =>
        !call[0].includes('/config')
      );
      const callBody = JSON.parse(mcpCall[1].body);

      // Verify api_url was injected from dev storage
      expect(callBody.params.arguments.api_url).toBe('https://custom-maas.example.com/v1/chat/completions');
      // Verify api_key was also injected
      expect(callBody.params.arguments.api_key).toBe('sk-maas-test');
    });

    it('should inject api_url for custom OpenAI-compatible models', async () => {
      const devModel = {
        name: 'openai/custom-model',
        provider: 'openai',
        modelId: 'custom-model',
        endpoint: 'https://custom-openai.example.com/v1/chat/completions',
        apiKey: 'sk-custom-openai',
        savedAt: '2026-03-08T00:00:00.000Z',
      };
      sessionStorage.setItem('ai_observability_dev_models', JSON.stringify({ 'openai/custom-model': devModel }));

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          // Mock /config endpoint to return correct structure (not used due to module mock, but kept for consistency)
          return Promise.resolve({
            ok: true,
            json: async () => ({ devMode: true }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify({ response: 'Custom OpenAI response' }),
              },
            },
          }),
        });
      });

      await chat('openai/custom-model', 'Test question');

      const mcpCall = (global.fetch as jest.Mock).mock.calls.find(call =>
        !call[0].includes('/config')
      );
      const callBody = JSON.parse(mcpCall[1].body);

      expect(callBody.params.arguments.api_url).toBe('https://custom-openai.example.com/v1/chat/completions');
      expect(callBody.params.arguments.api_key).toBe('sk-custom-openai');
    });

    it('should not inject api_url when not in dev storage', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/config')) {
          // Mock /config endpoint to return correct structure (not used due to module mock, but kept for consistency)
          return Promise.resolve({
            ok: true,
            json: async () => ({ devMode: true }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                result: JSON.stringify({ response: 'Standard response' }),
              },
            },
          }),
        });
      });

      await chat('gpt-4o-mini', 'Test question');

      const mcpCall = (global.fetch as jest.Mock).mock.calls.find(call =>
        !call[0].includes('/config')
      );
      const callBody = JSON.parse(mcpCall[1].body);

      // api_url should not be present
      expect(callBody.params.arguments.api_url).toBeUndefined();
    });

  });
});
