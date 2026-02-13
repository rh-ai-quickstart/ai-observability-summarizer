/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetricsSettingsTab } from '../../src/core/components/AIModelSettings/tabs/MetricsSettingsTab';
import { resetMetricsCatalogCache } from '../../src/core/components/AIModelSettings/tabs/MetricsCatalogTab';

// Mock callMcpTool (needed by MetricsCatalogTab)
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
      { name: 'cluster_version', type: 'gauge', help: 'Current cluster version', keywords: ['cluster'] },
    ],
    Medium: [],
  },
};

const mockFullLoad = () => {
  mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
  sampleCategories.forEach(cat => {
    const detail = cat.id === 'cluster_health' ? clusterHealthDetail : { id: cat.id, name: cat.name, description: '', icon: '', purpose: '', total_metrics: 0, metrics: { High: [], Medium: [] } };
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(detail));
  });
};

describe('MetricsSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMetricsCatalogCache();
  });

  it('renders wrapper with title and download button', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Browse and download metrics for Chat, vLLM, and OpenShift.')).toBeInTheDocument();
    expect(screen.getByLabelText('Download Chat Metrics Catalog as markdown')).toBeInTheDocument();
  });

  it('renders 3 subtabs', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    expect(screen.getByText('Chat Metrics Catalog')).toBeInTheDocument();
    expect(screen.getByText('vLLM Metrics')).toBeInTheDocument();
    expect(screen.getByText('OpenShift Metrics')).toBeInTheDocument();
  });

  it('shows catalog content by default', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    // Catalog subtab is active by default - should see the search input for catalog
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search categories and metrics...')).toBeInTheDocument();
    });
  });

  it('switches to vLLM subtab', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    // Click on vLLM Metrics subtab
    const vllmTab = screen.getByText('vLLM Metrics');
    fireEvent.click(vllmTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search vLLM metrics...')).toBeInTheDocument();
    });
  });

  it('switches to OpenShift subtab', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    // Click on OpenShift Metrics subtab
    const openshiftTab = screen.getByText('OpenShift Metrics');
    fireEvent.click(openshiftTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search OpenShift metrics...')).toBeInTheDocument();
    });
  });

  it('download button triggers vLLM download when vLLM subtab is active', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    // Switch to vLLM subtab
    const vllmTab = screen.getByText('vLLM Metrics');
    fireEvent.click(vllmTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search vLLM metrics...')).toBeInTheDocument();
    });

    // Click the shared download button
    const downloadButton = screen.getByLabelText('Download vLLM Metrics as markdown');
    fireEvent.click(downloadButton);

    expect(mockDownloadAsFile).toHaveBeenCalledTimes(1);
    const [content, filename] = mockDownloadAsFile.mock.calls[0];
    expect(content).toContain('# vLLM Metrics Reference');
    expect(filename).toMatch(/^vllm-metrics-reference-\d+\.md$/);
  });

  it('download button triggers OpenShift download when OpenShift subtab is active', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    // Switch to OpenShift subtab
    const openshiftTab = screen.getByText('OpenShift Metrics');
    fireEvent.click(openshiftTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search OpenShift metrics...')).toBeInTheDocument();
    });

    // Click the shared download button
    const downloadButton = screen.getByLabelText('Download OpenShift Metrics as markdown');
    fireEvent.click(downloadButton);

    expect(mockDownloadAsFile).toHaveBeenCalledTimes(1);
    const [content, filename] = mockDownloadAsFile.mock.calls[0];
    expect(content).toContain('# OpenShift Metrics Reference');
    expect(filename).toMatch(/^openshift-metrics-reference-\d+\.md$/);
  });

  it('download button triggers catalog download when catalog subtab is active', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    // Wait for catalog to load
    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    // Click the shared download button
    const downloadButton = screen.getByLabelText('Download Chat Metrics Catalog as markdown');
    fireEvent.click(downloadButton);

    expect(mockDownloadAsFile).toHaveBeenCalledTimes(1);
    const [content, filename] = mockDownloadAsFile.mock.calls[0];
    expect(content).toContain('# Chat - Metrics Catalog');
    expect(filename).toMatch(/^metrics-catalog-\d+\.md$/);
  });

  it('does not show individual headers when rendered inside wrapper', async () => {
    mockFullLoad();
    render(<MetricsSettingsTab />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search categories and metrics...')).toBeInTheDocument();
    });

    // The individual catalog header should not be present (hideHeader=true)
    expect(screen.queryByLabelText('Download metrics catalog as markdown')).not.toBeInTheDocument();
  });
});
