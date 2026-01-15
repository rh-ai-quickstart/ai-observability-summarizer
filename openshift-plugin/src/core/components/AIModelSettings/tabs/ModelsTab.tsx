import * as React from 'react';
import {
  Card,
  CardBody,
  Button,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
  EmptyState,
  EmptyStateBody,
  Title,
} from '@patternfly/react-core';
import { SyncAltIcon, CubeIcon } from '@patternfly/react-icons';

import { AIModelState } from '../types/models';
// Dropdown redesign - show internal and external together

interface ModelsTabProps {
  state: AIModelState;
  onModelSelect: (modelName: string) => void;
  onRefresh: () => void;
  onGoToApiKeys: () => void;
  onGoToAddModel: () => void;
}

export const ModelsTab: React.FC<ModelsTabProps> = ({
  state,
  onModelSelect,
  onRefresh,
  onGoToApiKeys,
  onGoToAddModel,
}) => {
  const allModels = [...state.internalModels, ...state.externalModels, ...state.customModels];
  const hasModels = allModels.length > 0;

  const selectedValue = state.selectedModel || '';
  const hasSelectableInternal = state.internalModels.length > 0; // internal models don't need keys
  const hasSelectableExternal = state.externalModels.some(m => state.providers[m.provider]?.status === 'configured');
  const hasSelectableCustom = state.customModels.some(m => !m.requiresApiKey || state.providers[m.provider]?.status === 'configured');
  const hasAnySelectable = hasSelectableInternal || hasSelectableExternal || hasSelectableCustom;

  if (!hasModels && !state.loading.models) {
    return (
      <div style={{ padding: '20px 0' }}>
        <EmptyState>
          <CubeIcon />
          <Title headingLevel="h2" size="lg" as="h2">
            No Models Available
          </Title>
          <EmptyStateBody>
            No AI models are currently available. This might be because:
            <ul style={{ textAlign: 'left', marginTop: '12px' }}>
              <li>The MCP server is not running or accessible</li>
              <li>No models are configured on your cluster</li>
              <li>You don't have permission to access model resources</li>
            </ul>
          </EmptyStateBody>
          <Button variant="primary" onClick={onRefresh}>
            <SyncAltIcon style={{ marginRight: '8px' }} />
            Retry Loading
          </Button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Header with refresh button */}
      <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '24px' }}>
        <FlexItem>
          <TextContent>
            <Text component={TextVariants.p}>
              Select an AI model for analysis and summarization. Models are organized by provider and require appropriate credentials.
            </Text>
          </TextContent>
        </FlexItem>
        <FlexItem>
          <Button
            variant="secondary"
            onClick={onRefresh}
            isDisabled={state.loading.models}
          >
            <SyncAltIcon style={{ marginRight: '8px' }} />
            Refresh
          </Button>
        </FlexItem>
      </Flex>

      {/* If nothing is selectable, show an EmptyState with actions */}
      {!hasAnySelectable && (
        <Card>
          <CardBody>
            <EmptyState>
              <Title headingLevel="h2" size="lg" as="h2">
                No Models Available
              </Title>
              <EmptyStateBody>
                No models are currently available to select. Configure an API key for an external provider or add a custom model.
              </EmptyStateBody>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <Button variant="primary" onClick={onGoToApiKeys}>Configure API key</Button>
                <Button variant="secondary" onClick={onGoToAddModel}>Add custom model</Button>
              </div>
            </EmptyState>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <FormGroup label="Select a model or add a custom one" fieldId="model-select">
            <FormSelect
              id="model-select"
              value={selectedValue || ''}
              onChange={(_e, value) => {
                const v = String(value);
                if (!v || v.startsWith('__grp__')) return;
                onModelSelect(v);
              }}
              aria-label="Available models"
              isDisabled={!hasAnySelectable}
            >
              <FormSelectOption isDisabled isPlaceholder key="placeholder" value="" label="Select a model..." />

              {/* Internal group header */}
              <FormSelectOption
                isDisabled
                key="grp-internal"
                value="__grp__internal"
                label={`— Internal Models (No API Key) —`}
              />
              {/* Internal models */}
              {state.internalModels.map((m) => (
                <FormSelectOption key={m.id} value={m.name} label={m.name} />
              ))}

              {/* External group header */}
              <FormSelectOption
                isDisabled
                key="grp-external"
                value="__grp__external"
                label={`— External Models (API Key Required) —`}
              />
              {state.externalModels.map((m) => (
                <FormSelectOption
                  key={m.id}
                  value={m.name}
                  label={
                    state.providers[m.provider]?.status === 'configured'
                      ? m.name
                      : `${m.name} — API key required (configure in API Keys tab)`
                  }
                  isDisabled={state.providers[m.provider]?.status !== 'configured'}
                />
              ))}

              {/* Custom group header and items (if any) */}
              {state.customModels.length > 0 && (
                <>
                  <FormSelectOption
                    isDisabled
                    key="grp-custom"
                    value="__grp__custom"
                    label="— Custom Models —"
                  />
                  {state.customModels.map((m) => (
                    <FormSelectOption
                      key={m.id}
                      value={m.name}
                      label={
                        m.requiresApiKey && state.providers[m.provider]?.status !== 'configured'
                          ? `${m.name} — API key required (configure in API Keys tab)`
                          : m.name
                      }
                      isDisabled={m.requiresApiKey && state.providers[m.provider]?.status !== 'configured'}
                    />
                  ))}
                </>
              )}
            </FormSelect>
          </FormGroup>
          {/* Inline hint + link to configure API keys when any models are disabled */}
          {(
            state.externalModels.some(m => state.providers[m.provider]?.status !== 'configured') ||
            state.customModels.some(m => m.requiresApiKey && state.providers[m.provider]?.status !== 'configured')
          ) && (
            <TextContent>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                Some models are disabled because an API key is required.{' '}
                <Button variant="link" isInline onClick={onGoToApiKeys}>
                  Configure API key
                </Button>
              </Text>
            </TextContent>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default ModelsTab;