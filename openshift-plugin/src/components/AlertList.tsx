import * as React from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  Label,
  LabelGroup,
  Text,
  TextVariants,
  EmptyState,
  EmptyStateBody,
  EmptyStateHeader,
  EmptyStateIcon,
} from '@patternfly/react-core';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td,
} from '@patternfly/react-table';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  InfoCircleIcon,
} from '@patternfly/react-icons';
import type { AlertInfo } from '../services/mcpClient';

export interface AlertListProps {
  alerts: AlertInfo[];
  title?: string;
  loading?: boolean;
}

const severityConfig: Record<string, { icon: React.ComponentType; color: string; labelColor: 'red' | 'orange' | 'blue' | 'green' }> = {
  critical: {
    icon: ExclamationCircleIcon,
    color: 'var(--pf-global--danger-color--100)',
    labelColor: 'red',
  },
  warning: {
    icon: ExclamationTriangleIcon,
    color: 'var(--pf-global--warning-color--100)',
    labelColor: 'orange',
  },
  info: {
    icon: InfoCircleIcon,
    color: 'var(--pf-global--info-color--100)',
    labelColor: 'blue',
  },
};

const formatTimestamp = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
};

export const AlertList: React.FC<AlertListProps> = ({
  alerts,
  title = 'Active Alerts',
  loading = false,
}) => {
  if (loading) {
    return (
      <Card>
        <CardTitle>
          <Text component={TextVariants.h3}>{title}</Text>
        </CardTitle>
        <CardBody>
          <Text>Loading alerts...</Text>
        </CardBody>
      </Card>
    );
  }

  if (!alerts || alerts.length === 0) {
    return (
      <Card>
        <CardTitle>
          <Text component={TextVariants.h3}>{title}</Text>
        </CardTitle>
        <CardBody>
          <EmptyState>
            <EmptyStateHeader
              titleText="No Active Alerts"
              headingLevel="h4"
              icon={<EmptyStateIcon icon={CheckCircleIcon} />}
            />
            <EmptyStateBody>
              All systems are operating normally.
            </EmptyStateBody>
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  const sortedAlerts = [...alerts].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
  });

  return (
    <Card>
      <CardTitle>
        <Text component={TextVariants.h3}>
          {title} ({alerts.length})
        </Text>
      </CardTitle>
      <CardBody>
        <Table aria-label="Alerts table" variant="compact">
          <Thead>
            <Tr>
              <Th>Severity</Th>
              <Th>Alert Name</Th>
              <Th>Message</Th>
              <Th>Labels</Th>
              <Th>Time</Th>
            </Tr>
          </Thead>
          <Tbody>
            {sortedAlerts.map((alert, index) => {
              const config = severityConfig[alert.severity] || severityConfig.info;
              const IconComponent = config.icon;
              return (
                <Tr key={`${alert.name}-${index}`}>
                  <Td>
                    <Label color={config.labelColor} icon={<IconComponent />}>
                      {alert.severity.toUpperCase()}
                    </Label>
                  </Td>
                  <Td>
                    <Text component="p" style={{ fontWeight: 'bold' }}>
                      {alert.name}
                    </Text>
                  </Td>
                  <Td>{alert.message}</Td>
                  <Td>
                    {alert.labels && Object.keys(alert.labels).length > 0 ? (
                      <LabelGroup>
                        {Object.entries(alert.labels).slice(0, 3).map(([key, value]) => (
                          <Label key={key} isCompact>
                            {key}: {value}
                          </Label>
                        ))}
                        {Object.keys(alert.labels).length > 3 && (
                          <Label isCompact>+{Object.keys(alert.labels).length - 3} more</Label>
                        )}
                      </LabelGroup>
                    ) : (
                      '-'
                    )}
                  </Td>
                  <Td>{formatTimestamp(alert.timestamp)}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </CardBody>
    </Card>
  );
};

export default AlertList;
