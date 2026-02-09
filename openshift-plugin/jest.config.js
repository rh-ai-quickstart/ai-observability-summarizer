module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    // Handle CSS imports (CSS modules)
    '^.+\\.css$': 'identity-obj-proxy',
    // Handle static assets
    '\\.(jpg|jpeg|png|gif|svg)$': '<rootDir>/__tests__/__mocks__/fileMock.js',
  },
  // Transform ESM modules that Jest cannot parse natively
  transformIgnorePatterns: [
    'node_modules/(?!(remark-gfm|micromark-extension-gfm|ccount|escape-string-regexp|markdown-table|mdast-util-gfm|mdast-util-gfm-autolink-literal|mdast-util-gfm-footnote|mdast-util-gfm-strikethrough|mdast-util-gfm-table|mdast-util-gfm-task-list-item|mdast-util-find-and-replace|mdast-util-to-markdown|micromark-util-decode-numeric-character-reference|micromark-extension-gfm-autolink-literal|micromark-extension-gfm-footnote|micromark-extension-gfm-strikethrough|micromark-extension-gfm-table|micromark-extension-gfm-tagfilter|micromark-extension-gfm-task-list-item|micromark-util-combine-extensions|micromark-util-sanitize-uri|unified|bail|devlop|is-plain-obj|trough|vfile|vfile-message|unist-util-stringify-position|unist-util-is|unist-util-visit|unist-util-visit-parents)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setupTests.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.tsx',
    '!src/index.tsx',
  ],
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50,
    },
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
};
