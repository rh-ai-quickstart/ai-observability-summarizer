# Dual Deployment Implementation Plan
## OpenShift AI Observability - Console Plugin + React UI

**Target:** OpenShift Platform Only
**Model:** Dual Deployment (Support both Console Plugin AND React UI)
**Date:** 2026-01-14
**Status:** Implementation Proposal - Awaiting Review

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Directory Structure](#directory-structure)
3. [Implementation Phases](#implementation-phases)
4. [Detailed File Changes](#detailed-file-changes)
5. [Build System](#build-system)
6. [Deployment Models](#deployment-models)
7. [Authentication & Authorization](#authentication--authorization)
8. [Testing Strategy](#testing-strategy)
9. [Migration Path](#migration-path)
10. [Risks & Mitigation](#risks--mitigation)

---

## Architecture Overview

### Design Principles

1. **Shared Core Components** - All UI components, pages, hooks, and services live in a shared `src/core/` directory
2. **Two Entry Points** - Separate entry points for console plugin and react-ui modes
3. **Zero Code Duplication** - Both modes use identical core components
4. **Build-Time Selection** - Webpack builds different bundles for each mode
5. **Runtime Compatibility** - Components detect and adapt to their environment

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                   OpenShift AI Observability                     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Shared Core (src/core/)                 │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  Components  │  Pages  │  Hooks  │  Services        │ │   │
│  │  │  - AIModelSettings                                   │ │   │
│  │  │  - SettingsModal                                     │ │   │
│  │  │  - AlertList                                         │ │   │
│  │  │  - CategorySection                                   │ │   │
│  │  │  - MetricCard                                        │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│              ┌───────────────┴───────────────┐                  │
│              │                               │                  │
│   ┌──────────▼──────────┐       ┌───────────▼──────────┐       │
│   │  Console Plugin     │       │  React UI App      │       │
│   │  (src/plugin/)      │       │  (src/react-ui/)   │       │
│   │                     │       │                      │       │
│   │  - index.ts         │       │  - App.tsx           │       │
│   │  - console-         │       │  - index.tsx         │       │
│   │    extensions.json  │       │  - Layout.tsx        │       │
│   │                     │       │  - Navigation.tsx    │       │
│   │  Exports modules    │       │  Full app shell      │       │
│   │  for Console        │       │  with PatternFly     │       │
│   └─────────────────────┘       └──────────────────────┘       │
│              │                               │                  │
│   ┌──────────▼──────────┐       ┌───────────▼──────────┐       │
│   │ OpenShift Console   │       │  Nginx Container     │       │
│   │ (Dynamic Plugin)    │       │  (Static SPA)        │       │
│   └─────────────────────┘       └──────────────────────┘       │
│              │                               │                  │
│              └───────────────┬───────────────┘                  │
│                              │                                   │
│                   ┌──────────▼──────────┐                       │
│                   │   MCP Server        │                       │
│                   │   (Port 8085)       │                       │
│                   └─────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

### Key Characteristics

| Aspect | Console Plugin Mode | React UI Mode |
|--------|---------------------|-----------------|
| **Entry Point** | `src/plugin/index.ts` | `src/react-ui/index.tsx` |
| **Routing** | OpenShift Console Router | React Router v5 |
| **Navigation** | Console navigation items | Custom PatternFly Nav |
| **Layout** | Console Page wrapper | Custom Page component |
| **URL Base** | `/observe/ai-observability` | `/` |
| **Authentication** | OpenShift Console OAuth | OpenShift OAuth Proxy |
| **Deployment** | ConsolePlugin CR | Deployment + Route |
| **Backend Proxy** | Console proxy service | Nginx proxy or direct |

---

## Directory Structure

### Current Structure (Before Changes)

```
openshift-plugin/
├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── services/
│   └── styles/
├── console-extensions.json
├── package.json
├── webpack.config.ts
└── Dockerfile
```

### Proposed Structure (After Changes)

```
openshift-plugin/
├── src/
│   ├── core/                              # Shared components (NEW)
│   │   ├── components/                    # Moved from src/components
│   │   │   ├── AIModelSettings/
│   │   │   ├── SettingsModal.tsx
│   │   │   ├── AlertList.tsx
│   │   │   └── index.ts
│   │   ├── pages/                         # Moved from src/pages
│   │   │   ├── AIObservabilityPage.tsx
│   │   │   ├── VLLMMetricsPage.tsx
│   │   │   ├── OpenShiftMetricsPage.tsx
│   │   │   ├── AIChatPage.tsx
│   │   │   └── index.ts
│   │   ├── hooks/                         # Moved from src/hooks
│   │   │   ├── useChatHistory.ts
│   │   │   └── useProgressIndicator.ts
│   │   ├── services/                      # Moved from src/services
│   │   │   └── mcpClient.ts
│   │   └── styles/                        # Moved from src/styles
│   │       └── chat-markdown.css
│   │
│   ├── plugin/                            # Console plugin wrapper (NEW)
│   │   ├── index.ts                       # Plugin entry point
│   │   └── console-extensions.json        # Moved from root
│   │
│   ├── react-ui/                         # React UI app wrapper (NEW)
│   │   ├── App.tsx                        # Main app component
│   │   ├── index.tsx                      # App entry point
│   │   ├── Layout.tsx                     # Page layout shell
│   │   └── Navigation.tsx                 # Nav component
│   │
│   └── shared/                            # Shared utilities (NEW)
│       ├── config.ts                      # Environment config
│       └── types.ts                       # Shared TypeScript types
│
├── public/                                # Static assets (NEW)
│   ├── index.html                         # HTML template for React UI
│   └── favicon.ico
│
├── deploy/
│   └── helm/
│       ├── openshift-console-plugin/      # Existing console plugin chart
│       │   ├── Chart.yaml
│       │   ├── values.yaml
│       │   └── templates/
│       │       ├── deployment.yaml
│       │       ├── consoleplugin.yaml
│       │       └── service.yaml
│       │
│       └── react-ui-app/                # New React UI chart (NEW)
│           ├── Chart.yaml
│           ├── values.yaml
│           └── templates/
│               ├── deployment.yaml
│               ├── service.yaml
│               ├── route.yaml
│               ├── configmap.yaml         # Nginx config
│               └── serviceaccount.yaml
│
├── config/                                # Build configs (NEW)
│   ├── webpack.plugin.ts                  # Console plugin build
│   ├── webpack.react-ui.ts              # React UI build
│   └── webpack.common.ts                  # Shared config
│
├── nginx/                                 # Nginx configs (NEW)
│   ├── nginx.conf                         # Main config
│   └── default.conf                       # Server config
│
├── Dockerfile.plugin                      # Plugin image (RENAMED)
├── Dockerfile.react-ui                  # React UI image (NEW)
├── package.json                           # Updated scripts
├── tsconfig.json
└── README.md                              # Updated docs
```

### File Movement Summary

| Current Location | New Location | Action |
|-----------------|--------------|--------|
| `src/components/` | `src/core/components/` | Move |
| `src/pages/` | `src/core/pages/` | Move |
| `src/hooks/` | `src/core/hooks/` | Move |
| `src/services/` | `src/core/services/` | Move |
| `src/styles/` | `src/core/styles/` | Move |
| `console-extensions.json` | `src/plugin/console-extensions.json` | Move |
| `webpack.config.ts` | `config/webpack.plugin.ts` | Move & Split |
| `Dockerfile` | `Dockerfile.plugin` | Rename |
| - | `src/plugin/index.ts` | Create |
| - | `src/react-ui/*` | Create |
| - | `public/*` | Create |
| - | `config/webpack.react-ui.ts` | Create |
| - | `Dockerfile.react-ui` | Create |
| - | `deploy/helm/react-ui-app/` | Create |

---

## Implementation Phases

### Phase 1: Repository Restructuring (Week 1)

**Goal:** Reorganize codebase without breaking existing functionality

**Tasks:**
1. Create new directory structure
2. Move files to `src/core/`
3. Update all import paths in core components
4. Create `src/shared/config.ts` for environment detection
5. Test that console plugin still builds and works

**Deliverables:**
- Restructured directory tree
- Updated import statements
- Passing build with no errors
- Console plugin still functional

**Files Changed:**
- All files in `src/` (import path updates)
- New directories created

**Validation:**
```bash
yarn build         # Should succeed
yarn test          # Should pass
# Deploy to test cluster - should work as before
```

### Phase 2: React UI Application Shell (Week 2)

**Goal:** Create react-ui app wrapper with full UI shell

**Tasks:**
1. Create `src/react-ui/App.tsx` with PatternFly layout
2. Create `src/react-ui/Layout.tsx` with Masthead/Sidebar
3. Create `src/react-ui/Navigation.tsx` for nav items
4. Create `src/react-ui/index.tsx` as entry point
5. Create `public/index.html` template
6. Update core pages to work in both modes

**Deliverables:**
- React UI app shell
- Navigation component
- HTML template
- Environment-aware page components

**Files Created:**
- `src/react-ui/App.tsx`
- `src/react-ui/Layout.tsx`
- `src/react-ui/Navigation.tsx`
- `src/react-ui/index.tsx`
- `public/index.html`

**Validation:**
```bash
# Manual testing of React UI routes
```

### Phase 3: Dual Build System (Week 3)

**Goal:** Configure Webpack to build both plugin and react-ui bundles

**Tasks:**
1. Split `webpack.config.ts` into three files:
   - `config/webpack.common.ts` (shared config)
   - `config/webpack.plugin.ts` (console plugin)
   - `config/webpack.react-ui.ts` (React UI)
2. Update `package.json` scripts
3. Configure separate output directories
4. Add HTML plugin for React UI
5. Configure dev server for React UI

**Deliverables:**
- Three webpack configs
- Updated package.json scripts
- Separate build outputs

**Files Created/Modified:**
- `config/webpack.common.ts`
- `config/webpack.plugin.ts`
- `config/webpack.react-ui.ts`
- `package.json` (scripts section)

**New Scripts:**
```json
{
  "scripts": {
    "build:plugin": "webpack --config config/webpack.plugin.ts",
    "build:react-ui": "webpack --config config/webpack.react-ui.ts",
    "build:all": "yarn build:plugin && yarn build:react-ui",
    "start:plugin": "webpack serve --config config/webpack.plugin.ts",
    "start:react-ui": "webpack serve --config config/webpack.react-ui.ts"
  }
}
```

**Validation:**
```bash
yarn build:plugin      # Builds plugin bundle
yarn build:react-ui  # Builds react-ui bundle
yarn start:react-ui  # Runs React UI dev server
```

### Phase 4: React UI Deployment (Week 4)

**Goal:** Create Helm chart and Docker image for react-ui deployment

**Tasks:**
1. Create `Dockerfile.react-ui` with nginx
2. Create nginx configuration for SPA routing
3. Create Helm chart `deploy/helm/react-ui-app/`
4. Configure OpenShift Route for external access
5. Add ConfigMap for nginx config
6. Configure OAuth proxy sidecar

**Deliverables:**
- Dockerfile for React UI
- Nginx configuration
- Complete Helm chart
- OAuth proxy integration

**Files Created:**
- `Dockerfile.react-ui`
- `nginx/nginx.conf`
- `nginx/default.conf`
- `deploy/helm/react-ui-app/Chart.yaml`
- `deploy/helm/react-ui-app/values.yaml`
- `deploy/helm/react-ui-app/templates/*.yaml`

**Validation:**
```bash
make build-react-ui
make install-react-ui
# Access via OpenShift Route
```

### Phase 5: Documentation & Testing (Week 5)

**Goal:** Complete documentation and end-to-end testing

**Tasks:**
1. Update README.md with dual deployment instructions
2. Create deployment comparison guide
3. Create migration guide
4. End-to-end testing of both modes
5. Update CI/CD pipelines
6. Create troubleshooting guide

**Deliverables:**
- Updated documentation
- Deployment guides
- Test coverage
- CI/CD updates

**Files Created/Modified:**
- `README.md`
- `docs/DEPLOYMENT_GUIDE.md`
- `docs/MIGRATION_GUIDE.md`
- `.github/workflows/*` (if using GitHub Actions)

---

## Detailed File Changes

### 1. Configuration Management

**File:** `src/shared/config.ts` (NEW)

```typescript
/**
 * Environment configuration for dual deployment mode
 */

export interface AppConfig {
  mode: 'plugin' | 'react-ui';
  mcpServerUrl: string;
  apiTimeout: number;
  enableDebug: boolean;
}

// Detect deployment mode
export const getDeploymentMode = (): 'plugin' | 'react-ui' => {
  // Check if running in console plugin context
  if (typeof window !== 'undefined') {
    // Console plugin runs under /observe/ai-observability path
    const isPluginContext = window.location.pathname.startsWith('/observe/ai-observability');
    // Also check for console plugin API
    const hasConsoleAPI = !!(window as any).OPENSHIFT_CONSOLE_PLUGIN_API;

    if (isPluginContext || hasConsoleAPI) {
      return 'plugin';
    }
  }
  return 'react-ui';
};

// MCP Server URL resolution
export const getMcpServerUrl = (): string => {
  const mode = getDeploymentMode();

  if (typeof window === 'undefined') {
    return '/mcp';
  }

  const isLocalDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';

  if (isLocalDev) {
    return 'http://localhost:8085/mcp';
  }

  if (mode === 'plugin') {
    // Console plugin uses console proxy
    return '/api/proxy/plugin/openshift-ai-observability/mcp/mcp';
  } else {
    // React UI uses direct proxy or nginx proxy
    return '/api/mcp';
  }
};

export const config: AppConfig = {
  mode: getDeploymentMode(),
  mcpServerUrl: getMcpServerUrl(),
  apiTimeout: 30000,
  enableDebug: process.env.NODE_ENV === 'development',
};

export default config;
```

### 2. Plugin Entry Point

**File:** `src/plugin/index.ts` (NEW)

```typescript
/**
 * Console Plugin Entry Point
 * Exports modules for OpenShift Console dynamic plugin
 */

import type { EncodedExtension } from '@openshift/dynamic-plugin-sdk';
import type { ResourcesObject } from './console-extensions';

// Export page components for console
export { default as AIObservabilityPage } from '../core/pages/AIObservabilityPage';
export { default as VLLMMetricsPage } from '../core/pages/VLLMMetricsPage';
export { default as OpenShiftMetricsPage } from '../core/pages/OpenShiftMetricsPage';
export { default as AIChatPage } from '../core/pages/AIChatPage';

// Load console extensions
const extensions: EncodedExtension[] = require('./console-extensions.json');

export default extensions;
```

**File:** `src/plugin/console-extensions.json` (MOVED)

```json
[
  {
    "type": "console.navigation/href",
    "properties": {
      "id": "ai-observability",
      "perspective": "admin",
      "section": "observe",
      "name": "%plugin__openshift-ai-observability~AI Observability%",
      "href": "/observe/ai-observability"
    }
  },
  {
    "type": "console.page/route",
    "properties": {
      "exact": true,
      "path": "/observe/ai-observability",
      "component": {
        "$codeRef": "AIObservabilityPage"
      }
    }
  },
  {
    "type": "console.page/route",
    "properties": {
      "exact": false,
      "path": "/observe/ai-observability/vllm",
      "component": {
        "$codeRef": "VLLMMetricsPage"
      }
    }
  },
  {
    "type": "console.page/route",
    "properties": {
      "exact": false,
      "path": "/observe/ai-observability/openshift",
      "component": {
        "$codeRef": "OpenShiftMetricsPage"
      }
    }
  },
  {
    "type": "console.page/route",
    "properties": {
      "exact": false,
      "path": "/observe/ai-observability/chat",
      "component": {
        "$codeRef": "AIChatPage"
      }
    }
  }
]
```

### 3. React UI App Shell

**File:** `src/react-ui/App.tsx` (NEW)

```typescript
import React from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import '@patternfly/react-core/dist/styles/base.css';
import Layout from './Layout';
import AIObservabilityPage from '../core/pages/AIObservabilityPage';
import VLLMMetricsPage from '../core/pages/VLLMMetricsPage';
import OpenShiftMetricsPage from '../core/pages/OpenShiftMetricsPage';
import AIChatPage from '../core/pages/AIChatPage';

const App: React.FC = () => {
  return (
    <Router>
      <Layout>
        <Switch>
          <Route exact path="/" component={AIObservabilityPage} />
          <Route path="/vllm" component={VLLMMetricsPage} />
          <Route path="/openshift" component={OpenShiftMetricsPage} />
          <Route path="/chat" component={AIChatPage} />
          <Redirect from="/overview" to="/" />
        </Switch>
      </Layout>
    </Router>
  );
};

export default App;
```

**File:** `src/react-ui/Layout.tsx` (NEW)

```typescript
import React from 'react';
import {
  Page,
  Masthead,
  MastheadToggle,
  MastheadMain,
  MastheadBrand,
  MastheadContent,
  PageSidebar,
  PageSidebarBody,
  PageSection,
} from '@patternfly/react-core';
import { BarsIcon } from '@patternfly/react-icons';
import Navigation from './Navigation';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);

  const onSidebarToggle = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const Header = (
    <Masthead>
      <MastheadToggle>
        <button onClick={onSidebarToggle} aria-label="Toggle navigation">
          <BarsIcon />
        </button>
      </MastheadToggle>
      <MastheadMain>
        <MastheadBrand href="/">
          <div style={{ color: 'white', fontSize: '20px', fontWeight: 'bold' }}>
            OpenShift AI Observability
          </div>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        {/* Future: Add user menu, settings, etc. */}
      </MastheadContent>
    </Masthead>
  );

  const Sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen}>
      <PageSidebarBody>
        <Navigation />
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page header={Header} sidebar={Sidebar}>
      <PageSection>{children}</PageSection>
    </Page>
  );
};

export default Layout;
```

**File:** `src/react-ui/Navigation.tsx` (NEW)

```typescript
import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Nav, NavList, NavItem } from '@patternfly/react-core';

const Navigation: React.FC = () => {
  const history = useHistory();
  const location = useLocation();

  const navItems = [
    { id: 'overview', title: 'Overview', path: '/' },
    { id: 'vllm', title: 'vLLM Metrics', path: '/vllm' },
    { id: 'openshift', title: 'Cluster Metrics', path: '/openshift' },
    { id: 'chat', title: 'AI Chat', path: '/chat' },
  ];

  const getActiveItem = () => {
    const item = navItems.find(item => item.path === location.pathname);
    return item ? item.id : 'overview';
  };

  return (
    <Nav aria-label="AI Observability Navigation">
      <NavList>
        {navItems.map(item => (
          <NavItem
            key={item.id}
            itemId={item.id}
            isActive={getActiveItem() === item.id}
            onClick={() => history.push(item.path)}
          >
            {item.title}
          </NavItem>
        ))}
      </NavList>
    </Nav>
  );
};

export default Navigation;
```

**File:** `src/react-ui/index.tsx` (NEW)

```typescript
import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
```

### 4. HTML Template

**File:** `public/index.html` (NEW)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#000000" />
    <meta
      name="description"
      content="OpenShift AI Observability - Monitor and analyze AI/ML workloads"
    />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <title>OpenShift AI Observability</title>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this application.</noscript>
    <div id="root"></div>
  </body>
</html>
```

### 5. Webpack Configurations

**File:** `config/webpack.common.ts` (NEW)

```typescript
import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';

export const commonConfig = {
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    alias: {
      '@core': path.resolve(__dirname, '../src/core'),
      '@shared': path.resolve(__dirname, '../src/shared'),
    },
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, '../locales'),
          to: 'locales',
        },
      ],
    }),
  ],
};
```

**File:** `config/webpack.plugin.ts` (NEW)

```typescript
import path from 'path';
import { Configuration } from 'webpack';
import { ConsoleRemotePlugin } from '@openshift-console/dynamic-plugin-sdk-webpack';
import { commonConfig } from './webpack.common';

const config: Configuration = {
  ...commonConfig,
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  entry: {
    plugin: path.resolve(__dirname, '../src/plugin/index.ts'),
  },
  output: {
    path: path.resolve(__dirname, '../dist/plugin'),
    filename: '[name]-bundle.js',
    chunkFilename: '[name]-chunk.js',
  },
  plugins: [
    ...(commonConfig.plugins || []),
    new ConsoleRemotePlugin(),
  ],
  devServer: {
    port: 9001,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
    },
  },
};

export default config;
```

**File:** `config/webpack.react-ui.ts` (NEW)

```typescript
import path from 'path';
import { Configuration } from 'webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { commonConfig } from './webpack.common';

const config: Configuration = {
  ...commonConfig,
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  entry: {
    app: path.resolve(__dirname, '../src/react-ui/index.tsx'),
  },
  output: {
    path: path.resolve(__dirname, '../dist/react-ui'),
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/[name].[contenthash:8].chunk.js',
    publicPath: '/',
  },
  plugins: [
    ...(commonConfig.plugins || []),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '../public/index.html'),
      inject: true,
    }),
  ],
  devServer: {
    port: 3000,
    historyApiFallback: true,
    proxy: {
      '/api/mcp': {
        target: 'http://localhost:8085',
        pathRewrite: { '^/api/mcp': '/mcp' },
        changeOrigin: true,
      },
    },
  },
};

