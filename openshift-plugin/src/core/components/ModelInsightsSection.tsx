import * as React from 'react';
import {
  Alert,
  AlertVariant,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Spinner,
  Text,
  TextContent,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import { ChartDonut, ChartThemeColor } from '@patternfly/react-charts';
import {
  detectProviderFromModelId,
  fetchVLLMMetrics,
  VLLMMetricsResponse,
} from '../services/mcpClient';
import type { ModelInfo } from '../services/mcpClient';

export interface DonutDatum {
  x: string;
  y: number;
}

interface InsightDonutCardProps {
  title: string;
  subtitle: string;
  data: DonutDatum[];
  totalLabel: string;
  colorScale?: string[];
}

const InsightDonutCard: React.FC<InsightDonutCardProps> = ({
  title,
  subtitle,
  data,
  totalLabel,
  colorScale,
}) => {
  const legendData = data.map((datum) => ({
    name: `${datum.x} (${datum.y})`,
  }));

  return (
    <Card isCompact style={{ height: '100%' }}>
      <CardTitle>
        <TextContent>
          <Text component={TextVariants.h3} style={{ marginBottom: '4px' }}>
            {title}
          </Text>
          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
            {subtitle}
          </Text>
        </TextContent>
      </CardTitle>
      <CardBody>
        <ChartDonut
          ariaDesc={title}
          ariaTitle={title}
          data={data}
          labels={({ datum }) => `${datum.x}: ${datum.y}`}
          width={220}
          height={220}
          legendData={legendData}
          legendPosition="bottom"
          padding={{ top: 20, bottom: 60, left: 20, right: 20 }}
          themeColor={ChartThemeColor.multiOrdered}
          colorScale={colorScale}
          title={totalLabel}
          subTitle="Models"
        />
      </CardBody>
    </Card>
  );
};

interface ModelInsightsSectionProps {
  loading: boolean;
  error: string | null;
  models: ModelInfo[];
}

const PERFORMANCE_THRESHOLDS = {
  // Metrics are labeled in seconds in the MCP response.
  critical: {
    p95Seconds: 5,
    inferenceSeconds: 3,
  },
  warning: {
    p95Seconds: 2,
    inferenceSeconds: 1.5,
  },
} as const;

export const ModelInsightsSection: React.FC<ModelInsightsSectionProps> = ({
  loading,
  error,
  models,
}) => {
  const [metricsLoading, setMetricsLoading] = React.useState(true);
  const [metricsError, setMetricsError] = React.useState<string | null>(null);
  const [performanceCounts, setPerformanceCounts] = React.useState<Record<string, number>>({});

  const buildDonutData = React.useCallback((items: Record<string, number>): DonutDatum[] => {
    const entries = Object.entries(items)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      return [{ x: 'No data', y: 1 }];
    }

    return entries.map(([label, value]) => ({ x: label, y: value }));
  }, []);

  const formatProviderLabel = (value: string): string =>
    value
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const resolveProvider = (modelName: string): string => {
    const detected = detectProviderFromModelId(modelName);
    if (detected) {
      return formatProviderLabel(detected);
    }

    const prefix = modelName.includes('/') ? modelName.split('/')[0].toLowerCase() : '';
    return prefix ? formatProviderLabel(prefix) : 'Unknown';
  };

  const classifyPerformance = (metrics: VLLMMetricsResponse | null): string => {
    if (!metrics?.metrics) {
      return 'No data';
    }

    const p95 = metrics.metrics['P95 Latency (s)']?.latest_value;
    const inference = metrics.metrics['Inference Time (s)']?.latest_value;

    const p95Value = Number.isFinite(p95) ? (p95 as number) : null;
    const inferenceValue = Number.isFinite(inference) ? (inference as number) : null;

    if (p95Value === null && inferenceValue === null) {
      return 'No data';
    }

    if (
      (p95Value !== null && p95Value >= PERFORMANCE_THRESHOLDS.critical.p95Seconds) ||
      (inferenceValue !== null &&
        inferenceValue >= PERFORMANCE_THRESHOLDS.critical.inferenceSeconds)
    ) {
      return 'Critical';
    }

    if (
      (p95Value !== null && p95Value >= PERFORMANCE_THRESHOLDS.warning.p95Seconds) ||
      (inferenceValue !== null && inferenceValue >= PERFORMANCE_THRESHOLDS.warning.inferenceSeconds)
    ) {
      return 'Warning';
    }

    return 'Healthy';
  };

  React.useEffect(() => {
    let isMounted = true;

    const loadInsights = async () => {
      if (loading) {
        setMetricsLoading(true);
        return;
      }

      setMetricsLoading(true);
      setMetricsError(null);

      try {
        if (models.length === 0) {
          setPerformanceCounts({ 'No data': 1 });
          return;
        }

        const performanceMetrics = await Promise.all(
          models.map(async (model) => ({
            model,
            metrics: await fetchVLLMMetrics(model.name, '1h', model.namespace),
          })),
        );

        const counts: Record<string, number> = {
          Healthy: 0,
          Warning: 0,
          Critical: 0,
          'No data': 0,
        };

        performanceMetrics.forEach(({ metrics }) => {
          const bucket = classifyPerformance(metrics);
          counts[bucket] = (counts[bucket] || 0) + 1;
        });

        if (isMounted) {
          setPerformanceCounts(counts);
        }
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setMetricsError('Failed to load model insights');
      } finally {
        if (isMounted) {
          setMetricsLoading(false);
        }
      }
    };

    loadInsights();

    return () => {
      isMounted = false;
    };
  }, [loading, models]);

  const providerCounts = React.useMemo(
    () =>
      models.reduce<Record<string, number>>((acc, model) => {
        const provider = resolveProvider(model.name);
        acc[provider] = (acc[provider] || 0) + 1;
        return acc;
      }, {}),
    [models],
  );

  const departmentCounts = React.useMemo(
    () =>
      models.reduce<Record<string, number>>((acc, model) => {
        acc[model.namespace] = (acc[model.namespace] || 0) + 1;
        return acc;
      }, {}),
    [models],
  );

  const providerData = buildDonutData(providerCounts);
  const performanceData = buildDonutData(performanceCounts);
  const departmentData = buildDonutData(departmentCounts);
  const totalModelsLabel = `${models.length || 0}`;

  if (loading || metricsLoading) {
    return (
      <div style={{ marginTop: '32px' }}>
        <Title headingLevel="h2" size="lg" style={{ marginBottom: '16px' }}>
          Model Insights
        </Title>
        <Card isCompact>
          <CardBody>
            <Bullseye style={{ minHeight: '240px' }}>
              <TextContent style={{ textAlign: 'center' }}>
                <Flex
                  alignItems={{ default: 'alignItemsCenter' }}
                  justifyContent={{ default: 'justifyContentCenter' }}
                >
                  <FlexItem>
                    <Spinner size="lg" />
                  </FlexItem>
                  <FlexItem>
                    <Text component={TextVariants.h3} style={{ marginBottom: 0 }}>
                      Loading model insights
                    </Text>
                  </FlexItem>
                </Flex>
                <Text
                  component={TextVariants.small}
                  style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '8px' }}
                >
                  Charts will appear once data is available.
                </Text>
              </TextContent>
            </Bullseye>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '32px' }}>
      {(error || metricsError) && (
        <Alert
          variant={AlertVariant.warning}
          title="Model Insights Unavailable"
          style={{ marginBottom: '16px' }}
        >
          {error || metricsError}. Some charts may be unavailable.
        </Alert>
      )}
      <Title headingLevel="h2" size="lg" style={{ marginBottom: '16px' }}>
        Model Insights
      </Title>
      <Grid hasGutter>
        <GridItem lg={4} md={6} sm={12}>
          <InsightDonutCard
            title="Models by Provider"
            subtitle="Distribution of deployed models"
            data={providerData}
            totalLabel={totalModelsLabel}
            colorScale={['#0066cc', '#8bc1f7', '#3e8635', '#f0ab00', '#7c3aed']}
          />
        </GridItem>
        <GridItem lg={4} md={6} sm={12}>
          <InsightDonutCard
            title="Model Performance"
            subtitle="Inferred health based on performance metrics"
            data={performanceData}
            totalLabel={totalModelsLabel}
            colorScale={['#3e8635', '#f0ab00', '#c9190b', '#6a6e73']}
          />
        </GridItem>
        <GridItem lg={4} md={6} sm={12}>
          <InsightDonutCard
            title="Models by Namespace"
            subtitle="Namespaces with vLLM deployments"
            data={departmentData}
            totalLabel={totalModelsLabel}
            colorScale={['#7c3aed', '#2b9af3', '#f4c145', '#5752d1', '#6a6e73']}
          />
        </GridItem>
      </Grid>
    </div>
  );
};
