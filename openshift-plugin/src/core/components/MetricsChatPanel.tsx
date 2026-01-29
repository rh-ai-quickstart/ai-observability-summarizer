import * as React from 'react';
import {
  Card,
  CardBody,
  Title,
  Text,
  TextVariants,
  Button,
} from '@patternfly/react-core';
import { RobotIcon, TimesIcon } from '@patternfly/react-icons';

interface MetricsChatPanelProps {
  scope: 'cluster_wide' | 'namespace_scoped';
  namespace?: string;
  category: string;
  timeRange: string;
  isOpen: boolean;
  onClose: () => void;
}

export const MetricsChatPanel: React.FC<MetricsChatPanelProps> = ({
  scope,
  namespace,
  category,
  timeRange,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <Title headingLevel="h3" size="lg">
            <RobotIcon style={{ marginRight: '8px' }} />
            AI Assistant
          </Title>
          <Button variant="plain" onClick={onClose}>
            <TimesIcon />
          </Button>
        </div>
        <Text component={TextVariants.p}>
          Interactive chat panel for {category} metrics analysis coming soon!
        </Text>
        <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '8px' }}>
          Scope: {scope === 'cluster_wide' ? 'Cluster-wide' : namespace} | Time Range: {timeRange}
        </Text>
      </CardBody>
    </Card>
  );
};