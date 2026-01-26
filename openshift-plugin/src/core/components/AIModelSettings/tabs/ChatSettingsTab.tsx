import * as React from 'react';
import {
  Form,
  FormGroup,
  Switch,
  TextInput,
  Button,
  Alert,
  AlertVariant,
  AlertActionLink,
  Divider,
  TextContent,
  Text,
  TextVariants,
  Radio,
} from '@patternfly/react-core';
import { ChatSettings } from '../../../hooks/useChatSettings';

interface ChatSettingsTabProps {
  settings: ChatSettings;
  onUpdateSettings: (updates: Partial<ChatSettings>) => void;
  onResetSettings: () => void;
}

export const ChatSettingsTab: React.FC<ChatSettingsTabProps> = ({
  settings,
  onUpdateSettings,
  onResetSettings,
}) => {
  const [showResetConfirm, setShowResetConfirm] = React.useState(false);

  const handleReset = () => {
    onResetSettings();
    setShowResetConfirm(false);
  };

  return (
    <div style={{ padding: '16px' }}>
      <TextContent style={{ marginBottom: '24px' }}>
        <Text component={TextVariants.h3}>Chat Interface Settings</Text>
        <Text component={TextVariants.p}>
          Customize how the AI Chat interface behaves and displays information.
        </Text>
      </TextContent>

      <Form>
        {/* Message Display Section */}
        <TextContent style={{ marginBottom: '16px', marginTop: '24px' }}>
          <Text component={TextVariants.h4}>Message Display</Text>
        </TextContent>

        <FormGroup
          label="Auto-collapse older messages"
          fieldId="auto-collapse"
        >
          <Switch
            id="auto-collapse"
            label="Enabled"
            labelOff="Disabled"
            isChecked={settings.autoCollapseEnabled}
            onChange={(_, checked) => onUpdateSettings({ autoCollapseEnabled: checked })}
          />
          <Text component={TextVariants.small} style={{ display: 'block', marginTop: '8px', color: 'var(--pf-v5-global--Color--200)' }}>
            Automatically collapse older assistant responses to reduce scrolling.
          </Text>
        </FormGroup>

        {settings.autoCollapseEnabled && (
          <>
            <FormGroup
              label="Messages kept expanded"
              fieldId="messages-kept-expanded"
            >
              <TextInput
                id="messages-kept-expanded"
                type="number"
                value={settings.messagesKeptExpanded}
                onChange={(_, value) => {
                  const num = parseInt(value, 10);
                  if (!isNaN(num) && num >= 1 && num <= 10) {
                    onUpdateSettings({ messagesKeptExpanded: num });
                  }
                }}
                min={1}
                max={10}
                style={{ width: '100px' }}
              />
              <Text component={TextVariants.small} style={{ display: 'block', marginTop: '8px', color: 'var(--pf-v5-global--Color--200)' }}>
                Number of most recent assistant messages to keep expanded (1-10).
              </Text>
            </FormGroup>

            <FormGroup
              label="Collapsed message preview length"
              fieldId="collapsed-preview-length"
            >
              <TextInput
                id="collapsed-preview-length"
                type="number"
                value={settings.collapsedPreviewLength}
                onChange={(_, value) => {
                  const num = parseInt(value, 10);
                  if (!isNaN(num) && num >= 100 && num <= 500) {
                    onUpdateSettings({ collapsedPreviewLength: num });
                  }
                }}
                min={100}
                max={500}
                style={{ width: '100px' }}
              />
              <Text component={TextVariants.small} style={{ display: 'block', marginTop: '8px', color: 'var(--pf-v5-global--Color--200)' }}>
                Number of characters to show in collapsed messages (100-500).
              </Text>
            </FormGroup>
          </>
        )}

        <Divider style={{ margin: '24px 0' }} />

        {/* Suggested Questions Section */}
        <TextContent style={{ marginBottom: '16px' }}>
          <Text component={TextVariants.h4}>Suggested Questions</Text>
        </TextContent>

        <FormGroup
          label="Location"
          fieldId="suggested-questions-location"
        >
          <Radio
            id="location-header"
            name="suggested-questions-location"
            label="Header (button with popover)"
            description="Show as a button in the chat header. Click to view questions in a popover menu."
            isChecked={settings.suggestedQuestionsLocation === 'header'}
            onChange={() => onUpdateSettings({ suggestedQuestionsLocation: 'header' })}
          />
          <Radio
            id="location-inline"
            name="suggested-questions-location"
            label="Inline (below messages)"
            description="Show below chat messages in an expandable section (classic view)."
            isChecked={settings.suggestedQuestionsLocation === 'inline'}
            onChange={() => onUpdateSettings({ suggestedQuestionsLocation: 'inline' })}
            style={{ marginTop: '12px' }}
          />
        </FormGroup>

        {settings.suggestedQuestionsLocation === 'inline' && (
          <FormGroup
            label="Default state"
            fieldId="suggested-questions-expanded"
          >
            <Switch
              id="suggested-questions-expanded"
              label="Expanded by default"
              labelOff="Collapsed by default"
              isChecked={settings.suggestedQuestionsExpanded}
              onChange={(_, checked) => onUpdateSettings({ suggestedQuestionsExpanded: checked })}
            />
            <Text component={TextVariants.small} style={{ display: 'block', marginTop: '8px', color: 'var(--pf-v5-global--Color--200)' }}>
              Control whether the inline suggested questions section is shown or hidden when you start chatting.
            </Text>
          </FormGroup>
        )}

        <Divider style={{ margin: '24px 0' }} />

        {/* Conversation Context Section */}
        <TextContent style={{ marginBottom: '16px' }}>
          <Text component={TextVariants.h4}>Conversation Context</Text>
        </TextContent>

        <FormGroup
          label="Context history limit"
          fieldId="conversation-context-limit"
        >
          <TextInput
            id="conversation-context-limit"
            type="number"
            value={settings.conversationContextLimit}
            onChange={(_, value) => {
              const num = parseInt(value, 10);
              if (!isNaN(num) && num >= 0 && num <= 20) {
                onUpdateSettings({ conversationContextLimit: num });
              }
            }}
            min={0}
            max={20}
            style={{ width: '100px' }}
          />
          <Text component={TextVariants.small} style={{ display: 'block', marginTop: '8px', color: 'var(--pf-v5-global--Color--200)' }}>
            Number of previous messages to send for context (0-20). Higher values provide more context but use more tokens. Set to 0 to disable context (each message is independent).
          </Text>
        </FormGroup>

        <Divider style={{ margin: '24px 0' }} />

        {/* UI Preferences Section */}
        <TextContent style={{ marginBottom: '16px' }}>
          <Text component={TextVariants.h4}>UI Preferences</Text>
        </TextContent>

        <FormGroup
          label="Progress log visibility"
          fieldId="show-progress-log"
        >
          <Switch
            id="show-progress-log"
            label="Show by default"
            labelOff="Hide by default"
            isChecked={settings.showProgressLogByDefault}
            onChange={(_, checked) => onUpdateSettings({ showProgressLogByDefault: checked })}
          />
          <Text component={TextVariants.small} style={{ display: 'block', marginTop: '8px', color: 'var(--pf-v5-global--Color--200)' }}>
            Show execution details automatically when AI responds (you can always toggle manually).
          </Text>
        </FormGroup>

        <FormGroup
          label="Keyboard shortcuts"
          fieldId="keyboard-shortcuts"
        >
          <Switch
            id="keyboard-shortcuts"
            label="Enabled"
            labelOff="Disabled"
            isChecked={settings.enableKeyboardShortcuts}
            onChange={(_, checked) => onUpdateSettings({ enableKeyboardShortcuts: checked })}
          />
          <Text component={TextVariants.small} style={{ display: 'block', marginTop: '8px', color: 'var(--pf-v5-global--Color--200)' }}>
            Enable keyboard shortcuts like Cmd/Ctrl+K to focus input and Cmd/Ctrl+E to export chat.
          </Text>
        </FormGroup>

        <Divider style={{ margin: '24px 0' }} />

        {/* Storage Section */}
        <TextContent style={{ marginBottom: '16px' }}>
          <Text component={TextVariants.h4}>Storage</Text>
        </TextContent>

        <FormGroup
          label="Maximum stored messages"
          fieldId="max-stored-messages"
        >
          <TextInput
            id="max-stored-messages"
            type="number"
            value={settings.maxStoredMessages}
            onChange={(_, value) => {
              const num = parseInt(value, 10);
              if (!isNaN(num) && num >= 10 && num <= 100) {
                onUpdateSettings({ maxStoredMessages: num });
              }
            }}
            min={10}
            max={100}
            style={{ width: '100px' }}
          />
          <Text component={TextVariants.small} style={{ display: 'block', marginTop: '8px', color: 'var(--pf-v5-global--Color--200)' }}>
            Maximum messages to keep in browser storage (10-100). Older messages are removed to prevent storage issues.
          </Text>
        </FormGroup>

        <Divider style={{ margin: '24px 0' }} />

        {/* Reset Section */}
        {!showResetConfirm ? (
          <Button
            variant="link"
            isDanger
            onClick={() => setShowResetConfirm(true)}
            style={{ padding: 0 }}
          >
            Reset all settings to defaults
          </Button>
        ) : (
          <Alert
            variant={AlertVariant.warning}
            title="Reset settings to defaults?"
            isInline
            actionLinks={
              <>
                <AlertActionLink onClick={handleReset}>
                  Yes, reset
                </AlertActionLink>
                <AlertActionLink onClick={() => setShowResetConfirm(false)}>
                  Cancel
                </AlertActionLink>
              </>
            }
          >
            This will restore all chat settings to their default values.
          </Alert>
        )}
      </Form>
    </div>
  );
};
