import * as React from 'react';
import {
  Button,
  Flex,
  FlexItem,
  Tab,
  Tabs,
  TabTitleText,
  Text,
  TextContent,
  TextVariants,
  Tooltip,
} from '@patternfly/react-core';
import { DownloadIcon } from '@patternfly/react-icons';
import { MetricsCatalogTab } from './MetricsCatalogTab';
import { VLLMMetricsSettingsTab } from './VLLMMetricsSettingsTab';
import { OpenShiftMetricsSettingsTab } from './OpenShiftMetricsSettingsTab';

type MetricsSubtab = 'catalog' | 'vllm' | 'openshift';

export const MetricsSettingsTab: React.FC = () => {
  const [activeSubtab, setActiveSubtab] = React.useState<MetricsSubtab>('catalog');

  const catalogDownloadRef = React.useRef<(() => void) | null>(null);
  const vllmDownloadRef = React.useRef<(() => void) | null>(null);
  const openshiftDownloadRef = React.useRef<(() => void) | null>(null);

  const handleSubtabSelect = (_event: React.MouseEvent<HTMLElement, MouseEvent>, tabIndex: string | number) => {
    setActiveSubtab(tabIndex as MetricsSubtab);
  };

  const subtabLabels: Record<MetricsSubtab, string> = {
    catalog: 'Chat Metrics Catalog',
    vllm: 'vLLM Metrics',
    openshift: 'OpenShift Metrics',
  };

  const handleDownload = () => {
    switch (activeSubtab) {
      case 'catalog':
        catalogDownloadRef.current?.();
        break;
      case 'vllm':
        vllmDownloadRef.current?.();
        break;
      case 'openshift':
        openshiftDownloadRef.current?.();
        break;
    }
  };

  return (
    <div style={{ marginTop: '16px' }}>
      <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '16px' }}>
        <FlexItem>
          <TextContent>
            <Text component={TextVariants.h4}>Metrics</Text>
            <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
              Browse and download metrics for Chat, vLLM, and OpenShift.
            </Text>
          </TextContent>
        </FlexItem>
        <FlexItem>
          <Tooltip content={`Download ${subtabLabels[activeSubtab]} as markdown`}>
            <Button
              variant="secondary"
              icon={<DownloadIcon />}
              onClick={handleDownload}
              aria-label={`Download ${subtabLabels[activeSubtab]} as markdown`}
            >
              Download
            </Button>
          </Tooltip>
        </FlexItem>
      </Flex>

      <Tabs
        activeKey={activeSubtab}
        onSelect={handleSubtabSelect}
        aria-label="Metrics subtabs"
        isBox
      >
        <Tab
          eventKey="catalog"
          title={<TabTitleText>Chat Metrics Catalog</TabTitleText>}
          aria-label="Chat Metrics Catalog"
        >
          {activeSubtab === 'catalog' && (
            <MetricsCatalogTab downloadRef={catalogDownloadRef} hideHeader />
          )}
        </Tab>
        <Tab
          eventKey="vllm"
          title={<TabTitleText>vLLM Metrics</TabTitleText>}
          aria-label="vLLM Metrics"
        >
          {activeSubtab === 'vllm' && (
            <VLLMMetricsSettingsTab downloadRef={vllmDownloadRef} hideHeader />
          )}
        </Tab>
        <Tab
          eventKey="openshift"
          title={<TabTitleText>OpenShift Metrics</TabTitleText>}
          aria-label="OpenShift Metrics"
        >
          {activeSubtab === 'openshift' && (
            <OpenShiftMetricsSettingsTab downloadRef={openshiftDownloadRef} hideHeader />
          )}
        </Tab>
      </Tabs>
    </div>
  );
};
