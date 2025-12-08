# Summarizer Image Cleanup Automation

This document describes the automated cleanup process for old Summarizer project container images in Quay.io.

## Overview

The `.github/workflows/cleanup-old-images.yml` workflow automatically deletes old Summarizer container images from Quay.io to prevent storage bloat and manage image retention.

## How It Works

### Automated Schedule
- **Runs monthly:** On the 1st day of every month at midnight UTC (00:00 UTC)
- **Processes all images:** metrics-ui, metrics-alerting, and mcp-server
- **Default retention:** Keeps images from the last 30 days
- **Protected tags:**
  - The `latest` tag is always preserved
  - All tags starting with `v` are always preserved (e.g., `v1.0.0`, `v2.5.3`)

### Manual Execution
You can also run the workflow manually via GitHub Actions with custom parameters:

1. Go to **Actions** tab in GitHub
2. Select **"Cleanup Old Summarizer Container Images"** workflow
3. Click **"Run workflow"**
4. Configure options:
   - **Dry run:** Check this to preview what would be deleted without actually deleting (recommended for first run)
   - **Retention days:** Enter number of days to keep images (default: 30)
   - **Protected tags:** Enter comma-separated tags to protect (optional)
     - Format: `tag1,tag2,tag3` (spaces are automatically trimmed)
     - Example: `1.5.0,2.0.0-beta,hotfix-123`
     - Leave empty if you don't want to protect additional tags

## Configuration

### Retention Policy

**Default:** 30 days (configurable)

The workflow deletes tags older than the retention period while:
- ✅ Keeping the `latest` tag (always protected)
- ✅ Keeping all tags starting with `v` (always protected - official releases)
- ✅ Keeping user-specified protected tags (when running manually)
- ✅ Keeping all images created within the retention period

### Required Secrets

The workflow uses existing GitHub secrets (already configured for your build workflow):
- `QUAY_USERNAME`: Quay.io username
- `QUAY_PASSWORD`: Quay.io password/token

### Images Managed

The workflow processes these Summarizer container images:
- `quay.io/ecosystem-appeng/aiobs-metrics-ui`
- `quay.io/ecosystem-appeng/aiobs-metrics-alerting`
- `quay.io/ecosystem-appeng/aiobs-mcp-server`

## Usage Examples

### 1. Test with Dry Run (Recommended First)

Before running cleanup for real, test with dry run:

```bash
# Via GitHub UI:
Actions → Cleanup Old Summarizer Container Images → Run workflow
- Dry run: ✓ (checked)
- Retention days: 30
```

This will show what would be deleted without actually deleting anything.

### 2. Cleanup with Custom Retention

To keep images for 60 days instead of 30:

```bash
# Via GitHub UI:
Actions → Cleanup Old Summarizer Container Images → Run workflow
- Dry run: ☐ (unchecked)
- Retention days: 60
```

### 3. Aggressive Cleanup (Keep Only Recent)

To keep only images from the last 7 days:

```bash
# Via GitHub UI:
Actions → Cleanup Old Summarizer Container Images → Run workflow
- Dry run: ☐ (unchecked)
- Retention days: 7
- Protected tags: (leave empty)
```

### 4. Protect Specific Tags During Cleanup

To protect specific tags in addition to the automatic protections:

```bash
# Via GitHub UI:
Actions → Cleanup Old Summarizer Container Images → Run workflow
- Dry run: ☐ (unchecked)
- Retention days: 30
- Protected tags: 1.5.0,2.0.0-beta,hotfix-123
```

This will protect:
- `latest` (always)
- `v*` pattern - all v-prefixed tags (always, e.g., `v1.0.0`, `v2.5.3`)
- `1.5.0`, `2.0.0-beta`, `hotfix-123` (user-specified)

## Workflow Output

The workflow provides a summary for each image processed:

```
🔍 Processing image: quay.io/ecosystem-appeng/aiobs-metrics-ui
📅 Retention policy: Keep images from last 30 days

Found 45 tags total

🔒 Protecting tag: latest (reserved tag)
🔒 Protecting tag: v1.0.0 (official release - v-prefix)
✅ Keeping tag: 1.0.1 (age: 5 days)
🗑️  Deleting tag: 0.9.8 (age: 45 days)
   ✅ Deleted successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary for metrics-ui:
  🗑️  Deleted: 20 tags
  ✅ Kept: 20 tags
  🔒 Protected: 4 tags
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Customization

### Change Retention Period

To modify the default retention period, edit `.github/workflows/cleanup-old-images.yml`:

```yaml
retention_days:
  description: 'Keep images newer than this many days'
  required: false
  type: number
  default: 30  # Change this value
