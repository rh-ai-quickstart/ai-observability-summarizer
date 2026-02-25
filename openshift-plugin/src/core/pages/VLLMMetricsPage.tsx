import * as React from 'react';
import {
  Page,
  PageSection,
  Title,
  Card,
  CardBody,
  CardTitle,
  Grid,
  GridItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Button,
  Spinner,
  Alert,
  AlertVariant,
  Bullseye,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  TextContent,
  Text,
  TextVariants,
  Label,
} from '@patternfly/react-core';
import {
  SyncIcon,
  OutlinedLightbulbIcon,
  CubesIcon,
  TachometerAltIcon,
  AngleDownIcon,
  AngleRightIcon,
  RobotIcon,
  TimesIcon,
  ChartLineIcon,
  ClockIcon,
  MemoryIcon,
  ListIcon,
  NetworkIcon,
  CogIcon,
} from '@patternfly/react-icons';
import { listModels, listNamespaces, ModelInfo, NamespaceInfo, fetchVLLMMetrics, analyzeVLLM, getSessionConfig, AnalysisResult } from '../services/mcpClient';
import { ConfigurationRequiredAlert } from '../components/ConfigurationRequiredAlert';
import { MetricsChatPanel } from '../components/MetricsChatPanel';

// Key Metrics - Priority metrics from the legacy UI (displayed prominently at top)
const KEY_METRICS_CONFIG = [
  { key: 'GPU Temperature (°C)', label: 'GPU Temperature', unit: '°C', priority: 1 },
  { key: 'GPU Power Usage (Watts)', label: 'GPU Power Usage', unit: 'W', priority: 2 },
  { key: 'P95 Latency (s)', label: 'P95 Latency', unit: 's', priority: 3 },
  { key: 'GPU Usage (%)', label: 'GPU Usage', unit: '%', priority: 4 },
  { key: 'Output Tokens Created', label: 'Output Tokens', unit: '', priority: 5 },
  { key: 'Prompt Tokens Created', label: 'Prompt Tokens', unit: '', priority: 6 },
];

