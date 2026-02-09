/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConfigurationRequiredAlert } from '../../src/core/components/ConfigurationRequiredAlert';

// Mock the useSettings hook
jest.mock('../../src/core/hooks/useSettings', () => ({
  useSettings: () => ({
    handleOpenSettings: jest.fn(),
    useAIConfigWarningDismissal: jest.fn(),
    AI_CONFIG_WARNING: 'AI_CONFIG_REQUIRED',
  }),
}));

describe('ConfigurationRequiredAlert', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the configuration required alert', () => {
    render(<ConfigurationRequiredAlert onClose={mockOnClose} />);

    expect(screen.getByText('Configuration Required')).toBeInTheDocument();
    expect(screen.getByText(/Please configure an AI model in Settings first/)).toBeInTheDocument();
    expect(screen.getByText('Open Settings')).toBeInTheDocument();
  });

  it('shows close button by default', () => {
    render(<ConfigurationRequiredAlert onClose={mockOnClose} />);

    expect(screen.getByRole('button', { name: /✕/ })).toBeInTheDocument();
  });

  it('can hide close button when showClose is false', () => {
    render(<ConfigurationRequiredAlert onClose={mockOnClose} showClose={false} />);

    expect(screen.queryByRole('button', { name: /✕/ })).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<ConfigurationRequiredAlert onClose={mockOnClose} />);

    const closeButton = screen.getByRole('button', { name: /✕/ });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('renders custom message when provided', () => {
    const customMessage = 'Custom configuration message';
    render(<ConfigurationRequiredAlert onClose={mockOnClose} message={customMessage} />);

    expect(screen.getByText(customMessage)).toBeInTheDocument();
  });

  it('renders as warning variant alert', () => {
    const { container } = render(<ConfigurationRequiredAlert onClose={mockOnClose} />);

    // Check for warning alert styling (PatternFly v5 uses specific classes for warning variants)
    const alert = container.querySelector('.pf-v5-c-alert');
    expect(alert).toHaveClass('pf-m-warning');
  });

  it('renders as inline alert by default', () => {
    const { container } = render(<ConfigurationRequiredAlert onClose={mockOnClose} />);

    const alert = container.querySelector('.pf-v5-c-alert');
    expect(alert).toHaveClass('pf-m-inline');
  });

  it('can render as non-inline alert', () => {
    const { container } = render(<ConfigurationRequiredAlert onClose={mockOnClose} isInline={false} />);

    const alert = container.querySelector('.pf-v5-c-alert');
    expect(alert).not.toHaveClass('pf-m-inline');
  });

  it('has Open Settings action link', () => {
    render(<ConfigurationRequiredAlert onClose={mockOnClose} />);

    const openSettingsLink = screen.getByRole('button', { name: 'Open Settings' });
    expect(openSettingsLink).toBeInTheDocument();
    expect(openSettingsLink).toHaveClass('pf-v5-c-button', 'pf-m-link');
  });
});