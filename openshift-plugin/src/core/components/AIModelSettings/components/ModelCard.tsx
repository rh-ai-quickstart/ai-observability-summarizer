import * as React from 'react';
import {
  Card,
  CardBody,
  Button,
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
  Label,
  Split,
  SplitItem,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TimesCircleIcon,
  KeyIcon,
  ServerIcon,
  ExternalLinkAltIcon,
  CubeIcon,
} from '@patternfly/react-icons';

import { Model, ProviderCredential } from '../types/models';
import { getProviderTemplate } from '../services/providerTemplates';

interface ModelCardProps {
  model: Model;
  isSelected: boolean;
  providerStatus?: ProviderCredential;
  onSelect: () => void;
}

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isSelected,
  providerStatus,
  onSelect,
}) => {
  const template = getProviderTemplate(model.provider);
  
  const getProviderIcon = () => {
    switch (model.provider) {
      case 'internal':
        return ServerIcon;
      case 'openai':
      case 'anthropic':
      case 'google':
      case 'meta':
        return ExternalLinkAltIcon;
      default:
        return CubeIcon;
    }
  };

  const getStatusIcon = () => {
    if (!model.requiresApiKey) {
      return <CheckCircleIcon style={{ color: 'var(--pf-v5-global--success-color--100)' }} />;
    }

    if (!providerStatus) {
      return <ExclamationTriangleIcon style={{ color: 'var(--pf-v5-global--warning-color--100)' }} />;
    }

    switch (providerStatus.status) {
      case 'configured':
        return <CheckCircleIcon style={{ color: 'var(--pf-v5-global--success-color--100)' }} />;
      case 'missing':
        return <ExclamationTriangleIcon style={{ color: 'var(--pf-v5-global--warning-color--100)' }} />;
      case 'invalid':
        return <TimesCircleIcon style={{ color: 'var(--pf-v5-global--danger-color--100)' }} />;
      case 'testing':
        return <KeyIcon style={{ color: 'var(--pf-v5-global--info-color--100)' }} />;
      default:
        return <ExclamationTriangleIcon style={{ color: 'var(--pf-v5-global--warning-color--100)' }} />;
    }
  };

  const getStatusLabel = () => {
    if (!model.requiresApiKey) {
      return <Label color="green">Ready</Label>;
    }

    if (!providerStatus) {
      return <Label color="grey">Loading...</Label>;
    }

    switch (providerStatus.status) {
      case 'configured':
        return <Label color="green">Ready</Label>;
      case 'missing':
        return <Label color="orange">Setup Required</Label>;
      case 'invalid':
        return <Label color="red">Invalid Key</Label>;
      case 'testing':
        return <Label color="blue">Testing...</Label>;
      default:
        return <Label color="grey">Unknown</Label>;
    }
  };

  const getCredentialInfo = () => {
    if (!model.requiresApiKey) {
      return 'No credentials required';
    }

    if (!providerStatus) {
      return 'Loading credential status...';
    }

    switch (providerStatus.status) {
      case 'configured':
        return `API key configured via ${providerStatus.storage === 'secret' ? 'OpenShift secret' : 'browser cache'}`;
      case 'missing':
        return 'API key required - click to configure';
      case 'invalid':
        return 'API key is invalid or expired';
      case 'testing':
        return 'Testing API key connection...';
      default:
        return 'Credential status unknown';
    }
  };

  const canSelect = () => {
    return !model.requiresApiKey || (providerStatus && providerStatus.status === 'configured');
  };

  const ProviderIcon = getProviderIcon();

  return (
    <Card
      isSelectable
      isSelected={isSelected}
      style={{
        border: isSelected ? '2px solid var(--pf-v5-global--primary-color--100)' : undefined,
        backgroundColor: isSelected ? 'var(--pf-v5-global--BackgroundColor--light-300)' : undefined,
        opacity: canSelect() ? 1 : 0.7,
      }}
    >
      <CardBody>
        <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
          {/* Header with model name and status */}
          <FlexItem>
            <Split hasGutter>
              <SplitItem>
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem>
                    <ProviderIcon style={{ marginRight: '8px' }} />
                  </FlexItem>
                  <FlexItem>
                    <TextContent>
                      <Text component={TextVariants.h4} style={{ margin: 0 }}>
                        {model.name}
                      </Text>
                    </TextContent>
                  </FlexItem>
                </Flex>
              </SplitItem>
              <SplitItem isFilled />
              <SplitItem>
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem style={{ marginRight: '8px' }}>
                    {getStatusIcon()}
                  </FlexItem>
                  <FlexItem>
                    {getStatusLabel()}
                  </FlexItem>
                </Flex>
              </SplitItem>
            </Split>
          </FlexItem>

          {/* Provider and description */}
          <FlexItem>
            <TextContent>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                Provider: {template.label}
                {model.description && ` • ${model.description}`}
              </Text>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
                {getCredentialInfo()}
              </Text>
            </TextContent>
          </FlexItem>

          {/* Action buttons */}
          <FlexItem>
            <Flex>
              <FlexItem>
                <Button
                  variant={isSelected ? "secondary" : "primary"}
                  onClick={onSelect}
                  isDisabled={!canSelect()}
                  size="sm"
                >
                  {isSelected ? 'Selected' : 'Select'}
                </Button>
              </FlexItem>
              {model.requiresApiKey && providerStatus && providerStatus.status !== 'configured' && (
                <FlexItem>
                  <Button variant="link" size="sm">
                    Configure API Key
                  </Button>
                </FlexItem>
              )}
              {model.type === 'custom' && (
                <FlexItem>
                  <Button variant="link" size="sm" isDanger>
                    Remove
                  </Button>
                </FlexItem>
              )}
            </Flex>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};

export default ModelCard;