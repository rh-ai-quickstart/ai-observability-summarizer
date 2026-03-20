/**
 * Event names for cross-component communication
 */
export const DEV_CACHE_CLEARED_EVENT = 'dev-cache-cleared';

/**
 * Helper to dispatch dev cache cleared event
 */
export function dispatchDevCacheClearedEvent(): void {
  window.dispatchEvent(new CustomEvent(DEV_CACHE_CLEARED_EVENT));
}
