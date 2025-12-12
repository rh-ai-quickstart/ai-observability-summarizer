# Release Process

This document describes the automated release process for the OpenShift AI Observability Summarizer project.

## Overview

The release process is split into two steps to ensure version correctness and provide verification checkpoints:

1. **Prepare Release**: Creates a version bump commit, builds container images, and automatically creates a PR from `dev` to `main`
2. **Create Release**: Creates the GitHub release with release notes after verifying images are built correctly

## Prerequisites

- Write access to the repository
- Images are published to `quay.io/ecosystem-appeng`

## Container Image Tagging Strategy

This project uses a multi-tag strategy to support both development iteration and release protection:

### During Build (Prepare Release)
When images are built, they receive two tags:
- **Version tag** (e.g., `1.1.0`) - Specific version for testing/verification
- **`latest` tag** - Always points to the most recent build

### During Release (Create Release)
When creating an official release, images receive additional tags:
- **v-prefixed tag** (e.g., `v1.1.0`) - **Protected from automated cleanup**
- **`latest` tag** - Updated to point to the official release

### Tag Lifecycle
```
Build workflow runs:
  → aiobs-metrics-ui:1.1.0
  → aiobs-metrics-ui:latest

Create release workflow runs:
  → aiobs-metrics-ui:v1.1.0 (protected, never deleted)
  → aiobs-metrics-ui:latest (updated)

After 30 days (automated cleanup):
  → aiobs-metrics-ui:1.1.0 (deleted)
  → aiobs-metrics-ui:v1.1.0 (kept - protected by v-prefix)
  → aiobs-metrics-ui:latest (kept - always protected)
```

