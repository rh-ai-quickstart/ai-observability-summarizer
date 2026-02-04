import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OpenShiftMetricsPage } from '../../src/core/pages/OpenShiftMetricsPage';

// Mock the MCP client
jest.mock('../../src/core/services/mcpClient', () => ({
  fetchOpenShiftMetrics: jest.fn(),
  listOpenShiftNamespaces: jest.fn(),
  getAlerts: jest.fn(),
  analyzeOpenShift: jest.fn(),
  getSessionConfig: jest.fn(),
}));

// Mock the useSettings hook with proper implementation
const mockHandleOpenSettings = jest.fn();
const mockUseAIConfigWarningDismissal = jest.fn();

jest.mock('../../src/core/hooks/useSettings', () => ({
  useSettings: () => ({
    handleOpenSettings: mockHandleOpenSettings,
    useAIConfigWarningDismissal: mockUseAIConfigWarningDismissal,
    AI_CONFIG_WARNING: 'AI_CONFIG_REQUIRED',
  }),
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

// Mock MetricChartModal
jest.mock('../../src/core/components/MetricChartModal', () => ({
  MetricChartModal: ({ isOpen, onClose }: any) => 
    isOpen ? <div data-testid="chart-modal"><button onClick={onClose}>Close Modal</button></div> : null,
}));

const {
  fetchOpenShiftMetrics,
  listOpenShiftNamespaces,
  getAlerts,
  analyzeOpenShift,
  getSessionConfig,
} = require('../../src/core/services/mcpClient');

const mockNamespaces = ['default', 'kube-system', 'openshift-ai'];
const mockMetrics = {
  'Total Pods Running': { latest_value: 42, time_series: [
    { timestamp: '2024-01-01T10:00:00Z', value: 40 },
    { timestamp: '2024-01-01T10:05:00Z', value: 42 },
  ]},
  'Total Pods Failed': { latest_value: 2, time_series: [] },
  'Cluster CPU Usage (%)': { latest_value: 65.5, time_series: [
    { timestamp: '2024-01-01T10:00:00Z', value: 60.0 },
    { timestamp: '2024-01-01T10:05:00Z', value: 65.5 },
  ]},
};

const mockAlerts = [
  {
    name: 'HighCPUUsage',
    severity: 'warning',
    description: 'CPU usage is high',
    status: 'firing',
    timestamp: '2024-01-01T10:00:00Z',
  },
];

describe('OpenShiftMetricsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    listOpenShiftNamespaces.mockResolvedValue(mockNamespaces);
    fetchOpenShiftMetrics.mockResolvedValue({ metrics: mockMetrics });
    getAlerts.mockResolvedValue(mockAlerts);
    getSessionConfig.mockReturnValue({ ai_model: 'gpt-4', api_key: 'test-key' });
    
    // Mock URL methods for download functionality
    Object.defineProperty(window.URL, 'createObjectURL', {
      value: jest.fn(() => 'mock-blob-url'),
      writable: true,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      value: jest.fn(),
      writable: true,
    });
  });

  describe('Initial Load and Basic Rendering', () => {
    it('should render page title and header', async () => {
      render(<OpenShiftMetricsPage />);
      
      // Wait for namespaces to load first
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
      
      expect(screen.getByText('OpenShift Metrics')).toBeInTheDocument();
      expect(screen.getByText('Monitor cluster and namespace-level resources and workloads')).toBeInTheDocument();
    });

    it('should show loading state initially', () => {
      // Make namespace loading never complete for this test
      listOpenShiftNamespaces.mockImplementation(() => new Promise(() => {}));
      
      render(<OpenShiftMetricsPage />);
      
      expect(screen.getByText('Loading namespaces...')).toBeInTheDocument();
    });

    it('should load namespaces on mount', async () => {
      render(<OpenShiftMetricsPage />);
      
      await waitFor(() => {
        expect(listOpenShiftNamespaces).toHaveBeenCalledTimes(1);
      });
    });

    it('should render scope toggle buttons', async () => {
      render(<OpenShiftMetricsPage />);
      
      // Wait for namespaces to load
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
      
      await waitFor(() => {
        // Use getAllByText since text appears multiple times (toggle button + label)
        expect(screen.getAllByText('Cluster-wide').length).toBeGreaterThanOrEqual(1);
        // Namespace also appears multiple times
        expect(screen.getAllByText('Namespace').length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Category and Filter Controls', () => {
    beforeEach(async () => {
      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
    });

    it('should render category selector with all 11 categories', () => {
      const categorySelect = screen.getByLabelText('Select category');
      expect(categorySelect).toBeInTheDocument();

      // Should have all 11 categories available
      // HTML entities encode & as &amp;
      const expectedCategories = [
        'Fleet Overview',
        'Jobs &amp; Workloads', 
        'Storage &amp; Config',
        'Node Metrics',
        'GPU &amp; Accelerators',
        'Autoscaling &amp; Scheduling',
        'Pod &amp; Container Metrics',
        'Network Metrics',
        'Storage I/O',
        'Services &amp; Networking',
        'Application Services',
      ];

      // Check that category selector contains these options
      expectedCategories.forEach(category => {
        expect(categorySelect.innerHTML).toContain(category);
      });
    });

    it('should render time range selector', () => {
      const timeRangeSelect = screen.getByLabelText('Select time range');
      expect(timeRangeSelect).toBeInTheDocument();
      
      // Check for time range options
      expect(timeRangeSelect.innerHTML).toContain('15 minutes');
      expect(timeRangeSelect.innerHTML).toContain('1 hour');
      expect(timeRangeSelect.innerHTML).toContain('6 hours');
      expect(timeRangeSelect.innerHTML).toContain('24 hours');
      expect(timeRangeSelect.innerHTML).toContain('7 days');
    });

    it('should render namespace selector when in namespace scope', async () => {
      // Switch to namespace scope - use button role to be more specific
      const namespaceButton = screen.getByRole('button', { name: /Namespace/i });
      fireEvent.click(namespaceButton);

      await waitFor(() => {
        const namespaceSelect = screen.getByLabelText('Select namespace');
        expect(namespaceSelect).toBeInTheDocument();
        expect(namespaceSelect.innerHTML).toContain('default');
        expect(namespaceSelect.innerHTML).toContain('kube-system');
        expect(namespaceSelect.innerHTML).toContain('openshift-ai');
      });
    });

    it('should disable namespace selector in cluster-wide scope', () => {
      const namespaceSelect = screen.getByLabelText('Select namespace');
      expect(namespaceSelect).toBeDisabled();
      expect(namespaceSelect.innerHTML).toContain('All Namespaces (Cluster-wide)');
    });
  });

  describe('Action Buttons', () => {
    beforeEach(async () => {
      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
    });

    it('should render all action buttons', () => {
      expect(screen.getByLabelText('Refresh metrics')).toBeInTheDocument();
      expect(screen.getByText('Report')).toBeInTheDocument();
      expect(screen.getByText('Analyze with AI')).toBeInTheDocument();
    });

    it('should trigger metrics refresh when refresh button is clicked', () => {
      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);

      expect(fetchOpenShiftMetrics).toHaveBeenCalledWith(
        'Fleet Overview',
        'cluster_wide',
        '1h',
        undefined
      );
    });

    it('should disable download dropdown when no metrics data', async () => {
      fetchOpenShiftMetrics.mockResolvedValue({ metrics: {} });
      
      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(screen.getByText('Report').closest('button')).toBeDisabled();
      });
    });
  });

  describe('Metrics Display', () => {
    beforeEach(async () => {
      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
      
      // Trigger metrics load
      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);
      
      await waitFor(() => expect(fetchOpenShiftMetrics).toHaveBeenCalled());
    });

    it('should display metric cards when data is loaded', async () => {
      await waitFor(() => {
        expect(screen.getByText('Pods Running')).toBeInTheDocument();
        // Values are displayed in the UI
        expect(screen.getByText('42')).toBeInTheDocument(); // Pods Running value
        expect(screen.getByText('2')).toBeInTheDocument();  // Pods Failed value
        // CPU usage - might be formatted as "65.50%" or "65.5%"
        const cpuElements = screen.getAllByText(/65\.5/);
        expect(cpuElements.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should display average values for metrics with time series data', async () => {
      await waitFor(() => {
        // Check that average info is present for metrics with time series
        // The exact format may vary, so use flexible matching
        const avgElements = screen.getAllByText(/Avg:/i);
        expect(avgElements.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should show chart buttons for metrics with time series data', async () => {
      await waitFor(() => {
        const chartButtons = screen.getAllByLabelText('View full chart');
        expect(chartButtons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Scope Changes', () => {
    beforeEach(async () => {
      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
    });

    it('should clear metrics data when switching scope', async () => {
      // First load some data
      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);
      await waitFor(() => expect(fetchOpenShiftMetrics).toHaveBeenCalled());

      // Wait for metrics to display
      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument();
      });

      // Switch to namespace scope
      const namespaceButton = screen.getByRole('button', { name: /Namespace/i });
      fireEvent.click(namespaceButton);

      // Metrics should be cleared (no metric values displayed)
      await waitFor(() => {
        expect(screen.queryByText('42')).not.toBeInTheDocument();
      });
    });

    it('should show fleet view indicator in cluster-wide mode', () => {
      expect(screen.getByText('Fleet View')).toBeInTheDocument();
      expect(screen.getByText('Analyzing metrics across the entire OpenShift cluster')).toBeInTheDocument();
    });

    it('should hide fleet view indicator in namespace mode', () => {
      const namespaceButton = screen.getByRole('button', { name: /Namespace/i });
      fireEvent.click(namespaceButton);

      expect(screen.queryByText('Fleet View')).not.toBeInTheDocument();
    });
  });

  describe('AI Analysis', () => {
    beforeEach(async () => {
      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
    });

    it('should trigger AI analysis when button is clicked', async () => {
      analyzeOpenShift.mockResolvedValue({
        summary: '## Analysis Results\n\nCluster is healthy.',
        category: 'Fleet Overview',
        scope: 'cluster_wide',
      });

      const analyzeButton = screen.getAllByText('Analyze with AI')[0];
      fireEvent.click(analyzeButton);

      expect(analyzeOpenShift).toHaveBeenCalledWith(
        'Fleet Overview',
        'cluster_wide',
        undefined,
        'gpt-4',
        'test-key',
        '1h'
      );

      await waitFor(() => {
        // AI Analysis appears in both button and panel header
        expect(screen.getAllByText('Analyze with AI').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
      });
    });

    it('should show configuration error when AI model not configured', async () => {
      // Mock getSessionConfig to return null ai_model
      getSessionConfig.mockReturnValue({ ai_model: null });

      render(<OpenShiftMetricsPage />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText('OpenShift Metrics')).toBeInTheDocument();
      });

      // Find and click the AI Analysis button
      const analyzeButtons = screen.getAllByText('Analyze with AI');
      const analyzeButton = analyzeButtons[0].closest('button');

      expect(analyzeButton).toBeTruthy();
      fireEvent.click(analyzeButton);

      // Check that the configuration error is displayed
      await waitFor(() => {
        expect(screen.getByText(/Configuration Required/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Open Settings/i })).toBeInTheDocument();
      });
    });

    it('should show loading state during analysis', () => {
      analyzeOpenShift.mockImplementation(() => new Promise(() => {})); // Never resolves

      const analyzeButton = screen.getAllByText('Analyze with AI')[0];
      fireEvent.click(analyzeButton);

      expect(screen.getByText('Analyzing Fleet Overview...')).toBeInTheDocument();
      expect(screen.getByText('Cancel Analysis')).toBeInTheDocument();
    });

    it('should display analysis context in title', async () => {
      analyzeOpenShift.mockResolvedValue({
        summary: 'Analysis complete',
        category: 'GPU & Accelerators',
        scope: 'cluster_wide',
      });

      const analyzeButton = screen.getAllByText('Analyze with AI')[0];
      fireEvent.click(analyzeButton);

      await waitFor(() => {
        // Check for analysis panel with context info
        // The exact format may include category and scope info
        expect(screen.getAllByText(/GPU/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/Cluster-wide/i).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('GPU Fleet Summary', () => {
    const mockGPUMetrics = {
      'GPU Count': { latest_value: 4 },
      'GPU Utilization (%)': { 
        latest_value: 85,
        time_series: [
          { timestamp: '2024-01-01T10:00:00Z', value: 80 },
          { timestamp: '2024-01-01T10:05:00Z', value: 85 },
        ],
      },
      'GPU Temperature (°C)': { 
        latest_value: 75,
        time_series: [
          { timestamp: '2024-01-01T10:00:00Z', value: 70 },
          { timestamp: '2024-01-01T10:05:00Z', value: 75 },
        ],
      },
      'GPU Power Usage (W)': { latest_value: 1000 },
    };

    it('should show GPU Fleet Summary for GPU category in cluster scope', async () => {
      fetchOpenShiftMetrics.mockResolvedValue({ metrics: mockGPUMetrics });

      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());

      // Change to GPU category
      const categorySelect = screen.getByLabelText('Select category');
      fireEvent.change(categorySelect, { target: { value: 'GPU & Accelerators' } });

      // Trigger refresh
      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(screen.getByText('GPU Fleet Overview')).toBeInTheDocument();
        expect(screen.getByText('Total GPUs')).toBeInTheDocument();
        expect(screen.getByText('Avg Utilization')).toBeInTheDocument();
        expect(screen.getByText('Avg Temperature')).toBeInTheDocument();
        expect(screen.getByText('Fleet Power')).toBeInTheDocument();
      });
    });

    it('should not show GPU Fleet Summary for non-GPU categories', async () => {
      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());

      // Default is Fleet Overview - should not show GPU Fleet Summary
      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(fetchOpenShiftMetrics).toHaveBeenCalled();
      });

      expect(screen.queryByText('GPU Fleet Overview')).not.toBeInTheDocument();
    });
  });

  describe('Chart Modal Integration', () => {
    beforeEach(async () => {
      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
      
      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);
      await waitFor(() => expect(fetchOpenShiftMetrics).toHaveBeenCalled());
    });

    it('should open chart modal when chart button is clicked', async () => {
      await waitFor(() => {
        const chartButtons = screen.getAllByLabelText('View full chart');
        fireEvent.click(chartButtons[0]);
        
        expect(screen.getByTestId('chart-modal')).toBeInTheDocument();
      });
    });

    it('should close chart modal when close button is clicked', async () => {
      await waitFor(() => {
        const chartButtons = screen.getAllByLabelText('View full chart');
        fireEvent.click(chartButtons[0]);
        
        expect(screen.getByTestId('chart-modal')).toBeInTheDocument();
        
        const closeButton = screen.getByText('Close Modal');
        fireEvent.click(closeButton);
        
        expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument();
      });
    });
  });

  describe('Download Functionality', () => {
    let createElementSpy: jest.SpyInstance;
    let appendChildSpy: jest.SpyInstance;
    let removeChildSpy: jest.SpyInstance;

    beforeEach(async () => {
      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());
      
      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);
      await waitFor(() => expect(fetchOpenShiftMetrics).toHaveBeenCalled());
    });

    afterEach(() => {
      if (createElementSpy) createElementSpy.mockRestore();
      if (appendChildSpy) appendChildSpy.mockRestore();
      if (removeChildSpy) removeChildSpy.mockRestore();
    });

    it('should trigger markdown download when Markdown option is selected', async () => {
      // Setup mocks for download
      const mockAnchor = { click: jest.fn(), href: '', download: '' };
      const originalCreateElement = document.createElement.bind(document);
      createElementSpy = jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'a') return mockAnchor as any;
        return originalCreateElement(tag);
      });
      appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      await waitFor(() => {
        const downloadButton = screen.getByText('Report');
        expect(downloadButton.closest('button')).not.toBeDisabled();
        
        // Open the dropdown
        fireEvent.click(downloadButton);
      });

      await waitFor(() => {
        const markdownOption = screen.getByText('Markdown');
        fireEvent.click(markdownOption);
        
        expect(window.URL.createObjectURL).toHaveBeenCalled();
      });
    });

    it('should trigger HTML download when HTML option is selected', async () => {
      // Setup mocks for download
      const mockAnchor = { click: jest.fn(), href: '', download: '' };
      const originalCreateElement = document.createElement.bind(document);
      createElementSpy = jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'a') return mockAnchor as any;
        return originalCreateElement(tag);
      });
      appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      await waitFor(() => {
        const downloadButton = screen.getByText('Report');
        expect(downloadButton.closest('button')).not.toBeDisabled();
        
        // Open the dropdown
        fireEvent.click(downloadButton);
      });

      await waitFor(() => {
        const htmlOption = screen.getByText('HTML');
        fireEvent.click(htmlOption);
        
        expect(window.URL.createObjectURL).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle namespace loading error', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      listOpenShiftNamespaces.mockRejectedValue(new Error('Failed to load'));

      render(<OpenShiftMetricsPage />);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[OpenShift] Failed to load namespaces:',
          expect.any(Error)
        );
      });

      consoleError.mockRestore();
    });

    it('should handle metrics loading error', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      fetchOpenShiftMetrics.mockRejectedValue(new Error('Metrics failed'));

      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());

      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[OpenShift] Failed to load metrics:',
          expect.any(Error)
        );
      });

      consoleError.mockRestore();
    });

    it('should show no data message when metrics are empty', async () => {
      fetchOpenShiftMetrics.mockResolvedValue({ metrics: {} });

      render(<OpenShiftMetricsPage />);
      await waitFor(() => expect(listOpenShiftNamespaces).toHaveBeenCalled());

      const refreshButton = screen.getByLabelText('Refresh metrics');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(screen.getByText('No metrics data')).toBeInTheDocument();
        expect(screen.getByText(/No metrics data available for Fleet Overview/)).toBeInTheDocument();
      });
    });
  });
});