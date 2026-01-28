import * as React from 'react';
import Helmet from 'react-helmet';
import { useTranslation } from 'react-i18next';
import {
  Page,
  PageSection,
  Title,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Button,
  Alert,
  AlertVariant,
  AlertActionLink,
  Grid,
  GridItem,
  Spinner,
  Bullseye,
  Text,
  TextContent,
  TextVariants,
  Label,
  Card,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  SyncIcon,
  OutlinedLightbulbIcon,
  ClusterIcon,
  CubeIcon,
  ServerIcon,
  NetworkIcon,
  DatabaseIcon,
  CubesIcon,
  RunningIcon,
  ChartLineIcon,
  DownloadIcon,
} from '@patternfly/react-icons';
import { AlertList } from '../components/AlertList';
import { MetricChartModal } from '../components/MetricChartModal';
import {
  fetchOpenShiftMetrics,
  listOpenShiftNamespaces,
  getAlerts,
  analyzeOpenShift,
  getSessionConfig,
  type OpenShiftAnalysisResult,
  type AlertInfo,
} from '../services/mcpClient';
import { useSettings } from '../hooks/useSettings';

// Metric categories with icons - matching MCP server categories exactly
const CLUSTER_WIDE_CATEGORIES = {
  'Fleet Overview': {
    icon: ClusterIcon,
    description: 'Cluster-wide pod, deployment, and service metrics',
    metrics: [
      { key: 'Total Pods Running', label: 'Pods Running', unit: '', description: 'Currently running across cluster' },
      { key: 'Total Pods Failed', label: 'Pods Failed', unit: '', description: 'Pods requiring attention' },
      { key: 'Pods Pending', label: 'Pods Pending', unit: '', description: 'Waiting for scheduling' },
      { key: 'Total Deployments', label: 'Deployments', unit: '', description: 'Active across all namespaces' },
      { key: 'Cluster CPU Usage (%)', label: 'CPU %', unit: '%', description: 'Current cluster utilization' },
      { key: 'Cluster Memory Usage (%)', label: 'Memory %', unit: '%', description: 'Current cluster utilization' },
      { key: 'Total Services', label: 'Services', unit: '', description: 'LoadBalancer and ClusterIP' },
      { key: 'Total Nodes', label: 'Nodes', unit: '', description: 'Available cluster nodes' },
      { key: 'Total Namespaces', label: 'Namespaces', unit: '', description: 'Active project namespaces' },
    ]
  },
  'Jobs & Workloads': {
    icon: RunningIcon,
    description: 'Job execution and workload status',
    metrics: [
      { key: 'Jobs Running', label: 'Jobs Active', unit: '', description: 'Currently executing' },
      { key: 'Jobs Completed', label: 'Jobs Done', unit: '', description: 'Successfully finished' },
      { key: 'Jobs Failed', label: 'Jobs Failed', unit: '', description: 'Require investigation' },
      { key: 'CronJobs', label: 'CronJobs', unit: '', description: 'Scheduled job definitions' },
      { key: 'DaemonSets Ready', label: 'DaemonSets', unit: '', description: 'Running on all nodes' },
      { key: 'StatefulSets Ready', label: 'StatefulSets', unit: '', description: 'Persistent workloads ready' },
      { key: 'ReplicaSets Ready', label: 'ReplicaSets', unit: '', description: 'Scalable workloads ready' },
    ]
  },
  'Storage & Config': {
    icon: DatabaseIcon,
    description: 'Storage volumes and configuration resources',
    metrics: [
      { key: 'Persistent Volumes', label: 'PVs', unit: '', description: 'Available storage volumes' },
      { key: 'PV Claims', label: 'PVCs', unit: '', description: 'Storage requests by pods' },
      { key: 'PVC Bound', label: 'PVC Bound', unit: '', description: 'Successfully attached' },
      { key: 'PVC Pending', label: 'PVC Pending', unit: '', description: 'Waiting for provisioning' },
      { key: 'ConfigMaps', label: 'ConfigMaps', unit: '', description: 'Non-secret configuration' },
      { key: 'Secrets', label: 'Secrets', unit: '', description: 'Encrypted configuration' },
      { key: 'Storage Classes', label: 'StorageClasses', unit: '', description: 'Storage tier definitions' },
    ]
  },
  'Node Metrics': {
    icon: ServerIcon,
    description: 'Node-level resource and health metrics',
    metrics: [
      { key: 'Node CPU Usage (%)', label: 'CPU %', unit: '%', description: 'Average across all nodes' },
      { key: 'Node Memory Available (GB)', label: 'Mem Avail', unit: 'GB', description: 'Free memory across nodes' },
      { key: 'Node Memory Total (GB)', label: 'Mem Total', unit: 'GB', description: 'Cluster memory capacity' },
      { key: 'Node Disk Reads', label: 'Disk Reads', unit: '/s', description: 'Read operations per second' },
      { key: 'Node Disk Writes', label: 'Disk Writes', unit: '/s', description: 'Write operations per second' },
      { key: 'Nodes Ready', label: 'Ready', unit: '', description: 'Available for workloads' },
      { key: 'Nodes Not Ready', label: 'Not Ready', unit: '', description: 'Require investigation' },
      { key: 'Memory Pressure', label: 'MemPressure', unit: '', description: 'Low memory warnings' },
      { key: 'Disk Pressure', label: 'DiskPressure', unit: '', description: 'Low disk space warnings' },
      { key: 'PID Pressure', label: 'PIDPressure', unit: '', description: 'Process limit warnings' },
    ]
  },
  'GPU & Accelerators': {
    icon: CubesIcon,
    description: 'GPU and accelerator metrics (NVIDIA/Intel Gaudi)',
    metrics: [
      { key: 'GPU Temperature (°C)', label: 'Temp', unit: '°C', description: 'Average GPU core temp' },
      { key: 'GPU Power Usage (W)', label: 'Power', unit: 'W', description: 'Current power consumption' },
      { key: 'GPU Utilization (%)', label: 'Util %', unit: '%', description: 'Compute utilization' },
      { key: 'GPU Memory Used (GB)', label: 'Mem Used', unit: 'GB', description: 'VRAM currently allocated' },
      { key: 'GPU Count', label: 'GPU Count', unit: '', description: 'Available accelerators' },
      { key: 'GPU Memory Temp (°C)', label: 'Mem Temp', unit: '°C', description: 'VRAM temperature' },
    ]
  },
  'Autoscaling & Scheduling': {
    icon: NetworkIcon,
    description: 'Autoscaling and pod scheduling metrics',
    metrics: [
      { key: 'Pending Pods', label: 'Pending', unit: '', description: 'Awaiting node placement' },
      { key: 'Scheduler Latency (s)', label: 'Sched Latency', unit: 's', description: '99th percentile delay' },
      { key: 'CPU Requests Total', label: 'CPU Req', unit: 'cores', description: 'Reserved CPU across pods' },
      { key: 'CPU Limits Total', label: 'CPU Lim', unit: 'cores', description: 'Maximum CPU allowed' },
      { key: 'Memory Requests (GB)', label: 'Mem Req', unit: 'GB', description: 'Reserved memory across pods' },
      { key: 'Memory Limits (GB)', label: 'Mem Lim', unit: 'GB', description: 'Maximum memory allowed' },
      { key: 'HPA Active', label: 'HPA Current', unit: '', description: 'Auto-scaled replicas' },
      { key: 'HPA Desired', label: 'HPA Desired', unit: '', description: 'Target replica count' },
    ]
  },
};

