/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetricCategoriesInline } from '../../src/core/components/MetricCategoriesInline';

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
  },
  {
    id: 'gpu_ai',
    name: 'GPU & AI Accelerators',
    description: 'GPU metrics for AI/ML workloads',
    icon: '\uD83C\uDFAE',
    metric_count: 10,
  },
  {
    id: 'unknown_category',
    name: 'Custom Category',
    description: 'A category without predefined questions',
    icon: '\uD83D\uDD27',
    metric_count: 3,
  },
];

describe('MetricCategoriesInline', () => {
  const mockOnSelectQuestion = jest.fn();
  const mockOnCategorySelect = jest.fn();
  const mockOnToggle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderComponent = (overrides: Partial<React.ComponentProps<typeof MetricCategoriesInline>> = {}) => {
    return render(
      <MetricCategoriesInline
        onSelectQuestion={mockOnSelectQuestion}
        onCategorySelect={mockOnCategorySelect}
        isExpanded={true}
        onToggle={mockOnToggle}
        {...overrides}
      />
    );
  };

  it('shows loading spinner while categories are loading', () => {
    mockCallMcpTool.mockReturnValue(new Promise(() => {})); // never resolves
    renderComponent();
    expect(screen.getByLabelText('Loading metric categories')).toBeInTheDocument();
  });

  it('displays category dropdown after loading', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByLabelText('Select a metric category')).toBeInTheDocument();
    });

    const select = screen.getByLabelText('Select a metric category') as HTMLSelectElement;
    expect(select.options).toHaveLength(4); // placeholder + 3 categories
  });

  it('shows questions when a category is selected from dropdown', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByLabelText('Select a metric category')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Select a metric category'), {
        target: { value: 'cluster_health' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("What's the overall health of my cluster?")).toBeInTheDocument();
      expect(screen.getByText('Are there any degraded cluster operators?')).toBeInTheDocument();
    });

    expect(screen.getByText(/Suggested questions for Cluster Resources & Health/)).toBeInTheDocument();
  });

  it('calls onCategorySelect with category name when a category is selected', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByLabelText('Select a metric category')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Select a metric category'), {
        target: { value: 'gpu_ai' },
      });
    });

    expect(mockOnCategorySelect).toHaveBeenCalledWith('GPU & AI Accelerators');
  });

  it('calls onCategorySelect with null when category is deselected', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByLabelText('Select a metric category')).toBeInTheDocument();
    });

    // Select a category
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Select a metric category'), {
        target: { value: 'gpu_ai' },
      });
    });

    expect(mockOnCategorySelect).toHaveBeenCalledWith('GPU & AI Accelerators');

    // Deselect (back to placeholder)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Select a metric category'), {
        target: { value: '' },
      });
    });

    expect(mockOnCategorySelect).toHaveBeenCalledWith(null);
  });

  it('calls onSelectQuestion when a suggested question is clicked', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByLabelText('Select a metric category')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Select a metric category'), {
        target: { value: 'cluster_health' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("What's the overall health of my cluster?")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("What's the overall health of my cluster?"));
    });

    expect(mockOnSelectQuestion).toHaveBeenCalledWith("What's the overall health of my cluster?");
  });

  it('does not show questions when no category is selected', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByLabelText('Select a metric category')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Suggested questions for/)).not.toBeInTheDocument();
  });

  it('displays error when loading fails', async () => {
    mockCallMcpTool.mockRejectedValueOnce(new Error('Network error'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Error loading categories')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays error from response body', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify({ error: 'Catalog not available' }));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Catalog not available')).toBeInTheDocument();
    });
  });

  it('shows default question for categories without predefined questions', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByLabelText('Select a metric category')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Select a metric category'), {
        target: { value: 'unknown_category' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Show me the key Custom Category metrics')).toBeInTheDocument();
    });
  });

  it('renders expandable section with correct toggle text when collapsed', () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent({ isExpanded: false });
    expect(screen.getByText('Browse metric categories')).toBeInTheDocument();
  });

  it('renders expandable section with correct toggle text when expanded', () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));
    renderComponent({ isExpanded: true });
    expect(screen.getByText('Hide metric categories')).toBeInTheDocument();
  });

  it('shows no categories message when empty array returned', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify([]));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('No metric categories available.')).toBeInTheDocument();
    });
  });
});
