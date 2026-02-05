import * as React from 'react';
import Helmet from 'react-helmet';
import {
  Page,
  PageSection,
  Title,
  Button,
  Alert,
  AlertVariant,
  Grid,
  GridItem,
  Spinner,
  Bullseye,
  Text,
  TextContent,
  TextVariants,
  Card,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Label,
} from '@patternfly/react-core';
import { SyncIcon, CubesIcon, ServerIcon } from '@patternfly/react-icons';
import { fetchOpenShiftMetrics } from '../services/mcpClient';

// Mirrors the "Device (DCGM)" category labels from `src/core/metrics.py`
const NVIDIA_DCGM_METRICS = [
  { key: 'GPU Count', label: 'GPU Count', unit: '', description: 'Total GPUs detected via DCGM metrics' },
  { key: 'GPU Utilization Avg (%)', label: 'Util Avg', unit: '%', description: 'Average GPU utilization across all GPUs' },
  { key: 'GPU Utilization Max (%)', label: 'Util Max', unit: '%', description: 'Max GPU utilization across all GPUs' },
  { key: 'GPU Memory Used Avg (GiB)', label: 'Mem Used Avg', unit: 'GiB', description: 'Average framebuffer memory used across GPUs' },
  { key: 'GPU Memory Used Max (GiB)', label: 'Mem Used Max', unit: 'GiB', description: 'Max framebuffer memory used across GPUs' },
  { key: 'GPU Memory Free Avg (GiB)', label: 'Mem Free Avg', unit: 'GiB', description: 'Average framebuffer memory free across GPUs' },
  { key: 'GPU Memory Reserved Avg (GiB)', label: 'Mem Reserved Avg', unit: 'GiB', description: 'Average framebuffer memory reserved across GPUs' },
  { key: 'GPU Temperature Avg (°C)', label: 'Temp Avg', unit: '°C', description: 'Average GPU temperature across all GPUs' },
  { key: 'GPU Temperature Max (°C)', label: 'Temp Max', unit: '°C', description: 'Max GPU temperature across all GPUs' },
  { key: 'GPU Power Usage Avg (W)', label: 'Power Avg', unit: 'W', description: 'Average GPU power usage across all GPUs' },
  { key: 'GPU Power Usage Max (W)', label: 'Power Max', unit: 'W', description: 'Max GPU power usage across all GPUs' },
  { key: 'PCIe RX (MB/s)', label: 'PCIe RX', unit: 'MB/s', description: 'Average PCIe receive throughput' },
  { key: 'PCIe TX (MB/s)', label: 'PCIe TX', unit: 'MB/s', description: 'Average PCIe transmit throughput' },
  { key: 'PCIe Replay Counter (max)', label: 'PCIe Replays', unit: '', description: 'Max PCIe replay counter across GPUs' },
  { key: 'Correctable Remapped Rows (max)', label: 'Corr Remap Rows', unit: '', description: 'Max correctable remapped rows across GPUs' },
  { key: 'Uncorrectable Remapped Rows (max)', label: 'Uncorr Remap Rows', unit: '', description: 'Max uncorrectable remapped rows across GPUs' },
  { key: 'Row Remap Failure (any)', label: 'Row Remap Failure', unit: '', description: '1 means at least one GPU has remap failure' },
] as const;

// Mirrors the "Device (Intel)" category labels from `src/core/metrics.py`
const INTEL_HABANALABS_METRICS = [
  { key: 'Device Count', label: 'Device Count', unit: '', description: 'Total Gaudi devices detected via metrics' },
  { key: 'Utilization Avg (%)', label: 'Util Avg', unit: '%', description: 'Average device utilization across all devices' },
  { key: 'Utilization Max (%)', label: 'Util Max', unit: '%', description: 'Max device utilization across all devices' },
  { key: 'Memory Used Avg (GiB)', label: 'Mem Used Avg', unit: 'GiB', description: 'Average device memory used across devices' },
  { key: 'Memory Used Max (GiB)', label: 'Mem Used Max', unit: 'GiB', description: 'Max device memory used across devices' },
  { key: 'Temperature Avg (°C)', label: 'Temp Avg', unit: '°C', description: 'Average on-chip temperature across devices' },
  { key: 'Temperature Max (°C)', label: 'Temp Max', unit: '°C', description: 'Max on-chip temperature across devices' },
  { key: 'Power Avg (W)', label: 'Power Avg', unit: 'W', description: 'Average device power usage across devices' },
  { key: 'Power Max (W)', label: 'Power Max', unit: 'W', description: 'Max device power usage across devices' },
] as const;

