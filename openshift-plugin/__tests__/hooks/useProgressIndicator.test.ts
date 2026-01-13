import { renderHook } from '@testing-library/react-hooks';
import { act } from '@testing-library/react';
import { useProgressIndicator } from '../../src/hooks/useProgressIndicator';

describe('useProgressIndicator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('should start with empty progress message', () => {
    const { result } = renderHook(() => useProgressIndicator());
    expect(result.current.progressMessage).toBe('');
  });

  it('should cycle through progress messages when started', () => {
    const { result } = renderHook(() => useProgressIndicator());

    act(() => {
      result.current.startProgress();
    });

    // Should have first message immediately
    expect(result.current.progressMessage).toBeTruthy();
    const firstMessage = result.current.progressMessage;

    // Advance by 2 seconds (message rotation interval)
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Should have rotated to next message
    expect(result.current.progressMessage).toBeTruthy();
    expect(result.current.progressMessage).not.toBe(firstMessage);
  });

  it('should contain expected progress messages', () => {
    const { result } = renderHook(() => useProgressIndicator());
    const observedMessages = new Set<string>();

    act(() => {
      result.current.startProgress();
    });

    // Collect messages over 10 seconds (5 rotations)
    for (let i = 0; i < 5; i++) {
      observedMessages.add(result.current.progressMessage);
      act(() => {
        jest.advanceTimersByTime(2000);
      });
    }

    // Should have seen multiple different messages
    expect(observedMessages.size).toBeGreaterThan(1);

    // Check for expected message patterns
    const messagesArray = Array.from(observedMessages);
    const hasExpectedPatterns = messagesArray.some(
      (msg) =>
        msg.includes('Analyzing') ||
        msg.includes('Querying') ||
        msg.includes('Processing') ||
        msg.includes('Generating')
    );
    expect(hasExpectedPatterns).toBe(true);
  });

  it('should stop rotating and clear message when stopped', () => {
    const { result } = renderHook(() => useProgressIndicator());

    act(() => {
      result.current.startProgress();
    });

    expect(result.current.progressMessage).toBeTruthy();

    act(() => {
      result.current.stopProgress();
    });

    // Message should be cleared
    expect(result.current.progressMessage).toBe('');

    // Advance time - message should stay empty (no more rotation)
    const messageAfterStop = result.current.progressMessage;
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.progressMessage).toBe(messageAfterStop);
  });

  it('should handle multiple start/stop cycles', () => {
    const { result } = renderHook(() => useProgressIndicator());

    // First cycle
    act(() => {
      result.current.startProgress();
    });
    expect(result.current.progressMessage).toBeTruthy();

    act(() => {
      result.current.stopProgress();
    });
    expect(result.current.progressMessage).toBe('');

    // Second cycle
    act(() => {
      result.current.startProgress();
    });
    expect(result.current.progressMessage).toBeTruthy();

    act(() => {
      result.current.stopProgress();
    });
    expect(result.current.progressMessage).toBe('');
  });

  it('should cleanup interval on unmount', () => {
    const { result, unmount } = renderHook(() => useProgressIndicator());

    act(() => {
      result.current.startProgress();
    });

    const messageBefore = result.current.progressMessage;
    expect(messageBefore).toBeTruthy();

    unmount();

    // After unmount, the interval should be cleaned up
    // We can verify this by checking that no timers are pending
    expect(jest.getTimerCount()).toBe(0);
  });

  it('should not start multiple intervals if startProgress called multiple times', () => {
    const { result } = renderHook(() => useProgressIndicator());

    act(() => {
      result.current.startProgress();
      result.current.startProgress();
      result.current.startProgress();
    });

    // Should only have one interval running
    // (one for the rotation, implementation specific)
    const timerCount = jest.getTimerCount();
    expect(timerCount).toBeLessThanOrEqual(1);
  });
});
