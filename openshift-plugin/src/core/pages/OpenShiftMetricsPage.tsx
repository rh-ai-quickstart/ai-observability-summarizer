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
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
  MenuToggleElement,
} from '@patternfly/react-core';
import {
  SyncIcon,
  OutlinedLightbulbIcon,
  ClusterIcon,
  CubeIcon,
  ServerIcon,
  NetworkIcon,
  CubesIcon,
  ChartLineIcon,
  DownloadIcon,
  RobotIcon,
  TimesIcon,
  CalendarAltIcon,
} from '@patternfly/react-icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertList } from '../components/AlertList';
import { MetricChartModal } from '../components/MetricChartModal';
import { MetricsChatPanel } from '../components/MetricsChatPanel';
import { CustomRangePickerModal } from '../components/CustomRangePickerModal';
import { ConfigurationRequiredAlert } from '../components/ConfigurationRequiredAlert';
import { formatValue, GPU_THRESHOLDS } from '../utils/formatValue';
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
import { CLUSTER_WIDE_CATEGORIES } from '../data/openshiftMetricsConfig';

// All categories are now available for both cluster-wide and namespace-scoped views
// The scope only affects data aggregation, not which categories are shown

const TIME_RANGE_OPTIONS = [
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: 'custom', label: 'Custom Range...' },
];

