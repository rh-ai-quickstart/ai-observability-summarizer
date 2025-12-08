import * as React from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Button,
  Spinner,
  Alert,
  AlertVariant,
  Flex,
  FlexItem,
  Text,
  TextContent,
  TextVariants,
  Divider,
  Modal,
  ModalVariant,
  Tooltip,
  Label,
  ExpandableSection,
  TextInput,
  Split,
  SplitItem,
} from '@patternfly/react-core';
import { 
  RedoIcon, 
  OutlinedLightbulbIcon, 
  TimesIcon,
  ExpandIcon,
  CompressIcon,
  CopyIcon,
  DownloadIcon,
  StarIcon,
  OutlinedStarIcon,
  TrashIcon,
  CheckIcon,
} from '@patternfly/react-icons';

// LocalStorage key for pinned insights
const PINNED_INSIGHTS_KEY = 'openshift_ai_observability_pinned_insights';

interface PinnedInsight {
  id: string;
  title: string;
  content: string;
  source: string;
  timestamp: string;
}

export interface AnalysisPanelProps {
  title?: string;
  analysis: string | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onClose?: () => void;
  timestamp?: string;
}

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  title = 'AI Analysis',
  analysis,
  loading = false,
  error = null,
  onRefresh,
  onClose,
  timestamp,
}) => {
  const [isFullScreen, setIsFullScreen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [pinnedInsights, setPinnedInsights] = React.useState<PinnedInsight[]>([]);
  const [showPinned, setShowPinned] = React.useState(false);
  const [newInsightTitle, setNewInsightTitle] = React.useState('');
  const [selectedText, setSelectedText] = React.useState('');
  const [showPinDialog, setShowPinDialog] = React.useState(false);

  // Load pinned insights from localStorage
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(PINNED_INSIGHTS_KEY);
      if (stored) {
        setPinnedInsights(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load pinned insights:', e);
    }
  }, []);

  // Save pinned insights to localStorage
  const savePinnedInsights = (insights: PinnedInsight[]) => {
    localStorage.setItem(PINNED_INSIGHTS_KEY, JSON.stringify(insights));
    setPinnedInsights(insights);
  };

  const handleCopy = async () => {
    if (analysis) {
      try {
        await navigator.clipboard.writeText(analysis);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error('Failed to copy:', e);
      }
    }
  };

  const handleDownload = () => {
    if (analysis) {
      const blob = new Blob([analysis], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analysis-${new Date().toISOString().split('T')[0]}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      setSelectedText(selection.toString().trim());
    }
  };

  const handlePinInsight = () => {
    const textToPin = selectedText || analysis;
    if (!textToPin) return;

    const newInsight: PinnedInsight = {
      id: Date.now().toString(),
      title: newInsightTitle || `Insight from ${title}`,
      content: textToPin,
      source: title,
      timestamp: new Date().toISOString(),
    };

    savePinnedInsights([...pinnedInsights, newInsight]);
    setShowPinDialog(false);
    setNewInsightTitle('');
    setSelectedText('');
  };

  const handleDeletePinnedInsight = (id: string) => {
    savePinnedInsights(pinnedInsights.filter(i => i.id !== id));
  };

  const formatAnalysis = (text: string): React.ReactNode => {
    const lines = text.split('\n');
    return lines.map((line, index) => {
      if (line.startsWith('###')) {
        return (
          <Text key={index} component={TextVariants.h4} style={{ marginTop: '16px', marginBottom: '8px', color: '#6b21a8' }}>
            {line.replace(/^###\s*/, '')}
          </Text>
        );
      }
      if (line.startsWith('##')) {
        return (
          <Text key={index} component={TextVariants.h3} style={{ marginTop: '16px', marginBottom: '8px', color: '#7c3aed' }}>
            {line.replace(/^##\s*/, '')}
          </Text>
        );
      }
      if (line.startsWith('#')) {
        return (
          <Text key={index} component={TextVariants.h2} style={{ marginTop: '16px', marginBottom: '8px', color: '#7c3aed' }}>
            {line.replace(/^#\s*/, '')}
          </Text>
        );
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <Text key={index} component="p" style={{ marginLeft: '16px', marginBottom: '4px' }}>
            • {line.substring(2)}
          </Text>
        );
      }
      if (line.match(/^\d+\.\s/)) {
        return (
          <Text key={index} component="p" style={{ marginLeft: '16px', marginBottom: '4px' }}>
            {line}
          </Text>
        );
      }
      if (line.includes('**')) {
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return (
          <Text key={index} component="p" style={{ marginBottom: '8px' }}>
            {parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))}
          </Text>
        );
      }
      if (line.trim() === '') {
        return <br key={index} />;
      }
      return (
        <Text key={index} component="p" style={{ marginBottom: '8px' }}>
          {line}
        </Text>
      );
    });
  };

  const actionButtons = (
    <Flex>
      {/* Pin Button */}
      <FlexItem>
        <Tooltip content="Pin insight for later">
          <Button
            variant="plain"
            onClick={() => setShowPinDialog(true)}
            isDisabled={!analysis || loading}
            aria-label="Pin insight"
          >
            <OutlinedStarIcon />
          </Button>
        </Tooltip>
      </FlexItem>

      {/* Copy Button */}
      <FlexItem>
        <Tooltip content={copied ? 'Copied!' : 'Copy to clipboard'}>
          <Button
            variant="plain"
            onClick={handleCopy}
            isDisabled={!analysis || loading}
            aria-label="Copy analysis"
          >
            {copied ? <CheckIcon style={{ color: '#3e8635' }} /> : <CopyIcon />}
          </Button>
        </Tooltip>
      </FlexItem>

      {/* Download Button */}
      <FlexItem>
        <Tooltip content="Download as Markdown">
          <Button
            variant="plain"
            onClick={handleDownload}
            isDisabled={!analysis || loading}
            aria-label="Download analysis"
          >
            <DownloadIcon />
          </Button>
        </Tooltip>
      </FlexItem>

      {/* Expand Button */}
      <FlexItem>
        <Tooltip content={isFullScreen ? 'Exit full screen' : 'Expand to full screen'}>
          <Button
            variant="plain"
            onClick={() => setIsFullScreen(!isFullScreen)}
            aria-label={isFullScreen ? 'Exit full screen' : 'Expand to full screen'}
          >
            {isFullScreen ? <CompressIcon /> : <ExpandIcon />}
          </Button>
        </Tooltip>
      </FlexItem>

      {/* Refresh Button */}
      {onRefresh && (
        <FlexItem>
          <Tooltip content="Re-analyze">
            <Button
              variant="plain"
              onClick={onRefresh}
              isDisabled={loading}
              aria-label="Refresh analysis"
            >
              <RedoIcon />
            </Button>
          </Tooltip>
        </FlexItem>
      )}

      {/* Close Button */}
      {onClose && (
        <FlexItem>
          <Button variant="plain" onClick={onClose} aria-label="Close panel">
            <TimesIcon />
          </Button>
        </FlexItem>
      )}
    </Flex>
  );

  const analysisContent = (
    <>
      {loading ? (
        <Flex 
          justifyContent={{ default: 'justifyContentCenter' }} 
          alignItems={{ default: 'alignItemsCenter' }}
          style={{ minHeight: '200px', flexDirection: 'column', gap: '16px' }}
        >
          <Spinner size="lg" />
          <Text style={{ color: 'var(--pf-v5-global--Color--200)' }}>
            Analyzing metrics with AI...
          </Text>
        </Flex>
      ) : error ? (
        <Alert variant={AlertVariant.danger} title="Analysis Failed" isInline>
          {error}
        </Alert>
      ) : analysis ? (
        <div onMouseUp={handleTextSelection}>
          <TextContent style={{ maxHeight: isFullScreen ? '60vh' : '400px', overflowY: 'auto' }}>
            {formatAnalysis(analysis)}
          </TextContent>
          
          <Divider style={{ margin: '16px 0' }} />
          
          <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
            {timestamp && (
              <FlexItem>
                <Label color="grey">
                  Generated: {new Date(timestamp).toLocaleString()}
                </Label>
              </FlexItem>
            )}
            <FlexItem>
              <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                Tip: Select text to pin specific insights
              </Text>
            </FlexItem>
          </Flex>
        </div>
      ) : (
        <Flex 
          justifyContent={{ default: 'justifyContentCenter' }} 
          alignItems={{ default: 'alignItemsCenter' }}
          style={{ minHeight: '150px', flexDirection: 'column', gap: '8px' }}
        >
          <OutlinedLightbulbIcon style={{ fontSize: '32px', color: 'var(--pf-v5-global--Color--200)' }} />
          <Text component="p" style={{ color: 'var(--pf-v5-global--Color--200)' }}>
            Click &quot;Analyze with AI&quot; to generate insights
          </Text>
        </Flex>
      )}
    </>
  );

  const pinnedInsightsSection = pinnedInsights.length > 0 && (
    <ExpandableSection
      toggleText={`Pinned Insights (${pinnedInsights.length})`}
      onToggle={() => setShowPinned(!showPinned)}
      isExpanded={showPinned}
      style={{ marginTop: '16px' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        {pinnedInsights.map((insight) => (
          <Card key={insight.id} isCompact style={{ backgroundColor: '#faf5ff', border: '1px solid #e9d5ff' }}>
            <CardBody>
              <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsFlexStart' }}>
                <FlexItem style={{ flex: 1 }}>
                  <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '8px' }}>
                    <FlexItem>
                      <StarIcon style={{ color: '#7c3aed', marginRight: '8px' }} />
                    </FlexItem>
                    <FlexItem>
                      <Text component={TextVariants.p} style={{ fontWeight: 600 }}>
                        {insight.title}
                      </Text>
                    </FlexItem>
                  </Flex>
                  <Text component={TextVariants.p} style={{ 
                    fontSize: '13px', 
                    color: '#4b5563',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '100px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {insight.content.length > 200 ? `${insight.content.substring(0, 200)}...` : insight.content}
                  </Text>
                  <Text component={TextVariants.small} style={{ color: 'var(--pf-v5-global--Color--200)', marginTop: '8px' }}>
                    From: {insight.source} • {new Date(insight.timestamp).toLocaleDateString()}
                  </Text>
                </FlexItem>
                <FlexItem>
                  <Button
                    variant="plain"
                    onClick={() => handleDeletePinnedInsight(insight.id)}
                    aria-label="Delete pinned insight"
                  >
                    <TrashIcon style={{ color: '#c9190b' }} />
                  </Button>
                </FlexItem>
              </Flex>
            </CardBody>
          </Card>
        ))}
      </div>
    </ExpandableSection>
  );

  // Pin Dialog Modal
  const pinDialog = (
    <Modal
      variant={ModalVariant.small}
      title="Pin Insight"
      isOpen={showPinDialog}
      onClose={() => {
        setShowPinDialog(false);
        setNewInsightTitle('');
        setSelectedText('');
      }}
      actions={[
        <Button key="pin" variant="primary" onClick={handlePinInsight}>
          <StarIcon style={{ marginRight: '8px' }} />
          Pin Insight
        </Button>,
        <Button key="cancel" variant="link" onClick={() => setShowPinDialog(false)}>
          Cancel
        </Button>,
      ]}
    >
      <TextContent style={{ marginBottom: '16px' }}>
        <Text>
          {selectedText 
            ? 'Pin the selected text as an insight for quick reference later.'
            : 'Pin the entire analysis as an insight for quick reference later.'}
        </Text>
      </TextContent>
      
      <TextInput
        value={newInsightTitle}
        onChange={(_event, value) => setNewInsightTitle(value)}
        placeholder="Enter a title for this insight..."
        aria-label="Insight title"
      />
      
      {selectedText && (
        <Card isCompact style={{ marginTop: '16px', backgroundColor: '#f3e8ff' }}>
          <CardBody>
            <Text component={TextVariants.small} style={{ fontWeight: 600, marginBottom: '4px' }}>
              Selected text:
            </Text>
            <Text component={TextVariants.p} style={{ fontSize: '13px' }}>
              {selectedText.length > 300 ? `${selectedText.substring(0, 300)}...` : selectedText}
            </Text>
          </CardBody>
        </Card>
      )}
    </Modal>
  );

  // Full Screen Modal
  if (isFullScreen) {
    return (
      <>
        <Modal
          variant={ModalVariant.large}
          title={
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <OutlinedLightbulbIcon style={{ marginRight: '12px', color: '#7c3aed' }} />
              </FlexItem>
              <FlexItem>{title}</FlexItem>
            </Flex>
          }
          isOpen={isFullScreen}
          onClose={() => setIsFullScreen(false)}
          actions={[
            <Split key="actions" hasGutter>
              <SplitItem>
                <Button
                  variant="secondary"
                  icon={<CopyIcon />}
                  onClick={handleCopy}
                  isDisabled={!analysis}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </SplitItem>
              <SplitItem>
                <Button
                  variant="secondary"
                  icon={<DownloadIcon />}
                  onClick={handleDownload}
                  isDisabled={!analysis}
                >
                  Download
                </Button>
              </SplitItem>
              <SplitItem>
                <Button
                  variant="secondary"
                  icon={<OutlinedStarIcon />}
                  onClick={() => setShowPinDialog(true)}
                  isDisabled={!analysis}
                >
                  Pin Insight
                </Button>
              </SplitItem>
              {onRefresh && (
                <SplitItem>
                  <Button
                    variant="primary"
                    icon={<RedoIcon />}
                    onClick={onRefresh}
                    isDisabled={loading}
                    isLoading={loading}
                  >
                    Re-analyze
                  </Button>
                </SplitItem>
              )}
            </Split>,
          ]}
        >
          {analysisContent}
          {pinnedInsightsSection}
        </Modal>
        {pinDialog}
      </>
    );
  }

  // Regular Card View
  return (
    <>
      <Card style={{ 
        background: 'linear-gradient(180deg, #faf5ff 0%, #ffffff 100%)',
        border: '1px solid #e9d5ff',
      }}>
        <CardHeader actions={{ actions: actionButtons }}>
          <CardTitle>
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <OutlinedLightbulbIcon style={{ marginRight: '8px', color: '#7c3aed' }} />
              </FlexItem>
              <FlexItem>
                <Text component={TextVariants.h3}>{title}</Text>
              </FlexItem>
            </Flex>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {analysisContent}
          {pinnedInsightsSection}
        </CardBody>
      </Card>
      {pinDialog}
    </>
  );
};

export default AnalysisPanel;
