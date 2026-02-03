import * as React from 'react';
import { getSessionConfig } from '../services/mcpClient';

// Define specific warning types instead of checking string content
export const AI_CONFIG_WARNING = 'AI_CONFIG_REQUIRED';

/**
 * Custom hook for settings-related functionality
 */
export const useSettings = () => {
  const handleOpenSettings = () => {
    window.dispatchEvent(new CustomEvent('open-settings'));
  };

  /**
   * Simple auto-dismissal for AI configuration warnings
   * Listens for settings-closed event and clears warning if model is now configured
   */
  const useAIConfigWarningDismissal = (
    warningType: string | null,
    setWarning: (warning: string | null) => void,
    setWarningType?: (type: string | null) => void
  ) => {
    React.useEffect(() => {
      const handleSettingsClosed = () => {
        // Check if we currently have an AI config warning (either type)
        if (warningType === AI_CONFIG_WARNING || warningType === 'CONFIGURATION_REQUIRED') {
          const config = getSessionConfig();
          if (config.ai_model) {
            setWarning(null);
            if (setWarningType) {
              setWarningType(null);
            }
          }
        }
      };

      window.addEventListener('settings-closed', handleSettingsClosed);
      return () => window.removeEventListener('settings-closed', handleSettingsClosed);
    }, [warningType, setWarning, setWarningType]);
  };

  return {
    handleOpenSettings,
    useAIConfigWarningDismissal,
    AI_CONFIG_WARNING,
  };
};