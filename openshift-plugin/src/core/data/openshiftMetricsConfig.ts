import {
  ClusterIcon,
  RunningIcon,
  DatabaseIcon,
  ServerIcon,
  CubesIcon,
  NetworkIcon,
} from '@patternfly/react-icons';

export interface OpenShiftMetric {
  key: string;
  label: string;
  unit: string;
  description: string;
}

export interface OpenShiftMetricCategory {
  icon: React.ComponentType;
  description: string;
  metrics: OpenShiftMetric[];
}

// Metric categories with icons - matching MCP server categories exactly
export const CLUSTER_WIDE_CATEGORIES: Record<string, OpenShiftMetricCategory> = {
  'Fleet Overview': {
    icon: ClusterIcon,
    description: 'Cluster-wide pod, deployment, and service metrics',
    metrics: [
      { key: 'Total Pods Running', label: 'Pods Running', unit: '', description: 'Currently running across cluster' },
      { key: 'Total Pods Failed', label: 'Pods Failed', unit: '', description: 'Pods requiring attention' },
      { key: 'Pods Pending', label: 'Pods Pending', unit: '', description: 'Waiting for scheduling' },
      { key: 'Total Deployments', label: 'Deployments', unit: '', description: 'Active across all namespaces' },
      { key: 'Cluster CPU Usage (%)', label: 'CPU %', unit: '%', description: 'Current cluster utilization' },
      { key: 'Cluster Memory Usage (%)', label: 'Memory %', unit: '%', description: 'Current cluster utilization' },
      { key: 'Total Services', label: 'Services', unit: '', description: 'LoadBalancer and ClusterIP' },
      { key: 'Total Nodes', label: 'Nodes', unit: '', description: 'Available cluster nodes' },
      { key: 'Total Namespaces', label: 'Namespaces', unit: '', description: 'Active project namespaces' },
    ]
  },
  'Jobs & Workloads': {
    icon: RunningIcon,
    description: 'Job execution and workload status',
    metrics: [
      { key: 'Jobs Running', label: 'Jobs Active', unit: '', description: 'Currently executing' },
      { key: 'Jobs Completed', label: 'Jobs Done', unit: '', description: 'Successfully finished' },
      { key: 'Jobs Failed', label: 'Jobs Failed', unit: '', description: 'Require investigation' },
      { key: 'CronJobs', label: 'CronJobs', unit: '', description: 'Scheduled job definitions' },
      { key: 'DaemonSets Ready', label: 'DaemonSets', unit: '', description: 'Running on all nodes' },
      { key: 'StatefulSets Ready', label: 'StatefulSets', unit: '', description: 'Persistent workloads ready' },
      { key: 'ReplicaSets Ready', label: 'ReplicaSets', unit: '', description: 'Scalable workloads ready' },
    ]
  },
  'Storage & Config': {
    icon: DatabaseIcon,
    description: 'Storage volumes and configuration resources',
    metrics: [
      { key: 'Persistent Volumes', label: 'PVs', unit: '', description: 'Available storage volumes' },
      { key: 'PV Claims', label: 'PVCs', unit: '', description: 'Storage requests by pods' },
      { key: 'PVC Bound', label: 'PVC Bound', unit: '', description: 'Successfully attached' },
      { key: 'PVC Pending', label: 'PVC Pending', unit: '', description: 'Waiting for provisioning' },
      { key: 'ConfigMaps', label: 'ConfigMaps', unit: '', description: 'Non-secret configuration' },
      { key: 'Secrets', label: 'Secrets', unit: '', description: 'Encrypted configuration' },
      { key: 'Storage Classes', label: 'StorageClasses', unit: '', description: 'Storage tier definitions' },
    ]
  },
  'Node Metrics': {
    icon: ServerIcon,
    description: 'Node-level resource and health metrics',
    metrics: [
      { key: 'Node CPU Usage (%)', label: 'CPU %', unit: '%', description: 'Average across all nodes' },
      { key: 'Node Memory Available (GB)', label: 'Mem Avail', unit: 'GB', description: 'Free memory across nodes' },
      { key: 'Node Memory Total (GB)', label: 'Mem Total', unit: 'GB', description: 'Cluster memory capacity' },
      { key: 'Node Disk Reads', label: 'Disk Reads', unit: '/s', description: 'Read operations per second' },
      { key: 'Node Disk Writes', label: 'Disk Writes', unit: '/s', description: 'Write operations per second' },
      { key: 'Nodes Ready', label: 'Ready', unit: '', description: 'Available for workloads' },
      { key: 'Nodes Not Ready', label: 'Not Ready', unit: '', description: 'Require investigation' },
      { key: 'Memory Pressure', label: 'MemPressure', unit: '', description: 'Low memory warnings' },
      { key: 'Disk Pressure', label: 'DiskPressure', unit: '', description: 'Low disk space warnings' },
      { key: 'PID Pressure', label: 'PIDPressure', unit: '', description: 'Process limit warnings' },
    ]
  },
  'GPU & Accelerators': {
    icon: CubesIcon,
    description: 'GPU and accelerator metrics (NVIDIA/Intel Gaudi)',
    metrics: [
      { key: 'GPU Temperature (°C)', label: 'Temp', unit: '°C', description: 'Average GPU core temp' },
      { key: 'GPU Power Usage (W)', label: 'Power', unit: 'W', description: 'Current power consumption' },
      { key: 'GPU Utilization (%)', label: 'Util %', unit: '%', description: 'Compute utilization' },
      { key: 'GPU Memory Used (GB)', label: 'Mem Used', unit: 'GB', description: 'VRAM currently allocated' },
      { key: 'GPU Count', label: 'GPU Count', unit: '', description: 'Available accelerators' },
      { key: 'GPU Memory Temp (°C)', label: 'Mem Temp', unit: '°C', description: 'VRAM temperature' },
      { key: 'GPU Clock Speed', label: 'Clock', unit: 'MHz', description: 'Core clock frequency' },
      { key: 'GPU Energy Usage', label: 'Energy', unit: 'J', description: 'Cumulative energy consumed' },
    ]
  },
  'Autoscaling & Scheduling': {
    icon: NetworkIcon,
    description: 'Autoscaling and pod scheduling metrics',
    metrics: [
      { key: 'Pending Pods', label: 'Pending', unit: '', description: 'Awaiting node placement' },
      { key: 'Scheduler Latency (s)', label: 'Sched Latency', unit: 's', description: '99th percentile delay' },
      { key: 'CPU Requests Total', label: 'CPU Req', unit: 'cores', description: 'Reserved CPU across pods' },
      { key: 'CPU Limits Total', label: 'CPU Lim', unit: 'cores', description: 'Maximum CPU allowed' },
      { key: 'Memory Requests (GB)', label: 'Mem Req', unit: 'GB', description: 'Reserved memory across pods' },
      { key: 'Memory Limits (GB)', label: 'Mem Lim', unit: 'GB', description: 'Maximum memory allowed' },
      { key: 'HPA Active', label: 'HPA Current', unit: '', description: 'Auto-scaled replicas' },
      { key: 'HPA Desired', label: 'HPA Desired', unit: '', description: 'Target replica count' },
    ]
  },
  'Pod & Container Metrics': {
    icon: CubesIcon,
    description: 'Pod and container resource usage',
    metrics: [
      { key: 'Pod CPU Usage (cores)', label: 'CPU', unit: 'cores', description: 'Current CPU usage' },
      { key: 'CPU Throttled (%)', label: 'Throttled', unit: '%', description: 'Containers hitting limits' },
      { key: 'Pod Memory (GB)', label: 'Memory', unit: 'GB', description: 'Active memory usage' },
      { key: 'RSS Memory (GB)', label: 'RSS', unit: 'GB', description: 'Physical memory used' },
      { key: 'Container Restarts', label: 'Restarts', unit: '', description: 'Container restart count' },
      { key: 'Pods Ready', label: 'Ready', unit: '', description: 'Running pods' },
      { key: 'Pods Not Ready', label: 'Not Ready', unit: '', description: 'Need investigation' },
      { key: 'Container OOM Killed', label: 'OOM Killed', unit: '', description: 'Memory limit exceeded' },
    ]
  },
  'Network Metrics': {
    icon: NetworkIcon,
    description: 'Network I/O metrics',
    metrics: [
      { key: 'Network RX (MB/s)', label: 'RX', unit: 'MB/s', description: 'Incoming data rate' },
      { key: 'Network TX (MB/s)', label: 'TX', unit: 'MB/s', description: 'Outgoing data rate' },
      { key: 'Network RX Packets', label: 'RX Pkts', unit: '/s', description: 'Incoming packets per sec' },
      { key: 'Network TX Packets', label: 'TX Pkts', unit: '/s', description: 'Outgoing packets per sec' },
      { key: 'Network RX Errors', label: 'RX Errors', unit: '/s', description: 'Incoming error rate' },
      { key: 'Network TX Errors', label: 'TX Errors', unit: '/s', description: 'Outgoing error rate' },
      { key: 'Network RX Dropped', label: 'RX Dropped', unit: '/s', description: 'Incoming packets dropped' },
      { key: 'Network TX Dropped', label: 'TX Dropped', unit: '/s', description: 'Outgoing packets dropped' },
    ]
  },
  'Storage I/O': {
    icon: DatabaseIcon,
    description: 'Storage and filesystem metrics',
    metrics: [
      { key: 'Disk Read (MB/s)', label: 'Read', unit: 'MB/s', description: 'Storage read throughput' },
      { key: 'Disk Write (MB/s)', label: 'Write', unit: 'MB/s', description: 'Storage write throughput' },
      { key: 'Disk Read IOPS', label: 'Read IOPS', unit: '/s', description: 'Read operations per sec' },
      { key: 'Disk Write IOPS', label: 'Write IOPS', unit: '/s', description: 'Write operations per sec' },
      { key: 'Filesystem Usage (GB)', label: 'FS Used', unit: 'GB', description: 'Container filesystem used' },
      { key: 'Filesystem Limit (GB)', label: 'FS Limit', unit: 'GB', description: 'Container filesystem cap' },
      { key: 'PVC Used (GB)', label: 'PVC Used', unit: 'GB', description: 'Persistent storage used' },
      { key: 'PVC Capacity (GB)', label: 'PVC Cap', unit: 'GB', description: 'Persistent storage limit' },
    ]
  },
  'Services & Networking': {
    icon: ServerIcon,
    description: 'Services and ingress metrics',
    metrics: [
      { key: 'Services Running', label: 'Services', unit: '', description: 'Active services' },
      { key: 'Service Endpoints', label: 'Endpoints', unit: '', description: 'Backend pod targets' },
      { key: 'Ingress Rules', label: 'Ingresses', unit: '', description: 'HTTP routing rules' },
      { key: 'Network Policies', label: 'NetPolicies', unit: '', description: 'Traffic access controls' },
      { key: 'Load Balancer Services', label: 'LB Svcs', unit: '', description: 'External load balancers' },
      { key: 'ClusterIP Services', label: 'ClusterIP', unit: '', description: 'Internal cluster services' },
    ]
  },
  'Application Services': {
    icon: RunningIcon,
    description: 'Application-level metrics',
    metrics: [
      { key: 'HTTP Request Rate', label: 'Req/s', unit: '/s', description: 'HTTP request rate' },
      { key: 'HTTP Error Rate (%)', label: 'Error %', unit: '%', description: 'HTTP error rate' },
      { key: 'HTTP P95 Latency (s)', label: 'P95', unit: 's', description: 'P95 latency' },
      { key: 'HTTP P99 Latency (s)', label: 'P99', unit: 's', description: 'P99 latency' },
      { key: 'Active Connections', label: 'Connections', unit: '', description: 'Active connections' },
      { key: 'Ingress Request Rate', label: 'Ingress Req', unit: '/s', description: 'Ingress request rate' },
    ]
  },
};
