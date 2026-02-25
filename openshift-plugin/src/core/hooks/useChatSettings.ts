import * as React from 'react';

const SETTINGS_KEY = 'openshift_ai_chat_settings';

export interface ChatSettings {
  // Auto-collapse settings
  autoCollapseEnabled: boolean;
  messagesKeptExpanded: number;
  collapsedPreviewLength: number;

  // Suggested questions
  suggestedQuestionsExpanded: boolean;
  suggestedQuestionsLocation: 'header' | 'inline';

  // Metric categories
  metricCategoriesLocation: 'header' | 'inline';

  // Conversation context
  conversationContextLimit: number;

  // UI preferences
  showProgressLogByDefault: boolean;
  enableKeyboardShortcuts: boolean;

  // Chat history
  maxStoredMessages: number;
}

const DEFAULT_SETTINGS: ChatSettings = {
  autoCollapseEnabled: true,
  messagesKeptExpanded: 3,
  collapsedPreviewLength: 200,
  suggestedQuestionsExpanded: true,
  suggestedQuestionsLocation: 'header',
  metricCategoriesLocation: 'header',
  conversationContextLimit: 10, // Last 10 messages (5 back-and-forth)
  showProgressLogByDefault: false,
  enableKeyboardShortcuts: true,
  maxStoredMessages: 50,
};

/**
 * Custom hook for managing chat settings with localStorage persistence
 */
export function useChatSettings() {
  const [settings, setSettingsState] = React.useState<ChatSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = React.useState(false);

  // Load settings from localStorage on mount
  React.useEffect(() => {
    const loadSettings = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setSettingsState({ ...DEFAULT_SETTINGS, ...parsed });
        }
        setIsLoaded(true);
      } catch (error) {
        console.error('Failed to load chat settings:', error);
        setIsLoaded(true);
      }
    };

    // Load on mount
    loadSettings();

    // Listen for custom event to reload settings (when settings modal closes)
    const handleSettingsChanged = () => {
      loadSettings();
    };

    window.addEventListener('settings-closed', handleSettingsChanged);

    return () => {
      window.removeEventListener('settings-closed', handleSettingsChanged);
    };
  }, []);

  // Save settings to localStorage whenever they change
  React.useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (error) {
        console.error('Failed to save chat settings:', error);
      }
    }
  }, [settings, isLoaded]);

  const updateSettings = React.useCallback((updates: Partial<ChatSettings>) => {
    setSettingsState(prev => ({ ...prev, ...updates }));
  }, []);

  const resetSettings = React.useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
  }, []);

  return {
    settings,
    updateSettings,
    resetSettings,
    isLoaded,
  };
}
