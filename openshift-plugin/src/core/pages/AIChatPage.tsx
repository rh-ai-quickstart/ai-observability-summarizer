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
  Spinner,
  Divider,
  Alert,
  AlertVariant,
  AlertActionLink,
  Label,
} from '@patternfly/react-core';
import {
  PaperPlaneIcon,
  UserIcon,
  RobotIcon,
  TrashIcon,
  InfoCircleIcon,
} from '@patternfly/react-icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chat, getSessionConfig } from '../services/mcpClient';
import { useChatHistory, Message } from '../hooks/useChatHistory';
import { useProgressIndicator } from '../hooks/useProgressIndicator';
import { SuggestedQuestions } from '../components/SuggestedQuestions';
import '../styles/chat-markdown.css';

const AIChatPage: React.FC = () => {
  const { messages, setMessages, clearHistory } = useChatHistory();
  const [inputValue, setInputValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const { progressMessage, startProgress, stopProgress } = useProgressIndicator();
  const [replayMessage, setReplayMessage] = React.useState<string>('');
  const [questionsExpanded, setQuestionsExpanded] = React.useState(true);
  const [expandedProgressLogs, setExpandedProgressLogs] = React.useState<Set<string>>(new Set());
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check configuration on mount
  React.useEffect(() => {
    const config = getSessionConfig();
    if (!config.ai_model) {
      setConfigError('No AI model configured');
    } else {
      setConfigError(null);
    }
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

    // Collapse suggested questions when a question is sent
    if (messageText) {
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
      // Call real MCP chat endpoint
      const { response, progressLog } = await chat(
        config.ai_model,
        userMessage.content,
        {
          scope: 'cluster_wide',
          apiKey: config.api_key,
        }
      );

      stopProgress();

      // Replay progress log entries (show what the chatbot actually did)
      if (progressLog && progressLog.length > 0) {
        console.log(`[Chat] Replaying ${progressLog.length} progress entries`);

        for (const entry of progressLog) {
          setReplayMessage(entry.message);
          // Show each entry for 300ms to create replay effect
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Clear replay message
        setReplayMessage('');
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        progressLog: progressLog && progressLog.length > 0 ? progressLog : undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Auto-expand suggested questions after response for easy follow-up
      setQuestionsExpanded(true);
    } catch (error) {
      stopProgress();

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ I encountered an error: ${error.message}`,
        timestamp: new Date(),
        error: true,
      };

      setMessages(prev => [...prev, errorMessage]);

      // Auto-expand suggested questions even on error
      setQuestionsExpanded(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    clearHistory();
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
            <AlertActionLink onClick={() => setConfigError(null)}>
              Dismiss
            </AlertActionLink>
          }
        >
          {configError}. Please click the settings icon in the header to configure your AI model.
        </Alert>
      )}

      {/* Chat Messages */}
      <Card style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <CardBody style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {messages.map((message) => (
            <div
              key={message.id}
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
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '12px',
                    backgroundColor: message.role === 'user' ? '#0066cc' : '#f0f0f0',
                    color: message.role === 'user' ? 'white' : 'inherit',
                  }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    className="chat-markdown"
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
                <Text
                  component={TextVariants.small}
                  style={{
                    color: 'var(--pf-v5-global--Color--200)',
                    marginTop: '4px',
                    textAlign: message.role === 'user' ? 'right' : 'left',
                  }}
                >
                  {message.timestamp.toLocaleTimeString()}
                </Text>

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
                )}
              </div>
            </div>
          ))}

          {/* Suggested Questions - always available, collapsible */}
          <div style={{ marginTop: messages.length > 1 ? '16px' : '24px', marginBottom: '16px' }}>
            <SuggestedQuestions
              onSelectQuestion={(question) => handleSend(question)}
              isExpanded={questionsExpanded}
              onToggle={(expanded) => setQuestionsExpanded(expanded)}
            />
          </div>

          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
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
                  <Spinner size="sm" />
                  <Text style={{ marginLeft: '8px' }}>
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
              <Button
                variant="primary"
                onClick={() => handleSend()}
                isDisabled={!inputValue.trim() || isLoading}
                style={{
                  marginLeft: '8px',
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
