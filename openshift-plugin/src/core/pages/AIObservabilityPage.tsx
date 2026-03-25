import * as React from 'react';
import {
  Page,
  PageSection,
  Title,
  Tabs,
  Tab,
  TabTitleText,
  TabTitleIcon,
  Flex,
  FlexItem,
  TextContent,
  Text,
  TextVariants,
  Label,
  Button,
  Alert,
  AlertVariant,
} from '@patternfly/react-core';
import {
  TachometerAltIcon,
  ServerIcon,
  CubeIcon,
  CubesIcon,
  CommentIcon,
  CogIcon,
} from '@patternfly/react-icons';
import VLLMMetricsPage from './VLLMMetricsPage';
import DeviceMetricsPage from './DeviceMetricsPage';
import { OpenShiftMetricsPage } from './OpenShiftMetricsPage';
import { AIChatPage } from './AIChatPage';
import { SettingsModal } from '../components/SettingsModal';
import { ModelInsightsSection, QuickActionsSection, StatusSummarySection } from '../components';
import { getSessionConfig, healthCheck, listModels, listNamespaces, getGpuAvailability } from '../services/mcpClient';
import type { ModelInfo, NamespaceInfo } from '../services/mcpClient';
import { initializeRuntimeConfig } from '../services/runtimeConfig';
import { DEV_CACHE_CLEARED_EVENT } from '../constants';

// Overview Dashboard Component
interface OverviewDashboardProps {
  gpuAvailable?: boolean | undefined;
}

