import * as React from 'react';
import {
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
  Alert,
  AlertVariant,
  Button,
} from '@patternfly/react-core';
import {
  KeyIcon,
} from '@patternfly/react-icons';

import { AIModelState } from '../types/models';
import { ProviderInlineItem } from '../components/ProviderInlineItem';
import { getExternalProviders, PROVIDER_TEMPLATES } from '../services/providerTemplates';
import { DevModeBanner } from '../components/DevModeBanner';
import { isDevMode } from '../../../services/runtimeConfig';

interface APIKeysTabProps {
  state: AIModelState;
  onProviderUpdate: () => void;
  onGoToAddModel: () => void;
}

export const APIKeysTab: React.FC<APIKeysTabProps> = ({
  state,
  onProviderUpdate,
  onGoToAddModel,
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
      {PROVIDER_TEMPLATES.maas && (
        <Alert
          variant={AlertVariant.info}
          title="Model as a Service (MaaS) uses per-model API keys"
          isInline
          style={{ marginBottom: '16px' }}
        >
          <p>
            Unlike other providers, each MAAS model requires its own API key.
            Configure API keys when adding individual models in the{' '}
            <Button variant="link" isInline onClick={onGoToAddModel}>
              Add Model
            </Button>{' '}
            tab.
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