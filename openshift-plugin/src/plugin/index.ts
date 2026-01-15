/**
 * Console Plugin Entry Point
 * Exports modules for OpenShift Console dynamic plugin
 */

// Export page components for console
export { default as AIObservabilityPage } from '../core/pages/AIObservabilityPage';
export { default as VLLMMetricsPage } from '../core/pages/VLLMMetricsPage';
export { default as OpenShiftMetricsPage } from '../core/pages/OpenShiftMetricsPage';
export { default as AIChatPage } from '../core/pages/AIChatPage';
