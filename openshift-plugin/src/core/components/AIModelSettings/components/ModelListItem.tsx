import * as React from 'react';
import {
  Radio,
  Flex,
  FlexItem,
  Label,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationTriangleIcon, TimesCircleIcon, ServerIcon, ExternalLinkAltIcon, CubeIcon } from '@patternfly/react-icons';
import { Model, ProviderCredential } from '../types/models';
import { getProviderTemplate } from '../services/providerTemplates';

interface ModelListItemProps {
  model: Model;
  isSelected: boolean;
  providerStatus: ProviderCredential;
  onSelect: () => void;
}

export const ModelListItem: React.FC<ModelListItemProps> = ({
  model,
  isSelected,
  providerStatus,
  onSelect,
}) => {
  const template = getProviderTemplate(model.provider);

  const canSelect = !model.requiresApiKey || providerStatus.status === 'configured';

  const ProviderIcon = (() => {
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
  })();

  const statusLabel = (() => {
    if (!model.requiresApiKey) {
      return <Label color="green">Ready</Label>;
    }
    switch (providerStatus.status) {
      case 'configured':
        return <Label color="green">Ready</Label>;
      case 'missing':
        return <Label color="orange">Setup Required</Label>;
      case 'invalid':
        return <Label color="red">Invalid Key</Label>;
      default:
        return <Label color="grey">Unknown</Label>;
    }
  })();

  const statusIcon = (() => {
    if (!model.requiresApiKey) {
      return <CheckCircleIcon style={{ color: 'var(--pf-v5-global--success-color--100)' }} />;
    }
    switch (providerStatus.status) {
      case 'configured':
        return <CheckCircleIcon style={{ color: 'var(--pf-v5-global--success-color--100)' }} />;
      case 'missing':
        return <ExclamationTriangleIcon style={{ color: 'var(--pf-v5-global--warning-color--100)' }} />;
      case 'invalid':
        return <TimesCircleIcon style={{ color: 'var(--pf-v5-global--danger-color--100)' }} />;
      default:
        return <ExclamationTriangleIcon style={{ color: 'var(--pf-v5-global--warning-color--100)' }} />;
    }
  })();

  return (
    <div
      style={{
        padding: '8px 12px',
        border: '1px solid var(--pf-v5-global--BorderColor--100)',
        borderRadius: 6,
        background: isSelected ? 'var(--pf-v5-global--BackgroundColor--200)' : 'transparent',
        opacity: canSelect ? 1 : 0.6,
      }}
    >
      <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
        <FlexItem>
          <Radio
            id={`ai-model-choice-${model.id || model.name.replace(/[^a-zA-Z0-9_-]/g, '')}`}
            name="ai-model-choice"
            isChecked={isSelected}
            onChange={onSelect}
            isDisabled={!canSelect}
            aria-label={`Select model ${model.name}`}
          />
        </FlexItem>
        <FlexItem>
          <ProviderIcon />
        </FlexItem>
        <FlexItem grow={{ default: 'grow' }}>
          <TextContent>
            <Text component={TextVariants.small} style={{ margin: 0 }}>
              <strong>{model.name}</strong>
            </Text>
            <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
              Provider: {template.label}{model.description ? ` • ${model.description}` : ''}
            </Text>
          </TextContent>
        </FlexItem>
        <FlexItem style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {statusIcon}
          {statusLabel}
        </FlexItem>
      </Flex>
    </div>
  );
};

export default ModelListItem;


