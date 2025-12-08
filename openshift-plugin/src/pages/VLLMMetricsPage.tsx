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
} from '@patternfly/react-core';
import {
  SyncIcon,
  OutlinedLightbulbIcon,
  ServerIcon,
  CubesIcon,
  ClockIcon,
  DatabaseIcon,
  BoltIcon,
} from '@patternfly/react-icons';
import { listModels, listNamespaces, ModelInfo, NamespaceInfo, fetchVLLMMetrics, analyzeVLLM, getSessionConfig, AnalysisResult } from '../services/mcpClient';

// Metric definitions organized by category - matching actual MCP server metric names exactly
const METRIC_CATEGORIES = {
  'GPU Resources': {
    icon: CubesIcon,
    metrics: [
      { key: 'GPU Temperature (°C)', label: 'Temperature', unit: '°C', description: 'GPU core temperature' },
      { key: 'GPU Utilization (%)', label: 'Utilization', unit: '%', description: 'GPU compute utilization' },
      { key: 'GPU Power Usage (Watts)', label: 'Power', unit: 'W', description: 'GPU power consumption' },
      { key: 'GPU Memory Usage (GB)', label: 'Memory', unit: 'GB', description: 'GPU memory used' },
      { key: 'GPU Memory Temperature (°C)', label: 'Mem Temp', unit: '°C', description: 'GPU memory temperature' },
      { key: 'GPU Energy Consumption (Joules)', label: 'Energy', unit: 'J', description: 'Total energy consumed' },
      { key: 'GPU Usage (%)', label: 'vLLM GPU', unit: '%', description: 'vLLM GPU cache usage' },
      { key: 'Gpu Cache Usage Perc', label: 'Cache %', unit: '%', description: 'GPU cache utilization' },
    ]
  },
  'Inference Throughput': {
    icon: ServerIcon,
    metrics: [
      { key: 'Prompt Tokens Total', label: 'Prompt Tokens', unit: '', description: 'Total prompt tokens' },
      { key: 'Generation Tokens Total', label: 'Gen Tokens', unit: '', description: 'Total generated tokens' },
      { key: 'Request Success Total', label: 'Success', unit: '', description: 'Successful requests' },
      { key: 'Requests Running', label: 'Running', unit: '', description: 'Active requests' },
      { key: 'Num Requests Waiting', label: 'Waiting', unit: '', description: 'Queued requests' },
      { key: 'E2E Request Latency Seconds Count', label: 'Total Reqs', unit: '', description: 'Total requests' },
      { key: 'Request Generation Tokens Sum', label: 'Gen Sum', unit: '', description: 'Generation tokens sum' },
      { key: 'Request Prompt Tokens Sum', label: 'Prompt Sum', unit: '', description: 'Prompt tokens sum' },
      { key: 'Request Generation Tokens Count', label: 'Gen Count', unit: '', description: 'Requests with gen tokens' },
      { key: 'Request Prompt Tokens Count', label: 'Prompt Count', unit: '', description: 'Requests with prompts' },
    ]
  },
  'Latency & Timing': {
    icon: ClockIcon,
    metrics: [
      { key: 'P95 Latency (s)', label: 'P95', unit: 's', description: '95th percentile latency' },
      { key: 'Inference Time (s)', label: 'Avg Inference', unit: 's', description: 'Average inference time' },
      { key: 'Time To First Token Seconds Sum', label: 'TTFT Sum', unit: 's', description: 'Time to first token (sum)' },
      { key: 'Time To First Token Seconds Count', label: 'TTFT Count', unit: '', description: 'TTFT request count' },
      { key: 'Time Per Output Token Seconds Sum', label: 'TPOT Sum', unit: 's', description: 'Time per output token' },
      { key: 'Time Per Output Token Seconds Count', label: 'TPOT Count', unit: '', description: 'TPOT request count' },
      { key: 'Request Prefill Time Seconds Sum', label: 'Prefill', unit: 's', description: 'Prompt processing time' },
      { key: 'Request Decode Time Seconds Sum', label: 'Decode', unit: 's', description: 'Token generation time' },
      { key: 'E2E Request Latency Seconds Sum', label: 'E2E Sum', unit: 's', description: 'End-to-end latency sum' },
      { key: 'Request Queue Time Seconds Sum', label: 'Queue', unit: 's', description: 'Time in queue' },
      { key: 'Inter Token Latency Seconds Sum', label: 'ITL Sum', unit: 's', description: 'Inter-token latency' },
      { key: 'Inter Token Latency Seconds Count', label: 'ITL Count', unit: '', description: 'ITL request count' },
    ]
  },
  'KV Cache & Memory': {
    icon: DatabaseIcon,
    metrics: [
      { key: 'Kv Cache Usage Perc', label: 'KV Cache', unit: '%', description: 'KV cache utilization' },
      { key: 'Prefix Cache Hits Total', label: 'Cache Hits', unit: '', description: 'Prefix cache hits' },
      { key: 'Prefix Cache Queries Total', label: 'Cache Queries', unit: '', description: 'Cache queries' },
      { key: 'Gpu Prefix Cache Hits Total', label: 'GPU Hits', unit: '', description: 'GPU prefix cache hits' },
      { key: 'Gpu Prefix Cache Queries Total', label: 'GPU Queries', unit: '', description: 'GPU cache queries' },
      { key: 'Num Preemptions Total', label: 'Preemptions', unit: '', description: 'Request preemptions' },
      { key: 'Cache Config Info', label: 'Config', unit: '', description: 'Cache configuration' },
    ]
  },
  'Request Details': {
    icon: BoltIcon,
    metrics: [
      { key: 'Request Max Num Generation Tokens Sum', label: 'Max Gen', unit: '', description: 'Max generation tokens' },
      { key: 'Request Max Num Generation Tokens Count', label: 'Max Gen Count', unit: '', description: 'Requests' },
      { key: 'Request Params Max Tokens Sum', label: 'Max Params', unit: '', description: 'Max tokens parameter' },
      { key: 'Request Params Max Tokens Count', label: 'Params Count', unit: '', description: 'Requests' },
      { key: 'Request Params N Sum', label: 'N Sum', unit: '', description: 'N parameter sum' },
      { key: 'Request Params N Count', label: 'N Count', unit: '', description: 'Requests with N param' },
      { key: 'Iteration Tokens Total Sum', label: 'Iter Tokens', unit: '', description: 'Tokens per iteration' },
      { key: 'Iteration Tokens Total Count', label: 'Iter Count', unit: '', description: 'Iteration count' },
      { key: 'Request Inference Time Seconds Bucket', label: 'Inf Bucket', unit: '', description: 'Inference histogram' },
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
    if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(2)}K`;
    if (val < 1 && val > 0) return val.toFixed(3);
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
    
    const width = 80;
    const height = 24;
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

  return (
    <Card isCompact style={{ height: '100%' }}>
      <CardBody>
        {loading ? (
          <Bullseye>
            <Spinner size="md" />
          </Bullseye>
        ) : (
          <>
            <TextContent>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                {label}
              </Text>
            </TextContent>
            <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginTop: '8px' }}>
              <FlexItem>
                <span style={{ 
                  fontSize: '1.75rem', 
                  fontWeight: 600, 
                  color: value === 0 || value === '0' 
                    ? 'var(--pf-v5-global--Color--200)' 
                    : 'var(--pf-v5-global--primary-color--100)' 
                }}>
                  {formatValue(value)}
                </span>
                {unit && (
                  <span style={{ fontSize: '0.875rem', color: 'var(--pf-v5-global--Color--200)', marginLeft: '4px' }}>
                    {unit}
                  </span>
                )}
              </FlexItem>
              <FlexItem>
                {renderSparkline()}
              </FlexItem>
              {trend && trend.direction !== 'flat' && (
                <FlexItem>
                  <span style={{ 
                    fontSize: '0.75rem', 
                    color: trend.direction === 'up' ? '#3e8635' : '#c9190b',
                    marginLeft: '4px',
                  }}>
                    {trend.direction === 'up' ? '↑' : '↓'} {trend.percent.toFixed(1)}%
                  </span>
                </FlexItem>
              )}
            </Flex>
            {description && (
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px', fontSize: '0.75rem' }}>
                {description}
              </Text>
            )}
          </>
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
  metrics: Array<{ key: string; label: string; unit: string; description: string }>;
  data: Record<string, MetricDataValue>;
  loading: boolean;
}

const CategorySection: React.FC<CategorySectionProps> = ({ title, icon: Icon, metrics, data, loading }) => {
  return (
    <Card style={{ marginBottom: '16px' }}>
      <CardTitle>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Icon style={{ marginRight: '8px', color: 'var(--pf-v5-global--primary-color--100)' }} />
          </FlexItem>
          <FlexItem>
            <Text component={TextVariants.h3}>{title}</Text>
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
    <Page>
      <PageSection variant="light">
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1" size="2xl">vLLM Metrics Dashboard</Title>
            <TextContent>
              <Text component={TextVariants.p} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                Monitor and analyze vLLM model performance and resource utilization
              </Text>
            </TextContent>
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              onClick={() => { handleRefresh(); }}
              isLoading={metricsLoading}
            >
              <SyncIcon /> Refresh
            </Button>
          </FlexItem>
        </Flex>
      </PageSection>

      <PageSection variant="light" style={{ paddingTop: 0 }}>
        <Card>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <FormGroup label="Namespace" fieldId="namespace-select">
                    <FormSelect
                      id="namespace-select"
                      value={namespace}
                      onChange={(_e, val) => setNamespace(val)}
                      style={{ minWidth: '180px' }}
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
                      style={{ minWidth: '280px' }}
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
                    variant="primary"
                    onClick={handleAnalyze}
                    isLoading={analysisLoading}
                    isDisabled={model === 'all'}
                    icon={<OutlinedLightbulbIcon />}
                    style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)', border: 'none' }}
                  >
                    Analyze with AI
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>
          </CardBody>
        </Card>
      </PageSection>

      {error && (
        <PageSection style={{ paddingTop: 0, paddingBottom: '8px' }}>
          <Alert variant={AlertVariant.warning} title="Warning" isInline>
            {error}
          </Alert>
        </PageSection>
      )}

      {analysisResult && (
        <PageSection style={{ paddingTop: 0 }}>
          <Card style={{ background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)', border: '1px solid #c4b5fd' }}>
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
        </PageSection>
      )}

      <PageSection>
        {model === 'all' ? (
          <EmptyState>
            <EmptyStateBody>
              Select a specific model to view detailed metrics.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <>
            {Object.entries(METRIC_CATEGORIES).map(([categoryName, category]) => (
              <CategorySection
                key={categoryName}
                title={categoryName}
                icon={category.icon}
                metrics={category.metrics}
                data={metricsData}
                loading={metricsLoading}
              />
            ))}
          </>
        )}
      </PageSection>

      {models.length === 0 && namespaces.length === 0 && (
        <PageSection>
          <EmptyState>
            <EmptyStateBody>
              No vLLM models found. Make sure models are deployed and the MCP server is properly configured.
            </EmptyStateBody>
            <Button variant="primary" onClick={loadData}>Retry</Button>
          </EmptyState>
        </PageSection>
      )}
    </Page>
  );
};

export default VLLMMetricsPage;