const NAMESPACE_SCOPED_CATEGORIES = {
  'Pod & Container Metrics': {
    icon: CubesIcon,
    description: 'Pod and container resource usage',
    metrics: [
      { key: 'Pod CPU Usage (cores)', label: 'CPU', unit: 'cores', description: 'Current namespace usage' },
      { key: 'CPU Throttled (%)', label: 'Throttled', unit: '%', description: 'Containers hitting limits' },
      { key: 'Pod Memory (GB)', label: 'Memory', unit: 'GB', description: 'Active memory usage' },
      { key: 'RSS Memory (GB)', label: 'RSS', unit: 'GB', description: 'Physical memory used' },
      { key: 'Container Restarts', label: 'Restarts', unit: '', description: 'Container restart count' },
      { key: 'Pods Ready', label: 'Ready', unit: '', description: 'Running in namespace' },
      { key: 'Pods Not Ready', label: 'Not Ready', unit: '', description: 'Need investigation' },
      { key: 'Container OOM Killed', label: 'OOM Killed', unit: '', description: 'Memory limit exceeded' },
    ]
  },
  'Network Metrics': {
    icon: NetworkIcon,
    description: 'Pod network I/O metrics',
    metrics: [
      { key: 'Network RX (MB/s)', label: 'RX', unit: 'MB/s', description: 'Incoming data rate' },
      { key: 'Network TX (MB/s)', label: 'TX', unit: 'MB/s', description: 'Outgoing data rate' },
      { key: 'Network RX Packets', label: 'RX Pkts', unit: '/s', description: 'Incoming packets per sec' },
      { key: 'Network TX Packets', label: 'TX Pkts', unit: '/s', description: 'Outgoing packets per sec' },
      { key: 'Network RX Errors', label: 'RX Errors', unit: '/s', description: 'Incoming error rate' },
      { key: 'Network TX Errors', label: 'TX Errors', unit: '/s', description: 'Outgoing error rate' },
      { key: 'Network RX Dropped', label: 'RX Dropped', unit: '/s', description: 'Incoming packets dropped' },
      { key: 'Network TX Dropped', label: 'TX Dropped', unit: '/s', description: 'Outgoing packets dropped' },
    ]
  },
  'Storage I/O': {
    icon: DatabaseIcon,
    description: 'Storage and filesystem metrics',
    metrics: [
      { key: 'Disk Read (MB/s)', label: 'Read', unit: 'MB/s', description: 'Storage read throughput' },
      { key: 'Disk Write (MB/s)', label: 'Write', unit: 'MB/s', description: 'Storage write throughput' },
      { key: 'Disk Read IOPS', label: 'Read IOPS', unit: '/s', description: 'Read operations per sec' },
      { key: 'Disk Write IOPS', label: 'Write IOPS', unit: '/s', description: 'Write operations per sec' },
      { key: 'Filesystem Usage (GB)', label: 'FS Used', unit: 'GB', description: 'Container filesystem used' },
      { key: 'Filesystem Limit (GB)', label: 'FS Limit', unit: 'GB', description: 'Container filesystem cap' },
      { key: 'PVC Used (GB)', label: 'PVC Used', unit: 'GB', description: 'Persistent storage used' },
      { key: 'PVC Capacity (GB)', label: 'PVC Cap', unit: 'GB', description: 'Persistent storage limit' },
    ]
  },
  'Services & Networking': {
    icon: ServerIcon,
    description: 'Services and ingress metrics',
    metrics: [
      { key: 'Services Running', label: 'Services', unit: '', description: 'Active in namespace' },
      { key: 'Service Endpoints', label: 'Endpoints', unit: '', description: 'Backend pod targets' },
      { key: 'Ingress Rules', label: 'Ingresses', unit: '', description: 'HTTP routing rules' },
      { key: 'Network Policies', label: 'NetPolicies', unit: '', description: 'Traffic access controls' },
      { key: 'Load Balancer Services', label: 'LB Svcs', unit: '', description: 'External load balancers' },
      { key: 'ClusterIP Services', label: 'ClusterIP', unit: '', description: 'Internal cluster services' },
    ]
  },
  'Application Services': {
    icon: RunningIcon,
    description: 'Application-level metrics',
    metrics: [
      { key: 'HTTP Request Rate', label: 'Req/s', unit: '/s', description: 'HTTP request rate' },
      { key: 'HTTP Error Rate (%)', label: 'Error %', unit: '%', description: 'HTTP error rate' },
      { key: 'HTTP P95 Latency (s)', label: 'P95', unit: 's', description: 'P95 latency' },
      { key: 'HTTP P99 Latency (s)', label: 'P99', unit: 's', description: 'P99 latency' },
      { key: 'Active Connections', label: 'Connections', unit: '', description: 'Active connections' },
      { key: 'Ingress Request Rate', label: 'Ingress Req', unit: '/s', description: 'Ingress request rate' },
    ]
  },
};

