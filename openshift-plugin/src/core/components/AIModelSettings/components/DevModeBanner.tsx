import * as React from 'react';
import { Alert, AlertVariant, Button } from '@patternfly/react-core';
import { isDevMode, listDevProviders, clearDevCredentials } from '../../../services/devCredentials';

export const DevModeBanner: React.FC = () => {
  const [cachedProviders, setCachedProviders] = React.useState<string[]>([]);
  const devMode = isDevMode();

  React.useEffect(() => {
    if (devMode) {
      // Refresh cached providers list every 2 seconds
      const interval = setInterval(() => {
        setCachedProviders(listDevProviders());
      }, 2000);

      // Initial load
      setCachedProviders(listDevProviders());

      return () => clearInterval(interval);
    }
  }, [devMode]);

  const handleClearCache = () => {
    clearDevCredentials();
    setCachedProviders([]);
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
        cachedProviders.length > 0 ? (
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
        API keys are cached in your browser session and will NOT be saved to Kubernetes secrets.
        This allows each developer to use their own API keys without sharing.
      </p>
      <p>
        <em>Note: Keys are stored in sessionStorage and will be cleared when you close this browser tab.</em>
      </p>
      {cachedProviders.length > 0 && (
        <p style={{ marginTop: '10px' }}>
          <strong>Cached providers in your session:</strong> {cachedProviders.join(', ')}
        </p>
      )}
    </Alert>
  );
};
