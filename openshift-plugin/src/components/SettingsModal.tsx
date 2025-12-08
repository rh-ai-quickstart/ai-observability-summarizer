import * as React from 'react';
import {
  Modal,
  ModalVariant,
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  TextInput,
  Alert,
  AlertVariant,
  Spinner,
  Split,
  SplitItem,
  TextContent,
  Text,
  TextVariants,
  Divider,
  Label,
  ExpandableSection,
  Flex,
  FlexItem,
  Card,
  CardBody,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  KeyIcon,
  TimesIcon,
  PlusCircleIcon,
  TrashIcon,
} from '@patternfly/react-icons';
import {
  listSummarizationModels,
  getSessionConfig,
  setSessionConfig,
  clearSessionConfig,
  SessionConfig,
} from '../services/mcpClient';

// Custom models stored in localStorage
const CUSTOM_MODELS_KEY = 'openshift_ai_observability_custom_models';

interface CustomModel {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'other';
  apiUrl?: string;
  requiresApiKey: boolean;
}

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI', urlTemplate: 'https://api.openai.com/v1/chat/completions' },
  { value: 'anthropic', label: 'Anthropic', urlTemplate: 'https://api.anthropic.com/v1/messages' },
  { value: 'google', label: 'Google', urlTemplate: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent' },
  { value: 'other', label: 'Other', urlTemplate: '' },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [aiModel, setAiModel] = React.useState<string>('');
  const [apiKey, setApiKey] = React.useState<string>('');
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [serverModels, setServerModels] = React.useState<string[]>([]);
  const [customModels, setCustomModels] = React.useState<CustomModel[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [hasApiKey, setHasApiKey] = React.useState(false);
  
  // Add model form state
  const [showAddModel, setShowAddModel] = React.useState(false);
  const [newModelName, setNewModelName] = React.useState('');
  const [newModelProvider, setNewModelProvider] = React.useState<'openai' | 'anthropic' | 'google' | 'other'>('openai');
  const [newModelApiUrl, setNewModelApiUrl] = React.useState('');

  // Combined models list
  const allModels = [...serverModels, ...customModels.map(m => m.name)];

  React.useEffect(() => {
    if (isOpen) {
      fetchModels();
      loadCurrentConfig();
      loadCustomModels();
    }
  }, [isOpen]);

  const loadCustomModels = () => {
    try {
      const stored = localStorage.getItem(CUSTOM_MODELS_KEY);
      if (stored) {
        setCustomModels(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Error loading custom models:', err);
    }
  };

  const saveCustomModels = (models: CustomModel[]) => {
    localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(models));
    setCustomModels(models);
  };

  const fetchModels = async () => {
    setLoading(true);
    try {
      const data = await listSummarizationModels();
      setServerModels(data);
    } catch (err) {
      console.error('Error fetching models:', err);
      setError('Failed to fetch available models from MCP server');
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentConfig = () => {
    const config = getSessionConfig();
    if (config.ai_model) {
      setAiModel(config.ai_model);
    }
    setHasApiKey(!!config.api_key);
  };

  const requiresApiKey = (model: string) => {
    // Check custom models first
    const customModel = customModels.find(m => m.name === model);
    if (customModel) {
      return customModel.requiresApiKey;
    }
    // Default check for server models
    const externalProviders = ['anthropic', 'openai', 'google'];
    return externalProviders.some((provider) =>
      model.toLowerCase().includes(provider)
    );
  };

  const isInternalModel = (model: string) => {
    return !requiresApiKey(model);
  };

  const handleAddModel = () => {
    if (!newModelName.trim()) {
      setError('Model name is required');
      return;
    }

    // Check for duplicates
    if (allModels.includes(newModelName)) {
      setError('A model with this name already exists');
      return;
    }

    const newModel: CustomModel = {
      id: Date.now().toString(),
      name: newModelName.trim(),
      provider: newModelProvider,
      apiUrl: newModelApiUrl || PROVIDER_OPTIONS.find(p => p.value === newModelProvider)?.urlTemplate,
      requiresApiKey: newModelProvider !== 'other',
    };

    saveCustomModels([...customModels, newModel]);
    
    // Reset form
    setNewModelName('');
    setNewModelProvider('openai');
    setNewModelApiUrl('');
    setShowAddModel(false);
    setError(null);
  };

  const handleDeleteCustomModel = (modelId: string) => {
    const updatedModels = customModels.filter(m => m.id !== modelId);
    saveCustomModels(updatedModels);
    
    // Clear selection if deleted model was selected
    const deletedModel = customModels.find(m => m.id === modelId);
    if (deletedModel && aiModel === deletedModel.name) {
      setAiModel('');
    }
  };

  const handleSave = () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const config: SessionConfig = {
        ai_model: aiModel,
        api_key: apiKey || undefined,
      };
      
      setSessionConfig(config);
      setSuccess(true);
      setHasApiKey(!!apiKey || hasApiKey);
      setShowApiKey(false);
      setApiKey('');
      
      onSave?.();

      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    try {
      clearSessionConfig();
      setAiModel('');
      setApiKey('');
      setHasApiKey(false);
      setShowApiKey(false);
      setSuccess(true);
      
      setTimeout(() => {
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear settings');
    }
  };

  // Group server models by type
  const internalModels = serverModels.filter(isInternalModel);
  const externalModels = serverModels.filter(requiresApiKey);

  return (
    <Modal
      variant={ModalVariant.medium}
      title="AI Model Settings"
      isOpen={isOpen}
      onClose={onClose}
      actions={[
        <Button
          key="save"
          variant="primary"
          onClick={handleSave}
          isDisabled={saving || !aiModel || (requiresApiKey(aiModel) && !apiKey && !hasApiKey)}
          isLoading={saving}
        >
          Save Settings
        </Button>,
        <Button key="clear" variant="link" onClick={handleClear} isDisabled={saving}>
          Clear Settings
        </Button>,
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={saving}>
          Cancel
        </Button>,
      ]}
    >
      <Form>
        {/* Success Message */}
        {success && (
          <Alert
            variant={AlertVariant.success}
            title="Settings saved successfully"
            isInline
            style={{ marginBottom: '16px' }}
          />
        )}

        {/* Error Message */}
        {error && (
          <Alert
            variant={AlertVariant.danger}
            title="Error"
            isInline
            style={{ marginBottom: '16px' }}
          >
            {error}
          </Alert>
        )}

        {/* AI Model Selection */}
        <FormGroup
          label="AI Model for Analysis"
          isRequired
          fieldId="ai-model-select"
        >
          <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '8px' }}>
            <FlexItem>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                Select a model or add a custom one
              </Text>
            </FlexItem>
            <FlexItem>
              <Button
                variant="link"
                icon={<PlusCircleIcon />}
                onClick={() => setShowAddModel(!showAddModel)}
                size="sm"
              >
                Add Custom Model
              </Button>
            </FlexItem>
          </Flex>

          {loading ? (
            <Spinner size="md" />
          ) : (
            <FormSelect
              id="ai-model-select"
              value={aiModel}
              onChange={(_event, value) => setAiModel(value)}
              aria-label="Select AI model"
            >
              <FormSelectOption value="" label="Select a model..." isPlaceholder />
              
              {internalModels.length > 0 && (
                <>
                  <FormSelectOption value="" label="── Internal Models (No API Key) ──" isDisabled />
                  {internalModels.map((model) => (
                    <FormSelectOption key={model} value={model} label={model} />
                  ))}
                </>
              )}
              
              {externalModels.length > 0 && (
                <>
                  <FormSelectOption value="" label="── External Models (API Key Required) ──" isDisabled />
                  {externalModels.map((model) => (
                    <FormSelectOption key={model} value={model} label={model} />
                  ))}
                </>
              )}

              {customModels.length > 0 && (
                <>
                  <FormSelectOption value="" label="── Custom Models ──" isDisabled />
                  {customModels.map((model) => (
                    <FormSelectOption key={model.id} value={model.name} label={`${model.name} (${model.provider})`} />
                  ))}
                </>
              )}
            </FormSelect>
          )}
        </FormGroup>

        {/* Add Custom Model Form */}
        {showAddModel && (
          <Card isCompact style={{ marginBottom: '16px', backgroundColor: 'var(--pf-v5-global--BackgroundColor--light-200)' }}>
            <CardBody>
              <TextContent style={{ marginBottom: '16px' }}>
                <Text component={TextVariants.h4}>Add Custom Model</Text>
                <Text component={TextVariants.small}>
                  Add an external AI model (OpenAI, Anthropic, Google, or custom)
                </Text>
              </TextContent>
              
              <FormGroup label="Model Name / ID" isRequired fieldId="new-model-name">
                <TextInput
                  id="new-model-name"
                  value={newModelName}
                  onChange={(_event, value) => setNewModelName(value)}
                  placeholder="e.g., openai/gpt-4-turbo or claude-3-opus"
                />
              </FormGroup>

              <FormGroup label="Provider" isRequired fieldId="new-model-provider" style={{ marginTop: '12px' }}>
                <FormSelect
                  id="new-model-provider"
                  value={newModelProvider}
                  onChange={(_event, value) => setNewModelProvider(value as 'openai' | 'anthropic' | 'google' | 'other')}
                >
                  {PROVIDER_OPTIONS.map((provider) => (
                    <FormSelectOption key={provider.value} value={provider.value} label={provider.label} />
                  ))}
                </FormSelect>
              </FormGroup>

              <FormGroup label="API URL (optional)" fieldId="new-model-api-url" style={{ marginTop: '12px' }}>
                <TextInput
                  id="new-model-api-url"
                  value={newModelApiUrl}
                  onChange={(_event, value) => setNewModelApiUrl(value)}
                  placeholder={PROVIDER_OPTIONS.find(p => p.value === newModelProvider)?.urlTemplate || 'https://api.example.com/...'}
                />
              </FormGroup>

              <Flex style={{ marginTop: '16px' }}>
                <FlexItem>
                  <Button variant="primary" onClick={handleAddModel} size="sm">
                    Add Model
                  </Button>
                </FlexItem>
                <FlexItem>
                  <Button
                    variant="link"
                    onClick={() => {
                      setShowAddModel(false);
                      setNewModelName('');
                      setNewModelProvider('openai');
                      setNewModelApiUrl('');
                      setError(null);
                    }}
                    size="sm"
                  >
                    Cancel
                  </Button>
                </FlexItem>
              </Flex>
            </CardBody>
          </Card>
        )}

        {/* Custom Models List */}
        {customModels.length > 0 && (
          <ExpandableSection
            toggleText={`Your Custom Models (${customModels.length})`}
            style={{ marginBottom: '16px' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {customModels.map((model) => (
                <Card key={model.id} isCompact>
                  <CardBody>
                    <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                      <FlexItem>
                        <TextContent>
                          <Text component={TextVariants.p} style={{ fontWeight: 600, marginBottom: '4px' }}>
                            {model.name}
                          </Text>
                          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                            Provider: {model.provider} {model.apiUrl && `• ${model.apiUrl}`}
                          </Text>
                        </TextContent>
                      </FlexItem>
                      <FlexItem>
                        <Button
                          variant="plain"
                          onClick={() => handleDeleteCustomModel(model.id)}
                          aria-label={`Delete ${model.name}`}
                        >
                          <TrashIcon style={{ color: 'var(--pf-v5-global--danger-color--100)' }} />
                        </Button>
                      </FlexItem>
                    </Flex>
                  </CardBody>
                </Card>
              ))}
            </div>
          </ExpandableSection>
        )}

        {/* Model Type Indicator */}
        {aiModel && (
          <div style={{ marginTop: '8px', marginBottom: '16px' }}>
            {isInternalModel(aiModel) ? (
              <Label color="green" icon={<CheckCircleIcon />}>
                Internal model - no API key required
              </Label>
            ) : (
              <Label color="orange" icon={<KeyIcon />}>
                External model - API key required
              </Label>
            )}
          </div>
        )}

        <Divider style={{ margin: '16px 0' }} />

        {/* API Key Section */}
        {aiModel && requiresApiKey(aiModel) && (
          <FormGroup
            label="API Key"
            isRequired
            fieldId="api-key-input"
          >
            {hasApiKey && !showApiKey ? (
              <Split hasGutter>
                <SplitItem>
                  <TextContent>
                    <Text component={TextVariants.small}>
                      <CheckCircleIcon style={{ color: 'var(--pf-v5-global--success-color--100)', marginRight: '8px' }} />
                      API key is configured
                    </Text>
                  </TextContent>
                </SplitItem>
                <SplitItem>
                  <Button variant="link" onClick={() => setShowApiKey(true)}>
                    Update API key
                  </Button>
                </SplitItem>
              </Split>
            ) : (
              <>
                <TextInput
                  id="api-key-input"
                  type="password"
                  value={apiKey}
                  onChange={(_event, value) => setApiKey(value)}
                  placeholder="Enter API key"
                />
                {hasApiKey && (
                  <Button
                    variant="link"
                    onClick={() => {
                      setShowApiKey(false);
                      setApiKey('');
                    }}
                    style={{ marginTop: '8px' }}
                  >
                    <TimesIcon style={{ marginRight: '4px' }} />
                    Cancel
                  </Button>
                )}
              </>
            )}
          </FormGroup>
        )}

        {/* Info Box */}
        <Alert
          variant={AlertVariant.info}
          title="About AI Models"
          isInline
          style={{ marginTop: '16px' }}
        >
          <TextContent>
            <Text component={TextVariants.small}>
              <strong>Internal models</strong> run on your cluster and don&apos;t require API keys.
              <br />
              <strong>External models</strong> (OpenAI, Anthropic, Google) require API keys and may incur costs.
              <br />
              Settings are stored locally in your browser.
            </Text>
          </TextContent>
        </Alert>
      </Form>
    </Modal>
  );
};

export default SettingsModal;
