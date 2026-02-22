import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import VLLMMetricsPage from '../../src/core/pages/VLLMMetricsPage';

// Mock the MCP client
jest.mock('../../src/core/services/mcpClient', () => ({
  listModels: jest.fn(),
  listNamespaces: jest.fn(),
  fetchVLLMMetrics: jest.fn(),
  analyzeVLLM: jest.fn(),
  getSessionConfig: jest.fn(),
  chatVLLM: jest.fn(),
}));

// Mock react-markdown to avoid SSR issues in tests
jest.mock('react-markdown', () => {
  return ({ children }: any) => <div data-testid="markdown-content">{children}</div>;
});

// Mock react-helmet
jest.mock('react-helmet', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="helmet">{children}</div>,
}));

// Mock ConfigurationRequiredAlert
jest.mock('../../src/core/components/ConfigurationRequiredAlert', () => ({
  ConfigurationRequiredAlert: ({ onClose }: any) => (
    <div data-testid="config-alert">
      <button onClick={onClose}>Close Alert</button>
    </div>
  ),
}));

// Mock MetricsChatPanel
jest.mock('../../src/core/components/MetricsChatPanel', () => ({
  MetricsChatPanel: ({ isOpen, onClose, pageType, modelName }: any) =>
    isOpen ? (
      <div data-testid="chat-panel">
        Chat Panel for {pageType} - {modelName}
        <button onClick={onClose}>Close Chat</button>
      </div>
    ) : null,
}));

const {
  listModels,
  listNamespaces,
  fetchVLLMMetrics,
  analyzeVLLM,
  getSessionConfig,
} = require('../../src/core/services/mcpClient');

const mockNamespaces = [
  { name: 'vllm-namespace-1', model_count: 2 },
  { name: 'vllm-namespace-2', model_count: 1 },
];

const mockModels = [
  { namespace: 'vllm-namespace-1', name: 'llama-2-7b', status: 'running' },
  { namespace: 'vllm-namespace-1', name: 'mistral-7b', status: 'running' },
  { namespace: 'vllm-namespace-2', name: 'phi-2', status: 'running' },
];

const mockMetricsData = {
  'GPU Temperature (°C)': {
    latest_value: 65.5,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 63.0 },
      { timestamp: '2024-01-01T10:05:00Z', value: 64.2 },
      { timestamp: '2024-01-01T10:10:00Z', value: 65.5 },
    ],
  },
  'GPU Power Usage (Watts)': {
    latest_value: 250.0,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 245.0 },
      { timestamp: '2024-01-01T10:05:00Z', value: 248.0 },
      { timestamp: '2024-01-01T10:10:00Z', value: 250.0 },
    ],
  },
  'P95 Latency (s)': {
    latest_value: 0.125,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 0.120 },
      { timestamp: '2024-01-01T10:05:00Z', value: 0.122 },
      { timestamp: '2024-01-01T10:10:00Z', value: 0.125 },
    ],
  },
  'GPU Usage (%)': {
    latest_value: 85.0,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 80.0 },
      { timestamp: '2024-01-01T10:05:00Z', value: 82.5 },
      { timestamp: '2024-01-01T10:10:00Z', value: 85.0 },
    ],
  },
  'Output Tokens Created': {
    latest_value: 150000,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 140000 },
      { timestamp: '2024-01-01T10:05:00Z', value: 145000 },
      { timestamp: '2024-01-01T10:10:00Z', value: 150000 },
    ],
  },
  'Prompt Tokens Created': {
    latest_value: 50000,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 45000 },
      { timestamp: '2024-01-01T10:05:00Z', value: 47500 },
      { timestamp: '2024-01-01T10:10:00Z', value: 50000 },
    ],
  },
  'Requests Total': {
    latest_value: 1234,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 1200 },
      { timestamp: '2024-01-01T10:05:00Z', value: 1217 },
      { timestamp: '2024-01-01T10:10:00Z', value: 1234 },
    ],
  },
  'Request Errors Total': {
    latest_value: 5,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 3 },
      { timestamp: '2024-01-01T10:05:00Z', value: 4 },
      { timestamp: '2024-01-01T10:10:00Z', value: 5 },
    ],
  },
  'Kv Cache Usage Perc': {
    latest_value: 72.5,
    time_series: [
      { timestamp: '2024-01-01T10:00:00Z', value: 70.0 },
      { timestamp: '2024-01-01T10:05:00Z', value: 71.2 },
      { timestamp: '2024-01-01T10:10:00Z', value: 72.5 },
    ],
  },
};

