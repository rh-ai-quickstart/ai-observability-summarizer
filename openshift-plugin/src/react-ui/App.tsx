import * as React from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import '@patternfly/react-core/dist/styles/base.css';
import Layout from './Layout';
import AIObservabilityPage from '../core/pages/AIObservabilityPage';
import { initializeRuntimeConfig } from '../core/services/runtimeConfig';
import { getGpuAvailability } from '../core/services/mcpClient';

const App: React.FC = () => {
  const [configLoaded, setConfigLoaded] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState(0);
  const [gpuAvailable, setGpuAvailable] = React.useState<boolean | undefined>(undefined);

  // Initialize runtime config on mount and wait for it to complete
  React.useEffect(() => {
    const loadConfig = async () => {
      try {
        await initializeRuntimeConfig();
        setConfigLoaded(true);
      } catch (error) {
        console.error('[App] Failed to initialize runtime config:', error);
        // Still render the app even if config fails
        setConfigLoaded(true);
      }
    };

    loadConfig();
  }, []);

  // Fetch GPU availability
  React.useEffect(() => {
    getGpuAvailability()
      .then(setGpuAvailable)
      .catch((error) => {
        console.error('Failed to check GPU availability:', error);
        setGpuAvailable(false); // Safe default on error
      });
  }, []);

  // Don't render until config is loaded to prevent race conditions
  if (!configLoaded) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div>Loading configuration...</div>
        <div style={{ fontSize: '12px', color: '#666' }}>Fetching dev mode settings from MCP server</div>
      </div>
    );
  }

  return (
    <Router>
      <Layout activeTab={activeTab} onTabChange={setActiveTab} gpuAvailable={gpuAvailable}>
        <Switch>
          <Route exact path="/">
            <AIObservabilityPage activeTab={activeTab} onTabChange={setActiveTab} />
          </Route>
          <Redirect from="*" to="/" />
        </Switch>
      </Layout>
    </Router>
  );
};

export default App;
