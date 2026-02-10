import * as React from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import '@patternfly/react-core/dist/styles/base.css';
import Layout from './Layout';
import AIObservabilityPage from '../core/pages/AIObservabilityPage';
import VLLMMetricsPage from '../core/pages/VLLMMetricsPage';
import { OpenShiftMetricsPage } from '../core/pages/OpenShiftMetricsPage';
import { AIChatPage } from '../core/pages/AIChatPage';
import DeviceMetricsPage from '../core/pages/DeviceMetricsPage';
import { initializeRuntimeConfig } from '../core/services/runtimeConfig';

const App: React.FC = () => {
  const [configLoaded, setConfigLoaded] = React.useState(false);

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
      <Layout>
        <Switch>
          <Route exact path="/" component={AIObservabilityPage} />
          <Route path="/vllm" component={VLLMMetricsPage} />
          <Route path="/devices" component={DeviceMetricsPage} />
          <Route path="/openshift" component={OpenShiftMetricsPage} />
          <Route path="/chat" component={AIChatPage} />
          <Redirect from="/overview" to="/" />
        </Switch>
      </Layout>
    </Router>
  );
};

export default App;
