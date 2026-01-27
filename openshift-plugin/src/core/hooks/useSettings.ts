import * as React from 'react';
import { getSessionConfig } from '../services/mcpClient';

/**
 * Custom hook for settings-related functionality
 */
export const useSettings = () => {
  const handleOpenSettings = () => {
    window.dispatchEvent(new CustomEvent('open-settings'));
  };

  /**
   * Hook to automatically dismiss configuration errors when settings are closed
   */
  const useConfigurationErrorDismissal = (
    configError: string | null,
    setConfigError: (error: string | null) => void
  ) => {
    React.useEffect(() => {
      const handleSettingsClosed = () => {
        const config = getSessionConfig();
        // If model is now configured and we have a config-related error, dismiss it
        if (config.ai_model && configError?.includes('Please configure an AI model in Settings first')) {
          setConfigError(null);
        }
      };

      window.addEventListener('settings-closed', handleSettingsClosed);

      return () => {
        window.removeEventListener('settings-closed', handleSettingsClosed);
      };
    }, [configError, setConfigError]);
  };

  return {
    handleOpenSettings,
    useConfigurationErrorDismissal,
  };
};