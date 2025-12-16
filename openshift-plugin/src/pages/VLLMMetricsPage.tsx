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
  ClockIcon,
  TachometerAltIcon,
  MemoryIcon,
  CogIcon,
} from '@patternfly/react-icons';
import { listModels, listNamespaces, ModelInfo, NamespaceInfo, fetchVLLMMetrics, analyzeVLLM, getSessionConfig, AnalysisResult } from '../services/mcpClient';

// Comprehensive vLLM metric categories based on actual Prometheus metrics
const METRIC_CATEGORIES = {
  'Token Throughput': {
    icon: TachometerAltIcon,
    priority: 1,
    description: 'Token processing performance and rates',
    metrics: [
      { key: 'Prompt Tokens Total', label: 'Prompt Tokens', unit: '', description: 'Total prompt tokens processed' },
      { key: 'Generation Tokens Total', label: 'Gen Tokens', unit: '', description: 'Total generated tokens' },
      { key: 'Prompt Tokens Created', label: 'Prompt Rate', unit: '/s', description: 'Prompt token rate' },
      { key: 'Generation Tokens Created', label: 'Gen Rate', unit: '/s', description: 'Generation token rate' },
      { key: 'Request Prompt Tokens Sum', label: 'Avg Prompt', unit: '', description: 'Average prompt tokens per request' },
      { key: 'Request Generation Tokens Sum', label: 'Avg Gen', unit: '', description: 'Average generated tokens per request' },
    ]
  },
  'Latency & Timing': {
    icon: ClockIcon,
    priority: 2,
    description: 'Response time breakdown and analysis',
    metrics: [
      { key: 'P95 Latency (s)', label: 'P95 Latency', unit: 's', description: '95th percentile end-to-end latency' },
      { key: 'Inference Time (s)', label: 'Avg Inference', unit: 's', description: 'Average inference time' },
      { key: 'Time To First Token Seconds Sum', label: 'TTFT Sum', unit: 's', description: 'Time to first token (total)' },
      { key: 'Time Per Output Token Seconds Sum', label: 'TPOT Sum', unit: 's', description: 'Time per output token (total)' },
      { key: 'Request Prefill Time Seconds Sum', label: 'Prefill', unit: 's', description: 'Prompt processing time' },
      { key: 'Request Decode Time Seconds Sum', label: 'Decode', unit: 's', description: 'Token generation time' },
      { key: 'Request Queue Time Seconds Sum', label: 'Queue Time', unit: 's', description: 'Time spent in queue' },
      { key: 'E2E Request Latency Seconds Sum', label: 'E2E Total', unit: 's', description: 'End-to-end latency sum' },
    ]
  },
  'Memory & Cache': {
    icon: MemoryIcon,
    priority: 3,
    description: 'Cache efficiency and memory utilization',
    metrics: [
      { key: 'Kv Cache Usage Perc', label: 'KV Cache', unit: '%', description: 'Key-Value cache utilization' },
      { key: 'Gpu Cache Usage Perc', label: 'GPU Cache', unit: '%', description: 'GPU cache utilization' },
      { key: 'Prefix Cache Hits Total', label: 'Cache Hits', unit: '', description: 'Total prefix cache hits' },
      { key: 'Prefix Cache Queries Total', label: 'Cache Queries', unit: '', description: 'Total cache queries' },
      { key: 'Gpu Prefix Cache Hits Total', label: 'GPU Hits', unit: '', description: 'GPU prefix cache hits' },
      { key: 'Gpu Prefix Cache Queries Total', label: 'GPU Queries', unit: '', description: 'GPU cache queries' },
      { key: 'Gpu Prefix Cache Hits Created', label: 'GPU Hit Rate', unit: '/s', description: 'GPU cache hit rate' },
      { key: 'Gpu Prefix Cache Queries Created', label: 'GPU Query Rate', unit: '/s', description: 'GPU cache query rate' },
    ]
  },
  'GPU Hardware': {
    icon: CubesIcon,
    priority: 4,
    description: 'GPU hardware monitoring and resource usage',
    metrics: [
      { key: 'GPU Temperature (°C)', label: 'Temperature', unit: '°C', description: 'GPU core temperature' },
      { key: 'GPU Power Usage (Watts)', label: 'Power', unit: 'W', description: 'GPU power consumption' },
      { key: 'GPU Energy Consumption (Joules)', label: 'Energy', unit: 'J', description: 'Total energy consumed' },
      { key: 'GPU Utilization (%)', label: 'Utilization', unit: '%', description: 'GPU compute utilization' },
      { key: 'GPU Memory Usage (GB)', label: 'Memory', unit: 'GB', description: 'GPU memory used' },
      { key: 'GPU Memory Temperature (°C)', label: 'Mem Temp', unit: '°C', description: 'GPU memory temperature' },
    ]
  },
  'Request Parameters': {
    icon: CogIcon,
    priority: 5,
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
    if (val === 0) return '0';
    if (val >= 1000000000) return `${(val / 1000000000).toFixed(1)}B`;
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    if (val < 1 && val > 0) return val.toFixed(2);
    return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
  };

  // Enhanced trend calculation with better thresholds
  const getTrend = (): { direction: 'up' | 'down' | 'flat'; percent: number } | null => {
    if (!timeSeries || timeSeries.length < 3) return null;
    
    // Use first and last values, but also consider recent trend
    const first = timeSeries[0].value;
    const last = timeSeries[timeSeries.length - 1].value;
    
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

  // Simple SVG sparkline (copied from OpenShift Metrics page)
  const renderSparkline = () => {
    if (!timeSeries || timeSeries.length < 2) {
      console.log(`${label}: No sparkline - ${!timeSeries ? 'no timeSeries' : `only ${timeSeries.length} points`}`);
      return null;
    }
    
    console.log(`${label}: Rendering sparkline with ${timeSeries.length} points`);
    
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
}

const CategorySection: React.FC<CategorySectionProps> = ({ title, icon: Icon, description, metrics, data, loading }) => {
  return (
    <Card style={{ marginBottom: '16px' }}>
      <CardTitle>
        <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }}>
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
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
    </Card>
  );
};

