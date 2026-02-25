/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OpenShiftMetricsSettingsTab } from '../../src/core/components/AIModelSettings/tabs/OpenShiftMetricsSettingsTab';

// Mock downloadAsFile
const mockDownloadAsFile = jest.fn();
jest.mock('../../src/core/utils/downloadFile', () => ({
  downloadAsFile: (...args: any[]) => mockDownloadAsFile(...args),
}));

describe('OpenShiftMetricsSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders heading and description', () => {
    render(<OpenShiftMetricsSettingsTab />);
    expect(screen.getByText('OpenShift Metrics')).toBeInTheDocument();
    expect(screen.getByText(/metrics across.*categories used in the OpenShift Metrics page/)).toBeInTheDocument();
  });

  it('displays all 11 category sections', () => {
    render(<OpenShiftMetricsSettingsTab />);
    expect(screen.getByText('Fleet Overview')).toBeInTheDocument();
    expect(screen.getByText('Jobs & Workloads')).toBeInTheDocument();
    expect(screen.getByText('Storage & Config')).toBeInTheDocument();
    expect(screen.getByText('Node Metrics')).toBeInTheDocument();
    expect(screen.getByText('GPU & Accelerators')).toBeInTheDocument();
    expect(screen.getByText('Autoscaling & Scheduling')).toBeInTheDocument();
    expect(screen.getByText('Pod & Container Metrics')).toBeInTheDocument();
    expect(screen.getByText('Network Metrics')).toBeInTheDocument();
    expect(screen.getByText('Storage I/O')).toBeInTheDocument();
    expect(screen.getByText('Services & Networking')).toBeInTheDocument();
    expect(screen.getByText('Application Services')).toBeInTheDocument();
  });

  it('filters categories by search term', async () => {
    render(<OpenShiftMetricsSettingsTab />);

    const searchInput = screen.getByPlaceholderText('Search OpenShift metrics...');
    fireEvent.change(searchInput, { target: { value: 'GPU' } });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByText('GPU & Accelerators')).toBeInTheDocument();
    expect(screen.queryByText('Fleet Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage I/O')).not.toBeInTheDocument();
  });

  it('shows no-match message when search has no results', async () => {
    render(<OpenShiftMetricsSettingsTab />);

    const searchInput = screen.getByPlaceholderText('Search OpenShift metrics...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent_xyz' } });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByText('No categories or metrics match the search.')).toBeInTheDocument();
  });

  it('has download button that generates markdown file', () => {
    render(<OpenShiftMetricsSettingsTab />);

    const downloadButton = screen.getByLabelText('Download OpenShift metrics as markdown');
    expect(downloadButton).toBeInTheDocument();

    fireEvent.click(downloadButton);

    expect(mockDownloadAsFile).toHaveBeenCalledTimes(1);
    const [content, filename] = mockDownloadAsFile.mock.calls[0];
    expect(content).toContain('# OpenShift Metrics Reference');
    expect(content).toContain('## Fleet Overview');
    expect(content).toContain('## GPU & Accelerators');
    expect(content).toContain('Total Pods Running');
    expect(filename).toMatch(/^openshift-metrics-reference-\d+\.md$/);
  });

  it('renders search input', () => {
    render(<OpenShiftMetricsSettingsTab />);
    expect(screen.getByPlaceholderText('Search OpenShift metrics...')).toBeInTheDocument();
  });

  it('expands a category to show metric details', async () => {
    render(<OpenShiftMetricsSettingsTab />);

    // Click on Fleet Overview to expand it
    const categoryToggle = screen.getByText('Fleet Overview').closest('button');
    expect(categoryToggle).toBeTruthy();

    await act(async () => {
      fireEvent.click(categoryToggle!);
    });

    // Should show metric details after expanding
    expect(screen.getByText('Total Pods Running')).toBeInTheDocument();
    expect(screen.getByText('Currently running across cluster')).toBeInTheDocument();
  });
});
