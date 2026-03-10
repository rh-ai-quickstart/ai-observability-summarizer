import * as React from 'react';
import {
  Button,
  Popover,
  Card,
  CardBody,
  Text,
  TextVariants,
  Flex,
  FlexItem,
  Divider,
  Spinner,
  Badge,
  Alert,
  AlertVariant,
} from '@patternfly/react-core';
import {
  ListIcon,
  ArrowLeftIcon,
} from '@patternfly/react-icons';
import { callMcpTool } from '../services/mcpClient';
import { ChatScope } from '../data/namespaceDefaults';

export interface CategorySummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  metric_count: number;
}

/**
 * Category IDs that are relevant when viewing namespace-scoped metrics.
 * These categories focus on workload-specific metrics rather than cluster infrastructure.
 */
export const NAMESPACE_SCOPED_CATEGORIES = [
  'gpu_ai',           // GPU and AI/ML workloads (vLLM, KServe, etc.)
  'pod_container',    // Pod and container metrics
  'networking',       // Network traffic and service mesh
  'storage',          // PVC and storage usage
  'resource_quota',   // Resource quotas and limits (if exists in backend)
  'http_grpc',        // HTTP/gRPC application metrics
  'go_runtime',       // Application runtime metrics
];

export const CATEGORY_QUESTIONS: Record<string, string[]> = {
  cluster_health: [
    "What's the overall health of my cluster?",
    'Are there any degraded cluster operators?',
    'Show me cluster resource utilization trends',
    'What is the current cluster version and status?',
  ],
  node_hardware: [
    'Are there any nodes with resource pressure?',
    'Show me node CPU and memory utilization',
    'Which nodes have the highest resource usage?',
    'Are there any nodes approaching capacity limits?',
  ],
  pod_container: [
    'Which pods are consuming the most resources?',
    'Are there any pods in CrashLoopBackOff or error state?',
    'Show me container restart trends',
    'What are the resource limits vs actual usage for my pods?',
  ],
  api_server: [
    'What is the API server request latency?',
    'Are there any API server errors or throttling?',
    'Show me API server request rate trends',
    'Are there any slow admission webhooks?',
  ],
  networking: [
    'Show me network traffic and bandwidth usage',
    'Are there any DNS resolution issues?',
    'What is the current service mesh latency?',
    'Are there any network policy violations or drops?',
  ],
  storage: [
    'Are there any persistent volumes running low on space?',
    'Show me storage IOPS and throughput',
    'What is the current PVC utilization?',
    'Are there any stuck or pending volume claims?',
  ],
  observability: [
    'Is Prometheus scraping all targets successfully?',
    'Are there any firing alerts in Alertmanager?',
    'Show me Prometheus storage and memory usage',
    'What is the current metric ingestion rate?',
  ],
  etcd: [
    'What is the etcd cluster health and leader status?',
    'Show me etcd disk fsync and commit latency',
    'Are there any slow etcd requests?',
    'What is the current etcd database size?',
  ],
  scheduler: [
    'Show me scheduling latency and queue depth',
    'Are there any pending pods waiting to be scheduled?',
    'What is the current scheduling throughput?',
    'Are pods being preempted frequently?',
  ],
  security: [
    'Are there any authentication failures?',
    'Show me certificate expiration status',
    'What is the current RBAC authorization rate?',
    'Are there any security-related alerts?',
  ],
  gpu_ai: [
    "What's the current GPU utilization across all models?",
    'Are there any GPU memory pressure issues?',
    'Summarize the health of my vLLM deployments',
    'Show me GPU power consumption and temperature trends',
    'Which models are consuming the most GPU resources?',
    'What are the current token generation rates and latency?',
    'Check KV cache efficiency and hit rates',
    'Show me vLLM throughput and queue depth trends',
  ],
  image_registry: [
    'Show me image registry request rates and errors',
    'Are there any failing builds?',
    'What is the image registry storage usage?',
    'Show me build duration trends',
  ],
  kubelet: [
    'Are there any kubelet operation errors?',
    'Show me container runtime performance',
    'What is the PLEG (Pod Lifecycle Event Generator) latency?',
    'Are there any volume mount issues?',
  ],
  controller_manager: [
    'Show me controller reconciliation rates',
    'Are there any controller errors or slow reconciliations?',
    'What is the controller work queue depth?',
    'Show me controller manager resource usage',
  ],
  openshift_specific: [
    'What is the status of OpenShift operators?',
    'Are there any degraded OpenShift components?',
    'Show me OpenShift-specific resource usage',
    'What is the current cluster operator status?',
  ],
  backup_dr: [
    'What is the status of recent backup jobs?',
    'Show me backup duration and success rates',
    'Are there any failed backup operations?',
    'What is the current backup storage usage?',
  ],
  go_runtime: [
    'Show me Go runtime memory usage across components',
    'Are there any goroutine leaks?',
    'What is the GC pause time for key services?',
    'Show me process CPU and memory trends',
  ],
  http_grpc: [
    'Show me HTTP/gRPC request rates and error rates',
    'What are the current request latency percentiles?',
    'Are there any failing gRPC connections?',
    'Show me request throughput trends',
  ],
  other: [
    'Show me any uncategorized metrics of interest',
    'Are there any unusual metric patterns?',
    'What metrics are available that might need categorization?',
    'Summarize the uncategorized metric trends',
  ],
};

