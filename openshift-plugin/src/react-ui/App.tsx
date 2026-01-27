import * as React from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import '@patternfly/react-core/dist/styles/base.css';
import Layout from './Layout';
import AIObservabilityPage from '../core/pages/AIObservabilityPage';
import VLLMMetricsPage from '../core/pages/VLLMMetricsPage';
import { OpenShiftMetricsPage } from '../core/pages/OpenShiftMetricsPage';
import { AIChatPage } from '../core/pages/AIChatPage';
import { initializeRuntimeConfig } from '../core/services/runtimeConfig';

const App: React.FC = () => {
  // Initialize runtime config on mount (fetch DEV_MODE from MCP server)
  React.useEffect(() => {
    initializeRuntimeConfig().catch(error => {
      console.error('[App] Failed to initialize runtime config:', error);
    });
  }, []);

  // Clear session config on app initialization in dev mode (simulates sessionStorage behavior)
  React.useEffect(() => {
    const clearSessionConfigInDev = async () => {
      // Wait for runtime config to load first
      await initializeRuntimeConfig();
      
      // Import these functions after runtime config is loaded
      const { isDevMode } = await import('../core/services/runtimeConfig');
      const { clearSessionConfig } = await import('../core/services/mcpClient');
      
      if (isDevMode()) {
        console.log('[App] Dev mode detected - clearing session config on app load');
        clearSessionConfig();
      }
    };

    clearSessionConfigInDev().catch(error => {
      console.error('[App] Failed to clear session config:', error);
    });
  }, []);

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
