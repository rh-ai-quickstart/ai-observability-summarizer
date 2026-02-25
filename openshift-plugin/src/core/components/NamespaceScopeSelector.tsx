import * as React from 'react';
import {
  Flex,
  FlexItem,
  Label,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import { ClusterIcon, CubeIcon } from '@patternfly/react-icons';
import { NamespaceDropdown } from './NamespaceDropdown';
import { ChatScope } from '../data/namespaceDefaults';

export interface NamespaceScopeSelectorProps {
  scope: ChatScope;
  namespace: string | null;
  onScopeChange: (scope: ChatScope, namespace: string | null) => void;
}

export const NamespaceScopeSelector: React.FC<NamespaceScopeSelectorProps> = ({
  scope,
  namespace,
  onScopeChange,
}) => {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  const handleClusterWideClick = () => {
    onScopeChange('cluster_wide', null);
  };

  const handleNamespaceClick = () => {
    onScopeChange('namespace_scoped', null);
    setDropdownOpen(true);
  };

  const handleNamespaceSelect = (selectedNamespace: string) => {
    onScopeChange('namespace_scoped', selectedNamespace);
    setDropdownOpen(false);
  };

  const handleClearNamespace = () => {
    onScopeChange('namespace_scoped', null);
  };

  return (
    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
      <FlexItem>
        <ToggleGroup aria-label="Scope selection">
          <ToggleGroupItem
            text="Cluster-wide"
            icon={<ClusterIcon />}
            buttonId="scope-cluster-wide"
            isSelected={scope === 'cluster_wide'}
            onChange={handleClusterWideClick}
            aria-label="Cluster-wide scope"
          />
          <ToggleGroupItem
            text="Namespace"
            icon={<CubeIcon />}
            buttonId="scope-namespace"
            isSelected={scope === 'namespace_scoped'}
            onChange={handleNamespaceClick}
            aria-label="Namespace scope"
          />
        </ToggleGroup>
      </FlexItem>
      {scope === 'namespace_scoped' && (
        <FlexItem>
          <NamespaceDropdown
            selectedNamespace={namespace}
            onSelect={handleNamespaceSelect}
            isOpen={dropdownOpen}
            onToggle={setDropdownOpen}
          />
        </FlexItem>
      )}
      {scope === 'namespace_scoped' && namespace && (
        <FlexItem>
          <Label
            color="blue"
            onClose={handleClearNamespace}
          >
            {namespace}
          </Label>
        </FlexItem>
      )}
    </Flex>
  );
};
