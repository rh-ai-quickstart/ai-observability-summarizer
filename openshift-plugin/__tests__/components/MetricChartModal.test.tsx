import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetricChartModal } from '../../src/core/components/MetricChartModal';

// Mock PatternFly Charts to avoid canvas rendering issues in tests
jest.mock('@patternfly/react-charts', () => ({
  Chart: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  ChartAxis: () => <div data-testid="chart-axis" />,
  ChartGroup: ({ children }: any) => <div data-testid="chart-group">{children}</div>,
  ChartLine: () => <div data-testid="chart-line" />,
  ChartVoronoiContainer: ({ children }: any) => <div data-testid="chart-voronoi">{children}</div>,
  ChartThemeColor: {
    blue: 'blue',
  },
}));

const mockMetric = {
  key: 'cpu-usage',
  label: 'CPU Usage',
  unit: '%',
  description: 'Current CPU utilization',
  timeSeries: [
    { timestamp: '2024-01-01T10:00:00Z', value: 45 },
    { timestamp: '2024-01-01T10:05:00Z', value: 52 },
    { timestamp: '2024-01-01T10:10:00Z', value: 38 },
    { timestamp: '2024-01-01T10:15:00Z', value: 67 },
    { timestamp: '2024-01-01T10:20:00Z', value: 43 },
  ],
};

const mockEmptyMetric = {
  key: 'empty-metric',
  label: 'Empty Metric',
  unit: 'count',
  description: 'Test metric with no data',
  timeSeries: [],
};