export default config;
```

### 6. Update MCP Client

**File:** `src/core/services/mcpClient.ts` (MODIFY)

```typescript
// Update imports to use new config
import config from '../../shared/config';

// Replace MCP_SERVER_URL logic with config
const MCP_SERVER_URL = config.mcpServerUrl;

// Rest of file remains the same
```

### 7. Docker Images

**File:** `Dockerfile.plugin` (RENAMED from Dockerfile)

```dockerfile
# Build stage
FROM node:18 AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build:plugin

# Runtime stage
FROM registry.access.redhat.com/ubi9/nginx-120:latest
COPY --from=builder /app/dist/plugin /usr/share/nginx/html
USER 1001
EXPOSE 9443
CMD ["nginx", "-g", "daemon off;"]
```

**File:** `Dockerfile.react-ui` (NEW)

```dockerfile
# Build stage
FROM node:18 AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build:react-ui

# Runtime stage
FROM registry.access.redhat.com/ubi9/nginx-120:latest

# Copy built assets
COPY --from=builder /app/dist/react-ui /usr/share/nginx/html

# Copy nginx configuration
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Set permissions
USER 1001

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
```

### 8. Nginx Configuration

**File:** `nginx/default.conf` (NEW)

```nginx
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json application/javascript;

    # SPA routing: serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    # Proxy MCP server requests
    location /api/mcp/ {
        proxy_pass http://mcp-server-svc:8085/mcp/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Cache static assets
    location ~* \.(?:css|js|jpg|jpeg|gif|png|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

---

## Deployment Models

### Model 1: Console Plugin Deployment (Existing)

**Use Case:** Integrated experience within OpenShift Console

**Deployment:**
```bash
cd deploy/helm/openshift-console-plugin
helm install ai-obs-plugin . -n openshift-ai-observability
```

**Access:**
- Navigate to OpenShift Console
- Observe → AI Observability

**Architecture:**
```
User → OpenShift Console → Console Plugin (Module Federation) → MCP Server
```

**Authentication:** OpenShift Console OAuth

**URL:** `https://console.openshift.com/observe/ai-observability`

---

### Model 2: React UI Deployment (New)

**Use Case:** Direct access without console, dedicated UI

**Deployment:**
```bash
cd deploy/helm/react-ui-app
helm install ai-obs-react-ui . -n openshift-ai-observability
```

**Access:**
- Navigate to dedicated Route
- Direct URL access

**Architecture:**
```
User → OpenShift Route → OAuth Proxy → Nginx (SPA) → MCP Server
```

**Authentication:** OpenShift OAuth Proxy (sidecar)

**URL:** `https://ai-observability.apps.cluster.example.com`

---

### React UI Helm Chart

**File:** `deploy/helm/react-ui-app/Chart.yaml` (NEW)

```yaml
apiVersion: v2
name: openshift-aiobs-react-ui
description: OpenShift AI Observability - React UI Web Application
type: application
version: 1.0.0
appVersion: "1.0.0"
keywords:
  - openshift
  - ai
  - observability
  - vllm
  - monitoring
maintainers:
  - name: OpenShift AI Observability Team
```

**File:** `deploy/helm/react-ui-app/values.yaml` (NEW)

```yaml
# Application configuration
app:
  name: "ai-observability-ui"
  replicas: 2
  image:
    repository: "quay.io/ecosystem-appeng/aiobs-react-ui"
    tag: "latest"
    pullPolicy: Always

  port: 8080

  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 128Mi

# Service configuration
service:
  type: ClusterIP
  port: 8080
  targetPort: 8080

# Route configuration (OpenShift)
route:
  enabled: true
  host: ""  # Auto-generated if empty
  tls:
    enabled: true
    termination: edge
    insecureEdgeTerminationPolicy: Redirect

# OAuth Proxy (for authentication)
oauth:
  enabled: true
  image:
    repository: "quay.io/openshift/origin-oauth-proxy"
    tag: "4.14"
  port: 8443

  # OpenShift OAuth client configuration
  client:
    id: "ai-observability-proxy"
    secret: ""  # Auto-generated if empty

  # Cookie configuration
  cookieSecret: ""  # Auto-generated if empty
  cookieExpire: "24h"

# MCP Server connection
mcpServer:
  serviceName: "mcp-server-svc"
  port: 8085
  namespace: "openshift-ai-observability"

# Service Account
serviceAccount:
  create: true
  name: "ai-observability-ui"
  annotations: {}

# Security Context
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  fsGroup: 1001
```

**File:** `deploy/helm/react-ui-app/templates/deployment.yaml` (NEW)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Values.app.name }}
  namespace: {{ .Release.Namespace }}
  labels:
    app: {{ .Values.app.name }}
    app.kubernetes.io/name: {{ .Values.app.name }}
    app.kubernetes.io/component: ui
