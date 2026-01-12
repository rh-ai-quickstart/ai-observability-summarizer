import * as React from 'react';

const STORAGE_KEY = 'openshift_ai_chat_history';
const MAX_MESSAGES = 50;

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
}

const getInitialGreeting = (): Message => ({
  id: '1',
  role: 'assistant',
  content: `👋 Hello! I'm your AI Observability Assistant.

I can help you understand your vLLM and OpenShift metrics. Try asking me questions or click one of the suggested questions below to get started.

How can I help you today?`,
  timestamp: new Date(),
});

/**
 * Custom hook for managing chat message history with localStorage persistence
 */
export function useChatHistory() {
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
        setMessagesState([getInitialGreeting()]);
      }
    } catch (error) {
      console.error('Error loading chat history from localStorage:', error);
      // On error, show initial greeting
      setMessagesState([getInitialGreeting()]);
    }
    setIsLoaded(true);
  }, []);

  // Save messages to localStorage when they change (debounced)
  React.useEffect(() => {
    if (!isLoaded) return; // Don't save on initial load

    const timer = setTimeout(() => {
      try {
        // Limit to most recent MAX_MESSAGES
        const messagesToSave = messages.slice(-MAX_MESSAGES);
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
      setMessagesState([getInitialGreeting()]);
    } catch (error) {
      console.error('Error clearing chat history:', error);
    }
  }, []);

  // Export messages to markdown format
  const exportToMarkdown = React.useCallback(() => {
    const markdown = messages
      .map((msg) => {
        const role = msg.role === 'user' ? '**User**' : '**Assistant**';
        const timestamp = msg.timestamp.toLocaleString();
        return `### ${role} (${timestamp})\n\n${msg.content}\n\n---\n`;
      })
      .join('\n');

    return `# AI Chat History\n\n${markdown}`;
  }, [messages]);

  return {
    messages,
    setMessages,
    clearHistory,
    exportToMarkdown,
  };
}
