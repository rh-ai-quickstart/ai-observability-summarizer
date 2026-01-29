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
      expect(screen.getByTestId('chart-axis')).toBeInTheDocument();
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

      expect(screen.getByText('100')).toBeInTheDocument(); // Value without unit
    });
  });

  describe('CSV Download', () => {
    beforeEach(() => {
      // Mock URL.createObjectURL for CSV download tests
      Object.defineProperty(window.URL, 'createObjectURL', {
        value: jest.fn(() => 'mock-blob-url'),
        writable: true,
      });
      Object.defineProperty(window.URL, 'revokeObjectURL', {
        value: jest.fn(),
        writable: true,
      });
      
      // Mock document.createElement for download link
      const mockAnchor = {
        click: jest.fn(),
        href: '',
        download: '',
      };
      
      // Store original createElement to avoid infinite recursion
      const originalCreateElement = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'a') return mockAnchor as any;
        return originalCreateElement(tag);
      });
      
      jest.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
      jest.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);
    });

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

      // Check that anchor element was created and clicked
      expect(document.createElement).toHaveBeenCalledWith('a');
    });

    it('should generate correct CSV content', () => {
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      const downloadButton = screen.getByText('Download CSV');
      fireEvent.click(downloadButton);

      // Check that Blob was created with correct content
      expect(window.URL.createObjectURL).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text/csv',
        })
      );
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

    it('should call onClose when Escape key is pressed', () => {
      render(
        <MetricChartModal
          metric={mockMetric}
          isOpen={true}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

      expect(mockOnClose).toHaveBeenCalledTimes(1);
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

      // All statistics should be the same value
      expect(screen.getByText('75%')).toBeInTheDocument();
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

      expect(screen.getByText('10%')).toBeInTheDocument(); // Latest
      expect(screen.getByText('5%')).toBeInTheDocument();  // Average
      expect(screen.getByText('0%')).toBeInTheDocument();  // Min
    });

    it('should sort timeSeries by timestamp', () => {
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

      // Latest value should be from the chronologically last timestamp
      expect(screen.getByText('30%')).toBeInTheDocument(); // Latest (10:10)
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

      expect(screen.getByText('1.50 MJ')).toBeInTheDocument(); // 1,500,000 J = 1.50 MJ
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

      expect(screen.getByText('2.50 GHz')).toBeInTheDocument(); // 2500 MHz = 2.50 GHz
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

      expect(screen.getByText('1.20 kW')).toBeInTheDocument(); // 1200 W = 1.20 kW
    });
  });
});