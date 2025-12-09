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
  TextInput,
  TextArea,
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
  Alert,
  AlertVariant,
  Checkbox,
  Title,
} from '@patternfly/react-core';
import {
  PlusCircleIcon,
  InfoCircleIcon,
} from '@patternfly/react-icons';

import { AIModelState, ModelFormData, Provider } from '../types/models';
import { getAllProviders, getProviderTemplate, formatModelName, isValidApiKey } from '../services/providerTemplates';
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
    apiKey: '',
    saveToSecret: true,
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const providers = getAllProviders().filter(p => p.provider !== 'internal'); // Exclude internal for custom models

  const handleProviderChange = (provider: Provider) => {
    const template = getProviderTemplate(provider);
    setFormData(prev => ({
      ...prev,
      provider,
      endpoint: template.defaultEndpoint,
      apiKey: '',
    }));
    setError(null);
  };

  const handleSubmit = async () => {
    // Validate form
    if (!formData.modelId.trim()) {
      setError('Model ID is required');
      return;
    }

    if (formData.provider !== 'other' && formData.apiKey && !isValidApiKey(formData.provider, formData.apiKey)) {
      setError(`Invalid API key format for ${getProviderTemplate(formData.provider).label}`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Add the custom model
      await modelService.addCustomModel(formData);
      
      // Reset form
      setFormData({
        provider: 'openai',
        modelId: '',
        endpoint: getProviderTemplate('openai').defaultEndpoint,
        description: '',
        apiKey: '',
        saveToSecret: true,
      });

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
  const requiresApiKey = template.requiresApiKey;

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
          Add a custom AI model to the available models list. You can configure models from supported providers 
          or add custom endpoints for other AI services.
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

            {/* Model ID */}
            <FormGroup label="Model ID" isRequired fieldId="model-id" style={{ marginTop: '16px' }}>
              <TextInput
                id="model-id"
                value={formData.modelId}
                onChange={(_event, value) => setFormData(prev => ({ ...prev, modelId: value }))}
                placeholder={`e.g., ${template.commonModels?.[0] || 'model-name'}`}
              />
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
                <strong>Preview:</strong> {getModelPreview()}
              </Text>
            </FormGroup>

            {/* Common Models Suggestions */}
            {template.commonModels && template.commonModels.length > 0 && (
              <FormGroup fieldId="common-models" style={{ marginTop: '12px' }}>
                <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: '8px' }}>
                  Popular models for {template.label}:
                </Text>
                <Flex spaceItems={{ default: 'spaceItemsXs' }}>
                  {template.commonModels.map((model) => (
                    <FlexItem key={model}>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setFormData(prev => ({ ...prev, modelId: model }))}
                      >
                        {model}
                      </Button>
                    </FlexItem>
                  ))}
                </Flex>
              </FormGroup>
            )}

            {/* API Endpoint */}
            <FormGroup label="API Endpoint (Optional)" fieldId="endpoint" style={{ marginTop: '16px' }}>
              <TextInput
                id="endpoint"
                value={formData.endpoint}
                onChange={(_event, value) => setFormData(prev => ({ ...prev, endpoint: value }))}
                placeholder={template.defaultEndpoint}
              />
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
                Leave empty to use default endpoint for {template.label}
              </Text>
            </FormGroup>

            {/* Description */}
            <FormGroup label="Description (Optional)" fieldId="description" style={{ marginTop: '16px' }}>
              <TextArea
                id="description"
                value={formData.description}
                onChange={(_event, value) => setFormData(prev => ({ ...prev, description: value }))}
                placeholder="Optional description for this model"
                rows={2}
              />
            </FormGroup>

            {/* API Key Section (for external providers) */}
            {requiresApiKey && (
              <>
                <FormGroup 
                  label="API Key (Optional)" 
                  fieldId="api-key" 
                  style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--pf-v5-global--BorderColor--100)' }}
                >
                  <TextInput
                    id="api-key"
                    type="password"
                    value={formData.apiKey}
                    onChange={(_event, value) => setFormData(prev => ({ ...prev, apiKey: value }))}
                    placeholder={`Enter ${template.label} API key`}
                  />
                  <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
                    You can add this later in the API Keys tab if you prefer
                  </Text>
                </FormGroup>

                {/* Storage Option */}
                {formData.apiKey && (
                  <FormGroup fieldId="storage-option" style={{ marginTop: '12px' }}>
                    <Checkbox
                      id="save-to-secret"
                      label="Save API key as OpenShift Secret"
                      description="Recommended for security and persistence across browser sessions"
                      isChecked={formData.saveToSecret}
                      onChange={(_event, checked) => setFormData(prev => ({ ...prev, saveToSecret: checked }))}
                    />
                  </FormGroup>
                )}
              </>
            )}

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
                        apiKey: '',
                        saveToSecret: true,
                      });
                      setError(null);
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

      {/* Information Card */}
      <Card isCompact style={{ marginTop: '24px', backgroundColor: 'var(--pf-v5-global--BackgroundColor--light-200)' }}>
        <CardBody>
          <Flex alignItems={{ default: 'alignItemsFlexStart' }}>
            <FlexItem>
              <InfoCircleIcon style={{ color: 'var(--pf-v5-global--info-color--100)', marginRight: '8px', marginTop: '2px' }} />
            </FlexItem>
            <FlexItem>
              <TextContent>
                <Text component={TextVariants.h4} style={{ margin: '0 0 8px 0' }}>
                  Custom Model Guidelines
                </Text>
                <Text component={TextVariants.small}>
                  • Models will be displayed in <strong>provider/model-id</strong> format
                </Text>
                <Text component={TextVariants.small}>
                  • External providers require valid API keys for authentication
                </Text>
                <Text component={TextVariants.small}>
                  • Use OpenShift secrets for secure, persistent credential storage
                </Text>
                <Text component={TextVariants.small}>
                  • Custom models can be removed from the Available Models tab
                </Text>
              </TextContent>
            </FlexItem>
          </Flex>
        </CardBody>
      </Card>
    </div>
  );
};

export default AddModelTab;