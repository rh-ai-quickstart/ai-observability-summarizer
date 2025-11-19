# Intel Gaudi Accelerator Metrics

## Overview

This document describes the Intel Gaudi accelerator metrics integration with the OpenShift AI Observability Summarizer. Intel Gaudi accelerators are monitored via the Habana Labs Prometheus metric exporter, which exposes metrics under the `habanalabs_` prefix.

**Metrics Implementation**: This observability stack implements **24 core Intel Gaudi metrics** that are essential for monitoring accelerator health, performance, and utilization. These metrics are automatically discovered, categorized, and integrated into dashboards alongside NVIDIA DCGM metrics for multi-vendor support.

The monitoring stack has been designed to support multi-vendor GPU/accelerator deployments, allowing different clusters to use either NVIDIA GPUs or Intel Gaudi accelerators (or potentially both, though different clusters typically use different accelerator types).

## Intel Gaudi Prometheus Exporter

### Deployment

The Intel Gaudi Prometheus exporter is deployed as a DaemonSet in Kubernetes/OpenShift clusters with Intel Gaudi accelerators. It exposes metrics on port **41611** using `hostNetwork: true`.

**Documentation**: [Intel Gaudi Prometheus Metric Exporter](https://docs.habana.ai/en/latest/Orchestration/Prometheus_Metric_Exporter.html)

### Verifying Intel Gaudi Operator Installation

Before enabling monitoring, verify that the required operators are installed in your OpenShift cluster.

From the **Administrator** perspective in the OpenShift Console, navigate to **Operators** → **Installed Operators**. Confirm that the following operators appear:

- **Intel Gaudi Base Operator**
- **Node Feature Discovery (NFD)**
- **Kernel Module Management (KMM)**

You can also verify using the CLI:

```bash
# Check for Intel Gaudi Base Operator
oc get csv -A | grep -i gaudi

# Check for Node Feature Discovery
oc get csv -A | grep -i "node-feature-discovery"

# Check for Kernel Module Management
oc get csv -A | grep -i "kernel-module-management"
```

If any of these operators are missing, refer to the installation documentation:
- [Intel Gaudi AI Accelerator integration (Red Hat OpenShift AI)](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.0/html/working_with_accelerators/intel-gaudi-ai-accelerator-integration_accelerators)
- [Intel Gaudi Base Operator for OpenShift (Intel Documentation)](https://docs.habana.ai/en/latest/Installation_Guide/Additional_Installation/OpenShift_Installation/index.html)

## Installing Observability Stack with Intel Gaudi Support

To deploy the OpenShift AI Observability Summarizer with Intel Gaudi (HPU) accelerators, use the included `Makefile` with Intel Gaudi-specific parameters.

### Prerequisites

Before installation, ensure:
- Intel Gaudi Base Operator is installed and verified (see section above)
- You have cluster-admin access to the OpenShift cluster
- Hugging Face account with a valid access token
- Sufficient Intel Gaudi accelerators available in the cluster
- OpenShift CLI (`oc`) is installed and configured

### Installation Commands

#### Basic Installation

Deploy the observability stack with Intel Gaudi support:

```bash
make install NAMESPACE=your-namespace DEVICE=hpu HF_TOKEN=your-hf-token
```

This installs the complete observability stack with the default LLM model (`llama-3-1-8b-instruct`) configured to run on Intel Gaudi accelerators.

#### With Specific LLM Model

To deploy a different model from the available list:

```bash
# List available models
make list-models

# Install with specific model
make install NAMESPACE=test-qs DEVICE=hpu HF_TOKEN=your-hf-token LLM=llama-3-1-8b-instruct
```

#### With Intel Gaudi Node Tolerations

If your Intel Gaudi nodes have taints (e.g., dedicated Gaudi nodes), add tolerations:

```bash
make install NAMESPACE=your-namespace \
  DEVICE=hpu \
  HF_TOKEN=your-hf-token \
  LLM=llama-3-1-8b-instruct \
  LLM_TOLERATION="habana.ai/gaudi"
```

#### With Alerting Enabled

To enable AI-powered Slack notifications:

```bash
make install NAMESPACE=your-namespace \
  DEVICE=hpu \
  HF_TOKEN=your-hf-token \
  LLM=llama-3-1-8b-instruct \
  ALERTS=TRUE
```

### Installation Parameters

| Parameter | Description | Required | Default | Example |
|-----------|-------------|----------|---------|---------|
| `NAMESPACE` | Target OpenShift namespace for deployment | Yes | - | `test-qs` |
| `DEVICE` | Accelerator type (`hpu` for Intel Gaudi, `gpu` for NVIDIA) | Yes | `gpu` | `hpu` |
| `HF_TOKEN` | Hugging Face access token for model downloads | Yes* | - | `hf_xxxxx` |
| `LLM` | Model ID to deploy | No | `llama-3-1-8b-instruct` | `llama-3-2-3b-instruct` |
| `LLM_TOLERATION` | Kubernetes toleration for accelerator nodes | No | - | `habana.ai/gaudi` |
| `ALERTS` | Enable alerting and Slack notifications | No | `FALSE` | `TRUE` |
| `SLACK_WEBHOOK_URL` | Slack webhook URL (required if ALERTS=TRUE) | Conditional | - | `https://hooks.slack.com/...` |

\* Required unless using an existing LLM deployment via `LLM_URL`

### Post-Installation Verification

After installation, verify the deployment:

1. **Check pod status**:
   ```bash
   oc get pods -n your-namespace
   ```

   Expected pods:
   - `llm-service-*` - LLM inference on Intel Gaudi
   - `llama-stack-*` - Backend API
   - `metric-ui-*` - Streamlit dashboard
   - `mcp-server-*` - Model Context Protocol server

2. **Verify Intel Gaudi allocation**:
   ```bash
   oc describe pod -n your-namespace llm-service-xxxxx | grep -i habana
   ```

3. **Access the application**:
   ```bash
   oc get route -n your-namespace
   ```

   Navigate to the route URL to access the Streamlit dashboard.

4. **Check logs for Gaudi initialization**:
   ```bash
   oc logs -n your-namespace deployment/llm-service | grep -i "gaudi\|hpu"
   ```

### Uninstallation

To remove the observability stack:

```bash
make uninstall NAMESPACE=your-namespace
```

To also remove the observability operators and stack:

```bash
make uninstall NAMESPACE=your-namespace \
  UNINSTALL_OBSERVABILITY=true \
  UNINSTALL_OPERATORS=true
```

### Troubleshooting Installation

#### LLM Service Not Starting

If the LLM service pod fails to start:

```bash
# Check pod events
oc describe pod -n your-namespace llm-service-xxxxx

# Check logs
oc logs -n your-namespace deployment/llm-service
```

Common issues:
- **Missing HF_TOKEN**: Verify the secret is created: `oc get secret -n your-namespace`
- **No Gaudi available**: Check node resources: `oc get nodes -o json | jq '.items[].status.allocatable'`
- **Image pull errors**: Verify network connectivity and registry access

#### Gaudi Resources Not Detected

Verify Intel Gaudi resources are advertised:

```bash
# Check node capacity
oc get nodes -o json | jq '.items[] | {name: .metadata.name, capacity: .status.capacity}'

# Look for habana.ai/gaudi resources
```

If resources are missing, verify the Intel Gaudi Base Operator installation.

### Enabling Monitoring for User-Defined Projects

In OpenShift Container Platform, Intel Gaudi metrics are collected through user workload monitoring. You must enable monitoring for user-defined projects to collect these metrics.

**Prerequisites:**
- You have access to the cluster as a user with the `cluster-admin` role
- Intel Gaudi Prometheus exporter is deployed in your namespace
- You have installed the OpenShift CLI (`oc`)
- For Intel Gaudi accelerator setup in OpenShift AI, see:
  - [Intel Gaudi AI Accelerator integration (Red Hat OpenShift AI)](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.0/html/working_with_accelerators/intel-gaudi-ai-accelerator-integration_accelerators)
  - [Intel Gaudi Base Operator for OpenShift (Intel Documentation)](https://docs.habana.ai/en/latest/Installation_Guide/Additional_Installation/OpenShift_Installation/index.html)

**Procedure:**

1. **Enable user workload monitoring** by editing the cluster monitoring ConfigMap:

   ```bash
   oc -n openshift-monitoring edit configmap cluster-monitoring-config
   ```

2. **Add or update** the `enableUserWorkload` setting under `data/config.yaml`:

   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: cluster-monitoring-config
     namespace: openshift-monitoring
   data:
     config.yaml: |
       enableUserWorkload: true
   ```

3. **Save the file** to apply the changes. User workload monitoring is enabled automatically.

4. **Verify** that the monitoring components are running:

   ```bash
   oc -n openshift-user-workload-monitoring get pod
   ```

   You should see pods like `prometheus-user-workload`, `prometheus-operator`, and `thanos-ruler-user-workload`.

> **Note**: The Habana AI metric exporter (`habana-ai-metric-exporter-ds`) is deployed as a DaemonSet in the `habana-ai-operator` namespace. It includes its own ServiceMonitor (`metric-exporter`) for metric collection and uses standard Kubernetes labels (`app.kubernetes.io/name=habana-ai`).

**Reference**: [OpenShift Container Platform - Enabling monitoring for user-defined projects](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/monitoring/configuring-user-workload-monitoring#enabling-monitoring-for-user-defined-projects-uwm_preparing-to-configure-the-monitoring-stack-uwm)

### Accessing Metrics

Once user workload monitoring is enabled, metrics are automatically collected and can be queried through:

1. **OpenShift Console**: Navigate to **Observe > Metrics** and use PromQL queries
2. **Thanos Querier API**: Query programmatically using the Thanos endpoint
3. **Grafana**: If deployed, configure Thanos as a data source

### Querying Intel Gaudi Metrics

**Port-Forward Thanos Querier to access metrics in your browser:**

```bash
# Port-forward Thanos Querier to localhost
oc port-forward -n openshift-monitoring svc/thanos-querier 9090:9091
```

Then open your browser and navigate to: **http://localhost:9090**

**To explore Intel Gaudi metrics in the browser:**
1. In the query box, type: `habanalabs_` and press Tab for autocomplete
2. Select a metric like `habanalabs_temperature_onchip`
3. Click **Execute** to see the current values
4. Click **Graph** tab to see trends over time
5. Use filters like `habanalabs_temperature_onchip{namespace="your-namespace"}` to scope results

**Example queries to try:**
- `habanalabs_temperature_onchip` - Current GPU temperature
- `habanalabs_utilization` - GPU utilization percentage
- `habanalabs_memory_used_bytes / habanalabs_memory_total_bytes * 100` - Memory usage %
- `rate(habanalabs_energy[5m])` - Energy consumption rate

## Intel Gaudi Metrics Catalog

### Metrics Implemented in This Observability Stack

The following Intel Gaudi metrics are actively collected and used by this observability stack. These metrics are automatically discovered and integrated into dashboards and queries.

| Category | Intel Gaudi Metric | NVIDIA DCGM Equivalent | Unit | Used In |
|----------|-------------------|----------------------|------|---------|
| **Temperature** | `habanalabs_temperature_onchip` | `DCGM_FI_DEV_GPU_TEMP` | Celsius | Dashboards, Fleet Overview |
| | `habanalabs_temperature_onboard` | N/A | Celsius | Discovery Function |
| | `habanalabs_temperature_threshold_gpu` | N/A | Celsius | Discovery Function |
| | `habanalabs_temperature_threshold_memory` | `DCGM_FI_DEV_MEMORY_TEMP` | Celsius | Dashboards |
| **Power** | `habanalabs_power_mW` | `DCGM_FI_DEV_POWER_USAGE` | mW (÷1000 for Watts) | Dashboards, Fleet Overview |
| | `habanalabs_power_default_limit_mW` | N/A | mW | Discovery Function |
| **Utilization** | `habanalabs_utilization` | `DCGM_FI_DEV_GPU_UTIL` | Percent | Dashboards, vLLM Monitoring |
| **Memory** | `habanalabs_memory_used_bytes` | `DCGM_FI_DEV_FB_USED` | Bytes | Dashboards (converted to GB) |
| | `habanalabs_memory_total_bytes` | `DCGM_FI_DEV_FB_TOTAL` | Bytes | Memory % calculation |
| | `habanalabs_memory_free_bytes` | N/A | Bytes | Discovery Function |
| **Clock Speed** | `habanalabs_clock_soc_mhz` | `DCGM_FI_DEV_SM_CLOCK` | MHz | Discovery Function |
| | `habanalabs_clock_soc_max_mhz` | N/A | MHz | Discovery Function |
| **Energy** | `habanalabs_energy` | `DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION` | Joules | Dashboards |
| **PCIe** | `habanalabs_pcie_rx` | N/A | Bytes | Discovery Function |
| | `habanalabs_pcie_tx` | N/A | Bytes | Discovery Function |
| | `habanalabs_pcie_receive_throughput` | N/A | Throughput | Discovery Function |
| | `habanalabs_pcie_transmit_throughput` | N/A | Throughput | Discovery Function |
| | `habanalabs_pcie_replay_count` | N/A | Count | Discovery Function |
| | `habanalabs_pci_link_speed` | N/A | Speed | Discovery Function |
| | `habanalabs_pci_link_width` | N/A | Width | Discovery Function |
| **ECC/Health** | `habanalabs_ecc_feature_mode` | N/A | Status | Discovery Function |
| | `habanalabs_pending_rows_with_single_bit_ecc_errors` | N/A | Count | Discovery Function |
| | `habanalabs_pending_rows_with_double_bit_ecc_errors` | N/A | Count | Discovery Function |
| **Network** | `habanalabs_nic_port_status` | N/A | Status | Discovery Function |

**Total: 24 metrics actively used** by the observability stack.

### Additional Available Metrics

The Intel Gaudi Prometheus exporter exposes additional metrics that are not currently used by this observability stack but are available for custom queries and dashboards:

**Temperature Thresholds (Not Currently Used):**
- `habanalabs_temperature_threshold_shutdown` - Temperature at which device shuts down
- `habanalabs_temperature_threshold_slowdown` - Temperature at which device slows down

**Memory Health (Not Currently Used):**
- `habanalabs_pending_rows_state` - Number of memory rows in pending state

**Device Information (Not Currently Used):**
- `habanalabs_device_config` - Device configuration metadata

> **Note**: These metrics are available from the Intel Gaudi exporter but are not actively integrated into the default dashboards or metric discovery functions. You can query them manually if needed for specific use cases.

## Query Examples

### Basic Monitoring Queries

#### Average GPU Temperature Across All Gaudi Accelerators
```promql
avg(habanalabs_temperature_onchip)
```

#### GPU Utilization Per Device
```promql
habanalabs_utilization
```

#### Power Usage in Watts (Convert from mW)
```promql
avg(habanalabs_power_mW) / 1000
```

#### Memory Usage Percentage
```promql
(avg(habanalabs_memory_used_bytes) / avg(habanalabs_memory_total_bytes)) * 100
```

#### Memory Usage in GB
```promql
avg(habanalabs_memory_used_bytes) / (1024*1024*1024)
```

### Advanced Monitoring Queries

#### PCIe Throughput Rate
```promql
rate(habanalabs_pcie_rx[5m]) + rate(habanalabs_pcie_tx[5m])
```

#### Energy Consumption Rate
```promql
rate(habanalabs_energy[1h])
```

#### ECC Errors Total
```promql
sum(habanalabs_pending_rows_with_single_bit_ecc_errors) + sum(habanalabs_pending_rows_with_double_bit_ecc_errors)
```

#### High Temperature Alert Query
```promql
habanalabs_temperature_onchip > 80
```

#### High Power Usage Alert Query
```promql
habanalabs_power_mW > 400000  # 400W
```

### Multi-Vendor Queries

The monitoring stack supports vendor-agnostic queries that work with both NVIDIA and Intel Gaudi:

#### GPU Temperature (Any Vendor)
```promql
avg(DCGM_FI_DEV_GPU_TEMP) or avg(habanalabs_temperature_onchip)
```

#### GPU Utilization (Any Vendor)
```promql
avg(DCGM_FI_DEV_GPU_UTIL) or avg(habanalabs_utilization)
```

#### GPU Memory Usage in GB (Any Vendor)
```promql
avg(DCGM_FI_DEV_FB_USED) / (1024*1024*1024) or avg(habanalabs_memory_used_bytes) / (1024*1024*1024)
```

## Integration with Observability Stack

### Automatic Discovery

The observability stack automatically discovers available Intel Gaudi metrics through the `discover_intel_gaudi_metrics()` function in `src/core/metrics.py`. This function:

1. Queries Prometheus for all metrics with the `habanalabs_` prefix
2. Maps them to friendly names for dashboard display
3. Configures appropriate aggregations and units
4. Returns a dictionary of available metrics

### Dashboard Integration

Intel Gaudi metrics are integrated into existing dashboards:

- **Fleet Overview**: Shows GPU utilization and temperature for available accelerators
- **GPU & Accelerators**: Comprehensive accelerator monitoring section with vendor-agnostic queries
- **vLLM Monitoring**: Automatically uses Intel Gaudi metrics when NVIDIA metrics are unavailable

### Metric Categorization

Intel Gaudi metrics are categorized in `src/core/promql_service.py`:

- **Type**: `gpu`
- **Categories**: `["hardware_metric", "gpu_metric", "intel_gaudi_metric"]`
- **Vendor Detection**: Automatic based on `habanalabs_` prefix
- **Unit Conversion**: Power converted from mW to W for consistency

## Troubleshooting

### No Metrics Available

If Intel Gaudi metrics are not appearing:

1. **Verify user workload monitoring is enabled**:
   ```bash
   oc -n openshift-user-workload-monitoring get pods
   ```
   You should see `prometheus-user-workload` pods running.

2. **Check Intel Gaudi exporter deployment**:
   ```bash
   # The Habana AI metric exporter is deployed as a DaemonSet in the habana-ai-operator namespace
   # Pod names follow the pattern: habana-ai-metric-exporter-ds-xxxxx
   oc get pods -n habana-ai-operator -l app.kubernetes.io/name=habana-ai
   ```

3. **Verify ServiceMonitor exists**:
   ```bash
   # Check if the metric-exporter ServiceMonitor is deployed
   oc get servicemonitor -n habana-ai-operator
   ```
   You should see `metric-exporter` in the list. This ServiceMonitor configures Prometheus to scrape Intel Gaudi metrics.

4. **Check if metrics are exposed**:
   ```bash
   # Get the exporter pod name
   POD=$(oc get pods -n habana-ai-operator -l app.kubernetes.io/name=habana-ai -o name | head -n 1)
   
   # Port-forward to the exporter (uses port 41611)
   oc port-forward -n habana-ai-operator $POD 41611:41611 &
   
   # Query metrics directly
   curl http://localhost:41611/metrics | grep habanalabs
   
   # Stop port-forward
   pkill -f "port-forward.*41611"
   ```

5. **Review exporter logs**:
   ```bash
   oc logs -n habana-ai-operator -l app.kubernetes.io/name=habana-ai
   ```

### Metrics Not Discovered by Observability Stack

If metrics are available but not appearing in the observability stack:

1. **Check Thanos can query the metrics**:
   ```bash
   # Port-forward Thanos Querier
   oc port-forward -n openshift-monitoring svc/thanos-querier 9090:9091 &
   
   # Query for Intel Gaudi metrics
   curl -s "http://localhost:9090/api/v1/label/__name__/values" | grep habanalabs
   
   # Stop port-forward
   pkill -f "port-forward.*thanos-querier"
   ```

2. **Verify metrics are being scraped**:
   - Open browser to Thanos UI: `oc port-forward -n openshift-monitoring svc/thanos-querier 9090:9091`
   - Navigate to http://localhost:9090
   - Go to **Status** → **Targets**
   - Search for your namespace and verify the Intel Gaudi exporter target is UP

3. **Review MCP server logs**:
   ```bash
   oc logs -n <your-namespace> deployment/mcp-server | grep -i "gaudi\|habanalabs"
   ```

## References

- [Intel Gaudi Prometheus Metric Exporter Documentation](https://docs.habana.ai/en/latest/Orchestration/Prometheus_Metric_Exporter.html)
- [Intel Gaudi Architecture Overview](https://docs.habana.ai/en/latest/Gaudi_Overview/Gaudi_Architecture.html)
- [Prometheus Query Language (PromQL)](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [OpenShift AI Observability Overview](./OBSERVABILITY_OVERVIEW.md)

## Support

For issues specific to:
- **Intel Gaudi exporter**: Refer to Intel Gaudi documentation
- **Observability stack integration**: Create an issue in this repository
- **Prometheus/Thanos**: Consult respective project documentation