// Comprehensive vLLM metric categories based on actual Prometheus metrics
const METRIC_CATEGORIES = {
  'Request Tracking & Throughput': {
    icon: ChartLineIcon,
    priority: 1,
    description: 'Monitor request volume, status, and reliability',
    metrics: [
      { key: 'Requests Total', label: 'Total Requests', unit: '', description: 'Total inference requests processed' },
      { key: 'Requests Running', label: 'In-Progress Requests', unit: '', description: 'Active ongoing requests' },
      { key: 'Request Errors Total', label: 'Request Errors', unit: '', description: 'Total failed inference requests' },
      { key: 'Oom Errors Total', label: 'OOM Request Errors', unit: '', description: 'Out-of-memory errors' },
      { key: 'Num Requests Waiting', label: 'Waiting Requests', unit: '', description: 'Requests waiting in queue' },
      { key: 'Scheduler Pending Requests', label: 'Pending Requests', unit: '', description: 'Requests pending in scheduler queue' },
    ]
  },
  'Token Throughput': {
    icon: TachometerAltIcon,
    priority: 2,
    description: 'Token processing performance and rates',
    metrics: [
      // Prompt Tokens Created and Output Tokens Created removed - shown in Key Metrics
      { key: 'Tokens Generated Per Second', label: 'Token Rate', unit: 't/s', description: 'Token generation rate (tokens/second)' },
      { key: 'Prompt Tokens Total', label: 'Prompt Tokens', unit: '', description: 'Total prompt tokens processed' },
      { key: 'Generation Tokens Total', label: 'Gen Tokens', unit: '', description: 'Total generated tokens' },
      { key: 'Request Prompt Tokens Sum', label: 'Avg Prompt Tokens', unit: '', description: 'Average prompt tokens per request' },
      { key: 'Request Generation Tokens Sum', label: 'Avg Generated Tokens', unit: '', description: 'Average generated tokens per request' },
    ]
  },
  'Latency & Timing': {
    icon: ClockIcon,
    priority: 3,
    description: 'Response time breakdown and analysis',
    metrics: [
      // P95 Latency removed - shown in Key Metrics
      { key: 'Inference Time (s)', label: 'Avg Inference', unit: 's', description: 'Average inference time' },
      { key: 'Streaming Ttft Seconds', label: 'Streaming TTFT', unit: 's', description: 'Average time to first token for streaming' },
      { key: 'Time To First Token Seconds Sum', label: 'TTFT Sum', unit: 's', description: 'Time to first token (total)' },
      { key: 'Time Per Output Token Seconds Sum', label: 'TPOT Sum', unit: 's', description: 'Time per output token (total)' },
      { key: 'Request Prefill Time Seconds Sum', label: 'Prompt Processing Time', unit: 's', description: 'Prompt processing time' },
      { key: 'Request Decode Time Seconds Sum', label: 'Token Generation Time', unit: 's', description: 'Token generation time' },
      { key: 'Request Queue Time Seconds Sum', label: 'Queue Time', unit: 's', description: 'Time spent in queue' },
      { key: 'E2E Request Latency Seconds Sum', label: 'E2E Latency', unit: 's', description: 'End-to-end latency sum' },
    ]
  },
  'Memory & Cache': {
    icon: MemoryIcon,
    priority: 4,
    description: 'Cache efficiency and memory utilization',
    metrics: [
      { key: 'Kv Cache Usage Perc', label: 'KV Cache', unit: '%', description: 'Key-Value cache utilization' },
      { key: 'Gpu Cache Usage Perc', label: 'GPU Cache', unit: '%', description: 'GPU cache utilization' },
      { key: 'Cache Fragmentation Ratio', label: 'Fragmentation', unit: '%', description: 'KV cache fragmentation ratio (lower is better)' },
      { key: 'Kv Cache Usage Bytes', label: 'Cache Used', unit: 'GB', description: 'KV cache memory used (GB)' },
      { key: 'Kv Cache Capacity Bytes', label: 'Cache Capacity', unit: 'GB', description: 'Total KV cache capacity (GB)' },
      { key: 'Kv Cache Free Bytes', label: 'Cache Free', unit: 'GB', description: 'KV cache memory free (GB)' },
      { key: 'Prefix Cache Hits Total', label: 'Cache Hits', unit: '', description: 'Total prefix cache hits' },
      { key: 'Prefix Cache Queries Total', label: 'Cache Queries', unit: '', description: 'Total cache queries' },
      { key: 'Gpu Prefix Cache Hits Total', label: 'GPU Hits', unit: '', description: 'GPU prefix cache hits' },
      { key: 'Gpu Prefix Cache Queries Total', label: 'GPU Queries', unit: '', description: 'GPU cache queries' },
      { key: 'Gpu Prefix Cache Hits Created', label: 'GPU Hit Rate', unit: '/s', description: 'GPU cache hit rate' },
      { key: 'Gpu Prefix Cache Queries Created', label: 'GPU Query Rate', unit: '/s', description: 'GPU cache query rate' },
    ]
  },
  'Scheduling & Queueing': {
    icon: ListIcon,
    priority: 4.5,
    description: 'Scheduler performance and batching efficiency',
    metrics: [
      { key: 'Batch Size', label: 'Batch Size', unit: '', description: 'Current batch size' },
      { key: 'Num Scheduled Requests', label: 'Scheduled', unit: '', description: 'Number of scheduled requests' },
      { key: 'Batching Idle Time Seconds', label: 'Idle Time', unit: 's', description: 'Average batching idle time' },
    ]
  },
  'RPC Monitoring': {
    icon: NetworkIcon,
    priority: 5,
    description: 'RPC server monitoring (HTTP metrics removed - will reconsider with namespace filtering)',
    metrics: [
      { key: 'Vllm Rpc Server Error Count', label: 'RPC Errors', unit: '', description: 'RPC server errors' },
      { key: 'Vllm Rpc Server Connection Total', label: 'RPC Connections', unit: '', description: 'Total RPC connections' },
      { key: 'Vllm Rpc Server Request Count', label: 'RPC Requests', unit: '', description: 'Total RPC requests processed' },
    ]
  },
  'GPU Hardware': {
    icon: CubesIcon,
    priority: 6,
    description: 'GPU hardware monitoring and resource usage',
    metrics: [
      // GPU Temperature, GPU Power Usage, GPU Usage removed - shown in Key Metrics
      { key: 'GPU Energy Consumption (Joules)', label: 'Energy', unit: 'J', description: 'Total energy consumed' },
      { key: 'GPU Memory Usage (GB)', label: 'Memory', unit: 'GB', description: 'GPU memory used' },
      { key: 'GPU Memory Temperature (°C)', label: 'Mem Temp', unit: '°C', description: 'GPU memory temperature' },
    ]
  },
  'Request Parameters': {
    icon: CogIcon,
    priority: 7,
    description: 'Request configuration and parameter analysis',
    metrics: [
      { key: 'Request Max Num Generation Tokens Sum', label: 'Max Gen Tokens', unit: '', description: 'Max generation tokens requested' },
      { key: 'Request Max Num Generation Tokens Count', label: 'Max Gen Reqs', unit: '', description: 'Requests with max gen tokens' },
      { key: 'Request Params Max Tokens Sum', label: 'Max Params', unit: '', description: 'Max tokens parameter sum' },
      { key: 'Request Params Max Tokens Count', label: 'Param Reqs', unit: '', description: 'Requests with max tokens param' },
      { key: 'Request Params N Sum', label: 'N Parameter', unit: '', description: 'N parameter sum' },
      { key: 'Request Params N Count', label: 'N Reqs', unit: '', description: 'Requests with N parameter' },
      { key: 'Iteration Tokens Total Sum', label: 'Iter Tokens', unit: '', description: 'Tokens per iteration' },
      { key: 'Iteration Tokens Total Count', label: 'Iterations', unit: '', description: 'Total iterations' },
    ]
  },
};

// Metric Card Component with Sparkline
interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

