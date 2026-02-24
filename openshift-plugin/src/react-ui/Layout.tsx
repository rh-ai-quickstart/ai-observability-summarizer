import * as React from 'react';
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
  Button,
} from '@patternfly/react-core';
import { BarsIcon } from '@patternfly/react-icons';
import Navigation from './Navigation';

interface LayoutProps {
  children: React.ReactNode;
  activeTab?: number;
  onTabChange?: (tabIndex: number) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activeTab = 0, onTabChange = () => {} }) => {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);

  const onSidebarToggle = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const Header = (
    <Masthead>
      <MastheadToggle>
        <Button
          variant="plain"
          onClick={onSidebarToggle}
          aria-label="Toggle navigation"
        >
          <BarsIcon />
        </Button>
      </MastheadToggle>
      <MastheadMain>
        <MastheadBrand href="/">
          <div style={{ color: 'white', fontSize: '20px', fontWeight: 'bold' }}>
            OpenShift AI Observability
          </div>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        {/* Future: Add user menu, settings, notifications, etc. */}
      </MastheadContent>
    </Masthead>
  );

  const Sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen}>
      <PageSidebarBody>
        <Navigation activeTab={activeTab} onTabChange={onTabChange} />
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
