import {
  ChartLineIcon,
  TachometerAltIcon,
  ClockIcon,
  MemoryIcon,
  CogIcon,
  NetworkIcon,
  ListIcon,
  CubesIcon,
} from '@patternfly/react-icons';

export interface VLLMKeyMetric {
  key: string;
  label: string;
  unit: string;
  priority: number;
}

export interface VLLMMetric {
  key: string;
  label: string;
  unit: string;
  description: string;
}

export interface VLLMMetricCategory {
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  priority: number;
  description: string;
  metrics: VLLMMetric[];
}

// Key Metrics - Priority metrics from Streamlit (displayed prominently at top)
export const KEY_METRICS_CONFIG: VLLMKeyMetric[] = [
  { key: 'GPU Temperature (°C)', label: 'GPU Temperature', unit: '°C', priority: 1 },
  { key: 'GPU Power Usage (Watts)', label: 'GPU Power Usage', unit: 'W', priority: 2 },
  { key: 'P95 Latency (s)', label: 'P95 Latency', unit: 's', priority: 3 },
  { key: 'GPU Usage (%)', label: 'GPU Usage', unit: '%', priority: 4 },
  { key: 'Output Tokens Created', label: 'Output Tokens', unit: '', priority: 5 },
  { key: 'Prompt Tokens Created', label: 'Prompt Tokens', unit: '', priority: 6 },
];