spec:
  replicas: {{ .Values.app.replicas }}
  selector:
    matchLabels:
      app: {{ .Values.app.name }}
  template:
    metadata:
      labels:
        app: {{ .Values.app.name }}
    spec:
      serviceAccountName: {{ .Values.serviceAccount.name }}
      securityContext:
        {{- toYaml .Values.securityContext | nindent 8 }}

      containers:
      {{- if .Values.oauth.enabled }}
      # OAuth Proxy sidecar
      - name: oauth-proxy
        image: "{{ .Values.oauth.image.repository }}:{{ .Values.oauth.image.tag }}"
        ports:
        - containerPort: {{ .Values.oauth.port }}
          name: https
          protocol: TCP
        args:
        - --https-address=:{{ .Values.oauth.port }}
        - --provider=openshift
        - --openshift-service-account={{ .Values.serviceAccount.name }}
        - --upstream=http://localhost:{{ .Values.app.port }}
        - --tls-cert=/etc/tls/private/tls.crt
        - --tls-key=/etc/tls/private/tls.key
        - --cookie-secret={{ .Values.oauth.cookieSecret | default (randAlphaNum 32 | b64enc) }}
        - --cookie-expire={{ .Values.oauth.cookieExpire }}
        - --skip-auth-regex=^/health
        volumeMounts:
        - name: proxy-tls
          mountPath: /etc/tls/private
      {{- end }}

      # Main application container
      - name: ui
        image: "{{ .Values.app.image.repository }}:{{ .Values.app.image.tag }}"
        imagePullPolicy: {{ .Values.app.image.pullPolicy }}
        ports:
        - containerPort: {{ .Values.app.port }}
          name: http
          protocol: TCP

        livenessProbe:
          httpGet:
            path: /
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10

        readinessProbe:
          httpGet:
            path: /
            port: http
          initialDelaySeconds: 5
          periodSeconds: 5

        resources:
          {{- toYaml .Values.app.resources | nindent 10 }}

        env:
        - name: MCP_SERVER_URL
          value: "http://{{ .Values.mcpServer.serviceName }}.{{ .Values.mcpServer.namespace }}.svc.cluster.local:{{ .Values.mcpServer.port }}/mcp"

      volumes:
      {{- if .Values.oauth.enabled }}
      - name: proxy-tls
        secret:
          secretName: {{ .Values.app.name }}-proxy-tls
      {{- end }}
