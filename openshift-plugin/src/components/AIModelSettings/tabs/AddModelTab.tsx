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
} from '@patternfly/react-core';
import {
  PlusCircleIcon,
  SearchIcon,
} from '@patternfly/react-icons';

import { AIModelState, ModelFormData, Provider, ProviderModel } from '../types/models';
import { getAllProviders, getProviderTemplate, formatModelName } from '../services/providerTemplates';
import { modelService } from '../services/modelService';

interface AddModelTabProps {
  state: AIModelState;
  onModelAdd: () => void;
  onSuccess: () => void;
}

export const AddModelTab: React.FC<AddModelTabProps> = ({
  state,
  onModelAdd,
  onSuccess,
}) => {
  const [formData, setFormData] = React.useState<ModelFormData>({
    provider: 'openai',
    modelId: '',
    endpoint: '',
    description: '',
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [availableModels, setAvailableModels] = React.useState<ProviderModel[]>([]);
  const [loadingModels, setLoadingModels] = React.useState(false);

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

      // Filter out already configured models
      const filtered = providerModels.filter(model => {
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
    }));
    setError(null);

    // Fetch available models for the selected provider
    fetchAvailableModels(provider);
  };

  // Fetch models on initial load
  React.useEffect(() => {
    fetchAvailableModels('openai');
  }, []);

  const handleSubmit = async () => {
    // Validate form
    if (!formData.modelId.trim()) {
      setError('Model selection is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Add model to ConfigMap via MCP tool
      await modelService.addModelToConfig(formData);

      // Reset form
      setFormData({
        provider: 'openai',
        modelId: '',
        endpoint: getProviderTemplate('openai').defaultEndpoint,
        description: '',
      });

      // Refresh available models
      await fetchAvailableModels(formData.provider);

      // Notify parent components
      onModelAdd();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add model');
    } finally {
      setSaving(false);
    }
  };

  const getModelPreview = () => {
    if (!formData.modelId.trim()) return 'provider/model-id';
    return formatModelName(formData.provider, formData.modelId.trim());
  };

  const template = getProviderTemplate(formData.provider);

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Header */}
      <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '24px' }}>
        <FlexItem>
          <Title headingLevel="h2" size="xl">
            <PlusCircleIcon style={{ marginRight: '8px' }} />
            Add Custom Model
          </Title>
        </FlexItem>
      </Flex>

      <TextContent style={{ marginBottom: '24px' }}>
        <Text component={TextVariants.p}>
          Add AI models from supported providers to your cluster configuration.
          Select a provider and choose from available models. Models are saved to cluster storage and shared across all users.
          Configure API keys in the <strong>API Keys</strong> tab before adding models from external providers.
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
                {error}
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
              ) : availableModels.length === 0 && !error ? (
                <EmptyState variant="xs">
                  <EmptyStateIcon icon={SearchIcon} />
                  <EmptyStateBody>
                    No new models available for {template.label}. All models are already configured or API key may be required.
                  </EmptyStateBody>
                </EmptyState>
              ) : (
                <>
                  <FormSelect
                    id="model-select"
                    value={formData.modelId}
                    onChange={(_event, value) => {
                      const selectedModel = availableModels.find(m => m.id === value);
                      setFormData(prev => ({
                        ...prev,
                        modelId: value,
                        description: selectedModel?.description || prev.description
                      }));
                    }}
                    aria-label="Select model"
                    isDisabled={availableModels.length === 0}
                  >
                    <FormSelectOption key="placeholder" value="" label="Select a model..." isDisabled />
                    {availableModels.map((model) => (
                      <FormSelectOption
                        key={model.id}
                        value={model.id}
                        label={`${model.name}${model.description ? ` - ${model.description}` : ''}`}
                      />
                    ))}
                  </FormSelect>
                  <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
                    <strong>Preview:</strong> {getModelPreview()}
                  </Text>
                  {availableModels.length > 0 && (
                    <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
                      {availableModels.length} model(s) available for {template.label}
                    </Text>
                  )}
                </>
              )}
            </FormGroup>

            {/* Action Buttons */}
            <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid var(--pf-v5-global--BorderColor--100)' }}>
              <Flex>
                <FlexItem>
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    isDisabled={saving || !formData.modelId.trim()}
                    isLoading={saving}
                  >
                    <PlusCircleIcon style={{ marginRight: '8px' }} />
                    Add Model
                  </Button>
                </FlexItem>
                <FlexItem>
                  <Button
                    variant="link"
                    onClick={() => {
                      setFormData({
                        provider: 'openai',
                        modelId: '',
                        endpoint: getProviderTemplate('openai').defaultEndpoint,
                        description: '',
                      });
                      setError(null);
                      fetchAvailableModels('openai');
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