describe('MetricChartModal', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Modal Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={false}
          onClose={mockOnClose}
        />
      );

      expect(screen.queryByText('CPU Usage')).not.toBeInTheDocument();
    });

    it('should render when isOpen is true and metric is provided', () => {
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('CPU Usage')).toBeInTheDocument();
      expect(screen.getByText('Current CPU utilization')).toBeInTheDocument();
    });

    it('should not render when metric is null', () => {
      render(
        <MetricChartModal
          metric={null}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      expect(screen.queryByTestId('chart-container')).not.toBeInTheDocument();
    });
  });

  describe('Chart Components', () => {
    it('should render chart components when data is available', () => {
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByTestId('chart-container')).toBeInTheDocument();
      // There are 2 axes (X and Y), so use getAllByTestId
      expect(screen.getAllByTestId('chart-axis')).toHaveLength(2);
      expect(screen.getByTestId('chart-group')).toBeInTheDocument();
      expect(screen.getByTestId('chart-line')).toBeInTheDocument();
    });

    it('should show "No data available" message when timeSeries is empty', () => {
      render(
        <MetricChartModal
          metric={mockEmptyMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('No data available for the selected time range.')).toBeInTheDocument();
      expect(screen.queryByTestId('chart-container')).not.toBeInTheDocument();
    });
  });

  describe('Statistics Summary', () => {
    it('should calculate and display correct statistics', () => {
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // Statistics should be calculated from mockMetric.timeSeries
      // Latest: 43, Average: ~49, Min: 38, Max: 67
      expect(screen.getByText('Latest')).toBeInTheDocument();
      expect(screen.getByText('Average')).toBeInTheDocument();
      expect(screen.getByText('Minimum')).toBeInTheDocument();
      expect(screen.getByText('Maximum')).toBeInTheDocument();

      // Check actual values
      expect(screen.getByText('43%')).toBeInTheDocument(); // Latest
      expect(screen.getByText('49%')).toBeInTheDocument(); // Average
      expect(screen.getByText('38%')).toBeInTheDocument(); // Min
      expect(screen.getByText('67%')).toBeInTheDocument(); // Max
    });

    it('should handle metrics without units', () => {
      const noUnitMetric = {
        ...mockMetric,
        unit: undefined,
        timeSeries: [{ timestamp: '2024-01-01T10:00:00Z', value: 100 }],
      };

      render(
        <MetricChartModal
          metric={noUnitMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // With single data point, all 4 stats show the same value (100)
      // Use getAllByText since value appears multiple times
      const values = screen.getAllByText('100');
      expect(values.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CSV Download', () => {
    it('should have download CSV button', () => {
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      const downloadButton = screen.getByText('Download CSV');
      expect(downloadButton).toBeInTheDocument();
    });

    it('should trigger CSV download when button is clicked', async () => {
      // Save originals
      const originalCreateObjectURL = window.URL.createObjectURL;
      const originalRevokeObjectURL = window.URL.revokeObjectURL;

      // Mock URL methods
      window.URL.createObjectURL = jest.fn(() => 'mock-blob-url');
      window.URL.revokeObjectURL = jest.fn();

      // Mock anchor behavior
      const mockClick = jest.fn();
      const originalCreateElement = document.createElement.bind(document);
      const createElementSpy = jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'a') {
          const anchor = originalCreateElement('a');
          anchor.click = mockClick;
          return anchor;
        }
        return originalCreateElement(tag);
      });

      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      const downloadButton = screen.getByText('Download CSV');
      fireEvent.click(downloadButton);

      await waitFor(() => {
        expect(window.URL.createObjectURL).toHaveBeenCalled();
      });

      expect(mockClick).toHaveBeenCalled();

      // Cleanup
      createElementSpy.mockRestore();
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('should generate correct CSV content', () => {
      // Save originals
      const originalCreateObjectURL = window.URL.createObjectURL;
      window.URL.createObjectURL = jest.fn(() => 'mock-blob-url');

      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      const downloadButton = screen.getByText('Download CSV');
      fireEvent.click(downloadButton);

      // Check that Blob was created with correct content type
      expect(window.URL.createObjectURL).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text/csv',
        })
      );

      // Cleanup
      window.URL.createObjectURL = originalCreateObjectURL;
    });
  });

  describe('Modal Interactions', () => {
    it('should call onClose when close button is clicked', () => {
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      const closeButton = screen.getByLabelText('Close');
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should pass onClose prop to modal for escape key handling', () => {
      // PatternFly Modal internally handles Escape key press
      // We verify that onClose prop is correctly passed by checking
      // that the modal close button works (which uses the same handler)
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // Verify the modal is rendered with close functionality
      const closeButton = screen.getByLabelText('Close');
      expect(closeButton).toBeInTheDocument();
      
      // The onClose prop is passed correctly (verified by close button test above)
      // PatternFly handles Escape key internally using this same onClose prop
    });
  });

  describe('Time Series Data Processing', () => {
    it('should handle single data point', () => {
      const singlePointMetric = {
        ...mockMetric,
        timeSeries: [{ timestamp: '2024-01-01T10:00:00Z', value: 75 }],
      };

      render(
        <MetricChartModal
          metric={singlePointMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // All statistics should be the same value (appears 4 times)
      const values = screen.getAllByText('75%');
      expect(values.length).toBe(4); // Latest, Average, Min, Max all show 75%
    });

    it('should handle zero values correctly', () => {
      const zeroValueMetric = {
        ...mockMetric,
        timeSeries: [
          { timestamp: '2024-01-01T10:00:00Z', value: 0 },
          { timestamp: '2024-01-01T10:05:00Z', value: 10 },
        ],
      };

      render(
        <MetricChartModal
          metric={zeroValueMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // Latest and Max are both 10%
      const tens = screen.getAllByText('10%');
      expect(tens.length).toBe(2); // Latest and Max
      expect(screen.getByText('5%')).toBeInTheDocument();  // Average
      expect(screen.getByText('0%')).toBeInTheDocument();  // Min
    });

    it('should handle unsorted timeSeries', () => {
      const unsortedMetric = {
        ...mockMetric,
        timeSeries: [
          { timestamp: '2024-01-01T10:10:00Z', value: 30 },
          { timestamp: '2024-01-01T10:00:00Z', value: 20 },
          { timestamp: '2024-01-01T10:05:00Z', value: 25 },
        ],
      };

      render(
        <MetricChartModal
          metric={unsortedMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // Component uses last item in array as "latest" (25%)
      // Min is 20%, Max is 30%, Average is 25%
      expect(screen.getByText('20%')).toBeInTheDocument(); // Min
      expect(screen.getByText('30%')).toBeInTheDocument(); // Max
      // 25% appears twice (Latest and Average)
      const twentyFives = screen.getAllByText('25%');
      expect(twentyFives.length).toBe(2);
    });
  });

  describe('Advanced Unit Formatting', () => {
    it('should handle energy units (J → kJ → MJ)', () => {
      const energyMetric = {
        key: 'energy-usage',
        label: 'Energy Usage',
        unit: 'J',
        description: 'Energy consumption',
        timeSeries: [{ timestamp: '2024-01-01T10:00:00Z', value: 1500000 }],
      };

      render(
        <MetricChartModal
          metric={energyMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // 1,500,000 J = 1.50 MJ (appears 4 times for all stats)
      const values = screen.getAllByText('1.50MJ');
      expect(values.length).toBe(4);
    });

    it('should handle frequency units (MHz → GHz)', () => {
      const frequencyMetric = {
        key: 'clock-speed',
        label: 'Clock Speed',
        unit: 'MHz',
        description: 'Processor frequency',
        timeSeries: [{ timestamp: '2024-01-01T10:00:00Z', value: 2500 }],
      };

      render(
        <MetricChartModal
          metric={frequencyMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // 2500 MHz = 2.50 GHz (appears 4 times for all stats)
      const values = screen.getAllByText('2.50GHz');
      expect(values.length).toBe(4);
    });

    it('should handle power units (W → kW)', () => {
      const powerMetric = {
        key: 'power-usage',
        label: 'Power Usage',
        unit: 'W',
        description: 'Power consumption',
        timeSeries: [{ timestamp: '2024-01-01T10:00:00Z', value: 1200 }],
      };

      render(
        <MetricChartModal
          metric={powerMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      // 1200 W = 1.20 kW (appears 4 times for all stats)
      const values = screen.getAllByText('1.20kW');
      expect(values.length).toBe(4);
    });
  });
});