const TIME_RANGE_OPTIONS = [
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

type ScopeType = 'cluster_wide' | 'namespace_scoped';

// Time series data point
interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

// Metric Card Component with Sparkline
interface MetricCardProps {
  label: string;
  value: number | null;
  unit?: string;
  description?: string;
  timeSeries?: TimeSeriesPoint[];
  metricKey: string;
  onViewChart?: (metricKey: string) => void;
  icon?: React.ComponentType;
  secondaryInfo?: React.ReactNode; // For custom secondary metrics (e.g., GPU utilization/temperature)
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, unit, description, timeSeries, metricKey, onViewChart, icon, secondaryInfo }) => {
  const formatValue = (val: number | null): string => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    if (val >= 1000000000) return `${(val / 1000000000).toFixed(2)}B`;
    if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    if (val < 0.01 && val > 0) return val.toExponential(2);
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(2);
  };

  // Calculate trend from time series
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

  // Simple SVG sparkline
  const renderSparkline = () => {
    if (!timeSeries || timeSeries.length < 2) return null;
    
    const values = timeSeries.map(p => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    const width = 60;
    const height = 20;
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
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

  // Calculate average from time series data
  const calculateAverage = (timeSeries?: TimeSeriesPoint[]): number | null => {
    if (!timeSeries || timeSeries.length === 0) return null;
    const sum = timeSeries.reduce((acc, pt) => acc + pt.value, 0);
    return sum / timeSeries.length;
  };

  const displayValue = formatValue(value);
  const avgValue = calculateAverage(timeSeries);
  const isZero = value === 0;
  const isNull = value === null;

  return (
    <Card isCompact style={{ height: '100%' }}>
      <CardBody style={{ padding: '12px' }}>
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsFlexStart' }}>
          <FlexItem flex={{ default: 'flex_1' }}>
            <TextContent>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: '4px' }}>
                {label}
              </Text>
            </TextContent>
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <div>
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
                  {avgValue !== null && (
                    <Text
                      component={TextVariants.small}
                      style={{
                        color: '#666',
                        fontSize: '0.85rem',
                        display: 'block',
                        marginTop: '2px'
                      }}
                    >
                      Avg: {formatValue(avgValue)}{unit ? ` ${unit}` : ''}
                    </Text>
                  )}
                  {secondaryInfo && avgValue === null && (
                    <div style={{ marginTop: '2px' }}>
                      {secondaryInfo}
                    </div>
                  )}
                </div>
              </FlexItem>
              <FlexItem>
                {renderSparkline() || <div style={{ width: '60px', height: '20px' }} />}
              </FlexItem>
              {icon && (
                <FlexItem>
                  {React.createElement(icon, { 
                    style: { 
                      color: 'var(--pf-v5-global--primary-color--100)', 
                      fontSize: '20px', 
                      marginLeft: '8px' 
                    } 
                  })}
                </FlexItem>
              )}
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
          </FlexItem>
          {timeSeries && timeSeries.length > 0 && onViewChart && (
            <FlexItem>
              <Button
                variant="secondary"
                size="sm"
                aria-label="View full chart"
                onClick={() => onViewChart(metricKey)}
              >
                <ChartLineIcon />
              </Button>
            </FlexItem>
          )}
        </Flex>
      </CardBody>
    </Card>
  );
};

// Metric data with time series
interface MetricDataValue {
  latest_value: number | null;
  time_series?: TimeSeriesPoint[];
}

// GPU Fleet Summary Component
interface GPUFleetSummaryProps {
  metricsData: Record<string, MetricDataValue>;
}

