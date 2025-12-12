# GitHub Actions CI/CD

This document provides detailed information about the GitHub Actions workflows used in this project for automated CI/CD.

## Overview

The project uses 6 GitHub Actions workflows with the following execution order and dependencies:

### PR Review Workflows (Run in Parallel)
1. **Run Tests** (`.github/workflows/run_tests.yml`)
   - **Trigger:** Pull request events (opened, synchronize, reopened) and pushes to `main`/`dev`
   - **Purpose:** Runs the Python test suite with coverage reporting during PR review
   - **Dependencies:** None - runs independently during PR review

2. **Rebase Check** (`.github/workflows/rebase-check.yml`)
   - **Trigger:** Pull request events (opened, synchronize, reopened)
   - **Purpose:** Ensures PRs are up-to-date with base branch before merge
   - **Actions:** Posts rebase instructions if PR is behind, fails the check
   - **Dependencies:** None - runs independently during PR review

### Post-Merge Workflows (Sequential Chain)

3. **Build and Push** (`.github/workflows/build-and-push.yml`)
   - **Trigger:** PRs merged to `main` or `dev` branches, manual dispatch
   - **Purpose:** Builds and pushes container images with semantic versioning
   - **Actions:**
   - **Analyzes PR labels and title first**, then falls back to commit messages for version bumps
   - Gets current version from Makefile (not git tags)
   - Builds 3 container images (using `IMAGE_PREFIX`-component naming):
     - aiobs-metrics-ui
     - aiobs-metrics-alerting
     - aiobs-mcp-server
     - Updates Helm charts and Makefile with new version (**non-main branches only**)
   - **Image tagging:** Each image is tagged with both:
     - Semantic version tag (e.g., `0.1.2`, `1.0.0`)
     - `latest` tag for the most recent build
   - **Version priority:** PR Labels → PR Title → Commit Messages
   - **Version updates:** _Only occur when pushing to non-main branches_
   - **Dependencies:** None - runs after merge

4. **Deploy to OpenShift** (`.github/workflows/deploy.yml`)
   - **Trigger:** Automatic after successful Build workflow, manual dispatch
   - **Purpose:** Deploys application and observability stack to OpenShift cluster
   - **Namespace logic:**
     - Manual dispatch: Uses the `namespace` input if provided
     - Automatic workflow_run: Deploys to namespace matching the branch name that triggered the workflow
     - Workflow_dispatch: Deploys to namespace matching the current branch name
     - Example: PR merged to `feature-x` → deploys to `feature-x` namespace
   - **Components deployed:**
     - Application components (ui, mcp-server, alerting)
     - Observability stack (MinIO + TempoStack + OTEL + tracing)
   - **Dependencies:** ✅ **Requires Build and Push workflow success**

5. **Undeploy from OpenShift** (`.github/workflows/undeploy.yml`)
   - **Trigger:** **Manual only** - requires explicit confirmation
   - **Purpose:** Removes deployments from OpenShift cluster
   - **Safety:** Requires typing exact confirmation string for manual execution
   - **Dependencies:** None - can be run independently

6. **Cleanup Old Summarizer Container Images** (`.github/workflows/cleanup-old-images.yml`)
   - **Trigger:** Monthly schedule (1st day of month at midnight UTC) and manual workflow_dispatch
   - **Purpose:** Deletes old container images from Quay.io to manage storage
   - **Actions:**
     - Processes 3 container images: aiobs-metrics-ui, aiobs-metrics-alerting, aiobs-mcp-server
     - Deletes tags older than retention period (default: 30 days)
     - Protects `latest` tag and all `v*` tags (official releases, e.g., `v1.0.0`)
     - Supports custom retention days and protected tags via inputs
     - Includes dry-run mode for safe testing
   - **Safety:** Defaults to dry-run mode for manual executions
   - **Dependencies:** None - can be run independently
   - **Documentation:** See [SUMMARIZER_QUAY_IMAGE_CLEANUP.md](./SUMMARIZER_QUAY_IMAGE_CLEANUP.md) for detailed usage

### Workflow Dependency Diagram
```
PR Created/Updated
├── Run Tests (parallel) ✅
└── Rebase Check (parallel) ✅

PR Merged to main/dev
└── Build and Push ✅
    └── Deploy to OpenShift ✅

Manual Operations:
└── Undeploy from OpenShift (manual only) ⚠️

Scheduled Operations:
└── Cleanup Old Container Images (monthly + manual) 🗑️
```

## OpenShift Service Account Setup

Before using the GitHub Actions workflows, you need to create a service account with appropriate permissions in your OpenShift cluster.

### Prerequisites
- OpenShift CLI (`oc`) installed and configured
- `envsubst` utility (usually pre-installed on most systems)
- Cluster administrator access to OpenShift

### Setup Instructions

1. **Login to OpenShift:**
   ```bash
   oc login <your-openshift-server-url>
   ```

2. **Run the setup script:**
   ```bash
   # Initial setup and token extraction
   ./scripts/ocp-setup.sh -s -t -n <your-namespace>
   
   # Or run steps separately:
   ./scripts/ocp-setup.sh -s -n <your-namespace>    # Setup only
   ./scripts/ocp-setup.sh -t -n <your-namespace>    # Extract token only
   ```

### What the Script Does

The `scripts/ocp-setup.sh` script performs the following actions:

