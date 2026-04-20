# LlamaStack Operator Support - Using Fork

This directory uses a forked version of the llama-stack Helm chart that includes operator support via the `managedByOperator` flag.

## Current Setup (Temporary)

The chart is configured to use:
- **Repository**: `https://github.com/jianrongzhang89/ai-architecture-charts`
- **Branch**: `operator`
- **Version**: `0.7.3`

## How It Works

When you run `make depend`, the Makefile automatically:
1. Clones the fork to `../ai-architecture-charts-fork` (if not already present)
2. Checks out the `operator` branch
3. Packages the `llama-stack` chart to `deploy/helm/rag/llama-stack-fork/llama-stack-0.7.3.tgz`
4. Extracts the packaged chart into `deploy/helm/rag/charts/llama-stack/`
5. Downloads other dependencies (llm-service, pgvector) from official repository

**Note**: The llama-stack dependency is commented out in `Chart.yaml` because it's handled manually by the Makefile. This avoids Helm trying to fetch from a file:// repository which has compatibility issues.

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

## Switching to Official Release (Future)

Once the official llama-stack chart (v0.6.0+) with operator support is released to `https://rh-ai-quickstart.github.io/ai-architecture-charts`:

1. **Edit `deploy/helm/rag/Chart.yaml`** - uncomment and update llama-stack dependency:
   ```yaml
   dependencies:
     - name: llm-service
       version: 0.5.8
       repository: https://rh-ai-quickstart.github.io/ai-architecture-charts
     - name: llama-stack
       version: 0.6.0  # or later with operator support
       repository: https://rh-ai-quickstart.github.io/ai-architecture-charts
       condition: llama-stack.enabled
     - name: pgvector
       version: 0.5.0
       repository: https://rh-ai-quickstart.github.io/ai-architecture-charts
   ```

2. **Edit `Makefile`** - simplify the `depend` target by removing fork setup:
   ```makefile
   .PHONY: depend
   depend:
       @echo "Updating Helm dependencies (for $(RAG_CHART))..."
       @rm -rf deploy/helm/$(RAG_CHART)/charts
       @cd deploy/helm && helm dependency update $(RAG_CHART) || exit 1
   
       @echo "Updating Helm dependencies (for $(MINIO_CHART))..."
       @rm -rf deploy/helm/$(MINIO_CHART_PATH)/charts
       @cd deploy/helm && helm dependency update $(MINIO_CHART_PATH) || exit 1
   ```

3. **Remove fork-related code** from Makefile:
   - Remove `FORK_CHARTS_DIR`, `FORK_REPO_URL`, `FORK_BRANCH` variables
   - Remove `setup-llama-stack-fork` target

4. **Clean up fork artifacts**:
   ```bash
   rm -rf deploy/helm/rag/llama-stack-fork
   rm -rf ../ai-architecture-charts-fork  # optional
   rm deploy/helm/rag/LLAMA_STACK_FORK_USAGE.md  # this file
   ```

5. **Update dependencies**:
   ```bash
   make depend
   ```

## Customization

You can override the fork location/branch:

```bash
# Use a different fork location
make depend FORK_CHARTS_DIR=/path/to/your/fork

# Use a different repository
make depend FORK_REPO_URL=https://github.com/youruser/ai-architecture-charts

# Use a different branch
make depend FORK_BRANCH=my-feature-branch
```

## Troubleshooting

### Fork clone fails
Manually clone the fork:
```bash
git clone -b operator https://github.com/jianrongzhang89/ai-architecture-charts ../ai-architecture-charts-fork
```

### Chart packaging fails
Verify the chart exists at the correct path:
```bash
ls -la ../ai-architecture-charts-fork/llama-stack/helm/Chart.yaml
```

### Dependency update fails
Clean and rebuild:
```bash
rm -rf deploy/helm/rag/charts deploy/helm/rag/Chart.lock deploy/helm/rag/llama-stack-fork
make depend
```

### Verify the setup
Check that all charts are present:
```bash
ls -la deploy/helm/rag/charts/
# Should show: llama-stack/, llm-service-*.tgz, pgvector-*.tgz
```