```

**File:** `deploy/helm/react-ui-app/templates/service.yaml` (NEW)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Values.app.name }}
  namespace: {{ .Release.Namespace }}
  labels:
    app: {{ .Values.app.name }}
  annotations:
    service.beta.openshift.io/serving-cert-secret-name: {{ .Values.app.name }}-proxy-tls
spec:
  type: {{ .Values.service.type }}
  ports:
  {{- if .Values.oauth.enabled }}
  - name: https
    port: {{ .Values.oauth.port }}
    targetPort: {{ .Values.oauth.port }}
    protocol: TCP
  {{- end }}
  - name: http
    port: {{ .Values.service.port }}
    targetPort: {{ .Values.service.targetPort }}
    protocol: TCP
  selector:
    app: {{ .Values.app.name }}
```

**File:** `deploy/helm/react-ui-app/templates/route.yaml` (NEW)

```yaml
{{- if .Values.route.enabled }}
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: {{ .Values.app.name }}
  namespace: {{ .Release.Namespace }}
  labels:
    app: {{ .Values.app.name }}
spec:
  {{- if .Values.route.host }}
  host: {{ .Values.route.host }}
  {{- end }}
  to:
    kind: Service
    name: {{ .Values.app.name }}
    weight: 100
  port:
    targetPort: {{ if .Values.oauth.enabled }}https{{ else }}http{{ end }}
  {{- if .Values.route.tls.enabled }}
  tls:
    termination: {{ .Values.route.tls.termination }}
    insecureEdgeTerminationPolicy: {{ .Values.route.tls.insecureEdgeTerminationPolicy }}
  {{- end }}
{{- end }}
```

