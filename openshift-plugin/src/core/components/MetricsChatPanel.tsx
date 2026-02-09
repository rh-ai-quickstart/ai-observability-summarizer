import * as React from 'react';
import {
  Text,
  TextVariants,
  TextInput,
  Button,
  Flex,
  FlexItem,
  Spinner,
  Alert,
  AlertVariant,
} from '@patternfly/react-core';
import { RobotIcon, TimesIcon, PaperPlaneIcon, UserIcon } from '@patternfly/react-icons';
import ReactMarkdown from 'react-markdown';
import { getSessionConfig, chatOpenShift } from '../services/mcpClient';
import { ConfigurationRequiredAlert } from './ConfigurationRequiredAlert';

interface MetricsChatPanelProps {
  scope: 'cluster_wide' | 'namespace_scoped';
  namespace?: string;
  category: string;
  timeRange: string;
  isOpen: boolean;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  promql?: string;
  timestamp: Date;
}

// Category-specific suggested questions
const CATEGORY_QUESTIONS: Record<string, string[]> = {
  'Fleet Overview': [
    "What's the overall health of my cluster?",
    "Are there any critical pod failures I should investigate?",
    "How is my cluster resource utilization trending?",
    "What's causing any performance bottlenecks?"
  ],
  'Jobs & Workloads': [
    "Are there any failing jobs I need to investigate?",
    "How are my CronJobs performing?",
    "What workloads are consuming the most resources?",
    "Are there any stuck or pending workloads?"
  ],
  'Storage & Config': [
    "Are there any storage issues I should be aware of?",
    "How is my PVC utilization looking?",
    "Are there any pending storage requests?",
    "What's my storage capacity trending?"
  ],
  'Node Metrics': [
    "How are my nodes performing overall?",
    "Are there any nodes with resource pressure?",
    "What's causing high CPU or memory usage?",
    "Are there any unhealthy nodes?"
  ],
  'GPU & Accelerators': [
    "How is my GPU utilization across the cluster?",
    "Are any GPUs running too hot?",
    "What's my GPU power consumption looking like?",
    "Are there any GPU performance issues?"
  ],
  'Autoscaling & Scheduling': [
    "How is pod scheduling performing?",
    "Are there any scheduling bottlenecks?",
    "How are my HPAs behaving?",
    "Are resource requests and limits properly configured?"
  ],
  'Pod & Container Metrics': [
    "Which pods are using the most resources?",
    "Are there any containers being throttled?",
    "What's causing pod restarts?",
    "Are there any OOM killed containers?"
  ],
  'Network Metrics': [
    "How is network traffic looking across the cluster?",
    "Are there any network performance issues?",
    "What's causing network errors or dropped packets?",
    "How is my ingress traffic trending?"
  ],
  'Storage I/O': [
    "How is storage I/O performance?",
    "Are there any disk performance bottlenecks?",
    "What's causing high storage latency?",
    "How is my filesystem usage trending?"
  ],
  'Services & Networking': [
    "How are my services performing?",
    "Are there any service connectivity issues?",
    "How are my ingress rules working?",
    "Are there any network policy issues?"
  ],
  'Application Services': [
    "How are my application response times?",
    "What's my current error rate?",
    "Are there any performance anomalies?",
    "How is traffic distribution across my services?"
  ]
};

// Fallback general questions
const GENERAL_OPENSHIFT_QUESTIONS = [
  "What's the overall health of this category?",
  "Are there any issues I should investigate?",
  "How are the metrics trending over time?",
  "What optimizations would you recommend?"
];