const GPUFleetSummary: React.FC<GPUFleetSummaryProps> = ({ metricsData }) => {
  // Calculate fleet-wide GPU statistics
  const totalGPUs = metricsData['GPU Count']?.latest_value || 0;
  const avgUtil = (() => {
    const utilSeries = metricsData['GPU Utilization (%)']?.time_series;
    if (!utilSeries || utilSeries.length === 0) return null;
    const sum = utilSeries.reduce((acc, pt) => acc + pt.value, 0);
    return sum / utilSeries.length;
  })();
  
  const avgTemp = (() => {
    const tempSeries = metricsData['GPU Temperature (°C)']?.time_series;
    if (!tempSeries || tempSeries.length === 0) return null;
    const sum = tempSeries.reduce((acc, pt) => acc + pt.value, 0);
    return sum / tempSeries.length;
  })();
  
  const totalPower = metricsData['GPU Power Usage (W)']?.latest_value || 0;
  
  // Health alerts based on thresholds
  const hotGPUs = avgTemp && avgTemp > 80 ? Math.ceil(totalGPUs * 0.2) : 0; // Estimate based on temp
  const overloadedGPUs = avgUtil && avgUtil > 95 ? Math.ceil(totalGPUs * 0.1) : 0; // Estimate
  
  const formatValue = (val: number | null, decimals: number = 1): string => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    return val.toFixed(decimals);
  };

  return (
    <Card style={{ marginBottom: '16px', background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', border: '1px solid #0891b2' }}>
      <CardTitle>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <CubesIcon style={{ color: '#0891b2', marginRight: '8px' }} />
            GPU Fleet Overview
          </FlexItem>
          <FlexItem align={{ default: 'alignRight' }}>
            <Text component={TextVariants.small} style={{ color: '#0891b2', fontWeight: 600 }}>
              Cluster-wide Summary
            </Text>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Grid hasGutter>
          <GridItem sm={6} md={3}>
            <div style={{ textAlign: 'center', padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <Text component={TextVariants.small} style={{ color: '#666', display: 'block', marginBottom: '4px' }}>
                Total GPUs
              </Text>
              <Text component={TextVariants.h2} style={{ color: '#0891b2', fontWeight: 700 }}>
                {totalGPUs}
              </Text>
              <Text component={TextVariants.small} style={{ color: '#666' }}>
                accelerators
              </Text>
            </div>
          </GridItem>
          
          <GridItem sm={6} md={3}>
            <div style={{ textAlign: 'center', padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <Text component={TextVariants.small} style={{ color: '#666', display: 'block', marginBottom: '4px' }}>
                Avg Utilization
              </Text>
              <Text component={TextVariants.h2} style={{ 
                color: avgUtil && avgUtil > 90 ? '#dc2626' : avgUtil && avgUtil > 70 ? '#ea580c' : '#059669',
                fontWeight: 700 
              }}>
                {formatValue(avgUtil)}%
              </Text>
              <Text component={TextVariants.small} style={{ color: '#666' }}>
                compute usage
              </Text>
            </div>
          </GridItem>
          
          <GridItem sm={6} md={3}>
            <div style={{ textAlign: 'center', padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <Text component={TextVariants.small} style={{ color: '#666', display: 'block', marginBottom: '4px' }}>
                Avg Temperature
              </Text>
              <Text component={TextVariants.h2} style={{ 
                color: avgTemp && avgTemp > 85 ? '#dc2626' : avgTemp && avgTemp > 75 ? '#ea580c' : '#059669',
                fontWeight: 700 
              }}>
                {formatValue(avgTemp, 0)}°C
              </Text>
              <Text component={TextVariants.small} style={{ color: '#666' }}>
                thermal status
              </Text>
            </div>
          </GridItem>
          
          <GridItem sm={6} md={3}>
            <div style={{ textAlign: 'center', padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <Text component={TextVariants.small} style={{ color: '#666', display: 'block', marginBottom: '4px' }}>
                Fleet Power
              </Text>
              <Text component={TextVariants.h2} style={{ color: '#0891b2', fontWeight: 700 }}>
                {formatValue(totalPower, 0)}W
              </Text>
              <Text component={TextVariants.small} style={{ color: '#666' }}>
                total consumption
              </Text>
            </div>
          </GridItem>
        </Grid>
        
        {/* Health Status */}
        {(hotGPUs > 0 || overloadedGPUs > 0) && (
          <div style={{ marginTop: '16px', padding: '12px', background: '#fef3c7', borderRadius: '8px', border: '1px solid #f59e0b' }}>
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <Text component={TextVariants.small} style={{ color: '#92400e', fontWeight: 600 }}>
                  ⚠️ Fleet Health Alerts:
                </Text>
              </FlexItem>
              {hotGPUs > 0 && (
                <FlexItem style={{ marginLeft: '12px' }}>
                  <Text component={TextVariants.small} style={{ color: '#92400e' }}>
                    {hotGPUs} GPUs running hot (&gt;80°C)
                  </Text>
                </FlexItem>
              )}
              {overloadedGPUs > 0 && (
                <FlexItem style={{ marginLeft: '12px' }}>
                  <Text component={TextVariants.small} style={{ color: '#92400e' }}>
                    {overloadedGPUs} GPUs overloaded (&gt;95%)
                  </Text>
                </FlexItem>
              )}
            </Flex>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

// Category Section Component
interface CategorySectionProps {
  categoryKey: string;
  categoryDef: {
    icon: React.ComponentType;
    description: string;
    metrics: Array<{ key: string; label: string; unit?: string; description?: string }>;
  };
  metricsData: Record<string, MetricDataValue>;
  onViewChart?: (metricKey: string) => void;
}

const CategorySection: React.FC<CategorySectionProps> = ({ categoryKey, categoryDef, metricsData, onViewChart }) => {
  const IconComponent = categoryDef.icon;

  // Check if GPUs are available for Fleet Overview category
  const gpuCount = metricsData['GPU Count']?.latest_value ?? 0;
  const hasGPUMetrics = 
    (metricsData['GPU Utilization (%)']?.latest_value !== null) ||
    (metricsData['GPU Temperature (°C)']?.latest_value !== null) ||
    (metricsData['GPU Power Usage (W)']?.latest_value !== null) ||
    (metricsData['GPU Memory Used (GB)']?.latest_value !== null);
  
  const hasGPUs = categoryKey === 'Fleet Overview' && (gpuCount > 0 || hasGPUMetrics);

  // Create GPU summary data for Fleet Overview  
  // Use GPU Count if available and > 0, otherwise try to estimate from power consumption
  let estimatedCount = gpuCount;
  if (estimatedCount === 0 && hasGPUMetrics) {
    // Try to estimate based on total power (assuming ~250W per GPU average)
    const totalPower = metricsData['GPU Power Usage (W)']?.latest_value ?? 0;
    if (totalPower > 0) {
      estimatedCount = Math.max(1, Math.round(totalPower / 250));
    } else {
      // Fallback: if we have GPU metrics but no power data, assume at least 1 GPU
      estimatedCount = 1;
    }
  }
  const gpuSummaryData = hasGPUs ? {
    count: estimatedCount,
    utilization: metricsData['GPU Utilization (%)']?.latest_value ?? null,
    temperature: metricsData['GPU Temperature (°C)']?.latest_value ?? null,
    power: metricsData['GPU Power Usage (W)']?.latest_value ?? null,
  } : null;

  const formatValue = (val: number | null): string => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    return val.toString();
  };

  return (
    <Card style={{ marginBottom: '16px' }}>
      <CardTitle>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <span style={{ marginRight: '8px', color: 'var(--pf-v5-global--primary-color--100)' }}>
              <IconComponent />
            </span>
            {categoryKey}
          </FlexItem>
          <FlexItem>
            <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginLeft: '8px' }}>
              {categoryDef.description}
            </Text>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Grid hasGutter>
          {/* Regular metrics */}
          {categoryDef.metrics.map((metric) => {
            const metricData = metricsData[metric.key];
            return (
              <GridItem key={metric.key} md={2} sm={4}>
                <MetricCard
                  label={metric.label}
                  value={metricData?.latest_value ?? null}
                  unit={metric.unit}
                  description={metric.description}
                  timeSeries={metricData?.time_series}
                  metricKey={metric.key}
                  onViewChart={onViewChart}
                />
              </GridItem>
            );
          })}
          
          {/* Conditional GPU Summary Card for Fleet Overview */}
          {hasGPUs && gpuSummaryData && (
            <GridItem key="gpu-summary" md={2} sm={4}>
              <MetricCard
                label="GPU Fleet"
                value={gpuSummaryData.count}
                unit="GPUs"
                description={gpuCount > 0 ? 'AI/ML accelerators available' : 'GPU metrics detected'}
                metricKey="gpu-fleet-summary"
                icon={CubesIcon}
                secondaryInfo={
                  <>
                    {gpuSummaryData.utilization !== null && (
                      <Text
                        component={TextVariants.small}
                        style={{
                          color: gpuSummaryData.utilization > 90 ? '#dc2626' :
                                 gpuSummaryData.utilization > 70 ? '#ea580c' : '#666',
                          fontSize: '0.85rem',
                          display: 'block',
                          marginTop: '2px'
                        }}
                      >
                        Util: {formatValue(gpuSummaryData.utilization)}%
                      </Text>
                    )}
                    {gpuSummaryData.temperature !== null && (
                      <Text
                        component={TextVariants.small}
                        style={{
                          color: gpuSummaryData.temperature > 85 ? '#dc2626' :
                                 gpuSummaryData.temperature > 75 ? '#ea580c' : '#666',
                          fontSize: '0.85rem',
                          display: 'block',
                          marginTop: '2px'
                        }}
                      >
                        Temp: {formatValue(gpuSummaryData.temperature)}°C
                      </Text>
                    )}
                  </>
                }
              />
            </GridItem>
          )}
        </Grid>
      </CardBody>
    </Card>
  );
};

export const OpenShiftMetricsPage: React.FC = () => {
  const { t } = useTranslation('plugin__openshift-ai-observability');
  const { handleOpenSettings, useAIConfigWarningDismissal, AI_CONFIG_WARNING } = useSettings();

  // Scope and filters
  const [scope, setScope] = React.useState<ScopeType>('cluster_wide');
  const [namespaces, setNamespaces] = React.useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = React.useState<string>('');
  const [selectedCategory, setSelectedCategory] = React.useState<string>('Fleet Overview');
  const [timeRange, setTimeRange] = React.useState<string>('1h');

  // Data
  const [metricsData, setMetricsData] = React.useState<Record<string, MetricDataValue>>({});
  const [alerts, setAlerts] = React.useState<AlertInfo[]>([]);
  const [analysis, setAnalysis] = React.useState<OpenShiftAnalysisResult | null>(null);

  // Chart modal state
  const [selectedMetricForChart, setSelectedMetricForChart] = React.useState<string | null>(null);

  // Loading states
  const [loadingNamespaces, setLoadingNamespaces] = React.useState(true);
  const [loadingMetrics, setLoadingMetrics] = React.useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = React.useState(false);

  const [error, setError] = React.useState<string | null>(null);
  const [errorType, setErrorType] = React.useState<string | null>(null);

  // Auto-dismiss AI configuration warnings when settings are closed
  useAIConfigWarningDismissal(errorType, setError, setErrorType);

  // Get categories based on scope
  const categories = scope === 'cluster_wide' ? CLUSTER_WIDE_CATEGORIES : NAMESPACE_SCOPED_CATEGORIES;
  const categoryNames = Object.keys(categories);

  React.useEffect(() => {
    const loadNamespaces = async () => {
      setLoadingNamespaces(true);
      try {
        const data = await listOpenShiftNamespaces();
        setNamespaces(data);
        if (data.length > 0) {
          setSelectedNamespace(data[0]);
        }
      } catch (err) {
        console.error('[OpenShift] Failed to load namespaces:', err);
        setError(err instanceof Error ? err.message : 'Failed to load namespaces');
      } finally {
        setLoadingNamespaces(false);
      }
    };
    loadNamespaces();
  }, []);

  // Update category when scope changes
  React.useEffect(() => {
    const newCategories = Object.keys(scope === 'cluster_wide' ? CLUSTER_WIDE_CATEGORIES : NAMESPACE_SCOPED_CATEGORIES);
    if (!newCategories.includes(selectedCategory)) {
      setSelectedCategory(newCategories[0]);
    }
  }, [scope, selectedCategory]);

  const loadMetrics = React.useCallback(async () => {
    setLoadingMetrics(true);
    setError(null);
    try {
      const namespace = scope === 'namespace_scoped' ? selectedNamespace : undefined;
      
      const [metricsResponse, alertsData] = await Promise.all([
        fetchOpenShiftMetrics(selectedCategory, scope, timeRange, namespace),
        getAlerts(namespace),
      ]);
      
      if (metricsResponse) {
        setMetricsData(metricsResponse.metrics || {});
      } else {
        setMetricsData({});
      }
      setAlerts(alertsData);
    } catch (err) {
      console.error('[OpenShift] Failed to load metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
      setMetricsData({});
    } finally {
      setLoadingMetrics(false);
    }
  }, [scope, selectedNamespace, selectedCategory, timeRange]);

  // Load metrics when filters change
  React.useEffect(() => {
    if (scope === 'namespace_scoped' && !selectedNamespace) return;
    loadMetrics();
  }, [scope, selectedNamespace, loadMetrics]);

  const handleAnalyze = async () => {
    setLoadingAnalysis(true);
    setAnalysis(null);
    setError(null);
    setErrorType(null);
    
    try {
      // Check configuration at the moment of click
      const config = getSessionConfig();
      
      if (!config.ai_model) {
        setError('Please configure an AI model in Settings first');
        setErrorType(AI_CONFIG_WARNING);
        setLoadingAnalysis(false);
        return;
      }
      // Let MCP server resolve provider secret if api_key is not present in session
      const apiKey = (config.api_key as string | undefined) || undefined;
      
      const result = await analyzeOpenShift(
        selectedCategory,
        scope,
        scope === 'namespace_scoped' ? selectedNamespace : undefined,
        config.ai_model,
        apiKey,
        timeRange
      );
      
      if (result && result.summary) {
        setAnalysis(result);
      } else {
        setError('Analysis returned empty response. Check browser console for details.');
      }
    } catch (err) {
      console.error('[OpenShift] Analysis failed:', err);
      setError(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const handleScopeChange = (newScope: ScopeType) => {
    setScope(newScope);
    setAnalysis(null);
    setMetricsData({});
  };

  const handleViewChart = (metricKey: string) => {
    setSelectedMetricForChart(metricKey);
  };

  const handleCloseChart = () => {
    setSelectedMetricForChart(null);
  };

  // Prepare metric data for chart modal
  const selectedMetricData = React.useMemo(() => {
    if (!selectedMetricForChart) return null;
    
    const categories = scope === 'cluster_wide' ? CLUSTER_WIDE_CATEGORIES : NAMESPACE_SCOPED_CATEGORIES;
    let metricDef = null;

    for (const [, categoryDef] of Object.entries(categories)) {
      const found = categoryDef.metrics.find(m => m.key === selectedMetricForChart);
      if (found) {
        metricDef = found;
        break;
      }
    }

    const metricData = metricsData[selectedMetricForChart];

    if (metricDef && metricData) {
      return {
        key: selectedMetricForChart,
        label: metricDef.label,
        unit: metricDef.unit,
        description: metricDef.description,
        timeSeries: metricData.time_series || [],
      };
    }
    return null;
  }, [selectedMetricForChart, metricsData, scope]);

  const downloadMarkdown = () => {
    try {
      const timestamp = new Date().toISOString();
      const timeRangeLabel = TIME_RANGE_OPTIONS.find(o => o.value === timeRange)?.label || timeRange;

      const content = `# OpenShift Metrics Report

**Category**: ${selectedCategory}
**Scope**: ${scope === 'cluster_wide' ? 'Cluster-wide' : selectedNamespace}
**Time Range**: ${timeRangeLabel}
**Generated**: ${timestamp}

## Metrics Summary

${Object.entries(metricsData).map(([key, val]) => {
  const categoryDef = categories[selectedCategory as keyof typeof categories];
  const metricDef = categoryDef?.metrics.find(m => m.key === key);
  const unit = metricDef?.unit || '';
  return `- **${key}**: ${val.latest_value !== null ? `${val.latest_value}${unit ? ` ${unit}` : ''}` : 'N/A'}`;
}).join('\n')}

## AI Analysis

${analysis?.summary || 'No analysis available. Click "Analyze with AI" to generate insights.'}

---
*Generated by OpenShift AI Observability Plugin*
`;

      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openshift-metrics-${selectedCategory.replace(/\s+/g, '_')}-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download markdown report:', error);
      setError('Failed to download report. Please try again.');
    }
  };

  const downloadCSV = () => {
    try {
      const categoryDef = categories[selectedCategory as keyof typeof categories];
      const headers = ['Metric', 'Latest Value', 'Unit', 'Description'];
      const rows = categoryDef?.metrics.map((metricDef) => {
        const metricData = metricsData[metricDef.key];
        return [
          metricDef.key,
          metricData?.latest_value?.toString() || 'N/A',
          metricDef.unit || '',
          metricDef.description || ''
        ];
      }) || [];

      const csv = [headers, ...rows].map(row => row.map(cell => {
        // Escape double quotes and wrap in quotes if contains comma
        const escaped = cell.replace(/"/g, '""');
        return escaped.includes(',') ? `"${escaped}"` : escaped;
      }).join(',')).join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openshift-metrics-${selectedCategory.replace(/\s+/g, '_')}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download CSV:', error);
      setError('Failed to download CSV. Please try again.');
    }
  };

  if (loadingNamespaces) {
    return (
      <Page>
        <PageSection>
          <Bullseye style={{ minHeight: '300px' }}>
            <div style={{ textAlign: 'center' }}>
              <Spinner size="xl" />
              <Text component={TextVariants.p} style={{ marginTop: '16px', color: 'var(--pf-v5-global--Color--200)' }}>
                Loading namespaces...
              </Text>
            </div>
          </Bullseye>
        </PageSection>
      </Page>
    );
  }

  const currentCategoryDef = categories[selectedCategory as keyof typeof categories];

  return (
    <>
      <Helmet>
        <title>{t('OpenShift Metrics - AI Observability')}</title>
      </Helmet>
      
      {/* Header */}
      <PageSection variant="light" style={{ 
        background: 'linear-gradient(135deg, #1a365d 0%, #2c5282 50%, #2b6cb0 100%)',
        color: 'white',
        paddingBottom: '24px',
      }}>
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1" style={{ color: 'white' }}>
              <ClusterIcon style={{ marginRight: '12px' }} />
              {t('OpenShift Metrics')}
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.8)', marginTop: '8px' }}>
              Monitor cluster and namespace-level resources and workloads
            </Text>
          </FlexItem>
          <FlexItem>
            {/* Scope Toggle */}
            <ToggleGroup aria-label="Analysis Scope">
              <ToggleGroupItem
                text="Cluster-wide"
                buttonId="cluster-wide"
                isSelected={scope === 'cluster_wide'}
                onChange={() => handleScopeChange('cluster_wide')}
                icon={<ClusterIcon />}
              />
              <ToggleGroupItem
                text="Namespace"
                buttonId="namespace-scoped"
                isSelected={scope === 'namespace_scoped'}
                onChange={() => handleScopeChange('namespace_scoped')}
                icon={<CubeIcon />}
              />
            </ToggleGroup>
          </FlexItem>
        </Flex>
      </PageSection>

      {/* Filters Toolbar */}
      <PageSection variant="light" style={{ paddingTop: '16px', paddingBottom: '16px' }}>
        <Toolbar>
          <ToolbarContent>
            {/* Namespace Selector (only for namespace scope) */}
            <ToolbarItem>
              <FormGroup label="Namespace" fieldId="namespace-select">
                <FormSelect
                  id="namespace-select"
                  value={selectedNamespace}
                  onChange={(_event, value) => setSelectedNamespace(value)}
                  aria-label="Select namespace"
                  isDisabled={scope === 'cluster_wide'}
                  style={{ minWidth: '200px' }}
                >
                  {scope === 'cluster_wide' ? (
                    <FormSelectOption value="" label="All Namespaces (Cluster-wide)" />
                  ) : namespaces.length === 0 ? (
                    <FormSelectOption value="" label="No namespaces available" isDisabled />
                  ) : (
                    namespaces.map((ns) => (
                      <FormSelectOption key={ns} value={ns} label={ns} />
                    ))
                  )}
                </FormSelect>
              </FormGroup>
            </ToolbarItem>

            {/* Category Selector */}
            <ToolbarItem>
              <FormGroup label="Metric Category" fieldId="category-select">
                <FormSelect
                  id="category-select"
                  value={selectedCategory}
                  onChange={(_event, value) => setSelectedCategory(value)}
                  aria-label="Select category"
                  style={{ minWidth: '180px' }}
                >
                  {categoryNames.map((cat) => (
                    <FormSelectOption key={cat} value={cat} label={cat} />
                  ))}
                </FormSelect>
              </FormGroup>
            </ToolbarItem>

            {/* Time Range Selector */}
            <ToolbarItem>
              <FormGroup label="Time Range" fieldId="time-range-select">
                <FormSelect
                  id="time-range-select"
                  value={timeRange}
                  onChange={(_event, value) => setTimeRange(value)}
                  aria-label="Select time range"
                  style={{ minWidth: '120px' }}
                >
                  {TIME_RANGE_OPTIONS.map((opt) => (
                    <FormSelectOption key={opt.value} value={opt.value} label={opt.label} />
                  ))}
                </FormSelect>
              </FormGroup>
            </ToolbarItem>

            {/* Action Buttons */}
            <ToolbarItem align={{ default: 'alignRight' }}>
              <Flex>
                <FlexItem>
                  <Button
                    variant="secondary"
                    icon={<SyncIcon />}
                    onClick={loadMetrics}
                    isDisabled={loadingMetrics}
                    isLoading={loadingMetrics}
                  >
                    Refresh
                  </Button>
                </FlexItem>
                <FlexItem style={{ marginLeft: '8px' }}>
                  <Button
                    variant="secondary"
                    icon={<DownloadIcon />}
                    onClick={downloadMarkdown}
                    isDisabled={Object.keys(metricsData).length === 0}
                  >
                    Download Report
                  </Button>
                </FlexItem>
                <FlexItem style={{ marginLeft: '8px' }}>
                  <Button
                    variant="secondary"
                    icon={<DownloadIcon />}
                    onClick={downloadCSV}
                    isDisabled={Object.keys(metricsData).length === 0}
                  >
                    Download CSV
                  </Button>
                </FlexItem>
                <FlexItem style={{ marginLeft: '8px' }}>
                  <Button
                    variant="primary"
                    icon={<OutlinedLightbulbIcon />}
                    onClick={handleAnalyze}
                    isDisabled={loadingAnalysis || (scope === 'namespace_scoped' && !selectedNamespace)}
                    isLoading={loadingAnalysis}
                    style={{
                      background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                      border: 'none',
                    }}
                  >
                    Analyze with AI
                  </Button>
                </FlexItem>
              </Flex>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      {/* Scope Indicator */}
      {scope === 'cluster_wide' && (
        <PageSection style={{ paddingTop: 0, paddingBottom: '8px' }}>
          <Alert variant={AlertVariant.info} title="Fleet View" isInline isPlain>
            <NetworkIcon style={{ marginRight: '8px' }} />
            Analyzing metrics across the entire OpenShift cluster
          </Alert>
        </PageSection>
      )}

      {/* Error */}
      {error && (
        <PageSection style={{ paddingTop: '8px', paddingBottom: '8px' }}>
          {error.includes('Please configure an AI model in Settings first') ? (
            <Alert
              variant={AlertVariant.warning}
              title="Configuration Required"
              isInline
              actionLinks={<AlertActionLink onClick={handleOpenSettings}>Open Settings</AlertActionLink>}
              actionClose={<Button variant="plain" onClick={() => setError(null)}>✕</Button>}
            >
              {error}. Click "Open Settings" to configure your AI model.
            </Alert>
          ) : (
            <Alert 
              variant={AlertVariant.danger} 
              title="Error" 
              isInline
              actionClose={<Button variant="plain" onClick={() => setError(null)}>✕</Button>}
            >
              {error}
            </Alert>
          )}
        </PageSection>
      )}

      {/* AI Analysis Panel - Full width like vLLM page */}
      {(analysis || loadingAnalysis) && (
        <PageSection style={{ paddingTop: 0 }}>
          <Card style={{ background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)', border: '1px solid #c4b5fd' }}>
            <CardTitle>
              <Flex alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem>
                  <OutlinedLightbulbIcon style={{ color: '#7c3aed', marginRight: '8px' }} />
                  AI Analysis
                </FlexItem>
                <FlexItem align={{ default: 'alignRight' }}>
                  <Button variant="plain" onClick={() => setAnalysis(null)}>✕</Button>
                </FlexItem>
              </Flex>
            </CardTitle>
            <CardBody>
              {loadingAnalysis ? (
                <Bullseye style={{ minHeight: '100px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <Spinner size="lg" />
                    <Text component={TextVariants.p} style={{ marginTop: '12px', color: 'var(--pf-v5-global--Color--200)' }}>
                      Analyzing {selectedCategory}...
                    </Text>
                  </div>
                </Bullseye>
              ) : analysis ? (
                <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, lineHeight: 1.6 }}>
                  {analysis.summary}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </PageSection>
      )}

      {/* Main Content */}
      <PageSection>
        {/* Current Selection Labels */}
        <Flex style={{ marginBottom: '16px' }}>
          <FlexItem>
            <Label color="blue" icon={scope === 'cluster_wide' ? <ClusterIcon /> : <CubeIcon />}>
              {scope === 'cluster_wide' ? 'Cluster-wide' : selectedNamespace}
            </Label>
          </FlexItem>
          <FlexItem>
            <Label color="purple" icon={<ServerIcon />}>
              {selectedCategory}
            </Label>
          </FlexItem>
          <FlexItem>
            <Label color="grey">
              Last {TIME_RANGE_OPTIONS.find(o => o.value === timeRange)?.label}
            </Label>
          </FlexItem>
        </Flex>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <AlertList alerts={alerts} loading={loadingMetrics} />
          </div>
        )}

        {/* Loading */}
        {loadingMetrics && (
          <Bullseye style={{ minHeight: '200px' }}>
            <div style={{ textAlign: 'center' }}>
              <Spinner size="xl" />
              <Text component={TextVariants.p} style={{ marginTop: '16px', color: 'var(--pf-v5-global--Color--200)' }}>
                Fetching {selectedCategory} metrics...
              </Text>
            </div>
          </Bullseye>
        )}
        
        {/* GPU Fleet Summary - Only for GPU category + cluster-wide scope */}
        {!loadingMetrics && selectedCategory === 'GPU & Accelerators' && scope === 'cluster_wide' && Object.keys(metricsData).length > 0 && (
          <GPUFleetSummary metricsData={metricsData} />
        )}

        {/* Metrics Display */}
        {!loadingMetrics && currentCategoryDef && (
          <CategorySection
            categoryKey={selectedCategory}
            categoryDef={currentCategoryDef}
            metricsData={metricsData}
            onViewChart={handleViewChart}
          />
        )}

        {/* No data message */}
        {!loadingMetrics && Object.keys(metricsData).length === 0 && (
          <Alert variant={AlertVariant.warning} title="No metrics data" isInline>
            No metrics data available for {selectedCategory}. This may be expected if there are no resources in this category.
          </Alert>
        )}
      </PageSection>

      {/* Metric Chart Modal */}
      <MetricChartModal
        metric={selectedMetricData}
        isOpen={selectedMetricForChart !== null}
        onClose={handleCloseChart}
      />
    </>
  );
};

export default OpenShiftMetricsPage;