**File:** `deploy/helm/react-ui-app/templates/serviceaccount.yaml` (NEW)

```yaml
{{- if .Values.serviceAccount.create }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ .Values.serviceAccount.name }}
  namespace: {{ .Release.Namespace }}
  labels:
    app: {{ .Values.app.name }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
```

---

## Authentication & Authorization

### Console Plugin Mode

**Authentication:** Handled by OpenShift Console OAuth
**Authorization:** Uses OpenShift RBAC via Console
**Session:** Console session management

**No additional configuration needed** - inherits from console.

---

### React UI Mode

**Authentication:** OpenShift OAuth Proxy (sidecar container)
**Authorization:** OpenShift service account token validation
**Session:** OAuth proxy cookie (24h default)

**How it Works:**

```
1. User accesses Route → OAuth Proxy intercepts
2. OAuth Proxy redirects to OpenShift OAuth server
3. User logs in with OpenShift credentials
4. OAuth server validates and returns token
5. OAuth Proxy sets secure cookie
6. Future requests validated via cookie
7. OAuth Proxy forwards authenticated requests to UI
```

**Configuration:**

```yaml
# In values.yaml
oauth:
  enabled: true
  cookieExpire: "24h"
```

**Service Account Permissions:**

The service account needs permission to:
- Create subjectaccessreviews (token validation)
- Access MCP server service