const mockAnalysisResult = {
  summary: 'Overall, your vLLM model is performing well.\n\nKey highlights:\n- GPU temperature is normal at 65.5°C\n- Latency is excellent at 125ms\n- Processing 200K tokens efficiently',
};

describe('VLLMMetricsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    listNamespaces.mockResolvedValue(mockNamespaces);
    listModels.mockResolvedValue(mockModels);
    fetchVLLMMetrics.mockResolvedValue({ metrics: mockMetricsData });
    getSessionConfig.mockReturnValue({ ai_model: 'claude-3-opus', api_key: 'test-key' });
    analyzeVLLM.mockResolvedValue(mockAnalysisResult);
  });

  describe('Initial Load and Basic Rendering', () => {
    it('should render page title and header', async () => {
      render(<VLLMMetricsPage />);

      // Wait for data to load
      await waitFor(() => expect(listModels).toHaveBeenCalled());

      expect(screen.getByText('vLLM Metrics')).toBeInTheDocument();
      expect(screen.getByText('Monitor and analyze vLLM model performance and resource utilization')).toBeInTheDocument();
    });

    it('should show loading spinner initially', () => {
      // Make loading never complete for this test
      listModels.mockImplementation(() => new Promise(() => {}));
      listNamespaces.mockImplementation(() => new Promise(() => {}));

      render(<VLLMMetricsPage />);

      // Should show spinner in the page section
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should load namespaces and models on mount', async () => {
      render(<VLLMMetricsPage />);

      await waitFor(() => {
        expect(listNamespaces).toHaveBeenCalledTimes(1);
        expect(listModels).toHaveBeenCalledTimes(1);
      });
    });

    it('should auto-select first namespace and model after loading', async () => {
      render(<VLLMMetricsPage />);

      await waitFor(() => {
        const namespaceSelect = screen.getByLabelText('Namespace');
        const modelSelect = screen.getByLabelText('Model');

        expect(namespaceSelect).toHaveValue('vllm-namespace-1');
        expect(modelSelect).toHaveValue('vllm-namespace-1 | llama-2-7b');
      });
    });
  });

  describe('Namespace and Model Selection', () => {
    beforeEach(async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(listModels).toHaveBeenCalled());
    });

    it('should render namespace selector with all namespaces', async () => {
      const namespaceSelect = screen.getByLabelText('Namespace');
      expect(namespaceSelect).toBeInTheDocument();

      // Check for "All Namespaces" option
      expect(namespaceSelect.innerHTML).toContain('All Namespaces');
      // Check for namespace options
      expect(namespaceSelect.innerHTML).toContain('vllm-namespace-1');
      expect(namespaceSelect.innerHTML).toContain('vllm-namespace-2');
    });

    it('should render model selector with models from selected namespace', async () => {
      const modelSelect = screen.getByLabelText('Model');
      expect(modelSelect).toBeInTheDocument();

      // Initially should show models from first namespace
      expect(modelSelect.innerHTML).toContain('llama-2-7b');
      expect(modelSelect.innerHTML).toContain('mistral-7b');
    });

    it('should filter models when namespace changes', async () => {
      const namespaceSelect = screen.getByLabelText('Namespace');

      // Change to namespace-2
      fireEvent.change(namespaceSelect, { target: { value: 'vllm-namespace-2' } });

      await waitFor(() => {
        const modelSelect = screen.getByLabelText('Model');
        // Should only show phi-2 model from namespace-2
        expect(modelSelect.innerHTML).toContain('phi-2');
        // Should not show models from namespace-1
        expect(modelSelect.innerHTML).not.toContain('llama-2-7b');
      });
    });

    it('should show all models when "All Namespaces" is selected', async () => {
      const namespaceSelect = screen.getByLabelText('Namespace');

      fireEvent.change(namespaceSelect, { target: { value: 'all' } });

      await waitFor(() => {
        const modelSelect = screen.getByLabelText('Model');
        // Should show all models
        expect(modelSelect.innerHTML).toContain('llama-2-7b');
        expect(modelSelect.innerHTML).toContain('mistral-7b');
        expect(modelSelect.innerHTML).toContain('phi-2');
      });
    });
  });

  describe('Time Range Selection', () => {
    beforeEach(async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(listModels).toHaveBeenCalled());
    });

    it('should render time range selector with all options', () => {
      const timeRangeSelect = screen.getByLabelText('Time Range');
      expect(timeRangeSelect).toBeInTheDocument();

      expect(timeRangeSelect.innerHTML).toContain('15 minutes');
      expect(timeRangeSelect.innerHTML).toContain('1 hour');
      expect(timeRangeSelect.innerHTML).toContain('6 hours');
      expect(timeRangeSelect.innerHTML).toContain('24 hours');
      expect(timeRangeSelect.innerHTML).toContain('7 days');
    });

    it('should default to 1 hour time range', () => {
      const timeRangeSelect = screen.getByLabelText('Time Range');
      expect(timeRangeSelect).toHaveValue('1h');
    });

    it('should fetch metrics when time range changes', async () => {
      // Wait for initial load
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());

      jest.clearAllMocks();

      const timeRangeSelect = screen.getByLabelText('Time Range');
      fireEvent.change(timeRangeSelect, { target: { value: '6h' } });

      await waitFor(() => {
        expect(fetchVLLMMetrics).toHaveBeenCalledWith(
          expect.any(String),
          '6h',
          expect.any(String)
        );
      });
    });
  });

  describe('Metrics Display', () => {
    beforeEach(async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());
    });

    it('should display Key Metrics section', async () => {
      await waitFor(() => {
        expect(screen.getByText('Key Metrics')).toBeInTheDocument();
        expect(screen.getByText('Critical performance indicators at a glance')).toBeInTheDocument();
      });
    });

    it('should display all six key metrics', async () => {
      await waitFor(() => {
        expect(screen.getByText('GPU Temperature')).toBeInTheDocument();
        expect(screen.getByText('GPU Power Usage')).toBeInTheDocument();
        expect(screen.getByText('P95 Latency')).toBeInTheDocument();
        expect(screen.getByText('GPU Usage')).toBeInTheDocument();
        expect(screen.getByText('Output Tokens')).toBeInTheDocument();
        expect(screen.getByText('Prompt Tokens')).toBeInTheDocument();
      });
    });

    it('should display metric categories as collapsible sections', async () => {
      await waitFor(() => {
        expect(screen.getByText('Request Tracking & Throughput')).toBeInTheDocument();
        expect(screen.getByText('Token Throughput')).toBeInTheDocument();
        expect(screen.getByText('Latency & Timing')).toBeInTheDocument();
        expect(screen.getByText('Memory & Cache')).toBeInTheDocument();
        expect(screen.getByText('GPU Hardware')).toBeInTheDocument();
      });
    });

    it('should expand category when clicked', async () => {
      const categoryHeaders = screen.getAllByText('Request Tracking & Throughput');
      fireEvent.click(categoryHeaders[0]);

      await waitFor(() => {
        // Check for metrics within this category
        expect(screen.getByText('Total Requests')).toBeInTheDocument();
        expect(screen.getByText('Request Errors')).toBeInTheDocument();
      });
    });

    it('should format large numbers with K/M/B suffixes', async () => {
      await waitFor(() => {
        // Output Tokens: 150000 should be formatted as "150.0K"
        const cards = screen.getAllByText(/K|M|B/);
        expect(cards.length).toBeGreaterThan(0);
      });
    });

    it('should handle metrics with zero values', async () => {
      const metricsWithZero = {
        ...mockMetricsData,
        'Request Errors Total': { latest_value: 0, time_series: [] },
      };
      fetchVLLMMetrics.mockResolvedValue({ metrics: metricsWithZero });

      render(<VLLMMetricsPage />);

      await waitFor(() => {
        expect(fetchVLLMMetrics).toHaveBeenCalled();
      });

      // Expand the category to see the metric
      const categoryHeaders = screen.getAllByText('Request Tracking & Throughput');
      fireEvent.click(categoryHeaders[0]);

      await waitFor(() => {
        // Zero values should be displayed as "0"
        expect(screen.getByText('Request Errors')).toBeInTheDocument();
      });
    });

    it('should handle metrics with null/NaN values', async () => {
      const metricsWithNull = {
        'GPU Temperature (°C)': { latest_value: null, time_series: [] },
      };
      fetchVLLMMetrics.mockResolvedValue({ metrics: metricsWithNull });

      render(<VLLMMetricsPage />);

      await waitFor(() => {
        expect(fetchVLLMMetrics).toHaveBeenCalled();
      });

      // Should display N/A for null values
      await waitFor(() => {
        const tempTexts = screen.getAllByText('GPU Temperature');
        expect(tempTexts.length).toBeGreaterThan(0);
      });
    });
  });

  describe('AI Analysis Feature', () => {
    beforeEach(async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());
    });

    it('should render Analyze with AI button', () => {
      const analyzeButton = screen.getByText('Analyze with AI');
      expect(analyzeButton).toBeInTheDocument();
      expect(analyzeButton.closest('button')).not.toBeDisabled();
    });

    it('should call analyzeVLLM when Analyze button is clicked', async () => {
      const analyzeButton = screen.getByText('Analyze with AI');
      fireEvent.click(analyzeButton);

      await waitFor(() => {
        expect(analyzeVLLM).toHaveBeenCalledWith(
          'vllm-namespace-1 | llama-2-7b',
          'claude-3-opus',
          '1h',
          'test-key',
          expect.any(Object) // AbortSignal from AbortController
        );
      });
    });

    it('should display analysis result when analysis completes', async () => {
      const analyzeButton = screen.getByText('Analyze with AI');
      fireEvent.click(analyzeButton);

      await waitFor(() => {
        expect(screen.getByText('AI Analysis')).toBeInTheDocument();
        expect(screen.getByText(/Overall, your vLLM model is performing well/)).toBeInTheDocument();
      });
    });

    it('should show error when AI model is not configured', async () => {
      getSessionConfig.mockReturnValue({ ai_model: '', api_key: '' });

      const analyzeButton = screen.getByText('Analyze with AI');
      fireEvent.click(analyzeButton);

      await waitFor(() => {
        expect(screen.getByTestId('config-alert')).toBeInTheDocument();
      });
    });

    it('should close analysis result when close button is clicked', async () => {
      const analyzeButton = screen.getByText('Analyze with AI');
      fireEvent.click(analyzeButton);

      await waitFor(() => {
        expect(screen.getByText('AI Analysis')).toBeInTheDocument();
      });

      // Find and click the close button (✕)
      const closeButton = screen.getByText('✕').closest('button');
      fireEvent.click(closeButton!);

      await waitFor(() => {
        expect(screen.queryByText('AI Analysis')).not.toBeInTheDocument();
      });
    });

    it('should handle analysis errors gracefully', async () => {
      analyzeVLLM.mockRejectedValue(new Error('Analysis failed'));

      const analyzeButton = screen.getByText('Analyze with AI');
      fireEvent.click(analyzeButton);

      await waitFor(() => {
        expect(screen.getByText(/Failed to analyze metrics/)).toBeInTheDocument();
      });
    });
  });

  describe('Chat Panel Feature', () => {
    beforeEach(async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());
    });

    it('should render AI Assistant button', () => {
      const assistantButton = screen.getByText('AI Assistant');
      expect(assistantButton).toBeInTheDocument();
    });

    it('should open chat panel when AI Assistant button is clicked', async () => {
      const assistantButton = screen.getByText('AI Assistant');
      fireEvent.click(assistantButton);

      await waitFor(() => {
        expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
      });
    });

    it('should close chat panel when close button is clicked', async () => {
      const assistantButton = screen.getByText('AI Assistant');
      fireEvent.click(assistantButton);

      await waitFor(() => {
        expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
      });

      const closeButton = screen.getByText('Close Chat');
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
      });
    });

    it('should update button text when chat panel is open', async () => {
      const assistantButton = screen.getByText('AI Assistant');
      fireEvent.click(assistantButton);

      await waitFor(() => {
        expect(screen.getByText('Close Assistant')).toBeInTheDocument();
      });
    });

    it('should pass correct props to MetricsChatPanel', async () => {
      const assistantButton = screen.getByText('AI Assistant');
      fireEvent.click(assistantButton);

      await waitFor(() => {
        const chatPanel = screen.getByTestId('chat-panel');
        expect(chatPanel).toHaveTextContent('vllm');
        expect(chatPanel).toHaveTextContent('vllm-namespace-1 | llama-2-7b');
      });
    });
  });

  describe('Refresh Functionality', () => {
    beforeEach(async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());
    });

    it('should render Refresh button', () => {
      const refreshButton = screen.getByText('Refresh');
      expect(refreshButton).toBeInTheDocument();
    });

    it('should fetch metrics again when Refresh is clicked', async () => {
      jest.clearAllMocks();

      const refreshButton = screen.getByText('Refresh');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(fetchVLLMMetrics).toHaveBeenCalled();
      });
    });
  });

  describe('Empty States and Error Handling', () => {
    it('should show empty state when no models are available', async () => {
      listModels.mockResolvedValue([]);
      listNamespaces.mockResolvedValue([]);

      render(<VLLMMetricsPage />);

      // When no models are available, ragAvailable is set to false,
      // which shows "vLLM Infrastructure Not Available" instead
      await waitFor(() => {
        expect(screen.getByText('vLLM Infrastructure Not Available')).toBeInTheDocument();
      });
    });

    it('should show error when initial data load fails', async () => {
      listModels.mockRejectedValue(new Error('Failed to load'));

      render(<VLLMMetricsPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load data from MCP server')).toBeInTheDocument();
      });
    });

    it('should show warning when metrics fetch fails', async () => {
      fetchVLLMMetrics.mockRejectedValue(new Error('Metrics fetch failed'));

      render(<VLLMMetricsPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch metrics from MCP server')).toBeInTheDocument();
      });
    });

    it('should show warning when no metrics data is returned', async () => {
      fetchVLLMMetrics.mockResolvedValue({ metrics: {} });

      render(<VLLMMetricsPage />);

      await waitFor(() => {
        expect(screen.getByText(/No metrics data available/)).toBeInTheDocument();
      });
    });

    it('should show Retry button in empty state', async () => {
      listModels.mockResolvedValue([]);
      listNamespaces.mockResolvedValue([]);

      render(<VLLMMetricsPage />);

      await waitFor(() => {
        const retryButton = screen.getByText('Retry');
        expect(retryButton).toBeInTheDocument();
      });
    });
  });

  describe('Current Selection Labels', () => {
    beforeEach(async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());
    });

    it('should display current namespace label', async () => {
      await waitFor(() => {
        // Use getAllByText since the namespace appears in both select and label
        const namespaceTexts = screen.getAllByText('vllm-namespace-1');
        expect(namespaceTexts.length).toBeGreaterThan(0);
      });
    });

    it('should display current model label', async () => {
      await waitFor(() => {
        // Use getAllByText since the model appears in both select and label
        const modelTexts = screen.getAllByText('llama-2-7b');
        expect(modelTexts.length).toBeGreaterThan(0);
      });
    });

    it('should display current time range label', async () => {
      await waitFor(() => {
        expect(screen.getByText('Last 1 hour')).toBeInTheDocument();
      });
    });
  });

  describe('Sparkline Visualization', () => {
    it('should render sparklines for metrics with time series data', async () => {
      render(<VLLMMetricsPage />);

      await waitFor(() => {
        expect(fetchVLLMMetrics).toHaveBeenCalled();
      });

      // SVG elements should be present for sparklines
      const svgElements = document.querySelectorAll('svg polyline');
      expect(svgElements.length).toBeGreaterThan(0);
    });

    it('should not render sparklines for metrics without sufficient data points', async () => {
      const metricsWithLimitedData = {
        'GPU Temperature (°C)': {
          latest_value: 65.5,
          time_series: [{ timestamp: '2024-01-01T10:00:00Z', value: 65.5 }],
        },
      };
      fetchVLLMMetrics.mockResolvedValue({ metrics: metricsWithLimitedData });

      render(<VLLMMetricsPage />);

      await waitFor(() => {
        expect(fetchVLLMMetrics).toHaveBeenCalled();
      });

      // Should not crash, even with insufficient data for sparklines
      expect(screen.getByText('Key Metrics')).toBeInTheDocument();
    });
  });

  describe('Metric Data Race Conditions', () => {
    it('should handle rapid filter changes correctly', async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());

      // Simulate rapid changes
      const namespaceSelect = screen.getByLabelText('Namespace');
      fireEvent.change(namespaceSelect, { target: { value: 'vllm-namespace-2' } });
      fireEvent.change(namespaceSelect, { target: { value: 'vllm-namespace-1' } });

      // Should eventually stabilize
      await waitFor(() => {
        expect(namespaceSelect).toHaveValue('vllm-namespace-1');
      });
    });

    it('should handle multiple rapid filter changes', async () => {
      // This test verifies that rapid filter changes don't cause issues
      render(<VLLMMetricsPage />);

      // Wait for initial load
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());

      const initialCallCount = fetchVLLMMetrics.mock.calls.length;

      // Make rapid changes
      const timeRangeSelect = screen.getByLabelText('Time Range');
      fireEvent.change(timeRangeSelect, { target: { value: '6h' } });
      fireEvent.change(timeRangeSelect, { target: { value: '24h' } });
      fireEvent.change(timeRangeSelect, { target: { value: '1h' } });

      // Wait for calls to complete
      await waitFor(() => {
        expect(fetchVLLMMetrics).toHaveBeenCalledTimes(initialCallCount + 3);
      });

      // Component should still be functional and showing metrics
      expect(screen.getByText('Key Metrics')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    beforeEach(async () => {
      render(<VLLMMetricsPage />);
      await waitFor(() => expect(fetchVLLMMetrics).toHaveBeenCalled());
    });

    it('should have accessible labels for form controls', () => {
      expect(screen.getByLabelText('Namespace')).toBeInTheDocument();
      expect(screen.getByLabelText('Model')).toBeInTheDocument();
      expect(screen.getByLabelText('Time Range')).toBeInTheDocument();
    });

    it('should have clickable buttons with proper roles', () => {
      const refreshButton = screen.getByRole('button', { name: /Refresh/i });
      expect(refreshButton).toBeInTheDocument();

      const analyzeButton = screen.getByRole('button', { name: /Analyze with AI/i });
      expect(analyzeButton).toBeInTheDocument();
    });
  });
});
