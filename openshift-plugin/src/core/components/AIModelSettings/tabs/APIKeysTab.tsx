import * as React from 'react';
import {
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
  Alert,
  AlertVariant,
} from '@patternfly/react-core';
import {
  KeyIcon,
} from '@patternfly/react-icons';

import { AIModelState } from '../types/models';
import { ProviderInlineItem } from '../components/ProviderInlineItem';
import { getExternalProviders } from '../services/providerTemplates';
import { DevModeBanner } from '../components/DevModeBanner';
import { isDevMode } from '../../../services/devCredentials';

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
      {/* Dev Mode Banner */}
      <DevModeBanner />

      {/* Header */}
      <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '24px' }}>
        <FlexItem>
          <TextContent>
            <Text component={TextVariants.h2}>
              <KeyIcon style={{ marginRight: '8px' }} />
              API Key Management
            </Text>
            <Text component={TextVariants.p} style={{ marginTop: '8px' }}>
              Configure API keys for external AI providers. {isDevMode()
                ? 'Keys are cached in your browser session (dev mode).'
                : 'Keys are securely stored as OpenShift Secrets.'}
            </Text>
          </TextContent>
        </FlexItem>
      </Flex>

      {/* MAAS Info Alert */}
      {externalProviders.some(p => p.provider === 'maas') && (
        <Alert
          variant={AlertVariant.info}
          title="Red Hat MAAS uses per-model API keys"
          isInline
          style={{ marginBottom: '16px' }}
        >
          <p>
            Unlike other providers, each MAAS model requires its own API key.
            Configure API keys when adding individual models in the <strong>Add Model</strong> tab.
          </p>
          <p style={{ marginTop: '8px' }}>
            You can view configured MAAS model credentials in the Kubernetes secret:{' '}
            <code>ai-maas-credentials</code>
          </p>
        </Alert>
      )}

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