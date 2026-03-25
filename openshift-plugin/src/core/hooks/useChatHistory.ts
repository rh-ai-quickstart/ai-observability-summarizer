import * as React from 'react';
import { ChatScope } from '../data/namespaceDefaults';

const STORAGE_KEY = 'openshift_ai_chat_history';
const SETTINGS_KEY = 'openshift_ai_chat_settings';
const DEFAULT_MAX_MESSAGES = 50;

// Helper to get max messages from settings
const getMaxMessages = (): number => {
  try {
    const settingsJson = localStorage.getItem(SETTINGS_KEY);
    if (settingsJson) {
      const settings = JSON.parse(settingsJson);
      return settings.maxStoredMessages || DEFAULT_MAX_MESSAGES;
    }
  } catch (error) {
    console.error('Error reading maxStoredMessages from settings:', error);
  }
  return DEFAULT_MAX_MESSAGES;
};

export interface ProgressEntry {
  timestamp: string;
  message: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  error?: boolean;
  progressLog?: ProgressEntry[];
  originalUserMessage?: string; // Store original user message for retry functionality
  scope?: ChatScope;
  namespace?: string;
}

const getInitialGreeting = (gpuAvailable?: boolean): Message => ({
  id: '1',
  role: 'assistant',
  content: gpuAvailable === true
    ? `👋 Hello! I'm your AI Observability Assistant.

I can help you understand your vLLM and OpenShift metrics. Try asking me questions or click one of the suggested questions below to get started.

How can I help you today?`
    : `👋 Hello! I'm your AI Observability Assistant.

I can help you understand your OpenShift metrics. Try asking me questions or click one of the suggested questions below to get started.

How can I help you today?`,
  timestamp: new Date(),
});

/**
 * Custom hook for managing chat message history with localStorage persistence
 */
export function useChatHistory(gpuAvailable?: boolean) {
  const [messages, setMessagesState] = React.useState<Message[]>([]);
  const [isLoaded, setIsLoaded] = React.useState(false);

  // Load messages from localStorage on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert timestamp strings back to Date objects
        const messagesWithDates = parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
        setMessagesState(messagesWithDates);
      } else {
        // No stored messages, show initial greeting
        setMessagesState([getInitialGreeting(gpuAvailable)]);
      }
    } catch (error) {
      console.error('Error loading chat history from localStorage:', error);
      // On error, show initial greeting
      setMessagesState([getInitialGreeting(gpuAvailable)]);
    }
    setIsLoaded(true);
  }, [gpuAvailable]);

  // Save messages to localStorage when they change (debounced)
  React.useEffect(() => {
    if (!isLoaded) return; // Don't save on initial load

    const timer = setTimeout(() => {
      try {
        // Limit to most recent messages based on settings
        const maxMessages = getMaxMessages();
        const messagesToSave = messages.slice(-maxMessages);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messagesToSave));
      } catch (error) {
        console.error('Error saving chat history to localStorage:', error);
      }
    }, 500); // Debounce by 500ms

    return () => clearTimeout(timer);
  }, [messages, isLoaded]);

  // Set messages with the ability to use a function updater
  const setMessages = React.useCallback(
    (
      newMessages:
        | Message[]
        | ((prevMessages: Message[]) => Message[])
    ) => {
      setMessagesState(newMessages);
    },
    []
  );

  // Clear history and reset to initial greeting
  const clearHistory = React.useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setMessagesState([getInitialGreeting(gpuAvailable)]);
    } catch (error) {
      console.error('Error clearing chat history:', error);
    }
  }, [gpuAvailable]);

  // Export messages to markdown format
  const exportToMarkdown = React.useCallback(() => {
    const markdown = messages
      .map((msg) => {
        const role = msg.role === 'user' ? '**User**' : '**Assistant**';
        const timestamp = msg.timestamp.toLocaleString();
        return `### ${role} (${timestamp})\n\n${msg.content}\n\n---\n`;
      })
      .join('\n');

    return `# Chat with Prometheus - History\n\n${markdown}`;
  }, [messages]);

  return {
    messages,
    setMessages,
    clearHistory,
    exportToMarkdown,
  };
}
