# Helm Charts Image Management

## Overview

This directory contains Helm charts for deploying the AI Observability Summarizer. Both image repositories and versions are centralized in the Makefile using Helm's `--set` option.

## Image Management

### How It Works

1. **Repository and version defined in Makefile**:

   - `VERSION ?= <automatically-updated>` (updated on each successful PR merge to `dev`/`main`)
   - `METRICS_UI_IMAGE = $(REGISTRY)/$(ORG)/$(IMAGE_PREFIX)-metrics-ui`
   - `METRICS_ALERTING_IMAGE = $(REGISTRY)/$(ORG)/$(IMAGE_PREFIX)-metrics-alerting`
   - `MCP_SERVER_IMAGE = $(REGISTRY)/$(ORG)/$(IMAGE_PREFIX)-mcp-server`

   **Note**: The observability charts (MinIO, Tempo, OTEL Collector) and RAG charts use external images and are not automatically updated by the CI/CD pipeline. Only the application charts (ui, mcp-server, alerting) are automatically versioned.

2. **Helm commands use `--set` for both repository and tag**:

   - `--set image.repository=$(MCP_SERVER_IMAGE)`
   - `--set image.tag=$(VERSION)`

3. **Values override defaults**: Helm automatically overrides values.yaml defaults
4. **No file generation needed**: Direct helm command execution

### Automated Version Management

The `VERSION` variable in the Makefile is **automatically updated** by the GitHub Actions CI/CD pipeline on every successful PR merge to `dev` or `main` branches using semantic versioning.

**Manual Override**: You can override `VERSION` for local development when needed.

📖 **[GitHub Actions Documentation](GITHUB_ACTIONS.md)** - Complete details about automated version management, semantic versioning rules, and CI/CD workflows.

## Further Documentation

For command usage and chart-specific configuration, see:

- `README.md`
- `docs/GITHUB_ACTIONS.md`
- chart READMEs under `deploy/helm/`