/**
 * Namespace-scoped versions of category questions.
 * These questions are phrased to focus on the selected namespace.
 */
export const NAMESPACE_CATEGORY_QUESTIONS: Record<string, string[]> = {
  gpu_ai: [
    "What's the GPU utilization in this namespace?",
    'Are there any GPU memory issues in my deployments?',
    'Show me the health of vLLM or AI workloads in this namespace',
    'What are the token generation rates for models in this namespace?',
    'Check inference latency and throughput for my models',
  ],
  pod_container: [
    'Which pods are consuming the most resources in this namespace?',
    'Are there any pods in CrashLoopBackOff or error state?',
    'Show me container restart trends in this namespace',
    'What are the resource limits vs actual usage for my pods?',
  ],
  networking: [
    'Show me network traffic for services in this namespace',
    'What is the service mesh latency for my workloads?',
    'Are there any connection errors or timeouts?',
    'Show me ingress/egress bandwidth usage',
  ],
  storage: [
    'Are any PVCs running low on space in this namespace?',
    'Show me storage IOPS and throughput for my volumes',
    'What is the current PVC utilization?',
    'Are there any stuck or pending volume claims?',
  ],
  http_grpc: [
    'Show me HTTP/gRPC request rates for services in this namespace',
    'What are the current request latency percentiles?',
    'Are there any failing requests or high error rates?',
    'Show me request throughput trends for my applications',
  ],
  go_runtime: [
    'Show me Go runtime memory usage for applications in this namespace',
    'Are there any goroutine leaks in my services?',
    'What is the GC pause time for my Go applications?',
    'Show me process CPU and memory trends',
  ],
  resource_quota: [
    'What are the resource quotas configured for this namespace?',
    'Are there any resource quota violations or rejections?',
    'Show me resource quota usage vs limits in this namespace',
    'Are pods being throttled due to quota limits?',
  ],
};

export const getQuestionsForCategory = (
  category: CategorySummary,
  scope: ChatScope = 'cluster_wide',
  namespace?: string | null
): string[] => {
  // For namespace scope, use namespace-specific questions if available
  if (scope === 'namespace_scoped' && NAMESPACE_CATEGORY_QUESTIONS[category.id]) {
    const questions = NAMESPACE_CATEGORY_QUESTIONS[category.id];

    // If namespace is provided, contextualize questions with namespace name
    if (namespace) {
      return questions.map(q =>
        q.replace('in this namespace', `in namespace "${namespace}"`)
         .replace('this namespace', `namespace "${namespace}"`)
         .replace('my deployments', `deployments in "${namespace}"`)
         .replace('my workloads', `workloads in "${namespace}"`)
         .replace('my models', `models in "${namespace}"`)
         .replace('my pods', `pods in "${namespace}"`)
         .replace('my services', `services in "${namespace}"`)
         .replace('my volumes', `volumes in "${namespace}"`)
         .replace('my applications', `applications in "${namespace}"`)
      );
    }

    return questions;
  }

  // Fall back to cluster-wide questions
  if (CATEGORY_QUESTIONS[category.id]) {
    return CATEGORY_QUESTIONS[category.id];
  }

  return [`Show me the key ${category.name} metrics`];
};

interface MetricCategoriesPopoverProps {
  onSelectQuestion: (question: string) => void;
  chatScope?: ChatScope;
  selectedNamespace?: string | null;
}