interface MetricCardProps {
  label: string;
  value: number | string;
  unit?: string;
  description?: string;
  loading?: boolean;
  timeSeries?: TimeSeriesPoint[];
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, unit = '', description, loading, timeSeries }) => {
  const formatValue = (val: number | string): string => {
    if (typeof val === 'string') return val;
    // Check for invalid values (NaN, null, undefined, infinite)
    if (typeof val === 'number' && (!isFinite(val) || isNaN(val))) return 'N/A';
    if (val === 0) return '0';
    if (val >= 1000000000) return `${(val / 1000000000).toFixed(1)}B`;
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    if (val < 1 && val > 0) return val.toFixed(2);
    return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
  };

  // Enhanced trend calculation with better thresholds and NaN filtering
  const getTrend = (): { direction: 'up' | 'down' | 'flat'; percent: number } | null => {
    if (!timeSeries || timeSeries.length < 3) return null;

    // Filter out NaN/invalid values from time series
    const validValues = timeSeries
      .map(p => p.value)
      .filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v));

    if (validValues.length < 2) return null;

    // Use first and last valid values
    const first = validValues[0];
    const last = validValues[validValues.length - 1];

    // If both are 0, no trend to show
    if (first === 0 && last === 0) return null;

    // Handle case where first is 0 but last has value
    if (first === 0 && last > 0) {
      return { direction: 'up', percent: 100 };
    }

    // Handle case where first has value but last is 0
    if (first > 0 && last === 0) {
      return { direction: 'down', percent: 100 };
    }

    // Normal percentage calculation
    const percent = ((last - first) / Math.abs(first)) * 100;
    return {
      direction: percent > 0.5 ? 'up' : percent < -0.5 ? 'down' : 'flat',
      percent: Math.abs(percent),
    };
  };

  const trend = getTrend();

  // Simple SVG sparkline with NaN filtering
  const renderSparkline = () => {
    if (!timeSeries || timeSeries.length < 2) {
      console.log(`${label}: No sparkline - ${!timeSeries ? 'no timeSeries' : `only ${timeSeries.length} points`}`);
      return null;
    }

    // Filter out NaN/invalid values for sparkline rendering
    const validValues = timeSeries
      .map(p => p.value)
      .filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v));

    if (validValues.length < 2) {
      console.log(`${label}: No sparkline - only ${validValues.length} valid values after filtering`);
      return null;
    }

    console.log(`${label}: Rendering sparkline with ${validValues.length} valid points`);

    const min = Math.min(...validValues);
    const max = Math.max(...validValues);
    const range = max - min || 1;

    const width = 60;
    const height = 20;
    const points = validValues.map((v, i) => {
      const x = (i / (validValues.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');

    const trendColor = trend?.direction === 'up' ? '#3e8635' : trend?.direction === 'down' ? '#c9190b' : '#06c';

    return (
      <svg width={width} height={height} style={{ marginLeft: '8px' }}>
        <polyline
          points={points}
          fill="none"
          stroke={trendColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  const displayValue = formatValue(value);
  const isZero = value === 0;
  const isNull = value === null;

  return (
    <Card
      isCompact
      style={{
        height: '100%',
        transition: 'all 0.3s ease',
        cursor: 'default',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '';
      }}
    >
      <CardBody style={{ padding: '12px' }}>
        <TextContent>
          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: '4px' }}>
            {label}
          </Text>
        </TextContent>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Text
              component={TextVariants.h2}
              style={{
                color: isNull ? 'var(--pf-v5-global--Color--200)' : isZero ? 'var(--pf-v5-global--success-color--100)' : 'inherit',
                marginBottom: '2px',
                fontSize: '1.5rem',
              }}
            >
              {displayValue}{unit && value !== null ? ` ${unit}` : ''}
            </Text>
          </FlexItem>
          <FlexItem>
            {renderSparkline()}
          </FlexItem>
          {trend && trend.direction !== 'flat' && (
            <FlexItem>
              <span style={{
                fontSize: '0.7rem',
                color: trend.direction === 'up' ? '#3e8635' : '#c9190b',
                marginLeft: '4px',
              }}>
                {trend.direction === 'up' ? '↑' : '↓'} {trend.percent.toFixed(0)}%
              </span>
            </FlexItem>
          )}
        </Flex>
        {description && (
          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', fontSize: '0.75rem' }}>
            {description}
          </Text>
        )}
      </CardBody>
    </Card>
  );
};

// Key Metric Card Component - Shows Average + Max values (legacy-style)
interface KeyMetricCardProps {
  label: string;
  avgValue: number | null;
  maxValue: number | null;
  unit?: string;
  loading?: boolean;
  timeSeries?: TimeSeriesPoint[];
}

const KeyMetricCard: React.FC<KeyMetricCardProps> = ({ label, avgValue, maxValue, unit = '', loading, timeSeries }) => {
  // Smart value formatting with M/K suffixes
  const formatValue = (val: number | null, isMainValue: boolean = true): string => {
    if (val === null) return 'N/A';
    if (val === 0) return '0';

    // Special formatting for tokens
    if (label.includes('Tokens')) {
      // Main value: show total tokens
      if (isMainValue) {
        if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
        return val.toFixed(0);
      }
      // Max value for tokens is peak rate (tokens/sec)
      else {
        if (val >= 1000) return `${(val / 1000).toFixed(1)}K/s`;
        if (val >= 1) return `${val.toFixed(1)}/s`;
        return `${(val * 60).toFixed(1)}/min`;
      }
    }

    // Special formatting for latency/time
    if (label.includes('Latency') || label.includes('Time')) {
      if (val >= 1) return val.toFixed(2);
      return (val * 1000).toFixed(0); // Convert to ms
    }

    // Temperature, power, usage - show 1 decimal
    if (unit === '°C' || unit === 'W' || unit === '%') {
      return val.toFixed(1);
    }

    // Default formatting
    if (val < 1 && val > 0) return val.toFixed(2);
    return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
  };

  // Trend calculation with NaN filtering
  const getTrend = (): { direction: 'up' | 'down' | 'flat'; percent: number } | null => {
    if (!timeSeries || timeSeries.length < 3) return null;

    // Filter out NaN/invalid values
    const validValues = timeSeries
      .map(p => p.value)
      .filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v));

    if (validValues.length < 2) return null;

    const first = validValues[0];
    const last = validValues[validValues.length - 1];

    if (first === 0 && last === 0) return null;
    if (first === 0 && last > 0) return { direction: 'up', percent: 100 };
    if (first > 0 && last === 0) return { direction: 'down', percent: 100 };

    const percent = ((last - first) / Math.abs(first)) * 100;
    return {
      direction: percent > 0.5 ? 'up' : percent < -0.5 ? 'down' : 'flat',
      percent: Math.abs(percent),
    };
  };

  const trend = getTrend();

  // Sparkline rendering with NaN filtering
  const renderSparkline = () => {
    if (!timeSeries || timeSeries.length < 2) return null;

    // Filter out NaN/invalid values
    const validValues = timeSeries
      .map(p => p.value)
      .filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v));

    if (validValues.length < 2) return null;

    const min = Math.min(...validValues);
    const max = Math.max(...validValues);
    const range = max - min || 1;

    const width = 80;
    const height = 30;
    const points = validValues.map((v, i) => {
      const x = (i / (validValues.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');

    const trendColor = trend?.direction === 'up' ? '#3e8635' : trend?.direction === 'down' ? '#c9190b' : '#06c';

    return (
      <svg width={width} height={height} style={{ marginTop: '8px' }}>
        <polyline
          points={points}
          fill="none"
          stroke={trendColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  const displayAvg = formatValue(avgValue, true);
  const displayMax = formatValue(maxValue, false); // false = this is a secondary value (rate for tokens)
  const displayUnit = unit && avgValue !== null ? ` ${unit}` : '';

  return (
    <Card
      isCompact
      style={{
        height: '100%',
        background: 'linear-gradient(135deg, #ffffff 0%, #f5f5f5 100%)',
        border: '1px solid #d2d2d2',
        transition: 'all 0.3s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '';
      }}
    >
      <CardBody style={{ padding: '16px' }}>
        <TextContent>
          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: '8px', fontWeight: 600 }}>
            {label}
          </Text>
        </TextContent>
        <Flex direction={{ default: 'column' }}>
          <FlexItem>
            <Text
              component={TextVariants.h1}
              style={{
                color: avgValue === null ? 'var(--pf-v5-global--Color--200)' : avgValue === 0 ? 'var(--pf-v5-global--success-color--100)' : 'inherit',
                marginBottom: '4px',
                fontSize: '2rem',
                fontWeight: 700,
              }}
            >
              {displayAvg}{displayUnit}
            </Text>
          </FlexItem>
          <FlexItem>
            <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', fontSize: '0.85rem' }}>
              {label.includes('Tokens') ? 'Peak:' : 'Max:'} {displayMax}{label.includes('Tokens') ? '' : displayUnit}
            </Text>
          </FlexItem>
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                {renderSparkline()}
              </FlexItem>
              {trend && trend.direction !== 'flat' && (
                <FlexItem>
                  <span style={{
                    fontSize: '0.75rem',
                    color: trend.direction === 'up' ? '#3e8635' : '#c9190b',
                    marginLeft: '8px',
                    fontWeight: 600,
                  }}>
                    {trend.direction === 'up' ? '↑' : '↓'} {trend.percent.toFixed(0)}%
                  </span>
                </FlexItem>
              )}
            </Flex>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};

// Key Metrics Section Component
interface KeyMetricsSectionProps {
  data: Record<string, MetricDataValue>;
  loading: boolean;
  timeRange: string;
  isSelected?: boolean;
  onSelect?: () => void;
}

const KeyMetricsSection: React.FC<KeyMetricsSectionProps> = ({ data, loading, timeRange, isSelected, onSelect }) => {
  // Helper: Convert time range string to seconds
  const getTimeRangeSeconds = (range: string): number => {
    const num = parseInt(range);
    if (range.includes('h')) return num * 3600;
    if (range.includes('m')) return num * 60;
    if (range.includes('d')) return num * 86400;
    return 3600; // Default to 1 hour
  };

  // Calculate avg and max from time series data with strict NaN/null filtering.
  const getAvgAndMax = (key: string): { avg: number | null; max: number | null } => {
    const metricData = data[key];

    // For token metrics (increase queries), show total and peak rate
    // Why: Token queries use increase(counter[1h]) which gives overlapping windows
    // Example for 1-hour window (14:00-15:00):
    //   - Instant query at 15:00: increase[1h] = tokens from 14:00-15:00 = 25K ✓ CORRECT
    //   - Range query sparkline points:
    //     * 14:00: increase[1h] from 13:00-14:00 = 20K (BEFORE selected window!)
    //     * 14:04: increase[1h] from 13:04-14:04 = 20K (mostly before window, overlaps with above)
    //     * 15:00: increase[1h] from 14:00-15:00 = 25K (matches window)
    //   - Average of sparkline: (20K + 20K + ... + 25K) / 15 ≈ 22K ✗ WRONG (includes data before window)
    //   - Sum of sparkline: 20K + 20K + ... = 330K ✗ WRONG (massive double-counting due to overlap)
    //   - Latest value: 25K ✓ CORRECT (exact tokens during selected window)
    //   - Peak rate: max(20K, 20K, ..., 25K) / 3600s = 25K / 3600 ≈ 7 tokens/sec
    if (key.includes('Tokens Created')) {
      const latestValue = metricData?.latest_value;

      // Filter out NaN, null, and infinite values
      if (latestValue === null || latestValue === undefined ||
          isNaN(latestValue) || !isFinite(latestValue)) {
        return { avg: null, max: null };
      }

      // Calculate peak rate from sparkline (highest burst rate observed)
      let peakRate: number | null = null;
      if (metricData?.time_series && metricData.time_series.length > 0) {
        const windowDuration = getTimeRangeSeconds(timeRange);
        const validValues = metricData.time_series
          .map(p => p.value)
          .filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v));

        if (validValues.length > 0 && windowDuration > 0) {
          // Peak rate = highest increase observed / window duration
          const maxIncrease = Math.max(...validValues);
          peakRate = maxIncrease / windowDuration; // tokens per second
        }
      }

      return { avg: latestValue, max: peakRate };
    }

    // If no time series data, check if latest_value is valid
    if (!metricData || !metricData.time_series || metricData.time_series.length === 0) {
      const latestValue = metricData?.latest_value;

      // Filter out NaN, null, and infinite values.
      if (latestValue === null || latestValue === undefined ||
          isNaN(latestValue) || !isFinite(latestValue)) {
        return { avg: null, max: null };
      }

      return { avg: latestValue, max: latestValue };
    }

    // Filter out NaN, null, and infinite values from time series
    const validValues = metricData.time_series
      .map(p => p.value)
      .filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v));

    // If no valid values, return null (will display as "N/A")
    if (validValues.length === 0) {
      return { avg: null, max: null };
    }

    const avg = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
    const max = Math.max(...validValues);

    return { avg, max };
  };

  return (
    <Card
      style={{
        marginBottom: '24px',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
        border: isSelected ? '2px solid var(--pf-v5-global--primary-color--100)' : '2px solid #c4b5fd',
        boxShadow: isSelected ? '0 0 8px rgba(0,102,204,0.3)' : undefined,
        cursor: onSelect ? 'pointer' : 'default',
      }}
      onClick={onSelect}
    >
      <CardTitle>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <TachometerAltIcon style={{ marginRight: '8px', color: '#7c3aed' }} />
          </FlexItem>
          <FlexItem>
            <Text component={TextVariants.h2} style={{ color: '#7c3aed', fontWeight: 700 }}>
              Key Metrics
            </Text>
          </FlexItem>
          <FlexItem>
            <Text component={TextVariants.small} style={{ color: '#6b21a8', marginLeft: '12px' }}>
              Critical performance indicators at a glance
            </Text>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Grid hasGutter sm={12} md={6} lg={4}>
          {KEY_METRICS_CONFIG.map((metric) => {
            const { avg, max } = getAvgAndMax(metric.key);
            const metricData = data[metric.key];
            return (
              <GridItem key={metric.key}>
                <KeyMetricCard
                  label={metric.label}
                  avgValue={avg}
                  maxValue={max}
                  unit={metric.unit}
                  loading={loading}
                  timeSeries={metricData?.time_series}
                />
              </GridItem>
            );
          })}
        </Grid>
      </CardBody>
    </Card>
  );
};

// Category Section Component
interface MetricDataValue {
  latest_value: number;
  time_series?: TimeSeriesPoint[];
}

interface CategorySectionProps {
  title: string;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  description: string;
  metrics: Array<{ key: string; label: string; unit: string; description: string }>;
  data: Record<string, MetricDataValue>;
  loading: boolean;
  isSelected?: boolean;
  onSelect?: (title: string) => void;
}

const CategorySection: React.FC<CategorySectionProps> = ({ title, icon: Icon, description, metrics, data, loading, isSelected, onSelect }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const handleClick = () => {
    setIsExpanded(!isExpanded);
    if (onSelect) {
      onSelect(title);
    }
  };

  return (
    <Card style={{
      marginBottom: '16px',
      border: isSelected ? '2px solid var(--pf-v5-global--primary-color--100)' : undefined,
      boxShadow: isSelected ? '0 0 8px rgba(0,102,204,0.3)' : undefined,
    }}>
      <CardTitle
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={handleClick}
      >
        <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }}>
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                {isExpanded ? <AngleDownIcon style={{ marginRight: '8px' }} /> : <AngleRightIcon style={{ marginRight: '8px' }} />}
              </FlexItem>
              <FlexItem>
                <Icon style={{ marginRight: '8px', color: 'var(--pf-v5-global--primary-color--100)' }} />
              </FlexItem>
              <FlexItem>
                <Text component={TextVariants.h3}>{title}</Text>
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem>
            <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
              {description}
            </Text>
          </FlexItem>
        </Flex>
      </CardTitle>
      {isExpanded && (
        <CardBody>
          <Grid hasGutter md={4} lg={3} xl={2}>
            {metrics.map((metric) => {
              const metricData = data[metric.key];
              return (
                <GridItem key={metric.key}>
                  <MetricCard
                    label={metric.label}
                    value={metricData?.latest_value ?? 0}
                    unit={metric.unit}
                    description={metric.description}
                    loading={loading}
                    timeSeries={metricData?.time_series}
                  />
                </GridItem>
              );
            })}
          </Grid>
        </CardBody>
      )}
    </Card>
  );
};