**Why this matters:** The automated cleanup workflow (PR #169) deletes images older than 30 days, **except** those tagged with `v` prefix (e.g., `v1.0.0`) or `latest`. This ensures official releases are permanently available while development builds are cleaned up automatically.

**Note:** The `v` prefix follows standard GitHub release conventions (e.g., `v1.0.0`, `v2.0.0`) and clearly distinguishes official releases from CI builds.

## Dry Run Mode

Both workflows support **dry run mode** to preview changes without executing them. This is highly recommended for:
- First-time users learning the process
- Testing version calculations
- Verifying release notes before publishing
- Validating settings before making changes

To use dry run:
1. Check the **dry_run** checkbox when running either workflow
2. Review the output and summary
3. Re-run with dry_run unchecked to execute for real

## Step 1: Prepare Release

This step creates a commit with the correct version bump prefix, builds container images, and creates a PR from `dev` to `main` (if target branch is `dev`).

### Using GitHub UI

1. Go to **Actions** → **Prepare Release**
2. Click **Run workflow**
3. Select options:
   - **Version bump type**: Choose `major`, `minor`, or `patch` (used if custom version is not provided)
   - **Custom version** (optional): Override with specific version like `1.2.3`
     - **If provided, this takes precedence over the version bump type** - the workflow will use your custom version instead of calculating one based on the bump type.
   - **Target branch**: Usually `dev` (or `main` for hotfixes)
   - **Dry run** (optional): Check to preview without pushing changes
4. Click **Run workflow**

**Tip**: Use dry run mode first to verify the expected version before pushing!

### What Happens

1. Version is calculated based on bump type (or custom version if provided)
2. Helm charts and Makefile are updated with the new version
3. A commit is created with the appropriate prefix:
   - `major:` for major version bumps (e.g., 1.0.0 → 2.0.0)
   - `minor:` for minor version bumps (e.g., 1.0.0 → 1.1.0)
   - `patch:` for patch version bumps (e.g., 1.0.0 → 1.0.1)
4. The commit is pushed to the target branch
5. Container images are built and pushed to Quay.io with two tags:
   - Version tag (e.g., `1.1.0`)
   - `latest` tag (always points to most recent build)
6. If target branch is `dev`, a PR is automatically created from `dev` to `main`

### Verification

After the workflow completes:

1. Check the workflow summary for:
   - Expected version number
   - Links to verify images in Quay.io
2. Verify all three images exist in Quay.io:
   - `aiobs-metrics-ui:<version>`
   - `aiobs-metrics-alerting:<version>`
   - `aiobs-mcp-server:<version>`
3. If target branch was `dev`, check for the PR from `dev` to `main`:
   - Go to the **Pull requests** tab in GitHub
   - Look for a PR titled "Release Preparation <version>" (e.g., "Release Preparation 1.1.0")
   - Review the PR before proceeding to Step 2

## Step 2: Create Release

After verifying the images are built correctly, create the GitHub release.

### Using GitHub UI

1. Go to **Actions** → **Create Release**
2. Click **Run workflow**
3. Fill in the details:
   - **Target branch**: Same branch used in Step 1 (usually `main`)
   - **Release notes** (optional): Custom notes, or leave empty for auto-generation. Supports markdown formatting (headers, bold, lists, code blocks). Line breaks and long text are supported.
   - **Pre-release**: Check if this is a pre-release/beta
   - **Dry run** (optional): Check to validate and preview without creating the release
4. Click **Run workflow**

**Note:** The version is automatically read from the Makefile (from the branch specified in Step 1). You don't need to enter it manually.

**Tip**: Use dry run mode to preview release notes and validate version before creating the actual release!

### What Happens

1. Version is read from the Makefile on the target branch
2. Version format is validated (must be `X.Y.Z` in Makefile, becomes `vX.Y.Z` for release)
3. Tag existence is checked (fails if tag already exists)
4. Either the custom or auto-generated Release notes are used
5. Container images are pulled and tagged with:
   - `v` prefix (e.g., `v1.1.0`) - **protected from automated cleanup**
   - `latest` tag (updated to point to this release)
6. GitHub release is created with:
   - Tag pointing to the target branch
   - Release notes with changelog
   - Links to container images

### Verification

After the workflow completes:

1. Check the [releases](https://github.com/rh-ai-quickstart/ai-observability-summarizer/releases) page on GitHub
2. Verify release notes are correct
3. Verify images are tagged correctly in Quay.io with `v` prefix
4. Review and merge the PR from `dev` to `main` (created in Step 1) to promote to main

## Complete Release Example

Here's a complete example of releasing version 1.1.0:

### 1. Dry Run - Prepare Release (Optional but Recommended)
```
Actions → Prepare Release → Run workflow
  - bump_type: minor
  - target_branch: dev
  - dry_run: true ✓
  → Shows: Would create commit "minor: prepare release 1.1.0"
  → Shows: Expected version would be 1.1.0
  → No changes pushed
```

### 2. Prepare Release (For Real)
```
Actions → Prepare Release → Run workflow
  - bump_type: minor
  - target_branch: dev
  - dry_run: false
  → Creates commit "minor: prepare release 1.1.0"
  → Updates Helm charts and Makefile to version 1.1.0
  → Builds and pushes images to Quay.io:
    • aiobs-metrics-ui:1.1.0
    • aiobs-metrics-ui:latest
    • aiobs-metrics-alerting:1.1.0
    • aiobs-metrics-alerting:latest
    • aiobs-mcp-server:1.1.0
    • aiobs-mcp-server:latest
  → Creates PR from dev to main
  → Outputs: Expected version 1.1.0
```

### 3. Verify Images and PR
```
Verify images in Quay.io (both tags should exist):
  ✓ quay.io/ecosystem-appeng/aiobs-metrics-ui:1.1.0
  ✓ quay.io/ecosystem-appeng/aiobs-metrics-ui:latest
  ✓ quay.io/ecosystem-appeng/aiobs-metrics-alerting:1.1.0
  ✓ quay.io/ecosystem-appeng/aiobs-metrics-alerting:latest
  ✓ quay.io/ecosystem-appeng/aiobs-mcp-server:1.1.0
  ✓ quay.io/ecosystem-appeng/aiobs-mcp-server:latest

Review PR from dev to main (created by prepare-release workflow)
```

### 4. Dry Run - Create Release (Optional but Recommended)
```
Actions → Create Release → Run workflow
  - target_branch: dev
  - release_notes: (empty for auto-generation)
  - dry_run: true ✓
  → Reads version from Makefile: 1.1.0
  → Validates version format (becomes v1.1.0)
  → Shows release notes preview
  → Shows what tags would be created
  → No release or tag created
```

### 5. Create Release (For Real)
```
Actions → Create Release → Run workflow
  - target_branch: dev
  - release_notes: (empty for auto-generation)
  - prerelease: false
  - dry_run: false
  → Reads version from Makefile: 1.1.0
  → Tags images with v-prefix (official release):
    • aiobs-metrics-ui:v1.1.0
    • aiobs-metrics-alerting:v1.1.0
    • aiobs-mcp-server:v1.1.0
  → Updates latest tag to point to v1.1.0
  → Creates GitHub release v1.1.0
```

### 6. Promote to Main
```
Review PR from dev to main (created in Step 2)
Merge PR after approval
  → main branch now has version 1.1.0
```

## Version Bump Guidelines

Choose the appropriate version bump type based on changes:

- **Major** (`major`): Breaking changes, API changes, major new features
  - Example: 1.0.0 → 2.0.0
- **Minor** (`minor`): New features, enhancements (backward compatible)
  - Example: 1.0.0 → 1.1.0
- **Patch** (`patch`): Bug fixes, minor improvements
  - Example: 1.0.0 → 1.0.1

## Troubleshooting

### Images not built by prepare-release
- Check the Actions tab to see if the workflow completed successfully
- Verify the commit was pushed successfully
- Check the workflow logs for build errors
- Verify Quay.io credentials are configured correctly

### Images not found in Quay.io
- Check the "Prepare Release" workflow logs for build errors
- Verify Quay.io credentials are configured correctly
- Check for build failures in the workflow summary

### Version error in create-release
- Ensure you ran "Prepare Release" first
- Check that the Makefile has the correct version on the target branch
- The version is automatically read from Makefile - no need to enter it manually
- Pull the latest changes from the target branch if needed

### Tag already exists
- Check existing releases: `https://github.com/<org>/<repo>/releases`
- Either delete the existing tag or use a different version
- Never reuse version numbers

### PR creation failed in prepare-release
- Check repository permissions (Settings → Actions → General → Workflow permissions)
- Verify "Allow GitHub Actions to create and approve pull requests" is enabled
- Check the workflow logs for specific error messages
- The workflow will continue even if PR creation fails - you can create it manually
- Manually create PR from `dev` to `main` if needed

## Manual Fallback

If the automated workflows fail, you can create releases manually:

```bash
# 1. Update version in Makefile
sed -i 's/VERSION ?= .*/VERSION ?= 1.1.0/' Makefile

# 2. Commit and push
git add Makefile
git commit -m "minor: prepare release 1.1.0"
git push origin dev

# 3. Wait for images to build

# 4. Create tag and release
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0

# 5. Create release on GitHub UI or using gh CLI
gh release create v1.1.0 --generate-notes
```

## Best Practices

1. **Use dry run first** - Always test with dry run mode before executing
2. **Always use dev branch** for releases, then promote to main via PR
3. **Verify images** before creating the release
4. **Use semantic versioning** consistently
5. **Review auto-generated release notes** before publishing (use dry run!)
6. **Create PR to main** for production releases
7. **Test deployments** after each release

## Support

For issues with the release process:
- Check workflow logs in the Actions tab
- Review this documentation
- Contact the maintainers