export const MetricsChatPanel: React.FC<MetricsChatPanelProps> = ({
  scope,
  namespace,
  category,
  timeRange,
  isOpen,
  onClose,
}) => {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = React.useState(true);
  const [lastContext, setLastContext] = React.useState({ category, scope, namespace, timeRange });
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Context change detection - show suggestions when context changes
  React.useEffect(() => {
    const currentContext = { category, scope, namespace, timeRange };
    const hasContextChanged = 
      lastContext.category !== currentContext.category ||
      lastContext.scope !== currentContext.scope ||
      lastContext.namespace !== currentContext.namespace ||
      lastContext.timeRange !== currentContext.timeRange;
    
    if (hasContextChanged && messages.length > 0) {
      // Context changed after we had messages - show suggestions again
      setShowSuggestions(true);
      setLastContext(currentContext);
    }
  }, [category, scope, namespace, timeRange, messages.length, lastContext]);

  if (!isOpen) return null;

  // Get category-specific questions or fallback to general ones
  const getSuggestedQuestions = () => {
    return CATEGORY_QUESTIONS[category] || GENERAL_OPENSHIFT_QUESTIONS;
  };

  // Determine if we should show suggestions
  const shouldShowSuggestions = messages.length === 0 || showSuggestions;


  const handleSendMessage = async (question: string) => {
    if (!question.trim()) return;

    setError(null);
    setIsLoading(true);
    
    // Hide suggestions after sending a message (unless context changes)
    setShowSuggestions(false);

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: question,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setCurrentQuestion('');

    try {
      // Check AI configuration
      const config = getSessionConfig();
      if (!config.ai_model) {
        setError('CONFIGURATION_REQUIRED');
        setIsLoading(false);
        return;
      }

      // Call OpenShift-specific chat API (matching Streamlit implementation)
      const result = await chatOpenShift(
        category,
        question,
        scope,
        scope === 'namespace_scoped' ? namespace : undefined,
        timeRange,
        config.ai_model,
        config.api_key
      );
      
      const responseContent = result.response;
      const promqlContent = result.promql;

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        type: 'assistant',
        content: responseContent,
        promql: promqlContent,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

    } catch (err) {
      console.error('Chat error:', err);
      setError(err instanceof Error ? err.message : 'Failed to get response from AI assistant');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    setCurrentQuestion(question);
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage(currentQuestion);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      maxWidth: '100%',
      minWidth: '300px',
      overflow: 'hidden',
      background: 'var(--pf-v5-global--BackgroundColor--100)',
      border: '1px solid var(--pf-v5-global--BorderColor--100)',
      borderRadius: 'var(--pf-v5-global--BorderRadius--sm)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 16px',
        borderBottom: '1px solid var(--pf-v5-global--BorderColor--100)',
        minHeight: '48px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          fontSize: '1.125rem',
          fontWeight: 600,
          margin: 0,
          padding: 0,
          lineHeight: '1.2'
        }}>
          <RobotIcon style={{ marginRight: '8px', color: 'var(--pf-v5-global--primary-color--100)' }} />
          AI Assistant
        </div>
        <Button variant="plain" onClick={onClose} aria-label="Close chat panel" style={{ padding: '4px', minWidth: 'auto' }}>
          <TimesIcon />
        </Button>
      </div>

      {/* Messages Area */}
      <div style={{
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '16px',
        flex: '1',
        width: '100%',
        maxWidth: '100%',
        wordWrap: 'break-word',
        overflowWrap: 'break-word'
      }}>
        {/* Context Info */}
        <Alert variant="info" isInline title="Chat Context" style={{ marginBottom: '12px' }}>
          <Text component={TextVariants.small}>
            <strong>Category:</strong> {category}<br/>
            <strong>Scope:</strong> {scope === 'cluster_wide' ? 'Cluster-wide' : namespace}<br/>
            <strong>Time Range:</strong> {timeRange}
          </Text>
        </Alert>



        {/* Messages */}
        {messages.map((message) => (
          <div key={message.id} style={{ marginBottom: '12px' }}>
            <Flex alignItems={{ default: 'alignItemsFlexStart' }} spaceItems={{ default: 'spaceItemsXs' }}>
              <FlexItem>
                {message.type === 'user' ? (
                  <UserIcon style={{ color: 'var(--pf-v5-global--primary-color--100)', marginTop: '2px' }} />
                ) : (
                  <RobotIcon style={{ color: 'var(--pf-v5-global--success-color--100)', marginTop: '2px' }} />
                )}
              </FlexItem>
              <FlexItem flex={{ default: 'flex_1' }} style={{ minWidth: 0, maxWidth: '100%' }}>
                <div>
                  <Text component={TextVariants.small} style={{ 
                    fontWeight: 'bold', 
                    color: message.type === 'user' ? 'var(--pf-v5-global--primary-color--100)' : 'var(--pf-v5-global--success-color--100)',
                    marginBottom: '4px'
                  }}>
                    {message.type === 'user' ? 'You' : 'Assistant'}
                  </Text>
                  <div style={{
                    width: '100%',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word'
                  }}>
                    <div style={{
                      width: '100%',
                      maxWidth: '100%',
                      wordBreak: 'break-word',
                      hyphens: 'auto'
                    }}>
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                    {message.promql && (
                      <div style={{ marginTop: '8px', width: '100%', maxWidth: '100%' }}>
                        <Text component={TextVariants.small} style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                          Generated PromQL:
                        </Text>
                        <pre style={{ 
                          background: 'var(--pf-v5-global--BackgroundColor--200)',
                          padding: '8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          maxWidth: '100%',
                          width: '100%'
                        }}>
                          {message.promql}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </FlexItem>
            </Flex>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsXs' }}>
            <FlexItem>
              <RobotIcon style={{ color: 'var(--pf-v5-global--success-color--100)' }} />
            </FlexItem>
            <FlexItem>
              <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsXs' }}>
                <FlexItem>
                  <Spinner size="sm" />
                </FlexItem>
                <FlexItem>
                  <Text component={TextVariants.small}>Assistant is thinking...</Text>
                </FlexItem>
              </Flex>
            </FlexItem>
          </Flex>
        )}

        {/* Error message */}
        {error && error === 'CONFIGURATION_REQUIRED' ? (
          <ConfigurationRequiredAlert onClose={() => setError(null)} />
        ) : error && (
          <Alert variant={AlertVariant.danger} title="Error" isInline>
            {error}
          </Alert>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer - Input Area */}
      <div style={{
        padding: '16px',
        borderTop: '1px solid var(--pf-v5-global--BorderColor--100)',
        background: 'var(--pf-v5-global--BackgroundColor--100)'
      }}>
        {/* Enhanced Suggested Questions - moved to footer above input */}
        {shouldShowSuggestions && (
          <div style={{ marginBottom: '12px' }}>
            <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '8px' }}>
              <FlexItem>
                <Text component={TextVariants.h4}>
                  {messages.length === 0 ? 'Suggested Questions:' : `💡 Questions for ${category}:`}
                </Text>
              </FlexItem>
              {messages.length > 0 && (
                <FlexItem align={{ default: 'alignRight' }}>
                  <Button
                    variant="plain"
                    size="sm"
                    onClick={() => setShowSuggestions(false)}
                    aria-label="Hide suggestions"
                  >
                    ✕
                  </Button>
                </FlexItem>
              )}
            </Flex>
            {getSuggestedQuestions().map((question, index) => (
              <Button
                key={index}
                variant="link"
                onClick={() => handleSuggestedQuestion(question)}
                style={{
                  display: 'block',
                  textAlign: 'left',
                  marginBottom: '4px',
                  padding: '4px 0',
                  fontSize: '0.875rem'
                }}
              >
                {question}
              </Button>
            ))}
          </div>
        )}

        {/* Show suggestions button when hidden */}
        {!shouldShowSuggestions && messages.length > 0 && (
          <div style={{ marginBottom: '8px', textAlign: 'center' }}>
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowSuggestions(true)}
              style={{ fontSize: '0.875rem', padding: '4px 8px' }}
            >
              💡 Show suggested questions for {category}
            </Button>
          </div>
        )}

        <Flex alignItems={{ default: 'alignItemsFlexEnd' }} spaceItems={{ default: 'spaceItemsXs' }}>
          <FlexItem flex={{ default: 'flex_1' }}>
            <TextInput
              type="text"
              value={currentQuestion}
              onChange={(_event, value) => setCurrentQuestion(value)}
              onKeyPress={handleKeyPress}
              placeholder={`Ask a question about ${category} metrics...`}
              isDisabled={isLoading}
              aria-label="Type your question"
            />
          </FlexItem>
          <FlexItem>
            <Button
              variant="primary"
              onClick={() => handleSendMessage(currentQuestion)}
              isDisabled={isLoading || !currentQuestion.trim()}
              icon={<PaperPlaneIcon />}
              aria-label="Send message"
            >
              Send
            </Button>
          </FlexItem>
        </Flex>
      </div>
    </div>
  );
};