export const MetricCategoriesPopover: React.FC<MetricCategoriesPopoverProps> = ({
  onSelectQuestion,
  chatScope = 'cluster_wide',
  selectedNamespace = null,
}) => {
  const [key, setKey] = React.useState(0);
  const [categories, setCategories] = React.useState<CategorySummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = React.useState<CategorySummary | null>(null);
  const loadedRef = React.useRef(false);

  React.useEffect(() => {
    if (loadedRef.current) return;
    loadCategories();
  }, []);

  // Reload categories when scope changes
  React.useEffect(() => {
    if (loadedRef.current) {
      loadCategories();
      setSelectedCategory(null); // Reset category selection when scope changes
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

  const handleSelectQuestion = (question: string) => {
    setKey((prev) => prev + 1);
    setSelectedCategory(null);
    onSelectQuestion(question);
  };

  const handleCategoryClick = (category: CategorySummary) => {
    setSelectedCategory(category);
  };

  const handleBack = () => {
    setSelectedCategory(null);
  };

  const renderCategoryList = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
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

    return categories.map((cat, index) => (
      <React.Fragment key={cat.id}>
        {index > 0 && <Divider style={{ margin: '4px 0' }} />}
        <Card
          isClickable
          isCompact
          onClick={() => handleCategoryClick(cat)}
          style={{
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            border: 'none',
            boxShadow: 'none',
            marginBottom: '2px',
            backgroundColor: 'var(--pf-v5-global--BackgroundColor--100)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--pf-v5-global--BackgroundColor--light-300)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--pf-v5-global--BackgroundColor--100)';
          }}
        >
          <CardBody style={{ padding: '10px 12px' }}>
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <span style={{ fontSize: '20px', marginRight: '8px' }}>{cat.icon}</span>
              </FlexItem>
              <FlexItem flex={{ default: 'flex_1' }}>
                <Text
                  component={TextVariants.p}
                  style={{ fontWeight: 600, margin: 0, fontSize: '14px' }}
                >
                  {cat.name}
                </Text>
              </FlexItem>
              <FlexItem>
                <Badge isRead>{cat.metric_count} metrics</Badge>
              </FlexItem>
            </Flex>
          </CardBody>
        </Card>
      </React.Fragment>
    ));
  };

  const renderQuestionList = () => {
    if (!selectedCategory) return null;
    const questions = getQuestionsForCategory(selectedCategory, chatScope, selectedNamespace);

    return (
      <div>
        <div style={{ marginBottom: '8px' }}>
          <Button
            variant="link"
            icon={<ArrowLeftIcon />}
            onClick={handleBack}
            style={{ padding: '0', fontSize: '13px' }}
          >
            Back to categories
          </Button>
        </div>
        <Divider style={{ marginBottom: '8px' }} />
        {questions.map((question, index) => (
          <React.Fragment key={index}>
            {index > 0 && <Divider style={{ margin: '4px 0' }} />}
            <Card
              isClickable
              isCompact
              onClick={() => handleSelectQuestion(question)}
              style={{
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                border: 'none',
                boxShadow: 'none',
                marginBottom: '2px',
                backgroundColor: 'var(--pf-v5-global--BackgroundColor--100)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--pf-v5-global--BackgroundColor--light-300)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--pf-v5-global--BackgroundColor--100)';
              }}
            >
              <CardBody style={{ padding: '10px 12px' }}>
                <Text component={TextVariants.p} style={{ margin: 0, fontSize: '13px' }}>
                  {question}
                </Text>
              </CardBody>
            </Card>
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <Popover
      key={key}
      aria-label="Metric categories popover"
      headerContent={
        <div>
          <Text component={TextVariants.h3} style={{ marginBottom: '4px' }}>
            {selectedCategory ? (
              <>
                <span style={{ marginRight: '6px' }}>{selectedCategory.icon}</span>
                {selectedCategory.name}
              </>
            ) : (
              'Metric Categories'
            )}
          </Text>
          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
            {selectedCategory ? 'Click a question to ask' : 'Browse metrics by category'}
          </Text>
        </div>
      }
      bodyContent={
        <div
          style={{
            maxHeight: '500px',
            overflowY: 'auto',
            width: '400px',
            backgroundColor: 'var(--pf-v5-global--BackgroundColor--100)',
          }}
        >
          {selectedCategory ? renderQuestionList() : renderCategoryList()}
        </div>
      }
      position="bottom"
      enableFlip={true}
      minWidth="420px"
      maxWidth="420px"
      zIndex={9999}
    >
      <Button
        variant="plain"
        icon={<ListIcon />}
        title="Metric categories"
        aria-label="Metric categories"
      >
        Metric Categories
      </Button>
    </Popover>
  );
};

export default MetricCategoriesPopover;
