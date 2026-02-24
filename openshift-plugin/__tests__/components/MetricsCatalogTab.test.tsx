/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetricsCatalogTab, resetMetricsCatalogCache } from '../../src/core/components/AIModelSettings/tabs/MetricsCatalogTab';

// Mock callMcpTool
const mockCallMcpTool = jest.fn();
jest.mock('../../src/core/services/mcpClient', () => ({
  callMcpTool: (...args: any[]) => mockCallMcpTool(...args),
}));

// Mock downloadAsFile
const mockDownloadAsFile = jest.fn();
jest.mock('../../src/core/utils/downloadFile', () => ({
  downloadAsFile: (...args: any[]) => mockDownloadAsFile(...args),
}));

const sampleCategories = [
  {
    id: 'cluster_health',
    name: 'Cluster Resources & Health',
    description: 'Cluster-wide resource metrics',
    icon: '\uD83C\uDFE2',
    metric_count: 5,
    priority_distribution: { High: 3, Medium: 2 },
  },
  {
    id: 'gpu_ai',
    name: 'GPU & AI Accelerators',
    description: 'GPU metrics for AI/ML workloads',
    icon: '\uD83C\uDFAE',
    metric_count: 10,
    priority_distribution: { High: 4, Medium: 6 },
  },
];

const clusterHealthDetail = {
  id: 'cluster_health',
  name: 'Cluster Resources & Health',
  description: 'Cluster-wide resource metrics',
  icon: '\uD83C\uDFE2',
  purpose: 'Monitor overall cluster state',
  total_metrics: 2,
  metrics: {
    High: [
      {
        name: 'cluster_version',
        type: 'gauge',
        help: 'Current cluster version',
        keywords: ['cluster', 'version', 'current'],
      },
    ],
    Medium: [
      {
        name: 'cluster_operator_conditions',
        type: 'gauge',
        help: 'Operator conditions',
        keywords: ['operator', 'conditions'],
      },
    ],
  },
};

const gpuAiDetail = {
  id: 'gpu_ai',
  name: 'GPU & AI Accelerators',
  description: 'GPU metrics for AI/ML workloads',
  icon: '\uD83C\uDFAE',
  purpose: 'GPU and AI/ML workload metrics',
  total_metrics: 1,
  metrics: {
    High: [
      {
        name: 'vllm:e2e_request_latency_seconds_bucket',
        type: 'unknown',
        help: 'End to end request latency',
        keywords: ['vllm', 'latency', 'e2e'],
      },
    ],
    Medium: [],
  },
};

/** Helper: mock the full load sequence (categories + all details) */
const mockFullLoad = (cats = sampleCategories, details: Record<string, any> = {}) => {
  // First call: get_category_metrics_detail (no args) returns category list
  mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(cats));
  // Subsequent calls: one per category for details
  cats.forEach(cat => {
    const detail = details[cat.id] || { id: cat.id, name: cat.name, description: '', icon: '', purpose: '', total_metrics: 0, metrics: { High: [], Medium: [] } };
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(detail));
  });
};

