import * as React from 'react';
import {
  Title,
  Card,
  CardBody,
  CardFooter,
  TextInput,
  Button,
  Flex,
  FlexItem,
  TextContent,
  Text,
  TextVariants,
  Divider,
  Alert,
  AlertVariant,
  AlertActionLink,
  Label,
  Popover,
} from '@patternfly/react-core';
import {
  PaperPlaneIcon,
  UserIcon,
  RobotIcon,
  TrashIcon,
  InfoCircleIcon,
  CopyIcon,
  CheckIcon,
  RedoIcon,
  OutlinedQuestionCircleIcon,
  DownloadIcon,
  EditIcon,
  AngleDownIcon,
  AngleUpIcon,
} from '@patternfly/react-icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chat, getSessionConfig } from '../services/mcpClient';
import { useChatHistory, Message } from '../hooks/useChatHistory';
import { useProgressIndicator } from '../hooks/useProgressIndicator';
import { useChatSettings } from '../hooks/useChatSettings';
import { SuggestedQuestions } from '../components/SuggestedQuestions';
import { SuggestedQuestionsPopover } from '../components/SuggestedQuestionsPopover';
import '../styles/chat-markdown.css';

const AIChatPage: React.FC = () => {
  const { messages, setMessages, clearHistory, exportToMarkdown } = useChatHistory();
  const { progressMessage, startProgress, stopProgress } = useProgressIndicator();
  const { settings: chatSettings } = useChatSettings();
  const [inputValue, setInputValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [replayMessage, setReplayMessage] = React.useState<string>('');
  const [questionsExpanded, setQuestionsExpanded] = React.useState(chatSettings.suggestedQuestionsExpanded);
  const [collapsedMessages, setCollapsedMessages] = React.useState<Set<string>>(new Set());
  const [expandedProgressLogs, setExpandedProgressLogs] = React.useState<Set<string>>(new Set());
  const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(null);
  const [copySuccess, setCopySuccess] = React.useState(false);
  const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isMountedRef = React.useRef(true);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Track component mounted state
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Auto-collapse older assistant messages based on settings
  React.useEffect(() => {
    if (!chatSettings.autoCollapseEnabled) return;

    const assistantMessages = messages.filter(msg => msg.role === 'assistant');

    if (assistantMessages.length > chatSettings.messagesKeptExpanded) {
      const messagesToCollapse = assistantMessages
        .slice(0, assistantMessages.length - chatSettings.messagesKeptExpanded)
        .map(msg => msg.id);

      setCollapsedMessages(prev => {
        const newSet = new Set(prev);
        messagesToCollapse.forEach(id => newSet.add(id));
        return newSet;
      });
    }
  }, [messages, chatSettings.autoCollapseEnabled, chatSettings.messagesKeptExpanded]);

  // Keyboard shortcuts (conditionally enabled based on settings)
  React.useEffect(() => {
    if (!chatSettings.enableKeyboardShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? event.metaKey : event.ctrlKey;

      // Ctrl/Cmd + K - Focus input
      if (modKey && event.key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }

      // Ctrl/Cmd + L - Clear conversation
      if (modKey && event.key === 'l') {
        event.preventDefault();
        handleClear();
      }

      // Escape - Cancel ongoing request (if loading)
      if (event.key === 'Escape' && isLoading) {
        event.preventDefault();
        // Note: This would require additional implementation to actually cancel the request
        // For now, we just stop the UI loading state
        setIsLoading(false);
        stopProgress();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLoading, chatSettings.enableKeyboardShortcuts]);

  // Check configuration on mount and when settings are closed
  React.useEffect(() => {
    const checkConfig = () => {
      const config = getSessionConfig();
      if (!config.ai_model) {
        setConfigError('No AI model configured');
      } else {
        setConfigError(null);
      }
    };

    // Check immediately
    checkConfig();

    // Listen for settings-closed event to re-check configuration
    const handleSettingsClosed = () => {
      checkConfig();
    };

    window.addEventListener('settings-closed', handleSettingsClosed);

    return () => {
      window.removeEventListener('settings-closed', handleSettingsClosed);
    };
  }, []);

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || inputValue.trim();
    if (!textToSend || isLoading) return;

    // Check configuration
    const config = getSessionConfig();
    if (!config.ai_model) {
      setConfigError('Please configure an AI model in settings');
      return;
    }

    // Collapse suggested questions when a question is sent (inline mode only)
    if (messageText && chatSettings.suggestedQuestionsLocation === 'inline') {
      // This is from suggested questions - collapse immediately
      setQuestionsExpanded(false);
    }

    // Collapse all expanded progress logs when sending new question
    setExpandedProgressLogs(new Set());

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    startProgress();

    try {
      // Build conversation history from previous messages (exclude current and error messages)
      // Limit to last N messages based on settings
      const conversationHistory = messages
        .filter(msg => !msg.error) // Exclude error messages
        .slice(-chatSettings.conversationContextLimit) // Apply context limit from settings
        .map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

      // Call real MCP chat endpoint with conversation history
      const { response, progressLog } = await chat(
        config.ai_model,
        userMessage.content,
        {
          scope: 'cluster_wide',
          apiKey: config.api_key,
          conversationHistory,
        }
      );

      // Only update state if component is still mounted
      if (!isMountedRef.current) return;

      stopProgress();

      // Replay progress log entries (show what the chatbot actually did)
      if (progressLog && progressLog.length > 0) {
        console.log(`[Chat] Replaying ${progressLog.length} progress entries`);

        for (const entry of progressLog) {
          if (!isMountedRef.current) return;
          setReplayMessage(entry.message);
          // Show each entry for 300ms to create replay effect
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Clear replay message
        if (!isMountedRef.current) return;
        setReplayMessage('');
      }

      if (!isMountedRef.current) return;

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        progressLog: progressLog && progressLog.length > 0 ? progressLog : undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Auto-expand progress log if enabled in settings
      if (chatSettings.showProgressLogByDefault && progressLog && progressLog.length > 0) {
        setExpandedProgressLogs(prev => new Set([...prev, assistantMessage.id]));
      }

      // Auto-expand suggested questions after response for easy follow-up (inline mode only)
      if (chatSettings.suggestedQuestionsLocation === 'inline') {
        setQuestionsExpanded(true);
      }
    } catch (error) {
      // Only update state if component is still mounted
      if (!isMountedRef.current) return;

      stopProgress();

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ I encountered an error: ${error.message}`,
        timestamp: new Date(),
        error: true,
        originalUserMessage: userMessage.content, // Store original message for retry
      };

      setMessages(prev => [...prev, errorMessage]);

      // Auto-expand suggested questions even on error (inline mode only)
      if (chatSettings.suggestedQuestionsLocation === 'inline') {
        setQuestionsExpanded(true);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    // Enter - Send message
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    clearHistory();
  };

  const handleOpenSettings = () => {
    // Dispatch event to open settings modal
    window.dispatchEvent(new CustomEvent('open-settings'));
  };

  const toggleProgressLog = (messageId: string) => {
    setExpandedProgressLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const handleCopyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setCopySuccess(true);

      // Reset after 2 seconds
      setTimeout(() => {
        setCopiedMessageId(null);
        setCopySuccess(false);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  };

  const handleRetryMessage = (originalMessage: string) => {
    // Re-send the original user message
    handleSend(originalMessage);
  };

  const handleExportConversation = () => {
    const markdown = exportToMarkdown();
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-history-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleEditMessage = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditValue(content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditValue('');
  };

  const handleSaveEdit = (messageId: string) => {
    if (!editValue.trim()) return;

    // Find the message index
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    // Remove all messages from this point forward (the edited message and all responses after it)
    const newMessages = messages.slice(0, messageIndex);
    setMessages(newMessages);

    // Clear edit state
    setEditingMessageId(null);
    setEditValue('');

    // Re-send the edited message
    handleSend(editValue);
  };

  const toggleMessageCollapse = (messageId: string) => {
    setCollapsedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  // Get platform-specific modifier key name
  const getModKeyName = () => {
    return navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl';
  };

  // Calculate time taken from progress log
  const calculateTimeTaken = (progressLog: Array<{ timestamp: string; message: string }>): string => {
    if (!progressLog || progressLog.length === 0) return '0.0s';

    try {
      const firstTime = new Date(progressLog[0].timestamp).getTime();
      const lastTime = new Date(progressLog[progressLog.length - 1].timestamp).getTime();
      const diffMs = lastTime - firstTime;
      const diffSec = (diffMs / 1000).toFixed(1);
      return `${diffSec}s`;
    } catch (error) {
      return '0.0s';
    }
  };

  return (
    <div style={{ height: 'calc(100vh - 250px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h2" size="xl">
              <RobotIcon style={{ marginRight: '8px', color: '#7c3aed' }} />
              AI Chat Assistant
            </Title>
            <TextContent>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                Ask questions about your metrics and get AI-powered insights
              </Text>
            </TextContent>
          </FlexItem>
          <FlexItem>
            {chatSettings.suggestedQuestionsLocation === 'header' && (
              <SuggestedQuestionsPopover onSelectQuestion={(question) => handleSend(question)} />
            )}
            <Button variant="plain" onClick={handleExportConversation} title="Export conversation" style={{ marginRight: '8px' }}>
              <DownloadIcon /> Export
            </Button>
            <Button variant="plain" onClick={handleClear} title="Clear chat">
              <TrashIcon /> Clear
            </Button>
          </FlexItem>
        </Flex>
      </div>

      {/* Configuration Error Banner */}
      {configError && (
        <Alert
          variant={AlertVariant.warning}
          title="Configuration Required"
          isInline
          style={{ marginBottom: '16px' }}
          actionLinks={
            <>
              <AlertActionLink onClick={handleOpenSettings}>
                Open Settings
              </AlertActionLink>
              <AlertActionLink onClick={() => setConfigError(null)}>
                Dismiss
              </AlertActionLink>
            </>
          }
        >
          {configError}. Click "Open Settings" to configure your AI model.
        </Alert>
      )}

      {/* Copy Success Banner */}
      {copySuccess && (
        <Alert
          variant={AlertVariant.success}
          title="Message copied to clipboard"
          isInline
          timeout={2000}
          onTimeout={() => setCopySuccess(false)}
          style={{ marginBottom: '16px' }}
        />
      )}

      {/* Chat Messages */}
      <Card style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <CardBody className="chat-messages-container" style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {messages.map((message) => (
            <div
              key={message.id}
              className="message-fade-in"
              style={{
                marginBottom: '16px',
                display: 'flex',
                flexDirection: message.role === 'user' ? 'row-reverse' : 'row',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: message.role === 'user' ? '#0066cc' : '#7c3aed',
                  color: 'white',
                  flexShrink: 0,
                }}
              >
                {message.role === 'user' ? <UserIcon /> : <RobotIcon />}
              </div>
              <div
                style={{
                  maxWidth: '80%',
                  marginLeft: message.role === 'user' ? '0' : '12px',
                  marginRight: message.role === 'user' ? '12px' : '0',
                }}
              >
                {/* Edit mode for user messages */}
                {editingMessageId === message.id && message.role === 'user' ? (
                  <div className="edit-mode-active" style={{
                    padding: '12px 16px',
                    borderRadius: '12px',
                    backgroundColor: '#f0f0f0',
                    border: '2px solid #0066cc'
                  }}>
                    <TextInput
                      type="text"
                      value={editValue}
                      onChange={(_event, value) => setEditValue(value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveEdit(message.id);
                        } else if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                      aria-label="Edit message"
                      autoFocus
                    />
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleSaveEdit(message.id)}
                        isDisabled={!editValue.trim() || isLoading}
                      >
                        Save & Resend
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCancelEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '12px',
                      backgroundColor: message.role === 'user' ? '#0066cc' : message.error ? '#fef0f0' : '#f0f0f0',
                      color: message.role === 'user' ? 'white' : 'inherit',
                      borderLeft: message.error ? '4px solid #c9190b' : 'none',
                    }}
                  >
                    {/* Collapse/Expand button for assistant messages */}
                    {message.role === 'assistant' && !message.error && (
                      <div style={{ marginBottom: '8px', textAlign: 'right' }}>
                        <Button
                          variant="link"
                          icon={collapsedMessages.has(message.id) ? <AngleDownIcon /> : <AngleUpIcon />}
                          onClick={() => toggleMessageCollapse(message.id)}
                          style={{ padding: '0', fontSize: '12px', color: '#6a6e73' }}
                        >
                          {collapsedMessages.has(message.id) ? 'Show more' : 'Show less'}
                        </Button>
                      </div>
                    )}

                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      className="chat-markdown"
                    >
                      {message.role === 'assistant' && collapsedMessages.has(message.id)
                        ? message.content.substring(0, chatSettings.collapsedPreviewLength) + (message.content.length > chatSettings.collapsedPreviewLength ? '...' : '')
                        : message.content}
                    </ReactMarkdown>

                    {/* Retry button for error messages */}
                    {message.error && message.originalUserMessage && (
                      <div style={{ marginTop: '12px' }}>
                        <Button
                          variant="link"
                          icon={<RedoIcon />}
                          onClick={() => handleRetryMessage(message.originalUserMessage!)}
                          isDisabled={isLoading}
                          style={{ padding: '0', fontSize: '14px' }}
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '4px',
                }}>
                  <Text
                    component={TextVariants.small}
                    style={{
                      color: 'var(--pf-v5-global--Color--200)',
                    }}
                  >
                    {message.timestamp.toLocaleTimeString()}
                  </Text>

                  {/* Edit button for user messages */}
                  {message.role === 'user' && editingMessageId !== message.id && (
                    <Button
                      variant="plain"
                      onClick={() => handleEditMessage(message.id, message.content)}
                      icon={<EditIcon />}
                      aria-label="Edit message"
                      isDisabled={isLoading}
                      style={{
                        padding: '4px 8px',
                        minWidth: 'unset',
                        fontSize: '12px',
                      }}
                      title="Edit and resend"
                    >
                      Edit
                    </Button>
                  )}

                  {/* Copy button for assistant messages only */}
                  {message.role === 'assistant' && (
                    <Button
                      variant="plain"
                      onClick={() => handleCopyMessage(message.id, message.content)}
                      icon={copiedMessageId === message.id ? <CheckIcon color="green" /> : <CopyIcon />}
                      aria-label="Copy message"
                      style={{
                        padding: '4px 8px',
                        minWidth: 'unset',
                        fontSize: '12px',
                      }}
                      title={copiedMessageId === message.id ? 'Copied!' : 'Copy message'}
                    >
                      {copiedMessageId === message.id ? 'Copied' : 'Copy'}
                    </Button>
                  )}
                </div>

                {/* Progress Info Section - Assistant messages only */}
                {message.role === 'assistant' && message.progressLog && message.progressLog.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <Button
                      variant="link"
                      onClick={() => toggleProgressLog(message.id)}
                      icon={<InfoCircleIcon />}
                      style={{ padding: '0', fontSize: '12px' }}
                    >
                      {expandedProgressLogs.has(message.id) ? 'Hide' : 'Show'} execution details
                      <Label color="blue" isCompact style={{ marginLeft: '8px' }}>
                        {message.progressLog.length} {message.progressLog.length === 1 ? 'step' : 'steps'}, {calculateTimeTaken(message.progressLog)}
                      </Label>
                    </Button>

                    <div className={expandedProgressLogs.has(message.id) ? 'progress-log-expanded' : 'progress-log-collapsed'}>
                      {expandedProgressLogs.has(message.id) && (
                        <div
                          style={{
                            marginTop: '8px',
                            padding: '12px',
                            backgroundColor: 'var(--pf-v5-global--BackgroundColor--light-100)',
                            borderRadius: '8px',
                            fontSize: '12px',
                          }}
                        >
                        <TextContent>
                          <Text component={TextVariants.small} style={{ fontWeight: 600, marginBottom: '4px' }}>
                            AI Execution Steps:
                          </Text>
                          <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginBottom: '8px' }}>
                            Total time: {calculateTimeTaken(message.progressLog)} | {message.progressLog.length} {message.progressLog.length === 1 ? 'step' : 'steps'}
                          </Text>
                        </TextContent>
                        <Divider style={{ margin: '8px 0' }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {message.progressLog.map((entry, index) => (
                            <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                              <Text
                                component={TextVariants.small}
                                style={{
                                  color: 'var(--pf-v5-global--Color--200)',
                                  minWidth: '80px',
                                  fontFamily: 'monospace',
                                }}
                              >
                                {entry.timestamp}
                              </Text>
                              <Text component={TextVariants.small} style={{ flex: 1 }}>
                                {entry.message}
                              </Text>
                            </div>
                          ))}
                        </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Suggested Questions - inline mode only */}
          {chatSettings.suggestedQuestionsLocation === 'inline' && (
            <div style={{ marginTop: messages.length > 1 ? '16px' : '24px', marginBottom: '16px' }}>
              <SuggestedQuestions
                onSelectQuestion={(question) => handleSend(question)}
                isExpanded={questionsExpanded}
                onToggle={(expanded) => setQuestionsExpanded(expanded)}
              />
            </div>
          )}

          {isLoading && (
            <div className="message-fade-in" style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#7c3aed',
                  color: 'white',
                }}
              >
                <RobotIcon />
              </div>
              <div style={{ marginLeft: '12px', padding: '12px 16px', backgroundColor: '#f0f0f0', borderRadius: '12px' }}>
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                  <div className="typing-indicator" style={{ marginRight: '8px' }}>
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <Text>
                    {replayMessage || progressMessage || 'Analyzing...'}
                  </Text>
                </Flex>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </CardBody>
        
        <Divider />
        
        <CardFooter>
          <Flex>
            <FlexItem flex={{ default: 'flex_1' }}>
              <TextInput
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(_event, value) => setInputValue(value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask about your metrics..."
                aria-label="Chat input"
                isDisabled={isLoading}
              />
            </FlexItem>
            <FlexItem>
              <Popover
                aria-label="Keyboard shortcuts"
                headerContent={<div>⌨️ Keyboard Shortcuts</div>}
                bodyContent={
                  <div style={{ minWidth: '280px' }}>
                    <TextContent>
                      <Text component={TextVariants.small} style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Send message</span>
                        <code style={{ marginLeft: '16px', padding: '2px 6px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>Enter</code>
                      </Text>
                      <Text component={TextVariants.small} style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Focus input field</span>
                        <code style={{ marginLeft: '16px', padding: '2px 6px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>{getModKeyName()}+K</code>
                      </Text>
                      <Text component={TextVariants.small} style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Clear conversation</span>
                        <code style={{ marginLeft: '16px', padding: '2px 6px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>{getModKeyName()}+L</code>
                      </Text>
                      <Text component={TextVariants.small} style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Cancel request</span>
                        <code style={{ marginLeft: '16px', padding: '2px 6px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>Esc</code>
                      </Text>
                    </TextContent>
                  </div>
                }
                position="top"
                enableFlip={true}
              >
                <Button
                  variant="plain"
                  aria-label="Show keyboard shortcuts"
                  style={{ padding: '6px', marginLeft: '4px' }}
                >
                  <OutlinedQuestionCircleIcon style={{ fontSize: '16px' }} />
                </Button>
              </Popover>
              <Button
                variant="primary"
                onClick={() => handleSend()}
                isDisabled={!inputValue.trim() || isLoading}
                style={{
                  marginLeft: '4px',
                  background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                  border: 'none'
                }}
              >
                <PaperPlaneIcon />
              </Button>
            </FlexItem>
          </Flex>
          <TextContent style={{ marginTop: '8px' }}>
            <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
              💡 Try: "What's my GPU utilization?" or "Summarize vLLM health"
            </Text>
          </TextContent>
        </CardFooter>
      </Card>
    </div>
  );
};

export { AIChatPage };
export default AIChatPage;
