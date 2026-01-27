/**
 * Custom hook for settings-related functionality
 */
export const useSettings = () => {
  const handleOpenSettings = () => {
    window.dispatchEvent(new CustomEvent('open-settings'));
  };

  return {
    handleOpenSettings,
  };
};