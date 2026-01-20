import * as React from 'react';

const PROGRESS_MESSAGES = [
  '🔍 Analyzing your request...',
  '📡 Connecting to services...',
  '🤖 Processing with AI...',
  '💭 Working on your request...',
  '⏳ Preparing response...',
];

const ROTATION_INTERVAL = 5000; // 5 seconds

/**
 * Custom hook for rotating progress messages during AI processing
 */
export function useProgressIndicator() {
  const [progressMessage, setProgressMessage] = React.useState<string>('');
  const [isActive, setIsActive] = React.useState(false);
  const currentIndexRef = React.useRef(0);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Start progress indicator
  const startProgress = React.useCallback(() => {
    setIsActive(true);
    currentIndexRef.current = 0;
    setProgressMessage(PROGRESS_MESSAGES[0]);
  }, []);

  // Stop progress indicator
  const stopProgress = React.useCallback(() => {
    setIsActive(false);
    setProgressMessage('');
    currentIndexRef.current = 0;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Rotate through progress messages
  React.useEffect(() => {
    if (!isActive) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      const nextIndex = (currentIndexRef.current + 1) % PROGRESS_MESSAGES.length;
      currentIndexRef.current = nextIndex;
      setProgressMessage(PROGRESS_MESSAGES[nextIndex]);
    }, ROTATION_INTERVAL);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive]);

  return {
    progressMessage,
    startProgress,
    stopProgress,
  };
}
