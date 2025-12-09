import * as React from 'react';
import {
  Modal,
  ModalVariant,
  Tabs,
  Tab,
  TabTitleText,
  Button,
  Alert,
  AlertVariant,
  Spinner,
  TextContent,
  Text,
  TextVariants,
} from '@patternfly/react-core';
import {
  CubeIcon,
  KeyIcon,
  PlusCircleIcon,
} from '@patternfly/react-icons';

import { AIModelState } from './types/models';
import { modelService } from './services/modelService';
import { secretManager } from './services/secretManager';
import { ModelsTab } from './tabs/ModelsTab';
import { APIKeysTab } from './tabs/APIKeysTab';
import { AddModelTab } from './tabs/AddModelTab';

interface AIModelSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (selectedModel: string) => void;
}

export const AIModelSettings: React.FC<AIModelSettingsProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [state, setState] = React.useState<AIModelState>(modelService.getInitialState());

  // Load initial data when modal opens
  React.useEffect(() => {
    if (isOpen) {
      loadInitialData();
    }
  }, [isOpen]);

  const loadInitialData = async () => {
    setState(prev => ({
      ...prev,
      loading: { ...prev.loading, models: true, secrets: true },
      error: null,
    }));

    try {
      // Load models in parallel with provider status
      const [modelsResult] = await Promise.allSettled([
        modelService.loadAvailableModels(),
        loadProviderStatus(),
      ]);

      if (modelsResult.status === 'fulfilled') {
        const { internal, external, custom } = modelsResult.value;
        setState(prev => ({
          ...prev,
          internalModels: internal,
          externalModels: external,
          customModels: custom,
          loading: { ...prev.loading, models: false },
        }));
      } else {
        throw new Error('Failed to load models');
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load data',
        loading: { models: false, secrets: false, testing: false, saving: false },
      }));
    }
  };

  const loadProviderStatus = async () => {
    try {
      // Get the initial state for providers (don't rely on current state)
      const initialProviders = modelService.getInitialState().providers;
      const providers = { ...initialProviders };
      
      // Check each external provider for existing secrets
      for (const provider of ['openai', 'anthropic', 'google', 'meta', 'other'] as const) {
        const secretStatus = await secretManager.checkProviderSecret(provider);
        
        providers[provider] = {
          provider,
          status: secretStatus.exists ? 'configured' : 'missing',
          storage: secretStatus.exists ? 'secret' : 'none',
          secretName: secretStatus.secretName,
          lastUpdated: secretStatus.lastUpdated,
          isValid: secretStatus.isValid,
        };
      }

      setState(prev => ({
        ...prev,
        providers,
        loading: { ...prev.loading, secrets: false },
      }));
    } catch (error) {
      console.error('Error loading provider status:', error);
      setState(prev => ({
        ...prev,
        loading: { ...prev.loading, secrets: false },
      }));
    }
  };

  const handleTabSelect = (_event: React.MouseEvent<HTMLElement, MouseEvent>, tabIndex: string | number) => {
    const tabName = tabIndex as AIModelState['activeTab'];
    setState(prev => ({
      ...prev,
      activeTab: tabName,
      error: null,
      success: null,
    }));
  };

  const handleModelSelect = async (modelName: string) => {
    setState(prev => ({
      ...prev,
      loading: { ...prev.loading, saving: true },
      error: null,
    }));

    try {
      // Check if model is ready to use
      const readiness = await modelService.isModelReady(modelName);
      if (!readiness.ready) {
        setState(prev => ({
          ...prev,
          error: `Cannot select ${modelName}: ${readiness.reason}`,
          loading: { ...prev.loading, saving: false },
        }));
        return;
      }

      // Save selection
      modelService.setCurrentModel(modelName);
      
      setState(prev => ({
        ...prev,
        selectedModel: modelName,
        success: `Selected model: ${modelName}`,
        loading: { ...prev.loading, saving: false },
      }));

      // Notify parent component
      onSave?.(modelName);

      // Auto-close after success
      setTimeout(() => {
        onClose();
        setState(prev => ({
          ...prev,
          success: null,
        }));
      }, 1500);
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to select model',
        loading: { ...prev.loading, saving: false },
      }));
    }
  };

  const handleProviderUpdate = () => {
    // Refresh provider status after updates
    loadProviderStatus();
  };

  const handleModelAdd = () => {
    // Refresh models list after adding
    loadInitialData();
  };

  const clearMessages = () => {
    setState(prev => ({
      ...prev,
      error: null,
      success: null,
    }));
  };

  const renderTabContent = () => {
    switch (state.activeTab) {
      case 'models':
        return (
          <ModelsTab
            state={state}
            onModelSelect={handleModelSelect}
            onRefresh={loadInitialData}
          />
        );
      case 'apikeys':
        return (
          <APIKeysTab
            state={state}
            onProviderUpdate={handleProviderUpdate}
          />
        );
      case 'addmodel':
        return (
          <AddModelTab
            state={state}
            onModelAdd={handleModelAdd}
            onSuccess={() => setState(prev => ({ ...prev, activeTab: 'models' }))}
          />
        );
      default:
        return null;
    }
  };

  const isLoading = Object.values(state.loading).some(loading => loading);

  return (
    <Modal
      variant={ModalVariant.large}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CubeIcon />
          <span>AI Model Configuration</span>
        </div>
      }
      isOpen={isOpen}
      onClose={onClose}
      hasNoBodyWrapper
      actions={[
        <Button key="close" variant="primary" onClick={onClose}>
          Close
        </Button>,
      ]}
    >
      {/* Loading Spinner Overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <Spinner size="lg" />
        </div>
      )}

      <div style={{ padding: '24px' }}>
        {/* Current Selection Status */}
        {state.selectedModel && (
          <Alert
            variant={AlertVariant.info}
            title="Current Model"
            isInline
            style={{ marginBottom: '20px' }}
          >
            <TextContent>
              <Text component={TextVariants.p}>
                <strong>{state.selectedModel}</strong>
              </Text>
            </TextContent>
          </Alert>
        )}

        {/* Error and Success Messages */}
        {state.error && (
          <Alert
            variant={AlertVariant.danger}
            title="Error"
            isInline
            style={{ marginBottom: '20px' }}
            actionClose={{
              title: 'Clear error',
              onClose: clearMessages,
            }}
          >
            {state.error}
          </Alert>
        )}

        {state.success && (
          <Alert
            variant={AlertVariant.success}
            title="Success"
            isInline
            style={{ marginBottom: '20px' }}
            actionClose={{
              title: 'Clear success',
              onClose: clearMessages,
            }}
          >
            {state.success}
          </Alert>
        )}

        {/* Main Tabs */}
        <Tabs
          activeKey={state.activeTab}
          onSelect={handleTabSelect}
          aria-label="AI Model Settings Tabs"
        >
          <Tab
            eventKey="models"
            title={
              <TabTitleText>
                <CubeIcon style={{ marginRight: '8px' }} />
                Available Models
              </TabTitleText>
            }
            aria-label="Available Models"
          >
            {state.activeTab === 'models' && renderTabContent()}
          </Tab>

          <Tab
            eventKey="apikeys"
            title={
              <TabTitleText>
                <KeyIcon style={{ marginRight: '8px' }} />
                API Keys
              </TabTitleText>
            }
            aria-label="API Key Management"
          >
            {state.activeTab === 'apikeys' && renderTabContent()}
          </Tab>

          <Tab
            eventKey="addmodel"
            title={
              <TabTitleText>
                <PlusCircleIcon style={{ marginRight: '8px' }} />
                Add Model
              </TabTitleText>
            }
            aria-label="Add Custom Model"
          >
            {state.activeTab === 'addmodel' && renderTabContent()}
          </Tab>
        </Tabs>
      </div>
    </Modal>
  );
};

export default AIModelSettings;