// Main Page Component
const VLLMMetricsPage: React.FC = () => {
  const [namespace, setNamespace] = React.useState<string>('all');
  const [model, setModel] = React.useState<string>('');
  const [timeRange, setTimeRange] = React.useState<string>('1h');
  const [namespaces, setNamespaces] = React.useState<NamespaceInfo[]>([]);
  const [models, setModels] = React.useState<ModelInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [metricsLoading, setMetricsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ragAvailable, setRagAvailable] = React.useState<boolean | null>(null);
  const [analysisLoading, setAnalysisLoading] = React.useState(false);
  const [analysisResult, setAnalysisResult] = React.useState<AnalysisResult | null>(null);
  const [analysisController, setAnalysisController] = React.useState<AbortController | null>(null);
  const [metricsData, setMetricsData] = React.useState<Record<string, MetricDataValue>>({});
  const fetchIdRef = React.useRef(0);
  const [chatPanelOpen, setChatPanelOpen] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState<string>('vLLM Overview');

  React.useEffect(() => {
    loadData();
  }, []);

  // Reset model when namespace changes
  React.useEffect(() => {
    if (namespace === 'all') {
      // If showing all namespaces, select first available model
      if (models.length > 0) {
        setModel(`${models[0].namespace} | ${models[0].name}`);
      }
    } else {
      // If namespace is selected, select first model in that namespace
      const filteredModels = models.filter(m => m.namespace === namespace);
      if (filteredModels.length > 0) {
        setModel(`${filteredModels[0].namespace} | ${filteredModels[0].name}`);
      } else {
        setModel('');
      }
    }
  }, [namespace, models]);

  React.useEffect(() => {
    if (namespace && model) {
      // Clear old metrics data to avoid showing stale data
      setMetricsData({});
      fetchMetrics();
    }
  }, [namespace, model, timeRange]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [modelsData, namespacesData] = await Promise.all([
        listModels(),
        listNamespaces(),
      ]);
      setModels(modelsData);
      setNamespaces(namespacesData);

      // Detect RAG availability based on presence of vLLM models
      setRagAvailable(modelsData.length > 0);

      // Auto-select first namespace if available
      // Model will be auto-selected by the namespace useEffect
      if (namespacesData.length > 0) {
        setNamespace(namespacesData[0].name);
      }
    } catch (err) {
      setError('Failed to load data from MCP server');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async () => {
    if (!model) return;

    // Increment fetch ID to track this request
    const currentFetchId = ++fetchIdRef.current;

    setMetricsLoading(true);
    setError(null);
    try {
      const metricsResponse = await fetchVLLMMetrics(model, timeRange, namespace !== 'all' ? namespace : undefined);

      // Check if this is still the latest fetch
      if (currentFetchId !== fetchIdRef.current) {
        return;
      }

      if (!metricsResponse || !metricsResponse.metrics) {
        setError('No metrics data available for this model');
        setMetricsData({});
        return;
      }

      // Use only real data from MCP server - no mock data
      setMetricsData(metricsResponse.metrics);
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
      setError('Failed to fetch metrics from MCP server');
    } finally {
      setMetricsLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!model) return;

    // Cancel any existing analysis
    if (analysisController) {
      analysisController.abort();
    }

    // Create new abort controller
    const controller = new AbortController();
    setAnalysisController(controller);

    setAnalysisLoading(true);
    setAnalysisResult(null);
    setError(null);
    try {
      const config = getSessionConfig();
      console.log('[Analyze] Session config:', config);

      if (!config.ai_model) {
        setError('Please configure an AI model in Settings first');
        setAnalysisLoading(false);
        setAnalysisController(null);
        return;
      }

      console.log('[Analyze] Calling analyzeVLLM with:', { model, aiModel: config.ai_model, timeRange });
      const result = await analyzeVLLM(model, config.ai_model, timeRange, config.api_key, controller.signal);
      console.log('[Analyze] Result received:', result);

      // Check if request was cancelled
      if (controller.signal.aborted) {
        return;
      }

      if (result && result.summary) {
        setAnalysisResult(result);
      } else {
        console.error('[Analyze] Invalid result format:', result);
        setError('Analysis returned invalid format. Check browser console for details.');
      }
    } catch (err) {
      // Don't show error if request was cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      console.error('[Analyze] Failed:', err);
      setError(`Failed to analyze metrics: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!controller.signal.aborted) {
        setAnalysisLoading(false);
        setAnalysisController(null);
      }
    }
  };

  const handleCancelAnalysis = () => {
    if (analysisController) {
      analysisController.abort();
      setAnalysisController(null);
    }
    setAnalysisLoading(false);
    setAnalysisResult(null);
  };

  const handleRefresh = () => {
    fetchMetrics();
  };

  const filteredModels = React.useMemo(() => {
    if (namespace === 'all') return models;
    return models.filter(m => m.namespace === namespace);
  }, [namespace, models]);

  if (loading) {
    return (
      <Page>
        <PageSection>
          <Bullseye>
            <Spinner size="xl" />
          </Bullseye>
        </PageSection>
      </Page>
    );
  }

  if (error && models.length === 0) {
    return (
      <Page>
        <PageSection>
          <Alert variant={AlertVariant.danger} title="Error loading data">
            {error}
          </Alert>
        </PageSection>
      </Page>
    );
  }

  return (
    <Page className="vllm-dashboard">
      {/* Header with animated gradient background */}
      <PageSection
        variant="light"
        style={{
          background: 'linear-gradient(-45deg, #7c3aed, #4f46e5, #3b82f6, #06b6d4, #8b5cf6)',
          backgroundSize: '400% 400%',
          animation: 'gradientShift 15s ease infinite',
          color: 'white',
          paddingBottom: '24px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <style>
          {`
            @keyframes gradientShift {
              0% {
                background-position: 0% 50%;
              }
              50% {
                background-position: 100% 50%;
              }
              100% {
                background-position: 0% 50%;
              }
            }

            @keyframes shimmer {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(100%);
              }
            }

            @keyframes subtleGlow {
              0%, 100% {
                box-shadow: 0 0 20px rgba(124,58,237,0.1);
              }
              50% {
                box-shadow: 0 0 30px rgba(124,58,237,0.2);
              }
            }

            .vllm-dashboard {
              animation: subtleGlow 12s ease-in-out infinite;
            }
          `}
        </style>

        {/* Subtle overlay shimmer effect */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
            animation: 'shimmer 8s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1" style={{ color: 'white' }}>
              <TachometerAltIcon style={{ marginRight: '12px' }} />
              vLLM Metrics
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.8)', marginTop: '8px' }}>
              Monitor and analyze vLLM model performance and resource utilization
            </Text>
          </FlexItem>
        </Flex>
      </PageSection>

      {/* Filters Toolbar */}
      <PageSection variant="light" style={{ paddingTop: '16px', paddingBottom: '16px' }}>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <FormGroup label="Namespace" fieldId="namespace-select">
                <FormSelect
                  id="namespace-select"
                  value={namespace}
                  onChange={(_e, val) => setNamespace(val)}
                  style={{ minWidth: '200px' }}
                >
                  <FormSelectOption key="all" value="all" label="All Namespaces" />
                  {namespaces.map((ns) => (
                    <FormSelectOption key={ns.name} value={ns.name} label={ns.name} />
                  ))}
                </FormSelect>
              </FormGroup>
            </ToolbarItem>
            <ToolbarItem>
              <FormGroup label="Model" fieldId="model-select">
                <FormSelect
                  id="model-select"
                  value={model}
                  onChange={(_e, val) => setModel(val)}
                  style={{ minWidth: '300px' }}
                >
                  {filteredModels.map((m) => (
                    <FormSelectOption
                      key={`${m.namespace}-${m.name}`}
                      value={`${m.namespace} | ${m.name}`}
                      label={`${m.namespace} | ${m.name}`}
                    />
                  ))}
                </FormSelect>
              </FormGroup>
            </ToolbarItem>
            <ToolbarItem>
              <FormGroup label="Time Range" fieldId="time-range-select">
                <FormSelect
                  id="time-range-select"
                  value={timeRange}
                  onChange={(_e, val) => {
                    setTimeRange(val);
                  }}
                  style={{ minWidth: '120px' }}
                >
                  <FormSelectOption value="15m" label="15 minutes" />
                  <FormSelectOption value="1h" label="1 hour" />
                  <FormSelectOption value="6h" label="6 hours" />
                  <FormSelectOption value="24h" label="24 hours" />
                  <FormSelectOption value="7d" label="7 days" />
                </FormSelect>
              </FormGroup>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignRight' }}>
              <Button
                variant="secondary"
                onClick={() => { handleRefresh(); }}
                isLoading={metricsLoading}
                icon={<SyncIcon />}
              >
                Refresh
              </Button>
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant="primary"
                onClick={handleAnalyze}
                isLoading={analysisLoading}
                isDisabled={!model}
                icon={<OutlinedLightbulbIcon />}
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6366f1 100%)',
                  backgroundSize: '200% 200%',
                  animation: 'gradientShift 12s ease infinite',
                  border: 'none',
                  transition: 'all 0.3s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px) scale(1.02)';
                  e.currentTarget.style.boxShadow = '0 8px 25px rgba(139,92,246,0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0) scale(1)';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                Analyze with AI
              </Button>
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant={chatPanelOpen ? 'primary' : 'secondary'}
                icon={chatPanelOpen ? <TimesIcon /> : <RobotIcon />}
                onClick={() => setChatPanelOpen(!chatPanelOpen)}
                isDisabled={!model}
              >
                {chatPanelOpen ? 'Close Assistant' : 'AI Assistant'}
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      {/* Main Content */}
      <PageSection>
        <Grid hasGutter>
          <GridItem span={chatPanelOpen ? 8 : 12}>
            {/* Current Selection Labels */}
            {model !== 'all' && (
              <Flex style={{ marginBottom: '16px' }}>
                <FlexItem>
                  <Label color="blue" icon={<CubesIcon />}>
                    {namespace === 'all' ? 'All Namespaces' : namespace}
                  </Label>
                </FlexItem>
                <FlexItem>
                  <Label color="purple" icon={<TachometerAltIcon />}>
                    {model.split(' | ')[1] || model}
                  </Label>
                </FlexItem>
                <FlexItem>
                  <Label color="grey">
                    Last {timeRange === '15m' ? '15 minutes' : timeRange === '1h' ? '1 hour' : timeRange === '6h' ? '6 hours' : timeRange === '24h' ? '24 hours' : '7 days'}
                  </Label>
                </FlexItem>
              </Flex>
            )}

            {/* Error Alert */}
            {error && (
              <div style={{ marginBottom: '16px' }}>
                {error === 'Please configure an AI model in Settings first' ? (
                  <ConfigurationRequiredAlert onClose={() => setError(null)} />
                ) : (
                  <Alert variant={AlertVariant.warning} title="Warning" isInline>
                    {error}
                  </Alert>
                )}
              </div>
            )}

            {/* AI Analysis Result */}
            {(analysisResult || analysisLoading) && (
              <Card style={{ marginBottom: '16px', background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)', border: '1px solid #c4b5fd' }}>
                <CardTitle>
                  <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem>
                      <OutlinedLightbulbIcon style={{ color: '#7c3aed', marginRight: '8px' }} />
                      AI Analysis
                    </FlexItem>
                    <FlexItem align={{ default: 'alignRight' }}>
                      <Button variant="plain" onClick={() => setAnalysisResult(null)}>✕</Button>
                    </FlexItem>
                  </Flex>
                </CardTitle>
                <CardBody>
                  {analysisLoading ? (
                    <Bullseye style={{ minHeight: '100px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <Spinner size="lg" />
                        <Text component={TextVariants.p} style={{ marginTop: '12px', color: 'var(--pf-v5-global--Color--200)' }}>
                          Analyzing {model}...
                        </Text>
                        <Button
                          variant="link"
                          onClick={handleCancelAnalysis}
                          style={{ marginTop: '16px', color: 'var(--pf-v5-global--danger-color--100)' }}
                        >
                          Cancel Analysis
                        </Button>
                      </div>
                    </Bullseye>
                  ) : analysisResult ? (
                    <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, lineHeight: 1.6 }}>
                      {analysisResult.summary}
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            )}

            {/* Loading */}
            {metricsLoading && (
              <Bullseye style={{ minHeight: '200px' }}>
                <div style={{ textAlign: 'center' }}>
                  <Spinner size="xl" />
                  <Text component={TextVariants.p} style={{ marginTop: '16px', color: 'var(--pf-v5-global--Color--200)' }}>
                    Fetching vLLM metrics for {model}...
                  </Text>
                </div>
              </Bullseye>
            )}

            {/* Metrics Display */}
            {!metricsLoading && (
              <>
                {/* Key Metrics Section - Priority metrics at the top */}
                <KeyMetricsSection
                  data={metricsData}
                  loading={metricsLoading}
                  timeRange={timeRange}
                  isSelected={selectedCategory === 'vLLM Overview'}
                  onSelect={() => setSelectedCategory('vLLM Overview')}
                />

                {/* Detailed Category Sections - Collapsible */}
                {Object.entries(METRIC_CATEGORIES)
                  .sort(([, a], [, b]) => (a.priority || 999) - (b.priority || 999))
                  .map(([categoryName, category]) => (
                    <CategorySection
                      key={categoryName}
                      title={categoryName}
                      icon={category.icon}
                      description={category.description}
                      metrics={category.metrics}
                      data={metricsData}
                      loading={metricsLoading}
                      isSelected={selectedCategory === categoryName}
                      onSelect={setSelectedCategory}
                    />
                  ))}
              </>
            )}

            {/* No data message */}
            {!metricsLoading && model && Object.keys(metricsData).length === 0 && (
              <Alert variant={AlertVariant.warning} title="No metrics data" isInline>
                No metrics data available for {model}. Make sure the model is active and metrics are enabled.
              </Alert>
            )}
          </GridItem>

          {/* Chat Panel */}
          {chatPanelOpen && (
            <GridItem span={4}>
              <div style={{ position: 'sticky', top: '16px', height: 'calc(100vh - 250px)' }}>
                <MetricsChatPanel
                  pageType="vllm"
                  scope={namespace || 'all'}
                  namespace={namespace !== 'all' ? namespace : undefined}
                  category={selectedCategory}
                  timeRange={timeRange}
                  isOpen={chatPanelOpen}
                  onClose={() => setChatPanelOpen(false)}
                  modelName={model}
                />
              </div>
            </GridItem>
          )}
        </Grid>
      </PageSection>

      {models.length === 0 && namespaces.length === 0 && (
        <PageSection>
          <EmptyState>
            <EmptyStateBody>
              {ragAvailable === false ? (
                <div>
                  <Text component={TextVariants.h2} style={{ color: 'var(--pf-v5-global--warning-color--100)', marginBottom: '16px' }}>
                    vLLM Infrastructure Not Available
                  </Text>
                  <Text style={{ marginBottom: '16px' }}>
                    No local vLLM models are available because the RAG infrastructure is not installed or not accessible.
                  </Text>
                  <Text style={{ marginBottom: '16px' }}>
                    The vLLM metrics dashboard requires local model deployment with RAG infrastructure.
                  </Text>
                  <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                    To enable vLLM metrics, install the RAG infrastructure using: <code>make install ENABLE_RAG=true</code>
                  </Text>
                </div>
              ) : (
                <div>
                  <Text component={TextVariants.h2} style={{ marginBottom: '16px' }}>
                    No vLLM Models Found
                  </Text>
                  <Text>
                    Make sure models are deployed and the MCP server is properly configured.
                  </Text>
                </div>
              )}
            </EmptyStateBody>
            <Button variant="primary" onClick={loadData}>Retry</Button>
          </EmptyState>
        </PageSection>
      )}
    </Page>
  );
};

export default VLLMMetricsPage;
