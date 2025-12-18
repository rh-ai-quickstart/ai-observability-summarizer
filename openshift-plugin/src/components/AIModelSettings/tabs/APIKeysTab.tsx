import * as React from 'react';
import {
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import {
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
              Configure API keys for external AI providers. Keys are securely stored as OpenShift Secrets.
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
    </div>
  );
};

export default APIKeysTab;