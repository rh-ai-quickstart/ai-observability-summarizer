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
} from '@patternfly/react-icons';
import { AlertList } from '../components/AlertList';
import {
  fetchOpenShiftMetrics,
  listOpenShiftNamespaces,
  getAlerts,
  analyzeOpenShift,
  getSessionConfig,
  type OpenShiftAnalysisResult,
  type AlertInfo,
} from '../services/mcpClient';

// Metric categories with icons - matching MCP server categories exactly
const CLUSTER_WIDE_CATEGORIES = {
  'Fleet Overview': {
    icon: ClusterIcon,
    description: 'Cluster-wide pod, deployment, and service metrics',
    metrics: [
      { key: 'Total Pods Running', label: 'Pods Running', unit: '', description: 'Running pods' },
      { key: 'Total Pods Failed', label: 'Pods Failed', unit: '', description: 'Failed pods' },
      { key: 'Pods Pending', label: 'Pods Pending', unit: '', description: 'Pending pods' },
      { key: 'Total Deployments', label: 'Deployments', unit: '', description: 'Ready deployments' },
      { key: 'Cluster CPU Usage (%)', label: 'CPU %', unit: '%', description: 'Cluster CPU usage' },
      { key: 'Cluster Memory Usage (%)', label: 'Memory %', unit: '%', description: 'Cluster memory usage' },
      { key: 'Total Services', label: 'Services', unit: '', description: 'Total services' },
      { key: 'Total Nodes', label: 'Nodes', unit: '', description: 'Total nodes' },
      { key: 'Total Namespaces', label: 'Namespaces', unit: '', description: 'Active namespaces' },
    ]
  },
  'Jobs & Workloads': {
    icon: RunningIcon,
    description: 'Job execution and workload status',
    metrics: [
      { key: 'Jobs Running', label: 'Jobs Active', unit: '', description: 'Currently running jobs' },
      { key: 'Jobs Completed', label: 'Jobs Done', unit: '', description: 'Completed jobs' },
      { key: 'Jobs Failed', label: 'Jobs Failed', unit: '', description: 'Failed jobs' },
      { key: 'CronJobs', label: 'CronJobs', unit: '', description: 'CronJob count' },
      { key: 'DaemonSets Ready', label: 'DaemonSets', unit: '', description: 'Ready daemon sets' },
      { key: 'StatefulSets Ready', label: 'StatefulSets', unit: '', description: 'Ready stateful sets' },
      { key: 'ReplicaSets Ready', label: 'ReplicaSets', unit: '', description: 'Ready replica sets' },
    ]
  },
  'Storage & Config': {
    icon: DatabaseIcon,
    description: 'Storage volumes and configuration resources',
    metrics: [
      { key: 'Persistent Volumes', label: 'PVs', unit: '', description: 'Persistent volumes' },
      { key: 'PV Claims', label: 'PVCs', unit: '', description: 'Persistent volume claims' },
      { key: 'PVC Bound', label: 'PVC Bound', unit: '', description: 'Bound PVCs' },
      { key: 'PVC Pending', label: 'PVC Pending', unit: '', description: 'Pending PVCs' },
      { key: 'ConfigMaps', label: 'ConfigMaps', unit: '', description: 'Configuration maps' },
      { key: 'Secrets', label: 'Secrets', unit: '', description: 'Secret objects' },
      { key: 'Storage Classes', label: 'StorageClasses', unit: '', description: 'Storage class count' },
    ]
  },
  'Node Metrics': {
    icon: ServerIcon,
    description: 'Node-level resource and health metrics',
    metrics: [
      { key: 'Node CPU Usage (%)', label: 'CPU %', unit: '%', description: 'Node CPU usage' },
      { key: 'Node Memory Available (GB)', label: 'Mem Avail', unit: 'GB', description: 'Available memory' },
      { key: 'Node Memory Total (GB)', label: 'Mem Total', unit: 'GB', description: 'Total memory' },
      { key: 'Node Disk Reads', label: 'Disk Reads', unit: '/s', description: 'Disk read IOPS' },
      { key: 'Node Disk Writes', label: 'Disk Writes', unit: '/s', description: 'Disk write IOPS' },
      { key: 'Nodes Ready', label: 'Ready', unit: '', description: 'Nodes in Ready state' },
      { key: 'Nodes Not Ready', label: 'Not Ready', unit: '', description: 'Nodes not ready' },
      { key: 'Memory Pressure', label: 'MemPressure', unit: '', description: 'Nodes with memory pressure' },
      { key: 'Disk Pressure', label: 'DiskPressure', unit: '', description: 'Nodes with disk pressure' },
      { key: 'PID Pressure', label: 'PIDPressure', unit: '', description: 'Nodes with PID pressure' },
    ]
  },
  'GPU & Accelerators': {
    icon: CubesIcon,
    description: 'GPU and accelerator metrics (NVIDIA/Intel Gaudi)',
    metrics: [
      { key: 'GPU Temperature (°C)', label: 'Temp', unit: '°C', description: 'GPU temperature' },
      { key: 'GPU Power Usage (W)', label: 'Power', unit: 'W', description: 'GPU power usage' },
      { key: 'GPU Utilization (%)', label: 'Util %', unit: '%', description: 'GPU utilization' },
      { key: 'GPU Memory Used (GB)', label: 'Mem Used', unit: 'GB', description: 'GPU memory used' },
      { key: 'GPU Count', label: 'GPU Count', unit: '', description: 'Total GPUs' },
      { key: 'GPU Memory Temp (°C)', label: 'Mem Temp', unit: '°C', description: 'GPU memory temperature' },
    ]
  },
  'Autoscaling & Scheduling': {
    icon: NetworkIcon,
    description: 'Autoscaling and pod scheduling metrics',
    metrics: [
      { key: 'Pending Pods', label: 'Pending', unit: '', description: 'Pods waiting to schedule' },
      { key: 'Scheduler Latency (s)', label: 'Sched Latency', unit: 's', description: 'P99 scheduling latency' },
      { key: 'CPU Requests Total', label: 'CPU Req', unit: 'cores', description: 'Total CPU requested' },
      { key: 'CPU Limits Total', label: 'CPU Lim', unit: 'cores', description: 'Total CPU limits' },
      { key: 'Memory Requests (GB)', label: 'Mem Req', unit: 'GB', description: 'Total memory requested' },
      { key: 'Memory Limits (GB)', label: 'Mem Lim', unit: 'GB', description: 'Total memory limits' },
      { key: 'HPA Active', label: 'HPA Current', unit: '', description: 'HPA current replicas' },
      { key: 'HPA Desired', label: 'HPA Desired', unit: '', description: 'HPA desired replicas' },
    ]
  },
};

