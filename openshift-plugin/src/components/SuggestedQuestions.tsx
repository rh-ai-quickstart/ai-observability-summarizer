import * as React from 'react';
import {
  Card,
  CardBody,
  Grid,
  GridItem,
  Text,
  TextVariants,
  Flex,
  FlexItem,
  ExpandableSection,
} from '@patternfly/react-core';
import {
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

interface SuggestedQuestionsProps {
  onSelectQuestion: (question: string) => void;
  isExpanded: boolean;
  onToggle: (expanded: boolean) => void;
}

export const SuggestedQuestions: React.FC<SuggestedQuestionsProps> = ({
  onSelectQuestion,
  isExpanded,
  onToggle,
}) => {
  return (
    <ExpandableSection
      toggleText={isExpanded ? "Hide suggested questions" : "Show suggested questions"}
      onToggle={(_event, expanded) => onToggle(expanded)}
      isExpanded={isExpanded}
      displaySize="lg"
    >
      <div style={{ marginTop: '8px' }}>
        <Text
          component={TextVariants.small}
          style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: '16px' }}
        >
          Click a question below to get started
        </Text>
        <Grid hasGutter>
        {SUGGESTED_QUESTIONS.map((q) => {
          const IconComponent = q.icon;
          return (
            <GridItem key={q.id} md={6} sm={12}>
              <Card
                isClickable
                isCompact
                onClick={() => onSelectQuestion(q.question)}
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
                <CardBody style={{ padding: '16px' }}>
                  <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(124, 58, 237, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginRight: '12px',
                        }}
                      >
                        <IconComponent
                          style={{
                            fontSize: '20px',
                            color: 'var(--pf-v5-global--primary-color--100)',
                          }}
                        />
                      </div>
                    </FlexItem>
                    <FlexItem flex={{ default: 'flex_1' }}>
                      <Text
                        component={TextVariants.p}
                        style={{ fontWeight: 600, margin: 0, marginBottom: '4px' }}
                      >
                        {q.label}
                      </Text>
                      <Text
                        component={TextVariants.small}
                        style={{ color: 'var(--pf-v5-global--Color--200)', margin: 0, lineHeight: 1.4 }}
                      >
                        {q.question}
                      </Text>
                    </FlexItem>
                  </Flex>
                </CardBody>
              </Card>
            </GridItem>
          );
        })}
        </Grid>
      </div>
    </ExpandableSection>
  );
};

export default SuggestedQuestions;
