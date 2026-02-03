import * as React from 'react';
import {
  Alert,
  AlertVariant,
  AlertActionLink,
  Button,
} from '@patternfly/react-core';
import { useSettings } from '../hooks/useSettings';

interface ConfigurationRequiredAlertProps {
  /** Whether to show the close button */
  showClose?: boolean;
  /** Callback when alert is closed */
  onClose?: () => void;
  /** Custom message (optional, defaults to standard message) */
  message?: string;
  /** Whether to show as inline alert (default: true) */
  isInline?: boolean;
  /** Auto-dismiss when AI model is configured (default: true) */
  autoDismiss?: boolean;
}

export const ConfigurationRequiredAlert: React.FC<ConfigurationRequiredAlertProps> = ({
  showClose = true,
  onClose,
  message = "Please configure an AI model in Settings first. Click \"Open Settings\" to configure your AI model.",
  isInline = true,
  autoDismiss = true,
}) => {
  const { handleOpenSettings, useAIConfigWarningDismissal } = useSettings();

  // Auto-dismiss when AI model is configured
  if (autoDismiss && onClose) {
    useAIConfigWarningDismissal('CONFIGURATION_REQUIRED', onClose);
  }

  return (
    <Alert
      variant={AlertVariant.warning}
      title="Configuration Required"
      isInline={isInline}
      actionLinks={<AlertActionLink onClick={handleOpenSettings}>Open Settings</AlertActionLink>}
      actionClose={showClose && onClose ? <Button variant="plain" onClick={onClose}>✕</Button> : undefined}
    >
      {message}
    </Alert>
  );
};