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
} from '@patternfly/react-core';
import {
  PaperPlaneIcon,
  UserIcon,
  RobotIcon,
  TrashIcon,
} from '@patternfly/react-icons';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const AIChatPage: React.FC = () => {
  const [messages, setMessages] = React.useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `👋 Hello! I'm your AI Observability Assistant.

I can help you understand your vLLM and OpenShift metrics. Try asking me questions like:

• "What's the current GPU utilization across all models?"
• "Are there any performance issues I should be aware of?"
• "Summarize the health of my vLLM deployments"
• "What are the top resource consumers in my cluster?"

How can I help you today?`,
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // TODO: Implement actual MCP chat call
      await new Promise(resolve => setTimeout(resolve, 1500));

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: getAIResponse(userMessage.content),
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '❌ Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const getAIResponse = (question: string): string => {
    const lowerQ = question.toLowerCase();
    
    if (lowerQ.includes('gpu') || lowerQ.includes('utilization')) {
      return `📊 **GPU Utilization Summary**

Based on current metrics:
- **Average GPU Utilization**: 78%
- **Peak Usage**: 95% (observed 2 hours ago)
- **Temperature**: 45°C (healthy range)

All GPU resources are operating within normal parameters. The utilization spike earlier was due to increased inference requests during peak hours.

💡 **Tip**: Consider setting up alerts for GPU utilization above 90% to proactively manage load.`;
    }
    
    if (lowerQ.includes('performance') || lowerQ.includes('issue')) {
      return `🔍 **Performance Analysis**

Current system status: ✅ **Healthy**

No critical issues detected. Here's the summary:

| Metric | Status | Value |
|--------|--------|-------|
| Request Latency (P95) | ✅ Good | 0.45s |
| Queue Depth | ✅ Normal | 3 waiting |
| Error Rate | ✅ Low | 0.1% |
| Cache Hit Rate | ⚠️ Moderate | 65% |

💡 **Recommendation**: The cache hit rate could be improved. Consider increasing the KV cache size or reviewing your batching strategy.`;
    }
    
    if (lowerQ.includes('health') || lowerQ.includes('summary')) {
      return `🏥 **vLLM Deployment Health Summary**

**Overall Status**: ✅ Healthy

**Models Running**: 4
- demo3 (Llama-3.2-3B) - ✅ Healthy
- dev (Llama-3.1-8B) - ✅ Healthy
- llamastack (Llama-32-3B) - ✅ Healthy
- main (Llama-3.1-8B) - ✅ Healthy

**Resource Utilization**:
- GPU Memory: 68% used
- CPU: 45% average
- Network I/O: Normal

**Last 24 Hours**:
- Total Requests: 15,470
- Average Latency: 0.38s
- Success Rate: 99.9%

All systems operating normally! 🚀`;
    }
    
    return `I understand you're asking about: "${question}"

Let me analyze the relevant metrics for you...

📈 Based on the current data:
- Your vLLM deployments are running smoothly
- GPU resources are at healthy utilization levels
- No immediate issues require attention

Would you like me to dive deeper into any specific metric or provide more detailed analysis?`;
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([{
      id: '1',
      role: 'assistant',
      content: '👋 Chat cleared! How can I help you with your observability data?',
      timestamp: new Date(),
    }]);
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
                  <pre style={{ 
                    margin: 0, 
                    whiteSpace: 'pre-wrap', 
                    fontFamily: 'inherit',
                    lineHeight: 1.5,
                  }}>
                    {message.content}
                  </pre>
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
              </div>
            </div>
          ))}
          
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
                  <Text style={{ marginLeft: '8px' }}>Analyzing...</Text>
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
                onClick={handleSend}
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
