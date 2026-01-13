import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AIChatPage } from '../../src/pages/AIChatPage';
import * as mcpClient from '../../src/services/mcpClient';
import * as useChatHistoryModule from '../../src/hooks/useChatHistory';
import * as useProgressIndicatorModule from '../../src/hooks/useProgressIndicator';

// Mock the services and hooks
jest.mock('../../src/services/mcpClient');
jest.mock('../../src/hooks/useChatHistory');
jest.mock('../../src/hooks/useProgressIndicator');

// Mock ReactMarkdown and remark-gfm (ESM modules)
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: any) => <div className="chat-markdown">{children}</div>,
}));

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../src/components/SuggestedQuestions', () => ({
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

describe('AIChatPage', () => {
  const mockSetMessages = jest.fn();
  const mockClearHistory = jest.fn();
  const mockStartProgress = jest.fn();
  const mockStopProgress = jest.fn();
  const mockChat = mcpClient.chat as jest.MockedFunction<typeof mcpClient.chat>;
  const mockGetSessionConfig = mcpClient.getSessionConfig as jest.MockedFunction<typeof mcpClient.getSessionConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock useChatHistory hook
    (useChatHistoryModule.useChatHistory as jest.Mock).mockReturnValue({
      messages: [],
      setMessages: mockSetMessages,
      clearHistory: mockClearHistory,
    });

    // Mock useProgressIndicator hook
    (useProgressIndicatorModule.useProgressIndicator as jest.Mock).mockReturnValue({
      progressMessage: '',
      startProgress: mockStartProgress,
      stopProgress: mockStopProgress,
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

      expect(screen.getByText('AI Chat Assistant')).toBeInTheDocument();
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
      expect(screen.getByText(/Please click the settings icon/i)).toBeInTheDocument();
    });

    it('should not show configuration error when model is configured', () => {
      mockGetSessionConfig.mockReturnValue({
        ai_model: 'test-model',
        api_key: 'test-key',
      });

      render(<AIChatPage />);

      expect(screen.queryByText('Configuration Required')).not.toBeInTheDocument();
    });

    it('should dismiss configuration error when dismiss button clicked', () => {
      mockGetSessionConfig.mockReturnValue({ ai_model: '' });

      render(<AIChatPage />);

      const dismissButton = screen.getByText('Dismiss');
      fireEvent.click(dismissButton);

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
      fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });

      await waitFor(() => {
        expect(mockChat).toHaveBeenCalled();
      });
    });

    it('should not send message when Shift+Enter pressed', () => {
      render(<AIChatPage />);

      const input = screen.getByPlaceholderText('Ask about your metrics...');
      fireEvent.change(input, { target: { value: 'Test message' } });
      fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13, shiftKey: true });

      expect(mockChat).not.toHaveBeenCalled();
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

  describe('AI Chat Integration', () => {
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

    it('should replay progress log entries', async () => {
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

      // Current behavior: invalid timestamps result in NaNs (not caught by try-catch)
      // The time is displayed inside a Label component, so check the button's textContent
      const button = screen.getByText(/Show execution details/i);
      expect(button.textContent).toContain('NaNs');
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
});
