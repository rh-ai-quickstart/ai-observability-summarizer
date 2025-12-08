import * as React from 'react';
import {
  Page,
  PageSection,
  Title,
  Tabs,
  Tab,
  TabTitleText,
  TabTitleIcon,
  Card,
  CardBody,
  Grid,
  GridItem,
  Flex,
  FlexItem,
  TextContent,
  Text,
  TextVariants,
  Label,
  Alert,
  AlertVariant,
  Spinner,
  Bullseye,
  Button,
} from '@patternfly/react-core';
import {
  TachometerAltIcon,
  ServerIcon,
  CubesIcon,
  CommentIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CogIcon,
  ArrowRightIcon,
} from '@patternfly/react-icons';
import VLLMMetricsPage from './VLLMMetricsPage';
import { OpenShiftMetricsPage } from './OpenShiftMetricsPage';
import { AIChatPage } from './AIChatPage';
import { SettingsModal } from '../components/SettingsModal';
import { healthCheck, listModels, listNamespaces, getSessionConfig } from '../services/mcpClient';

// Status Card Component
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
      case 'success': return '#3e8635';
      case 'warning': return '#f0ab00';
      case 'danger': return '#c9190b';
      default: return '#0066cc';
    }
  };

  return (
    <Card isCompact style={{ height: '100%' }}>
      <CardBody>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <div style={{ 
              width: '48px', 
              height: '48px', 
              borderRadius: '8px', 
              background: `${getStatusColor()}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: getStatusColor()
            }}>
              {icon}
            </div>
          </FlexItem>
          <FlexItem flex={{ default: 'flex_1' }} style={{ marginLeft: '16px' }}>
            <TextContent>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                {title}
              </Text>
              <Text component={TextVariants.h2} style={{ margin: 0 }}>
                {value}
              </Text>
              {subtitle && (
                <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                  {subtitle}
                </Text>
              )}
            </TextContent>
          </FlexItem>
          <FlexItem>
            <Label color={status === 'success' ? 'green' : status === 'warning' ? 'orange' : status === 'danger' ? 'red' : 'blue'}>
              {status === 'success' ? 'Healthy' : status === 'warning' ? 'Warning' : status === 'danger' ? 'Critical' : 'Active'}
            </Label>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};

// Quick Action Card Component
interface QuickActionCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconColor: string;
  onClick: () => void;
}

const QuickActionCard: React.FC<QuickActionCardProps> = ({ title, description, icon, iconColor, onClick }) => {
  return (
    <Card 
      isSelectable 
      isClickable
      isCompact 
      onClick={onClick}
      style={{ cursor: 'pointer', transition: 'transform 0.15s ease-in-out, box-shadow 0.15s ease-in-out' }}
      className="quick-action-card"
    >
      <CardBody>
        <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }}>
          <Flex alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: `${iconColor}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: iconColor,
              }}>
                {icon}
              </div>
            </FlexItem>
            <FlexItem style={{ marginLeft: '16px' }}>
              <TextContent>
                <Text component={TextVariants.h4} style={{ marginBottom: '4px' }}>{title}</Text>
                <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
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

// Overview Dashboard Component
interface OverviewDashboardProps {
  onNavigate: (tabIndex: number) => void;
}

const OverviewDashboard: React.FC<OverviewDashboardProps> = ({ onNavigate }) => {
  const [loading, setLoading] = React.useState(true);
  const [mcpConnected, setMcpConnected] = React.useState(false);
  const [modelCount, setModelCount] = React.useState(0);
  const [namespaceCount, setNamespaceCount] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadOverviewData();
  }, []);

  const loadOverviewData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [isHealthy, models, namespaces] = await Promise.all([
        healthCheck(),
        listModels(),
        listNamespaces(),
      ]);
      setMcpConnected(isHealthy);
      setModelCount(models.length);
      setNamespaceCount(namespaces.length);
    } catch (err) {
      setError('Failed to connect to MCP server');
      setMcpConnected(false);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Bullseye style={{ minHeight: '300px' }}>
        <Spinner size="xl" />
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

      <div style={{ marginTop: '32px' }}>
        <Title headingLevel="h2" size="lg" style={{ marginBottom: '16px' }}>
          Quick Actions
        </Title>
        <Grid hasGutter>
          <GridItem md={6} sm={12}>
            <QuickActionCard
              title="vLLM Metrics"
              description="Monitor GPU usage, request rates, and inference latency"
              icon={<ServerIcon style={{ fontSize: '20px' }} />}
              iconColor="#0066cc"
              onClick={() => onNavigate(1)}
            />
          </GridItem>
          <GridItem md={6} sm={12}>
            <QuickActionCard
              title="OpenShift Metrics"
              description="View pod status, resource utilization, and cluster health"
              icon={<CubesIcon style={{ fontSize: '20px' }} />}
              iconColor="#3e8635"
              onClick={() => onNavigate(2)}
            />
          </GridItem>
          <GridItem md={6} sm={12}>
            <QuickActionCard
              title="AI Chat"
              description="Ask questions about your metrics and get AI-powered insights"
              icon={<CommentIcon style={{ fontSize: '20px' }} />}
              iconColor="#7c3aed"
              onClick={() => onNavigate(3)}
            />
          </GridItem>
          <GridItem md={6} sm={12}>
            <QuickActionCard
              title="Settings"
              description="Configure AI model, API keys, and preferences"
              icon={<CogIcon style={{ fontSize: '20px' }} />}
              iconColor="#6b7280"
              onClick={() => onNavigate(-1)}
            />
          </GridItem>
        </Grid>
      </div>
    </>
  );
};

