import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AIChatPage } from '../../src/core/pages/AIChatPage';
import * as mcpClient from '../../src/core/services/mcpClient';
import * as useChatHistoryModule from '../../src/core/hooks/useChatHistory';
import * as useProgressIndicatorModule from '../../src/core/hooks/useProgressIndicator';
import * as useChatSettingsModule from '../../src/core/hooks/useChatSettings';

// Mock the services and hooks
jest.mock('../../src/core/services/mcpClient');
jest.mock('../../src/core/hooks/useChatHistory');
jest.mock('../../src/core/hooks/useProgressIndicator');
jest.mock('../../src/core/hooks/useChatSettings');

// Mock ReactMarkdown and remark-gfm (ESM modules)
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: any) => <div className="chat-markdown">{children}</div>,
}));

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../src/core/components/SuggestedQuestions', () => ({
  SuggestedQuestions: ({ onSelectQuestion, isExpanded, onToggle }: any) => (
    <div data-testid="suggested-questions">
      <button onClick={() => onToggle(!isExpanded)}>
        {isExpanded ? 'Hide' : 'Show'} suggested questions
      </button>
      <button onClick={() => onSelectQuestion('What is GPU utilization?')}>
        GPU Question
      </button>
    </div>
  ),
}));

jest.mock('../../src/core/components/SuggestedQuestionsPopover', () => ({
  SuggestedQuestionsPopover: ({ onSelectQuestion }: any) => (
    <div data-testid="suggested-questions-popover">
      <button onClick={() => onSelectQuestion('What is GPU utilization?')}>
        GPU Question Popover
      </button>
    </div>
  ),
}));

jest.mock('../../src/core/components/MetricCategoriesPopover', () => ({
  MetricCategoriesPopover: ({ onSelectQuestion }: any) => (
    <div data-testid="metric-categories-popover">
      <button onClick={() => onSelectQuestion('What is the overall health of my cluster?')}>
        Cluster Health Question
      </button>
    </div>
  ),
}));

jest.mock('../../src/core/components/MetricCategoriesInline', () => ({
  MetricCategoriesInline: ({ onSelectQuestion, onCategorySelect, isExpanded, onToggle }: any) => (
    <div data-testid="metric-categories-inline">
      <button onClick={() => onToggle(!isExpanded)}>
        {isExpanded ? 'Hide' : 'Browse'} metric categories
      </button>
      <button onClick={() => onSelectQuestion('What is the overall health of my cluster?')}>
        Cluster Health Question Inline
      </button>
      <button onClick={() => onCategorySelect('GPU & AI Accelerators')}>
        Select GPU Category
      </button>
      <button onClick={() => onCategorySelect(null)}>
        Clear Category
      </button>
    </div>
  ),
}));