const NAMESPACE_SCOPED_CATEGORIES = {
  'Pod & Container Metrics': {
    icon: CubesIcon,
    description: 'Pod and container resource usage',
    metrics: [
      { key: 'Pod CPU Usage (cores)', label: 'CPU', unit: 'cores', description: 'CPU usage' },
      { key: 'CPU Throttled (%)', label: 'Throttled', unit: '%', description: 'CPU throttling' },
      { key: 'Pod Memory (GB)', label: 'Memory', unit: 'GB', description: 'Working set memory' },
      { key: 'RSS Memory (GB)', label: 'RSS', unit: 'GB', description: 'Resident memory' },
      { key: 'Container Restarts', label: 'Restarts', unit: '', description: 'Total restarts' },
      { key: 'Pods Ready', label: 'Ready', unit: '', description: 'Ready pods' },
      { key: 'Pods Not Ready', label: 'Not Ready', unit: '', description: 'Not ready pods' },
      { key: 'Container OOM Killed', label: 'OOM Killed', unit: '', description: 'OOM killed containers' },
    ]
  },
  'Network Metrics': {
    icon: NetworkIcon,
    description: 'Pod network I/O metrics',
    metrics: [
      { key: 'Network RX (MB/s)', label: 'RX', unit: 'MB/s', description: 'Network receive rate' },
      { key: 'Network TX (MB/s)', label: 'TX', unit: 'MB/s', description: 'Network transmit rate' },
      { key: 'Network RX Packets', label: 'RX Pkts', unit: '/s', description: 'Packets received' },
      { key: 'Network TX Packets', label: 'TX Pkts', unit: '/s', description: 'Packets transmitted' },
      { key: 'Network RX Errors', label: 'RX Errors', unit: '/s', description: 'Receive errors' },
      { key: 'Network TX Errors', label: 'TX Errors', unit: '/s', description: 'Transmit errors' },
      { key: 'Network RX Dropped', label: 'RX Dropped', unit: '/s', description: 'Packets dropped (RX)' },
      { key: 'Network TX Dropped', label: 'TX Dropped', unit: '/s', description: 'Packets dropped (TX)' },
    ]
  },
  'Storage I/O': {
    icon: DatabaseIcon,
    description: 'Storage and filesystem metrics',
    metrics: [
      { key: 'Disk Read (MB/s)', label: 'Read', unit: 'MB/s', description: 'Disk read rate' },
      { key: 'Disk Write (MB/s)', label: 'Write', unit: 'MB/s', description: 'Disk write rate' },
      { key: 'Disk Read IOPS', label: 'Read IOPS', unit: '/s', description: 'Read operations' },
      { key: 'Disk Write IOPS', label: 'Write IOPS', unit: '/s', description: 'Write operations' },
      { key: 'Filesystem Usage (GB)', label: 'FS Used', unit: 'GB', description: 'Filesystem used' },
      { key: 'Filesystem Limit (GB)', label: 'FS Limit', unit: 'GB', description: 'Filesystem limit' },
      { key: 'PVC Used (GB)', label: 'PVC Used', unit: 'GB', description: 'PVC space used' },
      { key: 'PVC Capacity (GB)', label: 'PVC Cap', unit: 'GB', description: 'PVC capacity' },
    ]
  },
  'Services & Networking': {
    icon: ServerIcon,
    description: 'Services and ingress metrics',
    metrics: [
      { key: 'Services Running', label: 'Services', unit: '', description: 'Running services' },
      { key: 'Service Endpoints', label: 'Endpoints', unit: '', description: 'Service endpoints' },
      { key: 'Ingress Rules', label: 'Ingresses', unit: '', description: 'Ingress rules' },
      { key: 'Network Policies', label: 'NetPolicies', unit: '', description: 'Network policies' },
      { key: 'Load Balancer Services', label: 'LB Svcs', unit: '', description: 'LoadBalancer services' },
      { key: 'ClusterIP Services', label: 'ClusterIP', unit: '', description: 'ClusterIP services' },
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

// Metric data with time series
interface MetricDataValue {
  latest_value: number | null;
  time_series?: TimeSeriesPoint[];
}

// Category Section Component
interface CategorySectionProps {
  categoryKey: string;
  categoryDef: {
    icon: React.ComponentType;
    description: string;
    metrics: Array<{ key: string; label: string; unit?: string; description?: string }>;
  };
  metricsData: Record<string, MetricDataValue>;
}

const CategorySection: React.FC<CategorySectionProps> = ({ categoryKey, categoryDef, metricsData }) => {
  const IconComponent = categoryDef.icon;
  
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
                />
              </GridItem>
            );
          })}
        </Grid>
      </CardBody>
    </Card>
  );
};

