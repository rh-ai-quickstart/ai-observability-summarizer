/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetricCategoriesPopover } from '../../src/core/components/MetricCategoriesPopover';

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
  {
    id: 'unknown_category',
    name: 'Custom Category',
    description: 'A category without predefined questions',
    icon: '\uD83D\uDD27',
    metric_count: 3,
    priority_distribution: { High: 1, Medium: 2 },
  },
];

describe('MetricCategoriesPopover', () => {
  const mockOnSelectQuestion = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading spinner while categories are loading', async () => {
    mockCallMcpTool.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    // Open the popover
    const button = screen.getByRole('button', { name: /metric categories/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByLabelText('Loading metric categories')).toBeInTheDocument();
  });

  it('displays categories after loading', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    // Open the popover
    const button = screen.getByRole('button', { name: /metric categories/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
      expect(screen.getByText('GPU & AI Accelerators')).toBeInTheDocument();
    });

    expect(screen.getByText('5 metrics')).toBeInTheDocument();
    expect(screen.getByText('10 metrics')).toBeInTheDocument();
  });

  it('shows questions when a category is clicked', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    // Open the popover
    const button = screen.getByRole('button', { name: /metric categories/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    // Click on a category
    await act(async () => {
      fireEvent.click(screen.getByText('Cluster Resources & Health'));
    });

    // Should show category-specific questions
    await waitFor(() => {
      expect(screen.getByText("What's the overall health of my cluster?")).toBeInTheDocument();
      expect(screen.getByText('Are there any degraded cluster operators?')).toBeInTheDocument();
    });

    // Should show back button
    expect(screen.getByText('Back to categories')).toBeInTheDocument();
  });

  it('calls onSelectQuestion when a question is clicked', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    // Open the popover
    const button = screen.getByRole('button', { name: /metric categories/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    // Click on a category
    await act(async () => {
      fireEvent.click(screen.getByText('Cluster Resources & Health'));
    });

    await waitFor(() => {
      expect(screen.getByText("What's the overall health of my cluster?")).toBeInTheDocument();
    });

    // Click on a question
    await act(async () => {
      fireEvent.click(screen.getByText("What's the overall health of my cluster?"));
    });

    expect(mockOnSelectQuestion).toHaveBeenCalledWith("What's the overall health of my cluster?");
  });

  it('displays error when loading fails', async () => {
    mockCallMcpTool.mockRejectedValueOnce(new Error('Network error'));

    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    // Open the popover
    const button = screen.getByRole('button', { name: /metric categories/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText('Error loading categories')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays error from response body', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify({ error: 'Catalog not available' }));

    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    // Open the popover
    const button = screen.getByRole('button', { name: /metric categories/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText('Catalog not available')).toBeInTheDocument();
    });
  });

  it('navigates back from questions to categories', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    // Open the popover
    const button = screen.getByRole('button', { name: /metric categories/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
    });

    // Click on a category
    await act(async () => {
      fireEvent.click(screen.getByText('GPU & AI Accelerators'));
    });

    await waitFor(() => {
      expect(screen.getByText("What's the current GPU utilization across all models?")).toBeInTheDocument();
    });

    // Click back
    await act(async () => {
      fireEvent.click(screen.getByText('Back to categories'));
    });

    // Should show categories again
    await waitFor(() => {
      expect(screen.getByText('Cluster Resources & Health')).toBeInTheDocument();
      expect(screen.getByText('GPU & AI Accelerators')).toBeInTheDocument();
    });
  });

  it('shows default question for categories without predefined questions', async () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    // Open the popover
    const button = screen.getByRole('button', { name: /metric categories/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText('Custom Category')).toBeInTheDocument();
    });

    // Click on the unknown category
    await act(async () => {
      fireEvent.click(screen.getByText('Custom Category'));
    });

    // Should show default question
    await waitFor(() => {
      expect(screen.getByText('Show me the key Custom Category metrics')).toBeInTheDocument();
    });
  });

  it('renders the trigger button with correct text', () => {
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify(sampleCategories));

    render(<MetricCategoriesPopover onSelectQuestion={mockOnSelectQuestion} />);

    expect(screen.getByRole('button', { name: /metric categories/i })).toBeInTheDocument();
    expect(screen.getByText('Metric Categories')).toBeInTheDocument();
  });
});
