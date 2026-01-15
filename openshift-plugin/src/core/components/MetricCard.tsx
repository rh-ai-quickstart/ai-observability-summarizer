import * as React from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  Spinner,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import {
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon,
} from '@patternfly/react-icons';

export interface MetricCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  loading?: boolean;
  icon?: React.ReactNode;
  status?: 'success' | 'warning' | 'danger' | 'info';
}

const statusColors: Record<string, string> = {
  success: 'var(--pf-global--success-color--100)',
  warning: 'var(--pf-global--warning-color--100)',
  danger: 'var(--pf-global--danger-color--100)',
  info: 'var(--pf-global--info-color--100)',
};

const trendIcons: Record<string, React.ReactNode> = {
  up: <ArrowUpIcon color="var(--pf-global--success-color--100)" />,
  down: <ArrowDownIcon color="var(--pf-global--danger-color--100)" />,
  stable: <MinusIcon color="var(--pf-global--Color--200)" />,
};

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  unit,
  trend,
  trendValue,
  loading = false,
  icon,
  status,
}) => {
  return (
    <Card isCompact>
      <CardTitle>
        <Flex>
          {icon && <FlexItem>{icon}</FlexItem>}
          <FlexItem>
            <Text component={TextVariants.h4}>{title}</Text>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        {loading ? (
          <Spinner size="lg" />
        ) : (
          <TextContent>
            <Text
              component={TextVariants.h1}
              style={status ? { color: statusColors[status] } : undefined}
            >
              {value}
              {unit && (
                <Text component={TextVariants.small} style={{ marginLeft: '4px' }}>
                  {unit}
                </Text>
              )}
            </Text>
            {trend && (
              <Flex alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem>{trendIcons[trend]}</FlexItem>
                {trendValue && (
                  <FlexItem>
                    <Text component={TextVariants.small}>{trendValue}</Text>
                  </FlexItem>
                )}
              </Flex>
            )}
          </TextContent>
        )}
      </CardBody>
    </Card>
  );
};

export default MetricCard;
