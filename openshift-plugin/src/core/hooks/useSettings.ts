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
   * Simple hook to check if AI model is configured
   * Returns true if model is configured, false otherwise
   */
  const useConfigurationCheck = () => {
    const [isConfigured, setIsConfigured] = React.useState<boolean>(false);

    React.useEffect(() => {
      const checkConfiguration = () => {
        const config = getSessionConfig();
        setIsConfigured(!!config.ai_model);
      };

      // Check immediately
      checkConfiguration();

      // Check periodically (every 2 seconds) to catch Settings changes
      const interval = setInterval(checkConfiguration, 2000);

      // Check when window gains focus (user might have changed settings in another tab)
      window.addEventListener('focus', checkConfiguration);

      return () => {
        clearInterval(interval);
        window.removeEventListener('focus', checkConfiguration);
      };
    }, []);

    return isConfigured;
  };

  return {
    handleOpenSettings,
    useConfigurationCheck,
  };
};