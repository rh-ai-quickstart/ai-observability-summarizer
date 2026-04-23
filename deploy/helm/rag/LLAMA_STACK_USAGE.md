# LlamaStack Operator Support

This directory uses the official llama-stack Helm chart with operator support via the `managedByOperator` flag.

## Current Setup

The chart uses:
- **Repository**: `https://rh-ai-quickstart.github.io/ai-architecture-charts`
- **Version**: `0.7.4`

## Deployment Modes

### Non-Operator Mode (Default)
```bash
make install NAMESPACE=test
# or explicitly:
make install NAMESPACE=test USE_LLAMA_STACK_OPERATOR=false
```
- Deploys llama-stack as a regular Kubernetes Deployment
- Service name: `llamastack`
- Uses: `llama-stack.managedByOperator=false` (default)

### Operator Mode (RHOAI 3.x)
```bash
make install NAMESPACE=test USE_LLAMA_STACK_OPERATOR=true
```
- Creates a `LlamaStackDistribution` CRD instead of Deployment
- The RHOAI LlamaStack operator reconciles the CR
- Service name: `llamastack-service`
- Uses: `llama-stack.managedByOperator=true`
- Requires: LlamaStack operator enabled in DataScienceCluster

## Auto-Detection (RHOAI 3.x)

On RHOAI 3.x clusters, the Makefile automatically detects if the LlamaStack operator is enabled (managementState: Managed) in the DataScienceCluster and switches to operator mode:

```bash
# Auto-detection in action
make install NAMESPACE=test
# Output: ℹ️  Auto-detected LlamaStack operator (Managed) — switching to operator mode
```

To override auto-detection and force Helm chart mode:
```bash
make install NAMESPACE=test USE_LLAMA_STACK_OPERATOR=false
```

## Enabling the Operator

To enable the LlamaStack operator in your cluster:
```bash
make enable-llamastack-operator
```

This sets `spec.components.llamastackoperator.managementState: Managed` in the DataScienceCluster.

## Configuration

llama-stack configuration is in `deploy/helm/rag/values.yaml`:

```yaml
llama-stack:
  enabled: true
  managedByOperator: false  # Set by Makefile based on USE_LLAMA_STACK_OPERATOR
  env:
    - name: RUN_CONFIG_PATH
      value: /app-config/config.yaml
    # ... more env vars
  
  # Operator-specific configuration (only used when managedByOperator: true)
  network:
    exposeRoute: false
    allowedFrom:
      namespaces:
        - "namespace-name"  # Dynamically set at install time
```

## Upgrading

To upgrade to a newer llama-stack chart version:

1. Update `deploy/helm/rag/Chart.yaml`:
   ```yaml
   dependencies:
     - name: llama-stack
       version: 0.7.5  # or newer
       repository: https://rh-ai-quickstart.github.io/ai-architecture-charts
   ```

2. Update dependencies:
   ```bash
   make depend
   ```

3. Deploy:
   ```bash
   make install
   ```
