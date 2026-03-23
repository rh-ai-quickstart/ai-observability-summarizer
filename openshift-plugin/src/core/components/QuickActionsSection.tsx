import * as React from 'react';
import {
  Card,
  CardBody,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Text,
  TextContent,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import {
  ArrowRightIcon,
  CogIcon,
  CommentIcon,
  CubesIcon,
  ServerIcon,
} from '@patternfly/react-icons';

interface QuickActionCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconColor: string;
  onClick: () => void;
}

const QuickActionCard: React.FC<QuickActionCardProps> = ({
  title,
  description,
  icon,
  iconColor,
  onClick,
}) => {
  return (
    <Card
      isSelectable
      isClickable
      isCompact
      onClick={onClick}
      style={{
        cursor: 'pointer',
        transition: 'transform 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
      }}
      className="quick-action-card"
    >
      <CardBody>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <Flex alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: `${iconColor}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: iconColor,
                }}
              >
                {icon}
              </div>
            </FlexItem>
            <FlexItem style={{ marginLeft: '16px' }}>
              <TextContent>
                <Text component={TextVariants.h4} style={{ marginBottom: '4px' }}>
                  {title}
                </Text>
                <Text
                  component={TextVariants.small}
                  style={{ color: 'var(--pf-v5-global--Color--200)' }}
                >
                  {description}
                </Text>
              </TextContent>
            </FlexItem>
          </Flex>
          <FlexItem>
            <ArrowRightIcon style={{ color: 'var(--pf-v5-global--Color--200)' }} />
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};

enum TabIndex {
  Overview = 0,
  VLLMMetrics = 1,
  DeviceMetrics = 2,
  OpenShift = 3,
  AIChat = 4,
  Settings = -1,
}

const emitNavigate = (tabIndex: number) => {
  window.dispatchEvent(new CustomEvent('quick-action-navigate', { detail: { tabIndex } }));
};

interface QuickActionsSectionProps {
  gpuAvailable?: boolean | undefined;
}

export const QuickActionsSection: React.FC<QuickActionsSectionProps> = ({ gpuAvailable }) => (
  <div style={{ marginTop: '32px' }}>
    <Title headingLevel="h2" size="lg" style={{ marginBottom: '16px' }}>
      Quick Actions
    </Title>
    <Grid hasGutter>
      {/* Only show vLLM Quick Action if GPU available */}
      {gpuAvailable === true && (
        <GridItem md={6} sm={12}>
          <QuickActionCard
            title="vLLM Metrics"
            description="Monitor GPU usage, request rates, and inference latency"
            icon={<ServerIcon style={{ fontSize: '20px' }} />}
            iconColor="#0066cc"
            onClick={() => emitNavigate(TabIndex.VLLMMetrics)}
          />
        </GridItem>
      )}
      {/* Only show Hardware Accelerators Quick Action if GPU available */}
      {gpuAvailable === true && (
        <GridItem md={6} sm={12}>
          <QuickActionCard
            title="Hardware Accelerators"
            description="View GPU/accelerator utilization, memory, temperature, and power"
            icon={<CubesIcon style={{ fontSize: '20px' }} />}
            iconColor="#111827"
            onClick={() => emitNavigate(TabIndex.DeviceMetrics)}
          />
        </GridItem>
      )}
      <GridItem md={6} sm={12}>
        <QuickActionCard
          title="OpenShift Metrics"
          description="View pod status, resource utilization, and cluster health"
          icon={<CubesIcon style={{ fontSize: '20px' }} />}
          iconColor="#3e8635"
          onClick={() => emitNavigate(TabIndex.OpenShift)}
        />
      </GridItem>
      <GridItem md={6} sm={12}>
        <QuickActionCard
          title="Chat with Prometheus"
          description="Ask questions about your metrics and get AI-powered insights"
          icon={<CommentIcon style={{ fontSize: '20px' }} />}
          iconColor="#7c3aed"
          onClick={() => emitNavigate(TabIndex.AIChat)}
        />
      </GridItem>
      <GridItem md={6} sm={12}>
        <QuickActionCard
          title="Settings"
          description="Configure AI model, API keys, and preferences"
          icon={<CogIcon style={{ fontSize: '20px' }} />}
          iconColor="#6b7280"
          onClick={() => emitNavigate(TabIndex.Settings)}
        />
      </GridItem>
    </Grid>
  </div>
);
