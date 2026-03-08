import * as React from 'react';
import { Alert, AlertVariant, Button } from '@patternfly/react-core';
import { listDevProviders, clearDevCredentials, clearDevModels, getDevModels } from '../../../services/devCredentials';
import { isDevMode } from '../../../services/runtimeConfig';

export const DevModeBanner: React.FC = () => {
  const [cachedProviders, setCachedProviders] = React.useState<string[]>([]);
  const [modelCount, setModelCount] = React.useState<number>(0);
  const devMode = isDevMode();

  React.useEffect(() => {
    if (devMode) {
      // Refresh cached providers and models list every 2 seconds
      const interval = setInterval(() => {
        setCachedProviders(listDevProviders());
        setModelCount(Object.keys(getDevModels()).length);
      }, 2000);

      // Initial load
      setCachedProviders(listDevProviders());
      setModelCount(Object.keys(getDevModels()).length);

      return () => clearInterval(interval);
    }
  }, [devMode]);

  const handleClearCache = () => {
    clearDevCredentials();
    clearDevModels();
    setCachedProviders([]);
    setModelCount(0);
  };

  if (!devMode) {
    return null;
  }

  return (
    <Alert
      variant={AlertVariant.warning}
      isInline
      title="Development Mode Active"
      style={{ marginBottom: '20px' }}
      actionClose={
        (cachedProviders.length > 0 || modelCount > 0) ? (
          <Button variant="link" onClick={handleClearCache}>
            Clear Cache
          </Button>
        ) : undefined
      }
    >
      <p>
        <strong>DEV_MODE is enabled on this deployment.</strong>
      </p>
      <p>
        API keys and model configurations are cached in your browser session and will NOT be saved to Kubernetes secrets or ConfigMaps.
        This allows each developer to use their own credentials and test models without sharing.
      </p>
      <p>
        <em>Note: All data is stored in sessionStorage and will be cleared when you close this browser tab.</em>
      </p>
      {(cachedProviders.length > 0 || modelCount > 0) && (
        <div style={{ marginTop: '10px' }}>
          {cachedProviders.length > 0 && (
            <p>
              <strong>Cached API keys:</strong> {cachedProviders.join(', ')}
            </p>
          )}
          {modelCount > 0 && (
            <p>
              <strong>Cached models:</strong> {modelCount} model{modelCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
    </Alert>
  );
};
