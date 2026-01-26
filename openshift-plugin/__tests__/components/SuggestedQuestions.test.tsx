import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SuggestedQuestions } from '../../src/core/components/SuggestedQuestions';

describe('SuggestedQuestions', () => {
  const mockOnSelectQuestion = jest.fn();

  beforeEach(() => {
    mockOnSelectQuestion.mockClear();
  });

  it('should render all 8 suggested questions', () => {
    render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
      />
    );

    // Check for specific question labels (exact match to avoid duplicates)
    expect(screen.getByText('GPU Utilization')).toBeInTheDocument();
    expect(screen.getByText('Performance Issues')).toBeInTheDocument();
    expect(screen.getByText('vLLM Health')).toBeInTheDocument();
    expect(screen.getByText('CPU & Memory Trends')).toBeInTheDocument();
    expect(screen.getByText('Resource Consumers')).toBeInTheDocument();
    expect(screen.getByText('Latency & Queue')).toBeInTheDocument();
    expect(screen.getByText('Cache Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Alerts & Anomalies')).toBeInTheDocument();
  });

  it('should call onSelectQuestion when a question is clicked', () => {
    render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
      />
    );

    // Find and click the first question card (PatternFly clickable Cards)
    const gpuCard = screen.getByText('GPU Utilization').closest('.pf-v5-c-card');
    fireEvent.click(gpuCard!);

    expect(mockOnSelectQuestion).toHaveBeenCalledTimes(1);
    expect(mockOnSelectQuestion).toHaveBeenCalledWith(expect.stringContaining('GPU'));
  });

  it('should render correct number of questions', () => {
    const { container } = render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
      />
    );

    const questionCards = container.querySelectorAll('.pf-v5-c-card');
    expect(questionCards).toHaveLength(8);
  });

  it('should show expandable section header', () => {
    render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
      />
    );

    expect(screen.getByText('Hide suggested questions')).toBeInTheDocument();
  });

  it('should call onToggle when expandable section is clicked', () => {
    const mockOnToggle = jest.fn();
    render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={mockOnToggle}
      />
    );

    // Find the expandable section toggle button
    const toggleButton = screen.getByText('Hide suggested questions');
    fireEvent.click(toggleButton);

    expect(mockOnToggle).toHaveBeenCalledWith(false); // Should toggle to false when currently expanded
  });

  it('should change toggle button text when collapsed', () => {
    const { rerender } = render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
      />
    );

    // Initially expanded - should show "Hide" text
    expect(screen.getByText('Hide suggested questions')).toBeInTheDocument();
    expect(screen.queryByText('Show suggested questions')).not.toBeInTheDocument();

    // Rerender with isExpanded=false
    rerender(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={false}
        onToggle={jest.fn()}
      />
    );

    // When collapsed, should show "Show" text
    expect(screen.getByText('Show suggested questions')).toBeInTheDocument();
    expect(screen.queryByText('Hide suggested questions')).not.toBeInTheDocument();
  });

  it('should display appropriate icons for each question', () => {
    const { container } = render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
      />
    );

    // Check that SVG icons are rendered (PatternFly icons render as SVG)
    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
  });

  it('should have clickable cards with hover state', () => {
    const { container } = render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
      />
    );

    const questionCards = container.querySelectorAll('.pf-v5-c-card');
    const firstCard = questionCards[0] as HTMLElement;

    // Card should have cursor pointer style (indicating clickable)
    expect(firstCard).toHaveStyle({ cursor: 'pointer' });
  });

  it('should render questions in a grid layout', () => {
    const { container } = render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
      />
    );

    // Check for Grid component (should have pf-v5-l-grid class or similar)
    const gridElement = container.querySelector('[class*="grid"]');
    expect(gridElement).toBeInTheDocument();
  });
});
