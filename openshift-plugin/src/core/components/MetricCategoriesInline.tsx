import * as React from 'react';
import {
  Card,
  CardBody,
  Grid,
  GridItem,
  Text,
  TextVariants,
  ExpandableSection,
  Spinner,
  Alert,
  AlertVariant,
  FormSelect,
  FormSelectOption,
} from '@patternfly/react-core';
import { callMcpTool } from '../services/mcpClient';
import { CategorySummary, getQuestionsForCategory, NAMESPACE_SCOPED_CATEGORIES } from './MetricCategoriesPopover';
import { ChatScope } from '../data/namespaceDefaults';

interface MetricCategoriesInlineProps {
  onSelectQuestion: (question: string) => void;
  onCategorySelect: (categoryName: string | null) => void;
  isExpanded: boolean;
  onToggle: (expanded: boolean) => void;
  chatScope?: ChatScope;
  selectedNamespace?: string | null;
}

export const MetricCategoriesInline: React.FC<MetricCategoriesInlineProps> = ({
  onSelectQuestion,
  onCategorySelect,
  isExpanded,
  onToggle,
  chatScope = 'cluster_wide',
  selectedNamespace = null,
}) => {
  const [categories, setCategories] = React.useState<CategorySummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = React.useState('');
  const loadedRef = React.useRef(false);

  React.useEffect(() => {
    if (loadedRef.current) return;
    loadCategories();
  }, []);

  // Reload categories when scope changes
  React.useEffect(() => {
    if (loadedRef.current) {
      loadCategories();
      setSelectedCategoryId(''); // Reset category selection when scope changes
      onCategorySelect(null); // Notify parent that category selection is cleared
    }
  }, [chatScope]);

  const loadCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await callMcpTool<any>('get_category_metrics_detail');
      loadedRef.current = true;
      const text =
        typeof response === 'string'
          ? response
          : response?.text ?? response?.content?.[0]?.text ?? JSON.stringify(response);
      const parsed = typeof text === 'string' ? JSON.parse(text) : text;
      if (parsed.error) {
        setError(parsed.error);
      } else {
        const allCategories = Array.isArray(parsed) ? parsed : [];

        // Simple static filtering based on scope
        const filteredCategories = chatScope === 'namespace_scoped'
          ? allCategories.filter(cat => NAMESPACE_SCOPED_CATEGORIES.includes(cat.id))
          : allCategories;

        setCategories(filteredCategories);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) || null;

  const handleCategoryChange = (_event: React.FormEvent<HTMLSelectElement>, value: string) => {
    setSelectedCategoryId(value);
    const cat = categories.find((c) => c.id === value) || null;
    onCategorySelect(cat ? cat.name : null);
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
          <Spinner size="lg" aria-label="Loading metric categories" />
        </div>
      );
    }

    if (error) {
      return (
        <Alert variant={AlertVariant.danger} title="Error loading categories" isInline>
          {error}
        </Alert>
      );
    }

    if (categories.length === 0) {
      return (
        <Text component={TextVariants.p} style={{ padding: '20px', textAlign: 'center', color: 'var(--pf-v5-global--Color--200)' }}>
          No metric categories available.
        </Text>
      );
    }

    const questions = selectedCategory ? getQuestionsForCategory(selectedCategory, chatScope, selectedNamespace) : [];

    return (
      <div>
        {/* Category dropdown */}
        <div style={{ display: 'inline-block' }}>
          <FormSelect
            id="metric-category-select"
            value={selectedCategoryId}
            onChange={handleCategoryChange}
            aria-label="Select a metric category"
          >
            <FormSelectOption isPlaceholder value="" label="Select a category..." />
            {categories.map((cat) => (
              <FormSelectOption
                key={cat.id}
                value={cat.id}
                label={`${cat.icon} ${cat.name} (${cat.metric_count} metrics)`}
              />
            ))}
          </FormSelect>
        </div>

        {/* Suggested questions for selected category */}
        {selectedCategory && (
          <div style={{ marginTop: '16px' }}>
            <Text
              component={TextVariants.small}
              style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: '12px' }}
            >
              Suggested questions for {selectedCategory.name}:
            </Text>
            <Grid hasGutter>
              {questions.map((question, index) => (
                <GridItem key={index} md={6} sm={12}>
                  <Card
                    isClickable
                    isCompact
                    onClick={() => onSelectQuestion(question)}
                    style={{
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      border: '1px solid var(--pf-v5-global--BorderColor--100)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(124, 58, 237, 0.15)';
                      e.currentTarget.style.borderColor = 'var(--pf-v5-global--primary-color--100)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                      e.currentTarget.style.borderColor = 'var(--pf-v5-global--BorderColor--100)';
                    }}
                  >
                    <CardBody style={{ padding: '12px 16px' }}>
                      <Text component={TextVariants.p} style={{ margin: 0, fontSize: '13px' }}>
                        {question}
                      </Text>
                    </CardBody>
                  </Card>
                </GridItem>
              ))}
            </Grid>
          </div>
        )}
      </div>
    );
  };

  return (
    <ExpandableSection
      toggleText={isExpanded ? 'Hide metric categories' : 'Browse metric categories'}
      onToggle={(_event, expanded) => onToggle(expanded)}
      isExpanded={isExpanded}
      displaySize="lg"
    >
      <div style={{ marginTop: '8px' }}>
        {renderContent()}
      </div>
    </ExpandableSection>
  );
};

export default MetricCategoriesInline;