export const OpenShiftMetricsPage: React.FC = () => {
  const { t } = useTranslation('plugin__openshift-ai-observability');

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
  
  // Loading states
  const [loadingNamespaces, setLoadingNamespaces] = React.useState(true);
  const [loadingMetrics, setLoadingMetrics] = React.useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = React.useState(false);
  
  const [error, setError] = React.useState<string | null>(null);

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

  // Load metrics when filters change
  React.useEffect(() => {
    if (scope === 'namespace_scoped' && !selectedNamespace) return;
    loadMetrics();
  }, [scope, selectedNamespace, selectedCategory, timeRange]);

  const loadMetrics = async () => {
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
  };

  const handleAnalyze = async () => {
    setLoadingAnalysis(true);
    setAnalysis(null);
    setError(null);
    
    try {
      const config = getSessionConfig();
      console.log('[OpenShift] Session config:', config);
      
      if (!config.ai_model) {
        setError('Please configure an AI model in Settings first');
        setLoadingAnalysis(false);
        return;
      }
      
      console.log('[OpenShift] Calling analyzeOpenShift:', { 
        category: selectedCategory, 
        scope, 
        namespace: selectedNamespace,
        aiModel: config.ai_model,
        timeRange 
      });
      
      const result = await analyzeOpenShift(
        selectedCategory,
        scope,
        scope === 'namespace_scoped' ? selectedNamespace : undefined,
        config.ai_model,
        config.api_key,
        timeRange
      );
      
      console.log('[OpenShift] Analysis result:', result);
      
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
        
        {/* Metrics Display */}
        {!loadingMetrics && currentCategoryDef && (
          <CategorySection
            categoryKey={selectedCategory}
            categoryDef={currentCategoryDef}
            metricsData={metricsData}
          />
        )}

        {/* No data message */}
        {!loadingMetrics && Object.keys(metricsData).length === 0 && (
          <Alert variant={AlertVariant.warning} title="No metrics data" isInline>
            No metrics data available for {selectedCategory}. This may be expected if there are no resources in this category.
          </Alert>
        )}
      </PageSection>
    </>
  );
};

export default OpenShiftMetricsPage;