// Main Page with Tabs
const AIObservabilityPage: React.FC = () => {
  const [activeTabKey, setActiveTabKey] = React.useState<number>(0);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [configuredModel, setConfiguredModel] = React.useState<string>('');

  React.useEffect(() => {
    const config = getSessionConfig();
    setConfiguredModel(config.ai_model || '');
  }, []);

  const handleTabClick = (
    _event: React.MouseEvent<HTMLElement, MouseEvent>,
    tabIndex: string | number
  ) => {
    setActiveTabKey(Number(tabIndex));
  };

  const handleNavigate = (tabIndex: number) => {
    if (tabIndex === -1) {
      // Special case: open settings modal
      setIsSettingsOpen(true);
    } else {
      setActiveTabKey(tabIndex);
    }
  };

  const handleSettingsSave = () => {
    const config = getSessionConfig();
    setConfiguredModel(config.ai_model || '');
  };

  return (
    <Page>
      <PageSection variant="light">
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1" size="2xl">AI Observability</Title>
            <TextContent>
              <Text component={TextVariants.p} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                Monitor, analyze, and get AI-powered insights for your vLLM and OpenShift workloads
              </Text>
            </TextContent>
          </FlexItem>
          <FlexItem>
            <Button 
              variant="secondary" 
              onClick={() => setIsSettingsOpen(true)}
              icon={<CogIcon />}
            >
              Settings
              {configuredModel && (
                <Label color="blue" isCompact style={{ marginLeft: '8px' }}>
                  {configuredModel.split('/').pop()}
                </Label>
              )}
            </Button>
          </FlexItem>
        </Flex>
      </PageSection>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSettingsSave}
      />

      <PageSection type="tabs" variant="light" style={{ paddingBottom: 0 }}>
        <Tabs activeKey={activeTabKey} onSelect={handleTabClick} aria-label="AI Observability tabs">
          <Tab
            eventKey={0}
            title={
              <>
                <TabTitleIcon><TachometerAltIcon /></TabTitleIcon>
                <TabTitleText>Overview</TabTitleText>
              </>
            }
            aria-label="Overview"
          />
          <Tab
            eventKey={1}
            title={
              <>
                <TabTitleIcon><ServerIcon /></TabTitleIcon>
                <TabTitleText>vLLM Metrics</TabTitleText>
              </>
            }
            aria-label="vLLM Metrics"
          />
          <Tab
            eventKey={2}
            title={
              <>
                <TabTitleIcon><CubesIcon /></TabTitleIcon>
                <TabTitleText>OpenShift</TabTitleText>
              </>
            }
            aria-label="OpenShift Metrics"
          />
          <Tab
            eventKey={3}
            title={
              <>
                <TabTitleIcon><CommentIcon /></TabTitleIcon>
                <TabTitleText>AI Chat</TabTitleText>
              </>
            }
            aria-label="AI Chat"
          />
        </Tabs>
      </PageSection>

      <PageSection>
        {activeTabKey === 0 && <OverviewDashboard onNavigate={handleNavigate} />}
        {activeTabKey === 1 && <VLLMMetricsPage />}
        {activeTabKey === 2 && <OpenShiftMetricsPage />}
        {activeTabKey === 3 && <AIChatPage />}
      </PageSection>
    </Page>
  );
};

export { AIObservabilityPage };
export default AIObservabilityPage;
