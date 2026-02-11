import * as React from 'react';
import {
  Alert,
  AlertVariant,
  Badge,
  ExpandableSection,
  Flex,
  FlexItem,
  Label,
  SearchInput,
  Spinner,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { callMcpTool } from '../../../services/mcpClient';

interface CategorySummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  metric_count: number;
  priority_distribution: { High: number; Medium: number };
}

interface MetricEntry {
  name: string;
  type: string;
  help: string;
  keywords: string[];
}

interface CategoryDetail {
  id: string;
  name: string;
  description: string;
  icon: string;
  purpose: string;
  total_metrics: number;
  metrics: { High: MetricEntry[]; Medium: MetricEntry[] };
}

export const MetricsCatalogTab: React.FC = () => {
  const [categories, setCategories] = React.useState<CategorySummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [expandedCategories, setExpandedCategories] = React.useState<Record<string, boolean>>({});
  const [expandedPriorities, setExpandedPriorities] = React.useState<Record<string, boolean>>({});
  const [categoryDetails, setCategoryDetails] = React.useState<Record<string, CategoryDetail>>({});
  const [loadingDetails, setLoadingDetails] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await callMcpTool<any>('get_metrics_categories_json');
      const text = typeof response === 'string' ? response : response?.text ?? response?.content?.[0]?.text ?? JSON.stringify(response);
      const parsed = typeof text === 'string' ? JSON.parse(text) : text;
      if (parsed.error) {
        setError(parsed.error);
      } else {
        setCategories(Array.isArray(parsed) ? parsed : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics categories');
    } finally {
      setLoading(false);
    }
  };

  const loadCategoryDetail = async (categoryId: string) => {
    if (categoryDetails[categoryId]) return;
    setLoadingDetails(prev => ({ ...prev, [categoryId]: true }));
    try {
      const response = await callMcpTool<any>('get_category_metrics_detail', { category_id: categoryId });
      const text = typeof response === 'string' ? response : response?.text ?? response?.content?.[0]?.text ?? JSON.stringify(response);
      const parsed: CategoryDetail = typeof text === 'string' ? JSON.parse(text) : text;
      if ((parsed as any).error) {
        setError((parsed as any).error);
      } else {
        setCategoryDetails(prev => ({ ...prev, [categoryId]: parsed }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to load details for ${categoryId}`);
    } finally {
      setLoadingDetails(prev => ({ ...prev, [categoryId]: false }));
    }
  };

  const handleToggle = (categoryId: string, expanded: boolean) => {
    setExpandedCategories(prev => ({ ...prev, [categoryId]: expanded }));
    if (expanded) {
      loadCategoryDetail(categoryId);
    }
  };

  const filteredCategories = categories.filter(cat =>
    cat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cat.description.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handlePriorityToggle = (key: string, expanded: boolean) => {
    setExpandedPriorities(prev => ({ ...prev, [key]: expanded }));
  };

  const renderMetricList = (metrics: MetricEntry[], priority: string, categoryId: string) => {
    if (!metrics || metrics.length === 0) return null;
    const priorityKey = `${categoryId}-${priority}`;
    const isExpanded = expandedPriorities[priorityKey] ?? true; // default expanded
    const borderColor = priority === 'High' ? 'var(--pf-v5-global--danger-color--100)' : 'var(--pf-v5-global--info-color--100)';

    return (
      <ExpandableSection
        isExpanded={isExpanded}
        onToggle={(_evt, expanded) => handlePriorityToggle(priorityKey, expanded)}
        toggleContent={
          <Flex alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>
              <Text component={TextVariants.h5} style={{ margin: 0 }}>
                {priority} Priority
              </Text>
            </FlexItem>
            <FlexItem>
              <Badge isRead>{metrics.length}</Badge>
            </FlexItem>
          </Flex>
        }
        isIndented
        style={{ marginBottom: '12px' }}
      >
        {metrics.map(metric => (
          <div
            key={metric.name}
            style={{
              padding: '8px 12px',
              marginBottom: '6px',
              borderLeft: `3px solid ${borderColor}`,
              backgroundColor: 'var(--pf-v5-global--BackgroundColor--200)',
              borderRadius: '2px',
            }}
          >
            <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '4px' }}>
              <FlexItem>
                <Text component={TextVariants.small} style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {metric.name}
                </Text>
              </FlexItem>
              <FlexItem>
                <Label isCompact color="blue">{metric.type}</Label>
              </FlexItem>
            </Flex>
            {metric.help && (
              <div style={{ marginBottom: '4px' }}>
                <Text component={TextVariants.small} style={{ fontWeight: 600, marginRight: '4px' }}>
                  Description:
                </Text>
                <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', display: 'inline' }}>
                  {metric.help}
                </Text>
              </div>
            )}
            {metric.keywords && metric.keywords.length > 0 && (
              <div style={{ marginTop: '4px' }}>
                <Text component={TextVariants.small} style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                  Keywords:
                </Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {metric.keywords.map(kw => (
                    <Label key={kw} isCompact color="grey" variant="outline">{kw}</Label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </ExpandableSection>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
        <Spinner size="lg" aria-label="Loading metrics catalog" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant={AlertVariant.danger} title="Error loading metrics catalog" isInline style={{ marginTop: '16px' }}>
        {error}
      </Alert>
    );
  }

  return (
    <div style={{ marginTop: '16px' }}>
      <TextContent style={{ marginBottom: '16px' }}>
        <Text component={TextVariants.h4}>Metrics Catalog</Text>
        <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
          Browse all available metric categories and their metrics. Expand a category to see its metrics with details and keywords.
        </Text>
      </TextContent>

      <SearchInput
        placeholder="Filter categories..."
        value={searchTerm}
        onChange={(_evt, value) => setSearchTerm(value)}
        onClear={() => setSearchTerm('')}
        style={{ marginBottom: '16px' }}
        aria-label="Filter categories"
      />

      {filteredCategories.length === 0 ? (
        <TextContent>
          <Text component={TextVariants.p} style={{ color: 'var(--pf-v5-global--Color--200)', textAlign: 'center', padding: '20px' }}>
            No categories match the filter.
          </Text>
        </TextContent>
      ) : (
        filteredCategories.map(cat => (
          <ExpandableSection
            key={cat.id}
            isExpanded={expandedCategories[cat.id] || false}
            onToggle={(_evt, expanded) => handleToggle(cat.id, expanded)}
            toggleContent={
              <Flex alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem>
                  <span style={{ marginRight: '8px' }}>{cat.icon}</span>
                </FlexItem>
                <FlexItem>
                  <Text component={TextVariants.h4} style={{ margin: 0 }}>
                    {cat.name}
                  </Text>
                </FlexItem>
                <FlexItem style={{ marginLeft: 'auto' }}>
                  <Badge isRead>{cat.metric_count} metrics</Badge>
                </FlexItem>
              </Flex>
            }
            isIndented
            style={{ marginBottom: '8px' }}
          >
            {loadingDetails[cat.id] ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                <Spinner size="md" aria-label={`Loading ${cat.name} details`} />
              </div>
            ) : categoryDetails[cat.id] ? (
              <div style={{ padding: '8px 0' }}>
                {categoryDetails[cat.id].purpose && (
                  <TextContent style={{ marginBottom: '12px' }}>
                    <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                      {categoryDetails[cat.id].purpose}
                    </Text>
                  </TextContent>
                )}
                {renderMetricList(categoryDetails[cat.id].metrics.High, 'High', cat.id)}
                {renderMetricList(categoryDetails[cat.id].metrics.Medium, 'Medium', cat.id)}
              </div>
            ) : null}
          </ExpandableSection>
        ))
      )}
    </div>
  );
};