**RBAC Configuration:**

```yaml
# Auto-created by OAuth proxy annotation
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ai-observability-ui
  annotations:
    serviceaccounts.openshift.io/oauth-redirectreference.primary: >
      {"kind":"OAuthRedirectReference","apiVersion":"v1","reference":{"kind":"Route","name":"ai-observability-ui"}}
```

---

## Testing Strategy

### Phase 1: Component Testing

**Goal:** Ensure core components work in both modes

**Tests:**
- Unit tests for all core components
- Mock different deployment modes in config
- Test page rendering in isolation

**Commands:**
```bash
yarn test
yarn test:coverage
```

### Phase 2: Integration Testing

**Goal:** Test plugin and react-ui builds

**Tests:**
- Build plugin bundle → verify output
- Build react-ui bundle → verify output
- Check bundle sizes
- Verify no console SDK in react-ui bundle

**Commands:**
```bash
yarn build:plugin
yarn build:react-ui
du -sh dist/plugin dist/react-ui
```

### Phase 3: Local Development Testing

**Goal:** Test dev servers for both modes

**Tests:**
- Start plugin dev server → verify in console
- Start React UI dev server → verify React UI
- Test hot reload in both modes
- Verify MCP connectivity

**Commands:**
```bash
# Terminal 1: Start MCP server
./scripts/local-dev.sh -n test-namespace

# Terminal 2: Test plugin
yarn start:plugin

# Terminal 3: Test React UI
yarn start:react-ui
```