// Comprehensive vLLM metric categories based on actual Prometheus metrics
export const METRIC_CATEGORIES: Record<string, VLLMMetricCategory> = {
  'Request Tracking & Throughput': {
    icon: ChartLineIcon,
    priority: 1,
    description: 'Monitor request volume, status, and reliability',
    metrics: [
      { key: 'Requests Total', label: 'Total Requests', unit: '', description: 'Total inference requests processed' },
      { key: 'Requests Running', label: 'In-Progress Requests', unit: '', description: 'Active ongoing requests' },
      { key: 'Request Errors Total', label: 'Request Errors', unit: '', description: 'Total failed inference requests' },
      { key: 'Oom Errors Total', label: 'OOM Request Errors', unit: '', description: 'Out-of-memory errors' },
      { key: 'Num Requests Waiting', label: 'Waiting Requests', unit: '', description: 'Requests waiting in queue' },
      { key: 'Scheduler Pending Requests', label: 'Pending Requests', unit: '', description: 'Requests pending in scheduler queue' },
    ]
  },
  'Token Throughput': {
    icon: TachometerAltIcon,
    priority: 2,
    description: 'Token processing performance and rates',
    metrics: [
      // Prompt Tokens Created and Output Tokens Created removed - shown in Key Metrics
      { key: 'Tokens Generated Per Second', label: 'Token Rate', unit: 't/s', description: 'Token generation rate (tokens/second)' },
      { key: 'Prompt Tokens Total', label: 'Prompt Tokens', unit: '', description: 'Total prompt tokens processed' },
      { key: 'Generation Tokens Total', label: 'Gen Tokens', unit: '', description: 'Total generated tokens' },
      { key: 'Request Prompt Tokens Sum', label: 'Avg Prompt Tokens', unit: '', description: 'Average prompt tokens per request' },
      { key: 'Request Generation Tokens Sum', label: 'Avg Generated Tokens', unit: '', description: 'Average generated tokens per request' },
    ]
  },
  'Latency & Timing': {
    icon: ClockIcon,
    priority: 3,
    description: 'Response time breakdown and analysis',
    metrics: [
      // P95 Latency removed - shown in Key Metrics
      { key: 'Inference Time (s)', label: 'Avg Inference', unit: 's', description: 'Average inference time' },
      { key: 'Streaming Ttft Seconds', label: 'Streaming TTFT', unit: 's', description: 'Average time to first token for streaming' },
      { key: 'Time To First Token Seconds Sum', label: 'TTFT Sum', unit: 's', description: 'Time to first token (total)' },
      { key: 'Time Per Output Token Seconds Sum', label: 'TPOT Sum', unit: 's', description: 'Time per output token (total)' },
      { key: 'Request Prefill Time Seconds Sum', label: 'Prompt Processing Time', unit: 's', description: 'Prompt processing time' },
      { key: 'Request Decode Time Seconds Sum', label: 'Token Generation Time', unit: 's', description: 'Token generation time' },
      { key: 'Request Queue Time Seconds Sum', label: 'Queue Time', unit: 's', description: 'Time spent in queue' },
      { key: 'E2E Request Latency Seconds Sum', label: 'E2E Latency', unit: 's', description: 'End-to-end latency sum' },
    ]
  },
  'Memory & Cache': {
    icon: MemoryIcon,
    priority: 4,
    description: 'Cache efficiency and memory utilization',
    metrics: [
      { key: 'Kv Cache Usage Perc', label: 'KV Cache', unit: '%', description: 'Key-Value cache utilization' },
      { key: 'Gpu Cache Usage Perc', label: 'GPU Cache', unit: '%', description: 'GPU cache utilization' },
      { key: 'Cache Fragmentation Ratio', label: 'Fragmentation', unit: '%', description: 'KV cache fragmentation ratio (lower is better)' },
      { key: 'Kv Cache Usage Bytes', label: 'Cache Used', unit: 'GB', description: 'KV cache memory used (GB)' },
      { key: 'Kv Cache Capacity Bytes', label: 'Cache Capacity', unit: 'GB', description: 'Total KV cache capacity (GB)' },
      { key: 'Kv Cache Free Bytes', label: 'Cache Free', unit: 'GB', description: 'KV cache memory free (GB)' },
      { key: 'Prefix Cache Hits Total', label: 'Cache Hits', unit: '', description: 'Total prefix cache hits' },
      { key: 'Prefix Cache Queries Total', label: 'Cache Queries', unit: '', description: 'Total cache queries' },
      { key: 'Gpu Prefix Cache Hits Total', label: 'GPU Hits', unit: '', description: 'GPU prefix cache hits' },
      { key: 'Gpu Prefix Cache Queries Total', label: 'GPU Queries', unit: '', description: 'GPU cache queries' },
      { key: 'Gpu Prefix Cache Hits Created', label: 'GPU Hit Rate', unit: '/s', description: 'GPU cache hit rate' },
      { key: 'Gpu Prefix Cache Queries Created', label: 'GPU Query Rate', unit: '/s', description: 'GPU cache query rate' },
    ]
  },
  'Scheduling & Queueing': {
    icon: ListIcon,
    priority: 4.5,
    description: 'Scheduler performance and batching efficiency',
    metrics: [
      { key: 'Batch Size', label: 'Batch Size', unit: '', description: 'Current batch size' },
      { key: 'Num Scheduled Requests', label: 'Scheduled', unit: '', description: 'Number of scheduled requests' },
      { key: 'Batching Idle Time Seconds', label: 'Idle Time', unit: 's', description: 'Average batching idle time' },
    ]
  },
  'RPC Monitoring': {
    icon: NetworkIcon,
    priority: 5,
    description: 'RPC server monitoring (HTTP metrics removed - will reconsider with namespace filtering)',
    metrics: [
      { key: 'Vllm Rpc Server Error Count', label: 'RPC Errors', unit: '', description: 'RPC server errors' },
      { key: 'Vllm Rpc Server Connection Total', label: 'RPC Connections', unit: '', description: 'Total RPC connections' },
      { key: 'Vllm Rpc Server Request Count', label: 'RPC Requests', unit: '', description: 'Total RPC requests processed' },
    ]
  },
  'GPU Hardware': {
    icon: CubesIcon,
    priority: 6,
    description: 'GPU hardware monitoring and resource usage',
    metrics: [
      // GPU Temperature, GPU Power Usage, GPU Usage removed - shown in Key Metrics
      { key: 'GPU Energy Consumption (Joules)', label: 'Energy', unit: 'J', description: 'Total energy consumed' },
      { key: 'GPU Memory Usage (GB)', label: 'Memory', unit: 'GB', description: 'GPU memory used' },
      { key: 'GPU Memory Temperature (°C)', label: 'Mem Temp', unit: '°C', description: 'GPU memory temperature' },
    ]
  },
  'Request Parameters': {
    icon: CogIcon,
    priority: 7,
    description: 'Request configuration and parameter analysis',
    metrics: [
      { key: 'Request Max Num Generation Tokens Sum', label: 'Max Gen Tokens', unit: '', description: 'Max generation tokens requested' },
      { key: 'Request Max Num Generation Tokens Count', label: 'Max Gen Reqs', unit: '', description: 'Requests with max gen tokens' },
      { key: 'Request Params Max Tokens Sum', label: 'Max Params', unit: '', description: 'Max tokens parameter sum' },
      { key: 'Request Params Max Tokens Count', label: 'Param Reqs', unit: '', description: 'Requests with max tokens param' },
      { key: 'Request Params N Sum', label: 'N Parameter', unit: '', description: 'N parameter sum' },
      { key: 'Request Params N Count', label: 'N Reqs', unit: '', description: 'Requests with N parameter' },
      { key: 'Iteration Tokens Total Sum', label: 'Iter Tokens', unit: '', description: 'Tokens per iteration' },
      { key: 'Iteration Tokens Total Count', label: 'Iterations', unit: '', description: 'Total iterations' },
    ]
  },
};
