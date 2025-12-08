import * as React from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  Grid,
  GridItem,
  Spinner,
  Text,
  TextContent,
  TextVariants,
  Bullseye,
} from '@patternfly/react-core';
import { MetricCard } from './MetricCard';

// Local interfaces (legacy component - kept for backward compatibility)
interface MetricData {
  name: string;
  value: number;
  unit?: string;
  changePercent?: number;
}

interface MetricCategory {
  category: string;
  metrics: MetricData[];
}

export interface MetricCategoryViewProps {
  categories: MetricCategory[];
  loading?: boolean;
  error?: string | null;
}

const formatMetricValue = (metric: MetricData): { value: string; unit?: string } => {
  const val = metric.value;
  
  if (typeof val === 'string') {
    return { value: val };
  }
  
  const name = metric.name.toLowerCase();
  
  if (name.includes('percent') || name.includes('ratio') || name.includes('utilization')) {
    return { value: (val * 100).toFixed(1), unit: '%' };
  }
  
  if (name.includes('bytes')) {
    if (val >= 1e9) return { value: (val / 1e9).toFixed(2), unit: 'GB' };
    if (val >= 1e6) return { value: (val / 1e6).toFixed(2), unit: 'MB' };
    if (val >= 1e3) return { value: (val / 1e3).toFixed(2), unit: 'KB' };
    return { value: val.toString(), unit: 'B' };
  }
  
  if (name.includes('seconds') || name.includes('latency') || name.includes('duration')) {
    if (val >= 1) return { value: val.toFixed(2), unit: 's' };
    if (val >= 0.001) return { value: (val * 1000).toFixed(2), unit: 'ms' };
    return { value: (val * 1e6).toFixed(2), unit: 'μs' };
  }
  
  if (name.includes('requests') || name.includes('tokens')) {
    if (val >= 1e6) return { value: (val / 1e6).toFixed(2), unit: 'M' };
    if (val >= 1e3) return { value: (val / 1e3).toFixed(2), unit: 'K' };
  }
  
  if (Number.isInteger(val)) {
    return { value: val.toLocaleString() };
  }
  return { value: val.toFixed(2) };
};

const formatMetricName = (name: string): string => {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

export const MetricCategoryView: React.FC<MetricCategoryViewProps> = ({
  categories,
  loading = false,
  error = null,
}) => {
  if (loading) {
    return (
      <Bullseye>
        <Spinner size="xl" />
      </Bullseye>
    );
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <TextContent>
            <Text component="p" style={{ color: 'var(--pf-global--danger-color--100)' }}>
              Error loading metrics: {error}
            </Text>
          </TextContent>
        </CardBody>
      </Card>
    );
  }

  if (!categories || categories.length === 0) {
    return (
      <Card>
        <CardBody>
          <TextContent>
            <Text component="p">No metrics available</Text>
          </TextContent>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      {categories.map((category) => (
        <Card key={category.category} style={{ marginBottom: '16px' }}>
          <CardTitle>
            <Text component={TextVariants.h3}>{formatMetricName(category.category)}</Text>
          </CardTitle>
          <CardBody>
            <Grid hasGutter>
              {category.metrics.map((metric, index) => {
                const { value, unit } = formatMetricValue(metric);
                return (
                  <GridItem key={`${metric.name}-${index}`} sm={12} md={6} lg={4} xl={3}>
                    <MetricCard
                      title={formatMetricName(metric.name)}
                      value={value}
                      unit={unit}
                    />
                  </GridItem>
                );
              })}
            </Grid>
          </CardBody>
        </Card>
      ))}
    </>
  );
};

export default MetricCategoryView;
