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
  Modal,
  ModalVariant,
  Form,
  FormGroup,
  TextInput,
  Alert,
  AlertVariant,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TimesCircleIcon,
  KeyIcon,
  ExternalLinkAltIcon,
  SyncAltIcon,
  PlusCircleIcon,
  TrashIcon,
} from '@patternfly/react-icons';

import { ProviderTemplate, ProviderCredential } from '../types/models';
import { secretManager } from '../services/secretManager';
import { isValidApiKey } from '../services/providerTemplates';

interface ProviderCardProps {
  provider: ProviderTemplate;
  status: ProviderCredential;
  isTesting: boolean;
  onTestConnection: () => void;
  onUpdate: () => void;
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  status,
  isTesting,
  onTestConnection,
  onUpdate,
}) => {
  const [showModal, setShowModal] = React.useState(false);
  const [apiKey, setApiKey] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ success: boolean; error?: string } | null>(null);

  const getStatusIcon = () => {
    if (isTesting) {
      return <SyncAltIcon className="pf-v5-u-spin" style={{ color: 'var(--pf-v5-global--info-color--100)' }} />;
    }

    switch (status.status) {
      case 'configured':
        return <CheckCircleIcon style={{ color: 'var(--pf-v5-global--success-color--100)' }} />;
      case 'missing':
        return <ExclamationTriangleIcon style={{ color: 'var(--pf-v5-global--warning-color--100)' }} />;
      case 'invalid':
        return <TimesCircleIcon style={{ color: 'var(--pf-v5-global--danger-color--100)' }} />;
      default:
        return <ExclamationTriangleIcon style={{ color: 'var(--pf-v5-global--warning-color--100)' }} />;
    }
  };

  const getStatusLabel = () => {
    if (isTesting) {
      return <Label color="blue">Testing...</Label>;
    }

    switch (status.status) {
      case 'configured':
        return <Label color="green">Configured</Label>;
      case 'missing':
        return <Label color="orange">Not Configured</Label>;
      case 'invalid':
        return <Label color="red">Invalid</Label>;
      default:
        return <Label color="grey">Unknown</Label>;
    }
  };

  const getStorageInfo = () => {
    if (status.status === 'configured') {
      const secretName = status.secretName ? ` (${status.secretName})` : '';
      return `Stored via OpenShift Secret${secretName}`;
    }
    return 'No API key configured';
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }

    if (!isValidApiKey(provider.provider, apiKey)) {
      setError(`Invalid API key format for ${provider.label}`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Save to OpenShift secret (only secure storage allowed)
      await secretManager.saveProviderSecret({
        provider: provider.provider,
        apiKey: apiKey,
        endpoint: provider.defaultEndpoint,
        metadata: {
          description: `API key for ${provider.label}`,
          createdBy: 'ai-model-settings',
          lastUpdated: new Date().toISOString(),
        },
      });

      setShowModal(false);
      setApiKey('');
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setError('Enter an API key to test');
      return;
    }

    try {
      const result = await secretManager.testConnection(provider.provider, apiKey);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      });
    }
  };

  const handleDelete = async () => {
    if (!status.secretName) return;

    try {
      await secretManager.deleteSecret(status.secretName);
      onUpdate();
    } catch (error) {
      console.error('Failed to delete secret:', error);
    }
  };

  const openModal = () => {
    setShowModal(true);
    setApiKey('');
    setError(null);
    setTestResult(null);
  };

  return (
    <>
      <Card>
        <CardBody>
          <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
            {/* Header */}
            <FlexItem>
              <Split hasGutter>
                <SplitItem>
                  <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem>
                      <ExternalLinkAltIcon style={{ marginRight: '8px' }} />
                    </FlexItem>
                    <FlexItem>
                      <TextContent>
                        <Text component={TextVariants.h4} style={{ margin: 0 }}>
                          {provider.label}
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

            {/* Description and status */}
            <FlexItem>
              <TextContent>
                <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                  {provider.description}
                </Text>
                <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
                  {getStorageInfo()}
                  {status.lastUpdated && ` • Updated ${new Date(status.lastUpdated).toLocaleDateString()}`}
                </Text>
              </TextContent>
            </FlexItem>

            {/* Actions */}
            <FlexItem>
              <Flex>
                <FlexItem>
                  <Button
                    variant={status.status === 'configured' ? 'secondary' : 'primary'}
                    onClick={openModal}
                    size="sm"
                  >
                    {status.status === 'configured' ? (
                      <>
                        <KeyIcon style={{ marginRight: '8px' }} />
                        Update Key
                      </>
                    ) : (
                      <>
                        <PlusCircleIcon style={{ marginRight: '8px' }} />
                        Add Key
                      </>
                    )}
                  </Button>
                </FlexItem>
                
                {status.status === 'configured' && (
                  <FlexItem>
                    <Button
                      variant="secondary"
                      onClick={onTestConnection}
                      isDisabled={isTesting}
                      size="sm"
                    >
                      <SyncAltIcon style={{ marginRight: '8px' }} />
                      {isTesting ? 'Testing...' : 'Test'}
                    </Button>
                  </FlexItem>
                )}

                {status.status === 'configured' && status.storage === 'secret' && (
                  <FlexItem>
                    <Button
                      variant="link"
                      onClick={handleDelete}
                      isDanger
                      size="sm"
                    >
                      <TrashIcon style={{ marginRight: '8px' }} />
                      Remove
                    </Button>
                  </FlexItem>
                )}

                {provider.documentationUrl && (
                  <FlexItem>
                    <Button
                      variant="link"
                      component="a"
                      href={provider.documentationUrl}
                      target="_blank"
                      size="sm"
                    >
                      Documentation
                    </Button>
                  </FlexItem>
                )}
              </Flex>
            </FlexItem>
          </Flex>
        </CardBody>
      </Card>

      {/* API Key Configuration Modal */}
      <Modal
        variant={ModalVariant.medium}
        title={`Configure ${provider.label} API Key`}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        actions={[
          <Button
            key="save"
            variant="primary"
            onClick={handleSave}
            isDisabled={saving || !apiKey.trim()}
            isLoading={saving}
          >
            Save API Key
          </Button>,
          <Button key="cancel" variant="link" onClick={() => setShowModal(false)}>
            Cancel
          </Button>,
        ]}
      >
        <Form>
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

          {testResult && (
            <Alert
              variant={testResult.success ? AlertVariant.success : AlertVariant.warning}
              title={testResult.success ? 'Connection Successful' : 'Connection Failed'}
              isInline
              style={{ marginBottom: '16px' }}
            >
              {testResult.error || 'API key is valid and connection was successful'}
            </Alert>
          )}

          <FormGroup label="API Key" isRequired fieldId="api-key">
            <TextInput
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(_event, value) => setApiKey(value)}
              placeholder={`Enter your ${provider.label} API key`}
            />
            <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
              Get your API key from the {provider.label} dashboard or developer portal. Keys are securely stored as OpenShift Secrets.
            </Text>
          </FormGroup>

          <Flex style={{ marginTop: '16px' }}>
            <FlexItem>
              <Button variant="secondary" onClick={handleTestConnection} size="sm">
                Test Connection
              </Button>
            </FlexItem>
          </Flex>
        </Form>
      </Modal>
    </>
  );
};

export default ProviderCard;