# Helm Charts Image Management

## Overview

This directory contains Helm charts for deploying the AI Observability Summarizer. Both image repositories and versions are centralized in the Makefile using Helm's `--set` option.

## Image Management

### How It Works

1. **Repository and version defined in Makefile**:

   - `VERSION ?= <automatically-updated>` (updated on each successful PR merge to `dev`/`main`)
   - `METRICS_ALERTING_IMAGE = $(REGISTRY)/$(ORG)/$(IMAGE_PREFIX)-metrics-alerting`
   - `MCP_SERVER_IMAGE = $(REGISTRY)/$(ORG)/$(IMAGE_PREFIX)-mcp-server`
   - `CONSOLE_PLUGIN_IMAGE = $(REGISTRY)/$(ORG)/$(IMAGE_PREFIX)-console-plugin`
   - `REACT_UI_IMAGE = $(REGISTRY)/$(ORG)/$(IMAGE_PREFIX)-react-ui`

   **Note**: The observability charts (S4, Tempo, OTEL Collector) and RAG charts use external images and are not automatically updated by the CI/CD pipeline. Application charts for alerting, mcp-server, console-plugin, and react-ui are automatically versioned.

2. **Helm commands use `--set` for both repository and tag**:

   - `--set image.repository=$(MCP_SERVER_IMAGE)`
   - `--set image.tag=$(VERSION)`

3. **Values override defaults**: Helm automatically overrides values.yaml defaults
4. **No file generation needed**: Direct helm command execution

### Automated Version Management

The `VERSION` variable in the Makefile is **automatically updated** by the GitHub Actions CI/CD pipeline on every successful PR merge to `dev` or `main` branches using semantic versioning.

**Manual Override**: You can override `VERSION` for local development when needed.

📖 **[GitHub Actions Documentation](GITHUB_ACTIONS.md)** - Complete details about automated version management, semantic versioning rules, and CI/CD workflows.

## Pinned chart dependencies

`make depend` packages the eight local child charts into `deploy/helm/aiobs-stack/charts/`. The shared `aws-compatible-storage-0.1.0.tgz` chart and the three pinned RAG dependency packages are kept in this repository so a fresh checkout can render the umbrella and its S4 bucket Job without a chart repository refresh. Run `make depend` after changing a local chart. Update `Chart.lock` and the pinned packages together when changing published dependency versions.

The operator packaging step uses the same local packaging script before it copies the umbrella chart. The operator and direct Helm release paths therefore use the same S4 dependency, Supervisor config, and parent bucket Job. For a direct `make install-s4`, the Makefile applies the Supervisor ConfigMap before upgrading the S4 release; the umbrella chart renders that ConfigMap itself.

## Further Documentation

For command usage and chart-specific configuration, see:

- `README.md`
- `docs/GITHUB_ACTIONS.md`
- chart READMEs under `deploy/helm/`
