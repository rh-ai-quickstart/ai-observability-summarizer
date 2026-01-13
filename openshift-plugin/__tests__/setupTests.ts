import '@testing-library/jest-dom';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    hostname: 'localhost',
    origin: 'http://localhost:9000',
    href: 'http://localhost:9000',
    protocol: 'http:',
    host: 'localhost:9000',
    pathname: '/',
    search: '',
    hash: '',
  },
  writable: true,
});

// Mock scrollIntoView (not implemented in jsdom)
Element.prototype.scrollIntoView = jest.fn();

// Suppress expected console output during tests
const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;
const originalDebug = console.debug;

beforeAll(() => {
  // Suppress known test warnings and expected error logs
  console.error = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    // Suppress expected test errors and React warnings
    if (
      message.includes('Warning: ReactDOM.render') ||
      message.includes('Warning: An update to TestComponent') ||
      message.includes('Warning: An update to AIChatPage') ||
      message.includes('was not wrapped in act') ||
      message.includes('Failed to chat:') ||
      message.includes('Error loading chat history')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };

  console.warn = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    // Suppress expected warnings from tests
    if (message.includes('Failed to parse session config')) {
      return;
    }
    originalWarn.call(console, ...args);
  };

  console.log = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    // Suppress debug logs from chat function
    if (message.includes('[Chat]')) {
      return;
    }
    originalLog.call(console, ...args);
  };

  console.debug = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    // Suppress debug messages
    if (message.includes('[Chat]')) {
      return;
    }
    originalDebug.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
  console.log = originalLog;
  console.debug = originalDebug;
});