### Phase 4: Deployment Testing

**Goal:** Test Helm deployments in OpenShift

**Tests:**
- Deploy plugin chart → verify in console
- Deploy React UI chart → verify route access
- Test OAuth flow in React UI
- Verify MCP connectivity from both
- Test resource limits
- Check logs for errors

**Commands:**
```bash
# Deploy plugin
helm install ai-obs-plugin deploy/helm/openshift-console-plugin -n test

# Deploy React UI
helm install ai-obs-react-ui deploy/helm/react-ui-app -n test

# Test access
oc get route -n test
curl -k https://$(oc get route ai-observability-ui -n test -o jsonpath='{.spec.host}')
```

### Phase 5: End-to-End Testing

**Goal:** Full user workflows in both modes

**Test Scenarios:**
1. Navigate to all pages (Overview, vLLM, OpenShift, Chat)
2. Filter metrics by namespace/model/time
3. Trigger AI analysis
4. Use AI Chat with questions
5. Configure AI models in settings
6. Verify data consistency between modes

**Tools:**
- Cypress for E2E tests
- Manual testing checklist

---

## Migration Path

### For Existing Plugin Users

**Scenario:** Already using console plugin, want to add React UI option

**Steps:**
1. Current plugin continues to work (no breaking changes)
2. Deploy React UI chart separately if desired
3. Both can coexist in same namespace
4. Users can choose which to use

**No migration required** - additive only.

---

### For New Deployments

**Decision Matrix:**

| Factor | Use Console Plugin | Use React UI |
|--------|-------------------|----------------|
| Access Pattern | Via OpenShift Console | Direct URL access |
| Integration | Prefer console integration | Prefer dedicated app |
| User Base | Console users | Non-console users |
| Branding | OpenShift branding | Custom branding possible |
| Complexity | Lower (no auth config) | Slightly higher |

**Recommendation:**
- **Default:** Console Plugin (simpler, integrated)
- **Alternative:** React UI (for direct access, dedicated workflows)
- **Both:** Deploy both for maximum flexibility

---

## Risks & Mitigation

### Risk 1: Import Path Changes

**Risk:** Moving files breaks all imports
**Impact:** High - won't build
**Likelihood:** High during refactor

**Mitigation:**
- Use automated find/replace for import updates
- Test build after each phase
- Use TypeScript compiler to catch errors
- Run full test suite after refactor

### Risk 2: Console SDK Hidden Dependencies

**Risk:** Core components secretly depend on console SDK
**Impact:** Medium - React UI won't work
**Likelihood:** Low (already checked, looks clean)

**Mitigation:**
- Audit all components for console imports
- Test each page in React UI early
- Create abstraction layer if dependencies found

### Risk 3: Routing Differences

**Risk:** Routes behave differently in plugin vs react-ui
**Impact:** Low - minor UX issues
**Likelihood:** Medium

**Mitigation:**
- Test all routes in both modes
- Use consistent path patterns
- Document any differences

### Risk 4: OAuth Proxy Configuration

**Risk:** OAuth proxy misconfigured, auth fails
**Impact:** High - can't access React UI
**Likelihood:** Medium (first time setup)

**Mitigation:**
- Test OAuth flow thoroughly
- Document configuration steps
- Provide troubleshooting guide
- Use well-tested oauth-proxy image

### Risk 5: Build Complexity

**Risk:** Two webpack configs hard to maintain
**Impact:** Medium - maintenance burden
**Likelihood:** Low (clean separation)

**Mitigation:**
- Extract common config
- Document build differences
- Add validation scripts
- CI/CD tests for both builds

### Risk 6: MCP Server Connectivity

**Risk:** Different proxy paths cause connection issues
**Impact:** High - app won't work
**Likelihood:** Medium

**Mitigation:**
- Test MCP connectivity early in both modes
- Use config.ts for URL management
- Add health checks
- Document network requirements

---

## Package.json Changes

### Updated Scripts

```json
{
  "scripts": {
    "clean": "rm -rf dist",
    "clean:plugin": "rm -rf dist/plugin",
    "clean:react-ui": "rm -rf dist/react-ui",

    "build": "yarn build:all",
    "build:all": "yarn clean && yarn build:plugin && yarn build:react-ui",
    "build:plugin": "yarn clean:plugin && NODE_ENV=production webpack --config config/webpack.plugin.ts",
    "build:react-ui": "yarn clean:react-ui && NODE_ENV=production webpack --config config/webpack.react-ui.ts",

    "start": "yarn start:react-ui",
    "start:plugin": "webpack serve --config config/webpack.plugin.ts",
    "start:react-ui": "webpack serve --config config/webpack.react-ui.ts",

    "lint": "eslint src --ext .ts,.tsx",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

### New Dependencies

```json
{
  "devDependencies": {
    "html-webpack-plugin": "^5.5.0"
  }
}
```

### TSConfig Updates

**File:** `tsconfig.json` (MODIFY)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@core/*": ["src/core/*"],
      "@shared/*": ["src/shared/*"],
      "@plugin/*": ["src/plugin/*"],
      "@react-ui/*": ["src/react-ui/*"]
    }
  }
}
```

