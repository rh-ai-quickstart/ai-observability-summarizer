/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VLLMMetricsSettingsTab } from '../../src/core/components/AIModelSettings/tabs/VLLMMetricsSettingsTab';

// Mock downloadAsFile
const mockDownloadAsFile = jest.fn();
jest.mock('../../src/core/utils/downloadFile', () => ({
  downloadAsFile: (...args: any[]) => mockDownloadAsFile(...args),
}));

describe('VLLMMetricsSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders heading and description', () => {
    render(<VLLMMetricsSettingsTab />);
    expect(screen.getByText('vLLM Metrics')).toBeInTheDocument();
    expect(screen.getByText(/metrics across.*categories used in the vLLM Metrics page/)).toBeInTheDocument();
  });

  it('displays Key Metrics section', () => {
    render(<VLLMMetricsSettingsTab />);
    expect(screen.getByText('Key Metrics')).toBeInTheDocument();
  });

  it('displays all category sections', () => {
    render(<VLLMMetricsSettingsTab />);
    expect(screen.getByText('Request Tracking & Throughput')).toBeInTheDocument();
    expect(screen.getByText('Token Throughput')).toBeInTheDocument();
    expect(screen.getByText('Latency & Timing')).toBeInTheDocument();
    expect(screen.getByText('Memory & Cache')).toBeInTheDocument();
    expect(screen.getByText('Scheduling & Queueing')).toBeInTheDocument();
    expect(screen.getByText('RPC Monitoring')).toBeInTheDocument();
    expect(screen.getByText('GPU Hardware')).toBeInTheDocument();
    expect(screen.getByText('Request Parameters')).toBeInTheDocument();
  });

  it('shows key metrics content by default (expanded)', () => {
    render(<VLLMMetricsSettingsTab />);
    expect(screen.getByText('GPU Temperature (°C)')).toBeInTheDocument();
    expect(screen.getByText('GPU Power Usage (Watts)')).toBeInTheDocument();
    expect(screen.getByText('P95 Latency (s)')).toBeInTheDocument();
  });

  it('filters metrics by search term', async () => {
    render(<VLLMMetricsSettingsTab />);

    const searchInput = screen.getByPlaceholderText('Search vLLM metrics...');
    fireEvent.change(searchInput, { target: { value: 'GPU' } });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    // GPU-related items should be visible
    expect(screen.getByText('GPU Temperature (°C)')).toBeInTheDocument();
    expect(screen.getByText('GPU Hardware')).toBeInTheDocument();

    // Non-GPU items should be filtered out
    expect(screen.queryByText('RPC Monitoring')).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduling & Queueing')).not.toBeInTheDocument();
  });

  it('shows no-match message when search has no results', async () => {
    render(<VLLMMetricsSettingsTab />);

    const searchInput = screen.getByPlaceholderText('Search vLLM metrics...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent_xyz' } });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByText('No metrics match the search.')).toBeInTheDocument();
  });

  it('has download button that generates markdown file', () => {
    render(<VLLMMetricsSettingsTab />);

    const downloadButton = screen.getByLabelText('Download vLLM metrics as markdown');
    expect(downloadButton).toBeInTheDocument();

    fireEvent.click(downloadButton);

    expect(mockDownloadAsFile).toHaveBeenCalledTimes(1);
    const [content, filename] = mockDownloadAsFile.mock.calls[0];
    expect(content).toContain('# vLLM Metrics Reference');
    expect(content).toContain('## Key Metrics');
    expect(content).toContain('GPU Temperature');
    expect(content).toContain('## Request Tracking & Throughput');
    expect(filename).toMatch(/^vllm-metrics-reference-\d+\.md$/);
  });

  it('renders search input', () => {
    render(<VLLMMetricsSettingsTab />);
    expect(screen.getByPlaceholderText('Search vLLM metrics...')).toBeInTheDocument();
  });
});