const TIME_RANGE_OPTIONS = [
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

// Time series data point
interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

interface MetricDataValue {
  latest_value: number | null;
  time_series?: TimeSeriesPoint[];
}

// Metric Card Component with Sparkline (simple, consistent with other pages)
interface MetricCardProps {
  label: string;
  value: number | null;
  unit?: string;
  description?: string;
  timeSeries?: TimeSeriesPoint[];
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, unit, description, timeSeries }) => {
  const formatValue = (val: number | null): string => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    if (val >= 1000000000) return `${(val / 1000000000).toFixed(2)}B`;
    if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    if (val < 0.01 && val > 0) return val.toExponential(2);
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(2);
  };

  const getTrend = (): { direction: 'up' | 'down' | 'flat'; percent: number } | null => {
    if (!timeSeries || timeSeries.length < 2) return null;
    const first = timeSeries[0].value;
    const last = timeSeries[timeSeries.length - 1].value;
    if (first === 0) return null;
    const percent = ((last - first) / first) * 100;
    return {
      direction: percent > 1 ? 'up' : percent < -1 ? 'down' : 'flat',
      percent: Math.abs(percent),
    };
  };

  const trend = getTrend();

  const renderSparkline = () => {
    if (!timeSeries || timeSeries.length < 2) return null;

    const values = timeSeries.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const width = 60;
    const height = 20;
    const points = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - ((v - min) / range) * height;
        return `${x},${y}`;
      })
      .join(' ');

    const trendColor =
      trend?.direction === 'up'
        ? '#3e8635'
        : trend?.direction === 'down'
          ? '#c9190b'
          : '#06c';

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
    <Card isCompact style={{ height: '100%' }}>
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
              {displayValue}
              {unit && value !== null ? ` ${unit}` : ''}
            </Text>
          </FlexItem>
          <FlexItem>{renderSparkline()}</FlexItem>
          {trend && trend.direction !== 'flat' && (
            <FlexItem>
              <span
                style={{
                  fontSize: '0.7rem',
                  color: trend.direction === 'up' ? '#3e8635' : '#c9190b',
                  marginLeft: '4px',
                }}
              >
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

const DeviceMetricsPage: React.FC = () => {
  const [timeRange, setTimeRange] = React.useState<string>('1h');
  const [hasNvidia, setHasNvidia] = React.useState<boolean>(false);
  const [hasIntel, setHasIntel] = React.useState<boolean>(false);
  const [nvidiaData, setNvidiaData] = React.useState<Record<string, MetricDataValue>>({});
  const [intelData, setIntelData] = React.useState<Record<string, MetricDataValue>>({});
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      // Robust approach: always fetch both vendor groups and infer availability from the count metric.
      // This avoids false negatives when vendor-detection calls fail (e.g., transient Prometheus/port-forward issues).
      const [dcgmResp, intelResp] = await Promise.all([
        fetchOpenShiftMetrics('Device (DCGM)', 'cluster_wide', timeRange),
        fetchOpenShiftMetrics('Device (Intel)', 'cluster_wide', timeRange),
      ]);

      if (!dcgmResp && !intelResp) {
        setError('Failed to fetch device metrics from MCP server');
        setHasNvidia(false);
        setHasIntel(false);
        setNvidiaData({});
        setIntelData({});
        return;
      }

      const dcgmMetrics = dcgmResp?.metrics || {};
      const intelMetrics = intelResp?.metrics || {};

      // Availability: consider vendor present only when device count is > 0
      const nvidiaCount = dcgmMetrics['GPU Count']?.latest_value ?? 0;
      const intelCount = intelMetrics['Device Count']?.latest_value ?? 0;

      setHasNvidia(Number(nvidiaCount) > 0);
      setHasIntel(Number(intelCount) > 0);
      setNvidiaData(dcgmMetrics);
      setIntelData(intelMetrics);
    } catch (err) {
      console.error('[Devices] Failed to load metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load device metrics');
      setNvidiaData({});
      setIntelData({});
      setHasNvidia(false);
      setHasIntel(false);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange]);

  const hasAnyData = Object.keys(nvidiaData).length > 0 || Object.keys(intelData).length > 0;

  return (
    <Page>
      <Helmet>
        <title>Hardware Accelerators - AI Observability</title>
      </Helmet>

      {/* Header */}
      <PageSection
        variant="light"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1f2937 50%, #111827 100%)',
          color: 'white',
          paddingBottom: '24px',
        }}
      >
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1" style={{ color: 'white' }}>
              <CubesIcon style={{ marginRight: '12px' }} />
              Hardware Accelerators
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.8)', marginTop: '8px' }}>Accelerator fleet view</Text>
          </FlexItem>
        </Flex>
      </PageSection>

      {/* Filters Toolbar */}
      <PageSection variant="light" style={{ paddingTop: '16px', paddingBottom: '16px' }}>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <FormGroup label="Time Range" fieldId="devices-time-range-select">
                <FormSelect
                  id="devices-time-range-select"
                  value={timeRange}
                  onChange={(_event, value) => setTimeRange(value)}
                  aria-label="Select time range"
                  style={{ minWidth: '140px' }}
                >
                  {TIME_RANGE_OPTIONS.map((opt) => (
                    <FormSelectOption key={opt.value} value={opt.value} label={opt.label} />
                  ))}
                </FormSelect>
              </FormGroup>
            </ToolbarItem>

            <ToolbarItem align={{ default: 'alignRight' }}>
              <Button
                variant="secondary"
                icon={<SyncIcon />}
                onClick={loadMetrics}
                isDisabled={loading}
                isLoading={loading}
              >
                Refresh
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      {/* Error */}
      {error && (
        <PageSection style={{ paddingTop: '8px', paddingBottom: '8px' }}>
          <Alert
            variant={AlertVariant.danger}
            title="Error"
            isInline
            actionClose={<Button variant="plain" onClick={() => setError(null)}>✕</Button>}
          >
            {error}
          </Alert>
        </PageSection>
      )}

      {/* Content */}
      <PageSection>
        <Flex style={{ marginBottom: '16px' }}>
          <FlexItem>
            <Label color="blue" icon={<ServerIcon />}>
              Cluster-wide
            </Label>
          </FlexItem>
          <FlexItem>
            <Label color="grey">Last {TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label}</Label>
          </FlexItem>
        </Flex>

        {loading && (
          <Bullseye style={{ minHeight: '200px' }}>
            <div style={{ textAlign: 'center' }}>
              <Spinner size="xl" />
              <Text component={TextVariants.p} style={{ marginTop: '16px', color: 'var(--pf-v5-global--Color--200)' }}>
                Fetching device metrics...
              </Text>
            </div>
          </Bullseye>
        )}

        {!loading && hasNvidia && (
          <Card style={{ marginBottom: '16px' }}>
            <CardTitle>NVIDIA (DCGM)</CardTitle>
            <CardBody>
              <Grid hasGutter>
                {NVIDIA_DCGM_METRICS.map((m) => {
                  const metricData = nvidiaData[m.key];
                  return (
                    <GridItem key={m.key} md={2} sm={4}>
                      <MetricCard
                        label={m.label}
                        value={metricData?.latest_value ?? null}
                        unit={m.unit}
                        description={m.description}
                        timeSeries={metricData?.time_series}
                      />
                    </GridItem>
                  );
                })}
              </Grid>
            </CardBody>
          </Card>
        )}

        {!loading && hasIntel && (
          <Card style={{ marginBottom: '16px' }}>
            <CardTitle>Intel (habanalabs)</CardTitle>
            <CardBody>
              <Grid hasGutter>
                {INTEL_HABANALABS_METRICS.map((m) => {
                  const metricData = intelData[m.key];
                  return (
                    <GridItem key={m.key} md={2} sm={4}>
                      <MetricCard
                        label={m.label}
                        value={metricData?.latest_value ?? null}
                        unit={m.unit}
                        description={m.description}
                        timeSeries={metricData?.time_series}
                      />
                    </GridItem>
                  );
                })}
              </Grid>
            </CardBody>
          </Card>
        )}

        {!loading && !hasAnyData && (
          <Alert variant={AlertVariant.warning} title="No device metrics data" isInline>
            No device vendor metrics were detected.
            This page will show NVIDIA when `DCGM_*` is present and Intel when `habanalabs_*` is present.
          </Alert>
        )}
      </PageSection>
    </Page>
  );
};

export default DeviceMetricsPage;