---

## Makefile Updates

### New Targets

```makefile
# Existing plugin targets (renamed)
build-plugin:
	cd openshift-plugin && yarn build:plugin
	docker build -f openshift-plugin/Dockerfile.plugin -t $(PLUGIN_IMAGE) openshift-plugin

push-plugin:
	docker push $(PLUGIN_IMAGE)

install-plugin:
	helm upgrade --install ai-obs-plugin deploy/helm/openshift-console-plugin \
		-n $(NAMESPACE) --create-namespace

uninstall-plugin:
	helm uninstall ai-obs-plugin -n $(NAMESPACE)

# New React UI targets
build-react-ui:
	cd openshift-plugin && yarn build:react-ui
	docker build -f openshift-plugin/Dockerfile.react-ui -t $(REACT_UI_IMAGE) openshift-plugin

push-react-ui:
	docker push $(REACT_UI_IMAGE)

install-react-ui:
	helm upgrade --install ai-obs-react-ui deploy/helm/react-ui-app \
		-n $(NAMESPACE) --create-namespace

uninstall-react-ui:
	helm uninstall ai-obs-react-ui -n $(NAMESPACE)

# Build both
build-all: build-plugin build-react-ui

push-all: push-plugin push-react-ui

install-all: install-plugin install-react-ui

uninstall-all: uninstall-plugin uninstall-react-ui

# Local development
dev-plugin:
	cd openshift-plugin && yarn start:plugin

dev-react-ui:
	cd openshift-plugin && yarn start:react-ui
```

---

## Documentation Updates

### README.md Structure

```markdown
# OpenShift AI Observability

Monitor and analyze AI/ML workloads on OpenShift with intelligent observability.

## Deployment Options

This project supports **two deployment modes**:

### 1. Console Plugin (Default)
Integrated into OpenShift Console under Observe → AI Observability

### 2. React UI Application
Dedicated web application with its own URL

See [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) for details.

## Quick Start

### Console Plugin
```bash
make install-plugin
```

### React UI App
```bash
make install-react-ui
```

## Development

### Plugin Development
```bash
yarn start:plugin
```

### React UI Development
```bash
yarn start:react-ui
```
```

---

## Success Criteria

### Phase 1 Complete
- [ ] All files moved to `src/core/`
- [ ] All imports updated
- [ ] Plugin still builds successfully
- [ ] Plugin still works in console
- [ ] All tests pass

### Phase 2 Complete
- [ ] React UI app shell created
- [ ] Navigation component works
- [ ] All pages load in react-ui mode
- [ ] Routing works correctly

### Phase 3 Complete
- [ ] Plugin webpack config works
- [ ] React UI webpack config works
- [ ] Both build successfully
- [ ] Dev servers work for both
- [ ] No build errors or warnings

### Phase 4 Complete
- [ ] React UI Helm chart created
- [ ] OAuth proxy configured
- [ ] React UI deploys successfully
- [ ] Can access via OpenShift Route
- [ ] Authentication works

### Phase 5 Complete
- [ ] Documentation complete
- [ ] Both modes tested end-to-end
- [ ] No critical bugs
- [ ] Performance acceptable
- [ ] Ready for production

---

## Timeline

| Phase | Duration | Dependencies | Deliverable |
|-------|----------|--------------|-------------|
| Phase 1 | Week 1 | None | Restructured codebase |
| Phase 2 | Week 2 | Phase 1 | React UI app shell |
| Phase 3 | Week 3 | Phase 2 | Dual build system |
| Phase 4 | Week 4 | Phase 3 | React UI deployment |
| Phase 5 | Week 5 | Phase 4 | Complete docs & tests |

**Total:** 5 weeks

---

## Open Questions for Review

1. **Directory Structure:** Approve proposed `src/core/`, `src/plugin/`, `src/react-ui/` structure?

2. **OAuth Configuration:** Is 24h cookie expiration acceptable? Need custom timeout?

3. **Deployment Names:**
   - Plugin: `ai-obs-plugin`
   - React UI: `ai-obs-react-ui`
   - Acceptable naming?

4. **Route Hostname:** Auto-generate or require explicit configuration?

5. **Resource Limits:** Are proposed limits (500m CPU, 512Mi memory) appropriate?

6. **Build Scripts:** Prefer `build:all` as default or keep separate?

7. **Documentation:** Need additional docs beyond deployment guide?

8. **Testing:** Need Cypress E2E tests or manual testing sufficient?

9. **CI/CD:** Need to set up automated builds for both modes?

10. **Migration:** Should we deprecate plugin mode eventually or maintain both indefinitely?

---

## Next Steps

1. **Review this proposal** with stakeholders
2. **Answer open questions** above
3. **Get approval** to proceed
4. **Begin Phase 1** implementation
5. **Regular check-ins** after each phase

---

## Conclusion

This dual deployment implementation provides maximum flexibility:

- **Existing users** keep console plugin (no disruption)
- **New users** can choose based on needs
- **Shared codebase** minimizes maintenance
- **OpenShift native** leverages platform features (OAuth, Routes)
- **Clean architecture** separates concerns

The implementation is low-risk with clear phases and validation at each step.

**Recommendation:** Proceed with implementation

---

**Document Version:** 1.0
**Status:** Awaiting Review
**Next Review:** After stakeholder feedback
