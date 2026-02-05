import * as React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Nav, NavList, NavItem } from '@patternfly/react-core';
import {
  TachometerAltIcon,
  ServerIcon,
  CubeIcon,
  CubesIcon,
  CommentIcon,
} from '@patternfly/react-icons';

const Navigation: React.FC = () => {
  const history = useHistory();
  const location = useLocation();

  const navItems = [
    {
      id: 'overview',
      title: 'Overview',
      path: '/',
      icon: <TachometerAltIcon />,
    },
    {
      id: 'vllm',
      title: 'vLLM Metrics',
      path: '/vllm',
      icon: <ServerIcon />,
    },
    {
      id: 'devices',
      title: 'Hardware Accelerators',
      path: '/devices',
      icon: <CubeIcon />,
    },
    {
      id: 'openshift',
      title: 'OpenShift',
      path: '/openshift',
      icon: <CubesIcon />,
    },
    {
      id: 'chat',
      title: 'AI Chat',
      path: '/chat',
      icon: <CommentIcon />,
    },
  ];

  const getActiveItem = () => {
    const item = navItems.find((item) => {
      if (item.path === '/') {
        return location.pathname === '/';
      }
      return location.pathname.startsWith(item.path);
    });
    return item ? item.id : 'overview';
  };

  return (
    <Nav aria-label="AI Observability Navigation" theme="dark">
      <NavList>
        {navItems.map((item) => (
          <NavItem
            key={item.id}
            itemId={item.id}
            isActive={getActiveItem() === item.id}
            onClick={() => history.push(item.path)}
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