describe('AIChatPage', () => {
  const mockSetMessages = jest.fn();
  const mockClearHistory = jest.fn();
  const mockStartProgress = jest.fn();
  const mockStopProgress = jest.fn();
  const mockChat = mcpClient.chat as jest.MockedFunction<typeof mcpClient.chat>;
  const mockGetSessionConfig = mcpClient.getSessionConfig as jest.MockedFunction<typeof mcpClient.getSessionConfig>;

  const mockExportToMarkdown = jest.fn(() => '# Test Markdown');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock useChatHistory hook
    (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
      messages: [],
      setMessages: mockSetMessages,
      clearHistory: mockClearHistory,
      exportToMarkdown: mockExportToMarkdown,
    });

    // Mock useProgressIndicator hook
    (useProgressIndicatorModule.useProgressIndicator as jest.Mock).mockReturnValue({
      progressMessage: '',
      startProgress: mockStartProgress,
      stopProgress: mockStopProgress,
    });

    // Mock useChatSettings hook - use inline mode for tests to match existing test expectations
    (useChatSettingsModule.useChatSettings as jest.Mock).mockReturnValue({
      settings: {
        autoCollapseEnabled: true,
        messagesKeptExpanded: 3,
        collapsedPreviewLength: 200,
        suggestedQuestionsExpanded: true,
        suggestedQuestionsLocation: 'inline', // Use inline for tests
        metricCategoriesLocation: 'header',
        conversationContextLimit: 10,
        showProgressLogByDefault: false,
        enableKeyboardShortcuts: true,
        maxStoredMessages: 50,
      },
      updateSettings: jest.fn(),
      resetSettings: jest.fn(),
      isLoaded: true,
    });

    // Mock getSessionConfig to return valid config by default
    mockGetSessionConfig.mockReturnValue({
      ai_model: 'test-model',
      api_key: 'test-key',
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Initial Rendering', () => {
    it('should render the chat page with header', () => {
      render(<AIChatPage />);

      expect(screen.getByText('Chat with Prometheus')).toBeInTheDocument();
      expect(screen.getByText(/Ask questions about your metrics/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Ask about your metrics...')).toBeInTheDocument();
    });

    it('should render clear button', () => {
      render(<AIChatPage />);

      const clearButton = screen.getByTitle('Clear chat');
      expect(clearButton).toBeInTheDocument();
    });

    it('should render suggested questions component', () => {
      render(<AIChatPage />);

      expect(screen.getByTestId('suggested-questions')).toBeInTheDocument();
    });
  });

  describe('Configuration Validation', () => {
    it('should show configuration error when no AI model configured', () => {
      mockGetSessionConfig.mockReturnValue({ ai_model: '' });

      render(<AIChatPage />);

      expect(screen.getByText('Configuration Required')).toBeInTheDocument();
      expect(screen.getByText(/Click "Open Settings"/i)).toBeInTheDocument();
      expect(screen.getByText('Open Settings')).toBeInTheDocument();
    });

    it('should not show configuration error when model is configured', () => {
      mockGetSessionConfig.mockReturnValue({
        ai_model: 'test-model',
        api_key: 'test-key',
      });

      render(<AIChatPage />);

      expect(screen.queryByText('Configuration Required')).not.toBeInTheDocument();
    });

    it('should dismiss configuration error when close button clicked', () => {
      mockGetSessionConfig.mockReturnValue({ ai_model: '' });

      render(<AIChatPage />);

      const closeButton = screen.getByRole('button', { name: /✕/ });
      fireEvent.click(closeButton);

      expect(screen.queryByText('Configuration Required')).not.toBeInTheDocument();
    });

    it('should prevent sending message when no model configured', () => {
      mockGetSessionConfig.mockReturnValue({ ai_model: '' });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      const sendButton = screen.getByRole('button', { name: '' }); // Paper plane icon button

      fireEvent.change(input, { target: { value: 'Test message' } });
      fireEvent.click(sendButton);

      expect(mockChat).not.toHaveBeenCalled();
      expect(screen.getByText(/Please configure an AI model/i)).toBeInTheDocument();
    });
  });

  describe('Message Sending', () => {
    it('should send message when send button clicked', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [],
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test message' } });

      const sendButton = screen.getByRole('button', { name: '' });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'Test message',
          {
            scope: 'cluster_wide',
            apiKey: 'test-key',
            conversationHistory: [],
          }
        );
      });
    });

    it('should send message when Enter key pressed', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [],
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test message' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalled();
      });
    });

    it('should not send empty message', () => {
      render(<AIChatPage />);

      const sendButton = screen.getByRole('button', { name: '' });
      fireEvent.click(sendButton);

      expect(mockChat).not.toHaveBeenCalled();
    });

    it('should not send message when already loading', async () => {
      mockChat.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'First message' } });

      const sendButton = screen.getByRole('button', { name: '' });
      fireEvent.click(sendButton);

      // Try to send another message while first is loading
      fireEvent.change(input, { target: { value: 'Second message' } });
      fireEvent.click(sendButton);

      // Should only be called once
      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledTimes(1);
      });
    });

    it('should clear input after sending message', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [],
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Test message' } });

      const sendButton = screen.getByRole('button', { name: '' });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(input.value).toBe('');
      });
    });

    it('should disable input while loading', async () => {
      mockChat.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test message' } });

      const sendButton = screen.getByRole('button', { name: '' });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(input).toBeDisabled();
      });
    });
  });

  describe('Message Rendering', () => {
    it('should render user and assistant messages', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'User message',
          timestamp: new Date('2024-01-01T10:00:00'),
        },
        {
          id: '2',
          role: 'assistant' as const,
          content: 'Assistant message',
          timestamp: new Date('2024-01-01T10:00:01'),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      render(<AIChatPage />);

      expect(screen.getByText('User message')).toBeInTheDocument();
      expect(screen.getByText('Assistant message')).toBeInTheDocument();
    });

    it('should show loading indicator when loading', () => {
      mockChat.mockImplementation(() => new Promise(() => {}));

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      expect(screen.getByText(/Analyzing.../i)).toBeInTheDocument();
    });

    it('should display progress message during loading', async () => {
      (useProgressIndicatorModule.useProgressIndicator as jest.Mock).mockReturnValue({
        progressMessage: 'Querying metrics data...',
        startProgress: mockStartProgress,
        stopProgress: mockStopProgress,
      });

      mockChat.mockImplementation(() => new Promise(() => {}));

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        expect(screen.getByText('Querying metrics data...')).toBeInTheDocument();
      });
    });
  });

  describe('Progress Logs Feature', () => {
    const mockMessagesWithProgressLog = [
      {
        id: '1',
        role: 'assistant' as const,
        content: 'Response with progress',
        timestamp: new Date('2024-01-01T10:00:00'),
        progressLog: [
          { timestamp: '2024-01-01T10:00:00', message: 'Step 1: Analyzing' },
          { timestamp: '2024-01-01T10:00:02', message: 'Step 2: Processing' },
          { timestamp: '2024-01-01T10:00:05', message: 'Step 3: Complete' },
        ],
      },
    ];

    it('should show execution details button for messages with progress logs', () => {
      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessagesWithProgressLog,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      render(<AIChatPage />);

      expect(screen.getByText(/Show execution details/i)).toBeInTheDocument();
      expect(screen.getByText(/3 steps/i)).toBeInTheDocument();
    });

    it('should calculate and display time taken correctly', () => {
      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessagesWithProgressLog,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      render(<AIChatPage />);

      // Time from 10:00:00 to 10:00:05 = 5 seconds
      // The time is displayed inside a Label component, so we need to check the button's textContent
      const button = screen.getByText(/Show execution details/i);
      expect(button.textContent).toContain('5.0s');
    });

    it('should toggle progress log visibility when button clicked', () => {
      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessagesWithProgressLog,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      render(<AIChatPage />);

      const toggleButton = screen.getByText(/Show execution details/i);

      // Initially collapsed - should not show steps
      expect(screen.queryByText('Step 1: Analyzing')).not.toBeInTheDocument();

      // Click to expand
      fireEvent.click(toggleButton);

      // Should show steps
      expect(screen.getByText('Step 1: Analyzing')).toBeInTheDocument();
      expect(screen.getByText('Step 2: Processing')).toBeInTheDocument();
      expect(screen.getByText('Step 3: Complete')).toBeInTheDocument();
      expect(screen.getByText(/Hide execution details/i)).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(screen.getByText(/Hide execution details/i));

      // Should hide steps again
      expect(screen.queryByText('Step 1: Analyzing')).not.toBeInTheDocument();
    });

    it('should show AI Execution Steps header when expanded', () => {
      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessagesWithProgressLog,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      const { container } = render(<AIChatPage />);

      const toggleButton = screen.getByText(/Show execution details/i);
      fireEvent.click(toggleButton);

      expect(screen.getByText('AI Execution Steps:')).toBeInTheDocument();
      // Check that the page contains the time and step information
      // These are rendered in separate Text components, so check the overall container
      expect(container.textContent).toContain('Total time: 5.0s');
      expect(container.textContent).toContain('3 steps');
    });

    it('should not show execution details button for messages without progress logs', () => {
      const messagesWithoutProgressLog = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Simple response',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: messagesWithoutProgressLog,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      render(<AIChatPage />);

      expect(screen.queryByText(/execution details/i)).not.toBeInTheDocument();
    });

    it('should handle progress log with single step', () => {
      const singleStepMessage = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Response',
          timestamp: new Date(),
          progressLog: [
            { timestamp: '10:00:00', message: 'Single step' },
          ],
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: singleStepMessage,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      render(<AIChatPage />);

      expect(screen.getByText(/1 step/i)).toBeInTheDocument();
    });
  });

  describe('Chat with Prometheus Integration', () => {
    it('should add user and assistant messages after successful chat', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response text',
        progressLog: [],
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test question' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        expect(mockSetMessages).toHaveBeenCalledWith(expect.any(Function));
      });

      // Verify it was called twice (once for user message, once for assistant)
      expect(mockSetMessages).toHaveBeenCalledTimes(2);
    });

    it('should handle chat errors gracefully', async () => {
      mockChat.mockRejectedValue(new Error('Network error'));

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test question' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        expect(mockStopProgress).toHaveBeenCalled();
      });

      // Should add error message
      expect(mockSetMessages).toHaveBeenCalled();
    });

    it('should start and stop progress indicator correctly', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [],
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        expect(mockStartProgress).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockStopProgress).toHaveBeenCalled();
      });
    });

    it('should handle progress log entries without replay delay', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [
          { timestamp: '10:00:00', message: 'Step 1' },
          { timestamp: '10:00:01', message: 'Step 2' },
        ],
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        expect(mockStopProgress).toHaveBeenCalled();
      });
    });
  });

  describe('Conversation History', () => {
    it('should send empty conversation history for first message', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [],
      });

      // Start with no messages
      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: [],
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'First message' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'First message',
          {
            scope: 'cluster_wide',
            apiKey: 'test-key',
            conversationHistory: [],
          }
        );
      });
    });

    it('should include previous messages in conversation history', async () => {
      mockChat.mockResolvedValue({
        response: 'Third response',
        progressLog: [],
      });

      const previousMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'First question',
          timestamp: new Date('2024-01-01T10:00:00'),
        },
        {
          id: '2',
          role: 'assistant' as const,
          content: 'First answer',
          timestamp: new Date('2024-01-01T10:00:01'),
        },
        {
          id: '3',
          role: 'user' as const,
          content: 'Second question',
          timestamp: new Date('2024-01-01T10:00:02'),
        },
        {
          id: '4',
          role: 'assistant' as const,
          content: 'Second answer',
          timestamp: new Date('2024-01-01T10:00:03'),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: previousMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Third question' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'Third question',
          {
            scope: 'cluster_wide',
            apiKey: 'test-key',
            conversationHistory: [
              { role: 'user', content: 'First question' },
              { role: 'assistant', content: 'First answer' },
              { role: 'user', content: 'Second question' },
              { role: 'assistant', content: 'Second answer' },
            ],
          }
        );
      });
    });

    it('should filter out error messages from conversation history', async () => {
      mockChat.mockResolvedValue({
        response: 'Success response',
        progressLog: [],
      });

      const messagesWithError = [
        {
          id: '1',
          role: 'user' as const,
          content: 'First question',
          timestamp: new Date('2024-01-01T10:00:00'),
        },
        {
          id: '2',
          role: 'assistant' as const,
          content: '❌ Error occurred',
          timestamp: new Date('2024-01-01T10:00:01'),
          error: true,
        },
        {
          id: '3',
          role: 'user' as const,
          content: 'Second question',
          timestamp: new Date('2024-01-01T10:00:02'),
        },
        {
          id: '4',
          role: 'assistant' as const,
          content: 'Good answer',
          timestamp: new Date('2024-01-01T10:00:03'),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: messagesWithError,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Third question' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'Third question',
          {
            scope: 'cluster_wide',
            apiKey: 'test-key',
            conversationHistory: [
              { role: 'user', content: 'First question' },
              // Error message excluded
              { role: 'user', content: 'Second question' },
              { role: 'assistant', content: 'Good answer' },
            ],
          }
        );
      });
    });

    it('should preserve conversation history when retrying failed message', async () => {
      mockChat.mockResolvedValue({
        response: 'Retry success',
        progressLog: [],
      });

      const messagesBeforeRetry = [
        {
          id: '1',
          role: 'user' as const,
          content: 'First question',
          timestamp: new Date('2024-01-01T10:00:00'),
        },
        {
          id: '2',
          role: 'assistant' as const,
          content: 'First answer',
          timestamp: new Date('2024-01-01T10:00:01'),
        },
        {
          id: '3',
          role: 'assistant' as const,
          content: '❌ Error',
          timestamp: new Date('2024-01-01T10:00:02'),
          error: true,
          originalUserMessage: 'Failed question',
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: messagesBeforeRetry,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const retryButton = screen.getByText('Retry');
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'Failed question',
          {
            scope: 'cluster_wide',
            apiKey: 'test-key',
            conversationHistory: [
              { role: 'user', content: 'First question' },
              { role: 'assistant', content: 'First answer' },
              // Error message excluded from history
            ],
          }
        );
      });
    });

    it('should send conversation history when editing and resending a message', async () => {
      mockChat.mockResolvedValue({
        response: 'Response to edited question',
        progressLog: [],
      });

      const messagesBeforeEdit = [
        {
          id: '1',
          role: 'user' as const,
          content: 'First question',
          timestamp: new Date('2024-01-01T10:00:00'),
        },
        {
          id: '2',
          role: 'assistant' as const,
          content: 'First answer',
          timestamp: new Date('2024-01-01T10:00:01'),
        },
        {
          id: '3',
          role: 'user' as const,
          content: 'Question to edit',
          timestamp: new Date('2024-01-01T10:00:02'),
        },
        {
          id: '4',
          role: 'assistant' as const,
          content: 'Answer to be removed',
          timestamp: new Date('2024-01-01T10:00:03'),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: messagesBeforeEdit,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      // Find and click the last edit button (for the last user message)
      const editButtons = screen.getAllByTitle('Edit and resend');
      fireEvent.click(editButtons[editButtons.length - 1]);

      // Wait for edit mode
      await waitFor(() => {
        expect(screen.getByText('Save & Resend')).toBeInTheDocument();
      });

      // Change and save - get the textbox input specifically
      const editInput = screen.getByRole('textbox', { name: 'Edit message' });
      fireEvent.change(editInput, { target: { value: 'Edited question' } });
      fireEvent.click(screen.getByText('Save & Resend'));

      await waitFor(() => {
        // Verify that conversation history is sent with the edited message
        // Due to React batching, history includes all previous messages
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'Edited question',
          expect.objectContaining({
            conversationHistory: expect.arrayContaining([
              { role: 'user', content: 'First question' },
              { role: 'assistant', content: 'First answer' },
            ]),
          })
        );
      });
    });

    it('should handle conversation history with only error messages', async () => {
      mockChat.mockResolvedValue({
        response: 'Success after errors',
        progressLog: [],
      });

      const onlyErrorMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: '❌ First error',
          timestamp: new Date('2024-01-01T10:00:00'),
          error: true,
        },
        {
          id: '2',
          role: 'assistant' as const,
          content: '❌ Second error',
          timestamp: new Date('2024-01-01T10:00:01'),
          error: true,
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: onlyErrorMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'New question' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        // All previous messages were errors, so conversation history should be empty
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'New question',
          {
            scope: 'cluster_wide',
            apiKey: 'test-key',
            conversationHistory: [],
          }
        );
      });
    });
  });

  describe('Suggested Questions Integration', () => {
    it('should send suggested question when clicked', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [],
      });

      render(<AIChatPage />);

      const suggestedButton = screen.getByText('GPU Question');
      fireEvent.click(suggestedButton);

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'What is GPU utilization?',
          expect.any(Object)
        );
      });
    });
  });

  describe('Clear Functionality', () => {
    it('should clear chat history when clear button clicked', () => {
      render(<AIChatPage />);

      const clearButton = screen.getByTitle('Clear chat');
      fireEvent.click(clearButton);

      expect(mockClearHistory).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle time calculation with invalid timestamps', () => {
      const messagesWithInvalidTimestamps = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Response',
          timestamp: new Date(),
          progressLog: [
            { timestamp: 'invalid', message: 'Step 1' },
          ],
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: messagesWithInvalidTimestamps,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      render(<AIChatPage />);

      // Invalid timestamps should gracefully fall back to 0.0s
      const button = screen.getByText(/Show execution details/i);
      expect(button.textContent).toContain('0.0s');
    });

    it('should handle empty progress log array', () => {
      const messagesWithEmptyProgressLog = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Response',
          timestamp: new Date(),
          progressLog: [],
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: messagesWithEmptyProgressLog,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
      });

      render(<AIChatPage />);

      // Should not show execution details button for empty progress log
      expect(screen.queryByText(/execution details/i)).not.toBeInTheDocument();
    });
  });

  describe('Phase 2 Features - Export Conversation', () => {
    beforeEach(() => {
      // Mock URL methods
      global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
      global.URL.revokeObjectURL = jest.fn();

      // Mock HTMLAnchorElement.prototype.click to prevent jsdom navigation error
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
        // Do nothing to prevent navigation
      });
    });

    afterEach(() => {
      (HTMLAnchorElement.prototype.click as jest.Mock).mockRestore();
    });

    it('should render export button', () => {
      render(<AIChatPage />);

      const exportButton = screen.getByTitle('Export conversation');
      expect(exportButton).toBeInTheDocument();
      expect(exportButton.textContent).toContain('Export');
    });

    it('should export conversation as markdown when export button clicked', () => {
      mockExportToMarkdown.mockReturnValue('# Chat History\n\nTest content');

      render(<AIChatPage />);

      const exportButton = screen.getByTitle('Export conversation');
      fireEvent.click(exportButton);

      expect(mockExportToMarkdown).toHaveBeenCalled();
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    });
  });

  describe('Phase 2 Features - Copy Message', () => {
    let originalClipboard: Clipboard;

    beforeEach(() => {
      // Save and mock clipboard API
      originalClipboard = navigator.clipboard;
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      });
    });

    afterEach(() => {
      // Restore original clipboard
      Object.assign(navigator, { clipboard: originalClipboard });
    });

    it('should show copy button for assistant messages', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Assistant message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      expect(screen.getByTitle('Copy message')).toBeInTheDocument();
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    it('should not show copy button for user messages', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'User message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      expect(screen.queryByTitle('Copy message')).not.toBeInTheDocument();
    });

    it('should copy message content to clipboard when copy button clicked', async () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Message to copy',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const copyButton = screen.getByTitle('Copy message');
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Message to copy');
      });
    });

    it('should show success feedback after copying', async () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Message to copy',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const copyButton = screen.getByTitle('Copy message');
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText('Copied')).toBeInTheDocument();
        expect(screen.getByTitle('Copied!')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText('Message copied to clipboard')).toBeInTheDocument();
      });
    });

    it('should reset copy state after 2 seconds', async () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Message to copy',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const copyButton = screen.getByTitle('Copy message');
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText('Copied')).toBeInTheDocument();
      });

      // Fast-forward time by 2 seconds
      jest.advanceTimersByTime(2000);

      await waitFor(() => {
        expect(screen.queryByText('Copied')).not.toBeInTheDocument();
        expect(screen.getByText('Copy')).toBeInTheDocument();
      });
    });
  });

  describe('Phase 2 Features - Retry Failed Messages', () => {
    it('should show retry button for error messages with original user message', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: '❌ I encountered an error: Network error',
          timestamp: new Date(),
          error: true,
          originalUserMessage: 'What is GPU utilization?',
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('should not show retry button for messages without error', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Normal response',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    });

    it('should resend original message when retry button clicked', async () => {
      mockChat.mockResolvedValue({
        response: 'Success response',
        progressLog: [],
      });

      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: '❌ I encountered an error',
          timestamp: new Date(),
          error: true,
          originalUserMessage: 'Original question',
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const retryButton = screen.getByText('Retry');
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'Original question',
          expect.any(Object)
        );
      });
    });

    it('should disable retry button while loading', () => {
      mockChat.mockImplementation(() => new Promise(() => {}));

      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: '❌ Error',
          timestamp: new Date(),
          error: true,
          originalUserMessage: 'Question',
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const retryButton = screen.getByText('Retry');
      fireEvent.click(retryButton);

      expect(retryButton).toBeDisabled();
    });
  });

  describe('Phase 2 Features - Edit & Resend Messages', () => {
    it('should show edit button for user messages', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'User message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      expect(screen.getByTitle('Edit and resend')).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('should not show edit button for assistant messages', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Assistant message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      expect(screen.queryByTitle('Edit and resend')).not.toBeInTheDocument();
    });

    it('should enter edit mode when edit button clicked', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'Original message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      const editButton = screen.getByTitle('Edit and resend');
      fireEvent.click(editButton);

      // Should show edit controls
      expect(screen.getByLabelText('Edit message')).toBeInTheDocument();
      expect(screen.getByText('Save & Resend')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();

      // Input should have the original message
      const input = screen.getByLabelText('Edit message') as HTMLInputElement;
      expect(input.value).toBe('Original message');
    });

    it('should cancel edit mode when cancel button clicked', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'Original message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      // Enter edit mode
      fireEvent.click(screen.getByTitle('Edit and resend'));

      // Verify we're in edit mode
      expect(screen.getByText('Save & Resend')).toBeInTheDocument();

      // Cancel edit
      fireEvent.click(screen.getByText('Cancel'));

      // Should exit edit mode - Save & Resend should disappear
      expect(screen.queryByText('Save & Resend')).not.toBeInTheDocument();
      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
      expect(screen.getByTitle('Edit and resend')).toBeInTheDocument();
    });

    it('should save and resend when save button clicked', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [],
      });

      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'Original message',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'assistant' as const,
          content: 'Old response',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      // Enter edit mode
      fireEvent.click(screen.getByTitle('Edit and resend'));

      // Change the message
      const input = screen.getByLabelText('Edit message');
      fireEvent.change(input, { target: { value: 'Edited message' } });

      // Save & resend
      fireEvent.click(screen.getByText('Save & Resend'));

      await waitFor(() => {
        // Should append the edited message as a new message (history preserved)
        expect(mockSetMessages).toHaveBeenCalled();
        // Should send the edited message
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'Edited message',
          expect.any(Object)
        );
      });
    });

    it('should save and resend when Enter key pressed in edit mode', async () => {
      mockChat.mockResolvedValue({
        response: 'AI response',
        progressLog: [],
      });

      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'Original message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      // Enter edit mode
      fireEvent.click(screen.getByTitle('Edit and resend'));

      // Change the message
      const input = screen.getByLabelText('Edit message');
      fireEvent.change(input, { target: { value: 'Edited with Enter' } });

      // Press Enter
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalledWith(
          'test-model',
          'Edited with Enter',
          expect.any(Object)
        );
      });
    });

    it('should cancel edit when Escape key pressed', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'Original message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      // Enter edit mode
      fireEvent.click(screen.getByTitle('Edit and resend'));

      // Verify we're in edit mode
      expect(screen.getByText('Save & Resend')).toBeInTheDocument();

      const input = screen.getByLabelText('Edit message');
      fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

      // Should exit edit mode - Save & Resend should disappear
      expect(screen.queryByText('Save & Resend')).not.toBeInTheDocument();
      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });

    it('should disable save button when edit value is empty', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'Original message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      // Enter edit mode
      fireEvent.click(screen.getByTitle('Edit and resend'));

      // Clear the input
      const input = screen.getByLabelText('Edit message');
      fireEvent.change(input, { target: { value: '   ' } });

      // Save button should be disabled
      const saveButton = screen.getByText('Save & Resend');
      expect(saveButton).toBeDisabled();
    });

    it('should disable edit button while loading', () => {
      mockChat.mockImplementation(() => new Promise(() => {}));

      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'User message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      render(<AIChatPage />);

      // Start a message send
      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      // Edit button should be disabled
      const editButton = screen.getByTitle('Edit and resend');
      expect(editButton).toBeDisabled();
    });
  });

  describe('Phase 2 Features - Keyboard Shortcuts', () => {
    const originalPlatform = navigator.platform;

    afterEach(() => {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });

    it('should focus input when Cmd+K pressed on Mac', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true,
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');

      // Press Cmd+K
      fireEvent.keyDown(document, { key: 'k', code: 'KeyK', metaKey: true });

      expect(document.activeElement).toBe(input);
    });

    it('should focus input when Ctrl+K pressed on Windows', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true,
      });

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');

      // Press Ctrl+K
      fireEvent.keyDown(document, { key: 'k', code: 'KeyK', ctrlKey: true });

      expect(document.activeElement).toBe(input);
    });

    it('should clear conversation when Cmd+L pressed', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true,
      });

      render(<AIChatPage />);

      // Press Cmd+L
      fireEvent.keyDown(document, { key: 'l', code: 'KeyL', metaKey: true });

      expect(mockClearHistory).toHaveBeenCalled();
    });

    it('should clear conversation when Ctrl+L pressed', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true,
      });

      render(<AIChatPage />);

      // Press Ctrl+L
      fireEvent.keyDown(document, { key: 'l', code: 'KeyL', ctrlKey: true });

      expect(mockClearHistory).toHaveBeenCalled();
    });

    it('should stop loading when Escape pressed during chat', async () => {
      mockChat.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      // Should be loading
      await waitFor(() => {
        expect(screen.getByText(/Analyzing/i)).toBeInTheDocument();
      });

      // Press Escape
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

      // Should stop progress
      expect(mockStopProgress).toHaveBeenCalled();
    });

    it('should render keyboard shortcuts help button', () => {
      render(<AIChatPage />);

      const helpButton = screen.getByLabelText('Show keyboard shortcuts');
      expect(helpButton).toBeInTheDocument();

      // Click should not throw
      fireEvent.click(helpButton);
    });
  });

  describe('Phase 2 Features - Animations and CSS', () => {
    it('should apply fade-in animation class to messages', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'User message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      const { container } = render(<AIChatPage />);

      const messageElements = container.querySelectorAll('.message-fade-in');
      expect(messageElements.length).toBeGreaterThan(0);
    });

    it('should apply chat-messages-container class for smooth scrolling', () => {
      const { container } = render(<AIChatPage />);

      const messagesContainer = container.querySelector('.chat-messages-container');
      expect(messagesContainer).toBeInTheDocument();
    });

    it('should apply typing indicator animation during loading', async () => {
      mockChat.mockImplementation(() => new Promise(() => {}));

      const { container } = render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByRole('button', { name: '' }));

      await waitFor(() => {
        const typingIndicator = container.querySelector('.typing-indicator');
        expect(typingIndicator).toBeInTheDocument();
      });
    });

    it('should apply edit-mode-active class during edit', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'user' as const,
          content: 'User message',
          timestamp: new Date(),
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      const { container } = render(<AIChatPage />);

      // Enter edit mode
      fireEvent.click(screen.getByTitle('Edit and resend'));

      const editModeElement = container.querySelector('.edit-mode-active');
      expect(editModeElement).toBeInTheDocument();
    });

    it('should apply progress-log-expanded class when progress log is expanded', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Response',
          timestamp: new Date(),
          progressLog: [
            { timestamp: '10:00:00', message: 'Step 1' },
          ],
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      const { container } = render(<AIChatPage />);

      // Expand progress log
      fireEvent.click(screen.getByText(/Show execution details/i));

      const expandedElement = container.querySelector('.progress-log-expanded');
      expect(expandedElement).toBeInTheDocument();
    });

    it('should apply progress-log-collapsed class when progress log is collapsed', () => {
      const mockMessages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'Response',
          timestamp: new Date(),
          progressLog: [
            { timestamp: '10:00:00', message: 'Step 1' },
          ],
        },
      ];

      (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
        messages: mockMessages,
        setMessages: mockSetMessages,
        clearHistory: mockClearHistory,
        exportToMarkdown: mockExportToMarkdown,
      });

      const { container } = render(<AIChatPage />);

      // Progress log should be collapsed by default
      const collapsedElement = container.querySelector('.progress-log-collapsed');
      expect(collapsedElement).toBeInTheDocument();
    });
  });
});
