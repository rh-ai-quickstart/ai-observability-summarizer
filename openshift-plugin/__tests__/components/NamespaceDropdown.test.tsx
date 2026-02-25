/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NamespaceDropdown } from '../../src/core/components/NamespaceDropdown';

const mockListOpenShiftNamespaces = jest.fn();
jest.mock('../../src/core/services/mcpClient', () => ({
  listOpenShiftNamespaces: (...args: any[]) => mockListOpenShiftNamespaces(...args),
}));

const mockNamespaces = [
  'default',
  'kube-system',
  'kube-public',
  'my-app',
  'ml-serving',
  'openshift',
  'openshift-monitoring',
  'openshift-console',
  'vllm-prod',
];

describe('NamespaceDropdown', () => {
  const mockOnSelect = jest.fn();
  const mockOnToggle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should show spinner while loading namespaces', async () => {
    mockListOpenShiftNamespaces.mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <NamespaceDropdown
        selectedNamespace={null}
        onSelect={mockOnSelect}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    expect(screen.getByLabelText('Loading namespaces')).toBeInTheDocument();
  });

  it('should render namespace list after loading', async () => {
    mockListOpenShiftNamespaces.mockResolvedValueOnce(mockNamespaces);

    render(
      <NamespaceDropdown
        selectedNamespace={null}
        onSelect={mockOnSelect}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
      expect(screen.getByText('ml-serving')).toBeInTheDocument();
      expect(screen.getByText('vllm-prod')).toBeInTheDocument();
    });
  });

  it('should hide default namespaces by default', async () => {
    mockListOpenShiftNamespaces.mockResolvedValueOnce(mockNamespaces);

    render(
      <NamespaceDropdown
        selectedNamespace={null}
        onSelect={mockOnSelect}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
    });

    // User namespaces should be visible
    expect(screen.getByText('ml-serving')).toBeInTheDocument();
    expect(screen.getByText('vllm-prod')).toBeInTheDocument();

    // Default namespaces should NOT be visible
    expect(screen.queryByText('kube-system')).not.toBeInTheDocument();
    expect(screen.queryByText('kube-public')).not.toBeInTheDocument();
    expect(screen.queryByText('openshift-monitoring')).not.toBeInTheDocument();
    expect(screen.queryByText('openshift-console')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Namespace default')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Namespace openshift')).not.toBeInTheDocument();
  });

  it('should show default namespaces when toggle is enabled', async () => {
    mockListOpenShiftNamespaces.mockResolvedValueOnce(mockNamespaces);

    render(
      <NamespaceDropdown
        selectedNamespace={null}
        onSelect={mockOnSelect}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
    });

    // Click the switch to show default namespaces
    const toggle = screen.getByLabelText('Show default namespaces');
    await act(async () => {
      fireEvent.click(toggle);
    });

    // All namespaces should now be visible
    await waitFor(() => {
      expect(screen.getByText('kube-system')).toBeInTheDocument();
      expect(screen.getByText('kube-public')).toBeInTheDocument();
      expect(screen.getByText('openshift-monitoring')).toBeInTheDocument();
      expect(screen.getByText('openshift-console')).toBeInTheDocument();
      expect(screen.getByText('my-app')).toBeInTheDocument();
      expect(screen.getByText('ml-serving')).toBeInTheDocument();
      expect(screen.getByText('vllm-prod')).toBeInTheDocument();
    });
  });

  it('should filter namespaces by search input', async () => {
    mockListOpenShiftNamespaces.mockResolvedValueOnce(mockNamespaces);

    render(
      <NamespaceDropdown
        selectedNamespace={null}
        onSelect={mockOnSelect}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
    });

    // Type "ml" in the search input
    const searchInput = screen.getByLabelText('Filter namespaces');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'ml' } });
    });

    // Only ml-serving should remain
    await waitFor(() => {
      expect(screen.getByText('ml-serving')).toBeInTheDocument();
      expect(screen.queryByText('my-app')).not.toBeInTheDocument();
      expect(screen.queryByText('vllm-prod')).not.toBeInTheDocument();
    });
  });

  it('should call onSelect when a namespace is clicked', async () => {
    mockListOpenShiftNamespaces.mockResolvedValueOnce(mockNamespaces);

    render(
      <NamespaceDropdown
        selectedNamespace={null}
        onSelect={mockOnSelect}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('my-app'));
    });

    expect(mockOnSelect).toHaveBeenCalledWith('my-app');
  });

  it('should highlight the selected namespace', async () => {
    mockListOpenShiftNamespaces.mockResolvedValueOnce(mockNamespaces);

    render(
      <NamespaceDropdown
        selectedNamespace="my-app"
        onSelect={mockOnSelect}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    await waitFor(() => {
      // "my-app" appears in both the toggle and the menu list;
      // use aria-label to confirm the menu item rendered
      expect(screen.getByLabelText('Namespace my-app')).toBeInTheDocument();
    });

    // PatternFly MenuItem applies style to the <li> wrapper and aria-label
    // to the inner <button>. Use aria-label to find the button, then walk
    // up to the styled <li> to verify the selected visual distinction.
    const selectedButton = screen.getByLabelText('Namespace my-app');
    const menuItem = selectedButton.closest('li');
    const itemStyle = menuItem?.getAttribute('style') || '';
    expect(itemStyle).toContain('font-weight: 600');
  });
});
