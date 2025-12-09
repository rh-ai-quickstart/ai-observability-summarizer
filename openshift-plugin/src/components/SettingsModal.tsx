import * as React from 'react';
import AIModelSettings from './AIModelSettings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  return (
    <AIModelSettings
      isOpen={isOpen}
      onClose={onClose}
      onSave={onSave ? (selectedModel: string) => onSave() : undefined}
    />
  );
};

export default SettingsModal;
