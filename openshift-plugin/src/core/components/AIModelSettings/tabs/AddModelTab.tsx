import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
  Alert,
  AlertVariant,
  Title,
  Spinner,
  EmptyState,
  EmptyStateIcon,
  EmptyStateBody,
  TextInput,
  FormHelperText,
  HelperText,
  HelperTextItem,
} from '@patternfly/react-core';
import {
  PlusCircleIcon,
  SearchIcon,
} from '@patternfly/react-icons';

import { AIModelState, ModelFormData, Provider, ProviderModel } from '../types/models';
import { getAllProviders, getProviderTemplate, formatModelName } from '../services/providerTemplates';
import { modelService } from '../services/modelService';
import { isDevMode } from '../../../services/runtimeConfig';

interface AddModelTabProps {
  state: AIModelState;
  onModelAdd: () => void;
  onSuccess: () => void;
  onGoToApiKeys: () => void;
}

export const AddModelTab: React.FC<AddModelTabProps> = ({
  state,
  onModelAdd,
  onSuccess,
  onGoToApiKeys,
}) => {
  // Default to MAAS provider
  const getInitialProvider = (): Provider => {
    return 'maas';
  };

  const initialProvider = getInitialProvider();
  const [formData, setFormData] = React.useState<ModelFormData>({
    provider: initialProvider,
    modelId: '',
    endpoint: getProviderTemplate(initialProvider).defaultEndpoint,
    description: '',
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [availableModels, setAvailableModels] = React.useState<ProviderModel[]>([]);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [customModelId, setCustomModelId] = React.useState('');
  const [mode, setMode] = React.useState<'add' | 'update'>('add');
  const [isConfiguredModel, setIsConfiguredModel] = React.useState(false);

  const providers = getAllProviders().filter(p => p.provider !== 'internal' && p.provider !== 'other'); // Exclude internal and custom provider

  const fetchAvailableModels = async (provider: Provider) => {
    setLoadingModels(true);
    setError(null);
    setAvailableModels([]);

    try {
      // Get available models from provider
      const providerModels = await modelService.listProviderModels(provider);

      // Get currently configured models
      const configured = await modelService.getConfiguredModels();

      // For MAAS: Don't filter out configured models (allow updates)
      // For other providers: Filter out configured models
      const filtered = provider === 'maas'
        ? providerModels.map(model => ({
            ...model,
            isConfigured: configured.includes(formatModelName(provider, model.id))
          }))
        : providerModels.filter(model => {
            const modelKey = formatModelName(provider, model.id);
            return !configured.includes(modelKey);
          });

      setAvailableModels(filtered);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch models';
      setError(errorMessage);
      setAvailableModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleProviderChange = (provider: Provider) => {
    const template = getProviderTemplate(provider);
    setFormData(prev => ({
      ...prev,
      provider,
      endpoint: template.defaultEndpoint,
      modelId: '',
      apiKey: undefined,
    }));
    setCustomModelId('');
    setIsConfiguredModel(false);
    setMode('add');
    setError(null);

    // Fetch available models for the selected provider
    fetchAvailableModels(provider);
  };

  // Fetch models on initial load
  React.useEffect(() => {
    // MAAS doesn't require global API key, so always fetch models for it
    if (formData.provider === 'maas') {
      fetchAvailableModels(formData.provider);
      return;
    }

    // For other providers, check if API key is configured
    if (state.providers[formData.provider]?.status === 'configured') {
      fetchAvailableModels(formData.provider);
    } else {
      // Check if any provider has an API key configured
      const hasAnyConfiguredProvider = providers.some(p => state.providers[p.provider]?.status === 'configured');

      if (!hasAnyConfiguredProvider) {
        // No providers configured - show helpful message instead of error
        setError('No API keys configured. Please configure at least one provider API key in the API Keys tab, or use MAAS which requires per-model API keys.');
      }
    }
  }, []);

  const handleSubmit = async () => {
    // Determine the actual model ID (from dropdown or custom input)
    const actualModelId = formData.provider === 'maas' && customModelId.trim()
      ? customModelId.trim()
      : formData.modelId.trim();

    // Validate form
    if (!actualModelId) {
      setError('Model selection is required');
      return;
    }

    // MAAS-specific validation
    if (formData.provider === 'maas' && !formData.apiKey?.trim()) {
      setError('API key is required for MAAS models');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (mode === 'update' && formData.provider === 'maas') {
        // Update existing MAAS model API key
        await modelService.updateMaasModelApiKey({
          ...formData,
          modelId: actualModelId,
        });
      } else {
        // Add new model to ConfigMap via MCP tool
        await modelService.addModelToConfig({
          ...formData,
          modelId: actualModelId,
        });
      }

      // Reset form (keep the same provider)
      setFormData(prev => ({
        ...prev,
        modelId: '',
        description: '',
        apiKey: undefined,
      }));
      setCustomModelId('');
      setIsConfiguredModel(false);
      setMode('add');

      // Refresh available models
      await fetchAvailableModels(formData.provider);

      // Notify parent components
      onModelAdd();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ' + (mode === 'update' ? 'update' : 'add') + ' model');
    } finally {
      setSaving(false);
    }
  };

  const getModelPreview = () => {
    // For MAAS, use custom model ID if provided, otherwise use selected model
    const actualModelId = formData.provider === 'maas' && customModelId.trim()
      ? customModelId.trim()
      : formData.modelId.trim();

    if (!actualModelId) return 'provider/model-id';
    return formatModelName(formData.provider, actualModelId);
  };

  const template = getProviderTemplate(formData.provider);

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Header */}
      <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '24px' }}>
        <FlexItem>
          <Title headingLevel="h2" size="xl">
            <PlusCircleIcon style={{ marginRight: '8px' }} />
            Add External Model
          </Title>
        </FlexItem>
      </Flex>

      <TextContent style={{ marginBottom: '24px' }}>
        <Text component={TextVariants.p}>
          {isDevMode() ? (
            <>
              Add AI models from supported providers for testing and development.
              Select a provider and choose from available models. <strong>Models are saved to your browser session storage</strong> and will be cleared when you close the tab.
              Configure API keys in the <strong>API Keys</strong> tab (also stored in browser) before adding models from external providers.
            </>
          ) : (
            <>
              Add AI models from supported providers to your cluster configuration.
              Select a provider and choose from available models. Models are saved to cluster storage and shared across all users.
              Configure API keys in the <strong>API Keys</strong> tab before adding models from external providers.
            </>
          )}
        </Text>
      </TextContent>

      {/* Form Card */}
      <Card>
        <CardTitle>Model Configuration</CardTitle>
        <CardBody>
          <Form>
            {error && (
              <Alert
                variant={AlertVariant.danger}
                title="Error"
                isInline
                style={{ marginBottom: '20px' }}
              >
                <div>
                  {error}
                  {(error.includes('API key not found') || error.includes('API Keys tab')) && (
                    <div style={{ marginTop: '8px' }}>
                      <Button variant="link" isInline onClick={onGoToApiKeys}>
                        Go to API Keys tab
                      </Button>
                    </div>
                  )}
                </div>
              </Alert>
            )}

            {/* Provider Selection */}
            <FormGroup label="Provider" isRequired fieldId="provider">
              <FormSelect
                id="provider"
                value={formData.provider}
                onChange={(_event, value) => handleProviderChange(value as Provider)}
                aria-label="Select provider"
              >
                {providers.map((provider) => (
                  <FormSelectOption 
                    key={provider.provider} 
                    value={provider.provider} 
                    label={provider.label}
                  />
                ))}
              </FormSelect>
            </FormGroup>

            {/* Model Selection */}
            <FormGroup label="Select Model" isRequired fieldId="model-select" style={{ marginTop: '16px' }}>
              {loadingModels ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
                  <Spinner size="md" />
                  <Text component={TextVariants.p}>Loading available models...</Text>
                </div>
              ) : availableModels.length === 0 && !error && formData.provider !== 'maas' ? (
                <EmptyState variant="xs">
                  <EmptyStateIcon icon={SearchIcon} />
                  <EmptyStateBody>
                    No new models available for {template.label}. All models are already configured or API key may be required.
                  </EmptyStateBody>
                </EmptyState>
              ) : (
                <>
                  {availableModels.length > 0 && (
                    <>
                      <FormSelect
                        id="model-select"
                        value={formData.modelId}
                        onChange={(_event, value) => {
                          const selectedModel = availableModels.find(m => m.id === value);
                          const isConfigured = selectedModel && (selectedModel as any).isConfigured;

                          setFormData(prev => ({
                            ...prev,
                            modelId: value,
                            description: selectedModel?.description || prev.description
                          }));

                          // For MAAS models, check if it's already configured
                          if (formData.provider === 'maas') {
                            setCustomModelId('');
                            setIsConfiguredModel(!!isConfigured);
                            setMode(isConfigured ? 'update' : 'add');
                          } else {
                            setIsConfiguredModel(false);
                            setMode('add');
                          }
                        }}
                        aria-label="Select model"
                      >
                        <FormSelectOption key="placeholder" value="" label="Select a model..." isDisabled />
                        {availableModels.map((model) => {
                          const isConfigured = (model as any).isConfigured;
                          const label = formData.provider === 'maas' && isConfigured
                            ? `${model.name} (Already configured - Update API key)${model.description ? ` - ${model.description}` : ''}`
                            : `${model.name}${model.description ? ` - ${model.description}` : ''}`;

                          return (
                            <FormSelectOption
                              key={model.id}
                              value={model.id}
                              label={label}
                            />
                          );
                        })}
                      </FormSelect>
                    </>
                  )}

                  {/* Custom Model ID for MAAS */}
                  {formData.provider === 'maas' && (
                    <div style={{ marginTop: availableModels.length > 0 ? '16px' : '0' }}>
                      {availableModels.length > 0 && (
                        <Text component={TextVariants.p} style={{ marginBottom: '8px', fontWeight: 'bold' }}>
                          Or enter custom model ID:
                        </Text>
                      )}
                      <TextInput
                        id="custom-model-id"
                        value={customModelId}
                        onChange={(_event, value) => {
                          setCustomModelId(value);
                          // Clear dropdown selection when typing custom model ID
                          if (value.trim()) {
                            setFormData(prev => ({ ...prev, modelId: '' }));
                            // Custom model IDs are always new models
                            setIsConfiguredModel(false);
                            setMode('add');
                          }
                        }}
                        placeholder="Enter model ID (e.g., qwen3-14b)"
                        aria-label="Custom model ID"
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {availableModels.length > 0
                              ? 'Use this field if your model is not listed above'
                              : 'Enter the MAAS model ID you want to add'}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </div>
                  )}

                  <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '8px' }}>
                    <strong>Preview:</strong> {getModelPreview()}
                  </Text>
                </>
              )}
            </FormGroup>

            {/* Update Mode Warning */}
            {mode === 'update' && formData.provider === 'maas' && isConfiguredModel && (
              <Alert
                variant={AlertVariant.info}
                title="Update Mode"
                isInline
                style={{ marginTop: '16px' }}
              >
                This model is already configured. You can update its API key and endpoint below.
                The existing credentials will be replaced.
              </Alert>
            )}

            {/* MAAS-specific fields: per-model API key and endpoint */}
            {formData.provider === 'maas' && (
              <>
                <FormGroup label="Model API Key" isRequired fieldId="maas-api-key" style={{ marginTop: '16px' }}>
                  <TextInput
                    id="maas-api-key"
                    type="password"
                    value={formData.apiKey || ''}
                    onChange={(_event, value) => setFormData(prev => ({ ...prev, apiKey: value }))}
                    placeholder="Enter API key for this specific model"
                    aria-label="MAAS model API key"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {mode === 'update'
                          ? 'Update the API key to restore access to this model. The previous key will be replaced.'
                          : 'MAAS models require individual API keys. Each model has unique credentials.'}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>

                <FormGroup label="Model Endpoint" fieldId="maas-endpoint" style={{ marginTop: '16px' }}>
                  <TextInput
                    id="maas-endpoint"
                    value={formData.endpoint || ''}
                    onChange={(_event, value) => setFormData(prev => ({ ...prev, endpoint: value }))}
                    placeholder={template.defaultEndpoint}
                    aria-label="MAAS model endpoint"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        Optional: Override default MAAS endpoint for this model
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
              </>
            )}

            {/* Action Buttons */}
            <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid var(--pf-v5-global--BorderColor--100)' }}>
              <Flex>
                <FlexItem>
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    isDisabled={
                      saving ||
                      (!formData.modelId.trim() && !customModelId.trim()) ||
                      (formData.provider === 'maas' && !formData.apiKey?.trim())
                    }
                    isLoading={saving}
                  >
                    <PlusCircleIcon style={{ marginRight: '8px' }} />
                    {mode === 'update' ? 'Update API Key' : 'Add Model'}
                  </Button>
                </FlexItem>
                <FlexItem>
                  <Button
                    variant="link"
                    onClick={() => {
                      setFormData({
                        provider: 'maas',
                        modelId: '',
                        endpoint: getProviderTemplate('maas').defaultEndpoint,
                        description: '',
                        apiKey: undefined,
                      });
                      setCustomModelId('');
                      setIsConfiguredModel(false);
                      setMode('add');
                      setError(null);
                      fetchAvailableModels('maas');
                    }}
                  >
                    Reset Form
                  </Button>
                </FlexItem>
              </Flex>
            </div>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
};

export default AddModelTab;