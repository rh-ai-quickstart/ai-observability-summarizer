import * as React from 'react';
import {
  Modal,
  ModalVariant,
  Button,
  Flex,
  FlexItem,
  Text,
  TextVariants,
  Bullseye,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  Chart,
  ChartAxis,
  ChartGroup,
  ChartLine,
  ChartThemeColor,
  ChartVoronoiContainer,
} from '@patternfly/react-charts';
import { DownloadIcon } from '@patternfly/react-icons';
import { formatValue, formatValueWithUnit } from '../utils/formatValue';

interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface MetricChartModalProps {
  metric: {
    key: string;
    label: string;
    unit?: string;
    timeSeries: TimeSeriesPoint[];
    description?: string;
  } | null;
  isOpen: boolean;
  onClose: () => void;
}

export const MetricChartModal: React.FC<MetricChartModalProps> = ({ metric, isOpen, onClose }) => {
  if (!metric) {
    return null;
  }

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return timestamp;
    }
  };

  // Helper to format value with unit for display
  const formatWithUnit = (val: number): string => {
    return formatValueWithUnit(val, metric.unit);
  };

  // Helper for axis formatting (just the value part)
  const formatAxisValue = (val: number): string => {
    const { value, unit } = formatValue(val, metric.unit);
    return unit ? `${value}${unit}` : value;
  };

  // Prepare data for Victory.js
  const chartData = metric.timeSeries.map((point) => ({
    x: new Date(point.timestamp).getTime(),
    y: point.value,
    name: formatTimestamp(point.timestamp),
  }));

  // Calculate statistics
  const values = metric.timeSeries.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const latest = values[values.length - 1];

  // Calculate Y-axis domain with padding
  // Handle edge case where all values are the same
  const padding = max === min ? Math.abs(max) * 0.1 || 1 : (max - min) * 0.1;
  const yMin = min - padding;
  const yMax = max + padding;

  // Calculate X-axis domain from actual timestamps
  const timestamps = metric.timeSeries.map(p => new Date(p.timestamp).getTime());
  const xMin = Math.min(...timestamps);
  const xMax = Math.max(...timestamps);

  const escapeCsvValue = (val: string | number): string => {
    const str = String(val);
    const escaped = str.replace(/"/g, '""');
    // Wrap in quotes if contains comma, quote, or newline
    return str.includes(',') || str.includes('"') || str.includes('\n') 
      ? `"${escaped}"` 
      : str;
  };

  const handleDownloadChart = () => {
    try {
      // Create CSV content with proper escaping
      const csvContent = [
        ['Timestamp', 'Value'].map(escapeCsvValue).join(','),
        ...metric.timeSeries.map(point =>
          [point.timestamp, point.value].map(escapeCsvValue).join(',')
        )
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${metric.key.replace(/\s+/g, '_')}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download chart data:', error);
      // Could show a toast notification here if available
    }
  };

  return (
    <Modal
      variant={ModalVariant.large}
      title={
        <Flex direction={{ default: 'column' }}>
          <FlexItem>
            <Text component={TextVariants.h2}>{metric.label}</Text>
          </FlexItem>
          {metric.description && (
            <FlexItem>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                {metric.description}
              </Text>
            </FlexItem>
          )}
        </Flex>
      }
      isOpen={isOpen}
      onClose={onClose}
      actions={[
        <Button key="download" variant="secondary" icon={<DownloadIcon />} onClick={handleDownloadChart}>
          Download CSV
        </Button>,
        <Button key="close" variant="primary" onClick={onClose}>
          Close
        </Button>,
      ]}
    >
      {metric.timeSeries.length === 0 ? (
        <Bullseye style={{ minHeight: '400px' }}>
          <div style={{ textAlign: 'center' }}>
            <Text component={TextVariants.p} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
              No data available for the selected time range.
            </Text>
          </div>
        </Bullseye>
      ) : (
        <>
          {/* Statistics Summary */}
          <Toolbar style={{ paddingBottom: '16px' }}>
            <ToolbarContent>
              <ToolbarItem>
                <div style={{ textAlign: 'center', padding: '8px 16px', background: '#f0f0f0', borderRadius: '4px' }}>
                  <Text component={TextVariants.small} style={{ color: '#666', display: 'block' }}>Latest</Text>
                  <Text component={TextVariants.h4} style={{ fontWeight: 600 }}>
                    {formatWithUnit(latest)}
                  </Text>
                </div>
              </ToolbarItem>
              <ToolbarItem>
                <div style={{ textAlign: 'center', padding: '8px 16px', background: '#f0f0f0', borderRadius: '4px' }}>
                  <Text component={TextVariants.small} style={{ color: '#666', display: 'block' }}>Average</Text>
                  <Text component={TextVariants.h4} style={{ fontWeight: 600 }}>
                    {formatWithUnit(avg)}
                  </Text>
                </div>
              </ToolbarItem>
              <ToolbarItem>
                <div style={{ textAlign: 'center', padding: '8px 16px', background: '#f0f0f0', borderRadius: '4px' }}>
                  <Text component={TextVariants.small} style={{ color: '#666', display: 'block' }}>Minimum</Text>
                  <Text component={TextVariants.h4} style={{ fontWeight: 600 }}>
                    {formatWithUnit(min)}
                  </Text>
                </div>
              </ToolbarItem>
              <ToolbarItem>
                <div style={{ textAlign: 'center', padding: '8px 16px', background: '#f0f0f0', borderRadius: '4px' }}>
                  <Text component={TextVariants.small} style={{ color: '#666', display: 'block' }}>Maximum</Text>
                  <Text component={TextVariants.h4} style={{ fontWeight: 600 }}>
                    {formatWithUnit(max)}
                  </Text>
                </div>
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>

          {/* Chart */}
          <div style={{ height: '500px' }}>
            <Chart
              ariaDesc={`Time series chart for ${metric.label}`}
              ariaTitle={metric.label}
              containerComponent={
                <ChartVoronoiContainer
                  labels={({ datum }) => `${datum.name}\n${formatValueWithUnit(datum.y, metric.unit)}`}
                  constrainToVisibleArea
                />
              }
              height={500}
              padding={{
                bottom: 75,
                left: 80,
                right: 50,
                top: 50,
              }}
              themeColor={ChartThemeColor.blue}
              domain={{ x: [xMin, xMax], y: [yMin, yMax] }}
            >
              <ChartAxis
                tickFormat={(t) => {
                  const date = new Date(t);
                  // Show date and time for better context
                  const timeSpan = xMax - xMin;
                  const oneDay = 24 * 60 * 60 * 1000;

                  if (timeSpan > oneDay) {
                    // For ranges > 1 day, show date + time
                    return date.toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric'
                    }) + '\n' + date.toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit'
                    });
                  } else {
                    // For ranges <= 1 day, show just time
                    return date.toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit'
                    });
                  }
                }}
                style={{
                  tickLabels: { angle: -45, fontSize: 10, padding: 10 }
                }}
              />
              <ChartAxis
                dependentAxis
                showGrid
                tickFormat={(t) => formatAxisValue(t)}
                label={metric.unit || 'Value'}
                style={{
                  axisLabel: { fontSize: 12, padding: 50 }
                }}
              />
              <ChartGroup>
                <ChartLine
                  data={chartData}
                  style={{
                    data: { stroke: '#06c', strokeWidth: 2 }
                  }}
                />
              </ChartGroup>
            </Chart>
          </div>

          {/* Data points info */}
          <div style={{ marginTop: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '4px' }}>
            <Text component={TextVariants.small} style={{ color: '#666' }}>
              Displaying {metric.timeSeries.length} data points from {formatTimestamp(metric.timeSeries[0].timestamp)} to {formatTimestamp(metric.timeSeries[metric.timeSeries.length - 1].timestamp)}
            </Text>
          </div>
        </>
      )}
    </Modal>
  );
};

export default MetricChartModal;
