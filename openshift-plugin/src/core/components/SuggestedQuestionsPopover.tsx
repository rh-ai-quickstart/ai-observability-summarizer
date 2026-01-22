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
} from '@patternfly/react-core';
import {
  OutlinedLightbulbIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  ChartLineIcon,
  TachometerAltIcon,
  ServerIcon,
  ClockIcon,
  DatabaseIcon,
  BellIcon,
} from '@patternfly/react-icons';

interface SuggestedQuestion {
  id: string;
  icon: React.ComponentType<any>;
  label: string;
  question: string;
}

const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  {
    id: 'gpu-util',
    icon: CubeIcon,
    label: 'GPU Utilization',
    question: "What's the current GPU utilization across all models?",
  },
  {
    id: 'performance',
    icon: ExclamationTriangleIcon,
    label: 'Performance Issues',
    question: 'Are there any performance issues I should be aware of?',
  },
  {
    id: 'vllm-health',
    icon: ChartLineIcon,
    label: 'vLLM Health',
    question: 'Summarize the health of my vLLM deployments',
  },
  {
    id: 'cpu-memory',
    icon: TachometerAltIcon,
    label: 'CPU & Memory Trends',
    question: 'Show me CPU and memory trends for the last hour',
  },
  {
    id: 'resource-consumers',
    icon: ServerIcon,
    label: 'Resource Consumers',
    question: 'What are the top resource consumers in my cluster?',
  },
  {
    id: 'latency-queue',
    icon: ClockIcon,
    label: 'Latency & Queue',
    question: 'Analyze request latency and queue depth',
  },
  {
    id: 'cache-efficiency',
    icon: DatabaseIcon,
    label: 'Cache Efficiency',
    question: 'Check KV cache efficiency and hit rates',
  },
  {
    id: 'alerts',
    icon: BellIcon,
    label: 'Alerts & Anomalies',
    question: 'Show me any alerts or anomalies',
  },
];

interface SuggestedQuestionsPopoverProps {
  onSelectQuestion: (question: string) => void;
}

export const SuggestedQuestionsPopover: React.FC<SuggestedQuestionsPopoverProps> = ({
  onSelectQuestion,
}) => {
  const [key, setKey] = React.useState(0);

  const handleSelectQuestion = (question: string) => {
    // Force remount to close popover by changing key
    setKey(prev => prev + 1);
    onSelectQuestion(question);
  };

  return (
    <Popover
      key={key}
      aria-label="Suggested questions popover"
      headerContent={
        <div>
          <Text component={TextVariants.h3} style={{ marginBottom: '4px' }}>
            💡 Suggested Questions
          </Text>
          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
            Click a question to ask
          </Text>
        </div>
      }
      bodyContent={
        <div style={{
          maxHeight: '500px',
          overflowY: 'auto',
          width: '400px',
          backgroundColor: 'var(--pf-v5-global--BackgroundColor--100)',
        }}>
          {SUGGESTED_QUESTIONS.map((q, index) => {
            const IconComponent = q.icon;
            return (
              <React.Fragment key={q.id}>
                {index > 0 && <Divider style={{ margin: '8px 0' }} />}
                <Card
                  isClickable
                  isCompact
                  onClick={() => handleSelectQuestion(q.question)}
                  style={{
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: 'none',
                    boxShadow: 'none',
                    marginBottom: '4px',
                    backgroundColor: 'var(--pf-v5-global--BackgroundColor--100)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--pf-v5-global--BackgroundColor--light-300)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--pf-v5-global--BackgroundColor--100)';
                  }}
                >
                  <CardBody style={{ padding: '12px' }}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                      <FlexItem>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(124, 58, 237, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: '12px',
                          }}
                        >
                          <IconComponent
                            style={{
                              fontSize: '16px',
                              color: 'var(--pf-v5-global--primary-color--100)',
                            }}
                          />
                        </div>
                      </FlexItem>
                      <FlexItem flex={{ default: 'flex_1' }}>
                        <Text
                          component={TextVariants.p}
                          style={{ fontWeight: 600, margin: 0, marginBottom: '2px', fontSize: '14px' }}
                        >
                          {q.label}
                        </Text>
                        <Text
                          component={TextVariants.small}
                          style={{ color: 'var(--pf-v5-global--Color--200)', margin: 0, fontSize: '12px', lineHeight: 1.3 }}
                        >
                          {q.question}
                        </Text>
                      </FlexItem>
                    </Flex>
                  </CardBody>
                </Card>
              </React.Fragment>
            );
          })}
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
        icon={<OutlinedLightbulbIcon />}
        title="Suggested questions"
        aria-label="Suggested questions"
      >
        Suggested Questions
      </Button>
    </Popover>
  );
};

export default SuggestedQuestionsPopover;