1. **Creates namespace** (if it doesn't exist)
2. **Creates service account** `github-actions` in the specified namespace
3. **Grants permissions:**
   - `edit` role in the target namespace
   - `cluster-admin` role for deployment operations
   - Special permissions for monitoring, alerting, and observability components
4. **Creates token secret** for authentication
5. **Extracts the token** and displays configuration values

### Permissions Granted

The service account receives these permissions:
- **Namespace-level**: Edit permissions for deploying applications
- **Cluster-level**: Admin permissions for creating cluster resources
- **Monitoring**: Access to Prometheus, AlertManager, and monitoring components
- **Observability**: Access to Tempo, OpenTelemetry, and tracing components
- **Storage**: Access to MinIO object storage for trace data and log data

### Script Options

```bash
Usage: ./scripts/ocp-setup.sh [OPTIONS]

Options:
  -n/-N NAMESPACE          Target namespace (required)
  -s/-S                    Perform initial setup (create SA and grant permissions)
  -t/-T                    Extract token only
  -h                       Display help message

Examples:
  ./scripts/ocp-setup.sh -s -n my-namespace        # Initial setup
  ./scripts/ocp-setup.sh -T -N my-namespace        # Extract token only
  ./scripts/ocp-setup.sh -S -T -n my-namespace     # Setup and extract token
```

## Required Repository Secrets

After running the setup script, configure these secrets in your GitHub repository settings:

| Secret Name | Description | How to Obtain | Required For |
|-------------|-------------|---------------|--------------|
| `OPENSHIFT_SERVER` | OpenShift cluster API server URL | Output from setup script or `oc whoami --show-server` | Deploy/Undeploy workflows |
| `OPENSHIFT_TOKEN` | OpenShift service account token | Output from setup script (`-t` option) | Deploy/Undeploy workflows |
| `HUGGINGFACE_API_KEY` | Hugging Face API token for model access | [Create at huggingface.co](https://huggingface.co/settings/tokens) | Deploy workflow |
| `QUAY_USERNAME` | Quay.io registry username | Your Quay.io account username | Build and Push workflow |
| `QUAY_PASSWORD` | Quay.io registry password/token | Your Quay.io account password or [robot token](https://quay.io/organization/your-org?tab=robots) | Build and Push workflow |

## Workflow Configuration

**Deploy Workflow:**
- **Automatic trigger:** Runs after successful build workflow
- **Manual trigger:** Can specify custom namespace
- **Force deploy option:** Deploy even if build workflow didn't run
- **Namespace selection:**
  - Manual dispatch with input: Uses the specified namespace
  - Automatic workflow_run: Uses the branch name that triggered the workflow
  - Workflow_dispatch without input: Uses the current branch name

**Undeploy Workflow:**
- **Manual trigger only:** No automatic execution
- **Safety confirmation:** Must type exact confirmation string `DELETE {namespace}`
- **Namespace required:** Must specify target namespace for undeployment
- **Safety features:** Prevents accidental deletion through explicit confirmation

**Cleanup Old Container Images Workflow:**
- **Scheduled:** Runs automatically on 1st day of each month at midnight UTC
- **Manual trigger:** Also supports workflow_dispatch with custom parameters
- **Dry run:** Defaults to `true` for manual executions (scheduled runs delete by default)
- **Retention days:** Number of days to keep images (default: 30)
- **Protected tags:** Comma-separated list of additional tags to protect (optional)
- **Safety features:** Always protects `latest` and `v*` tags (official releases), defaults to dry-run mode

## Manual Workflow Execution

Most workflows run automatically, but some can be triggered manually:

### Automatic Workflows (No Manual Trigger)
- **Run Tests:** Triggered by PR events (opened, synchronize, reopened) and pushes to `main`/`dev`
- **Rebase Check:** Triggered by PR events (opened, synchronize, reopened)

### Scheduled Workflows (Can Also Run Manually)
- **Cleanup Old Container Images:** Runs monthly (1st day at midnight UTC), also supports manual trigger

### Manual Workflows
1. Go to **Actions** tab in your GitHub repository
2. Select the desired workflow
3. Click **Run workflow**
4. Fill in required parameters:

**Build and Push:**
- No parameters required - runs with default settings

**Deploy to OpenShift:**
- `namespace`: Target namespace (optional - defaults to branch name)
- `force_deploy`: Deploy even if build workflow didn't run (default: `false`)
- **Note**: The deploy workflow installs the complete observability stack (MinIO + TempoStack + OTEL + tracing) automatically
- **Note**: If namespace is not specified, deployment will use the current branch name as the namespace

**Undeploy from OpenShift:**
- `namespace`: Target namespace (required)
- `confirm_uninstall`: Must type exact confirmation string `DELETE {namespace}` (required)

**Cleanup Old Container Images:**
- `dry_run`: Dry run mode - show what would be deleted without deleting (default: `true`)
- `retention_days`: Keep images newer than this many days (default: 30)
- `protected_tags`: Additional tags to protect from deletion, comma-separated (optional)

## Workflow Variables

The workflows use these environment variables and inputs:

**Deploy Workflow:**
- `namespace`: Target OpenShift namespace (optional - defaults to branch name)
- `force_deploy`: Boolean to force deployment (default: `false`)

**Undeploy Workflow:**
- `namespace`: Target OpenShift namespace (required, no default)
- `confirm_uninstall`: Must type exact confirmation string `DELETE {namespace}` (required)

## Troubleshooting

### Common Issues

1. **Failed OpenShift login:** Check `OPENSHIFT_SERVER` and `OPENSHIFT_TOKEN` secrets
2. **Permission denied:** Ensure service account has proper cluster permissions
3. **Build failures:** Check container registry credentials (`QUAY_USERNAME`/`QUAY_PASSWORD`)
4. **Deploy timeout:** Verify cluster resources and namespace quotas
5. **Missing HuggingFace models:** Ensure `HUGGINGFACE_API_KEY` is valid

### Debug Steps

1. Check workflow logs in GitHub Actions tab
2. Verify all required secrets are configured
3. Test OpenShift connectivity: `oc whoami`
4. Validate service account permissions: `oc auth can-i create pods --as=system:serviceaccount:<namespace>:github-actions`