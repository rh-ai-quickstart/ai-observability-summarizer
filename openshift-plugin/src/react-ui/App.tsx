import * as React from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import '@patternfly/react-core/dist/styles/base.css';
import Layout from './Layout';
import AIObservabilityPage from '../core/pages/AIObservabilityPage';
import VLLMMetricsPage from '../core/pages/VLLMMetricsPage';
import { OpenShiftMetricsPage } from '../core/pages/OpenShiftMetricsPage';
import { AIChatPage } from '../core/pages/AIChatPage';

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