```

### Change Schedule

To modify when the cleanup runs, edit the cron schedule:

```yaml
schedule:
  # Run on the 1st day of every month at midnight UTC (00:00 UTC)
  - cron: '0 0 1 * *'

# Examples:
# Daily at 3 AM:        '0 3 * * *'
# Every Monday at 1 AM: '0 1 * * 1'
# Weekly on Sunday:     '0 2 * * 0'
# First day of month:   '0 0 1 * *' (current)
```

### Protect Additional Tags

The workflow already protects:
- `latest` tag
- Tags starting with `v` (official releases, e.g., `v1.0.0`)

To protect additional tag patterns, edit the workflow script in `.github/workflows/cleanup-old-images.yml` and add custom protection logic before the age check.

## Monitoring

### View Workflow Runs

1. Go to **Actions** tab in GitHub
2. Select **"Cleanup Old Summarizer Container Images"**
3. View run history and logs

### Notifications

GitHub will notify you via email if:
- The workflow fails
- You have notifications enabled for workflow runs

## Frequently Asked Questions

### How do I specify protected tags?

When running the workflow manually, use the **Protected tags** input field:

**Format:** Comma-separated list of tag names
- ✅ Correct: `1.5.0,2.0.0-beta,hotfix-123`
- ✅ Also correct: `1.5.0, 2.0.0-beta, hotfix-123` (spaces are trimmed automatically)
- ❌ Incorrect: `"1.5.0","2.0.0-beta"` (don't use quotes)

**Important:**
- This field is **optional** - leave empty if you don't need to protect additional tags
- Only available when running **manually** (not used in scheduled runs)
- Adds to the automatic protections (`latest` and `v*` tags)

### What tags are automatically protected?

The workflow always protects:
1. **`latest`** - Reserved tag that should always exist
2. **Tags starting with `v`** - Official releases (e.g., `v1.0.0`, `v2.5.3`)

You don't need to specify these in the Protected tags field.

### Can I use wildcards or patterns?

No, currently the Protected tags field only accepts exact tag names. Each tag must be listed explicitly.

**Example:**
- ✅ Works: `1.5.0,1.5.1,1.5.2`
- ❌ Doesn't work: `1.5.*` or `1.5.?`

If you need pattern matching, you can modify the workflow script (see Customization section).

## Troubleshooting

### Workflow Fails with Authentication Error

**Problem:** `Failed to login to quay.io`

**Solution:** Verify secrets are set correctly:
```bash
# Check in GitHub repository:
Settings → Secrets and variables → Actions
# Ensure QUAY_USERNAME and QUAY_PASSWORD are set
```

### No Tags Deleted

**Problem:** Workflow runs but deletes nothing

**Possible causes:**
1. All images are within retention period (check output logs)
2. Dry run mode is enabled (check workflow inputs)
3. Unable to fetch tags (check permissions)

**Solution:** Run with dry run enabled to see what would be deleted

### Tags Not Found

**Problem:** `No tags found or unable to list tags`

**Solution:** Verify:
1. Image repository exists in Quay.io
2. Credentials have read access to the repository
3. Image name in workflow matches actual repository name

### Some Tags Failed to Delete

**Problem:** Workflow shows failed deletions in summary

**Solution:** Check workflow logs for detailed error messages. Common causes include insufficient permissions, tags already deleted, or registry propagation delays. Verify your Quay.io credentials have delete permissions.

## Best Practices

1. **Start with dry run:** Always test with dry run first to verify behavior
2. **Monitor regularly:** Check workflow logs after first few runs
3. **Adjust retention:** Tune retention period based on your needs (default: 30 days)
4. **Protect important tags:** Use the protected tags input for critical versions

## Security Notes

- Workflow uses existing `QUAY_USERNAME` and `QUAY_PASSWORD` secrets
- Credentials are only used during workflow execution
- No secrets are exposed in logs
- Cleanup is performed using official `skopeo` tool

## Manual Cleanup (Alternative)

If you prefer manual cleanup, you can use `skopeo` directly:

```bash
# Login to Quay.io
echo "$QUAY_PASSWORD" | skopeo login quay.io --username "$QUAY_USERNAME" --password-stdin

# List all tags
skopeo list-tags docker://quay.io/ecosystem-appeng/aiobs-metrics-ui

# Delete specific tag
skopeo delete docker://quay.io/ecosystem-appeng/aiobs-metrics-ui:old-tag

# Logout
skopeo logout quay.io
```

## Support

For issues or questions:
1. Check workflow logs in GitHub Actions
2. Review this documentation
3. Open an issue in the repository
