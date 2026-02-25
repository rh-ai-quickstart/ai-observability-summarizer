/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NamespaceScopeSelector } from '../../src/core/components/NamespaceScopeSelector';
import { listOpenShiftNamespaces } from '../../src/core/services/mcpClient';

jest.mock('../../src/core/services/mcpClient', () => ({
  listOpenShiftNamespaces: jest.fn(),
}));

const mockListOpenShiftNamespaces = listOpenShiftNamespaces as jest.MockedFunction<typeof listOpenShiftNamespaces>;

describe('NamespaceScopeSelector', () => {
  const mockOnScopeChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockListOpenShiftNamespaces.mockResolvedValue([
      'my-app',
      'monitoring',
      'default',
      'openshift-operators',
    ]);
  });

  it('should render both toggle buttons', () => {
    render(
      <NamespaceScopeSelector
        scope="cluster_wide"
        namespace={null}
        onScopeChange={mockOnScopeChange}
      />
    );

    expect(screen.getByText('Cluster-wide')).toBeInTheDocument();
    expect(screen.getByText('Namespace')).toBeInTheDocument();
  });

  it('should have Cluster-wide selected by default', () => {
    render(
      <NamespaceScopeSelector
        scope="cluster_wide"
        namespace={null}
        onScopeChange={mockOnScopeChange}
      />
    );

    const clusterButton = screen.getByRole('button', { name: /Cluster-wide scope/i });
    expect(clusterButton).toHaveClass('pf-m-selected');
  });

  it('should call onScopeChange when Namespace is clicked', () => {
    render(
      <NamespaceScopeSelector
        scope="cluster_wide"
        namespace={null}
        onScopeChange={mockOnScopeChange}
      />
    );

    const namespaceButton = screen.getByRole('button', { name: /Namespace scope/i });
    fireEvent.click(namespaceButton);

    expect(mockOnScopeChange).toHaveBeenCalledWith('namespace_scoped', null);
  });

  it('should call onScopeChange when Cluster-wide is clicked', () => {
    render(
      <NamespaceScopeSelector
        scope="namespace_scoped"
        namespace={null}
        onScopeChange={mockOnScopeChange}
      />
    );

    const clusterButton = screen.getByRole('button', { name: /Cluster-wide scope/i });
    fireEvent.click(clusterButton);

    expect(mockOnScopeChange).toHaveBeenCalledWith('cluster_wide', null);
  });

  it('should show namespace dropdown when scope is namespace_scoped', async () => {
    render(
      <NamespaceScopeSelector
        scope="namespace_scoped"
        namespace={null}
        onScopeChange={mockOnScopeChange}
      />
    );

    // The NamespaceDropdown component should be rendered when scope is namespace_scoped
    await waitFor(() => {
      // The toggle group should show Namespace as selected
      const namespaceButton = screen.getByRole('button', { name: /Namespace scope/i });
      expect(namespaceButton).toHaveClass('pf-m-selected');
    });
  });

  it('should show selected namespace label', () => {
    const { container } = render(
      <NamespaceScopeSelector
        scope="namespace_scoped"
        namespace="my-app"
        onScopeChange={mockOnScopeChange}
      />
    );

    // Verify the PatternFly Label element contains the namespace text
    const label = container.querySelector('.pf-v5-c-label');
    expect(label).toBeInTheDocument();
    expect(label).toHaveTextContent('my-app');
  });

  it('should clear namespace when label close button is clicked', () => {
    render(
      <NamespaceScopeSelector
        scope="namespace_scoped"
        namespace="my-app"
        onScopeChange={mockOnScopeChange}
      />
    );

    // PatternFly Label with onClose renders a close button with aria-label "Close <label>"
    const closeButton = screen.getByRole('button', { name: /Close my-app/i });
    fireEvent.click(closeButton);

    expect(mockOnScopeChange).toHaveBeenCalledWith('namespace_scoped', null);
  });
});