const OverviewDashboard: React.FC<OverviewDashboardProps> = ({ gpuAvailable }) => {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [mcpConnected, setMcpConnected] = React.useState(false);
  const [models, setModels] = React.useState<ModelInfo[]>([]);
  const [namespaces, setNamespaces] = React.useState<NamespaceInfo[]>([]);

  React.useEffect(() => {
    let isMounted = true;

    const loadOverview = async () => {
      setLoading(true);
      setError(null);
      try {
        const [isHealthy, modelsResponse, namespacesResponse] = await Promise.all([
          healthCheck(),
          listModels(),
          listNamespaces(),
        ]);
        if (!isMounted) {
          return;
        }
        setMcpConnected(isHealthy);
        setModels(modelsResponse);
        setNamespaces(namespacesResponse);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setError('Failed to load overview data');
        setMcpConnected(false);
        setModels([]);
        setNamespaces([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadOverview();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      {/* GPU Unavailable Banner */}
      {gpuAvailable === false && (
        <Alert
          variant={AlertVariant.info}
          isInline
          title="GPU/Accelerator features unavailable on this cluster"
          style={{ marginBottom: '24px' }}
        >
          <p>
            Application is running on non-GPU cluster. Following features are missing:
          </p>
          <ul style={{ marginTop: '8px', marginLeft: '20px' }}>
            <li>vLLM Metrics</li>
            <li>Hardware Accelerators metrics</li>
            <li>Chat functionality regarding GPU and vLLM metrics</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            To enable features, ensure you are on a cluster that has GPU or hardware accelerators configured.
          </p>
        </Alert>
      )}

      <StatusSummarySection
        loading={loading}
        error={error}
        mcpConnected={mcpConnected}
        models={models}
        namespaces={namespaces}
        gpuAvailable={gpuAvailable}
      />
      {/* Only show Model Insights section if GPU available (vLLM metrics) */}
      {gpuAvailable === true && (
        <ModelInsightsSection loading={loading} error={error} models={models} />
      )}
      <QuickActionsSection gpuAvailable={gpuAvailable} />
    </>
  );
};

interface AIObservabilityPageProps {
  activeTab?: number;
  onTabChange?: (tabIndex: number) => void;
}

// Main Page with Tabs
const AIObservabilityPage: React.FC<AIObservabilityPageProps> = ({
  activeTab: externalActiveTab,
  onTabChange: externalOnTabChange,
}) => {
  const [internalActiveTab, setInternalActiveTab] = React.useState<number>(0);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [configuredModel, setConfiguredModel] = React.useState<string>('');
  // CRITICAL: Start with undefined (loading state), not true
  // This prevents briefly showing vLLM tab on non-GPU clusters
  const [gpuAvailable, setGpuAvailable] = React.useState<boolean | undefined>(undefined);

  // Use external props if provided (React UI), otherwise use internal state (console plugin)
  const activeTabKey = externalActiveTab !== undefined ? externalActiveTab : internalActiveTab;
  const setActiveTabKey = externalOnTabChange || setInternalActiveTab;

  React.useEffect(() => {
    // Initialize runtime config on first load
    initializeRuntimeConfig().catch((error) => {
      console.error('Failed to initialize runtime config:', error);
    });

    // Fetch GPU availability
    getGpuAvailability().then(setGpuAvailable).catch((error) => {
      console.error('Failed to check GPU availability:', error);
      setGpuAvailable(false); // Safe default on error
    });

    const config = getSessionConfig();
    setConfiguredModel(config.ai_model || '');

    // Listen for open-settings event from child components
    const handleOpenSettings = () => {
      setIsSettingsOpen(true);
    };
    const handleQuickActionNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ tabIndex: number }>).detail;
      if (detail?.tabIndex === -1) {
        setIsSettingsOpen(true);
      } else if (typeof detail?.tabIndex === 'number') {
        setActiveTabKey(detail.tabIndex);
      }
    };

    // Listen for manual refresh events
    const handleGpuChange = (event: Event) => {
      setGpuAvailable((event as CustomEvent).detail);
    };
    const handleCacheCleared = () => {
      const updatedConfig = getSessionConfig();
      setConfiguredModel(updatedConfig.ai_model || '');
    };

    window.addEventListener('open-settings', handleOpenSettings);
    window.addEventListener('quick-action-navigate', handleQuickActionNavigate);
    window.addEventListener('gpu-availability-changed', handleGpuChange);
    window.addEventListener(DEV_CACHE_CLEARED_EVENT, handleCacheCleared);

    return () => {
      window.removeEventListener('open-settings', handleOpenSettings);
      window.removeEventListener('quick-action-navigate', handleQuickActionNavigate);
      window.removeEventListener('gpu-availability-changed', handleGpuChange);
      window.removeEventListener(DEV_CACHE_CLEARED_EVENT, handleCacheCleared);
    };
  }, [setActiveTabKey]);

  // Guard against invalid activeTabKey when GPU unavailable
  React.useEffect(() => {
    if (gpuAvailable === false && (activeTabKey === 1 || activeTabKey === 2)) {
      // vLLM tab (1) or Hardware Accelerators tab (2) is hidden but currently selected
      // Force switch to Overview tab
      setActiveTabKey(0);
    }
  }, [gpuAvailable, activeTabKey]);

  const handleTabClick = (
    _event: React.MouseEvent<HTMLElement, MouseEvent>,
    tabIndex: string | number,
  ) => {
    setActiveTabKey(Number(tabIndex));
  };

  const handleSettingsSave = () => {
    const config = getSessionConfig();
    setConfiguredModel(config.ai_model || '');
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
    // Dispatch custom event to notify AIChatPage that settings were closed
    window.dispatchEvent(new CustomEvent('settings-closed'));
  };

  return (
    <Page>
      <PageSection variant="light">
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>
            <Title headingLevel="h1" size="2xl">
              AI Observability
            </Title>
            <TextContent>
              <Text component={TextVariants.p} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                {gpuAvailable === true
                  ? "Monitor, analyze, and get AI-powered insights for your vLLM and OpenShift workloads"
                  : "Monitor, analyze and get AI-powered insights for OpenShift metrics"}
              </Text>
            </TextContent>
          </FlexItem>
          <FlexItem>
            <Button variant="secondary" onClick={() => setIsSettingsOpen(true)} icon={<CogIcon />}>
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
        onClose={handleSettingsClose}
        onSave={handleSettingsSave}
      />

      <PageSection type="tabs" variant="light" style={{ paddingBottom: 0 }}>
        <Tabs activeKey={activeTabKey} onSelect={handleTabClick} aria-label="AI Observability tabs">
          <Tab
            eventKey={0}
            title={
              <>
                <TabTitleIcon>
                  <TachometerAltIcon />
                </TabTitleIcon>
                <TabTitleText>Overview</TabTitleText>
              </>
            }
            aria-label="Overview"
          />
          {/* Only show vLLM Metrics tab if GPU available */}
          {gpuAvailable === true && (
            <Tab
              eventKey={1}
              title={
                <>
                  <TabTitleIcon>
                    <ServerIcon />
                  </TabTitleIcon>
                  <TabTitleText>vLLM Metrics</TabTitleText>
                </>
              }
              aria-label="vLLM Metrics"
            />
          )}
          {/* Only show Hardware Accelerators tab if GPU available (only shows GPU/accelerator metrics) */}
          {gpuAvailable === true && (
            <Tab
              eventKey={2}
              title={
                <>
                  <TabTitleIcon><CubeIcon /></TabTitleIcon>
                  <TabTitleText>Hardware Accelerators</TabTitleText>
                </>
              }
              aria-label="Hardware Accelerators"
            />
          )}
          <Tab
            eventKey={3}
            title={
              <>
                <TabTitleIcon>
                  <CubesIcon />
                </TabTitleIcon>
                <TabTitleText>OpenShift</TabTitleText>
              </>
            }
            aria-label="OpenShift Metrics"
          />
          <Tab
            eventKey={4}
            title={
              <>
                <TabTitleIcon>
                  <CommentIcon />
                </TabTitleIcon>
                <TabTitleText>Chat with Prometheus</TabTitleText>
              </>
            }
            aria-label="Chat with Prometheus"
          />
        </Tabs>
      </PageSection>

      <PageSection>
        {activeTabKey === 0 && <OverviewDashboard gpuAvailable={gpuAvailable} />}
        {activeTabKey === 1 && gpuAvailable === true && <VLLMMetricsPage />}
        {activeTabKey === 2 && gpuAvailable === true && <DeviceMetricsPage />}
        {activeTabKey === 3 && <OpenShiftMetricsPage />}
        {activeTabKey === 4 && <AIChatPage gpuAvailable={gpuAvailable} />}
      </PageSection>
    </Page>
  );
};

export { AIObservabilityPage };
export default AIObservabilityPage;
