import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SuggestedQuestions } from '../../src/core/components/SuggestedQuestions';

describe('SuggestedQuestions', () => {
  const mockOnSelectQuestion = jest.fn();

  beforeEach(() => {
    mockOnSelectQuestion.mockClear();
  });

  it('should render all 8 suggested questions when GPU is available', () => {
    render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
        gpuAvailable={true}
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

  it('should render only 4 non-GPU questions when GPU is not available', () => {
    render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
        gpuAvailable={false}
      />
    );

    // Check for non-GPU question labels
    expect(screen.getByText('Performance Issues')).toBeInTheDocument();
    expect(screen.getByText('CPU & Memory Trends')).toBeInTheDocument();
    expect(screen.getByText('Resource Consumers')).toBeInTheDocument();
    expect(screen.getByText('Alerts & Anomalies')).toBeInTheDocument();

    // GPU-related questions should not be present
    expect(screen.queryByText('GPU Utilization')).not.toBeInTheDocument();
    expect(screen.queryByText('vLLM Health')).not.toBeInTheDocument();
    expect(screen.queryByText('Latency & Queue')).not.toBeInTheDocument();
    expect(screen.queryByText('Cache Efficiency')).not.toBeInTheDocument();
  });

  it('should call onSelectQuestion when a question is clicked', () => {
    render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
        gpuAvailable={true}
      />
    );

    // Find and click the first question card (PatternFly clickable Cards)
    const gpuCard = screen.getByText('GPU Utilization').closest('.pf-v5-c-card');
    fireEvent.click(gpuCard!);

    expect(mockOnSelectQuestion).toHaveBeenCalledTimes(1);
    expect(mockOnSelectQuestion).toHaveBeenCalledWith(expect.stringContaining('GPU'));
  });

  it('should render correct number of questions with GPU', () => {
    const { container } = render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
        gpuAvailable={true}
      />
    );

    const questionCards = container.querySelectorAll('.pf-v5-c-card');
    expect(questionCards).toHaveLength(8);
  });

  it('should render correct number of questions without GPU', () => {
    const { container } = render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
        gpuAvailable={false}
      />
    );

    const questionCards = container.querySelectorAll('.pf-v5-c-card');
    expect(questionCards).toHaveLength(4);
  });

  it('should show expandable section header', () => {
    render(
      <SuggestedQuestions
        onSelectQuestion={mockOnSelectQuestion}
        isExpanded={true}
        onToggle={jest.fn()}
        gpuAvailable={true}
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
        gpuAvailable={true}
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
        gpuAvailable={true}
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
        gpuAvailable={true}
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
        gpuAvailable={true}
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
        gpuAvailable={true}
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
        gpuAvailable={true}
      />
    );

    // Check for Grid component (should have pf-v5-l-grid class or similar)
    const gridElement = container.querySelector('[class*="grid"]');
    expect(gridElement).toBeInTheDocument();
  });
});
