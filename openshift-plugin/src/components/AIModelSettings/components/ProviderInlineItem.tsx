import * as React from 'react';
import {
  ExpandableSection,
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
  Label,
  Button,
  TextInput,
  Alert,
  AlertVariant,
} from '@patternfly/react-core';
import { KeyIcon, SyncAltIcon, TrashIcon, ExternalLinkAltIcon, CheckCircleIcon, ExclamationTriangleIcon, TimesCircleIcon } from '@patternfly/react-icons';
import { ProviderTemplate, ProviderCredential } from '../types/models';
import { secretManager } from '../services/secretManager';
import { isValidApiKey } from '../services/providerTemplates';

interface ProviderInlineItemProps {
  provider: ProviderTemplate;
  status: ProviderCredential;
  onUpdate: () => void;
}

export const ProviderInlineItem: React.FC<ProviderInlineItemProps> = ({
  provider,
  status,
  onUpdate,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [apiKey, setApiKey] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const statusIcon = (() => {
    if (testing) return <SyncAltIcon className="pf-v5-u-spin" style={{ color: 'var(--pf-v5-global--info-color--100)' }} />;
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
  })();

  const statusLabel = (() => {
    if (testing) return <Label color="blue">Testing...</Label>;
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
  })();

  const storageInfo = (() => {
    if (status.status !== 'configured') return 'No API key configured';
    const storageType = status.storage === 'secret' ? 'OpenShift Secret' : 'Browser Cache';
    const secretName = status.secretName ? ` (${status.secretName})` : '';
    return `Stored via ${storageType}${secretName}${status.lastUpdated ? ` • Updated ${new Date(status.lastUpdated).toLocaleDateString()}` : ''}`;
  })();

  const handleSave = async () => {
    setError(null);
    setNotice(null);
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }
    if (!isValidApiKey(provider.provider, apiKey)) {
      setError(`Invalid API key format for ${provider.label}`);
      return;
    }
    setSaving(true);
    try {
      // Save to OpenShift secret (only secure storage allowed)
      await secretManager.saveProviderSecret({
        provider: provider.provider,
        apiKey,
        endpoint: provider.defaultEndpoint,
        metadata: {
          description: `API key for ${provider.label}`,
          createdBy: 'ai-model-settings',
          lastUpdated: new Date().toISOString(),
        },
      });
      setApiKey('');
      setNotice('API key saved successfully');
      onUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setError(null);
    setNotice(null);
    if (!apiKey.trim()) {
      setError('Enter an API key to test');
      return;
    }
    setTesting(true);
    try {
      const result = await secretManager.testConnection(provider.provider, apiKey);
      if (result.success) {
        setNotice('Connection successful');
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!status.secretName) return;
    setError(null);
    setNotice(null);
    try {
      await secretManager.deleteSecret(status.secretName);
      onUpdate();
      setNotice('Secret removed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove secret');
    }
  };

  return (
    <ExpandableSection
      isExpanded={isExpanded}
      onToggle={(_evt, expanded) => setIsExpanded(expanded)}
      toggleContent={
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <ExternalLinkAltIcon style={{ marginRight: '8px' }} />
          </FlexItem>
          <FlexItem>
            <Text component={TextVariants.h4} style={{ margin: 0 }}>
              {provider.label}
            </Text>
          </FlexItem>
          <FlexItem style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {statusIcon}
            {statusLabel}
          </FlexItem>
        </Flex>
      }
      isIndented
    >
      <TextContent>
        <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
          {provider.description}
        </Text>
        <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '4px' }}>
          {storageInfo}
        </Text>
      </TextContent>

      {error && (
        <Alert variant={AlertVariant.danger} isInline title="Error" style={{ marginTop: 12 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert variant={AlertVariant.success} isInline title={notice} style={{ marginTop: 12 }} />
      )}

      <Flex style={{ marginTop: 12 }} spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsFlexEnd' }}>
        <FlexItem grow={{ default: 'grow' }}>
          <TextInput
            id={`api-key-${provider.provider}`}
            type="password"
            value={apiKey}
            onChange={(_e, val) => setApiKey(val)}
            placeholder={`Enter your ${provider.label} API key`}
          />
          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: 4 }}>
            Get your API key from the {provider.label} dashboard or developer portal. Keys are securely stored as OpenShift Secrets.
          </Text>
        </FlexItem>
        <FlexItem>
          <Button variant="primary" onClick={handleSave} isDisabled={saving || !apiKey.trim()} isLoading={saving}>
            <KeyIcon style={{ marginRight: 8 }} />
            Save Key
          </Button>
        </FlexItem>
        <FlexItem>
          <Button variant="secondary" onClick={handleTest} isDisabled={testing || !apiKey.trim()}>
            <SyncAltIcon style={{ marginRight: 8 }} />
            {testing ? 'Testing...' : 'Test'}
          </Button>
        </FlexItem>
        {status.status === 'configured' && status.storage === 'secret' && (
          <FlexItem>
            <Button variant="link" onClick={handleDelete} isDanger>
              <TrashIcon style={{ marginRight: 8 }} />
              Remove
            </Button>
          </FlexItem>
        )}
        {provider.documentationUrl && (
          <FlexItem>
            <Button variant="link" component="a" href={provider.documentationUrl} target="_blank">
              Documentation
            </Button>
          </FlexItem>
        )}
      </Flex>
    </ExpandableSection>
  );
};

export default ProviderInlineItem;