describe('MetricsCatalogTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    resetMetricsCatalogCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows loading spinner initially', () => {
    mockCallMcpTool.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MetricsCatalogTab />);
    expect(screen.getByLabelText('Loading metrics catalog')).toBeInTheDocument();
  });

  it('displays categories after loading', async () => {
    mockFullLoad();

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
      expect(screen.getByText('GPU & AI Accelerators')).toBeInTheDocument();
    });

    expect(screen.getByText('5 metrics')).toBeInTheDocument();
    expect(screen.getByText('10 metrics')).toBeInTheDocument();
  });

  it('displays error when loading fails', async () => {
    mockCallMcpTool.mockRejectedValueOnce(new Error('Network error'));

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Error loading metrics catalog')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays error from response body', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify({ error: 'Catalog not available' }));

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Catalog not available')).toBeInTheDocument();
    });
  });

  it('filters categories by search term', async () => {
    mockFullLoad(sampleCategories, {
      cluster_health: clusterHealthDetail,
      gpu_ai: gpuAiDetail,
    });

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search categories and metrics...');
    fireEvent.change(searchInput, { target: { value: 'GPU' } });

    // Advance past the 200ms debounce timer
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.queryByText('Cluster Resources & Health')).not.toBeInTheDocument();
    expect(screen.getByText('GPU & AI Accelerators')).toBeInTheDocument();
  });

  it('shows no-match message when filter has no results', async () => {
    mockFullLoad(sampleCategories, {
      cluster_health: clusterHealthDetail,
      gpu_ai: gpuAiDetail,
    });

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search categories and metrics...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    // Advance past the 200ms debounce timer
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByText('No categories or metrics match the search.')).toBeInTheDocument();
  });

  it('searches within metric names and shows matching category', async () => {
    mockFullLoad(sampleCategories, {
      cluster_health: clusterHealthDetail,
      gpu_ai: gpuAiDetail,
    });

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search categories and metrics...');
    fireEvent.change(searchInput, { target: { value: 'vllm' } });

    // Advance past the 200ms debounce timer
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    // GPU category should appear because it contains a vllm metric
    expect(screen.getByText('GPU & AI Accelerators')).toBeInTheDocument();
    // Cluster category should not appear (no matching metrics)
    expect(screen.queryByText('Cluster Resources & Health')).not.toBeInTheDocument();
  });

  it('shows metric details when category is expanded', async () => {
    mockFullLoad(sampleCategories, {
      cluster_health: clusterHealthDetail,
      gpu_ai: gpuAiDetail,
    });

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    // Click the expandable section toggle for the first category
    const categoryToggle = screen.getByText('Cluster Resources & Health').closest('button');
    expect(categoryToggle).toBeTruthy();
    await act(async () => {
      fireEvent.click(categoryToggle!);
    });

    await waitFor(() => {
      expect(screen.getByText('cluster_version')).toBeInTheDocument();
      expect(screen.getByText('Current cluster version')).toBeInTheDocument();
    });
  });

  it('displays labeled sections for description and keywords', async () => {
    mockFullLoad(sampleCategories, {
      cluster_health: clusterHealthDetail,
      gpu_ai: gpuAiDetail,
    });

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const categoryToggle = screen.getByText('Cluster Resources & Health').closest('button');
    await act(async () => {
      fireEvent.click(categoryToggle!);
    });

    await waitFor(() => {
      // Description label and text
      expect(screen.getAllByText('Description:').length).toBeGreaterThan(0);
      expect(screen.getByText('Current cluster version')).toBeInTheDocument();

      // Keywords label and all keyword labels shown (no truncation)
      expect(screen.getAllByText('Keywords:').length).toBeGreaterThan(0);
      expect(screen.getByText('cluster')).toBeInTheDocument();
      expect(screen.getByText('version')).toBeInTheDocument();
      expect(screen.getByText('current')).toBeInTheDocument();
      expect(screen.getByText('operator')).toBeInTheDocument();
      expect(screen.getByText('conditions')).toBeInTheDocument();
    });
  });

  it('renders download button', async () => {
    mockFullLoad(sampleCategories, {
      cluster_health: clusterHealthDetail,
      gpu_ai: gpuAiDetail,
    });

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const downloadButton = screen.getByLabelText('Download metrics catalog as markdown');
    expect(downloadButton).toBeInTheDocument();
    expect(downloadButton).not.toBeDisabled();
  });

  it('download button is disabled during loading', () => {
    mockCallMcpTool.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MetricsCatalogTab />);
    // During loading, the download button is not rendered (loading spinner shown instead)
    expect(screen.queryByLabelText('Download metrics catalog as markdown')).not.toBeInTheDocument();
  });

  it('download button generates markdown file', async () => {
    mockFullLoad(sampleCategories, {
      cluster_health: clusterHealthDetail,
      gpu_ai: gpuAiDetail,
    });

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const downloadButton = screen.getByLabelText('Download metrics catalog as markdown');
    fireEvent.click(downloadButton);

    expect(mockDownloadAsFile).toHaveBeenCalledTimes(1);
    const [content, filename] = mockDownloadAsFile.mock.calls[0];
    expect(content).toContain('# Chat - Metrics Catalog');
    expect(content).toContain('Cluster Resources & Health');
    expect(content).toContain('cluster_version');
    expect(filename).toMatch(/^metrics-catalog-\d+\.md$/);
  });

  it('shows collapsible priority sections', async () => {
    mockFullLoad(sampleCategories, {
      cluster_health: clusterHealthDetail,
      gpu_ai: gpuAiDetail,
    });

    render(<MetricsCatalogTab />);

    // Wait for full loading to complete (spinner gone, categories + details loaded)
    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
      expect(screen.queryByLabelText('Loading metrics catalog')).not.toBeInTheDocument();
    });

    // Expand the category
    const categoryToggle = screen.getByText('Cluster Resources & Health').closest('button');
    await act(async () => {
      fireEvent.click(categoryToggle!);
    });

    await waitFor(() => {
      expect(screen.getAllByText('High Priority').length).toBeGreaterThan(0);
      expect(screen.getByText('Medium Priority')).toBeInTheDocument();
    });

    // Both priority sections should be expanded by default, showing metrics
    expect(screen.getByText('cluster_version')).toBeInTheDocument();
    expect(screen.getByText('cluster_operator_conditions')).toBeInTheDocument();

    // Collapse the first High Priority section
    const highPriorityToggle = screen.getAllByText('High Priority')[0].closest('button');
    expect(highPriorityToggle).toBeTruthy();

    await act(async () => {
      fireEvent.click(highPriorityToggle!);
    });

    // After collapsing High Priority, cluster_version should be hidden
    // (inside a collapsed expandable section with hidden attribute)
    const versionElement = screen.getByText('cluster_version');
    const hiddenParent = versionElement.closest('[hidden]');
    expect(hiddenParent).toBeTruthy();

    // Medium Priority section should remain visible (no hidden ancestor)
    const operatorElement = screen.getByText('cluster_operator_conditions');
    const hiddenOperatorParent = operatorElement.closest('[hidden]');
    expect(hiddenOperatorParent).toBeNull();
  });
});