// Grid layout constants
const GRID_SPAN_FULL = 12;
const GRID_SPAN_METRICS_WITH_CHAT = 8;
const GRID_SPAN_CHAT = 4;

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

  const { value: displayValue, unit: displayUnit } = formatValue(value, unit);
  const avgValue = calculateAverage(timeSeries);
  const avgFormatted = avgValue !== null ? formatValue(avgValue, unit) : null;
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
                    {displayValue}{displayUnit && value !== null ? ` ${displayUnit}` : ''}
                  </Text>
                  {avgFormatted && (
                    <Text
                      component={TextVariants.small}
                      style={{
                        color: '#666',
                        fontSize: '0.85rem',
                        display: 'block',
                        marginTop: '2px'
                      }}
                    >
                      Avg: {avgFormatted.value}{avgFormatted.unit ? ` ${avgFormatted.unit}` : ''}
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
                  <div style={{
                    color: 'var(--pf-v5-global--primary-color--100)',
                    fontSize: '20px',
                    marginLeft: '8px'
                  }}>
                    {React.createElement(icon, {})}
                  </div>
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
  const hotGPUs = avgTemp && avgTemp > GPU_THRESHOLDS.TEMPERATURE_CRITICAL ? Math.ceil(totalGPUs * 0.2) : 0; // Estimate based on temp
  const overloadedGPUs = avgUtil && avgUtil > GPU_THRESHOLDS.UTILIZATION_CRITICAL ? Math.ceil(totalGPUs * 0.1) : 0; // Estimate
  

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
                color: avgUtil && avgUtil > GPU_THRESHOLDS.UTILIZATION_WARNING ? '#dc2626' : avgUtil && avgUtil > GPU_THRESHOLDS.UTILIZATION_HIGH ? '#ea580c' : '#059669',
                fontWeight: 700 
              }}>
                {formatValue(avgUtil, '%').value}%
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
                color: avgTemp && avgTemp > GPU_THRESHOLDS.TEMPERATURE_DANGER ? '#dc2626' : avgTemp && avgTemp > GPU_THRESHOLDS.TEMPERATURE_WARNING ? '#ea580c' : '#059669',
                fontWeight: 700 
              }}>
                {avgTemp !== null ? Math.round(avgTemp) : '—'}°C
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
                {(() => {
                  const formatted = formatValue(totalPower, 'W');
                  return `${formatted.value}${formatted.unit}`;
                })()}
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
                    {hotGPUs} GPUs running hot (&gt;{GPU_THRESHOLDS.TEMPERATURE_CRITICAL}°C)
                  </Text>
                </FlexItem>
              )}
              {overloadedGPUs > 0 && (
                <FlexItem style={{ marginLeft: '12px' }}>
                  <Text component={TextVariants.small} style={{ color: '#92400e' }}>
                    {overloadedGPUs} GPUs overloaded (&gt;{GPU_THRESHOLDS.UTILIZATION_CRITICAL}%)
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
    // Try to estimate based on total power
    const totalPower = metricsData['GPU Power Usage (W)']?.latest_value ?? 0;
    if (totalPower > 0) {
      estimatedCount = Math.max(1, Math.round(totalPower / GPU_THRESHOLDS.POWER_ESTIMATE_PER_GPU));
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
                          color: gpuSummaryData.utilization > GPU_THRESHOLDS.UTILIZATION_WARNING ? '#dc2626' :
                                 gpuSummaryData.utilization > GPU_THRESHOLDS.UTILIZATION_HIGH ? '#ea580c' : '#666',
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
                          color: gpuSummaryData.temperature > GPU_THRESHOLDS.TEMPERATURE_DANGER ? '#dc2626' :
                                 gpuSummaryData.temperature > GPU_THRESHOLDS.TEMPERATURE_WARNING ? '#ea580c' : '#666',
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
  const { useAIConfigWarningDismissal, AI_CONFIG_WARNING } = useSettings();

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

  // Chat panel state
  const [chatPanelOpen, setChatPanelOpen] = React.useState(false);

  // Custom date range state
  const [showCustomRangePicker, setShowCustomRangePicker] = React.useState(false);
  const [customRangeStart, setCustomRangeStart] = React.useState<Date | null>(null);
  const [customRangeEnd, setCustomRangeEnd] = React.useState<Date | null>(null);
  const [customRangeLabel, setCustomRangeLabel] = React.useState<string>('');

  // Loading states
  const [loadingNamespaces, setLoadingNamespaces] = React.useState(true);
  const [loadingMetrics, setLoadingMetrics] = React.useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = React.useState(false);
  
  // Analysis cancellation
  const [analysisController, setAnalysisController] = React.useState<AbortController | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  const [errorType, setErrorType] = React.useState<string | null>(null);
  
  // Download dropdown state
  const [downloadDropdownOpen, setDownloadDropdownOpen] = React.useState(false);

  // Auto-dismiss AI configuration warnings when settings are closed
  useAIConfigWarningDismissal(errorType, setError, setErrorType);

  // Cleanup abort controller on unmount
  React.useEffect(() => {
    return () => {
      if (analysisController) {
        analysisController.abort();
      }
    };
  }, [analysisController]);


  // All categories are now available for both scopes
  const categories = CLUSTER_WIDE_CATEGORIES;
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

  // Ensure selected category is valid (categories no longer change with scope)
  React.useEffect(() => {
    const categoryNames = Object.keys(CLUSTER_WIDE_CATEGORIES);
    if (!categoryNames.includes(selectedCategory)) {
      setSelectedCategory(categoryNames[0]);
    }
  }, [selectedCategory]);

  // Convert custom date range to the format expected by MCP server
  const getTimeRangeForAPI = React.useCallback(() => {
    if (timeRange === 'custom' && customRangeStart && customRangeEnd) {
      // Convert to a custom format that the MCP server can understand
      // Format: "custom:START_ISO:END_ISO"
      const startISO = customRangeStart.toISOString();
      const endISO = customRangeEnd.toISOString();
      return `custom:${startISO}:${endISO}`;
    }
    // Return the preset time range string
    return timeRange;
  }, [timeRange, customRangeStart, customRangeEnd]);

  const loadMetrics = React.useCallback(async () => {
    setLoadingMetrics(true);
    setError(null);
    try {
      const namespace = scope === 'namespace_scoped' ? selectedNamespace : undefined;
      
      const apiTimeRange = getTimeRangeForAPI();
      const [metricsResponse, alertsData] = await Promise.all([
        fetchOpenShiftMetrics(selectedCategory, scope, apiTimeRange, namespace),
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
  }, [scope, selectedNamespace, selectedCategory, getTimeRangeForAPI]);

  // Load metrics when filters change
  React.useEffect(() => {
    if (scope === 'namespace_scoped' && !selectedNamespace) return;
    loadMetrics();
  }, [scope, selectedNamespace, selectedCategory, loadMetrics]);

  const handleAnalyze = async () => {
    // Cancel any existing analysis
    if (analysisController) {
      analysisController.abort();
    }
    
    // Create new abort controller
    const controller = new AbortController();
    setAnalysisController(controller);
    
    setLoadingAnalysis(true);
    setAnalysis(null);
    setError(null);
    setErrorType(null);
    
    try {
      // Check configuration at the moment of click
      const config = getSessionConfig();
      
      if (!config.ai_model) {
        setError('CONFIGURATION_REQUIRED');
        setErrorType(AI_CONFIG_WARNING);
        setLoadingAnalysis(false);
        setAnalysisController(null);
        return;
      }
      // Let MCP server resolve provider secret if api_key is not present in session
      const apiKey = (config.api_key as string | undefined) || undefined;
      
      const apiTimeRange = getTimeRangeForAPI();
      const result = await analyzeOpenShift(
        selectedCategory,
        scope,
        scope === 'namespace_scoped' ? selectedNamespace : undefined,
        config.ai_model,
        apiKey,
        apiTimeRange,
        controller.signal
      );
      
      // Check if request was cancelled
      if (controller.signal.aborted) {
        return;
      }
      
      if (result && result.summary) {
        setAnalysis(result);
      } else {
        console.error('[OpenShift] Analysis returned empty or invalid response:', result);
        setError('Analysis returned empty response. Check browser console for details.');
      }
    } catch (err) {
      // Don't show error if request was cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      
      console.error('[OpenShift] Analysis failed:', err);
      setError(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!controller.signal.aborted) {
        setLoadingAnalysis(false);
        setAnalysisController(null);
      }
    }
  };

  const handleCancelAnalysis = () => {
    if (analysisController) {
      analysisController.abort();
      setAnalysisController(null);
    }
    setLoadingAnalysis(false);
    setAnalysis(null);
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

  // Custom date range handlers - implementing clean algorithm
  const handleTimeRangeChange = (_event: any, value: string) => {
    // Step 7: User selected predefined value → use it directly  
    setTimeRange(value);
    setCustomRangeStart(null);
    setCustomRangeEnd(null);
    setCustomRangeLabel('');
  };

  const handleCustomRangeApply = React.useCallback((startDate: Date, endDate: Date) => {
    // Step 4: User closed picker accepting values → apply them
    const formatDate = (date: Date) => {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    
    const label = `${formatDate(startDate)} - ${formatDate(endDate)}`;
    
    // Set custom range state - useEffect will handle metrics refresh
    setCustomRangeStart(startDate);
    setCustomRangeEnd(endDate);
    setCustomRangeLabel(label);
    setShowCustomRangePicker(false);
    
    // Note: timeRange is already 'custom' from handleTimeRangeChange
  }, []);

  const handleCustomRangeClose = () => {
    setShowCustomRangePicker(false);
    
    // Step 4: If timeRange is 'custom' (user clicked Custom Range...) but no custom dates set,
    // apply the picker's default values (1 hour ago to now)
    if (timeRange === 'custom' && (!customRangeStart || !customRangeEnd)) {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      const formatDate = (date: Date) => {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };
      
      const label = `${formatDate(oneHourAgo)} - ${formatDate(now)}`;
      
      // Apply the default picker values as the custom range
      setCustomRangeStart(oneHourAgo);
      setCustomRangeEnd(now);
      setCustomRangeLabel(label);
      
      // timeRange stays 'custom' - this will trigger metrics refresh via useEffect
    }
    // If timeRange is not 'custom', or we already have custom dates, do nothing
  };

  // Prepare metric data for chart modal
  const selectedMetricData = React.useMemo(() => {
    if (!selectedMetricForChart) return null;
    
    const categories = CLUSTER_WIDE_CATEGORIES;
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

  // Memoize expensive metrics section computation
  const metricsSection = React.useMemo(() => {
    return Object.entries(metricsData).map(([key, val]) => {
      const categoryDef = categories[selectedCategory as keyof typeof categories];
      const metricDef = categoryDef?.metrics?.find((m) => m.key === key);
      const unit = metricDef?.unit || '';
      return {
        name: key,
        value: val.latest_value !== null ? `${val.latest_value}${unit ? ` ${unit}` : ''}` : 'N/A',
        description: metricDef?.description || ''
      };
    });
  }, [metricsData, selectedCategory]);

  // Generate report content - timestamp generated fresh on each call
  const generateReportContent = () => {
    const timestamp = new Date().toISOString();
    const timeRangeLabel = timeRange === 'custom' && customRangeLabel
      ? customRangeLabel
      : TIME_RANGE_OPTIONS.find(o => o.value === timeRange)?.label || timeRange;

    return {
      title: 'OpenShift Metrics Report',
      category: selectedCategory,
      scope: scope === 'cluster_wide' ? 'Cluster-wide' : selectedNamespace,
      timeRange: timeRangeLabel,
      timestamp,
      metrics: metricsSection,
      analysis: analysis?.summary || 'No analysis available. Click "Analyze with AI" to generate insights.'
    };
  };

  const downloadMarkdown = () => {
    try {
      const report = generateReportContent();
      const content = `# ${report.title}

**Category**: ${report.category}
**Scope**: ${report.scope}
**Time Range**: ${report.timeRange}
**Generated**: ${report.timestamp}

## Metrics Summary

${report.metrics.map(metric => `- **${metric.name}**: ${metric.value}`).join('\n')}

## AI Analysis

${report.analysis}

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

  // HTML escaping helper to prevent XSS
  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const downloadHTML = () => {
    try {
      const report = generateReportContent();
      const content = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(report.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        h1 { color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
        h2 { color: #374151; margin-top: 30px; }
        .metadata { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .metadata strong { color: #1f2937; }
        .metrics-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .metrics-table th, .metrics-table td { 
            border: 1px solid #d1d5db; padding: 12px; text-align: left; 
        }
        .metrics-table th { background-color: #f9fafb; font-weight: bold; }
        .analysis { background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .footer { margin-top: 40px; text-align: center; color: #6b7280; font-style: italic; }
    </style>
</head>
<body>
    <h1>${escapeHtml(report.title)}</h1>
    
    <div class="metadata">
        <strong>Category:</strong> ${escapeHtml(report.category)}<br>
        <strong>Scope:</strong> ${escapeHtml(report.scope)}<br>
        <strong>Time Range:</strong> ${escapeHtml(report.timeRange)}<br>
        <strong>Generated:</strong> ${escapeHtml(new Date(report.timestamp).toLocaleString())}
    </div>

    <h2>Metrics Summary</h2>
    <table class="metrics-table">
        <thead>
            <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Description</th>
            </tr>
        </thead>
        <tbody>
            ${report.metrics.map(metric => `
                <tr>
                    <td><strong>${escapeHtml(metric.name)}</strong></td>
                    <td>${escapeHtml(metric.value)}</td>
                    <td>${escapeHtml(metric.description)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <h2>AI Analysis</h2>
    <div class="analysis">
        ${escapeHtml(report.analysis).replace(/\n/g, '<br>')}
    </div>

    <div class="footer">
        Generated by OpenShift AI Observability Plugin
    </div>
</body>
</html>`;

      const blob = new Blob([content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openshift-metrics-${selectedCategory.replace(/\s+/g, '_')}-${Date.now()}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download HTML report:', error);
      setError('Failed to download report. Please try again.');
    }
  };

  const downloadPDF = () => {
    try {
      // For PDF generation, we'll use print-optimized HTML and trigger browser's print-to-PDF
      const report = generateReportContent();
      const printContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(report.title)}</title>
    <style>
        @media print {
            body { margin: 0; }
            .no-print { display: none; }
        }
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.4; }
        h1 { color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; page-break-after: avoid; }
        h2 { color: #374151; margin-top: 25px; page-break-after: avoid; }
        .metadata { background: #f8f9fa; padding: 15px; border: 1px solid #dee2e6; margin: 15px 0; }
        .metadata strong { color: #1f2937; }
        .metrics-table { width: 100%; border-collapse: collapse; margin: 15px 0; page-break-inside: avoid; }
        .metrics-table th, .metrics-table td { 
            border: 1px solid #666; padding: 8px; text-align: left; font-size: 12px;
        }
        .metrics-table th { background-color: #f0f0f0; font-weight: bold; }
        .analysis { border: 1px solid #ccc; padding: 15px; margin: 15px 0; }
        .footer { margin-top: 30px; text-align: center; color: #666; font-size: 10px; }
        .print-button { margin: 20px 0; text-align: center; }
    </style>
</head>
<body>
    <div class="no-print print-button">
        <button onclick="window.print()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer;">
            Print to PDF
        </button>
        <p><small>Use your browser's print function and select "Save as PDF" as the destination.</small></p>
    </div>
    
    <h1>${escapeHtml(report.title)}</h1>

    <div class="metadata">
        <strong>Category:</strong> ${escapeHtml(report.category)}<br>
        <strong>Scope:</strong> ${escapeHtml(report.scope)}<br>
        <strong>Time Range:</strong> ${escapeHtml(report.timeRange)}<br>
        <strong>Generated:</strong> ${escapeHtml(new Date(report.timestamp).toLocaleString())}
    </div>

    <h2>Metrics Summary</h2>
    <table class="metrics-table">
        <thead>
            <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Description</th>
            </tr>
        </thead>
        <tbody>
            ${report.metrics.map(metric => `
                <tr>
                    <td><strong>${escapeHtml(metric.name)}</strong></td>
                    <td>${escapeHtml(metric.value)}</td>
                    <td>${escapeHtml(metric.description)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <h2>AI Analysis</h2>
    <div class="analysis">
        ${escapeHtml(report.analysis).replace(/\n/g, '<br>')}
    </div>

    <div class="footer">
        Generated by OpenShift AI Observability Plugin
    </div>
</body>
</html>`;

      // Open in a new window for printing
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.focus();
      } else {
        // Fallback: create a blob and download as HTML
        const blob = new Blob([printContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `openshift-metrics-${selectedCategory.replace(/\s+/g, '_')}-${Date.now()}-print.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Failed to generate PDF report:', error);
      setError('Failed to generate PDF report. Please try again.');
    }
  };

  // Handle download format selection
  const handleDownloadFormat = (format: string) => {
    setDownloadDropdownOpen(false);
    switch (format) {
      case 'html':
        downloadHTML();
        break;
      case 'pdf':
        downloadPDF();
        break;
      case 'markdown':
        downloadMarkdown();
        break;
      default:
        console.warn('Unknown download format:', format);
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
            <Flex 
              alignItems={{ default: 'alignItemsFlexEnd' }}
              spaceItems={{ default: 'spaceItemsLg' }}
              style={{ width: '100%' }}
            >
              {/* Namespace Selector (only for namespace scope) */}
              <FlexItem>
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
              </FlexItem>

              {/* Category Selector */}
              <FlexItem>
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
              </FlexItem>

              {/* Time Range Selector */}
              <FlexItem>
                <FormGroup label="Time Range" fieldId="time-range-select">
                  <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsXs' }}>
                    <FlexItem>
                      <FormSelect
                        id="time-range-select"
                        value={timeRange === 'custom' ? '1h' : timeRange}
                        onChange={handleTimeRangeChange}
                        aria-label="Select time range"
                        style={{ minWidth: '120px' }}
                      >
                        {TIME_RANGE_OPTIONS.filter(opt => opt.value !== 'custom').map((opt) => (
                          <FormSelectOption
                            key={opt.value}
                            value={opt.value}
                            label={opt.label}
                          />
                        ))}
                      </FormSelect>
                    </FlexItem>
                    <FlexItem>
                      <Button
                        variant={timeRange === 'custom' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => {
                          setTimeRange('custom');
                          setShowCustomRangePicker(true);
                        }}
                        aria-label="Select custom date range"
                        title="Custom date range"
                      >
                        <CalendarAltIcon />
                      </Button>
                    </FlexItem>
                  </Flex>
                </FormGroup>
              </FlexItem>

              {/* Action Buttons */}
              <FlexItem align={{ default: 'alignRight' }}>
                <Flex spaceItems={{ default: 'spaceItemsXs' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem>
                    <Button
                      variant="secondary"
                      onClick={loadMetrics}
                      isDisabled={loadingMetrics}
                      isLoading={loadingMetrics}
                      aria-label="Refresh metrics"
                      title="Refresh metrics"
                    >
                      <SyncIcon />
                    </Button>
                  </FlexItem>
                  <FlexItem>
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
                  <FlexItem>
                    <Button
                      variant={chatPanelOpen ? 'primary' : 'secondary'}
                      icon={chatPanelOpen ? <TimesIcon /> : <RobotIcon />}
                      onClick={() => setChatPanelOpen(!chatPanelOpen)}
                      style={chatPanelOpen ? {
                        background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                        border: 'none',
                      } : {}}
                    >
                      {chatPanelOpen ? 'Close Assistant' : 'AI Assistant'}
                    </Button>
                  </FlexItem>
                  <FlexItem>
                    <Dropdown
                      isOpen={downloadDropdownOpen}
                      onSelect={() => {}}
                      onOpenChange={(isOpen: boolean) => setDownloadDropdownOpen(isOpen)}
                      toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                        <MenuToggle
                          ref={toggleRef}
                          onClick={() => setDownloadDropdownOpen(!downloadDropdownOpen)}
                          isExpanded={downloadDropdownOpen}
                          isDisabled={Object.keys(metricsData).length === 0}
                          icon={<DownloadIcon />}
                        >
                          Report
                        </MenuToggle>
                      )}
                    >
                      <DropdownList>
                        <DropdownItem 
                          value="html"
                          key="html" 
                          onClick={() => handleDownloadFormat('html')}
                        >
                          HTML
                        </DropdownItem>
                        <DropdownItem 
                          value="pdf"
                          key="pdf" 
                          onClick={() => handleDownloadFormat('pdf')}
                        >
                          PDF
                        </DropdownItem>
                        <DropdownItem 
                          value="markdown"
                          key="markdown" 
                          onClick={() => handleDownloadFormat('markdown')}
                        >
                          Markdown
                        </DropdownItem>
                      </DropdownList>
                    </Dropdown>
                  </FlexItem>
                </Flex>
              </FlexItem>
            </Flex>
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
          {error === 'CONFIGURATION_REQUIRED' ? (
            <ConfigurationRequiredAlert onClose={() => setError(null)} />
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
                  {analysis && (
                    <Text component={TextVariants.small} style={{ 
                      color: '#7c3aed', 
                      marginLeft: '8px',
                      fontWeight: 'normal'
                    }}>
                      • {analysis.category} ({analysis.scope === 'cluster_wide' ? 'Cluster-wide' : analysis.namespace || 'Namespace'}) 
                      • {timeRange === 'custom' && customRangeLabel 
                          ? customRangeLabel 
                          : TIME_RANGE_OPTIONS.find(o => o.value === timeRange)?.label}
                    </Text>
                  )}
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
                    <Button 
                      variant="link" 
                      onClick={handleCancelAnalysis}
                      style={{ marginTop: '16px', color: 'var(--pf-v5-global--danger-color--100)' }}
                    >
                      Cancel Analysis
                    </Button>
                  </div>
                </Bullseye>
              ) : analysis ? (
                <div style={{ fontFamily: 'inherit', margin: 0, lineHeight: 1.6 }}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p style={{ marginBottom: '16px' }}>{children}</p>,
                      h1: ({ children }) => <h1 style={{ marginBottom: '12px', marginTop: '24px' }}>{children}</h1>,
                      h2: ({ children }) => <h2 style={{ marginBottom: '12px', marginTop: '24px' }}>{children}</h2>,
                      h3: ({ children }) => <h3 style={{ marginBottom: '8px', marginTop: '20px' }}>{children}</h3>,
                    }}
                  >
                    {analysis.summary}
                  </ReactMarkdown>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </PageSection>
      )}

      {/* Main Content */}
      <PageSection style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div style={{
          height: 'calc(100vh - 550px)',
          minHeight: '400px',
          width: '100%',
          maxWidth: '100%',
          overflow: 'hidden'
        }}>
          <Grid hasGutter span={GRID_SPAN_FULL} style={{ height: '100%' }}>
            {/* Metrics Panel */}
            <GridItem span={chatPanelOpen ? GRID_SPAN_METRICS_WITH_CHAT : GRID_SPAN_FULL}>
              <div style={{
                paddingLeft: 'var(--pf-v5-global--spacer--lg)',
                paddingRight: chatPanelOpen ? '8px' : 'var(--pf-v5-global--spacer--lg)',
                paddingBottom: 'var(--pf-v5-global--spacer--lg)',
                overflowY: 'auto',
                overflowX: 'hidden',
                height: '100%'
              }}>
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
              {timeRange === 'custom' && customRangeLabel 
                ? customRangeLabel 
                : `Last ${TIME_RANGE_OPTIONS.find(o => o.value === timeRange)?.label}`}
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
              </div>
            </GridItem>

            {/* Chat Panel */}
            {chatPanelOpen && (
              <GridItem span={GRID_SPAN_CHAT}>
                <div style={{
                  paddingLeft: '8px',
                  paddingRight: 'var(--pf-v5-global--spacer--lg)',
                  paddingBottom: 'var(--pf-v5-global--spacer--lg)',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  height: '100%'
                }}>
                  <MetricsChatPanel
                    scope={scope}
                    namespace={scope === 'namespace_scoped' ? selectedNamespace : undefined}
                    category={selectedCategory}
                    timeRange={timeRange === 'custom' && customRangeLabel ? customRangeLabel : timeRange}
                    isOpen={chatPanelOpen}
                    onClose={() => setChatPanelOpen(false)}
                  />
                </div>
              </GridItem>
            )}
          </Grid>
        </div>
      </PageSection>

      {/* Metric Chart Modal */}
      <MetricChartModal
        metric={selectedMetricData}
        isOpen={selectedMetricForChart !== null}
        onClose={handleCloseChart}
      />

      {/* Custom Date Range Picker Modal */}
      <CustomRangePickerModal
        isOpen={showCustomRangePicker}
        onClose={handleCustomRangeClose}
        onApply={handleCustomRangeApply}
      />
    </>
  );
};

export default OpenShiftMetricsPage;
