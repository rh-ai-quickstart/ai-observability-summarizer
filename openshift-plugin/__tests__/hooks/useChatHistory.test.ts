import { renderHook, act } from '@testing-library/react-hooks';
import { waitFor } from '@testing-library/react';
import { useChatHistory, Message } from '../../src/core/hooks/useChatHistory';

describe('useChatHistory', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should initialize with greeting message when no history exists', () => {
    const { result } = renderHook(() => useChatHistory());

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('assistant');
    expect(result.current.messages[0].content).toContain('Hello!');
  });

  it('should load messages from localStorage', () => {
    const mockMessages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'Test message',
        timestamp: new Date('2024-01-01'),
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Test response',
        timestamp: new Date('2024-01-01'),
      },
    ];

    localStorage.setItem('openshift_ai_chat_history', JSON.stringify(mockMessages));

    const { result } = renderHook(() => useChatHistory());

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe('Test message');
    expect(result.current.messages[1].content).toBe('Test response');
  });

  it('should save messages to localStorage after debounce', async () => {
    const { result } = renderHook(() => useChatHistory());

    const newMessage: Message = {
      id: '123',
      role: 'user',
      content: 'New message',
      timestamp: new Date(),
    };

    act(() => {
      result.current.setMessages((prev) => [...prev, newMessage]);
    });

    // Fast-forward debounce timer (500ms)
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Wait for localStorage to be updated
    await waitFor(() => {
      const stored = localStorage.getItem('openshift_ai_chat_history');
      expect(stored).toBeTruthy();
      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.some((msg: Message) => msg.content === 'New message')).toBe(true);
      }
    });
  });

  it('should clear history and reset to greeting', () => {
    const mockMessages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'Test message',
        timestamp: new Date(),
      },
    ];

    localStorage.setItem('openshift_ai_chat_history', JSON.stringify(mockMessages));

    const { result } = renderHook(() => useChatHistory());

    // Should have loaded message
    expect(result.current.messages).toHaveLength(1);

    act(() => {
      result.current.clearHistory();
    });

    // Should have only greeting message
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('assistant');
    expect(result.current.messages[0].content).toContain('Hello!');
    expect(localStorage.getItem('openshift_ai_chat_history')).toBeNull();
  });

  it('should limit messages to MAX_MESSAGES (50)', async () => {
    const { result } = renderHook(() => useChatHistory());

    // Add 52 messages
    act(() => {
      const newMessages: Message[] = Array.from({ length: 52 }, (_, i) => ({
        id: `${i}`,
        role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `Message ${i}`,
        timestamp: new Date(),
      }));
      result.current.setMessages(newMessages);
    });

    // Fast-forward debounce
    act(() => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      const stored = localStorage.getItem('openshift_ai_chat_history');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Should only save last 50 messages
        expect(parsed.length).toBe(50);
        // First message should be message 2 (0 and 1 dropped)
        expect(parsed[0].content).toBe('Message 2');
      }
    });
  });

  it('should export messages to markdown', () => {
    const mockMessages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'What is the GPU usage?',
        timestamp: new Date('2024-01-01T10:00:00'),
      },
      {
        id: '2',
        role: 'assistant',
        content: 'GPU usage is at 85%',
        timestamp: new Date('2024-01-01T10:00:05'),
      },
    ];

    localStorage.setItem('openshift_ai_chat_history', JSON.stringify(mockMessages));

    const { result } = renderHook(() => useChatHistory());

    const markdown = result.current.exportToMarkdown();

    expect(markdown).toContain('# AI Chat History');
    expect(markdown).toContain('**User**');
    expect(markdown).toContain('What is the GPU usage?');
    expect(markdown).toContain('**Assistant**');
    expect(markdown).toContain('GPU usage is at 85%');
  });

  it('should handle corrupted localStorage gracefully', () => {
    localStorage.setItem('openshift_ai_chat_history', 'invalid json');

    const { result } = renderHook(() => useChatHistory());

    // Should fall back to greeting message
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('assistant');
  });

  it('should preserve progressLog when saving/loading', async () => {
    const messageWithProgress: Message = {
      id: '1',
      role: 'assistant',
      content: 'Response',
      timestamp: new Date(),
      progressLog: [
        { timestamp: '10:00:00', message: 'Step 1' },
        { timestamp: '10:00:01', message: 'Step 2' },
      ],
    };

    const { result } = renderHook(() => useChatHistory());

    act(() => {
      result.current.setMessages([messageWithProgress]);
    });

    // Fast-forward debounce
    act(() => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      const stored = localStorage.getItem('openshift_ai_chat_history');
      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed[0].progressLog).toHaveLength(2);
        expect(parsed[0].progressLog[0].message).toBe('Step 1');
      }
    });
  });
});
