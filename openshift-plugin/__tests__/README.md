# OpenShift AI Observability Plugin - Tests

## Overview

This directory contains unit tests for the OpenShift AI Observability Console Plugin React components.

## Test Framework

- **Jest** - Test runner and assertion library
- **React Testing Library** - Component testing utilities
- **ts-jest** - TypeScript support for Jest

## Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run tests with coverage report
yarn test:coverage
```

## Test Structure

**Mirrored Directory Structure** - Tests mirror the `src/` directory structure:

```
openshift-plugin/
├── src/
│   ├── hooks/
│   │   ├── useChatHistory.ts
│   │   └── useProgressIndicator.ts
│   ├── components/
│   │   └── SuggestedQuestions.tsx
│   └── services/
│       └── mcpClient.ts
│
└── __tests__/                    # Test directory at root level
    ├── setupTests.ts              # Global test setup
    ├── __mocks__/
    │   └── fileMock.js            # Mock for static assets
    ├── README.md                  # This file
    ├── hooks/                     # Mirrors src/hooks/
    │   ├── useChatHistory.test.ts
    │   └── useProgressIndicator.test.ts
    ├── components/                # Mirrors src/components/
    │   └── SuggestedQuestions.test.tsx
    └── services/                  # Mirrors src/services/
        └── mcpClient.test.ts
```

This structure follows the Python/Java testing convention where tests are separated from source code but maintain the same directory structure.

## Test Coverage

### Hooks

**useChatHistory.test.ts** - Tests for chat history management
- ✅ Initialize with greeting message
- ✅ Load/save messages from/to localStorage
- ✅ Debounced save (500ms)
- ✅ Clear history
- ✅ Limit to 50 messages
- ✅ Export to markdown
- ✅ Handle corrupted localStorage
- ✅ Preserve progressLog when saving/loading

**useProgressIndicator.test.ts** - Tests for progress indicator
- ✅ Start with empty message
- ✅ Cycle through progress messages (2s interval)
- ✅ Expected message patterns
- ✅ Stop rotating and clear message
- ✅ Multiple start/stop cycles
- ✅ Cleanup interval on unmount
- ✅ Prevent multiple intervals

### Components

**SuggestedQuestions.test.tsx** - Tests for suggested questions component
- ✅ Render all 8 questions
- ✅ Click handler invocation
- ✅ Expandable section toggle
- ✅ Collapsed state
- ✅ Icons rendering
- ✅ Hover states
- ✅ Grid layout

### Services

**mcpClient.test.ts** - Tests for MCP client
- ✅ Session config (save/retrieve/clear)
- ✅ Chat request with correct parameters
- ✅ Response with/without progress log
- ✅ Plain text vs JSON responses
- ✅ HTTP and MCP errors
- ✅ Namespace and scope parameters
- ✅ API key inclusion
- ✅ URL selection (local dev vs production)
- ✅ Different response formats (array/object/string)

## Coverage Goals

Current coverage thresholds (see `jest.config.js`):
- Statements: 50%
- Branches: 40%
- Functions: 50%
- Lines: 50%

To view detailed coverage report:
```bash
yarn test:coverage
# Open htmlcov/index.html in browser
```

## Writing New Tests

### Testing a Hook

```typescript
import { renderHook, act } from '@testing-library/react';
import { useYourHook } from '../../src/hooks/useYourHook';

describe('useYourHook', () => {
  it('should do something', () => {
    const { result } = renderHook(() => useYourHook());

    act(() => {
      result.current.someFunction();
    });

    expect(result.current.someValue).toBe('expected');
  });
});
```

**Note:** Import paths use `../../src/` to reference source files from the mirrored test directory.

### Testing a Component

```typescript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { YourComponent } from '../../src/components/YourComponent';

describe('YourComponent', () => {
  it('should render correctly', () => {
    render(<YourComponent />);

    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('should handle user interaction', () => {
    const mockHandler = jest.fn();
    render(<YourComponent onClick={mockHandler} />);

    fireEvent.click(screen.getByRole('button'));

    expect(mockHandler).toHaveBeenCalled();
  });
});
```

### Mocking fetch

```typescript
global.fetch = jest.fn();

beforeEach(() => {
  (global.fetch as jest.Mock).mockClear();
});

it('should call API', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: 'test' }),
  });

  // Your test code
});
```

## Debugging Tests

### Run specific test file
```bash
yarn test hooks/useChatHistory.test.ts
```

### Run specific test case
```bash
yarn test -t "should save messages to localStorage"
```

### Debug with console.log
Console output is visible in test results by default.

### Update snapshots
```bash
yarn test -u
```

## CI/CD Integration

Tests can be integrated into CI/CD pipelines:
```yaml
- name: Run tests
  run: |
    cd openshift-plugin
    yarn install
    yarn test --ci --coverage
```

## Best Practices

1. **Arrange-Act-Assert** - Structure tests clearly
2. **Mock external dependencies** - Keep tests isolated
3. **Test user behavior** - Not implementation details
4. **Clear test names** - Describe what is being tested
5. **One assertion per test** - When possible
6. **Clean up** - Use beforeEach/afterEach
7. **Avoid test interdependence** - Each test should run independently
8. **Mirror directory structure** - Makes it easy to find corresponding tests

## Common Issues

### "Cannot find module" errors
- Ensure all dependencies are installed: `yarn install`
- Check moduleNameMapper in jest.config.js
- Verify import paths use `../../src/` from test files

### Timer-related test failures
- Use `jest.useFakeTimers()` and `jest.advanceTimersByTime()`
- Clean up with `jest.useRealTimers()` in afterEach

### localStorage is not defined
- Already mocked in setupTests.ts
- Clear between tests with `localStorage.clear()`

### Component not rendering
- Check if all required props are provided
- Verify PatternFly CSS is not causing issues (mocked by identity-obj-proxy)
