import '@testing-library/jest-dom';

// Mock ESM-only modules that Jest cannot parse
jest.mock('remark-gfm', () => () => {});

// Mock react-i18next to return translation keys as-is
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

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

// Mock URL methods (not fully implemented in jsdom)
if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = jest.fn(() => 'mock-blob-url');
}
if (!window.URL.revokeObjectURL) {
  window.URL.revokeObjectURL = jest.fn();
}

// Suppress expected console output during tests
// Apply immediately (not in beforeAll) to catch warnings during module loading
const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;
const originalDebug = console.debug;

// Patterns to suppress in console.error
const suppressedErrorPatterns = [
  'Warning: ReactDOM.render',
  'Warning: An update to TestComponent',
  'Warning: An update to AIChatPage',
  'Warning: An update to OpenShiftMetricsPage',
  'was not wrapped in act',
  'Failed to chat:',
  'Error loading chat history',
  'Failed to download chart data',
  'Failed to load namespaces',
  'Failed to load metrics',
  '[OpenShift]',
  'revokeObjectURL',
];

// Patterns to suppress in console.warn
const suppressedWarnPatterns = [
  'Failed to parse session config',
  'Modal:',
  'hasNoBodyWrapper',
  'aria-label',
  'aria-labelledby',
];

// Patterns to suppress in console.log
const suppressedLogPatterns = [
  '[Chat]',
  '[RuntimeConfig]',
];

console.error = (...args: any[]) => {
  const message = args[0]?.toString() || '';
  if (suppressedErrorPatterns.some(pattern => message.includes(pattern))) {
    return;
  }
  originalError.call(console, ...args);
};

console.warn = (...args: any[]) => {
  const message = args[0]?.toString() || '';
  if (suppressedWarnPatterns.some(pattern => message.includes(pattern))) {
    return;
  }
  originalWarn.call(console, ...args);
};

console.log = (...args: any[]) => {
  const message = args[0]?.toString() || '';
  if (suppressedLogPatterns.some(pattern => message.includes(pattern))) {
    return;
  }
  originalLog.call(console, ...args);
};

console.debug = (...args: any[]) => {
  const message = args[0]?.toString() || '';
  if (message.includes('[Chat]')) {
    return;
  }
  originalDebug.call(console, ...args);
};

// Restore original console methods after all tests complete
afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
  console.log = originalLog;
  console.debug = originalDebug;
});
