import * as React from 'react';
import { Nav, NavList, NavItem } from '@patternfly/react-core';
import {
  TachometerAltIcon,
  ServerIcon,
  CubeIcon,
  CubesIcon,
  CommentIcon,
} from '@patternfly/react-icons';

interface NavigationProps {
  activeTab: number;
  onTabChange: (tabIndex: number) => void;
  gpuAvailable?: boolean | undefined;
}

const Navigation: React.FC<NavigationProps> = ({ activeTab, onTabChange, gpuAvailable }) => {
  const allNavItems = [
    {
      id: 'overview',
      title: 'Overview',
      tabIndex: 0,
      icon: <TachometerAltIcon />,
      requiresGpu: false,
    },
    {
      id: 'vllm',
      title: 'vLLM Metrics',
      tabIndex: 1,
      icon: <ServerIcon />,
      requiresGpu: true,
    },
    {
      id: 'devices',
      title: 'Hardware Accelerators',
      tabIndex: 2,
      icon: <CubeIcon />,
      requiresGpu: true,
    },
    {
      id: 'openshift',
      title: 'OpenShift',
      tabIndex: 3,
      icon: <CubesIcon />,
      requiresGpu: false,
    },
    {
      id: 'chat',
      title: 'Chat with Prometheus',
      tabIndex: 4,
      icon: <CommentIcon />,
      requiresGpu: false,
    },
  ];

  // Filter out GPU-related tabs when GPU is not available
  const navItems = gpuAvailable === true
    ? allNavItems
    : allNavItems.filter(item => !item.requiresGpu);

  return (
    <Nav aria-label="AI Observability Navigation" theme="dark">
      <NavList>
        {navItems.map((item) => (
          <NavItem
            key={item.id}
            itemId={item.id}
            isActive={activeTab === item.tabIndex}
            onClick={() => onTabChange(item.tabIndex)}
          >
            {item.icon && (
              <span style={{ marginRight: '8px' }}>{item.icon}</span>
            )}
            {item.title}
          </NavItem>
        ))}
      </NavList>
    </Nav>
  );
};

export default Navigation;
