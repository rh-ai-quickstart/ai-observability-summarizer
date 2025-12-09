import * as React from 'react';
import {
  Card,
  CardBody,
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  KeyIcon,
} from '@patternfly/react-icons';

import { AIModelState } from '../types/models';
import { ProviderInlineItem } from '../components/ProviderInlineItem';
import { getExternalProviders } from '../services/providerTemplates';

interface APIKeysTabProps {
  state: AIModelState;
  onProviderUpdate: () => void;
}

export const APIKeysTab: React.FC<APIKeysTabProps> = ({
  state,
  onProviderUpdate,
}) => {
  const externalProviders = getExternalProviders();

  const getProviderStatus = (provider: string) => {
    return state.providers[provider as keyof typeof state.providers];
  };

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Header */}
      <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '24px' }}>
        <FlexItem>
          <TextContent>
            <Text component={TextVariants.h2}>
              <KeyIcon style={{ marginRight: '8px' }} />
              API Key Management
            </Text>
            <Text component={TextVariants.p} style={{ marginTop: '8px' }}>
              Configure API keys for external AI providers. Keys can be stored securely in OpenShift secrets or temporarily in browser cache.
            </Text>
          </TextContent>
        </FlexItem>
      </Flex>

      {/* Providers - Compact inline sections */}
      <div style={{ display: 'grid', gap: '12px' }}>
        {externalProviders.map((provider) => {
          const status = getProviderStatus(provider.provider);
          
          return (
            <ProviderInlineItem
              key={provider.provider}
              provider={provider}
              status={status}
              onUpdate={onProviderUpdate}
            />
          );
        })}
      </div>

      {/* Security Notice */}
      <Card isCompact style={{ marginTop: '32px', backgroundColor: 'var(--pf-v5-global--BackgroundColor--light-300)' }}>
        <CardBody>
          <TextContent>
            <Text component={TextVariants.h4}>
              <CheckCircleIcon style={{ color: 'var(--pf-v5-global--success-color--100)', marginRight: '8px' }} />
              Security Best Practices
            </Text>
            <Text component={TextVariants.small} style={{ marginTop: '8px' }}>
              <strong>OpenShift Secrets</strong> (Recommended): API keys are encrypted and stored securely in your cluster. 
              They persist across browser sessions and are protected by Kubernetes RBAC.
            </Text>
            <Text component={TextVariants.small} style={{ marginTop: '8px' }}>
              <strong>Browser Cache</strong> (Temporary): API keys are stored in your browser's local storage. 
              They will be lost when you clear browser data or use a different device.
            </Text>
          </TextContent>
        </CardBody>
      </Card>
    </div>
  );
};

export default APIKeysTab;