// Main Page Component
const VLLMMetricsPage: React.FC = () => {
  const [namespace, setNamespace] = React.useState<string>('all');
  const [model, setModel] = React.useState<string>('all');
  const [timeRange, setTimeRange] = React.useState<string>('1h');
  const [namespaces, setNamespaces] = React.useState<NamespaceInfo[]>([]);
  const [models, setModels] = React.useState<ModelInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [metricsLoading, setMetricsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ragAvailable, setRagAvailable] = React.useState<boolean | null>(null);
  const [analysisLoading, setAnalysisLoading] = React.useState(false);
  const [analysisResult, setAnalysisResult] = React.useState<AnalysisResult | null>(null);
  const [metricsData, setMetricsData] = React.useState<Record<string, MetricDataValue>>({});

  React.useEffect(() => {
    loadData();
  }, []);

  React.useEffect(() => {
    if (namespace && model && model !== 'all') {
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
      
      // Auto-select first namespace/model if available
      if (namespacesData.length > 0) {
        setNamespace(namespacesData[0].name);
      }
      if (modelsData.length > 0) {
        setModel(`${modelsData[0].namespace} | ${modelsData[0].name}`);
      }
    } catch (err) {
      setError('Failed to load data from MCP server');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async () => {
    if (model === 'all') return;
    
    setMetricsLoading(true);
    setError(null);
    try {
      const metricsResponse = await fetchVLLMMetrics(model, timeRange, namespace !== 'all' ? namespace : undefined);
      
      if (!metricsResponse || !metricsResponse.metrics) {
        setError('No metrics data available for this model');
        setMetricsData({});
        return;
      }

      // Use only real data from MCP server - no mock data
      console.log('Received metrics data:', Object.keys(metricsResponse.metrics).length, 'metrics');
      
      // Debug: Check which metrics have time series
      const metricsWithTimeSeries = Object.entries(metricsResponse.metrics)
        .filter(([, data]) => data.time_series && data.time_series.length > 0)
        .map(([key, data]) => ({ key, points: data.time_series?.length || 0 }));
      
      console.log('Metrics with time series:', metricsWithTimeSeries);
      
      setMetricsData(metricsResponse.metrics);
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
      setError('Failed to fetch metrics from MCP server');
    } finally {
      setMetricsLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (model === 'all') return;
    
    setAnalysisLoading(true);
    setAnalysisResult(null);
    setError(null);
    try {
      const config = getSessionConfig();
      console.log('[Analyze] Session config:', config);
      
      if (!config.ai_model) {
        setError('Please configure an AI model in Settings first');
        return;
      }
      
      console.log('[Analyze] Calling analyzeVLLM with:', { model, aiModel: config.ai_model, timeRange });
      const result = await analyzeVLLM(model, config.ai_model, timeRange, config.api_key);
      console.log('[Analyze] Result received:', result);
      
      if (result && result.summary) {
        setAnalysisResult(result);
      } else {
        console.error('[Analyze] Invalid result format:', result);
        setError('Analysis returned invalid format. Check browser console for details.');
      }
    } catch (err) {
      console.error('[Analyze] Failed:', err);
      setError(`Failed to analyze metrics: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAnalysisLoading(false);
    }
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
          <FlexItem>
            <Button
              variant="secondary"
              onClick={() => { handleRefresh(); }}
              isLoading={metricsLoading}
              style={{ 
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderColor: 'rgba(255,255,255,0.3)',
                color: 'white',
              }}
            >
              <SyncIcon /> Refresh
            </Button>
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
                  <FormSelectOption key="all" value="all" label="All Models" />
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
                  onChange={(_e, val) => setTimeRange(val)}
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
                isDisabled={model === 'all'}
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
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      {/* Main Content */}
      <PageSection>
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
          <Alert variant={AlertVariant.warning} title="Warning" isInline style={{ marginBottom: '16px' }}>
            {error}
          </Alert>
        )}

        {/* AI Analysis Result */}
        {analysisResult && (
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
              <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, lineHeight: 1.6 }}>
                {analysisResult.summary}
              </div>
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
        {model === 'all' ? (
          <EmptyState>
            <EmptyStateBody>
              Select a specific model to view detailed metrics.
            </EmptyStateBody>
          </EmptyState>
        ) : !metricsLoading && (
          <>
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
                />
              ))}
          </>
        )}

        {/* No data message */}
        {!metricsLoading && model !== 'all' && Object.keys(metricsData).length === 0 && (
          <Alert variant={AlertVariant.warning} title="No metrics data" isInline>
            No metrics data available for {model}. Make sure the model is active and metrics are enabled.
          </Alert>
        )}
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

