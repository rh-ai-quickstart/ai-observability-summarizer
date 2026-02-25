import * as React from 'react';
import {
  MenuToggle,
  Menu,
  MenuContent,
  MenuList,
  MenuItem,
  SearchInput,
  Switch,
  Spinner,
  Alert,
  AlertVariant,
  Popper,
} from '@patternfly/react-core';
import { listOpenShiftNamespaces } from '../services/mcpClient';
import { isDefaultNamespace } from '../data/namespaceDefaults';

export interface NamespaceDropdownProps {
  selectedNamespace: string | null;
  onSelect: (namespace: string) => void;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
}

export const NamespaceDropdown: React.FC<NamespaceDropdownProps> = ({
  selectedNamespace,
  onSelect,
  isOpen,
  onToggle,
}) => {
  const [namespaces, setNamespaces] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [searchValue, setSearchValue] = React.useState('');
  const [showDefaults, setShowDefaults] = React.useState(false);
  const [focusedIndex, setFocusedIndex] = React.useState<number>(-1);
  const loadedRef = React.useRef(false);
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const filteredNamespaces = React.useMemo(
    () =>
      namespaces
        .filter((ns) => showDefaults || !isDefaultNamespace(ns))
        .filter((ns) => ns.toLowerCase().includes(searchValue.toLowerCase())),
    [namespaces, showDefaults, searchValue],
  );

  React.useEffect(() => {
    let isCancelled = false;
    if (isOpen && !loadedRef.current) {
      const doLoad = async () => {
        setLoading(true);
        setError(null);
        try {
          const result = await listOpenShiftNamespaces();
          if (isCancelled) return;
          loadedRef.current = true;
          if (result.length === 0) {
            setError('No namespaces found');
          } else {
            setNamespaces(result);
          }
        } catch (e) {
          if (isCancelled) return;
          setError(e instanceof Error ? e.message : 'Failed to load namespaces');
        } finally {
          if (!isCancelled) {
            setLoading(false);
          }
        }
      };
      doLoad();
    }
    return () => { isCancelled = true; };
  }, [isOpen]);

  // Auto-focus search input when dropdown opens
  React.useEffect(() => {
    if (isOpen) {
      setFocusedIndex(-1);
      // Delay focus slightly to ensure the Popper has rendered
      const timer = setTimeout(() => {
        // SearchInput wraps a div; find the actual <input> inside
        const input = menuRef.current?.querySelector('input[aria-label="Filter namespaces"]') as HTMLInputElement
          ?? document.querySelector('input[aria-label="Filter namespaces"]') as HTMLInputElement;
        input?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        toggleRef.current && !toggleRef.current.contains(target)
      ) {
        onToggle(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onToggle]);

  // Reset focused index when filtered list changes
  React.useEffect(() => {
    setFocusedIndex(-1);
  }, [searchValue, showDefaults]);

  // Scroll focused item into view
  React.useEffect(() => {
    if (focusedIndex >= 0 && menuRef.current) {
      const items = menuRef.current.querySelectorAll('[role="menuitem"]');
      if (items[focusedIndex]) {
        items[focusedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;

      if (event.key === 'Escape') {
        onToggle(false);
        return;
      }

      // Only handle arrow/enter keys when focus is within the dropdown
      const isWithinDropdown = menuRef.current?.contains(document.activeElement) ||
                                toggleRef.current?.contains(document.activeElement);
      if (!isWithinDropdown) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedIndex((prev) => {
          const max = filteredNamespaces.length - 1;
          return prev < max ? prev + 1 : 0;
        });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedIndex((prev) => {
          const max = filteredNamespaces.length - 1;
          return prev > 0 ? prev - 1 : max;
        });
      } else if (event.key === 'Enter' && focusedIndex >= 0 && focusedIndex < filteredNamespaces.length) {
        event.preventDefault();
        onSelect(filteredNamespaces[focusedIndex]);
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onToggle, focusedIndex, filteredNamespaces, onSelect]);

  const toggle = (
    <MenuToggle
      ref={toggleRef}
      onClick={() => onToggle(!isOpen)}
      isExpanded={isOpen}
      aria-label="Namespace dropdown toggle"
      style={{ width: '100%' }}
    >
      {selectedNamespace || 'Select namespace'}
    </MenuToggle>
  );

  const menu = (
    <Menu
      ref={menuRef}
      aria-label="Namespace menu"
      style={{
        width: '300px',
        maxHeight: '400px',
        backgroundColor: 'var(--pf-v5-global--BackgroundColor--100)',
      }}
    >
      <MenuContent>
        <div style={{ padding: '8px 12px' }}>
          <SearchInput
            placeholder="Filter namespaces..."
            value={searchValue}
            onChange={(_event, value) => setSearchValue(value)}
            onClear={() => setSearchValue('')}
            aria-label="Filter namespaces"
          />
        </div>
        <div
          style={{
            padding: '4px 12px 8px 12px',
            borderBottom: '1px solid var(--pf-v5-global--BorderColor--100)',
          }}
        >
          <Switch
            id="show-default-namespaces"
            label="Show default namespaces"
            isChecked={showDefaults}
            onChange={(_event, checked) => setShowDefaults(checked)}
            aria-label="Show default namespaces"
          />
        </div>
        {loading ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '24px',
            }}
          >
            <Spinner size="lg" aria-label="Loading namespaces" />
          </div>
        ) : error ? (
          <div style={{ padding: '8px 12px' }}>
            <Alert
              variant={AlertVariant.danger}
              title="Error loading namespaces"
              isInline
            >
              {error}
            </Alert>
          </div>
        ) : (
          <MenuList
            style={{
              maxHeight: '250px',
              overflowY: 'auto',
            }}
          >
            {filteredNamespaces.length === 0 ? (
              <MenuItem
                isDisabled
                key="no-results"
                style={{
                  color: 'var(--pf-v5-global--Color--200)',
                  fontStyle: 'italic',
                }}
              >
                No namespaces match the filter
              </MenuItem>
            ) : (
              filteredNamespaces.map((ns, index) => {
                const isSelected = ns === selectedNamespace;
                const isFocused = index === focusedIndex;
                return (
                  <MenuItem
                    key={ns}
                    onClick={() => onSelect(ns)}
                    aria-label={`Namespace ${ns}`}
                    isSelected={isSelected}
                    isFocused={isFocused}
                    style={{
                      cursor: 'pointer',
                      backgroundColor: isSelected
                        ? 'var(--pf-v5-global--active-color--100)'
                        : isFocused
                          ? 'var(--pf-v5-global--BackgroundColor--light-300)'
                          : 'var(--pf-v5-global--BackgroundColor--100)',
                      color: isSelected
                        ? 'var(--pf-v5-global--BackgroundColor--100)'
                        : 'inherit',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    onMouseEnter={() => setFocusedIndex(index)}
                    onMouseLeave={() => setFocusedIndex(-1)}
                  >
                    {ns}
                  </MenuItem>
                );
              })
            )}
          </MenuList>
        )}
      </MenuContent>
    </Menu>
  );

  return (
    <Popper
      trigger={toggle}
      popper={menu}
      isVisible={isOpen}
      appendTo={() => document.body}
    />
  );
};
