import * as React from 'react';
import {
  Alert,
  AlertVariant,
  Bullseye,
  Card,
  CardBody,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Label,
  Spinner,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  CubesIcon,
  ExclamationTriangleIcon,
  ServerIcon,
} from '@patternfly/react-icons';
import { healthCheck, listModels, listNamespaces } from '../services/mcpClient';

interface StatusCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  status: 'success' | 'warning' | 'danger' | 'info';
  icon: React.ReactNode;
}

const StatusCard: React.FC<StatusCardProps> = ({ title, value, subtitle, status, icon }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return '#3e8635';
      case 'warning':
        return '#f0ab00';
      case 'danger':
        return '#c9190b';
      default:
        return '#0066cc';
    }
  };

  return (
    <Card isCompact style={{ height: '100%' }}>
      <CardBody>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '8px',
                background: `${getStatusColor()}20`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: getStatusColor(),
              }}
            >
              {icon}
            </div>
          </FlexItem>
          <FlexItem flex={{ default: 'flex_1' }} style={{ marginLeft: '16px' }}>
            <TextContent>
              <Text
                component={TextVariants.small}
                style={{ color: 'var(--pf-v5-global--Color--200)' }}
              >
                {title}
              </Text>
              <Text component={TextVariants.h2} style={{ margin: 0 }}>
                {value}
              </Text>
              {subtitle && (
                <Text
                  component={TextVariants.small}
                  style={{ color: 'var(--pf-v5-global--Color--200)' }}
                >
                  {subtitle}
                </Text>
              )}
            </TextContent>
          </FlexItem>
          <FlexItem>
            <Label
              color={
                status === 'success'
                  ? 'green'
                  : status === 'warning'
                  ? 'orange'
                  : status === 'danger'
                  ? 'red'
                  : 'blue'
              }
            >
              {status === 'success'
                ? 'Healthy'
                : status === 'warning'
                ? 'Warning'
                : status === 'danger'
                ? 'Critical'
                : 'Active'}
            </Label>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};

export const StatusSummarySection: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [mcpConnected, setMcpConnected] = React.useState(false);
  const [modelCount, setModelCount] = React.useState(0);
  const [namespaceCount, setNamespaceCount] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    const loadStatus = async () => {
      setLoading(true);
      setError(null);
      try {
        const [isHealthy, models, namespaces] = await Promise.all([
          healthCheck(),
          listModels(),
          listNamespaces(),
        ]);
        if (!isMounted) {
          return;
        }
        setMcpConnected(isHealthy);
        setModelCount(models.length);
        setNamespaceCount(namespaces.length);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setError('Failed to load status summary');
        setMcpConnected(false);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <Bullseye style={{ minHeight: '180px' }}>
        <Spinner size="lg" />
      </Bullseye>
    );
  }

  return (
    <>
      {error && (
        <Alert variant={AlertVariant.warning} title="Connection Issue" style={{ marginBottom: '16px' }}>
          {error}. Some features may be limited.
        </Alert>
      )}
      <Grid hasGutter>
        <GridItem lg={4} md={6} sm={12}>
          <StatusCard
            title="MCP Server"
            value={mcpConnected ? 'Connected' : 'Disconnected'}
            subtitle="AI Observability Backend"
            status={mcpConnected ? 'success' : 'danger'}
            icon={mcpConnected ? <CheckCircleIcon /> : <ExclamationTriangleIcon />}
          />
        </GridItem>
        <GridItem lg={4} md={6} sm={12}>
          <StatusCard
            title="vLLM Models"
            value={modelCount}
            subtitle="Deployed models"
            status={modelCount > 0 ? 'info' : 'warning'}
            icon={<CubesIcon />}
          />
        </GridItem>
        <GridItem lg={4} md={6} sm={12}>
          <StatusCard
            title="Namespaces"
            value={namespaceCount}
            subtitle="With vLLM deployments"
            status={namespaceCount > 0 ? 'info' : 'warning'}
            icon={<ServerIcon />}
          />
        </GridItem>
      </Grid>
    </>
  );
};
