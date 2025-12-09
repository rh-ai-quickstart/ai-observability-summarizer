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
  AlertActionCloseButton,
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
        setState(prev => {
          const next = {
            ...prev,
            internalModels: internal,
            externalModels: external,
            customModels: custom,
            loading: { ...prev.loading, models: false },
          };
          // If nothing is selectable, clear selected model in session
          if (!hasSelectableModels(next)) {
            modelService.setCurrentModel('');
            next.selectedModel = null;
          }
          return next;
        });
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

      setState(prev => {
        const next = {
          ...prev,
          providers,
          loading: { ...prev.loading, secrets: false },
        };
        // If nothing is selectable with updated providers, clear current model
        if (!hasSelectableModels(next)) {
          modelService.setCurrentModel('');
          next.selectedModel = null;
        }
        return next;
      });
    } catch (error) {
      console.error('Error loading provider status:', error);
      setState(prev => ({
        ...prev,
        loading: { ...prev.loading, secrets: false },
      }));
    }
  };

  const hasSelectableModels = (s: AIModelState): boolean => {
    const internal = s.internalModels.length > 0;
    const external = s.externalModels.some(m => s.providers[m.provider]?.status === 'configured');
    const custom = s.customModels.some(m => !m.requiresApiKey || s.providers[m.provider]?.status === 'configured');
    return internal || external || custom;
  };

  const isModelSelectable = (s: AIModelState, modelName: string | null): boolean => {
    if (!modelName) return false;
    const all = [...s.internalModels, ...s.externalModels, ...s.customModels];
    const m = all.find(mm => mm.name === modelName);
    if (!m) return false;
    if (!m.requiresApiKey) return true;
    return s.providers[m.provider]?.status === 'configured';
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

      // Keep modal open; user can close manually
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
            onGoToApiKeys={() => setState(prev => ({ ...prev, activeTab: 'apikeys' }))}
            onGoToAddModel={() => setState(prev => ({ ...prev, activeTab: 'addmodel' }))}
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
        {hasSelectableModels(state) ? (
          state.selectedModel ? (
            isModelSelectable(state, state.selectedModel) ? (
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
            ) : (
              <Alert
                variant={AlertVariant.warning}
                title="Current Model: Unavailable"
                isInline
                style={{ marginBottom: '20px' }}
              >
                <TextContent>
                  <Text component={TextVariants.p}>
                    The previously selected model <strong>{state.selectedModel}</strong> is not available.
                  </Text>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="link" isInline onClick={() => setState(prev => ({ ...prev, activeTab: 'models' }))}>
                      Re-select model
                    </Button>
                    <Button variant="link" isInline onClick={() => setState(prev => ({ ...prev, activeTab: 'apikeys' }))}>
                      Configure API key
                    </Button>
                  </div>
                </TextContent>
              </Alert>
            )
          ) : null
        ) : (
          <Alert
            variant={AlertVariant.warning}
            title="Current Model: None"
            isInline
            style={{ marginBottom: '20px' }}
          >
            <TextContent>
              <Text component={TextVariants.p}>
                No models are available to select. Configure an API key or add a custom model.
              </Text>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="link" isInline onClick={() => setState(prev => ({ ...prev, activeTab: 'apikeys' }))}>
                  Configure API key
                </Button>
                <Button variant="link" isInline onClick={() => setState(prev => ({ ...prev, activeTab: 'addmodel' }))}>
                  Add custom model
                </Button>
              </div>
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
            actionClose={<AlertActionCloseButton onClose={clearMessages} />}
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
            actionClose={<AlertActionCloseButton onClose={clearMessages} />}
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