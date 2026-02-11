/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetricsCatalogTab } from '../../src/core/components/AIModelSettings/tabs/MetricsCatalogTab';

// Mock callMcpTool
const mockCallMcpTool = jest.fn();
jest.mock('../../src/core/services/mcpClient', () => ({
  callMcpTool: (...args: any[]) => mockCallMcpTool(...args),
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

const sampleCategoryDetail = {
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

describe('MetricsCatalogTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading spinner initially', () => {
    mockCallMcpTool.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MetricsCatalogTab />);
    expect(screen.getByLabelText('Loading metrics catalog')).toBeInTheDocument();
  });

  it('displays categories after loading', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

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
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Filter categories...');
    fireEvent.change(searchInput, { target: { value: 'GPU' } });

    expect(screen.queryByText('Cluster Resources & Health')).not.toBeInTheDocument();
    expect(screen.getByText('GPU & AI Accelerators')).toBeInTheDocument();
  });

  it('shows no-match message when filter has no results', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

    render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Filter categories...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.getByText('No categories match the filter.')).toBeInTheDocument();
  });

  it('loads category details on expansion', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(JSON.stringify(sampleCategories))
      .mockResolvedValueOnce(JSON.stringify(sampleCategoryDetail));

    const { container } = render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    // Click the expandable section toggle for the first category
    const toggleButtons = container.querySelectorAll('.pf-v5-c-expandable-section__toggle');
    expect(toggleButtons.length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(toggleButtons[0]);
    });

    // Should call get_category_metrics_detail
    expect(mockCallMcpTool).toHaveBeenCalledWith('get_category_metrics_detail', {
      category_id: 'cluster_health',
    });

    await waitFor(() => {
      expect(screen.getByText('cluster_version')).toBeInTheDocument();
      expect(screen.getByText('Current cluster version')).toBeInTheDocument();
    });
  });

  it('displays labeled sections for description and keywords', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(JSON.stringify(sampleCategories))
      .mockResolvedValueOnce(JSON.stringify(sampleCategoryDetail));

    const { container } = render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    const toggleButtons = container.querySelectorAll('.pf-v5-c-expandable-section__toggle');
    await act(async () => {
      fireEvent.click(toggleButtons[0]);
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

  it('shows collapsible priority sections', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(JSON.stringify(sampleCategories))
      .mockResolvedValueOnce(JSON.stringify(sampleCategoryDetail));

    const { container } = render(<MetricsCatalogTab />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    // Expand the category
    const categoryToggles = container.querySelectorAll('.pf-v5-c-expandable-section__toggle');
    await act(async () => {
      fireEvent.click(categoryToggles[0]);
    });

    await waitFor(() => {
      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.getByText('Medium Priority')).toBeInTheDocument();
    });

    // Both priority sections should be expanded by default, showing metrics
    expect(screen.getByText('cluster_version')).toBeInTheDocument();
    expect(screen.getByText('cluster_operator_conditions')).toBeInTheDocument();

    // Collapse the High Priority section
    const allToggles = container.querySelectorAll('.pf-v5-c-expandable-section__toggle');
    // Find the High Priority toggle (it's nested inside the category)
    const highPriorityToggle = Array.from(allToggles).find(
      btn => btn.textContent?.includes('High Priority'),
    );
    expect(highPriorityToggle).toBeDefined();

    await act(async () => {
      fireEvent.click(highPriorityToggle!);
    });

    // High Priority section should now be collapsed (content hidden via hidden attribute)
    const highPriorityContent = screen.getByText('cluster_version').closest('.pf-v5-c-expandable-section__content');
    expect(highPriorityContent).toHaveAttribute('hidden');

    // Medium Priority section should remain visible
    const mediumPriorityContent = screen.getByText('cluster_operator_conditions').closest('.pf-v5-c-expandable-section__content');
    expect(mediumPriorityContent).not.toHaveAttribute('hidden');
  });
});
