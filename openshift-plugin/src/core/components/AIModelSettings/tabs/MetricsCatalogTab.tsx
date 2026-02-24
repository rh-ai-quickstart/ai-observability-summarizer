import * as React from 'react';
import {
  Alert,
  AlertVariant,
  Badge,
  Button,
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
import { DownloadIcon } from '@patternfly/react-icons';
import { callMcpTool } from '../../../services/mcpClient';
import { downloadAsFile } from '../../../utils/downloadFile';

// Module-level cache — metrics catalog is static after MCP server startup,
// so we cache for the lifetime of the page session (cleared on page refresh).
let cachedData: { categories: any[]; details: Record<string, any> } | null = null;

/** Reset the module-level cache (exported for testing) */
export const resetMetricsCatalogCache = () => { cachedData = null; };

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

const matchesMetric = (metric: MetricEntry, lower: string): boolean =>
  metric.name.toLowerCase().includes(lower) ||
  (metric.help && metric.help.toLowerCase().includes(lower)) ||
  (metric.keywords && metric.keywords.some(kw => kw.toLowerCase().includes(lower)));

interface MetricsCatalogTabProps {
  downloadRef?: React.MutableRefObject<(() => void) | null>;
  hideHeader?: boolean;
}

export const MetricsCatalogTab: React.FC<MetricsCatalogTabProps> = ({ downloadRef, hideHeader }) => {
  const [categories, setCategories] = React.useState<CategorySummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [expandedCategories, setExpandedCategories] = React.useState<Record<string, boolean>>({});
  const [expandedPriorities, setExpandedPriorities] = React.useState<Record<string, boolean>>({});
  const [categoryDetails, setCategoryDetails] = React.useState<Record<string, CategoryDetail>>({});

  // Debounce the search term so input stays responsive while filtering is deferred
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  React.useEffect(() => {
    loadAllData();
  }, []);

  const parseMcpResponse = (response: any): any => {
    const text = typeof response === 'string' ? response : response?.text ?? response?.content?.[0]?.text ?? JSON.stringify(response);
    return typeof text === 'string' ? JSON.parse(text) : text;
  };

  const loadAllData = async () => {
    // Use cached data if available (static for the session lifetime)
    if (cachedData) {
      setCategories(cachedData.categories);
      setCategoryDetails(cachedData.details);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Load category summaries first
      const response = await callMcpTool<any>('get_category_metrics_detail');
      const parsed = parseMcpResponse(response);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }
      const cats: CategorySummary[] = Array.isArray(parsed) ? parsed : [];
      setCategories(cats);

      // Load all category details in parallel
      const detailResults = await Promise.allSettled(
        cats.map(cat => callMcpTool<any>('get_category_metrics_detail', { category_id: cat.id })),
      );
      const details: Record<string, CategoryDetail> = {};
      detailResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          try {
            const detail = parseMcpResponse(result.value);
            if (!detail.error) {
              details[cats[index].id] = detail;
            }
          } catch { /* skip malformed responses */ }
        }
      });
      setCategoryDetails(details);

      cachedData = { categories: cats, details };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics catalog');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = React.useCallback((categoryId: string, expanded: boolean) => {
    setExpandedCategories(prev => ({ ...prev, [categoryId]: expanded }));
  }, []);

  const handlePriorityToggle = React.useCallback((key: string, expanded: boolean) => {
    setExpandedPriorities(prev => ({ ...prev, [key]: expanded }));
  }, []);

  // Memoize filtered categories and their matching metrics (uses debounced search)
  const { filteredCategories, metricMatches } = React.useMemo(() => {
    if (!debouncedSearch) {
      return { filteredCategories: categories, metricMatches: {} as Record<string, { High: MetricEntry[]; Medium: MetricEntry[] }> };
    }
    const lower = debouncedSearch.toLowerCase();
    const matches: Record<string, { High: MetricEntry[]; Medium: MetricEntry[] }> = {};
    const filtered = categories.filter(cat => {
      // Match on category name or description
      if (cat.name.toLowerCase().includes(lower) || cat.description.toLowerCase().includes(lower)) {
        return true;
      }
      // Match on individual metrics
      const detail = categoryDetails[cat.id];
      if (detail) {
        const high = detail.metrics.High?.filter(m => matchesMetric(m, lower)) || [];
        const medium = detail.metrics.Medium?.filter(m => matchesMetric(m, lower)) || [];
        if (high.length > 0 || medium.length > 0) {
          matches[cat.id] = { High: high, Medium: medium };
          return true;
        }
      }
      return false;
    });
    return { filteredCategories: filtered, metricMatches: matches };
  }, [debouncedSearch, categories, categoryDetails]);

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

  const handleDownloadCatalog = React.useCallback(() => {
    const timestamp = new Date().toISOString();
    const totalMetrics = categories.reduce((sum, c) => sum + c.metric_count, 0);
    const totalHigh = categories.reduce((sum, c) => sum + (c.priority_distribution?.High || 0), 0);
    const totalMedium = categories.reduce((sum, c) => sum + (c.priority_distribution?.Medium || 0), 0);

    let md = `# Chat - Metrics Catalog\n\n`;
    md += `## Overview\n\n`;
    md += `This document organizes **${totalMetrics} metrics** into **${categories.length} logical categories** for the AI Chat metrics catalog.\n\n`;
    md += `> Generated: ${timestamp}\n\n`;
    md += `### Priority Levels\n\n`;
    md += `- 🔴 **High** - Critical operational metrics (cluster health, resource usage, errors)\n`;
    md += `- 🟡 **Medium** - Important monitoring metrics (throughput, counts, latencies)\n\n`;

    // Category summary table
    md += `## Category Summary\n\n`;
    md += `| Category | Icon | Metrics | High | Medium |\n`;
    md += `|----------|------|---------|------|--------|\n`;
    categories.forEach(cat => {
      const high = cat.priority_distribution?.High || 0;
      const medium = cat.priority_distribution?.Medium || 0;
      md += `| ${cat.name} | ${cat.icon} | ${cat.metric_count} | 🔴 ${high} | 🟡 ${medium} |\n`;
    });
    md += `| **TOTAL** | | **${totalMetrics}** | **🔴 ${totalHigh}** | **🟡 ${totalMedium}** |\n\n`;
    md += `---\n\n`;

    // Detailed categories with collapsible sections
    md += `## Detailed Categories\n\n`;
    categories.forEach(cat => {
      const detail = categoryDetails[cat.id];
      const high = cat.priority_distribution?.High || 0;
      const medium = cat.priority_distribution?.Medium || 0;
      md += `### ${cat.icon} ${cat.name}\n\n`;
      md += `**Purpose:** ${detail?.purpose || cat.description}\n\n`;
      md += `**Metrics:** ${cat.metric_count} total (🔴 ${high} High, 🟡 ${medium} Medium)\n\n`;

      if (detail) {
        md += `<details>\n<summary><b>📋 View all ${cat.metric_count} metrics</b></summary>\n\n`;
        md += `| # | Priority | Metric Name | Type |\n`;
        md += `|---|----------|-------------|------|\n`;
        let idx = 1;
        (['High', 'Medium'] as const).forEach(priority => {
          const emoji = priority === 'High' ? '🔴 High' : '🟡 Medium';
          const metrics = detail.metrics[priority];
          if (metrics) {
            metrics.forEach(m => {
              md += `| ${idx++} | ${emoji} | \`${m.name}\` | ${m.type} |\n`;
            });
          }
        });
        md += `\n</details>\n\n`;
      }
    });

    md += `---\n*Generated by OpenShift AI Observability Plugin*\n`;
    downloadAsFile(md, `metrics-catalog-${Date.now()}.md`);
  }, [categories, categoryDetails]);

  // Register download handler on the ref so the parent wrapper can trigger it
  React.useEffect(() => {
    if (downloadRef) {
      downloadRef.current = handleDownloadCatalog;
    }
    return () => {
      if (downloadRef) {
        downloadRef.current = null;
      }
    };
  }, [downloadRef, handleDownloadCatalog]);

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
      {!hideHeader && (
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '16px' }}>
          <FlexItem>
            <TextContent>
              <Text component={TextVariants.h4}>Metrics Catalog</Text>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                Browse all available metric categories and their metrics. Expand a category to see its metrics with details and keywords.
              </Text>
            </TextContent>
          </FlexItem>
          <FlexItem>
            <Button
              variant="secondary"
              icon={<DownloadIcon />}
              onClick={handleDownloadCatalog}
              isDisabled={categories.length === 0}
              aria-label="Download metrics catalog as markdown"
            >
              Download
            </Button>
          </FlexItem>
        </Flex>
      )}

      <SearchInput
        placeholder="Search categories and metrics..."
        value={searchTerm}
        onChange={(_evt, value) => setSearchTerm(value)}
        onClear={() => setSearchTerm('')}
        style={{ marginBottom: '16px' }}
        aria-label="Search categories and metrics"
      />

      {filteredCategories.length === 0 ? (
        <TextContent>
          <Text component={TextVariants.p} style={{ color: 'var(--pf-v5-global--Color--200)', textAlign: 'center', padding: '20px' }}>
            No categories or metrics match the search.
          </Text>
        </TextContent>
      ) : (
        filteredCategories.map(cat => {
          const hasMetricMatch = !!metricMatches[cat.id];
          // Only auto-expand when few categories match to avoid creating
          // massive DOM (e.g. searching "v" matches nearly every category).
          const shouldAutoExpand = hasMetricMatch && filteredCategories.length <= 2;
          const isExpanded = expandedCategories[cat.id] || shouldAutoExpand || false;
          const metricMatchCount = metricMatches[cat.id]
            ? (metricMatches[cat.id].High?.length || 0) + (metricMatches[cat.id].Medium?.length || 0)
            : 0;

          // Only render metric content when category is actually visible (expanded)
          // This avoids creating ~1,877 DOM nodes for collapsed categories
          let content: React.ReactNode = null;
          if (isExpanded) {
            const displayMetrics = metricMatches[cat.id] || (categoryDetails[cat.id]?.metrics ?? null);
            const matchCount = metricMatches[cat.id]
              ? (metricMatches[cat.id].High?.length || 0) + (metricMatches[cat.id].Medium?.length || 0)
              : null;

            content = displayMetrics ? (
              <div style={{ padding: '8px 0' }}>
                {categoryDetails[cat.id]?.purpose && !hasMetricMatch && (
                  <TextContent style={{ marginBottom: '12px' }}>
                    <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                      {categoryDetails[cat.id].purpose}
                    </Text>
                  </TextContent>
                )}
                {matchCount !== null && (
                  <TextContent style={{ marginBottom: '8px' }}>
                    <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                      Showing {matchCount} of {cat.metric_count} metrics matching &quot;{searchTerm}&quot;
                    </Text>
                  </TextContent>
                )}
                {renderMetricList(displayMetrics.High, 'High', cat.id)}
                {renderMetricList(displayMetrics.Medium, 'Medium', cat.id)}
              </div>
            ) : null;
          }

          return (
            <ExpandableSection
              key={cat.id}
              isExpanded={isExpanded}
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
                    {hasMetricMatch && metricMatchCount > 0 && (
                      <Badge style={{ marginLeft: '6px' }}>{metricMatchCount} match{metricMatchCount !== 1 ? 'es' : ''}</Badge>
                    )}
                  </FlexItem>
                </Flex>
              }
              isIndented
              style={{ marginBottom: '8px' }}
            >
              {content}
            </ExpandableSection>
          );
        })
      )}
    </div>
  );
};
